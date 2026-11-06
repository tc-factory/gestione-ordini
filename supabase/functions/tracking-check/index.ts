// T&C Factory — Controllo delle spedizioni dallo storico del tracking GLS
//
// Per gli ordini spediti e non ancora consegnati legge la pagina pubblica di tracking GLS
// (l'indirizzo si costruisce dal numero di tracking, es. LU660842682), salva lo storico
// e riconosce i problemi dall'ultimo stato. Ogni spedizione con un problema ha un task, che si
// chiude da solo alla consegna.
//
// È una pagina pubblica, non un'API: se GLS la cambia, i controlli risultano "senza dati"
// e l'avviso arriva dal controllo dei collegamenti (_tc_problemi).
//
// Chi la può chiamare: il cron del database (x-sync-key) oppure un admin collegato.
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PER_GIRO = 120;
const PAUSA_MS = 300;              // una richiesta alla volta, per non pesare sul sito GLS
const GIORNI_RITARDO = 3;          // giorni lavorativi dalla spedizione oltre i quali è un ritardo (sabato, domenica e festivi esclusi: li conta il database)
const TIME_BUDGET_MS = 110_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// Frasi GLS (pagina in inglese, lang=en) che indicano un problema, in ordine di gravità
const PROBLEMI: { re: RegExp; label: string; priorita: string; fare: string }[] = [
  { re: /incorrect address/i, label: 'Indirizzo errato', priorita: 'urgente', fare: 'Chiedi al cliente l\'indirizzo corretto e comunicalo a GLS per la riconsegna.' },
  { re: /returned the shipment to the sender/i, label: 'Rientro al mittente', priorita: 'urgente', fare: 'Il pacco sta tornando da noi. Avvisa il cliente e concorda una nuova spedizione o il rimborso.' },
  { re: /in storage at GLS Depot|awaiting instructions/i, label: 'Giacenza in deposito GLS', priorita: 'urgente', fare: 'Contatta il cliente, poi comunica a GLS come procedere con la riconsegna.' },
  { re: /unable to deliver.*second attempt/i, label: 'Seconda consegna non riuscita', priorita: 'urgente', fare: 'Contatta il cliente e concorda con GLS una nuova consegna.' },
  { re: /unable to deliver.*first attempt/i, label: 'Prima consegna non riuscita', priorita: 'alta', fare: 'GLS riprova il giorno lavorativo dopo. Avvisa il cliente di farsi trovare.' },
  { re: /no longer available at the GLS POINT/i, label: 'Scaduto al GLS Point', priorita: 'urgente', fare: 'Il pacco non è più ritirabile al GLS Point. Contatta il cliente e concorda con GLS una nuova consegna o il rientro.' },
  { re: /available for collection/i, label: 'Da ritirare al GLS Point', priorita: 'alta', fare: 'Avvisa il cliente che il pacco è da ritirare al GLS Point.' },
  { re: /network delay/i, label: 'Ritardo della rete GLS', priorita: 'alta', fare: 'Controlla domani se il pacco si muove e avvisa il cliente del ritardo.' },
];
// Le frasi GLS in italiano, per lo storico nel task
const TRADUZIONI: [RegExp, string][] = [
  [/has been created by the sender/i, 'Spedizione creata, in attesa del ritiro da parte di GLS'],
  [/shipped from sending depot/i, 'Partita dal deposito di Lucca'],
  [/shipment in transit/i, 'In viaggio'],
  [/did not arrive at the receiving|has not yet arrived at the receiving/i, 'Non ancora arrivata al deposito di destinazione'],
  [/arrived at final depot/i, 'Arrivata al deposito di destinazione'],
  [/delivery scheduled during the day/i, 'In consegna oggi'],
  [/delivery scheduled for first next business day|delivery is expected on the first available/i, 'Consegna prevista il primo giorno lavorativo'],
  [/area served in 48/i, 'Zona servita in 48 ore'],
  [/area served in 72/i, 'Zona servita in 72 ore'],
  [/^delivered/i, 'Consegnata'],
  [/incorrect address/i, 'Indirizzo errato: GLS aspetta istruzioni'],
  [/returned the shipment to the sender/i, 'Pacco rimandato al mittente'],
  [/in storage at GLS Depot|awaiting instructions/i, 'In giacenza nel deposito GLS, in attesa di istruzioni'],
  [/unable to deliver.*second attempt/i, 'Seconda consegna non riuscita'],
  [/unable to deliver.*first attempt/i, 'Prima consegna non riuscita, nuovo tentativo il giorno lavorativo dopo'],
  [/no longer available at the GLS POINT/i, 'Non più disponibile al GLS Point: GLS chiede di contattare il mittente'],
  [/available for collection/i, 'Disponibile per il ritiro al GLS Point'],
  [/network delay/i, 'Consegna rimandata per un ritardo della rete GLS'],
];
const inItaliano = (s: string) => TRADUZIONI.find(([re]) => re.test(s))?.[1] || s;

// Storico per il task: in italiano, con gli stati ripetuti uniti in una riga sola
function storicoLeggibile(eventi: Evento[]) {
  const out: { dal: string; al: string; luogo: string; stato: string; volte: number }[] = [];
  for (const e of eventi) {   // dal più recente
    const stato = inItaliano(e.stato), ultimo = out[out.length - 1];
    if (ultimo && ultimo.stato === stato && ultimo.luogo === e.luogo) { ultimo.dal = e.at; ultimo.volte++; }
    else out.push({ dal: e.at, al: e.at, luogo: e.luogo, stato, volte: 1 });
  }
  return out;
}

// Frasi normali di una spedizione che viaggia
const NORMALI = /has been created by the sender|shipped from sending depot|in transit|arrived at final depot|delivery scheduled|delivery is expected|area served in|did not arrive at the receiving|has not yet arrived at the receiving/i;
const AFFIDATA_NO = /has been created by the sender/i;

type Evento = { at: string; luogo: string; stato: string; nota: string };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const entita = (s: string) => s.replace(/&amp;/g, '&').replace(/&ndash;/g, '–').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
const DATA = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

async function leggiStorico(numero: string): Promise<Evento[] | null> {
  const sede = numero.slice(0, 2), sped = numero.slice(2);
  const url = `https://www.gls-italy.com/?option=com_gls&view=track_e_trace&mode=search&diretto=yes&numsped=${sped}&locpartenza=${sede}&lang=en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
  const html = await res.text();
  const righe = entita(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, '\n'))
    .split('\n').map(r => r.trim()).filter(Boolean);
  const inizio = righe.indexOf('RESULTS OF SHIPMENT');
  if (inizio < 0) return null;
  const eventi: Evento[] = [];
  let k = inizio + 5;   // salta le intestazioni: data, luogo, stato, note
  while (k + 2 < righe.length && DATA.test(righe[k])) {
    const [, g, m, a, h, min] = righe[k].match(DATA)!;
    let nota = '', n = k + 3;
    if (n < righe.length && !DATA.test(righe[n]) && !righe[n].startsWith('Search your')) nota = righe[n++];
    eventi.push({ at: `${a}-${m}-${g}T${h}:${min}:00+01:00`, luogo: righe[k + 1], stato: righe[k + 2], nota });
    k = n;
  }
  return eventi;
}

function classifica(eventi: Evento[] | null, giorni: number, testoGiorni: string) {
  if (!eventi?.length) {
    return giorni >= GIORNI_RITARDO
      ? { stato: 'ritardo', problema: 'Tracking non attivo', priorita: 'alta', fare: 'Il pacco non risulta preso in carico da GLS: controlla che sia partito davvero.' }
      : { stato: 'senza_dati', problema: null, priorita: null, fare: '' };
  }
  const ultimo = eventi[0].stato;
  if (/^delivered/i.test(ultimo)) return { stato: 'consegnata', problema: null, priorita: null, fare: '' };
  const p = PROBLEMI.find(x => x.re.test(ultimo));
  if (p) return { stato: 'problema', problema: p.label, priorita: p.priorita, fare: p.fare };
  if (!NORMALI.test(ultimo)) return { stato: 'problema', problema: `Stato da controllare: ${ultimo.slice(0, 80)}`, priorita: 'alta', fare: 'Stato GLS mai visto prima: controlla lo storico.' };
  if (AFFIDATA_NO.test(ultimo) && giorni >= 2) return { stato: 'ritardo', problema: 'Non ancora ritirata da GLS', priorita: 'alta', fare: 'GLS non ha ancora preso il pacco: controlla il ritiro.' };
  if (giorni >= GIORNI_RITARDO) return { stato: 'ritardo', problema: `In ritardo: ${testoGiorni} dalla spedizione`, priorita: 'alta', fare: 'Controlla lo storico e avvisa il cliente del ritardo.' };
  return { stato: 'in_viaggio', problema: null, priorita: null, fare: '' };
}

async function aggiornaTask(db: SupabaseClient, s: Row, esito: Row, eventi: Evento[] | null, tipoId: string | null) {
  const chiave = `consegna:${s.ordine_id}`;
  const { data: aperto } = await db.from('tasks').select('id, priorita').eq('fonte_rif->>evento_id', chiave).not('stato', 'in', '(completato,non_completato)').maybeSingle();

  if (esito.stato === 'consegnata') {
    if (aperto) await db.from('tasks').update({ stato: 'completato' }).eq('id', aperto.id);
    return;
  }
  if (!esito.problema) return;

  const titolo = `${esito.problema} · ordine ${s.numero_ordine}${s.cliente ? ` · ${s.cliente}` : ''}`.slice(0, 200);
  const sede = s.tracking.slice(0, 2), sped = s.tracking.slice(2);
  const analisi = {
    spedizione: {
      tracking: s.tracking,
      url: `https://www.gls-italy.com/?option=com_gls&view=track_e_trace&mode=search&diretto=yes&numsped=${sped}&locpartenza=${sede}`,
      storico: storicoLeggibile(eventi || []),
    },
    cliente: { nome: s.cliente, email: s.email, telefono: s.telefono, citta: s.citta },
  };
  if (aperto) {
    await db.from('tasks').update({ titolo, descrizione: esito.fare, priorita: esito.priorita, analisi }).eq('id', aperto.id);
    return;
  }
  const { error } = await db.from('tasks').insert({
    tipo_id: tipoId, titolo, descrizione: esito.fare, analisi, priorita: esito.priorita, macroarea: s.store_id, fonte: 'shopify',
    fonte_rif: { evento_id: chiave, ordine: s.ordine_id, motivo: 'consegna' }, creato_da: 'cervello',
  });
  if (error && error.code !== '23505') throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const syncKey = Deno.env.get('SHOPIFY_SYNC_KEY');
  if (!syncKey || req.headers.get('x-sync-key') !== syncKey) {
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: caller } = await db.auth.getUser(jwt);
    if (!caller?.user) return fail('Accesso richiesto', 401);
    const { data: me } = await db.from('app_users').select('is_admin').eq('auth_id', caller.user.id).maybeSingle();
    if (!me?.is_admin) return fail('Solo gli admin', 403);
  }

  const { data: lista, error } = await db.rpc('_tc_spedizioni_da_controllare', { p_n: PER_GIRO });
  if (error) return fail(error.message, 500);
  const { data: tipo } = await db.from('task_tipi').select('id').eq('nome', 'Problema di consegna').maybeSingle();

  const fine = Date.now() + TIME_BUDGET_MS;
  const conteggio: Record<string, number> = {};
  for (const s of (lista || []) as Row[]) {
    if (Date.now() > fine) break;
    let eventi: Evento[] | null = null;
    try { eventi = await leggiStorico(s.tracking); }
    catch (e) { console.error('Tracking', s.tracking, e); continue; }

    const esito = classifica(eventi, s.giorni_lav || 0, s.giorni_testo || '');
    const ultimo = eventi?.[0];
    await db.from('spedizioni_tracking').upsert({
      ordine_id: s.ordine_id, store_id: s.store_id, numero: s.tracking, spedito_at: s.spedito_at,
      stato: esito.stato, problema: esito.problema, ultimo_evento: ultimo ? inItaliano(ultimo.stato) : null, ultimo_at: ultimo?.at || null,
      eventi: eventi || [], consegnata_at: esito.stato === 'consegnata' ? ultimo?.at : null,
      controllata_at: new Date().toISOString(),
    });
    await aggiornaTask(db, s, esito, eventi, tipo?.id || null);
    conteggio[esito.stato] = (conteggio[esito.stato] || 0) + 1;
    await new Promise(r => setTimeout(r, PAUSA_MS));
  }
  return reply({ success: true, conteggio });
});
