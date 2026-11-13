// T&C Factory — Lettura delle conversazioni Facebook (Messenger) e Instagram dei negozi
//
// Per ogni account collegato (social_account) legge da Meta le ultime conversazioni con i loro
// messaggi e salva quelli nuovi (social_conversazioni / social_messaggi). Il webhook meta-webhook
// porta i messaggi in tempo reale; questa lettura recupera quelli che non arrivano dal webhook.
// Errori per account in social_account.ultimo_errore (es. accesso ai direct spento nell'app Instagram).
//
// Chi la chiama: il cron del database (x-sync-key, ogni 5 minuti) oppure lo staff dal gestionale.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { erroreLeggibile, graph, Row, salvaMessaggio, tokenAccount } from '../_shared/social.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// In due passi, perché chiedere conversazioni e messaggi insieme fa piantare Meta ("reduce the amount
// of data", visto su Instagram di Ciucciami): prima l'elenco leggero delle conversazioni, poi i messaggi
// solo di quelle cambiate dopo l'ultima lettura, una alla volta.
const CONV = 25;
const MSG = 20;
const CAMPI_MSG = `messages.limit(${MSG}){id,message,from,created_time,attachments{mime_type,name,file_url}}`;

async function leggiAccount(db: ReturnType<typeof createClient>, a: Row) {
  const token = await tokenAccount(db, a.id);
  if (!token) throw new Error('Token mancante: ricollega l\'account');
  const r = await graph(`${a.account_id}/conversations`, { platform: a.piattaforma, fields: 'id,updated_time,participants', limit: String(CONV), access_token: token });
  const { data: note } = await db.from('social_conversazioni').select('thread_id, ultimo_at').eq('account', a.id);
  const ultimo = new Map((note || []).map(c => [c.thread_id, c.ultimo_at ? new Date(c.ultimo_at).getTime() : 0]));

  let nuovi = 0;
  for (const c of r.data || []) {
    if (ultimo.has(c.id) && new Date(c.updated_time).getTime() <= (ultimo.get(c.id) || 0)) continue;   // niente di nuovo
    const parti: Row[] = c.participants?.data || [];
    const cliente = parti.find(p => String(p.id) !== String(a.account_id) && p.username !== a.username) || parti[0];
    if (!cliente?.id) continue;
    const conv = await graph(c.id, { fields: CAMPI_MSG, access_token: token });
    // Dal più vecchio al più nuovo, così l'anteprima resta sull'ultimo
    for (const m of [...(conv.messages?.data || [])].reverse()) {
      const nostro = String(m.from?.id) === String(a.account_id) || (a.username && m.from?.username === a.username);
      const ok = await salvaMessaggio(db, a.id, String(cliente.id), {
        mid: m.id, direzione: nostro ? 'out' : 'in', testo: m.message || '',
        allegati: m.attachments?.data || [], at: new Date(m.created_time).toISOString(),
      }, { nome: cliente.name || cliente.username || null, thread: c.id });
      if (ok) nuovi++;
    }
  }
  return nuovi;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  if (!(syncKey && req.headers.get('x-sync-key') === syncKey)) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await db.auth.getUser(jwt);
    if (!caller?.user) return reply({ success: false, error: 'Accesso richiesto' }, 401);
    const { data: me } = await db.from('app_users').select('id').eq('auth_id', caller.user.id).maybeSingle();
    if (!me) return reply({ success: false, error: 'Accesso negato' }, 403);
  }

  const { data: account } = await db.from('social_account').select('id, piattaforma, account_id, username').eq('attivo', true).in('piattaforma', ['messenger', 'instagram']);
  const risultati: Row[] = [];
  for (const a of account || []) {
    try {
      const nuovi = await leggiAccount(db, a);
      await db.from('social_account').update({ ultimo_errore: null }).eq('id', a.id);
      risultati.push({ account: a.username, nuovi });
    } catch (e) {
      const errore = erroreLeggibile((e as Error).message);
      await db.from('social_account').update({ ultimo_errore: errore }).eq('id', a.id);
      risultati.push({ account: a.username, errore });
    }
  }
  return reply({ success: true, risultati });
});
