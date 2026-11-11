// T&C Factory — Invio di mail dalla casella del negozio (SMTP Aruba, porta 465): risposte nella stessa
// conversazione del cliente o mail nuove. Copia nella cartella Inviata, riga "out" in mail_messaggi.
//
// Firma:
//   'negozio' (predefinita: mail che partono da sole) → firma neutra della casella (mail_firme_negozio,
//             o nome del negozio e sito): prende il posto della riga col nome del negozio in fondo al testo
//   { persona } (mail scritte da qualcuno) → il testo ha già la firma della persona, scritta dalla pagina;
//             qui si aggiunge solo la sua immagine, se ne ha una
// Con un'immagine la mail parte anche in HTML, con l'immagine incorporata (cid).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { Imap, cartellaInviata, quota } from './imap.ts';
import nodemailer from 'npm:nodemailer@6';
import MailComposer from 'npm:nodemailer@6/lib/mail-composer/index.js';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Copia in Inviata: se non riesce la mail è comunque partita
async function copiaInInviata(host: string, user: string, pass: string, raw: Uint8Array) {
  const imap = new Imap();
  try {
    await imap.apri(host);
    await imap.comando(`LOGIN ${quota(user)} ${quota(pass)}`, 15_000, 'LOGIN');
    const cartella = await cartellaInviata(imap);
    if (!cartella) return false;
    await imap.append(cartella, raw);
    await imap.comando('LOGOUT', 3_000).catch(() => {});
    return true;
  } catch (e) {
    console.error('Copia in Inviata', e);
    return false;
  } finally {
    imap.chiudi();
  }
}

type Invio = { a: string; aNome?: string | null; oggetto: string; testo: string; inReplyTo?: string | null; riferimenti?: string | null };
export type Firma = 'negozio' | { persona: string };

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// La firma neutra va al posto del nome del negozio messo in fondo (cervello, avvisi), o si aggiunge
export function conFirmaNegozio(testo: string, firma: string, nomiNegozio: string[]): string {
  const t = testo.replace(/\s+$/, '');
  if (!firma || t.endsWith(firma)) return t;
  const righe = t.split('\n');
  const nomi = nomiNegozio.filter(Boolean).map(n => n.trim().toLowerCase());
  if (righe.length > 1 && nomi.includes(righe[righe.length - 1].trim().toLowerCase())) {
    righe[righe.length - 1] = firma;
    return righe.join('\n');
  }
  return t + (/[,:]$/.test(t) ? '\n' : '\n\n') + firma;
}

// Ai clienti non si nomina mai T&C Factory: solo il negozio. Una riga che è solo quel nome si toglie,
// altrove diventa il nome del negozio. "Box Factory Lab" non c'entra (serve la T e la C).
const TC_FACTORY = /\b(?:t\s*(?:&|&amp;|e|and)?\s*c\.?|tec|ti\s*e\s*ci)\s*factory(?:\s*s\.?\s*r\.?\s*l\.?)?\b|\btcfactory\b/gi;
export function senzaTcFactory(testo: string, negozio: string): string {
  return testo.split('\n')
    .filter(r => !(r.search(TC_FACTORY) >= 0 && !r.replace(TC_FACTORY, '').replace(/[\s.,;:!\-–—]/g, '')))
    .map(r => r.replace(TC_FACTORY, negozio))
    .join('\n');
}

type Composta = { testo: string; html?: string; immagine?: { content: Uint8Array; contentType: string; filename: string } };

async function componi(db: SupabaseClient, casella: Row, testoDato: string, firma: Firma): Promise<Composta> {
  let testo = testoDato;
  let immagine: string | null = null, larghezza = 220;
  if (firma === 'negozio') {
    const { data: f } = await db.from('mail_firme_negozio').select('testo, immagine, larghezza').eq('casella_id', casella.id).maybeSingle();
    const { data: con } = casella.store_id
      ? await db.from('negozi_conoscenza').select('campi').eq('store_id', casella.store_id).maybeSingle()
      : { data: null };
    const sito = `www.${String(casella.indirizzo).split('@')[1]}`;
    const testoFirma = (f?.testo || '').trim() || (f?.immagine ? '' : `${casella.nome}\n${sito}`);
    const nomi = [casella.nome, con?.campi?.['assistenza.firma']];
    testo = testoFirma ? conFirmaNegozio(testo, testoFirma, nomi) : testo;
    immagine = f?.immagine || null;
    larghezza = f?.larghezza || 220;
  } else {
    const { data: f } = await db.from('mail_firme').select('testo, immagine, larghezza').eq('nickname', firma.persona).eq('casella_id', casella.id).maybeSingle();
    // L'immagine solo se in fondo c'è davvero la sua firma (o se la firma è soltanto l'immagine)
    if (f?.immagine && (!f.testo?.trim() || testo.trimEnd().endsWith(f.testo.trim()))) {
      immagine = f.immagine;
      larghezza = f.larghezza || 220;
    }
  }
  testo = senzaTcFactory(testo, casella.nome);
  if (!immagine) return { testo };

  const { data: file, error } = await db.storage.from('mail-firme').download(immagine);
  if (error || !file) { console.error('Immagine della firma non letta', immagine, error); return { testo }; }
  const content = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || (/\.png$/i.test(immagine) ? 'image/png' : /\.gif$/i.test(immagine) ? 'image/gif' : 'image/jpeg');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${escapeHtml(testo).replace(/\n/g, '<br>')}</div>`
    + `<img src="cid:firma@cs" alt="${escapeHtml(casella.nome)}" width="${larghezza}" style="display:block;width:${larghezza}px;max-width:100%;height:auto;margin-top:12px;border:0">`;
  return { testo, html, immagine: { content, contentType, filename: `firma.${contentType.split('/')[1] || 'png'}` } };
}

// Invio dalla casella del negozio: SMTP, copia in Inviata, riga "out" in mail_messaggi
async function invia(db: SupabaseClient, casella: Row, m: Invio, firma: Firma) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca la password della casella ${casella.indirizzo}`);
  const messageId = `<${crypto.randomUUID()}@${casella.indirizzo.split('@')[1]}>`;
  const c = await componi(db, casella, m.testo, firma);
  m = { ...m, oggetto: senzaTcFactory(m.oggetto, casella.nome) };

  const raw: Uint8Array = await new MailComposer({
    from: { name: casella.nome, address: casella.indirizzo },
    to: m.aNome ? { name: m.aNome, address: m.a } : m.a,
    subject: m.oggetto,
    text: c.testo,
    ...(c.html ? {
      html: c.html,
      attachments: [{ filename: c.immagine!.filename, content: c.immagine!.content, contentType: c.immagine!.contentType, cid: 'firma@cs', contentDisposition: 'inline' }],
    } : {}),
    messageId,
    inReplyTo: m.inReplyTo || undefined,
    references: m.riferimenti || undefined,
  }).compile().build();

  const smtp = nodemailer.createTransport({
    host: casella.smtp_host, port: 465, secure: true,
    auth: { user: casella.indirizzo, pass },
  });
  await smtp.sendMail({ envelope: { from: casella.indirizzo, to: m.a }, raw });

  const inviata = await copiaInInviata(casella.imap_host, casella.indirizzo, pass, raw);

  await db.from('mail_messaggi').insert({
    casella_id: casella.id, direzione: 'out', message_id: messageId, in_reply_to: m.inReplyTo || null,
    riferimenti: m.riferimenti || null, da_email: casella.indirizzo, da_nome: casella.nome, a: m.a,
    oggetto: m.oggetto, ricevuto_at: new Date().toISOString(), testo: c.testo,
  });
  return { copia_in_inviata: inviata, testo: c.testo };
}

// Risposta nella stessa conversazione del cliente
export function inviaRisposta(db: SupabaseClient, casella: Row, mail: Row, testo: string, firma: Firma = 'negozio') {
  const oggetto = /^\s*(re|r|aw|sv)\s*:/i.test(mail.oggetto || '') ? mail.oggetto : `Re: ${mail.oggetto || ''}`.trim();
  const riferimenti = [mail.riferimenti, mail.message_id].filter(Boolean).join(' ');
  return invia(db, casella, { a: mail.da_email, aNome: mail.da_nome, oggetto, testo, inReplyTo: mail.message_id, riferimenti }, firma);
}

// Mail nuova scritta da noi (es. avviso di giacenza)
export function inviaNuova(db: SupabaseClient, casella: Row, a: string, aNome: string | null, oggetto: string, testo: string, firma: Firma = 'negozio') {
  return invia(db, casella, { a, aNome, oggetto, testo }, firma);
}
