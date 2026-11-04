// T&C Factory — Lettura delle caselle email Aruba (Centro di controllo, fase 2)
//
// Per ogni casella attiva in mail_caselle:
//   1. si collega in IMAP (imaps.aruba.it:993) con la password MAIL_PASSWORD_<ID>
//   2. legge le mail nuove della posta in arrivo: alla prima volta quelle arrivate
//      da attiva_dal, poi solo quelle con UID maggiore dell'ultimo letto
//   3. le salva in mail_messaggi; quelle scritte da persone diventano `eventi` per il cervello
//
// Solo lettura: le mail non vengono segnate come lette né spostate (BODY.PEEK).
//
// Chi la può chiamare: il cron del database ogni 2 minuti (x-sync-key, stessa
// chiave di shopify-sync: SHOPIFY_SYNC_KEY) oppure un admin collegato.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import { simpleParser } from 'npm:mailparser@3';

const MAX_PER_GIRO = 15;          // mail per casella a ogni giro: le altre al giro dopo
const MAX_SORGENTE = 2_000_000;   // oltre questa dimensione si scaricano solo intestazioni e testo, non gli allegati
const MAX_TESTO = 20_000;
const TIME_BUDGET_MS = 110_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

type Casella = {
  id: string; indirizzo: string; nome: string; imap_host: string;
  attiva_dal: string; uidvalidity: number | null; ultimo_uid: number | null;
};

// ── Mail automatiche: non servono al cervello ──

// Intestazioni grezze → mappa nome (minuscolo) → valore
function mappaIntestazioni(raw: Uint8Array | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  const testo = new TextDecoder().decode(raw).replace(/\r?\n[ \t]+/g, ' ');
  for (const riga of testo.split(/\r?\n/)) {
    const i = riga.indexOf(':');
    if (i > 0) map.set(riga.slice(0, i).trim().toLowerCase(), riga.slice(i + 1).trim());
  }
  return map;
}

function isAutomatica(h: Map<string, string>, from: string, casella: Casella): boolean {
  const get = (k: string) => (h.get(k) || '').toLowerCase();
  from = from.toLowerCase();
  if (get('auto-submitted') && get('auto-submitted') !== 'no') return true;
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(get('precedence'))) return true;
  if (h.has('list-unsubscribe') || h.has('list-id') || h.has('x-autoreply') || h.has('x-autorespond')) return true;
  if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce[s]?|comunicazioni)[@+.-]/.test(from)) return true;
  if (from === casella.indirizzo.toLowerCase()) return true;
  if (/(^|\.)(shopify\.com|facebookmail\.com|paypal\.[a-z.]+|stripe\.com|google\.com|amazonses\.com|aruba\.it)$/.test(from.split('@')[1] || '')) return true;
  return false;
}

// Toglie la parte citata delle risposte ("Il … ha scritto:", righe con ">")
function senzaCitazione(testo: string): string {
  const righe = testo.replace(/\r\n/g, '\n').split('\n');
  const stop = righe.findIndex(r =>
    /^\s*(Il|On|Le|El|Am)\s.+(ha scritto|wrote|a écrit|escribió|schrieb)\s*:\s*$/i.test(r)
    || /^\s*-{2,}\s*(Messaggio originale|Original Message|Messaggio inoltrato|Forwarded message)/i.test(r)
    || /^\s*(Da|From):\s.+/i.test(r) && righe.slice(0, righe.indexOf(r)).some(x => x.trim()));
  const tenute = (stop > 0 ? righe.slice(0, stop) : righe).filter(r => !/^\s*>/.test(r));
  return tenute.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Lettura di una mail ──

// Si scarica la sorgente solo delle mail scritte da persone (al massimo 2 MB: oltre, gli allegati
// restano fuori). Solo letture a flusso: fetchOne e bodyStructure restano appesi con Aruba.
// deno-lint-ignore no-explicit-any
async function leggiSorgente(client: ImapFlow, m: Meta): Promise<any | null> {
  let source: Uint8Array | null = null;
  const query = m.size <= MAX_SORGENTE ? { uid: true, source: true } : { uid: true, source: { start: 0, maxLength: MAX_SORGENTE } };
  // deno-lint-ignore no-explicit-any
  for await (const f of client.fetch([m.uid], query as any, { uid: true })) source = f.source as Uint8Array;
  if (!source) return null;
  return await simpleParser(source, { skipImageLinks: true, skipTextLinks: true });
}

// deno-lint-ignore no-explicit-any
type Meta = { uid: number; arrivata: Date; size: number; envelope: any; headers: Map<string, string> };

const HEADER_AUTO = ['auto-submitted', 'precedence', 'list-unsubscribe', 'list-id', 'x-autoreply', 'x-autorespond'];

// ── Una casella ──

async function syncCasella(db: SupabaseClient, c: Casella, deadline: number) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${c.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca il secret MAIL_PASSWORD_${c.id.toUpperCase()}`);

  const client = new ImapFlow({
    host: c.imap_host, port: 993, secure: true,
    auth: { user: c.indirizzo, pass },
    logger: false, emitLogs: false,
  });
  await client.connect().catch((e: Error & { responseText?: string }) => {
    throw new Error(/auth/i.test(e.message + (e.responseText || '')) ? 'Accesso rifiutato da Aruba: password sbagliata?' : `IMAP: ${e.message}`);
  });

  let salvate = 0, perCervello = 0, ultimoUid = c.ultimo_uid || 0, uidvalidity = c.uidvalidity;
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // deno-lint-ignore no-explicit-any
      const mb = client.mailbox as any;
      const validity = Number(mb.uidValidity);
      const ripartenza = !c.ultimo_uid || (c.uidvalidity && c.uidvalidity !== validity);
      uidvalidity = validity;
      if (ripartenza) ultimoUid = 0;

      const dal = new Date(c.attiva_dal);
      let uids: number[] = ripartenza
        ? await client.search({ since: dal }, { uid: true }) || []
        : await client.search({ uid: `${ultimoUid + 1}:*` }, { uid: true }) || [];
      uids = uids.filter(u => u > ultimoUid).sort((a, b) => a - b).slice(0, MAX_PER_GIRO);

      // Prima volta senza mail nuove: si parte dall'ultima mail già presente
      if (!uids.length && ripartenza) ultimoUid = Math.max(0, Number(mb.uidNext || 1) - 1);

      // Prima solo data e dimensione: si scarica il contenuto solo di quello che serve
      const meta: Meta[] = [];
      if (uids.length) for await (const m of client.fetch(uids, { uid: true, internalDate: true, size: true, envelope: true, headers: HEADER_AUTO }, { uid: true })) {
        meta.push({ uid: m.uid, arrivata: m.internalDate ? new Date(m.internalDate) : new Date(), size: Number(m.size) || 0,
                    envelope: m.envelope, headers: mappaIntestazioni(m.headers as Uint8Array) });
      }
      meta.sort((a, b) => a.uid - b.uid);

      for (const msg of meta) {
        if (Date.now() > deadline) break;
        const arrivata = msg.arrivata;
        if (arrivata < dal) { ultimoUid = Math.max(ultimoUid, msg.uid); continue; }   // "since" è a giorni interi

        const env = msg.envelope || {};
        const from = env.from?.[0] || {};
        const automatica = isAutomatica(msg.headers, from.address || '', c);
        const parsed = automatica ? null : await leggiSorgente(client, msg);
        const testoPieno = (parsed?.text || '').trim();
        const row = {
          casella_id: c.id,
          direzione: 'in',
          uid: msg.uid,
          message_id: env.messageId || parsed?.messageId || null,
          in_reply_to: env.inReplyTo || parsed?.inReplyTo || null,
          riferimenti: parsed ? (Array.isArray(parsed.references) ? parsed.references.join(' ') : (parsed.references || null)) : null,
          da_email: from.address?.toLowerCase() || null,
          da_nome: from.name || null,
          // deno-lint-ignore no-explicit-any
          a: (env.to || []).map((t: any) => t.name ? `${t.name} <${t.address}>` : t.address).join(', ') || null,
          oggetto: env.subject || parsed?.subject || null,
          ricevuto_at: (env.date ? new Date(env.date) : arrivata).toISOString(),
          testo: testoPieno ? (senzaCitazione(testoPieno) || testoPieno).slice(0, MAX_TESTO) : null,
          // deno-lint-ignore no-explicit-any
          allegati: (parsed?.attachments || []).filter((a: any) => !a.related)
            // deno-lint-ignore no-explicit-any
            .map((a: any) => ({ nome: a.filename || 'allegato', tipo: a.contentType, dimensione: a.size })),
          automatica,
        };

        const { data: ins, error } = await db.from('mail_messaggi')
          .upsert(row, { onConflict: 'casella_id,uid', ignoreDuplicates: true }).select('id');
        if (error) throw new Error(`Salvataggio mail: ${error.message}`);
        const nuova = ins?.[0]?.id;
        if (nuova) {
          salvate++;
          if (!automatica) {
            perCervello++;
            await db.from('eventi').upsert({
              fonte: 'mail', account: c.id, tipo: 'mail_ricevuta', id_esterno: row.message_id || `uid:${msg.uid}`,
              payload: { mail_id: nuova, da: row.da_email, nome: row.da_nome, oggetto: row.oggetto },
            }, { onConflict: 'fonte,account,id_esterno', ignoreDuplicates: true });
          }
        }
        ultimoUid = Math.max(ultimoUid, msg.uid);
        // Il punto raggiunto si salva subito: se la funzione si interrompe, si riparte da qui
        await db.from('mail_caselle').update({ uidvalidity, ultimo_uid: ultimoUid }).eq('id', c.id);
      }
      if (ripartenza && meta.length && meta.every(m => m.arrivata < dal)) ultimoUid = Math.max(ultimoUid, Number(mb.uidNext || 1) - 1);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  await db.from('mail_caselle').update({
    uidvalidity, ultimo_uid: ultimoUid || null,
    ultimo_sync_at: new Date().toISOString(), ultimo_errore: null,
  }).eq('id', c.id);
  return { casella: c.indirizzo, salvate, per_cervello: perCervello };
}

// ── Ingresso ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  const fromCron = !!syncKey && req.headers.get('x-sync-key') === syncKey;
  if (!fromCron) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await db.auth.getUser(jwt);
    if (!caller?.user) return fail('Accesso richiesto', 401);
    const { data: me } = await db.from('app_users').select('is_admin').eq('auth_id', caller.user.id).maybeSingle();
    if (!me?.is_admin) return fail('Solo gli admin possono controllare le caselle', 403);
  }

  let body: { casella?: string } = {};
  try { body = await req.json(); } catch { /* corpo vuoto */ }

  let q = db.from('mail_caselle').select('id, indirizzo, nome, imap_host, attiva_dal, uidvalidity, ultimo_uid').eq('attivo', true).order('nome');
  if (body.casella) q = q.eq('id', body.casella);
  const { data: caselle, error } = await q;
  if (error) return fail(`Caselle non leggibili: ${error.message}`, 500);

  // Le caselle si controllano in parallelo: ognuna ha la sua connessione
  const deadline = Date.now() + TIME_BUDGET_MS;
  const risultati = await Promise.all((caselle as Casella[]).map(async (c) => {
    try { return await syncCasella(db, c, deadline); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.from('mail_caselle').update({ ultimo_errore: msg.slice(0, 500), ultimo_sync_at: new Date().toISOString() }).eq('id', c.id);
      return { casella: c.indirizzo, errore: msg };
    }
  }));
  return reply({ success: true, risultati });
});
