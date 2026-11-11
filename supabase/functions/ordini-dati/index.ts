// T&C Factory — Richiesta al cliente dei dati che mancano per spedire (indirizzo incompleto, telefono)
//
// Ogni 5 minuti, sugli ordini da evadere:
//   1. modalità automatica: una mail sola per ordine, dalla casella del negozio, dalle 8 alle 21,
//      solo ordini pagati degli ultimi 7 giorni. Senza indirizzo (forse ritiro in sede) non scrive.
//      In prova la manda una persona, col clic sull'etichetta rossa (mail-send la registra).
//   2. telefono dato dal cliente in una mail (clienti_memoria): lo scrive nell'ordine su Shopify
//   3. dati arrivati nell'ordine, o ordine spedito o annullato: la richiesta si chiude, e il suo task
//   4. un giorno lavorativo dopo la mail senza risposta: task per chiamare il cliente
//
// Chi la può chiamare: il cron del database (x-sync-key) oppure un admin collegato.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { inviaNuova } from '../_shared/mail.ts';
import { API_VERSION, getToken, type Store } from '../_shared/shopify.ts';
import { MANCA_INDIRIZZO, SHOP_DA_EVADERE, problemiOrdine, testoRichiesta } from '../_shared/ordini-dati.ts';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const GIORNI_RECENTI = 7;
const ORE_INVIO = [8, 21];
const MAX_INVII = 20;              // per giro: un errore nelle regole non scrive a tutti in una volta

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

const COSA: Record<string, string> = { 'Manca il telefono': 'il telefono', 'Telefono incompleto': 'il telefono completo', 'Manca il numero civico': 'il numero civico',
  'Manca il CAP': 'il CAP', 'CAP non valido': 'il CAP corretto', 'Manca la città': 'la città', 'Manca la provincia': 'la provincia' };
const pagato = (o: Row) => ['PAID', 'PARTIALLY_REFUNDED'].includes(o.stato_pagamento);
const giorno = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const fmtGiorno = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' });
const oraRoma = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));

// ── Telefono dato dal cliente: nell'ordine su Shopify, così finisce sull'etichetta ──
async function shopify(store: Store, token: string, query: string, variables: Row) {
  const res = await fetch(`https://${store.dominio}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  if (json.errors?.length) throw new Error(`Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}
const LEGGI = `query($id: ID!) { order(id: $id) { displayFulfillmentStatus cancelledAt
  shippingAddress { firstName lastName company address1 address2 city zip provinceCode countryCodeV2 phone } } }`;
const AGGIORNA = `mutation($input: OrderInput!) { orderUpdate(input: $input) { userErrors { field message } } }`;

async function scriviTelefono(db: SupabaseClient, o: Row, telefono: string) {
  const { data: store } = await db.from('shopify_stores').select('id, nome, dominio, client_id').eq('id', o.store_id).maybeSingle();
  if (!store) throw new Error(`Negozio ${o.store_id} non trovato`);
  const token = await getToken(db, store as Store);
  const { order } = await shopify(store as Store, token, LEGGI, { id: o.shopify_id });
  const a = order?.shippingAddress;
  if (!order || order.cancelledAt || order.displayFulfillmentStatus !== 'UNFULFILLED' || !a) return false;
  const { orderUpdate } = await shopify(store as Store, token, AGGIORNA, { input: {
    id: o.shopify_id,
    shippingAddress: {
      firstName: a.firstName, lastName: a.lastName, company: a.company, address1: a.address1, address2: a.address2,
      city: a.city, zip: a.zip, provinceCode: a.provinceCode, countryCode: a.countryCodeV2, phone: telefono,
    },
  } });
  if (orderUpdate.userErrors?.length) throw new Error(`Shopify: ${orderUpdate.userErrors.map((e: Row) => e.message).join('; ').slice(0, 300)}`);
  await db.from('shopify_orders').update({ telefono }).eq('id', o.id);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  if (!syncKey || req.headers.get('x-sync-key') !== syncKey) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await db.auth.getUser(jwt);
    if (!caller?.user) return fail('Accesso richiesto', 401);
    const { data: me } = await db.from('app_users').select('is_admin').eq('auth_id', caller.user.id).maybeSingle();
    if (!me?.is_admin) return fail('Solo gli admin', 403);
  }

  const { data: imp } = await db.from('automazioni_impostazioni').select('modo').eq('nome', 'richiesta-dati').maybeSingle();
  const modo = imp?.modo || 'prova';
  if (modo === 'spenta') return reply({ success: true, modo });

  const [{ data: ordini, error }, { data: richieste }] = await Promise.all([
    db.from('shopify_orders').select('id, shopify_id, store_id, numero, creato_at, cliente, email, telefono, indirizzo, stato_pagamento')
      .is('annullato_at', null).in('stato_evasione', SHOP_DA_EVADERE).limit(2000),
    db.from('ordini_richieste_dati').select('*').is('risolta_at', null),
  ]);
  if (error) return fail(error.message, 500);
  const aperti = new Map((ordini || []).map((o: Row) => [o.id, o]));
  const registro: string[] = [];
  let inviate = 0, errori = 0, task = 0;

  // Telefoni che il cliente ci ha già dato per mail
  const emails = [...new Set((ordini || []).map((o: Row) => String(o.email || '').toLowerCase()).filter(Boolean))];
  const memoria = new Map<string, string>();
  for (let i = 0; i < emails.length; i += 200) {
    const { data } = await db.from('clienti_memoria').select('email, telefono').in('email', emails.slice(i, i + 200)).not('telefono', 'is', null);
    (data || []).forEach((m: Row) => { if (String(m.telefono).replace(/\D/g, '').length >= 8) memoria.set(m.email, m.telefono); });
  }
  const telMemoria = (o: Row) => memoria.get(String(o.email || '').toLowerCase()) || null;

  // ── Richieste aperte: telefono arrivato, dati sistemati, ordine non più da spedire ──
  const { data: tipo } = await db.from('task_tipi').select('id').eq('nome', 'Dati mancanti per spedire').maybeSingle();
  for (const r of (richieste || []) as Row[]) {
    const o = aperti.get(r.ordine_id);
    let probs = o ? problemiOrdine(o) : [];
    const tel = o && telMemoria(o);
    if (o && tel && probs.some(p => p[0] === 'tel')) {
      try {
        if (await scriviTelefono(db, o, tel)) {
          registro.push(`${o.numero} (${o.store_id}) · telefono dato dal cliente scritto nell'ordine`);
          probs = problemiOrdine({ ...o, telefono: tel });
        }
      } catch (e) {
        errori++;
        registro.push(`${o.numero} (${o.store_id}) · telefono non scritto su Shopify: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (o && probs.length) continue;
    const motivo = !o ? 'Chiuso da solo: l\'ordine non è più da spedire' : 'Chiuso da solo: nell\'ordine ora ci sono i dati per spedire';
    await db.from('ordini_richieste_dati').update({ risolta_at: new Date().toISOString() }).eq('ordine_id', r.ordine_id);
    if (r.task_id) await db.from('tasks').update({ stato: 'completato', motivo }).eq('id', r.task_id).not('stato', 'in', '(completato,non_completato)');
  }

  // ── Nuove richieste (solo in automatico) ──
  // Una richiesta sola per ordine, anche se quella di prima è chiusa
  const giaChieste = new Set(((await db.from('ordini_richieste_dati').select('ordine_id')).data || []).map((r: Row) => r.ordine_id));
  const [daOra, aOra] = ORE_INVIO;
  if (modo === 'automatica' && oraRoma() >= daOra && oraRoma() < aOra) {
    const limite = Date.now() - GIORNI_RECENTI * 86_400_000;
    const caselle = new Map(((await db.from('mail_caselle').select('*').eq('attivo', true)).data || []).map((c: Row) => [c.id, c]));
    for (const o of (ordini || []) as Row[]) {
      if (inviate + errori >= MAX_INVII) break;
      if (giaChieste.has(o.id) || !o.email || !pagato(o) || new Date(o.creato_at).getTime() < limite) continue;
      const probs = problemiOrdine(o, !!telMemoria(o));
      if (!probs.length || probs.some(p => p[1] === MANCA_INDIRIZZO)) continue;
      const casella = caselle.get(o.store_id);
      if (!casella) continue;
      // Prenota: due giri in parallelo non mandano la stessa mail due volte
      const { data: prenotata } = await db.from('ordini_richieste_dati').upsert({
        ordine_id: o.id, store_id: o.store_id, mancanti: probs.map(p => p[1]), inviata_at: new Date().toISOString(), inviata_da: 'automatica', esito: 'in invio',
      }, { onConflict: 'ordine_id', ignoreDuplicates: true }).select('ordine_id');
      if (!prenotata?.length) continue;
      const { oggetto, corpo } = testoRichiesta(o, probs);
      try {
        await inviaNuova(db, casella, o.email, o.cliente || null, oggetto, `${corpo}\n\n${casella.nome}`);
        await db.from('ordini_richieste_dati').update({ esito: 'inviata' }).eq('ordine_id', o.id);
        inviate++;
        registro.push(`${o.numero} (${o.store_id}) · ${probs.map(p => p[1]).join(', ')} · ${o.email} · inviata`);
      } catch (e) {
        errori++;
        const msg = e instanceof Error ? e.message : String(e);
        // Si riprova al giro dopo
        await db.from('ordini_richieste_dati').delete().eq('ordine_id', o.id);
        registro.push(`${o.numero} (${o.store_id}) · ${o.email} · errore: ${msg}`);
      }
    }
  }

  // ── Nessuna risposta dopo un giorno lavorativo: task per chiamare ──
  const { data: inAttesa } = await db.from('ordini_richieste_dati').select('*').is('risolta_at', null).is('task_id', null).eq('esito', 'inviata');
  for (const r of (inAttesa || []) as Row[]) {
    const o = aperti.get(r.ordine_id);
    if (!o?.email) continue;
    const { data: giorni } = await db.rpc('tc_giorni_lavorativi', { p_da: giorno(r.inviata_at), p_a: giorno(new Date().toISOString()) });
    if ((giorni ?? 0) < 1) continue;
    // Se il cliente ha risposto ci pensa il task della sua mail
    const { data: risposte } = await db.from('mail_messaggi').select('id').eq('direzione', 'in').ilike('da_email', o.email).gte('ricevuto_at', r.inviata_at).limit(1);
    if (risposte?.length) continue;
    const probs = problemiOrdine(o, !!telMemoria(o));
    const tel = String(o.telefono || '').replace(/\D/g, '').length >= 8 ? o.telefono : null;
    const voci = probs.map(p => COSA[p[1]] || p[1].toLowerCase());
    const cosa = voci.length > 1 ? `${voci.slice(0, -1).join(', ')} e ${voci[voci.length - 1]}` : voci[0];
    const descrizione = tel
      ? `Il ${fmtGiorno(r.inviata_at)} abbiamo chiesto al cliente ${cosa} e non ha risposto. Chiamalo al ${tel}, poi correggi l'ordine su Shopify. Non spedire finché i dati non sono a posto.`
      : `Il ${fmtGiorno(r.inviata_at)} abbiamo chiesto al cliente ${cosa} e non ha risposto, e nell'ordine non c'è il telefono. Riscrivigli dalla scheda Shop (clic sull'etichetta rossa). Non spedire finché i dati non sono a posto.`;
    const { data: nuovo, error: e } = await db.from('tasks').insert({
      tipo_id: tipo?.id || null, titolo: `${tel ? 'CHIAMARE · ' : ''}Dati mancanti · ordine ${o.numero}${o.cliente ? ` · ${o.cliente}` : ''}`.slice(0, 200),
      descrizione, priorita: 'alta', macroarea: o.store_id, fonte: 'shopify', creato_da: 'cervello',
      fonte_rif: { evento_id: `dati:${o.id}`, ordine: o.id, motivo: 'dati_mancanti' },
      analisi: {
        cliente: { nome: o.cliente, email: o.email, telefono: tel },
        ordini: [{ negozio: o.store_id, numero: o.numero }],
        richiesta: { inviata_at: r.inviata_at, da: r.inviata_da, mancanti: probs.map(p => p[1]) },
      },
    }).select('id').maybeSingle();
    if (e && e.code !== '23505') { errori++; registro.push(`${o.numero} · task non creato: ${e.message}`); continue; }
    if (nuovo) { task++; await db.from('ordini_richieste_dati').update({ task_id: nuovo.id }).eq('ordine_id', r.ordine_id); registro.push(`${o.numero} (${o.store_id}) · nessuna risposta: task creato`); }
  }

  // Registro delle automazioni: una riga solo per i giri che hanno fatto qualcosa
  if (registro.length) {
    await db.from('automazione_esecuzioni').insert({
      nome: 'richiesta-dati', stato: errori ? 'errore' : modo === 'prova' ? 'prova' : 'ok', fine: new Date().toISOString(),
      riepilogo: { mail: inviate, task, errori }, output: registro.join('\n'),
    });
  }
  return reply({ success: true, modo, inviate, task, errori });
});
