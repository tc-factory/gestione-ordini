// T&C Factory — Invio di una risposta dalla casella che ha ricevuto la mail (SMTP Aruba, porta 465).
// Stessa conversazione del cliente, copia nella cartella Inviata, riga "out" in mail_messaggi.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { Imap, quota } from './imap.ts';
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
    const righe = (await imap.comando('LIST "" "*"', 15_000)).map(r => r.testo);
    const nome = (r: string) => r.match(/"([^"]+)"$/)?.[1] || r.split(' ').pop() || '';
    const riga = righe.find(r => /\\Sent\b/i.test(r)) || righe.find(r => /^(inbox[./])?(sent|inviata|posta inviata)/i.test(nome(r)));
    if (!riga) return false;
    await imap.append(nome(riga), raw);
    await imap.comando('LOGOUT', 3_000).catch(() => {});
    return true;
  } catch (e) {
    console.error('Copia in Inviata', e);
    return false;
  } finally {
    imap.chiudi();
  }
}

export async function inviaRisposta(db: SupabaseClient, casella: Row, mail: Row, testo: string) {
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) throw new Error(`Manca la password della casella ${casella.indirizzo}`);

  const oggetto = /^\s*(re|r|aw|sv)\s*:/i.test(mail.oggetto || '') ? mail.oggetto : `Re: ${mail.oggetto || ''}`.trim();
  const messageId = `<${crypto.randomUUID()}@${casella.indirizzo.split('@')[1]}>`;
  const riferimenti = [mail.riferimenti, mail.message_id].filter(Boolean).join(' ');

  const raw: Uint8Array = await new MailComposer({
    from: { name: casella.nome, address: casella.indirizzo },
    to: mail.da_nome ? { name: mail.da_nome, address: mail.da_email } : mail.da_email,
    subject: oggetto,
    text: testo,
    messageId,
    inReplyTo: mail.message_id || undefined,
    references: riferimenti || undefined,
  }).compile().build();

  const smtp = nodemailer.createTransport({
    host: casella.smtp_host, port: 465, secure: true,
    auth: { user: casella.indirizzo, pass },
  });
  await smtp.sendMail({ envelope: { from: casella.indirizzo, to: mail.da_email }, raw });

  const inviata = await copiaInInviata(casella.imap_host, casella.indirizzo, pass, raw);

  await db.from('mail_messaggi').insert({
    casella_id: casella.id, direzione: 'out', message_id: messageId, in_reply_to: mail.message_id,
    riferimenti: riferimenti || null, da_email: casella.indirizzo, da_nome: casella.nome, a: mail.da_email,
    oggetto, ricevuto_at: new Date().toISOString(), testo,
  });
  return { copia_in_inviata: inviata };
}
