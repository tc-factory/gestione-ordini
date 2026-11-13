// T&C Factory — Risposta a un cliente su Facebook (Messenger) o Instagram, dal Centro di controllo
//
// Body: { conversazione: uuid, testo: string }. Manda il messaggio con il token della Pagina o del
// profilo Instagram e lo salva in social_messaggi. Meta permette di rispondere solo entro 24 ore
// dall'ultimo messaggio del cliente; finché l'app non è approvata da Meta (accesso avanzato) i
// messaggi arrivano solo a chi ha un ruolo nell'app.
// Chi la chiama: lo staff collegato. Va pubblicata con --no-verify-jwt: il controllo lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { erroreLeggibile, GRAPH, salvaMessaggio, tokenAccount } from '../_shared/social.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await db.auth.getUser(jwt);
  if (!caller?.user) return fail('Accesso richiesto', 401);
  const { data: me } = await db.from('app_users').select('id').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail('Accesso negato', 403);

  const { conversazione, testo } = await req.json().catch(() => ({}));
  const messaggio = String(testo || '').trim();
  if (!conversazione || !messaggio) return fail('Manca il testo');
  if (messaggio.length > 2000) return fail('Messaggio troppo lungo (massimo 2000 caratteri)');

  const { data: conv } = await db.from('social_conversazioni').select('id, utente_id, account, social_account(id, piattaforma, account_id)').eq('id', conversazione).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const acc = (conv as any)?.social_account;
  if (!conv || !acc) return fail('Conversazione non trovata', 404);
  const token = await tokenAccount(db, acc.id);
  if (!token) return fail('Token mancante: ricollega l\'account in Collegamenti');

  const res = await fetch(`${GRAPH}/${acc.account_id}/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: conv.utente_id }, messaging_type: 'RESPONSE', message: { text: messaggio } }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) return fail(erroreLeggibile(json.error?.message || `Meta ha risposto ${res.status}`), 502);

  await salvaMessaggio(db, acc.id, conv.utente_id, {
    mid: json.message_id || null, direzione: 'out', testo: messaggio, at: new Date().toISOString(), inviato_da: me.id,
  });
  return reply({ success: true });
});
