// T&C Factory — Modifiche fatte a mano sui negozi Shopify → task completati (sql/task-modifiche-siti.sql)
//
// Ogni 15 minuti (cron del database, intestazione x-sync-key) legge lo storico eventi
// degli ultimi 2 giorni di ogni negozio attivo e tiene solo le modifiche fatte da una persona
// nell'admin (attributeToUser): niente app come "Bello l'autocaricamento" o Creative System
// (le modifiche di Riccardo passano da Claude e dalle app), niente ordini e clienti.
// tc_salva_modifiche_siti le salva e ricalcola le sessioni del responsabile (Gianluca) nei giorni in cui è presente.
//
// Secret: SHOPIFY_SYNC_KEY, SHOPIFY_SECRET_<NEGOZIO> (come shopify-sync).
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { API_VERSION, getToken, type Store } from '../_shared/shopify.ts';

const GIORNI = 2;
const PAGINE = 20;
// Lavoro sugli ordini e sui clienti: non sono modifiche al sito
const ESCLUSI = new Set(['ORDER', 'DRAFT_ORDER', 'CUSTOMER', 'FULFILLMENT', 'REFUND', 'TRANSACTION', 'RETURN', 'GIFT_CARD']);

const EVENTI = `query($q: String!, $after: String) {
  events(first: 250, after: $after, sortKey: CREATED_AT, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { id createdAt message attributeToApp attributeToUser appTitle
            ... on BasicEvent { subjectType subjectId action } }
  }
}`;

type Evento = { id: string; createdAt: string; message: string; attributeToApp: boolean; attributeToUser: boolean;
                appTitle: string | null; subjectType?: string; subjectId?: string; action?: string };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
// Il messaggio di Shopify contiene link HTML: solo testo
const testo = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

Deno.serve(async (req) => {
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  if (!syncKey || req.headers.get('x-sync-key') !== syncKey) return reply({ success: false, error: 'Non autorizzato' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: stores } = await db.from('shopify_stores').select('id, nome, dominio, client_id').eq('attivo', true);
  // Calcolo a ritroso: { "dal": "2026-09-01", "al": "2026-09-15" } legge solo quel periodo
  const body = await req.json().catch(() => ({})) as { dal?: string; al?: string };
  // Date del calcolo a ritroso: AAAA-MM-GG valide, altrimenti un errore chiaro (prima: 500 da toISOString)
  const dataValida = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'))
    && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;
  for (const k of ['dal', 'al'] as const) {
    if (body[k] !== undefined && !dataValida(body[k])) return reply({ success: false, error: `"${k}" deve essere una data AAAA-MM-GG valida (ricevuto: ${JSON.stringify(body[k])})` }, 400);
  }
  if (body.dal && body.al && body.al <= body.dal) return reply({ success: false, error: '"al" deve essere dopo "dal"' }, 400);
  const dal = body.dal ? new Date(body.dal + 'T00:00:00Z').toISOString() : new Date(Date.now() - GIORNI * 86400_000).toISOString();
  const al = body.al ? ` AND created_at:<'${new Date(body.al + 'T00:00:00Z').toISOString()}'` : '';
  const filtro = `created_at:>='${dal}'${al} AND NOT subject_type:ORDER AND NOT subject_type:CUSTOMER`;
  const pagine = body.dal ? 60 : PAGINE;
  let primo: string | null = null;
  const esito: Record<string, unknown> = {};
  const tenuti: Record<string, string>[] = [];

  for (const store of (stores || []) as Store[]) {
    try {
      const token = await getToken(db, store);
      let after: string | null = null, letti = 0, presi = 0;
      for (let p = 0; p < pagine; p++) {
        const res = await fetch(`https://${store.dominio}/admin/api/${API_VERSION}/graphql.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
          body: JSON.stringify({ query: EVENTI, variables: { q: filtro, after } }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.errors?.length) throw new Error(`Shopify ${res.status}: ${JSON.stringify(json.errors || json).slice(0, 300)}`);
        const ev = json.data.events;
        for (const e of ev.nodes as Evento[]) {
          letti++;
          if (!primo || e.createdAt < primo) primo = e.createdAt;
          // Fatta da una persona dall'admin (Shopify Web / app mobile); le app hanno attributeToUser falso
          if (!e.attributeToUser) continue;
          if (ESCLUSI.has(e.subjectType || '')) continue;
          presi++;
          tenuti.push({ store_id: store.id, id: e.id, at: e.createdAt, oggetto: e.subjectType || '', soggetto: e.subjectId || '', messaggio: testo(e.message || '') });
        }
        if (!ev.pageInfo.hasNextPage) { after = null; break; }
        after = ev.pageInfo.endCursor;
      }
      esito[store.id] = { letti, modifiche: presi, ...(after ? { incompleto: true } : {}) };
    } catch (e) {
      esito[store.id] = `errore: ${(e as Error).message}`;
    }
  }

  const { data: sessioni, error } = await db.rpc('tc_salva_modifiche_siti', { p: tenuti });
  if (error) return reply({ success: false, error: error.message, esito }, 500);
  return reply({ success: true, sessioni, esito, primo });
});
