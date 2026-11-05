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

const PER_GIRO = 60;
const PAUSA_MS = 300;              // una richiesta alla volta, per non pesare sul sito GLS
const GIORNI_RITARDO = 3;          // giorni lavorativi dalla spedizione oltre i quali è un ritardo
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
const PROBLEMI: { re: RegExp; label: string; priorita: string }[] = [
  { re: /incorrect address/i, label: 'Indirizzo errato', priorita: 'urgente' },
  { re: /returned the shipment to the sender/i, label: 'Rientro al mittente', priorita: 'urgente' },
  { re: /in storage at GLS Depot|awaiting instructions/i, label: 'Giacenza in deposito GLS', priorita: 'urgente' },
  { re: /unable to deliver.*second attempt/i, label: 'Seconda consegna non riuscita', priorita: 'urgente' },
  { re: /unable to deliver.*first attempt/i, label: 'Prima consegna non riuscita', priorita: 'alta' },
  { re: /available for collection/i, label: 'Da ritirare al GLS Point', priorita: 'alta' },
  { re: /network delay/i, label: 'Ritardo della rete GLS', priorita: 'alta' },
];
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

function giorniLavorativi(da: Date, a: Date): number {
  let n = 0;
  const d = new Date(da);
  while (d < a) {
    d.setDate(d.getDate() + 1);
    if (d <= a && d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}

function classifica(eventi: Evento[] | null, speditoAt: string | null) {
  const giorni = speditoAt ? giorniLavorativi(new Date(speditoAt), new Date()) : 0;
  if (!eventi?.length) {
    return giorni >= GIORNI_RITARDO
      ? { stato: 'ritardo', problema: 'Tracking non attivo', priorita: 'alta' }
      : { stato: 'senza_dati', problema: null, priorita: null };
  }
  const ultimo = eventi[0].stato;
  if (/^delivered/i.test(ultimo)) return { stato: 'consegnata', problema: null, priorita: null };
  const p = PROBLEMI.find(x => x.re.test(ultimo));
  if (p) return { stato: 'problema', problema: p.label, priorita: p.priorita };
  if (!NORMALI.test(ultimo)) return { stato: 'problema', problema: `Stato da controllare: ${ultimo.slice(0, 80)}`, priorita: 'alta' };
  if (AFFIDATA_NO.test(ultimo) && giorni >= 2) return { stato: 'ritardo', problema: 'Non ancora ritirata da GLS', priorita: 'alta' };
  if (giorni >= GIORNI_RITARDO) return { stato: 'ritardo', problema: `In ritardo: ${giorni} giorni lavorativi dalla spedizione`, priorita: 'alta' };
  return { stato: 'in_viaggio', problema: null, priorita: null };
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
  const storico = (eventi || []).slice(0, 6).map(e => `${e.at.slice(8, 10)}/${e.at.slice(5, 7)} ${e.at.slice(11, 16)} · ${e.luogo} · ${e.stato}`).join('\n');
  const descrizione = `Tracking ${s.tracking}\n\n${storico}`.slice(0, 5000);
  if (aperto) {
    await db.from('tasks').update({ titolo, descrizione, priorita: esito.priorita }).eq('id', aperto.id);
    return;
  }
  const { error } = await db.from('tasks').insert({
    tipo_id: tipoId, titolo, descrizione, priorita: esito.priorita, macroarea: s.store_id, fonte: 'shopify',
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

    const esito = classifica(eventi, s.spedito_at);
    const ultimo = eventi?.[0];
    await db.from('spedizioni_tracking').upsert({
      ordine_id: s.ordine_id, store_id: s.store_id, numero: s.tracking, spedito_at: s.spedito_at,
      stato: esito.stato, problema: esito.problema, ultimo_evento: ultimo?.stato || null, ultimo_at: ultimo?.at || null,
      eventi: eventi || [], consegnata_at: esito.stato === 'consegnata' ? ultimo?.at : null,
      controllata_at: new Date().toISOString(),
    });
    await aggiornaTask(db, s, esito, eventi, tipo?.id || null);
    conteggio[esito.stato] = (conteggio[esito.stato] || 0) + 1;
    await new Promise(r => setTimeout(r, PAUSA_MS));
  }
  return reply({ success: true, conteggio });
});
