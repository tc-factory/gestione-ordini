// T&C Factory — Invio di mail dalla casella del negozio (SMTP Aruba, porta 465): risposte nella stessa
// conversazione del cliente o mail nuove. Copia nella cartella Inviata, riga "out" in mail_messaggi.

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

// Invio dalla casella del negozio: SMTP, copia in Inviata, riga "out" in mail_messaggi
async function invia(db: SupabaseClient, casella: Row, m: Invio) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca la password della casella ${casella.indirizzo}`);
  const messageId = `<${crypto.randomUUID()}@${casella.indirizzo.split('@')[1]}>`;

  const raw: Uint8Array = await new MailComposer({
    from: { name: casella.nome, address: casella.indirizzo },
    to: m.aNome ? { name: m.aNome, address: m.a } : m.a,
    subject: m.oggetto,
    text: m.testo,
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
    oggetto: m.oggetto, ricevuto_at: new Date().toISOString(), testo: m.testo,
  });
  return { copia_in_inviata: inviata };
}

// Risposta nella stessa conversazione del cliente
export function inviaRisposta(db: SupabaseClient, casella: Row, mail: Row, testo: string) {
  const oggetto = /^\s*(re|r|aw|sv)\s*:/i.test(mail.oggetto || '') ? mail.oggetto : `Re: ${mail.oggetto || ''}`.trim();
  const riferimenti = [mail.riferimenti, mail.message_id].filter(Boolean).join(' ');
  return invia(db, casella, { a: mail.da_email, aNome: mail.da_nome, oggetto, testo, inReplyTo: mail.message_id, riferimenti });
}

// Mail nuova scritta da noi (es. avviso di giacenza)
export function inviaNuova(db: SupabaseClient, casella: Row, a: string, aNome: string | null, oggetto: string, testo: string) {
  return invia(db, casella, { a, aNome, oggetto, testo });
}
