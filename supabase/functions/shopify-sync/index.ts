// T&C Factory — Sincronizzazione ordini Shopify (Centro di controllo, fase 1)
//
// Per ogni negozio attivo in shopify_stores:
//   1. ottiene un token di accesso con il "client credentials grant" (dura 24 ore,
//      viene salvato in shopify_tokens e riusato finché non sta per scadere)
//   2. legge gli ordini aggiornati dopo l'ultimo cursore (sync_da), in ordine di aggiornamento
//   3. li salva in shopify_orders e mette i nuovi in `eventi` per il cervello
//
// Chi la può chiamare:
//   • il cron del database ogni 5 minuti, con l'intestazione x-sync-key
//   • un admin dal gestionale ("Sincronizza ora"), con il suo login
//
// Secret richiesti (supabase secrets set …):
//   SHOPIFY_SYNC_KEY                 chiave condivisa con il cron (sta anche nel Vault)
//   SHOPIFY_SECRET_<ID MAIUSCOLO>    Client secret dell'app di ogni negozio,
//                                    es. SHOPIFY_SECRET_CIUCCIAMILCALZINO
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const API_VERSION = '2026-10';
const PAGE = 25;                    // ordini per richiesta (costo della query sotto il limite di Shopify)
const TIME_BUDGET_MS = 100_000;     // poi si ferma e riprende al giro successivo dal cursore
const FIRST_SYNC_DAYS = 60;         // al primo collegamento: ordini degli ultimi 60 giorni
const NEW_EVENT_HOURS = 24;         // solo gli ordini creati nelle ultime 24 ore diventano eventi

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

type Store = { id: string; nome: string; dominio: string; client_id: string; sync_da: string | null };

const ORDERS_QUERY = `
query Orders($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, sortKey: UPDATED_AT, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt
      email phone note tags
      displayFinancialStatus displayFulfillmentStatus
      totalPriceSet { shopMoney { amount currencyCode } }
      customer { displayName }
      shippingAddress { name address1 address2 city zip province countryCodeV2 phone }
      lineItems(first: 15) { nodes { title variantTitle sku quantity } }
      fulfillments(first: 5) {
        status createdAt displayStatus
        trackingInfo(first: 3) { company number url }
      }
    }
  }
}`;

// ── Token ──

async function getToken(db: SupabaseClient, store: Store): Promise<string> {
  const { data: saved } = await db.from('shopify_tokens').select('access_token, scade_at').eq('store_id', store.id).maybeSingle();
  if (saved && new Date(saved.scade_at).getTime() - Date.now() > 10 * 60_000) return saved.access_token;

  const secret = Deno.env.get(`SHOPIFY_SECRET_${store.id.toUpperCase()}`);
  if (!secret) throw new Error(`Manca il secret SHOPIFY_SECRET_${store.id.toUpperCase()}`);

  const res = await fetch(`https://${store.dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: store.client_id, client_secret: secret }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Accesso negato da Shopify (${res.status}): ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('Shopify non ha restituito il token');

  const scade = new Date(Date.now() + (Number(json.expires_in) || 86_399) * 1000).toISOString();
  await db.from('shopify_tokens').upsert({ store_id: store.id, access_token: json.access_token, scade_at: scade });
  return json.access_token;
}

// ── GraphQL con ripetizione se Shopify rallenta (THROTTLED) ──

async function gql(store: Store, token: string, variables: Record<string, unknown>) {
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(`https://${store.dominio}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: ORDERS_QUERY, variables }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, 1500 * (tentativo + 1))); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Errore Shopify ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
    const throttled = json.errors?.some((e: { extensions?: { code?: string } }) => e.extensions?.code === 'THROTTLED');
    if (throttled) { await new Promise(r => setTimeout(r, 2000 * (tentativo + 1))); continue; }
    if (json.errors?.length) throw new Error(`Errore nella query Shopify: ${json.errors.map((e: { message: string }) => e.message).join('; ').slice(0, 300)}`);
    return json.data;
  }
  throw new Error('Shopify non risponde, riprovo al prossimo giro');
}

// ── Ordine Shopify → riga di shopify_orders ──

// deno-lint-ignore no-explicit-any
function toRow(storeId: string, o: any) {
  const addr = o.shippingAddress;
  return {
    store_id: storeId,
    shopify_id: o.id,
    numero: o.name,
    creato_at: o.createdAt,
    aggiornato_at: o.updatedAt,
    annullato_at: o.cancelledAt,
    cliente: o.customer?.displayName || addr?.name || null,
    email: o.email || null,
    telefono: o.phone || addr?.phone || null,
    totale: o.totalPriceSet?.shopMoney?.amount != null ? Number(o.totalPriceSet.shopMoney.amount) : null,
    valuta: o.totalPriceSet?.shopMoney?.currencyCode || null,
    stato_pagamento: o.displayFinancialStatus,
    stato_evasione: o.displayFulfillmentStatus,
    // deno-lint-ignore no-explicit-any
    tracking: (o.fulfillments || []).flatMap((f: any) => (f.trackingInfo?.length ? f.trackingInfo : [{}]).map((t: any) => ({
      corriere: t.company || null, numero: t.number || null, url: t.url || null,
      stato: f.displayStatus || f.status, at: f.createdAt,
    }))),
    // deno-lint-ignore no-explicit-any
    righe: (o.lineItems?.nodes || []).map((l: any) => ({ titolo: l.title, variante: l.variantTitle, sku: l.sku, qnt: l.quantity })),
    indirizzo: addr ? { nome: addr.name, via: [addr.address1, addr.address2].filter(Boolean).join(', '), citta: addr.city,
                        cap: addr.zip, provincia: addr.province, paese: addr.countryCodeV2 } : null,
    note: o.note || null,
    tags: o.tags || [],
  };
}

// ── Un negozio ──

async function syncStore(db: SupabaseClient, store: Store, deadline: number) {
  const primoSync = !store.sync_da;
  const da = store.sync_da || new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000).toISOString();
  const token = await getToken(db, store);

  let after: string | null = null, cursore = da, letti = 0, nuovi = 0, finito = false;
  while (Date.now() < deadline) {
    const data = await gql(store, token, { first: PAGE, after, query: `updated_at:>='${da}'` });
    const page = data.orders;
    const rows = page.nodes.map((o: unknown) => toRow(store.id, o));

    if (rows.length) {
      // Quali sono nuovi (per gli eventi del cervello)
      const ids = rows.map((r: { shopify_id: string }) => r.shopify_id);
      const { data: esistenti } = await db.from('shopify_orders').select('shopify_id').eq('store_id', store.id).in('shopify_id', ids);
      const gia = new Set((esistenti || []).map((e: { shopify_id: string }) => e.shopify_id));

      const { error } = await db.from('shopify_orders').upsert(rows, { onConflict: 'store_id,shopify_id' });
      if (error) throw new Error(`Salvataggio ordini: ${error.message}`);

      const recenti = Date.now() - NEW_EVENT_HOURS * 3_600_000;
      const eventi = primoSync ? [] : rows
        .filter((r: { shopify_id: string; creato_at: string }) => !gia.has(r.shopify_id) && new Date(r.creato_at).getTime() > recenti)
        .map((r: { shopify_id: string; numero: string; cliente: string; totale: number; valuta: string }) => ({
          fonte: 'shopify', account: store.id, tipo: 'ordine_creato', id_esterno: r.shopify_id,
          payload: { negozio: store.nome, numero: r.numero, cliente: r.cliente, totale: r.totale, valuta: r.valuta },
        }));
      if (eventi.length) await db.from('eventi').upsert(eventi, { onConflict: 'fonte,account,id_esterno', ignoreDuplicates: true });

      letti += rows.length;
      nuovi += rows.filter((r: { shopify_id: string }) => !gia.has(r.shopify_id)).length;
      cursore = rows[rows.length - 1].aggiornato_at;
    }

    if (!page.pageInfo.hasNextPage) { finito = true; break; }
    after = page.pageInfo.endCursor;
  }

  // Il cursore avanza solo fin dove si è letto: se il tempo è finito, si riprende da lì
  await db.from('shopify_stores').update({
    sync_da: finito && !letti ? store.sync_da || da : cursore,
    ultimo_sync_at: new Date().toISOString(),
    ultimo_errore: null,
  }).eq('id', store.id);

  return { negozio: store.nome, letti, nuovi, completo: finito };
}

// ── Ingresso ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Cron (chiave condivisa) oppure admin collegato
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  const fromCron = !!syncKey && req.headers.get('x-sync-key') === syncKey;
  if (!fromCron) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await db.auth.getUser(jwt);
    if (!caller?.user) return fail('Accesso richiesto', 401);
    const { data: me } = await db.from('app_users').select('is_admin').eq('auth_id', caller.user.id).maybeSingle();
    if (!me?.is_admin) return fail('Solo gli admin possono sincronizzare', 403);
  }

  let body: { store?: string } = {};
  try { body = await req.json(); } catch { /* corpo vuoto */ }

  let q = db.from('shopify_stores').select('id, nome, dominio, client_id, sync_da').eq('attivo', true).order('nome');
  if (body.store) q = q.eq('id', body.store);
  const { data: stores, error } = await q;
  if (error) return fail(`Negozi non leggibili: ${error.message}`, 500);

  const deadline = Date.now() + TIME_BUDGET_MS;
  const risultati = [];
  for (const store of stores as Store[]) {
    // Il tempo rimasto si divide tra i negozi ancora da fare
    const quota = Date.now() + Math.max(5_000, (deadline - Date.now()) / Math.max(1, (stores as Store[]).length - risultati.length));
    try {
      risultati.push(await syncStore(db, store, quota));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('shopify_stores').update({ ultimo_errore: msg.slice(0, 500), ultimo_sync_at: new Date().toISOString() }).eq('id', store.id);
      risultati.push({ negozio: store.nome, errore: msg });
    }
  }
  return reply({ success: true, risultati });
});
