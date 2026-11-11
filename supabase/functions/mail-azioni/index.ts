// T&C Factory — Azioni sulle caselle Aruba dalla sezione Mail
//
//   azione 'sposta'   { casella }           sposta su Aruba le mail con cartella_voluta (archivio, cestino,
//                                            di nuovo in arrivo). Le chiama il cron _tc_mail_riordina
//                                            (x-sync-key) o la pagina Mail subito dopo il clic.
//   azione 'allegato' { mail_id, indice, nome }  scarica la mail dalla casella e restituisce l'allegato
//
// Le mail si ritrovano per Message-ID nella cartella dove stanno: gli UID cambiano a ogni spostamento.
// Senza Message-ID (es. gli avvisi di Aruba) si usa l'UID salvato all'arrivo, solo in Posta in arrivo
// e solo se mittente e data della mail a quell'UID sono quelli giusti.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import PostalMime from 'npm:postal-mime@2';
import { Imap, Cartelle, cartelleCasella, capacita, uidDaMessageId, quota } from '../_shared/imap.ts';

const MAX_PER_GIRO = 40;
const MAX_MAIL = 30_000_000;   // oltre questa dimensione l'allegato si apre dal programma di posta
const TIME_BUDGET_MS = 100_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function collega(casella: Row): Promise<Imap> {
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca la password della casella ${casella.indirizzo}`);
  const imap = new Imap();
  await imap.apri(casella.imap_host);
  await imap.comando(`LOGIN ${quota(casella.indirizzo)} ${quota(pass)}`, 20_000, 'LOGIN');
  return imap;
}

const nomeCartella = (c: Cartelle, id: string) => id === 'archivio' ? c.archivio : id === 'cestino' ? c.cestino : c.inbox;

// ── Spostamenti ──

async function sposta(db: SupabaseClient, casella: Row) {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const { data: righe } = await db.from('mail_messaggi')
    .select('id, message_id, uid, da_email, ricevuto_at, cartella, cartella_voluta, sposta_tentativi')
    .eq('casella_id', casella.id).not('cartella_voluta', 'is', null).lt('sposta_tentativi', 5)
    .order('ricevuto_at').limit(MAX_PER_GIRO);
  const daFare = (righe || []).filter((r: Row) => r.cartella_voluta !== r.cartella);
  // Già nella cartella giusta: basta togliere la richiesta
  const ferme = (righe || []).filter((r: Row) => r.cartella_voluta === r.cartella).map((r: Row) => r.id);
  if (ferme.length) await db.from('mail_messaggi').update({ cartella_voluta: null }).in('id', ferme);
  if (!daFare.length) return { spostate: 0 };

  let imap: Imap;
  try { imap = await collega(casella); }
  catch (e) { await segnaErrore(db, daFare, e); throw e; }
  let spostate = 0, soloGestionale = 0;
  try {
    const cartelle = await cartelleCasella(imap);
    const cap = await capacita(imap);
    const move = cap.includes('MOVE'), uidplus = cap.includes('UIDPLUS');

    // Una cartella d'origine alla volta: SELECT una volta sola
    const perOrigine = new Map<string, Row[]>();
    daFare.forEach((r: Row) => perOrigine.set(r.cartella, [...(perOrigine.get(r.cartella) || []), r]));

    for (const [origine, gruppo] of perOrigine) {
      await imap.comando(`SELECT ${quota(nomeCartella(cartelle, origine))}`, 20_000, `apertura ${origine}`);
      for (const r of gruppo) {
        if (Date.now() > deadline) break;
        const dest = nomeCartella(cartelle, r.cartella_voluta);
        try {
          const controllo = !r.message_id && origine === 'inbox' && r.uid ? await stessaMail(imap, r) : null;
          const uids = r.message_id ? await uidDaMessageId(imap, r.message_id) : controllo === true ? [r.uid] : [];
          if (uids.length) {
            const set = uids.join(',');
            if (move) await imap.comando(`UID MOVE ${set} ${quota(dest)}`, 30_000, 'spostamento');
            else {
              await imap.comando(`UID COPY ${set} ${quota(dest)}`, 30_000, 'copia');
              await imap.comando(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`, 15_000, 'segna eliminata');
              // Senza UIDPLUS non si fa EXPUNGE: cancellerebbe anche le mail segnate da altri programmi
              if (uidplus) await imap.comando(`UID EXPUNGE ${set}`, 15_000, 'pulizia');
            }
            await db.from('mail_messaggi').update({ cartella: r.cartella_voluta, cartella_voluta: null, sposta_errore: null, sposta_tentativi: 0 }).eq('id', r.id);
            spostate++;
          } else {
            // Non c'è più nella casella (spostata o cancellata dal programma di posta): vale solo nel gestionale
            await db.from('mail_messaggi').update({
              cartella: r.cartella_voluta, cartella_voluta: null, sposta_tentativi: 0,
              sposta_errore: r.message_id ? 'Non trovata nella casella Aruba: spostata solo nel gestionale'
                : `Mail senza Message-ID${typeof controllo === 'string' ? ` (${controllo})` : ''}: spostata solo nel gestionale`,
            }).eq('id', r.id);
            soloGestionale++;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await db.from('mail_messaggi').update({ sposta_errore: msg.slice(0, 300), sposta_tentativi: (r.sposta_tentativi || 0) + 1 }).eq('id', r.id);
          if (/IMAP bloccato|Connessione IMAP chiusa/.test(msg)) throw e;   // connessione persa: si riprende al giro dopo
        }
      }
    }
    await imap.comando('LOGOUT', 3_000).catch(() => {});
  } catch (e) {
    await segnaErrore(db, daFare, e);
    throw e;
  } finally {
    imap.chiudi();
  }
  return { spostate, solo_gestionale: soloGestionale };
}

// La mail a quell'UID è proprio questa? Mittente uguale e arrivata entro un giorno
// true, oppure il motivo per cui non lo è
async function stessaMail(imap: Imap, r: Row): Promise<true | string> {
  const risp = await imap.comando(`UID FETCH ${Number(r.uid)} (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM)])`, 15_000, 'controllo mail senza Message-ID');
  const x = risp.find(y => / FETCH /.test(y.testo));
  if (!x) {
    // Diagnosi: c'è ancora, con un altro UID?
    const d = new Date(r.ricevuto_at);
    const mesi = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const imapData = (t: Date) => `${t.getUTCDate()}-${mesi[t.getUTCMonth()]}-${t.getUTCFullYear()}`;
    const cerca = await imap.comando(`UID SEARCH FROM ${quota(String(r.da_email || ''))} SINCE ${imapData(new Date(d.getTime() - 86_400_000))} BEFORE ${imapData(new Date(d.getTime() + 2 * 86_400_000))}`, 20_000, 'ricerca per mittente');
    const altri = cerca.find(y => y.testo.startsWith('* SEARCH'))?.testo.match(/\d+/g) || [];
    return `UID ${r.uid} non più in Posta in arrivo; stesso mittente e giorno: ${altri.length ? 'UID ' + altri.join(',') : 'nessuna'}`;
  }
  const da = (new TextDecoder().decode(x.literal[0] || new Uint8Array()) + ' ' + x.testo).toLowerCase();
  const arrivata = Date.parse(x.testo.match(/INTERNALDATE "([^"]+)"/)?.[1]?.trim().replace(/^(\d)-/, '0$1-') || '');
  if (!r.da_email || !da.includes(String(r.da_email).toLowerCase())) return `a UID ${r.uid} c'è un altro mittente: ${da.replace(/\s+/g, ' ').slice(0, 120)}`;
  if (!Number.isFinite(arrivata) || Math.abs(arrivata - Date.parse(r.ricevuto_at)) >= 86_400_000) return `data diversa: ${x.testo.slice(0, 120)}`;
  return true;
}

// Problema della casella (accesso, cartelle): resta scritto sulle mail ancora da spostare, il cron riprova
async function segnaErrore(db: SupabaseClient, righe: Row[], e: unknown) {
  const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
  await db.from('mail_messaggi').update({ sposta_errore: msg }).in('id', righe.map(r => r.id)).not('cartella_voluta', 'is', null);
}

// ── Allegati ──

async function allegato(db: SupabaseClient, mailId: string, indice: number, nome: string | null) {
  const { data: mail } = await db.from('mail_messaggi').select('id, casella_id, uid, message_id, cartella, direzione').eq('id', mailId).maybeSingle();
  if (!mail) return fail('Mail non trovata', 404);
  if (mail.direzione !== 'in') return fail('Gli allegati delle mail inviate sono nella cartella Inviata della casella');
  const { data: casella } = await db.from('mail_caselle').select('*').eq('id', mail.casella_id).maybeSingle();
  if (!casella) return fail('Casella non trovata');

  const imap = await collega(casella);
  try {
    const cartelle = await cartelleCasella(imap);
    // Prima dove dovrebbe stare, poi nelle altre (il programma di posta può averla spostata)
    const ordine = [mail.cartella, ...['inbox', 'archivio', 'cestino'].filter(c => c !== mail.cartella)];
    let uid: number | null = null;
    for (const c of ordine) {
      await imap.comando(`EXAMINE ${quota(nomeCartella(cartelle, c))}`, 20_000, `apertura ${c}`);
      if (mail.message_id) uid = (await uidDaMessageId(imap, mail.message_id))[0] || null;
      else if (c === 'inbox' && mail.uid) uid = mail.uid;
      if (uid) break;
    }
    if (!uid) return fail('La mail non è più nella casella Aruba', 404);

    const info = await imap.comando(`UID FETCH ${uid} (RFC822.SIZE)`, 15_000, 'dimensione');
    const size = Number(info.map(r => r.testo).join(' ').match(/RFC822\.SIZE (\d+)/)?.[1]) || 0;
    if (size > MAX_MAIL) return fail('Mail troppo grande: apri l\'allegato dal programma di posta', 413);

    const r = await imap.comando(`UID FETCH ${uid} (BODY.PEEK[])`, 90_000, 'scaricamento mail');
    const sorgente = r.find(x => x.literal.length)?.literal[0];
    if (!sorgente) return fail('Mail non leggibile');
    await imap.comando('LOGOUT', 3_000).catch(() => {});

    const p = await PostalMime.parse(sorgente);
    const allegati = (p.attachments || []).filter(a => a.disposition !== 'inline');
    // Stesso nome e stessa posizione dell'elenco salvato; se l'elenco era parziale, basta il nome
    const a = (allegati[indice] && (!nome || allegati[indice].filename === nome) ? allegati[indice] : null)
      || (nome ? allegati.find(x => x.filename === nome) : null)
      || (p.attachments || []).find(x => nome && x.filename === nome);
    if (!a) return fail('Allegato non trovato nella mail', 404);

    const contenuto = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content as ArrayBuffer);
    return new Response(contenuto, {
      headers: { ...cors, 'Content-Type': 'application/octet-stream', 'X-Tipo': a.mimeType || '', 'Access-Control-Expose-Headers': 'X-Tipo' },
    });
  } finally {
    imap.chiudi();
  }
}

// ── Ingresso ──

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { azione?: string; casella?: string; mail_id?: string; indice?: number; nome?: string } = {};
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }

  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  const dalCron = !!syncKey && req.headers.get('x-sync-key') === syncKey;
  if (!dalCron) {
    const auth = req.headers.get('Authorization') || '';
    const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } },
    });
    const { data: puo } = await utente.rpc('app_vede_scheda', { p_scheda: 'mail' });
    if (puo !== true) return fail('Non hai accesso alle mail', 403);
  }

  try {
    if (body.azione === 'sposta') {
      if (!body.casella) return fail('Casella mancante');
      const { data: casella } = await db.from('mail_caselle').select('*').eq('id', body.casella).maybeSingle();
      if (!casella) return fail('Casella non trovata', 404);
      return reply({ success: true, ...(await sposta(db, casella)) });
    }
    if (body.azione === 'allegato') {
      if (dalCron) return fail('Non consentito', 403);
      if (!body.mail_id) return fail('Mail mancante');
      return await allegato(db, body.mail_id, Number(body.indice) || 0, body.nome || null);
    }
    return fail('Azione sconosciuta');
  } catch (e) {
    console.error('mail-azioni', body.azione, e);
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
});
