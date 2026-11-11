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

// Nelle firme non va mai un numero di telefono: le righe con numeri lunghi o parole da recapito si tolgono
const TELEFONO = /(\+|\b00)?\d[\d\s./()-]{6,}\d|\b(tel|telefono|cell|cellulare|whats\s?app|phone|fax)\b/i;
export const senzaTelefoni = (firma: string) => firma.split('\n').filter(r => !TELEFONO.test(r)).join('\n').trim();

// Nome della persona nella firma automatica (gli account condivisi non hanno nome)
const nomePersona = (nick: string) => /factory|^claude$/i.test(nick) ? '' : nick.charAt(0).toUpperCase() + nick.slice(1);

// Una riga della firma in HTML: la prima in grassetto, sito e mail cliccabili
function rigaFirma(r: string, i: number): string {
  const t = r.trim(), e = escapeHtml(t);
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return `<a href="${/^https?:/i.test(t) ? '' : 'https://'}${e}" style="color:#666666;text-decoration:none">${e.replace(/^https?:\/\//i, '')}</a>`;
  if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(t)) return `<a href="mailto:${e}" style="color:#666666;text-decoration:none">${e}</a>`;
  return i === 0 ? `<strong style="color:#111111;font-size:14px">${e}</strong>` : e;
}

// Firma in grafica: logo a sinistra, una riga sottile, poi nome, negozio e sito
function firmaHtml(righe: string[], conImmagine: boolean, larghezza: number, alt: string): string {
  const img = conImmagine
    ? `<td style="padding:0;vertical-align:middle"><img src="cid:firma@cs" alt="${escapeHtml(alt)}" width="${larghezza}" style="display:block;width:${larghezza}px;max-width:${larghezza}px;height:auto;border:0"></td>`
    : '';
  const testo = righe.length
    ? `<td style="vertical-align:middle;${conImmagine ? 'padding:0 0 0 16px;border-left:2px solid #e6e6e6;' : 'padding:0;'}font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#555555">${righe.map(rigaFirma).join('<br>')}</td>`
    : '';
  const separa = conImmagine && righe.length ? '<td style="width:16px;font-size:0;line-height:0">&nbsp;</td>' : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border-collapse:collapse"><tr>${img}${separa}${testo}</tr></table>`;
}

async function componi(db: SupabaseClient, casella: Row, testoDato: string, firma: Firma): Promise<Composta> {
  let testo = testoDato.replace(/\s+$/, '');
  const sito = `www.${String(casella.indirizzo).split('@')[1]}`;
  const { data: neg } = await db.from('mail_firme_negozio').select('testo, immagine, larghezza').eq('casella_id', casella.id).maybeSingle();

  let firmaTesto: string, immagine: string | null, larghezza: number;
  if (firma === 'negozio') {
    // Senza firma del negozio salvata: nome del negozio e sito
    firmaTesto = neg ? (neg.testo || '').trim() : `${casella.nome}\n${sito}`;
    if (neg && !firmaTesto && !neg.immagine) firmaTesto = `${casella.nome}\n${sito}`;
    const { data: con } = casella.store_id
      ? await db.from('negozi_conoscenza').select('campi').eq('store_id', casella.store_id).maybeSingle()
      : { data: null };
    if (firmaTesto) testo = conFirmaNegozio(testo, firmaTesto, [casella.nome, con?.campi?.['assistenza.firma']]);
    immagine = neg?.immagine || null;
    larghezza = neg?.larghezza || 160;
  } else {
    // La firma della persona l'ha già messa la pagina; senza una sua immagine va il logo del negozio
    const { data: f } = await db.from('mail_firme').select('testo, immagine, larghezza').eq('nickname', firma.persona).eq('casella_id', casella.id).maybeSingle();
    firmaTesto = f ? (f.testo || '').trim() : [nomePersona(firma.persona), casella.nome, sito].filter(Boolean).join('\n');
    immagine = f?.immagine || neg?.immagine || null;
    larghezza = (f?.immagine ? f.larghezza : neg?.larghezza) || 160;
  }

  // Firma senza telefoni e senza T&C Factory, anche se qualcuno li ha scritti.
  // La casella interna (info@tcfactory.it, mail ai fornitori) è T&C Factory: lì il nome resta.
  const pulisci = (t: string) => casella.interna ? t : senzaTcFactory(t, casella.nome);
  const firmaPulita = pulisci(senzaTelefoni(firmaTesto));
  if (firmaTesto && testo.endsWith(firmaTesto)) testo = testo.slice(0, testo.length - firmaTesto.length) + firmaPulita;
  testo = pulisci(testo).replace(/\s+$/, '');

  // La grafica solo se in fondo c'è la firma (o se la firma è soltanto l'immagine)
  const trovata = firmaPulita ? testo.endsWith(firmaPulita) : !!immagine;
  if (!trovata) return { testo };
  const corpo = firmaPulita ? testo.slice(0, testo.length - firmaPulita.length).replace(/\s+$/, '') : testo;
  const righe = firmaPulita ? firmaPulita.split('\n').map(r => r.trim()).filter(Boolean) : [];

  let allegato: Composta['immagine'];
  if (immagine) {
    const { data: file, error } = await db.storage.from('mail-firme').download(immagine);
    if (error || !file) console.error('Immagine della firma non letta', immagine, error);
    else {
      const contentType = file.type || (/\.png$/i.test(immagine) ? 'image/png' : /\.gif$/i.test(immagine) ? 'image/gif' : 'image/jpeg');
      allegato = { content: new Uint8Array(await file.arrayBuffer()), contentType, filename: `firma.${contentType.split('/')[1] || 'png'}` };
    }
  }
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222">${escapeHtml(corpo).replace(/\n/g, '<br>')}</div>`
    + firmaHtml(righe, !!allegato, larghezza, casella.nome);
  return { testo, html, immagine: allegato };
}

// Invio dalla casella del negozio: SMTP, copia in Inviata, riga "out" in mail_messaggi
async function invia(db: SupabaseClient, casella: Row, m: Invio, firma: Firma) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca la password della casella ${casella.indirizzo}`);
  const messageId = `<${crypto.randomUUID()}@${casella.indirizzo.split('@')[1]}>`;
  const c = await componi(db, casella, m.testo, firma);
  m = { ...m, oggetto: casella.interna ? m.oggetto : senzaTcFactory(m.oggetto, casella.nome) };

  const raw: Uint8Array = await new MailComposer({
    from: { name: casella.nome, address: casella.indirizzo },
    to: m.aNome ? { name: m.aNome, address: m.a } : m.a,
    subject: m.oggetto,
    text: c.testo,
    ...(c.html ? { html: c.html } : {}),
    ...(c.immagine ? {
      attachments: [{ filename: c.immagine.filename, content: c.immagine.content, contentType: c.immagine.contentType, cid: 'firma@cs', contentDisposition: 'inline' }],
    } : {}),
    messageId,
    inReplyTo: m.inReplyTo || undefined,
    references: m.riferimenti || undefined,
  }).compile().build();

  const smtp = nodemailer.createTransport({
    host: casella.smtp_host, port: 465, secure: true,
    auth: { user: casella.utente || casella.indirizzo, pass },   // utente: login diverso dall'indirizzo (info@tcfactory.it → riccardo@tcfactory.it)
  });
  await smtp.sendMail({ envelope: { from: casella.indirizzo, to: m.a }, raw });

  const inviata = await copiaInInviata(casella.imap_host, casella.utente || casella.indirizzo, pass, raw);

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
