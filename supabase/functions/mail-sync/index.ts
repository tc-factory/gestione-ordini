// T&C Factory — Lettura delle caselle email Aruba (Centro di controllo, fase 2)
//
// Per ogni casella attiva in mail_caselle:
//   1. si collega in IMAP (imaps.aruba.it:993) con la password MAIL_PASSWORD_<ID>
//   2. legge le mail nuove della posta in arrivo: alla prima volta quelle arrivate
//      da attiva_dal, poi solo quelle con UID maggiore dell'ultimo letto
//   3. le salva in mail_messaggi; quelle scritte da persone diventano `eventi` per il cervello
//
//   4. legge le intestazioni della posta inviata: le risposte date dal programma di posta
//      finiscono in mail_messaggi come "out" e _tc_mail_risposte_chiudi chiude i task collegati
//
// Solo lettura: la casella si apre con EXAMINE e il contenuto con BODY.PEEK, quindi le mail
// non vengono segnate come lette né spostate.
//
// Chi la può chiamare: il cron del database ogni 2 minuti (x-sync-key, stessa
// chiave di shopify-sync: SHOPIFY_SYNC_KEY) oppure un admin collegato.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2';
import { Imap, cartellaInviata, quota } from '../_shared/imap.ts';

const MAX_PER_GIRO = 15;          // mail per casella a ogni giro: le altre al giro dopo
const MAX_INVIATE_PER_GIRO = 100; // solo intestazioni: alla prima lettura recupera tutte le risposte già date
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
  inviata_uidvalidity: number | null; inviata_ultimo_uid: number | null;
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

// Modulo contatti del sito: Shopify inoltra il messaggio del cliente, il suo indirizzo è nel Reply-To
const isModuloContatti = (from: string, oggetto: string) =>
  /@shopify\.com$/i.test(from) && /(messaggio cliente|customer message|mensaje de cliente|contact form)/i.test(oggetto);

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

const MESI = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const daHtml = (html: string) => html
  .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').trim();

type Meta = { uid: number; arrivata: Date; size: number; intestazioni: Uint8Array };

// Date, dimensione e intestazioni delle mail: il contenuto si scarica solo per quelle di persone
async function elencoMail(imap: Imap, uids: number[]): Promise<Meta[]> {
  const risposte = await imap.comando(`UID FETCH ${uids.join(',')} (UID INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])`, 40_000, 'elenco mail nuove');
  return risposte.flatMap(r => {
    const uid = r.testo.match(/\bUID (\d+)/)?.[1];
    if (!uid || !r.literal[0]) return [];
    const data = r.testo.match(/INTERNALDATE "([^"]+)"/)?.[1];
    return [{
      uid: Number(uid),
      arrivata: data ? new Date(data.trim().replace(/^(\d+)-(\w+)-(\d+) /, '$1 $2 $3 ')) : new Date(),
      size: Number(r.testo.match(/RFC822\.SIZE (\d+)/)?.[1]) || 0,
      intestazioni: r.literal[0],
    }];
  }).sort((a, b) => a.uid - b.uid);
}

// Al massimo 2 MB: oltre, gli allegati restano fuori ma il testo c'è
async function scaricaSorgente(imap: Imap, m: Meta): Promise<Uint8Array | null> {
  const risposte = await imap.comando(`UID FETCH ${m.uid} (BODY.PEEK[]<0.${MAX_SORGENTE}>)`, 40_000, `scaricamento mail ${m.uid}`);
  return risposte.find(r => r.literal.length)?.literal[0] || null;
}

// deno-lint-ignore no-explicit-any
async function decodifica(source: Uint8Array): Promise<any> {
  const p = await PostalMime.parse(source);
  return {
    references: p.references,
    text: p.text?.trim() ? p.text : (p.html ? daHtml(p.html) : ''),
    attachments: (p.attachments || []).filter(a => a.disposition !== 'inline')
      .map(a => ({ filename: a.filename, contentType: a.mimeType, size: (a.content as ArrayBuffer)?.byteLength || 0 })),
  };
}

// ── Posta inviata ──

// Solo intestazioni: per capire a quale mail si è risposto non serve il testo.
async function syncInviata(db: SupabaseClient, imap: Imap, c: Casella, deadline: number) {
  const cartella = await cartellaInviata(imap);
  if (!cartella) throw new Error('cartella non trovata');

  const aperta = (await imap.comando(`EXAMINE ${quota(cartella)}`, 20_000, 'apertura posta inviata')).map(r => r.testo).join('\n');
  const uidvalidity = Number(aperta.match(/UIDVALIDITY (\d+)/)?.[1]) || null;
  const uidNext = Number(aperta.match(/UIDNEXT (\d+)/)?.[1]) || 1;
  const ripartenza = !c.inviata_ultimo_uid || c.inviata_uidvalidity !== uidvalidity;
  let ultimoUid = ripartenza ? 0 : c.inviata_ultimo_uid!;

  const dal = new Date(c.attiva_dal);
  const criterio = ripartenza ? `SINCE ${dal.getUTCDate()}-${MESI[dal.getUTCMonth()]}-${dal.getUTCFullYear()}` : `UID ${ultimoUid + 1}:*`;
  const trovate = await imap.comando(`UID SEARCH ${criterio}`, 20_000, 'ricerca posta inviata');
  const uids = (trovate.find(r => r.testo.startsWith('* SEARCH'))?.testo.match(/\d+/g) || []).map(Number)
    .filter(u => u > ultimoUid).sort((a, b) => a - b).slice(0, MAX_INVIATE_PER_GIRO);

  if (!uids.length && ripartenza) ultimoUid = Math.max(0, uidNext - 1);

  let salvate = 0;
  for (const msg of uids.length ? await elencoMail(imap, uids) : []) {
    if (Date.now() > deadline) break;
    if (msg.arrivata >= dal) {
      const env = await PostalMime.parse(msg.intestazioni);
      const destinatari = [...(env.to || []), ...(env.cc || [])].flatMap(t => t.address ? [t.address.toLowerCase()] : []);
      // Senza uid: gli UID di questa cartella si sovrappongono a quelli della posta in arrivo.
      // Le risposte mandate da CS sono già salvate: il Message-ID uguale le fa saltare (23505).
      const { error } = await db.from('mail_messaggi').insert({
        casella_id: c.id,
        direzione: 'out',
        message_id: env.messageId || `<inviata-${uidvalidity}-${msg.uid}@cs>`,
        in_reply_to: env.inReplyTo || null,
        riferimenti: env.references || null,
        da_email: c.indirizzo,
        da_nome: c.nome,
        a: destinatari.join(', ') || null,
        oggetto: env.subject || null,
        ricevuto_at: (env.date && !isNaN(new Date(env.date).getTime()) ? new Date(env.date) : msg.arrivata).toISOString(),
      });
      if (error && error.code !== '23505') throw new Error(`salvataggio: ${error.message}`);
      if (!error) salvate++;
    }
    ultimoUid = Math.max(ultimoUid, msg.uid);
  }
  await db.from('mail_caselle').update({ inviata_uidvalidity: uidvalidity, inviata_ultimo_uid: ultimoUid || null }).eq('id', c.id);
  return salvate;
}

// ── Una casella ──

async function syncCasella(db: SupabaseClient, c: Casella, deadline: number) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${c.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca il secret MAIL_PASSWORD_${c.id.toUpperCase()}`);

  const imap = new Imap();
  let inviate = 0, erroreInviata: string | null = null;
  let salvate = 0, perCervello = 0, ultimoUid = c.ultimo_uid || 0, uidvalidity = c.uidvalidity;
  try {
    await imap.apri(c.imap_host);
    await imap.comando(`LOGIN ${quota(c.indirizzo)} ${quota(pass)}`, 20_000, 'LOGIN').catch((e: Error) => {
      throw new Error(/LOGIN:/.test(e.message) ? `Accesso rifiutato da Aruba (${e.message.replace(/^.*LOGIN:\s*/, '').slice(0, 120)})` : e.message);
    });

    const aperta = (await imap.comando('EXAMINE INBOX', 20_000)).map(r => r.testo).join('\n');
    const validity = Number(aperta.match(/UIDVALIDITY (\d+)/)?.[1]) || null;
    const uidNext = Number(aperta.match(/UIDNEXT (\d+)/)?.[1]) || 1;
    const ripartenza = !c.ultimo_uid || (c.uidvalidity && c.uidvalidity !== validity);
    uidvalidity = validity;
    if (ripartenza) ultimoUid = 0;

    const dal = new Date(c.attiva_dal);
    const criterio = ripartenza ? `SINCE ${dal.getUTCDate()}-${MESI[dal.getUTCMonth()]}-${dal.getUTCFullYear()}` : `UID ${ultimoUid + 1}:*`;
    const trovate = await imap.comando(`UID SEARCH ${criterio}`, 20_000, 'ricerca');
    const uids = (trovate.find(r => r.testo.startsWith('* SEARCH'))?.testo.match(/\d+/g) || []).map(Number)
      .filter(u => u > ultimoUid).sort((a, b) => a - b).slice(0, MAX_PER_GIRO);

    // Prima volta senza mail nuove: si parte dall'ultima mail già presente
    if (!uids.length && ripartenza) ultimoUid = Math.max(0, uidNext - 1);

    const meta = uids.length ? await elencoMail(imap, uids) : [];

    for (const msg of meta) {
      if (Date.now() > deadline) break;
      const arrivata = msg.arrivata;
      if (arrivata < dal) { ultimoUid = Math.max(ultimoUid, msg.uid); continue; }   // SINCE è a giorni interi

      const env = await PostalMime.parse(msg.intestazioni);
      const modulo = isModuloContatti(env.from?.address || '', env.subject || '');
      const from = (modulo && env.replyTo?.[0]) || env.from || {} as { address?: string; name?: string };
      const automatica = !modulo && isAutomatica(mappaIntestazioni(msg.intestazioni), from.address || '', c);

      // Mail illeggibile: si salva con una nota e diventa comunque un task
      let motivoIlleggibile = '';
      const parsed = automatica ? null : await (async () => {
        const source = await scaricaSorgente(imap, msg);
        return source ? await decodifica(source) : null;
      })().catch((e) => {
        console.error('Mail illeggibile', c.id, msg.uid, e);
        motivoIlleggibile = e instanceof Error ? e.message : String(e);
        return null;
      });

      const testoPieno = (parsed?.text || '').trim();
      const row = {
        casella_id: c.id,
        direzione: 'in',
        uid: msg.uid,
        message_id: env.messageId || null,
        in_reply_to: env.inReplyTo || null,
        riferimenti: parsed?.references || env.references || null,
        da_email: from.address?.toLowerCase() || null,
        da_nome: from.name || null,
        a: (env.to || []).map(t => t.name ? `${t.name} <${t.address}>` : t.address).join(', ') || null,
        oggetto: env.subject || null,
        ricevuto_at: (env.date && !isNaN(new Date(env.date).getTime()) ? new Date(env.date) : arrivata).toISOString(),
        testo: motivoIlleggibile ? `(Testo non letto da CS: ${motivoIlleggibile}. Apri la mail nella casella.)`
          : testoPieno ? (senzaCitazione(testoPieno) || testoPieno).slice(0, MAX_TESTO) : null,
        // deno-lint-ignore no-explicit-any
        allegati: (parsed?.attachments || []).map((a: any) => ({ nome: a.filename || 'allegato', tipo: a.contentType, dimensione: a.size })),
        automatica,
      };

      const { data: ins, error } = await db.from('mail_messaggi')
        .upsert(row, { onConflict: 'casella_id,uid', ignoreDuplicates: true }).select('id');
      // 23505: stesso Message-ID già salvato (es. copia a se stessi di una risposta): non è una mail nuova
      if (error && error.code !== '23505') throw new Error(`Salvataggio mail: ${error.message}`);
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
      if (motivoIlleggibile) break;   // la connessione è da rifare: si riprende al giro dopo
    }
    if (ripartenza && meta.length && meta.every(m => m.arrivata < dal)) ultimoUid = Math.max(ultimoUid, uidNext - 1);

    // Un problema con la posta inviata non deve fermare la lettura delle mail ricevute
    try { inviate = await syncInviata(db, imap, c, deadline); }
    catch (e) { erroreInviata = `Posta inviata non letta: ${e instanceof Error ? e.message : e}`.slice(0, 500); }

    await imap.comando('LOGOUT', 3_000).catch(() => {});
  } finally {
    imap.chiudi();
  }

  await db.from('mail_caselle').update({
    uidvalidity, ultimo_uid: ultimoUid || null,
    ultimo_sync_at: new Date().toISOString(), ultimo_errore: erroreInviata,
  }).eq('id', c.id);
  return { casella: c.indirizzo, salvate, per_cervello: perCervello, inviate };
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

  let q = db.from('mail_caselle').select('id, indirizzo, nome, imap_host, attiva_dal, uidvalidity, ultimo_uid, inviata_uidvalidity, inviata_ultimo_uid').eq('attivo', true).order('nome');
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
