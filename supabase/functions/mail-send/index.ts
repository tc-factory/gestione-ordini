// T&C Factory — Invio della risposta di un task (Centro di controllo, fase 2b)
//
// Una persona collegata approva la bozza dal task: la mail parte dalla casella che ha
// ricevuto il messaggio (SMTP Aruba, porta 465), nella stessa conversazione, e una copia
// va nella cartella Inviata. Il task viene completato a nome di chi ha inviato.
//
// Può inviare chi può lavorare il task: admin, l'assegnatario, o chiunque se è in coda comune.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ImapFlow } from 'npm:imapflow@1';
import nodemailer from 'npm:nodemailer@6';
import MailComposer from 'npm:nodemailer@6/lib/mail-composer/index.js';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// Copia in Inviata: se non riesce la mail è comunque partita
async function copiaInInviata(host: string, user: string, pass: string, raw: Uint8Array) {
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user, pass }, logger: false });
  const lavoro = (async () => {
    await client.connect();
    const cartelle = await client.list();
    const inviata = cartelle.find(c => c.specialUse === '\\Sent') || cartelle.find(c => /^(inbox[./])?(sent|inviata|posta inviata)/i.test(c.path));
    if (inviata) await client.append(inviata.path, raw, ['\\Seen']);
    return !!inviata;
  })();
  const limite = new Promise<boolean>(r => setTimeout(() => r(false), 15_000));
  const fatto = await Promise.race([lavoro, limite]).catch(() => false);
  client.logout().catch(() => {});
  return fatto;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const auth = req.headers.get('Authorization') || '';
  const { data: caller } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!caller?.user) return fail('Accesso richiesto', 401);
  const { data: me } = await db.from('app_users').select('nickname, is_admin').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail('Accesso riservato allo staff', 403);

  let body: { task_id?: string; testo?: string };
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }
  const testo = (body.testo || '').trim();
  if (!body.task_id || !testo) return fail('Scrivi il testo della risposta');
  if (testo.length > 20_000) return fail('Risposta troppo lunga');
  if (/\[[^\]\n]{2,60}\]/.test(testo)) return fail('La risposta contiene ancora un segnaposto tra parentesi quadre');

  const { data: task } = await db.from('tasks').select('id, assegnato_a, mail_id, risposta_inviata_at').eq('id', body.task_id).maybeSingle();
  if (!task) return fail('Task non trovato', 404);
  if (!me.is_admin && task.assegnato_a && task.assegnato_a !== me.nickname) return fail(`Il task è assegnato a ${task.assegnato_a}`, 403);
  if (!task.mail_id) return fail('Questo task non nasce da una mail');
  if (task.risposta_inviata_at) return fail('La risposta è già stata inviata');

  const { data: mail } = await db.from('mail_messaggi').select('*').eq('id', task.mail_id).maybeSingle();
  if (!mail?.da_email) return fail('Mail d\'origine non trovata');
  const { data: casella } = await db.from('mail_caselle').select('*').eq('id', mail.casella_id).maybeSingle();
  if (!casella) return fail('Casella non trovata');
  const pass = Deno.env.get(`MAIL_PASSWORD_${casella.id.toUpperCase()}`);
  if (!pass) return fail(`Manca la password della casella ${casella.indirizzo}`, 500);

  // Prenota l'invio: due clic o due persone non mandano la stessa risposta due volte
  const { data: prenotato } = await db.from('tasks').update({ risposta_inviata_at: new Date().toISOString() })
    .eq('id', task.id).is('risposta_inviata_at', null).select('id');
  if (!prenotato?.length) return fail('La risposta è già stata inviata');

  const oggetto = /^\s*(re|r|aw|sv)\s*:/i.test(mail.oggetto || '') ? mail.oggetto : `Re: ${mail.oggetto || ''}`.trim();
  const messageId = `<${crypto.randomUUID()}@${casella.indirizzo.split('@')[1]}>`;
  const riferimenti = [mail.riferimenti, mail.message_id].filter(Boolean).join(' ');

  try {
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
    await db.from('tasks').update({ bozza_risposta: testo }).eq('id', task.id);

    // Con il login di chi invia, così lo storico del task registra la persona giusta
    const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: auth } },
    });
    await utente.rpc('tc_task_stato', { p_id: task.id, p_stato: 'completato' });

    return reply({ success: true, copia_in_inviata: inviata });
  } catch (e) {
    await db.from('tasks').update({ risposta_inviata_at: null }).eq('id', task.id);
    console.error('Invio', e);
    return fail(`Invio non riuscito: ${e instanceof Error ? e.message : e}`, 502);
  }
});
