// T&C Factory — Webhook Meta: messaggi in arrivo da Messenger (Pagine Facebook) e Instagram
//
// GET: verifica di Meta (hub.verify_token = secret META_WEBHOOK_VERIFY_TOKEN).
// POST: firma X-Hub-Signature-256 controllata con la chiave segreta di una delle app
// (META_IG_APP_SECRET per CS Direct Connect, META_FB_APP_SECRET per CS Chat Connect);
// ogni messaggio diventa una riga di `eventi` (fonte instagram | messenger, tipo messaggio_ricevuto).
// Il cervello per ora legge solo le mail: questi eventi restano in attesa finché non li gestisce.
// I messaggi vanno anche nelle conversazioni (social_conversazioni / social_messaggi), echo comprese:
// le risposte date da Meta Business Suite o dall'app compaiono come nostre.
// Va pubblicata con --no-verify-jwt.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { salvaMessaggio } from '../_shared/social.ts';

const VERIFY = Deno.env.get('META_WEBHOOK_VERIFY_TOKEN') || '';
const SEGRETI = ['META_IG_APP_SECRET', 'META_FB_APP_SECRET'].map(k => Deno.env.get(k)).filter(Boolean) as string[];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function firmaValida(corpo: string, firma: string) {
  const atteso = firma.replace(/^sha256=/, '');
  for (const s of SEGRETI) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(corpo)));
    const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex === atteso) return true;
  }
  return false;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && VERIFY && url.searchParams.get('hub.verify_token') === VERIFY) {
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const corpo = await req.text();
  if (!(await firmaValida(corpo, req.headers.get('x-hub-signature-256') || ''))) return new Response('Firma non valida', { status: 401 });

  let body: Row;
  try { body = JSON.parse(corpo); } catch { return new Response('JSON non valido', { status: 400 }); }
  const fonte = body.object === 'instagram' ? 'instagram' : body.object === 'page' ? 'messenger' : null;
  if (!fonte) return new Response('ok');

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const righe: Row[] = [];
  const { data: conti } = await db.from('social_account').select('id, account_id').eq('piattaforma', fonte);
  const contoDi = new Map((conti || []).map(c => [String(c.account_id), c.id]));
  for (const entry of body.entry || []) {
    for (const m of entry.messaging || []) {
      if (!m.message) continue;
      const nostro = !!m.message.is_echo;
      const conto = contoDi.get(String(entry.id));
      const cliente = String(nostro ? m.recipient?.id : m.sender?.id);
      if (conto && cliente) {
        await salvaMessaggio(db, conto, cliente, {
          mid: m.message.mid || null, direzione: nostro ? 'out' : 'in', testo: m.message.text || '',
          allegati: m.message.attachments || [], at: new Date(m.timestamp || Date.now()).toISOString(),
        }).catch(e => console.error('meta-webhook conversazione', e.message));
      }
      if (nostro) continue;   // le nostre risposte tornano come echo: negli eventi solo i messaggi dei clienti
      righe.push({
        fonte, account: String(entry.id), tipo: 'messaggio_ricevuto', id_esterno: m.message.mid || null,
        payload: { da: m.sender?.id, a: m.recipient?.id, testo: m.message.text || '', allegati: m.message.attachments || [], at: m.timestamp },
      });
    }
    for (const c of entry.changes || []) {   // commenti Instagram
      if (c.field !== 'comments' || !c.value?.id) continue;
      righe.push({
        fonte, account: String(entry.id), tipo: 'commento_ricevuto', id_esterno: String(c.value.id),
        payload: { da: c.value.from?.id, username: c.value.from?.username, testo: c.value.text || '', media: c.value.media?.id },
      });
    }
  }
  if (righe.length) {
    const { error } = await db.from('eventi').upsert(righe, { onConflict: 'fonte,account,id_esterno', ignoreDuplicates: true });
    if (error) console.error('meta-webhook', error.message);
  }
  return new Response('ok');
});
