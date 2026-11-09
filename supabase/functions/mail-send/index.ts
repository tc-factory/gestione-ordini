// T&C Factory — Invio della risposta di un task (Centro di controllo, fase 2b)
//
// Una persona collegata approva la bozza dal task: la mail parte dalla casella che ha
// ricevuto il messaggio (SMTP Aruba, porta 465), nella stessa conversazione, e una copia
// va nella cartella Inviata. Il task viene completato a nome di chi ha inviato, tranne per i
// tipi in cui rispondere non basta (task_tipi.chiude_con_risposta): quelli restano aperti.
//
// Può inviare chi può lavorare il task: admin, l'assegnatario, o chiunque se è in coda comune.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { inviaRisposta } from '../_shared/mail.ts';

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

  const { data: task } = await db.from('tasks').select('id, assegnato_a, mail_id, risposta_inviata_at, task_tipi(chiude_con_risposta)').eq('id', body.task_id).maybeSingle();
  if (!task) return fail('Task non trovato', 404);
  if (!me.is_admin && task.assegnato_a && task.assegnato_a !== me.nickname) return fail(`Il task è assegnato a ${task.assegnato_a}`, 403);
  if (!task.mail_id) return fail('Questo task non nasce da una mail');
  if (task.risposta_inviata_at) return fail('La risposta è già stata inviata');

  const { data: mail } = await db.from('mail_messaggi').select('*').eq('id', task.mail_id).maybeSingle();
  if (!mail?.da_email) return fail('Mail d\'origine non trovata');
  const { data: casella } = await db.from('mail_caselle').select('*').eq('id', mail.casella_id).maybeSingle();
  if (!casella) return fail('Casella non trovata');

  // Prenota l'invio: due clic o due persone non mandano la stessa risposta due volte
  const { data: prenotato } = await db.from('tasks').update({ risposta_inviata_at: new Date().toISOString() })
    .eq('id', task.id).is('risposta_inviata_at', null).select('id');
  if (!prenotato?.length) return fail('La risposta è già stata inviata');

  try {
    const { copia_in_inviata } = await inviaRisposta(db, casella, mail, testo);
    await db.from('tasks').update({ bozza_risposta: testo }).eq('id', task.id);

    // Con il login di chi invia, così lo storico del task registra la persona giusta
    const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: auth } },
    });
    // deno-lint-ignore no-explicit-any
    const completa = (task as any).task_tipi?.chiude_con_risposta !== false;
    if (completa) await utente.rpc('tc_task_stato', { p_id: task.id, p_stato: 'completato' });

    return reply({ success: true, copia_in_inviata, completato: completa });
  } catch (e) {
    await db.from('tasks').update({ risposta_inviata_at: null }).eq('id', task.id);
    console.error('Invio', e);
    return fail(`Invio non riuscito: ${e instanceof Error ? e.message : e}`, 502);
  }
});
