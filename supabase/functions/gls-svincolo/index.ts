// T&C Factory — Svincolo di un pacco fermo da GLS, con il clic di una persona (Centro di controllo)
//
// Il cervello legge la risposta del cliente all'avviso di giacenza e propone le istruzioni nel task
// (analisi.svincolo). Una persona le controlla e preme il bottone: questa funzione le manda a GLS
// (labelservice ReleaseShipmentStock) e, se GLS risponde OK, manda al cliente la conferma e
// completa il task. Le spese di riconsegna non vanno mai a nessuno (SpeseAdMittente/Destinatario N).
//
// Conti GLS: le credenziali stanno nei secret <PREFISSO>_SEDE/_CLIENTE/_CONTRATTO/_PASSWORD.
// Si usa il conto che trova la spedizione (spedizioni_tracking.cliente_gls); se non si sa, si
// prova prima quello del negozio e poi l'altro ("Spedizione non trovata" non tocca nessun pacco).
//
// Fase di prova fino a venerdì 13/11/2026: parte solo con il clic. Va pubblicata con
// --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { inviaRisposta } from '../_shared/mail.ts';

const CONTI: Record<string, string> = { '2067': 'GLS_TCFACTORY', '5456': 'GLS_BIENJUGADO' };
const CONTO_NEGOZIO: Record<string, string> = { bienjugado: '5456' };
const URL_GLS = 'https://labelservice.gls-italy.com/ilswebservice.asmx/ReleaseShipmentStock';

// Scelta del cliente → TipoSvincolo GLS
const TIPI: Record<string, { tipo: number; label: string }> = {
  riconsegna: { tipo: 1, label: 'Riconsegna allo stesso indirizzo' },
  riconsegna_preavviso: { tipo: 1, label: 'Riconsegna con telefonata del corriere' },
  altro_indirizzo: { tipo: 2, label: 'Consegna a un altro indirizzo' },
  reso_mittente: { tipo: 3, label: 'Reso al mittente' },
  ritiro_sede: { tipo: 7, label: 'Ritiro alla sede GLS' },
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const xml = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const taglia = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// Primo giorno lavorativo dopo oggi (ora di Roma), nel formato GG/MM/AA che vuole GLS
async function prossimoLavorativo(db: SupabaseClient) {
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const d = new Date(`${oggi}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const { data: festivo } = await db.rpc('tc_festivo', { p: iso });
    if (!festivo) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
  }
  throw new Error('Nessun giorno lavorativo trovato');
}

function credenziali(cli: string) {
  const p = CONTI[cli];
  const c = p && {
    sede: Deno.env.get(`${p}_SEDE`) || 'LU', cliente: Deno.env.get(`${p}_CLIENTE`) || cli,
    contratto: Deno.env.get(`${p}_CONTRATTO`) || cli, password: Deno.env.get(`${p}_PASSWORD`) || '',
  };
  return c && c.password ? c : null;
}

async function chiamaGls(cli: string, dati: Row) {
  const c = credenziali(cli);
  if (!c) return { esito: 'senza_credenziali', testo: `Mancano le credenziali GLS del codice cliente ${cli}` };
  const nuovo = dati.tipo === 2;
  const corpo = `<Info><SedeGls>${xml(c.sede)}</SedeGls><CodiceClienteGls>${xml(c.cliente)}</CodiceClienteGls><PasswordClienteGls>${xml(c.password)}</PasswordClienteGls>` +
    `<ReleaseShipmentStock><CodiceContrattoGls>${xml(c.contratto)}</CodiceContrattoGls><NumeroSpedizione>${xml(dati.tracking)}</NumeroSpedizione>` +
    `<TipoSvincolo>${dati.tipo}</TipoSvincolo><TelefonoCliente></TelefonoCliente>` +
    `<ConPreavvisoTelefonico>${dati.preavviso ? 'S' : ''}</ConPreavvisoTelefonico><TelefonoDestinatario>${xml(dati.preavviso ? dati.telefono : '')}</TelefonoDestinatario>` +
    `<AnnullandoCAssegno></AnnullandoCAssegno><VariandoCAssegno></VariandoCAssegno><NuovoImportoCAssegno></NuovoImportoCAssegno>` +
    `<VariandoInPortoFranco></VariandoInPortoFranco><VariandoInPortoAssegnato></VariandoInPortoAssegnato>` +
    `<SpeseAdMittente>N</SpeseAdMittente><SpeseAdDestinatario>N</SpeseAdDestinatario>` +
    `<DataRiconsegna>${xml(dati.data)}</DataRiconsegna><Note>${xml(dati.note)}</Note>` +
    `<CognomeNome>${xml(nuovo ? dati.nome : '')}</CognomeNome><NuovoIndirizzo>${xml(nuovo ? dati.via : '')}</NuovoIndirizzo>` +
    `<NuovaLocalita>${xml(nuovo ? dati.citta : '')}</NuovaLocalita><NuovoZipcode>${xml(nuovo ? dati.cap : '')}</NuovoZipcode>` +
    `<NuovaProvincia>${xml(nuovo ? dati.provincia : '')}</NuovaProvincia></ReleaseShipmentStock></Info>`;
  const res = await fetch(URL_GLS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ XMLInfoReleaseShipmentStock: corpo }),
    signal: AbortSignal.timeout(60_000),
  });
  const testo = (await res.text()).replaceAll(c.password, '***');
  const svincolo = testo.match(/<Svincolo>([\s\S]*?)<\/Svincolo>/)?.[1]?.trim();
  const errore = testo.match(/<DescrizioneErrore>([\s\S]*?)<\/DescrizioneErrore>/)?.[1]?.trim();
  if (svincolo && /^ok$/i.test(svincolo)) return { esito: 'ok', testo: svincolo };
  if (svincolo && /non trovata/i.test(svincolo)) return { esito: 'non_trovata', testo: svincolo };
  return { esito: 'errore', testo: svincolo || errore || `Risposta GLS non riconosciuta (HTTP ${res.status})` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = req.headers.get('Authorization') || '';
  const { data: caller } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!caller?.user) return fail('Accesso richiesto', 401);
  const { data: me } = await db.from('app_users').select('nickname, is_admin').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail('Accesso riservato allo staff', 403);

  let body: Row;
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }
  const { data: task } = await db.from('tasks').select('id, assegnato_a, mail_id, analisi, risposta_inviata_at').eq('id', body.task_id || '').maybeSingle();
  if (!task) return fail('Task non trovato', 404);
  if (!me.is_admin && task.assegnato_a && task.assegnato_a !== me.nickname) return fail(`Il task è assegnato a ${task.assegnato_a}`, 403);
  const sv = task.analisi?.svincolo;
  if (!sv?.tracking) return fail('Questo task non ha istruzioni per GLS');
  if (sv.stato === 'inviato') return fail('Le istruzioni sono già state mandate a GLS');

  const scelta = TIPI[body.scelta] ? body.scelta : '';
  if (!scelta) return fail('Scegli cosa fare del pacco');
  const { tipo, label } = TIPI[scelta];
  const telefono = String(body.telefono || '').replace(/[^\d+]/g, '').slice(0, 15);
  const preavviso = scelta === 'riconsegna_preavviso';
  if (preavviso && telefono.replace(/\D/g, '').length < 6) return fail('Per la telefonata del corriere serve il numero del cliente');
  const dati: Row = {
    tracking: sv.tracking, tipo, preavviso, telefono, note: taglia(body.note, 65),
    nome: taglia(body.nome, 20), via: taglia(body.via, 30), citta: taglia(body.citta, 30),
    cap: taglia(body.cap, 10), provincia: taglia(body.provincia, 2).toUpperCase(),
    data: tipo <= 2 ? await prossimoLavorativo(db) : '',
  };
  if (tipo === 2 && !(dati.nome && dati.via && dati.citta && dati.cap && dati.provincia)) return fail('Per un altro indirizzo servono nome, via, CAP, città e provincia');
  const testo = String(body.testo || '').trim();
  if (testo && /\[[^\]\n]{2,60}\]/.test(testo)) return fail('La conferma contiene ancora un segnaposto tra parentesi quadre');

  // Prenota: due clic o due persone non mandano due volte le istruzioni
  const { data: prenotato } = await db.from('tasks').update({ analisi: { ...task.analisi, svincolo: { ...sv, stato: 'in_invio' } } })
    .eq('id', task.id).neq('analisi->svincolo->>stato', 'in_invio').neq('analisi->svincolo->>stato', 'inviato').select('id');
  if (!prenotato?.length) return fail('Le istruzioni sono già in invio');

  const conti = [...new Set([sv.cliente_gls, CONTO_NEGOZIO[sv.negozio] || '2067', ...Object.keys(CONTI)].filter(c => c && CONTI[c]))];
  let r: Row = { esito: 'errore', testo: 'Nessun conto GLS' }, conto = '';
  for (const cli of conti) {
    try { r = await chiamaGls(cli, dati); } catch (e) { r = { esito: 'errore', testo: e instanceof Error ? e.message : String(e) }; }
    conto = cli;
    if (r.esito !== 'non_trovata' && r.esito !== 'senza_credenziali') break;
  }
  const registro = (stato: string, output: string) => db.from('automazione_esecuzioni').insert({
    nome: 'svincolo-gls', stato, fine: new Date().toISOString(),
    riepilogo: { ordine: sv.ordine, tracking: sv.tracking, tipo: label, da: me.nickname },
    output: `${sv.ordine} · ${sv.tracking} · ${label} · conto ${conto} · ${output}`.slice(0, 2000),
  });

  if (r.esito !== 'ok') {
    await db.from('tasks').update({ analisi: { ...task.analisi, svincolo: { ...sv, stato: 'da_approvare', errore: r.testo } } }).eq('id', task.id);
    await registro('errore', r.testo);
    return fail(`GLS non ha accettato le istruzioni: ${r.testo}`, 502);
  }

  const inviato = {
    ...sv, ...dati, scelta, stato: 'inviato', cliente_gls: conto, tipo_label: label,
    inviato_at: new Date().toISOString(), inviato_da: me.nickname, errore: null,
  };
  await db.from('tasks').update({ analisi: { ...task.analisi, svincolo: inviato } }).eq('id', task.id);
  await registro('ok', 'OK');

  // Conferma al cliente nella stessa conversazione, poi il task è fatto
  let conferma = 'non richiesta';
  if (testo && task.mail_id && !task.risposta_inviata_at) {
    const { data: lock } = await db.from('tasks').update({ risposta_inviata_at: new Date().toISOString() }).eq('id', task.id).is('risposta_inviata_at', null).select('id');
    if (lock?.length) {
      try {
        const { data: mail } = await db.from('mail_messaggi').select('*').eq('id', task.mail_id).maybeSingle();
        const { data: casella } = mail ? await db.from('mail_caselle').select('*').eq('id', mail.casella_id).maybeSingle() : { data: null };
        if (!mail?.da_email || !casella) throw new Error('mail d\'origine non trovata');
        await inviaRisposta(db, casella, mail, testo);
        await db.from('tasks').update({ bozza_risposta: testo }).eq('id', task.id);
        conferma = 'inviata';
      } catch (e) {
        await db.from('tasks').update({ risposta_inviata_at: null }).eq('id', task.id);
        conferma = `non inviata: ${e instanceof Error ? e.message : e}`;
      }
    }
  }
  if (conferma !== 'non richiesta' && conferma.startsWith('non inviata')) return reply({ success: true, conferma, completato: false });

  const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } },
  });
  await utente.rpc('tc_task_stato', { p_id: task.id, p_stato: 'completato' });
  return reply({ success: true, conferma, completato: true });
});
