/**
 * T&C Factory — Centro di controllo (fase 0: motore dei task)
 *
 *   • Tasks: all'operatore i suoi task e la coda comune; all'admin la coda comune da assegnare
 *   • Competenze (admin): per ogni area e competenza il primario e il secondario
 *   • Team (admin): carico, task in corso e punteggio di ogni operatore
 *   • Tipi di task (admin): catalogo con tempo standard e tempo reale misurato
 *
 * Dati: tabelle task_tipi / tasks / task_storico (sql/centro-controllo.sql).
 * Il tempo di lavoro lo conta il database a ogni cambio di stato (tc_task_stato).
 * La vede chi ha la scheda nei permessi; Competenze, Team, Tipi di task, Collegamenti e il punteggio solo gli admin.
 */

const TASK_STATI = [
  { id: 'da_fare',        label: 'Da fare',        color: '#94a3b8' },
  { id: 'in_lavorazione', label: 'In lavorazione', color: '#f59e0b' },
  { id: 'in_pausa',       label: 'In pausa',       color: '#a78bfa' },
  { id: 'completato',     label: 'Completato',     color: '#22c55e' },
  { id: 'rimandato',      label: 'Rimandato',      color: '#38bdf8' },
  { id: 'bloccato',       label: 'Bloccato',       color: '#ef4444' },
  { id: 'non_completato', label: 'Non completato', color: '#f43f5e' },
];
const TASK_PRIORITA = [
  { id: 'urgente', label: 'Urgente', color: '#ef4444' },
  { id: 'alta',    label: 'Alta',    color: '#f97316' },
  { id: 'normale', label: 'Normale', color: '#6366f1' },
  { id: 'bassa',   label: 'Bassa',   color: '#94a3b8' },
];
const TASK_AUTONOMIA = [
  { id: 'solo_task',  label: 'Solo task',  hint: 'Il cervello crea il task per un operatore' },
  { id: 'bozza',      label: 'Bozza',      hint: 'Il cervello prepara la risposta, l\'operatore la approva' },
  { id: 'automatico', label: 'Automatico', hint: 'Il cervello risponde da solo, solo se l\'ordine è del mittente e non ha dubbi' },
];
// Macroaree: i negozi (id come in shopify_stores)
const TASK_MACROAREE = [
  { id: 'ciucciamilcalzino', label: 'Ciucciami il Calzino', color: '#ec4899' },
  { id: 'bienjugado',        label: 'Bienjugado',           color: '#f59e0b' },
  { id: 'boxfactorylab',     label: 'Box Factory Lab',      color: '#6366f1' },
  { id: 'asteroidi',         label: 'Asteroidi Store',      color: '#14b8a6' },
];
// Brand dei task: i negozi più Live Printing (le sue mail arrivano dal cervello, non è un negozio Shopify)
const TASK_BRAND = [...TASK_MACROAREE, { id: 'liveprinting', label: 'Live Printing', color: '#ef4123' }];
const taskMacro = (id) => TASK_BRAND.find(m => m.id === id);
const isNegozioShopify = (id) => TASK_MACROAREE.some(m => m.id === id);

// Categorie della coda: i brand più i tag degli ordini del gestionale (Salvatore, T&C Factory…).
// Il task di un ordine del gestionale va nella categoria del tag dell'ordine (Box Factory Lab → Box Factory Lab).
const taskSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Le code di produzione, di qualsiasi brand:
//   File: ordini attivi senza file allegati (sono ordini, non task)
//   DTF: solo la stampa al macchinario, in ordine di priorità
//   Stampa: DTF stampati e merce pronta, si applica
//   Coda lavorazione: tutto il resto da produrre
const TASK_CODE = [
  { id: 'file',        label: 'DTF-FILE',          color: '#a855f7' },
  { id: 'dtf',         label: 'DTF-STAMPA',        color: '#0ea5e9' },
  { id: 'stampa',      label: 'Stampa',            color: '#16a34a' },
  { id: 'lavorazione', label: 'Altre lavorazioni', color: '#334155' },
];
// Le code del Centro di controllo (deciso da Riccardo il 2026-11-19):
//   DTF-FILE: ordini della lista DTF senza file caricati + proposte DTF da approvare
//   DTF-STAMPA: la coda di stampa di DTF interno con solo ciò che ha i file (conto terzi, cartelle, ordini)
//               + "Cartella senza ordine" e "Controllare se stampato"
//   STAMPA: DTF stampati e merce pronta, si applica
//   ALTRE LAVORAZIONI: tutto il resto che non riguarda i negozi online
//   NEGOZI: tutto quello dei negozi online (produzione Shopify, mail, indirizzi, giacenze), filtrabile per negozio
const TASK_CODE_Q = [
  { id: 'dtffile',   label: 'DTF-FILE',          color: '#a855f7', hint: 'Ordini con DTF senza file nella cartella 1. Stampare, e proposte da approvare' },
  { id: 'dtfstampa', label: 'DTF-STAMPA',        color: '#0ea5e9', hint: 'Coda di stampa al macchinario, nello stesso ordine di DTF interno' },
  { id: 'stampa',    label: 'STAMPA',            color: '#16a34a', hint: 'DTF stampati e merce pronta: si applica' },
  { id: 'altre',     label: 'ALTRE LAVORAZIONI', color: '#334155', hint: 'Tutto il resto, tranne i negozi online' },
  { id: 'negozi',    label: 'NEGOZI',            color: '#ec4899', hint: 'Ordini, mail e spedizioni dei negozi online' },
];
const TASK_CODE_VECCHIE = { file: 'dtffile', dtf: 'dtfstampa', lavorazione: 'altre' };
const codaAttiva = () => { const c = TASK_CODE_VECCHIE[Ctrl.coda] || Ctrl.coda; return TASK_CODE_Q.some(x => x.id === c) ? c : 'dtffile'; };
// Task dei negozi online: arrivano da Shopify o hanno come brand un negozio (o Live Printing)
const taskNegozio = (t) => t.fonte === 'shopify' || t.fonte === 'shopify_admin' || TASK_BRAND.some(m => m.id === t.macroarea);
// Coda di un task. null = non si mostra ("Stampa DTF" della linea produttiva: c'è già l'ordine in DTF-STAMPA)
function taskCoda(t) {
  if (t.fonte === 'automazione' && t.fonte_rif?.dtf) return /^(proposta|tif|nome):/.test(String(t.fonte_rif.dtf)) ? 'dtffile' : 'dtfstampa';
  const c = taskCat(t);
  if (c === 'dtf') return null;
  if (c === 'stampa') return 'stampa';
  return taskNegozio(t) ? 'negozi' : 'altre';
}
// Righe della coda DTF interno divise tra DTF-FILE (ordini senza file, tranne quelli con una proposta da
// approvare: c'è già il task) e DTF-STAMPA (conto terzi, cartelle e ordini con i file)
function codaDtfRighe() {
  const coda = typeof dtfCoda === 'function' ? dtfCoda() : [];
  const senzaFile = (x) => x.kind === 'order' && !dtfOrderStats(x.o).files;
  const proposta = (x) => typeof DtfPrep !== 'undefined' && ['proposta', 'approvato'].includes(DtfPrep.get(x.id)?.esito);
  return {
    file: coda.filter(x => senzaFile(x) && !proposta(x)).map(x => x.o),
    stampa: coda.filter(x => !senzaFile(x)),
  };
}
const TASK_TAG_ESCLUSI = new Set(['test']);
function taskTagCategorie() {
  return (typeof TCFactory !== 'undefined' ? TCFactory.getTags() : [])
    .filter(t => !TASK_TAG_ESCLUSI.has(taskSlug(t.name)) && !TASK_BRAND.some(m => m.id === taskSlug(t.name)))
    .map(t => ({ id: taskSlug(t.name), label: t.name, color: t.color }));
}
function taskCategorie() {
  return [...TASK_CODE, ...TASK_BRAND, ...taskTagCategorie()];
}
const TASK_SENZA_CAT = { id: '_', label: 'Altro', color: '#94a3b8' };
const taskCatInfo = (id) => id === '_' ? TASK_SENZA_CAT : taskCategorie().find(c => c.id === id) || null;
// Ordine del gestionale collegato al task (le fasi di produzione e "Ordine in scadenza")
const taskOrdineGest = (t) => t.fonte === 'gestionale' && t.fonte_rif?.ordine && typeof TCFactory !== 'undefined'
  ? TCFactory.getOrderById(t.fonte_rif.ordine) : null;
// Brand o tag dell'ordine (per le situazioni gestionali e per dire di chi è un ordine in coda)
function taskBrand(t) {
  if (t.macroarea) return t.macroarea;
  const o = taskOrdineGest(t);
  const tag = (o?.tags || []).map(taskSlug).find(id => [...TASK_BRAND, ...taskTagCategorie()].some(c => c.id === id));
  return tag || '_';
}
// Categoria in coda: gli ordini da stampare nelle code di produzione, il resto (mail, indirizzi, giacenze…) nel suo brand
function taskCat(t) {
  if (taskLavoro(t) !== 'stampa') return taskBrand(t);
  const ev = t.fonte_rif?.evento_id || '', tipo = Ctrl.tipo(t.tipo_id);
  if (/:stampa_dtf$/.test(ev) || tipo?.competenza === 'stampa_dtf' || /^stampa dtf/i.test(tipo?.nome || '')) return 'dtf';
  if (/:applica_dtf$/.test(ev) && taskOrdineGest(t)?.stages?.merceCompleta?.done) return 'stampa';
  return 'lavorazione';
}

// Ordini del gestionale: prima gli urgenti, poi la consegna più vicina, poi i più vecchi
const ordinePrioRank = (o) => (typeof isUrgentOrder === 'function' ? isUrgentOrder(o) : o?.priorityId === 'urgente') ? 0 : 1;
const ordineScad = (o) => TCFactory.getEffectiveDeadline?.(o)?.date || o?.deadline || '9';
const ordineCmp = (a, b) => ordinePrioRank(a) - ordinePrioRank(b)
  || ordineScad(a).localeCompare(ordineScad(b)) || (a?.dataOrdine || '').localeCompare(b?.dataOrdine || '');
// Coda DTF: la stessa della pagina DTF (Interno), nello stesso ordine
const ordiniDtf = () => typeof dtfLists === 'function' ? dtfLists().todo : [];
// Coda File: "Fatto" toglie l'ordine dalla coda per tutti (impostazione condivisa)
const CODA_FILE_KEY = 'coda_file_fatti';
const codaFileFatti = () => new Set(TCFactory._settings?.[CODA_FILE_KEY]?.ids || []);
const ordiniSenzaFile = () => {
  if (typeof TCFactory === 'undefined') return [];
  const fatti = codaFileFatti();
  return TCFactory.getActiveOrders().filter(o => !(o.files || []).length && !fatti.has(o.id)).sort(ordineCmp);
};
async function codaFileFatto(id) {
  const ids = [...codaFileFatti(), id];
  try {
    await TCFactory.setSetting(CODA_FILE_KEY, { ids });
    showToast(`"${TCFactory.getOrderById(id)?.nome || id}": file fatti ✓`);
  } catch { showToast('Impossibile segnare come fatto', 'error'); }
  refreshControlPage();
}

// Da stampare o servizio: le lavorazioni degli ordini da una parte; mail, messaggi, giacenze, pagamenti dall'altra
const TASK_COMP_STAMPA = new Set(['ddt', 'preparazione', 'lavorazione', 'spedizione', 'prep_file', 'stampa_dtf', 'stampa_uv', 'stampa_mimaki',
  'incisione_laser', 'ordine_fornitori', 'creazione_pacchi', 'evasione', 'ext_ricamo', 'ext_serigrafia', 'ext_manifattura', 'ext_arti',
  'check_ricamo', 'check_serigrafia', 'check_manifattura', 'check_arti']);
function taskLavoro(t) {
  // Chi scrive al cliente fa servizio, anche se il task parla di un ordine
  if (t.fonte === 'mail' || t.mail_id || t.bozza_risposta) return 'servizio';
  const tipo = Ctrl.tipo(t.tipo_id);
  if (tipo && /dati mancanti|conferma al cliente|nota ordine/i.test(tipo.nome)) return 'servizio';
  if (tipo?.competenza) return TASK_COMP_STAMPA.has(tipo.competenza) ? 'stampa' : 'servizio';
  if (tipo && /stampa/i.test(tipo.nome)) return 'stampa';
  return taskProduttivo(t) || t.fonte === 'file' ? 'stampa' : 'servizio';
}
// Competenze: voci "area:competenza" con primario e secondario (competenze_responsabili); i task senza negozio sono dell'area "produzione"
const TASK_COMPETENZE = [
  { id: 'whatsapp',     label: 'WhatsApp' },
  { id: 'social',       label: 'Messaggi social' },
  { id: 'email',        label: 'Email' },
  { id: 'bonifico',     label: 'Riscontro pagamento con bonifico' },
  { id: 'ddt',          label: 'Stampa DDT ordini Shopify' },
  { id: 'preparazione', label: 'Preparazione per la lavorazione' },
  { id: 'lavorazione',  label: 'Lavorazione' },
  { id: 'spedizione',   label: 'Spedizione' },
  { id: 'post_spedizione', label: 'Gestione post spedizione' },
  { id: 'grafiche',     label: 'Richieste grafiche' },
  { id: 'catalogo',     label: 'Creazione catalogo' },
  { id: 'ext_ricamo',      label: 'Esterna: Ricamo' },
  { id: 'ext_serigrafia',  label: 'Esterna: Serigrafia' },
  { id: 'ext_manifattura', label: 'Esterna: Manifattura' },
  { id: 'ext_arti',        label: 'Esterna: Arti grafiche' },
  { id: 'verifica',        label: 'Verifica automazioni' },
  { id: 'np_bozza',        label: 'Nuovo prodotto: Bozza' },
  { id: 'np_mockup',       label: 'Nuovo prodotto: Mockup' },
  { id: 'np_stampa',       label: 'Nuovo prodotto: File di stampa' },
  { id: 'np_shopify',      label: 'Nuovo prodotto: Shopify' },
  { id: 'np_customily',    label: 'Nuovo prodotto: Customily' },
  { id: 'np_check',        label: 'Nuovo prodotto: Check finale' },
  { id: 'scorte_calzini_check',  label: 'Check scorte calzini' },
  { id: 'scorte_calzini_ordine', label: 'Ordinare scorte calzini' },
  { id: 'carta_check',           label: 'Check carta sublimatica' },
  { id: 'carta_ordine',          label: 'Ordinare carta sublimatica' },
  { id: 'inchiostri_check',      label: 'Check inchiostri e box' },
  { id: 'inchiostri_ordine',     label: 'Ordinare inchiostri e box' },
  { id: 'ordine_fornitori', label: 'Ordine fornitori' },
  { id: 'creazione_pacchi', label: 'Creazione pacchi' },
  { id: 'stampa_dtf',       label: 'Stampa DTF' },
  { id: 'stampa_uv',        label: 'Stampa UV' },
  { id: 'stampa_mimaki',    label: 'Stampa Mimaki' },
  { id: 'incisione_laser',  label: 'Incisione laser' },
  { id: 'evasione',         label: 'Evasione' },
  { id: 'fatturazione',     label: 'Fatturazione' },
  { id: 'check_pagamento',  label: 'Check pagamento' },
  { id: 'prep_file',        label: 'Preparazione file di stampa' },
  { id: 'check_ricamo',      label: 'Check Ricamo' },
  { id: 'check_serigrafia',  label: 'Check Serigrafia' },
  { id: 'check_manifattura', label: 'Check Manifattura' },
  { id: 'check_arti',        label: 'Check Arti grafiche' },
  { id: 'claude_code',       label: 'Lavorazioni con Claude Code (Creative System, Live Printing, Kamon)' },
  { id: 'siti',              label: 'Modifiche al sito (dallo storico di Shopify)' },
];
const COMPETENZE_BASE = ['whatsapp', 'social', 'email', 'bonifico', 'ddt', 'preparazione', 'lavorazione', 'spedizione', 'post_spedizione'];
const COMPETENZE_NUOVO_PRODOTTO = ['np_bozza', 'np_mockup', 'np_stampa', 'np_shopify', 'np_customily', 'np_check'];
const COMPETENZE_NEGOZIO = {
  ciucciamilcalzino: ['scorte_calzini_check', 'scorte_calzini_ordine', 'carta_check', 'carta_ordine', 'inchiostri_check', 'inchiostri_ordine'],
  boxfactorylab: ['grafiche', 'catalogo', 'fatturazione', 'check_pagamento'],
};
const TASK_AREE = [
  ...TASK_BRAND.map(m => ({
    ...m,
    competenze: [...COMPETENZE_BASE, ...(COMPETENZE_NEGOZIO[m.id] || []), ...(isNegozioShopify(m.id) ? [...COMPETENZE_NUOVO_PRODOTTO, 'siti'] : [])],
    // Stessa competenza dei task (preparazione), altro nome in questi negozi
    etichette: m.id === 'asteroidi' ? {} : { preparazione: 'Preparazione file di stampa' },
  })),
  { id: 'produzione', label: 'Linea produttiva', color: '#64748b', competenze: [
    'ordine_fornitori', 'creazione_pacchi', 'prep_file', 'stampa_dtf', 'stampa_uv', 'stampa_mimaki', 'incisione_laser',
    'lavorazione', 'spedizione', 'post_spedizione', 'evasione',
    'ext_ricamo', 'ext_serigrafia', 'ext_manifattura', 'ext_arti',
    'check_ricamo', 'check_serigrafia', 'check_manifattura', 'check_arti',
    'fatturazione', 'check_pagamento',
  ] },
  { id: 'automazioni', label: 'Automazioni', color: '#111827', competenze: ['verifica'] },
  { id: 'sviluppo', label: 'Sviluppo', color: '#d97757', competenze: ['claude_code'] },
];
const TASK_ESCLUSI = new Set(['tcfactory', 'andrea']);
const competenzaLabel = (id) => TASK_COMPETENZE.find(c => c.id === id)?.label || id;
// Stati ancora da lavorare: se il giorno passa, il task diventa arretrato
const TASK_APERTI = ['da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'];
// Stati che chiedono il motivo
const TASK_CON_MOTIVO = ['rimandato', 'bloccato', 'non_completato'];
// Chiusure fatte dal cervello (supabase/functions/cervello/verifica.ts): il motivo si mostra anche da completato
const taskMotivoVisibile = (stato, motivo) => !!motivo && (TASK_CON_MOTIVO.includes(stato) || (stato === 'completato' && motivo.startsWith('Chiuso in automatico')));
// Campioni minimi prima di proporre il tempo reale come nuovo standard
const TASK_CAMPIONI_MIN = 5;

const taskStato = (id) => TASK_STATI.find(s => s.id === id) || TASK_STATI[0];
const taskPrio  = (id) => TASK_PRIORITA.find(p => p.id === id) || TASK_PRIORITA[2];
const taskPrioRank = (id) => Math.max(0, TASK_PRIORITA.findIndex(p => p.id === id));

// Date in ora italiana, come 'YYYY-MM-DD'
const ctrlOggi = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const ctrlAddDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ctrlFmtGiorno = (iso) => {
  const oggi = ctrlOggi();
  if (iso === oggi) return 'Oggi';
  if (iso === ctrlAddDays(oggi, -1)) return 'Ieri';
  if (iso === ctrlAddDays(oggi, 1)) return 'Domani';
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
};
const ctrlFmtOra = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const ctrlFmtQuando = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
// Durata in secondi → "1:05:09" o "5:09"
const ctrlFmtDur = (sec) => {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const ctrlFmtMin = (min) => {
  min = Math.round(min || 0);
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}′` : ''}` : `${min}′`;
};
// Secondi lavorati, compresa la sessione in corso
const taskLavoratoSec = (t) => (t.lavorato_sec || 0) + (t.lavoro_dal ? (Date.now() - new Date(t.lavoro_dal)) / 1000 : 0);
// Prova dei tempi di lavorazione: i task produttivi, solo mentre la prova è attiva.
// Fasi degli ordini del gestionale (non ordinare la merce, controlli esterni, fattura e incasso) e lotti Shopify
const taskLottoLav = (t) => t.fonte === 'shopify' && t.fonte_rif?.fase === 'lav';
const taskProduttivo = (t) => (t.fonte === 'gestionale' && /^prod:/.test(t.fonte_rif?.evento_id || '')
    && !/:(ordinare|fattura|incasso|controllo:.*)$/.test(t.fonte_rif.evento_id))
  || (t.fonte === 'shopify' && ['prep', 'lav', 'spedire'].includes(t.fonte_rif?.fase));
const taskInProva = (t) => !!Ctrl.tempiTest?.attivo && taskProduttivo(t);
const taskMisurato = (t) => taskProduttivo(t) && (t.stato === 'in_lavorazione' || t.lavorato_sec > 0);
// I task di una persona: quelli che ha preso e quelli liberi designati a lei
const taskMio = (t, nick) => t.assegnato_a === nick || (!t.assegnato_a && t.designato === nick);

const CtrlIcons = {
  play:  (s = 14) => `<svg viewBox="0 0 24 24" fill="currentColor" width="${s}" height="${s}" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>`,
  pause: (s = 14) => `<svg viewBox="0 0 24 24" fill="currentColor" width="${s}" height="${s}" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1.2"/><rect x="14" y="4" width="4" height="16" rx="1.2"/></svg>`,
  check: (s = 14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`,
  undo:  (s = 14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>`,
  more:  (s = 16) => `<svg viewBox="0 0 24 24" fill="currentColor" width="${s}" height="${s}" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`,
  hand:  (s = 14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`,
};

// ─────────────────────────────────────────────
// DATI
// ─────────────────────────────────────────────

const Ctrl = {
  view: 'giorno',        // giorno (sezione Tasks) | cervello | collegamenti | automazioni | competenze | squadra | report (Centro di controllo)
  viewCtrl: 'cervello',  // ultima scheda aperta nel Centro di controllo
  giorno: ctrlOggi(),    // giorno mostrato
  macroarea: null,       // filtro per brand dei task di una persona (null = tutti)
  coda: 'file',          // coda comune: file, dtf, stampa, lavorazione o un brand
  tasks: [],             // task del giorno + arretrati aperti dei giorni prima
  tipi: [],
  users: [],             // nickname dello staff
  operatori: [],         // impostazioni del piano del giorno (task_operatori)
  responsabili: {},      // voce "area:competenza" → { primario, secondario }
  flusso: null,          // task entrati e chiusi nel giorno (tutto il team)
  assenti: new Set(),    // chi è in ferie o a un evento nel giorno scelto
  problemi: [],          // collegamenti con problemi, in cima alla pagina (solo admin)
  persona: null,         // admin: tutti i task di questa persona al posto della pagina
  punteggi: {},          // operatore → punteggio del giorno mostrato
  punteggi7: {},         // operatore → punteggio degli ultimi 7 giorni
  tempi: {},             // tipo_id → { campioni, mediana_minuti }
  loaded: false,
  error: null,
  badge: 0,              // task aperti di oggi della persona collegata
  _channel: null,
  _reloadTimer: null,
  _tick: null,

  _me() { return TCAuth.getNickname(); },

  _fail(error) {
    // Tabelle assenti: lo script SQL non è ancora stato eseguito
    if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code) || /does not exist|schema cache|Could not find/i.test(error.message || '')) {
      return Object.assign(new Error('Centro di controllo non ancora attivato sul database'), { notInstalled: true });
    }
    return new Error(error.message || 'Errore di connessione');
  },

  async _rpc(fn, args = {}) {
    const { data, error } = await supabaseClient.rpc(fn, args);
    if (error) throw this._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    return data;
  },

  async load() {
    const d = this.giorno;
    try {
      const aperti = TASK_APERTI.join(',');
      const ini = new Date(`${d}T00:00:00`), fin = new Date(ini.getTime() + 86400000);
      const [tasks, tipi, users, prova, fatti, chiusi] = await Promise.all([
        supabaseClient.from('tasks').select('*')
          .or(`giorno.eq.${d},and(giorno.lt.${d},stato.in.(${aperti}))`)
          .order('created_at'),
        supabaseClient.from('task_tipi').select('*').order('nome'),
        this.users.length ? null : TCAuth.listUsers().catch(() => []),
        supabaseClient.from('app_settings').select('key, value').in('key', ['tempi_test', 'team_ordine']),
        // Task chiusi dall'utente nel giorno, anche se erano in lista da prima
        supabaseClient.from('tasks').select('*').eq('stato', 'completato').eq('assegnato_a', this._me())
          .gte('completato_at', ini.toISOString()).lt('completato_at', fin.toISOString()).order('completato_at', { ascending: false }),
        // Task chiusi nel giorno da tutti: per il team (fatti e ore) e il lavoro di Claude
        supabaseClient.from('tasks').select('*').eq('stato', 'completato')
          .gte('completato_at', ini.toISOString()).lt('completato_at', fin.toISOString()).order('completato_at', { ascending: false }),
      ]);
      this.mieiFatti = fatti?.data || [];
      this.chiusiOggi = chiusi?.data || [];
      this.claudeFatti = this.chiusiOggi.filter(t => t.assegnato_a === 'claude' || ['github', 'claude_code'].includes(t.fonte));
      const imp = Object.fromEntries((prova?.data || []).map(r => [r.key, r.value]));
      this.tempiTest = imp.tempi_test || {};
      this.teamOrdine = Array.isArray(imp.team_ordine) ? imp.team_ordine : [];
      if (tasks.error) throw this._fail(tasks.error);
      if (tipi.error)  throw this._fail(tipi.error);
      this.tasks = tasks.data || [];
      this.tipi  = tipi.data || [];
      // Nella lista dei task tutti tranne l'account condiviso tcfactory e chi non lavora sui task
      if (users) this.users = users.filter(u => !TASK_ESCLUSI.has(u.nickname)).map(u => u.nickname);

      if (TCAuth.isAdmin()) {
        // Flusso del giorno: task entrati e chiusi da tutto il team (gli stessi che conta l'avanzamento)
        const conta = () => supabaseClient.from('tasks').select('id', { count: 'exact', head: true });
        const [oggi, sette, tempi, operatori, problemi, responsabili, calendario, reti, entrati, chiusi] = await Promise.all([
          this._rpc('tc_task_punteggi', { p_dal: d, p_al: d }),
          this._rpc('tc_task_punteggi', { p_dal: ctrlAddDays(d, -6), p_al: d }),
          this._rpc('tc_task_tempi_reali'),
          supabaseClient.from('task_operatori').select('*'),
          this._rpc('tc_problemi_collegamenti').catch(() => ({ problemi: [] })),
          supabaseClient.from('competenze_responsabili').select('*'),
          supabaseClient.from('calendar_events').select('user_ids').lte('date_from', d).gte('date_to', d).in('event_type', ['ferie', 'impegno']),
          supabaseClient.from('presenze_reti').select('*').order('aggiunta_at'),
          conta().gte('created_at', ini.toISOString()).lt('created_at', fin.toISOString()),
          conta().eq('stato', 'completato').gte('completato_at', ini.toISOString()).lt('completato_at', fin.toISOString()),
        ]);
        this.flusso = entrati.error || chiusi.error ? null : { entrati: entrati.count || 0, chiusi: chiusi.count || 0 };
        this.reti = reti.data || [];
        this.assenti = new Set((calendario.data || []).flatMap(e => e.user_ids || []));
        this.responsabili = Object.fromEntries((responsabili.data || []).map(r => [r.voce, r]));
        this.operatori = operatori.data || [];
        this.problemi = problemi.problemi || [];
        this.punteggi  = Object.fromEntries((oggi.punteggi || []).map(p => [p.operatore, p]));
        this.punteggi7 = Object.fromEntries((sette.punteggi || []).map(p => [p.operatore, p]));
        this.tempi     = Object.fromEntries((tempi.tempi || []).map(t => [t.tipo_id, t]));
      }
      this.error = null;
    } catch (e) {
      this.error = e;
    }
    this.loaded = true;
  },

  async loadBadge() {
    // All'admin la coda da assegnare, agli altri i propri task
    const q = supabaseClient.from('tasks').select('id', { count: 'exact', head: true }).lte('giorno', ctrlOggi()).in('stato', TASK_APERTI);
    const me = this._me();
    const { count, error } = await (TCAuth.isAdmin() ? q.is('assegnato_a', null).is('designato', null)
      : q.or(`assegnato_a.eq.${me},and(assegnato_a.is.null,designato.eq.${me})`));
    const n = error ? 0 : (count || 0);
    if (n !== this.badge) { this.badge = n; renderSidebar(); }
  },

  // Aggiornamento in tempo reale: qualsiasi modifica ai task ricarica la pagina aperta
  start() {
    if (!Nav.isAllowed('tasks') && !Nav.isAllowed('controllo')) return;
    this.loadBadge();
    this._channel = supabaseClient.channel('tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => this._scheduleReload())
      .subscribe();
  },

  stop() {
    if (this._channel) supabaseClient.removeChannel(this._channel);
    fermaConsumiInDiretta();
    clearTimeout(this._reloadTimer);
    clearInterval(this._tick);
    Object.assign(this, { _channel: null, _tick: null, tasks: [], tipi: [], users: [], punteggi: {}, punteggi7: {},
      tempi: {}, loaded: false, error: null, badge: 0, view: 'giorno', viewCtrl: 'cervello', giorno: ctrlOggi() });
  },

  _scheduleReload() {
    clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(async () => {
      this.loadBadge();
      if (!ctrlAperto()) return;
      await this.load();
      refreshControlPage();
    }, 400);
  },

  // ── Azioni ──

  async setStato(id, stato, motivo = null, giorno = null) {
    const t = this.tasks.find(x => x.id === id);
    await this._rpc('tc_task_stato', { p_id: id, p_stato: stato, p_motivo: motivo, p_giorno: giorno });
    if (stato === 'completato' && t) await taskAggiornaOrdine(t);
    // Spedizione col task chiuso: esce subito dalla lista (il database fa lo stesso al prossimo caricamento)
    if (['completato', 'non_completato'].includes(stato) && typeof ShopLinks !== 'undefined' && ShopLinks.consegne)
      ShopLinks.consegne = ShopLinks.consegne.filter(c => c.task_id !== id);
  },
  async prendi(id) { await this._rpc('tc_task_prendi', { p_id: id }); },

  async saveTask(id, row) {
    const q = id ? supabaseClient.from('tasks').update(row).eq('id', id)
                 : supabaseClient.from('tasks').insert(row);
    const { error } = await q;
    if (error) throw this._fail(error);
  },
  async deleteTask(id) {
    const { error } = await supabaseClient.from('tasks').delete().eq('id', id);
    if (error) throw this._fail(error);
  },

  async saveTipo(id, row) {
    const q = id ? supabaseClient.from('task_tipi').update(row).eq('id', id)
                 : supabaseClient.from('task_tipi').insert(row);
    const { error } = await q;
    if (error) throw error.code === '23505' ? new Error('Esiste già un tipo con questo nome') : this._fail(error);
  },
  async deleteTipo(id) {
    const { error } = await supabaseClient.from('task_tipi').delete().eq('id', id);
    if (error) throw this._fail(error);
  },

  async storico(id) {
    const { data, error } = await supabaseClient.from('task_storico').select('*').eq('task_id', id).order('at');
    if (error) throw this._fail(error);
    return data || [];
  },

  get(id)     { return this.tasks.find(t => t.id === id) || this.mieiFatti?.find(t => t.id === id) || this.chiusiOggi?.find(t => t.id === id); },
  tipo(id)    { return this.tipi.find(t => t.id === id); },
  canAct(t)   { return TCAuth.isAdmin() || !t.assegnato_a || t.assegnato_a === this._me(); },
};

window.Ctrl = Ctrl;

// Ordine dentro un gruppo: in corso, poi priorità, poi scadenza, poi arrivo
// Ordine dei task (deciso da Riccardo il 2026-11-19): prima la scadenza, a parità la data di creazione.
// Per i task di un ordine del gestionale contano la consegna attuale dell'ordine e la sua data,
// non i valori copiati nel task quando è nato. Priorità e "in lavorazione" non contano più.
function taskScadVera(t) {
  const o = taskOrdineGest(t);
  if (o) return ordineScad(o);
  return t.scadenza ? ctrlGiornoDi(t.scadenza) : '9';
}
const taskCreato = (t) => taskOrdineGest(t)?.dataOrdine || String(t.created_at || '');
const taskCmp = (a, b) => taskScadVera(a).localeCompare(taskScadVera(b)) || taskCreato(a).localeCompare(taskCreato(b));
function sortTasks(list) {
  return list.slice().sort(taskCmp);
}

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

// Pagine che usano i dati dei task: Tasks (vista giorno) e Centro di controllo (le altre schede)
const ctrlAperto = () => Nav.current === 'controllo' || Nav.current === 'tasks';

// Sezione Tasks: #/tasks/task/<id> apre quel task
async function openTasksPage() {
  const [dove, taskId] = (Nav.param || '').split('/');
  if (dove) { history.replaceState(null, '', '#/tasks'); Nav.param = null; }
  Ctrl.view = 'giorno';
  Ctrl.persona = null;
  refreshControlPage();
  await Ctrl.load();
  refreshControlPage();
  if (dove === 'task' && taskId) apriTaskDaLink(taskId);
}

async function openControlPage() {
  // Vecchi link: #/controllo/task/<id> → Tasks, #/controllo/gls → Spedizioni in Brand
  const [dove, taskId] = (Nav.param || '').split('/');
  if (dove === 'gls') { Nav.go('comunicazione', `${comOrdine()[0].id}/spedizioni`); return; }
  if (dove === 'task') { Nav.go('tasks', taskId ? `task/${taskId}` : null); return; }
  Ctrl.view = dove === 'collegamenti' ? 'collegamenti' : Ctrl.viewCtrl;
  if (dove) { history.replaceState(null, '', '#/controllo'); Nav.param = null; }
  refreshControlPage();
  await Ctrl.load();
  refreshControlPage();
  loadControlExtras();
  if (dove === 'collegamenti' && /^(instagram|messenger):/.test(taskId || '')) esitoLoginMeta(taskId);
}

// Il task del link può non essere tra quelli del giorno caricati: si legge e si aggiunge
async function apriTaskDaLink(id) {
  if (!Ctrl.get(id)) {
    const { data } = await supabaseClient.from('tasks').select('*').eq('id', id).maybeSingle();
    if (!data) { uiAlert('Il task non esiste più o non hai accesso.'); return; }
    if (!Ctrl.get(id)) Ctrl.tasks.push(data);
  }
  if (ctrlAperto()) openTaskDetail(id);
}

function refreshControlPage() {
  // Shop e Spedizioni ora stanno nella pagina Negozi
  if (Nav.current === 'comunicazione' && comCanaleShop(Comun.canale)) { renderComunicazionePage(); return; }
  if (!ctrlAperto()) return;
  // Un aggiornamento in tempo reale non deve cancellare le regole in modifica
  if (Ctrl.view === 'cervello' && CtrlBrain.sez === 'regole' && CtrlBrain.modificato) return;
  renderControlPage();
  renderHeader();
}

// Scelta del giorno nella testata della pagina (la inserisce renderHeader)
function controlDayNav() {
  if (!ctrlAperto() || !['giorno', 'squadra'].includes(Ctrl.view)) return '';
  return `
    <div class="ctrl-daynav" role="group" aria-label="Giorno">
      <button class="btn-icon" onclick="setControlDay('${ctrlAddDays(Ctrl.giorno, -1)}')" aria-label="Giorno prima">${Icons.chevronLeft(16)}</button>
      <label class="ctrl-day-label">
        <span>${ctrlFmtGiorno(Ctrl.giorno)}</span>
        <input type="date" value="${Ctrl.giorno}" onchange="setControlDay(this.value)" aria-label="Scegli il giorno">
      </label>
      <button class="btn-icon" onclick="setControlDay('${ctrlAddDays(Ctrl.giorno, 1)}')" aria-label="Giorno dopo">${Icons.chevronRight(16)}</button>
      ${Ctrl.giorno !== ctrlOggi() ? `<button class="ctrl-today" onclick="setControlDay()">${CtrlIcons.undo(13)} Oggi</button>` : ''}
    </div>`;
}

async function setControlView(view) {
  if (!(await leaveRulesOk())) return;
  Ctrl.view = Ctrl.viewCtrl = view;
  refreshControlPage();
  loadControlExtras();
}

// Dati delle schede che li caricano quando si aprono
function loadControlExtras() {
  if (['cervello', 'collegamenti'].includes(Ctrl.view)) loadShopifyLinks();
  if (Ctrl.view === 'cervello') loadBrainRules();
  if (Ctrl.view === 'cervello' && CtrlBrain.sez === 'tempi') loadTempiLavorazione();
  if (Ctrl.view === 'report') loadControlReport();
  if (Ctrl.view === 'automazioni') loadControlAutomations();
  if (Ctrl.view === 'attivazioni') loadControlAttivazioni();
  if (Ctrl.view === 'uso') loadUsoMac();
  if (Ctrl.view === 'costi') loadControlCosti();
  if (Ctrl.view === 'costivivi') loadCostiVivi();
}

async function setControlDay(iso) {
  Ctrl.giorno = iso || ctrlOggi();
  Ctrl.loaded = false;
  refreshControlPage();
  await Ctrl.load();
  refreshControlPage();
}

function renderControlPage() {
  const inTasks = Nav.current === 'tasks';
  const root = document.getElementById(inTasks ? 'tasks-root' : 'controllo-root');
  if (!root) return;

  if (Ctrl.error?.notInstalled) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.zap(28)}</div>
        <h2>Centro di controllo da attivare</h2>
        <p>Esegui lo script <strong>sql/centro-controllo.sql</strong> su Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }

  const tabs = inTasks ? [] : [['cervello', 'Cervello'], ['collegamenti', 'Collegamenti'], ['automazioni', 'Automazioni'], ['competenze', 'Competenze'], ['squadra', 'Team'], ['report', 'Report'], ['attivazioni', 'Attivazioni'], ['uso', 'Uso dei Mac'], ['costivivi', 'Costi vivi'], ['costi', 'Costi servizi']];
  const body = !Ctrl.loaded ? `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`
    : Ctrl.error ? `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(Ctrl.error.message)}</div></div>`
    : Ctrl.view === 'squadra' ? renderControlTeam()
    : Ctrl.view === 'cervello' ? renderControlBrain()
    : Ctrl.view === 'collegamenti' ? renderControlLinks()
    : Ctrl.view === 'automazioni' ? renderControlAutomations()
    : Ctrl.view === 'competenze' ? renderControlSkills()
    : Ctrl.view === 'report' ? renderControlReport()
    : Ctrl.view === 'attivazioni' ? renderControlAttivazioni()
    : Ctrl.view === 'uso' ? renderUsoMac()
    : Ctrl.view === 'costi' ? renderControlCosti()
    : Ctrl.view === 'costivivi' ? renderCostiVivi()
    : renderControlMyDay();

  root.innerHTML = `
    ${tabs.length ? `<div class="ctrl-bar">
      ${tabs.length > 1 ? `<div class="segmented" role="tablist" aria-label="Vista">
        ${tabs.map(([id, label]) => `<button role="tab" aria-selected="${Ctrl.view === id}" class="${Ctrl.view === id ? 'active' : ''}"
          onclick="setControlView('${id}')">${label}</button>`).join('')}
      </div>` : ''}
    </div>` : ''}
    ${TCAuth.isAdmin() && Ctrl.problemi.length ? `
      <div class="ctrl-alert" role="alert">
        <div><strong>${Ctrl.problemi.length === 1 ? 'Un collegamento ha un problema' : `${Ctrl.problemi.length} collegamenti hanno un problema`}</strong>
          ${Ctrl.problemi.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>
        ${Ctrl.view !== 'collegamenti' ? `<button class="ctrl-btn" onclick="${inTasks ? `Nav.go('controllo', 'collegamenti')` : `setControlView('collegamenti')`}">Vai a Collegamenti</button>` : ''}
      </div>` : ''}
    ${body}`;

  root.querySelectorAll?.('.ctrl-rule textarea').forEach(ctrlGrow);
  CtrlAnim.filtro = null;
  startControlTicker();
}

// Aggiorna ogni secondo i cronometri dei task in lavorazione
function startControlTicker() {
  clearInterval(Ctrl._tick);
  if (!document.querySelector('[data-task-timer]')) { Ctrl._tick = null; return; }
  Ctrl._tick = setInterval(() => {
    if (!ctrlAperto()) { clearInterval(Ctrl._tick); Ctrl._tick = null; return; }
    document.querySelectorAll('[data-task-timer]').forEach(el => {
      const t = Ctrl.get(el.dataset.taskTimer);
      if (t) el.textContent = ctrlFmtDur(taskLavoratoSec(t));
    });
  }, 1000);
}

// ── Tasks ──

// I task di una persona: i propri per l'operatore, quelli di chi ha scelto per l'admin
function renderControlMyDay(persona = null) {
  if (TCAuth.isAdmin() && !persona) return renderControlAdminTasks();
  const me = persona || Ctrl._me(), d = Ctrl.giorno;
  const mine = Ctrl.tasks.filter(t => taskMio(t, me));
  const delGiorno = mine.filter(t => t.giorno === d);
  const arretrati = mine.filter(t => t.giorno < d);
  const coda = persona ? [] : Ctrl.tasks.filter(t => !t.assegnato_a && t.designato !== me);

  const daFare   = delGiorno.filter(t => ['da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'].includes(t.stato));
  const bloccati = delGiorno.filter(t => t.stato === 'bloccato');
  const chiusi   = delGiorno.filter(t => ['completato', 'non_completato'].includes(t.stato));

  const minTot  = delGiorno.filter(t => t.stato !== 'bloccato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);
  const minFatti = delGiorno.filter(t => t.stato === 'completato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);

  // Il negozio si dice una volta sola: sulla riga solo se nella lista ce ne sono diversi
  const aperti = [...daFare, ...arretrati, ...bloccati];
  const negoziLista = new Set(aperti.map(taskCat));
  const conNegozio = aperti.filter(t => taskCat(t) !== '_');
  const unicoNegozio = negoziLista.size === 1 && conNegozio[0] ? taskCatInfo(taskCat(conNegozio[0])) : null;
  const vedi = (list) => Ctrl.macroarea ? list.filter(t => taskCat(t) === Ctrl.macroarea) : list;
  const visibili = vedi(aperti);
  const opts = { showStore: !Ctrl.macroarea && negoziLista.size > 1, showAuto: false };
  const barraNegozi = new Set(conNegozio.map(taskCat)).size > 1 || Ctrl.macroarea;

  // Il tasto giallo va solo sul prossimo task da fare
  Ctrl._prossimo = (sortTasks(vedi(daFare))[0] || sortTasks(vedi(arretrati))[0] || sortTasks(vedi(coda))[0])?.id;

  const stat = (label, value, sub = '', glow = 'var(--brand-gold)') => `
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:${glow};"></div>
      <div class="stat-card-label">${label}</div>
      <div class="stat-card-value">${value}</div>
      ${sub ? `<div class="ctrl-stat-sub">${sub}</div>` : ''}
    </div>`;

  return `
    ${persona ? `<div class="ctrl-persona-head">
      <button type="button" class="ctrl-btn" onclick="openPersonTasks(null)">${Icons.chevronLeft(14)} Tutto il team</button>
      ${Ctrl.assenti.has(me) && me !== 'claude' ? '<span class="ctrl-preview-off">Assente</span>' : ''}</div>` : renderPresenzeOggi()}
    <div class="stat-grid ctrl-stats">
      ${stat('Task', `${chiusi.filter(t => t.stato === 'completato').length}/${delGiorno.length}`, 'completati', '#22c55e')}
      ${stat('Tempo stimato', `${ctrlFmtMin(minFatti)} <small>/ ${ctrlFmtMin(minTot)}</small>`, 'dei task completati', '#6366f1')}
      ${stat('Da fare', ctrlFmtMin(minTot - minFatti), 'stima del lavoro che resta', '#f59e0b')}
    </div>

    ${renderTaskDuo(me, persona)}
    ${chiusi.length ? `
      <details class="glass-card page-card ctrl-group ctrl-closed">
        <summary class="page-card-head"><h2>Chiusi</h2><span class="table-count">${chiusi.length}</span></summary>
        <div class="task-list task-stack">${sortTasks(chiusi).map(t => renderTaskRow(t)).join('')}</div>
      </details>` : ''}`;
}

// Apertura di Tasks: a sinistra i task assegnati alla persona, a destra la coda comune
function renderTaskDuo(me, persona = null) {
  const d = Ctrl.giorno;
  const mine = Ctrl.tasks.filter(t => taskMio(t, me));
  const delGiorno = mine.filter(t => t.giorno === d);
  const arretrati = mine.filter(t => t.giorno < d && !taskChiuso(t));
  const daFare   = delGiorno.filter(t => ['da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'].includes(t.stato));
  const bloccati = delGiorno.filter(t => t.stato === 'bloccato');
  const coda = persona ? [] : Ctrl.tasks.filter(t => !t.assegnato_a && !taskChiuso(t) && t.designato !== me);
  const aperti = [...daFare, ...arretrati, ...bloccati];
  const negoziLista = new Set(aperti.map(taskCat));
  const conNegozio = aperti.filter(t => taskCat(t) !== '_');
  const unicoNegozio = negoziLista.size === 1 && conNegozio[0] ? taskCatInfo(taskCat(conNegozio[0])) : null;
  const vedi = (list) => Ctrl.macroarea ? list.filter(t => taskCat(t) === Ctrl.macroarea) : list;
  const visibili = vedi(aperti);
  const opts = { showStore: !Ctrl.macroarea && negoziLista.size > 1, showAuto: false };
  const barraNegozi = new Set(conNegozio.map(taskCat)).size > 1 || Ctrl.macroarea;
  if (!persona) {
    // I task sono tutti comuni: la coda prende lo spazio, a destra quello che ho chiuso
    const comuni = Ctrl.tasks.filter(t => !taskChiuso(t) && (!t.assegnato_a || t.assegnato_a === me));
    return `
    <div class="tk-split is-coda">
      ${renderTaskQueue(comuni, 'Nessun task in coda comune.')}
      ${renderTaskFatti()}
    </div>`;
  }
  return `
    <div class="tk-split ${coda.length || !persona ? '' : 'is-solo'}">
      <section class="glass-card page-card ctrl-group tk-split-box">
        <div class="page-card-head"><h2>${persona ? `Task di <span class="ctrl-persona-nome">${escapeHtml(me)}</span>` : 'I miei task'}</h2><span class="table-count">${visibili.length}</span>
          ${unicoNegozio ? `<span class="ctrl-group-hint ctrl-macro-tag" style="--m:${unicoNegozio.color};">${unicoNegozio.label}</span>` : ''}</div>
        ${barraNegozi ? taskMacroBar(aperti) : ''}
        ${taskAutoNote(visibili)}
        <div class="tk-split-list">
          ${taskSub('Da fare', vedi(daFare), opts)}
          ${taskSub('Arretrati', vedi(arretrati), opts)}
          ${taskSub('Bloccati', vedi(bloccati), opts)}
          ${visibili.length ? '' : `<div class="empty-list">${aperti.length ? 'Nessun task per questo negozio.' : d === ctrlOggi() ? 'Niente da fare per oggi.' : 'Nessun task per questo giorno.'}</div>`}
        </div>
      </section>
      ${persona ? '' : renderTaskQueue(coda, 'Nessun task in coda comune.')}
    </div>`;
}

// Tempo reale del giorno, in minuti: dall'orario di ingresso (o dalla prima operazione, se viene prima)
// fino a adesso; per i giorni passati fino all'ultimo task chiuso
function tempoRealeGiorno(list, d) {
  const oggi = d === ctrlOggi();
  const ms = (x) => x ? new Date(x).getTime() : NaN;
  const inizi = list.map(t => ms(t.completato_at) - (t.lavorato_sec || 0) * 1000);
  const ora = Presenze.stato?.me?.ora_inizio;
  if (ora) inizi.push(new Date(`${d}T${ora}:00`).getTime());
  if (oggi) inizi.push(ms(Presenze.stato?.me?.confermato_at));
  const inizio = Math.min(...inizi.filter(Number.isFinite));
  const fine = oggi ? Date.now() : Math.max(...list.map(t => ms(t.completato_at)).filter(Number.isFinite));
  if (!Number.isFinite(inizio) || !Number.isFinite(fine) || fine <= inizio) return 0;
  return Math.round((fine - inizio) / 60000);
}

// Pannello a destra: i task chiusi dall'utente nel giorno, con il resoconto
function renderTaskFatti() {
  const list = Ctrl.mieiFatti || [];
  const d = Ctrl.giorno;
  const stimati = list.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
  const reale = tempoRealeGiorno(list, d);
  const oper = reale && stimati ? Math.round(stimati / reale * 100) : null;
  return `
    <aside class="glass-card page-card ctrl-group tk-fatti">
      <div class="page-card-head"><h2>Fatti da me</h2><span class="table-count">${list.length}</span></div>
      <div class="tk-fatti-sum">
        <div><strong>${list.length}</strong><span>task chiusi</span></div>
        <div><strong>${reale ? ctrlFmtMin(reale) : '—'}</strong><span>tempo reale</span></div>
        <div><strong>${ctrlFmtMin(stimati)}</strong><span>tempo stimato</span></div>
        <div class="tk-oper ${oper == null ? '' : oper >= 100 ? 'is-top' : oper >= 75 ? 'is-ok' : oper >= 50 ? 'is-mid' : 'is-low'}" style="--p:${Math.min(oper || 0, 100)}%;--s:${oper > 100 ? Math.min((oper - 100) / 100, 1).toFixed(2) : 0};">
          <strong>${oper == null ? '—' : `${oper}%`}</strong><span>operatività</span>
          <i class="tk-oper-track"><i class="tk-oper-bar"><b></b></i>${oper > 100 ? '<i class="tk-oper-spark" aria-hidden="true"><s></s><s></s><s></s><s></s></i>' : ''}</i></div>
      </div>
      ${list.length ? `<ul class="tk-fatti-list">${list.map(t => {
        const macro = taskBrand(t) === '_' ? null : taskCatInfo(taskBrand(t));
        return `
          <li><button type="button" onclick="openTaskDetail('${t.id}')" title="${escapeHtml(t.titolo)}">
            <span class="tk-fatti-ok" aria-hidden="true">${CtrlIcons.check(12)}</span>
            <span class="tk-fatti-txt"><strong>${escapeHtml(t.titolo)}</strong>
              <small>${ctrlFmtOra(t.completato_at)}${macro ? ` · <span style="color:${macro.color};">${escapeHtml(macro.label)}</span>` : ''}${t.minuti_stimati ? ` · ${ctrlFmtMin(t.minuti_stimati)}` : ''}</small></span>
          </button></li>`;
      }).join('')}</ul>`
        : `<div class="empty-list">Ancora nessun task chiuso${d === ctrlOggi() ? ' oggi' : ''}.</div>`}
    </aside>`;
}

// ── Tasks (admin): panoramica di produzione ──
// L'admin non ha task suoi: numeri del giorno, cosa gestire subito, carico del team e la tabella di tutti i task

const TASK_TABS = [
  ['coda', 'Coda di lavorazione'], ['oggi', 'Oggi'], ['ritardo', 'In ritardo'], ['assegnare', 'Senza designato'], ['chiusi', 'Completati'], ['tutti', 'Tutti'],
];
const TASK_PAGINA = 50;
const TaskView = { tab: 'coda', brand: '', tipo: '', chi: '', prio: '', stato: '', scad: '', q: '', ordina: 'scadenza', limite: TASK_PAGINA, sel: new Set(), bulkChi: '' };
const TASK_FILTRI = ['brand', 'tipo', 'chi', 'prio', 'stato', 'scad', 'q'];

const TkIcons = {
  alert: (s = 22) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  user: (s = 22) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>`,
  list: (s = 18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>`,
  layers: (s = 22) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  code: (s = 17) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  arrow: (s = 15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
};

const taskChiuso = (t) => ['completato', 'non_completato'].includes(t.stato);
// Scadenza vera (giorno), null se il task non ne ha: il giorno in lista è un'altra cosa
const taskScad = (t) => t.scadenza ? ctrlGiornoDi(t.scadenza) : null;
const taskScaduto = (t) => !!t.scadenza && !taskChiuso(t) && new Date(t.scadenza) < new Date();
// Per ordinare: prima chi ha la scadenza, poi chi è in lista da più tempo
const taskCmpScad = (a, b) => (taskScad(a) || '9').localeCompare(taskScad(b) || '9') || a.giorno.localeCompare(b.giorno);
const taskInListaTesto = (t) => {
  if (t.giorno >= ctrlOggi()) return '';
  return `in lista dal ${taskDataBreve(t.giorno)}`;
};
// Carico di una persona: task aperti non bloccati, minuti stimati, ore della giornata se impostate nel piano
// Aperti: presi dalla persona o liberi col suo nome come designato
function taskCarico(nick, extra = 0) {
  const suoi = Ctrl.tasks.filter(t => taskMio(t, nick) && !taskChiuso(t) && t.stato !== 'bloccato');
  const min = suoi.reduce((n, t) => n + (t.minuti_stimati || 0), 0) + extra;
  const cap = Ctrl.operatori.find(o => o.nickname === nick)?.minuti_giorno || null;
  return { n: suoi.length, min, cap, pct: cap ? Math.round(min / cap * 100) : null };
}
const taskCaricoTesto = (c) => `${ctrlFmtMin(c.min)}${c.cap ? ` / ${ctrlFmtMin(c.cap)}` : ''}`;

// Titolo "Attività · Cliente · ordine #123": l'attività a sinistra, il cliente nella sua colonna
function taskParti(t) {
  // Commit: il titolo intero è l'attività, il progetto sta nel cliente
  if (t.fonte === 'shopify_admin') return { attivita: t.titolo.replace(/^[^:]+:\s*/, 'Modifiche al sito: '), cliente: '', ordine: null };
  // Lavoro sui file (TC Lavoro): il titolo è il cliente
  if (t.fonte === 'file') return { attivita: 'Lavorazione grafica', cliente: t.titolo, ordine: null };
  if (['github', 'claude_code'].includes(t.fonte)) return { attivita: t.titolo, cliente: t.analisi?.cliente?.nome || '', ordine: null };
  const [primo, ...resto] = t.titolo.split(/\s+·\s+/);
  const altri = resto.filter(p => !/^ordine\s+#\d+$/i.test(p));
  return {
    attivita: resto.length ? primo : t.titolo,
    cliente: t.analisi?.cliente?.nome || altri.join(' · '),
    ordine: taskOrdine(t),
  };
}

// Giorni tra oggi e il giorno del task: totali e lavorativi
function taskDistanza(iso) {
  const oggi = ctrlOggi();
  if (iso === oggi) return null;
  const passato = iso < oggi;
  let d = passato ? iso : oggi;
  const fine = passato ? oggi : iso;
  let tot = 0, lav = 0;
  while (d < fine && tot < 400) { d = ctrlAddDays(d, 1); tot++; if (ctrlLavorativo(d)) lav++; }
  return { passato, tot, lav };
}
const taskDistanzaTesto = ({ passato, tot, lav }) =>
  `${passato ? '−' : '+'}${tot} ${tot === 1 ? 'giorno' : 'giorni'}${lav !== tot ? ` (${lav} lav.)` : ''}`;

const taskDataBreve = (iso) => iso === ctrlOggi() ? 'Oggi'
  : new Date(iso + 'T12:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });

// Iniziale e colore fisso di ogni persona
const TK_AV_COLORI = ['#f59e0b', '#8b5cf6', '#22c55e', '#3b82f6', '#ec4899', '#14b8a6', '#ef4444', '#6366f1'];
function taskAvatar(nick, size = 26) {
  const n = [...nick].reduce((h, c) => h + c.charCodeAt(0), 0);
  return `<span class="tk-av" style="--a:${TK_AV_COLORI[n % TK_AV_COLORI.length]};width:${size}px;height:${size}px;" aria-hidden="true">${escapeHtml(nick.slice(0, 1).toUpperCase())}</span>`;
}

// Icona dell'attività dal titolo
function taskIcona(t) {
  if (['github', 'claude_code'].includes(t.fonte)) return TkIcons.code(17);
  if (t.fonte === 'file') return TkIcons.layers(17);
  const s = t.titolo;
  if (/sped|consegn|rientro|giacenz|tracking|gls|fermo|ritir|pacc/i.test(s)) return Icons.truck(17);
  if (/stamp|dtf|uv\b|mimaki|laser|applicaz|lavoraz|ricam|serigraf/i.test(s)) return Icons.printer(17);
  if (/mail|chiama|rispond|messagg|whatsapp|cliente/i.test(s)) return Icons.mail(17);
  if (/ordinar|merce|fornitor|scorte|controllo|confezion/i.test(s)) return Icons.package(17);
  return TkIcons.layers(17);
}

// Persona assegnata: avatar e nome, con la scelta per riassegnare
function taskChiSelect(t, { compatto = false } = {}) {
  const chi = t.assegnato_a;
  if (taskChiuso(t)) return chi ? `<span class="tk-who">${taskAvatar(chi, 22)}<span>${escapeHtml(chi)}</span></span>` : '<span class="tk-none">—</span>';
  return `
    <label class="tk-who tk-who-pick ${compatto ? 'is-pill' : ''} ${chi ? '' : 'is-free'}">
      ${chi ? taskAvatar(chi, 22) : `<span class="tk-av is-empty" aria-hidden="true">${TkIcons.user(13)}</span>`}
      <select aria-label="Assegna ${escapeHtml(t.titolo)}" onchange="taskAssign('${t.id}', this.value)">
        <option value="">${chi ? 'Coda comune' : 'Da assegnare'}</option>
        ${Ctrl.users.map(u => `<option value="${escapeHtml(u)}" ${chi === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
      </select>
    </label>`;
}

function renderControlAdminTasks() {
  if (Ctrl.persona && Ctrl.users.includes(Ctrl.persona)) return renderControlMyDay(Ctrl.persona);
  const d = Ctrl.giorno;
  const aperti = Ctrl.tasks.filter(t => !taskChiuso(t));
  const urgenti = aperti.filter(t => t.priorita === 'urgente');
  const inRitardo = aperti.filter(taskInRitardo);
  const delGiorno = Ctrl.tasks.filter(t => t.giorno === d);
  const minuti = (list) => list.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
  const scadute = inRitardo.filter(taskScaduto).length;
  const fatti = delGiorno.filter(t => t.stato === 'completato').length;
  // Avanzamento del giorno: anello con la percentuale e task completati sul totale
  // Avanzamento del giorno: anello coi fatti sul totale, accanto entrati, chiusi e come cambia la coda
  const avanz = (titolo, f, tot) => {
    const p = tot ? Math.round(f / tot * 100) : 0;
    const fl = Ctrl.flusso;
    const saldo = fl ? fl.entrati - fl.chiusi : 0;
    const cifra = (n, label, cls = '', title = '') =>
      `<span class="tk-av-num ${cls}" title="${title}"><b>${n}</b><small>${label}</small></span>`;
    return `
      <div class="glass-card tk-stat tk-progress-card">
        <span class="tk-ring" style="--p:${p};" role="img" aria-label="${titolo}: ${p}%"><b>${p}%</b></span>
        <span class="tk-stat-text">
          <strong class="tk-small-title">${titolo}</strong>
          <span><b class="tk-av-fatti">${f}</b> fatti su ${tot}</span>
          <small class="tk-stat-sub">task di ${d === ctrlOggi() ? 'oggi' : ctrlFmtGiorno(d).toLowerCase()}</small>
        </span>
        ${fl ? `
        <span class="tk-av-flow">
          ${cifra(fl.entrati, 'Entrati', '', 'Task creati nel giorno')}
          ${cifra(fl.chiusi, 'Chiusi', '', 'Task chiusi nel giorno da tutto il team')}
          ${cifra(saldo > 0 ? `+${saldo}` : saldo < 0 ? `−${-saldo}` : '0', saldo > 0 ? 'Coda cresce' : saldo < 0 ? 'Coda cala' : 'Coda stabile',
            saldo > 0 ? 'is-up' : saldo < 0 ? 'is-down' : '', 'Entrati meno chiusi')}
        </span>` : ''}
      </div>`;
  };
  // Carico del team: ore stimate dei task aperti (non bloccati, non di Claude) sulle ore delle persone presenti
  const carico = () => {
    const presenti = Ctrl.users.filter(u => u !== 'claude' && !Ctrl.assenti.has(u)
      && Ctrl.operatori.find(o => o.nickname === u)?.attivo !== false);
    const cap = presenti.reduce((n, u) => n + (Ctrl.operatori.find(o => o.nickname === u)?.minuti_giorno || 420), 0);
    const min = minuti(aperti.filter(t => t.stato !== 'bloccato' && t.assegnato_a !== 'claude'));
    const p = cap ? Math.round(min / cap * 100) : 0;
    const tono = p > 100 ? '#ef4444' : p > 80 ? '#f97316' : '#22c55e';
    return `
      <div class="glass-card tk-stat tk-load-card" style="--t:${tono};">
        <span class="tk-stat-icon">${Icons.clock(22)}</span>
        <span class="tk-stat-text">
          <strong>${cap ? `${p}%` : '—'}</strong>
          <span>Carico team</span>
          <small class="tk-stat-sub">${ctrlFmtMin(min)} su ${ctrlFmtMin(cap)} · ${presenti.length} ${presenti.length === 1 ? 'persona' : 'persone'}</small>
        </span>
      </div>`;
  };

  const stat = (icon, tono, value, label, extra = '', onclick = '') => `
    <${onclick ? `button type="button" onclick="${onclick}"` : 'div'} class="glass-card tk-stat ${onclick ? 'is-link' : ''}" style="--t:${tono};">
      <span class="tk-stat-icon">${icon}</span>
      <span class="tk-stat-text"><strong>${value}</strong><span>${label}</span>${extra}</span>
    </${onclick ? 'button' : 'div'}>`;

  return `
    ${renderPresenzeOggi()}
    <div class="tk-stats">
      ${stat(TkIcons.layers(22), '#3b82f6', aperti.length, 'Task aperti', `<small class="tk-stat-sub">${ctrlFmtMin(minuti(aperti))} stimate</small>`, `taskVaiA('coda')`)}
      ${stat(TkIcons.alert(), '#ef4444', urgenti.length, 'Urgenti', urgenti.length ? '<em class="tk-stat-tag">Azioni immediate</em>' : '', `taskVaiA('coda', 'urgente')`)}
      ${stat(Icons.calendarDays(22), '#f97316', inRitardo.length, 'In ritardo', `<small class="tk-stat-sub">${scadute} scaduti · ${inRitardo.length - scadute} dai giorni prima</small>`, `taskVaiA('ritardo')`)}
      ${avanz('Avanzamento team', fatti, delGiorno.length)}
      ${carico()}
    </div>
    ${renderTaskDuo(Ctrl._me())}
    <div class="tk-duo tk-solo">${renderTaskSubito(urgenti)}</div>
    ${renderTaskBoard()}`;
}

// I task urgenti, i più vecchi prima
function renderTaskSubito(urgenti) {
  const lista = urgenti.slice().sort((a, b) => taskScaduto(b) - taskScaduto(a) || taskCmpScad(a, b));
  const riga = (t) => {
    const { attivita, cliente } = taskParti(t);
    const g = taskScad(t), scaduto = taskScaduto(t);
    const sotto = [
      !g ? 'Senza scadenza' : scaduto ? `Scaduto il ${taskDataBreve(g)}` : g === ctrlOggi() ? `Scade oggi${ctrlFmtOra(t.scadenza) !== '00:00' ? ` alle ${ctrlFmtOra(t.scadenza)}` : ''}` : `Scade il ${taskDataBreve(g)}`,
      taskInListaTesto(t),
    ].filter(Boolean).join(' · ');
    return `
      <li class="tk-now ${scaduto ? 'is-late' : ''}">
        <span class="tk-now-icon" aria-hidden="true">!</span>
        <button type="button" class="tk-now-main" onclick="openTaskDetail('${t.id}')" title="${escapeHtml(t.titolo)}">
          <strong>${escapeHtml(attivita)}${cliente ? ` · ${escapeHtml(cliente)}` : ''}</strong>
          <span>${sotto}</span>
        </button>
        ${t.minuti_stimati ? `<span class="tk-chip">${Icons.clock(13)} ${ctrlFmtMin(t.minuti_stimati)}</span>` : ''}
        ${taskChiSelect(t, { compatto: true })}
        <button class="btn-icon" onclick="openTaskDetail('${t.id}')" aria-label="Dettagli">${CtrlIcons.more()}</button>
      </li>`;
  };
  return `
    <section class="glass-card page-card tk-panel">
      <header class="tk-panel-head">
        <span class="tk-panel-icon" style="--t:#f59e0b;">${Icons.zap(22)}</span>
        <div><h2>Da gestire subito ${lista.length ? `<span class="tk-count is-red">${lista.length} task</span>` : ''}</h2>
          <p>Task con priorità urgente: prima gli scaduti, poi per scadenza.</p></div>
        ${lista.length > 5 ? `<button type="button" class="tk-link" onclick="taskVaiA('coda', 'urgente')">Vedi tutti ${TkIcons.arrow()}</button>` : ''}
      </header>
      ${lista.length ? `<ul class="tk-now-list">${lista.slice(0, 5).map(riga).join('')}</ul>`
        : '<div class="empty-list">Nessun task urgente.</div>'}
    </section>`;
}

// Ore stimate dei task aperti di ogni persona sulle sue ore del giorno
// Team di oggi (admin e addetti), su una riga: icona della presenza
// (clic: da confermare → presente → assente → da confermare), nome, task e ore, barra del carico
// (clic sul nome: i suoi task, solo admin). L'admin riordina trascinando; di base in ordine di entrata.
// Chi può aprire, dal nome nel team, la lista dei task fatti da ogni persona
const TEAM_VEDE_FATTI = new Set(['tcfactory', 'riccardo']);
const TEAM_STATO = {
  presente: { cls: 'is-ok',  label: 'Presente', icon: '<polyline points="5 12.5 10 17 19 7"/>' },
  assente:  { cls: 'is-no',  label: 'Assente',  icon: '<line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/>' },
  attesa:   { cls: 'is-wait', label: 'Da confermare', icon: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="6.5" cy="12" r="1.6" fill="currentColor"/><circle cx="17.5" cy="12" r="1.6" fill="currentColor"/>' },
};

// Ordine del team: quello salvato, poi chi manca in ordine di entrata (senza orario in fondo) e di nome
function teamOrdinato(persone, pres) {
  const ora = (n) => pres[n]?.ora_inizio || Ctrl.operatori?.find(o => o.nickname === n)?.ora_inizio?.slice(0, 5) || '99:99';
  const salvato = (Ctrl.teamOrdine || []).filter(n => persone.includes(n));
  const resto = persone.filter(n => !salvato.includes(n)).sort((a, b) => ora(a).localeCompare(ora(b)) || a.localeCompare(b));
  return [...salvato, ...resto];
}

function renderPresenzeOggi() {
  const s = Presenze.stato, admin = TCAuth.isAdmin();
  if (!admin && !s?.addetto) return '';
  const oggi = Ctrl.giorno === ctrlOggi();
  const pres = Object.fromEntries((oggi && s?.addetto ? s.tutti || [] : []).map(p => [p.nickname, p]));
  const persone = teamOrdinato(admin ? Ctrl.users : Object.keys(pres), pres);
  if (!persone.length) return '';
  const statoDi = (p) => !p ? null : p.stato === 'presente' ? 'presente' : p.stato === 'assente' || p.assente ? 'assente' : 'attesa';
  const dettaglio = (p) => p.assente && !p.stato ? 'Assente nel Planner'
    : p.stato ? `${TEAM_STATO[p.stato].label} · ${ctrlFmtOra(p.confermato_at)}${p.confermato_da !== p.nickname ? ` · ${p.confermato_da}` : ''}`
    : `Da confermare · entrata ${p.ora_inizio}`;

  const item = (nick) => {
    const p = pres[nick], st = statoDi(p), c = taskCarico(nick), def = st && TEAM_STATO[st];
    // Fatti nel giorno: quanti e le ore stimate, sulle ore della persona
    const fatti = (Ctrl.chiusiOggi || []).filter(t => t.assegnato_a === nick);
    const f = { n: fatti.length, min: fatti.reduce((n, t) => n + (t.minuti_stimati || 0), 0) };
    const icona = def ? `<i class="team-stato ${def.cls}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">${def.icon}</svg></i>`
                      : '<i class="team-stato is-none"></i>';
    // Claude non ha un tempo massimo: task chiusi e minuti lavorati nel giorno
    const fattiClaude = nick === 'claude' ? (Ctrl.claudeFatti || []) : null;
    const info = fattiClaude ? `
      <span class="team-nome">${escapeHtml(nick)}</span>
      <span class="team-meta">${fattiClaude.length} chiusi · ${ctrlFmtMin(fattiClaude.reduce((n, t) => n + (t.lavorato_sec ? t.lavorato_sec / 60 : t.minuti_stimati || 0), 0))} lavorati</span>` : `
      <span class="team-nome">${escapeHtml(nick)}</span>
      <span class="team-meta">${f.n} fatti · ${f.min ? ctrlFmtMin(f.min) : '0′'}</span>
      <span class="team-bar"><span style="width:${c.cap ? Math.min(100, Math.round(f.min / c.cap * 100)) : 0}%;--t:#22c55e;"></span></span>`;
    return `
      <li class="team-item ${st === 'assente' ? 'is-off' : ''} ${TaskView.chi === nick && TaskView.tab === 'chiusi' ? 'is-on' : ''}"
        data-nick="${escapeHtml(nick)}" ${admin ? 'draggable="true" ondragstart="teamDragStart(event)" ondragover="teamDragOver(event)" ondrop="teamDrop(event)" ondragend="teamDragEnd()"' : ''}>
        ${def ? `<button type="button" class="team-av" title="${escapeHtml(dettaglio(p))}" aria-label="${escapeHtml(nick)}: ${escapeHtml(dettaglio(p))}. Cambia presenza" onclick="Presenze.ciclo('${escapeHtml(nick)}')">${icona}</button>`
              : `<span class="team-av" title="Senza orario di entrata">${icona}</span>`}
        ${TEAM_VEDE_FATTI.has(Ctrl._me()) ? `<button type="button" class="team-info" onclick="taskPersona('${escapeHtml(nick)}')" aria-label="Task fatti oggi da ${escapeHtml(nick)}">${info}</button>`
                : `<span class="team-info">${info}</span>`}
      </li>`;
  };
  return `
    <section class="glass-card page-card team-box" aria-label="Team di oggi">
      ${s?.addetto && oggi && !s.reti ? `<div class="pres-avviso"><span>Nessuna rete del posto di lavoro registrata: non si possono confermare le presenze.</span>
        ${admin ? `<button type="button" class="ctrl-btn is-primary" onclick="addRetePresenze()">${Icons.plus(14)} Aggiungi la rete di questo dispositivo</button>` : ''}</div>` : ''}
      <ul class="team-riga">${persone.map(item).join('')}</ul>
    </section>`;
}

// Riordino trascinando (admin): l'ordine si salva per tutti in app_settings.team_ordine
let _teamDrag = null;
function teamDragStart(e) {
  _teamDrag = e.currentTarget.dataset.nick;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('is-drag');
}
function teamDragOver(e) {
  if (!_teamDrag) return;
  e.preventDefault();
  const li = e.currentTarget, riga = li.parentElement, trascinato = riga.querySelector('.is-drag');
  if (!trascinato || trascinato === li) return;
  const dopo = e.clientX > li.getBoundingClientRect().left + li.offsetWidth / 2;
  riga.insertBefore(trascinato, dopo ? li.nextSibling : li);
}
function teamDrop(e) { e.preventDefault(); }
async function teamDragEnd() {
  const riga = document.querySelector('.team-riga');
  riga?.querySelector('.is-drag')?.classList.remove('is-drag');
  if (!_teamDrag || !riga) return;
  _teamDrag = null;
  const ordine = [...riga.querySelectorAll('.team-item')].map(li => li.dataset.nick);
  if (JSON.stringify(ordine) === JSON.stringify(Ctrl.teamOrdine)) return;
  Ctrl.teamOrdine = ordine;
  const { error } = await supabaseClient.from('app_settings').upsert({ key: 'team_ordine', value: ordine, updated_at: new Date().toISOString() });
  if (error) showToast(Ctrl._fail(error).message, 'error');
}

// Tabella con schede, filtri e ordinamento
function taskBoardBase() {
  const d = Ctrl.giorno;
  const aperti = Ctrl.tasks.filter(t => !taskChiuso(t));
  return {
    coda: aperti,
    oggi: aperti.filter(t => t.giorno === d && !taskInRitardo(t)),
    ritardo: aperti.filter(taskInRitardo),
    assegnare: aperti.filter(t => !t.assegnato_a && !t.designato),
    // Chiusi nel giorno (anche se erano in lista da prima) e quelli del giorno non completati
    chiusi: [...(Ctrl.chiusiOggi || []), ...Ctrl.tasks.filter(t => t.giorno === d && taskChiuso(t) && !(Ctrl.chiusiOggi || []).some(c => c.id === t.id))],
    tutti: Ctrl.tasks.filter(t => !taskChiuso(t) || t.giorno === d),
  };
}

function taskFiltroScad(t, f) {
  const g = taskScad(t), oggi = ctrlOggi();
  if (f === 'scaduti') return taskScaduto(t);
  if (f === 'oggi') return g === oggi;
  if (f === 'settimana') return !!g && g >= oggi && g <= ctrlAddDays(oggi, 7);
  if (f === 'nessuna') return !g;
  return true;
}

function taskBoardList() {
  const v = TaskView, q = v.q.trim().toLowerCase();
  const list = taskBoardBase()[v.tab].filter(t =>
    (!v.brand || taskCat(t) === v.brand)
    && (!v.tipo || t.tipo_id === v.tipo)
    && (!v.chi || (v.chi === '_' ? !t.assegnato_a : t.assegnato_a === v.chi))
    && (!v.prio || t.priorita === v.prio)
    && (!v.stato || t.stato === v.stato)
    && (!v.scad || taskFiltroScad(t, v.scad))
    && (!q || `${t.titolo} ${t.analisi?.cliente?.nome || ''} ${(t.analisi?.ordini || []).map(o => o.numero).join(' ')}`.toLowerCase().includes(q)));
  const per = {
    scadenza: (a, b) => taskCmpScad(a, b) || taskPrioRank(a.priorita) - taskPrioRank(b.priorita),
    priorita: (a, b) => taskPrioRank(a.priorita) - taskPrioRank(b.priorita) || taskCmpScad(a, b),
    tempo: (a, b) => (b.minuti_stimati || 0) - (a.minuti_stimati || 0),
    arrivo: (a, b) => b.created_at.localeCompare(a.created_at),
  }[v.ordina];
  return list.sort((a, b) => per(a, b) || a.created_at.localeCompare(b.created_at));
}

function renderTaskBoard() {
  const v = TaskView, base = taskBoardBase();
  const tabIcon = { coda: TkIcons.list(17), oggi: Icons.calendarDays(16), ritardo: TkIcons.alert(16), assegnare: TkIcons.user(16), chiusi: Icons.checkCircle('currentColor', 16), tutti: TkIcons.layers(16) };
  const sel = (key, label, opzioni) => `
    <select class="filter-pill ${v[key] ? 'on' : ''}" aria-label="${label}" onchange="setTaskView('${key}', this.value)">
      ${opzioni.map(([id, l]) => `<option value="${escapeHtml(id)}" ${v[key] === id ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
    </select>`;
  const tipiUsati = Ctrl.tipi.filter(tp => Ctrl.tasks.some(t => t.tipo_id === tp.id));
  const filtri = TASK_FILTRI.some(k => v[k]);
  return `
    <section class="glass-card page-card tk-board" id="tk-board">
      <div class="tk-tabs" role="tablist" aria-label="Elenco dei task">
        ${TASK_TABS.map(([id, label]) => `<button type="button" role="tab" aria-selected="${v.tab === id}" class="tk-tab ${v.tab === id ? 'active' : ''}"
          onclick="setTaskView('tab', '${id}')">${tabIcon[id]} <span>${label}</span>${id === 'coda' ? '' : ` <b>${base[id].length}</b>`}</button>`).join('')}
      </div>
      <div class="tk-filters">
        <input type="search" class="filter-pill tk-search" placeholder="Cerca task, cliente, ordine…" aria-label="Cerca" value="${escapeHtml(v.q)}" oninput="setTaskSearch(this.value)">
        ${sel('brand', 'Categoria', [['', 'Tutte le categorie'], ...taskCategorie().filter(m => m.id !== 'file').map(m => [m.id, m.label]), ['_', 'Altro']])}
        ${tipiUsati.length ? sel('tipo', 'Lavorazione', [['', 'Tutte le lavorazioni'], ...tipiUsati.map(tp => [tp.id, tp.nome])]) : ''}
        ${sel('chi', 'Assegnato a', [['', 'Tutti gli assegnati'], ['_', 'Da assegnare'], ...Ctrl.users.map(u => [u, u])])}
        ${sel('prio', 'Priorità', [['', 'Tutte le priorità'], ...TASK_PRIORITA.map(p => [p.id, p.label])])}
        ${sel('stato', 'Stato', [['', 'Tutti gli stati'], ...TASK_STATI.map(st => [st.id, st.label])])}
        ${sel('scad', 'Scadenza', [['', 'Tutte le scadenze'], ['scaduti', 'Scaduti'], ['oggi', 'Scadono oggi'], ['settimana', 'Prossimi 7 giorni'], ['nessuna', 'Senza scadenza']])}
        ${filtri ? `<button type="button" class="btn btn-ghost btn-sm" onclick="resetTaskView()">Azzera filtri</button>` : ''}
        <span class="tk-sort">Ordina per
          ${sel('ordina', 'Ordina per', [['scadenza', 'Scadenza'], ['priorita', 'Priorità'], ['tempo', 'Tempo stimato'], ['arrivo', 'Più recenti']]).replace('filter-pill on', 'filter-pill')}</span>
      </div>
      <div id="tk-table">${renderTaskTable()}</div>
    </section>`;
}

function renderTaskTable() {
  const v = TaskView, list = taskBoardList(), mostrati = list.slice(0, v.limite);
  const filtri = TASK_FILTRI.some(k => v[k]);
  // La selezione tiene solo i task ancora aperti e caricati
  [...v.sel].forEach(id => { const t = Ctrl.get(id); if (!t || taskChiuso(t)) v.sel.delete(id); });
  const conta = `<div class="tk-result">${list.length} ${list.length === 1 ? 'task' : 'task'}${filtri ? ' con questi filtri' : ''} · ${ctrlFmtMin(list.reduce((n, t) => n + (t.minuti_stimati || 0), 0))} stimate</div>`;
  if (!list.length) return `${v.sel.size ? renderTaskBulk() : ''}<div class="empty-list">Nessun task${filtri ? ' con questi filtri' : ''}.</div>`;
  const selezionabili = mostrati.filter(t => !taskChiuso(t));
  const tutti = selezionabili.length && selezionabili.every(t => v.sel.has(t.id));
  const prioTag = (t) => { const p = taskPrio(t.priorita); return `<span class="td-tag tk-prio" style="--c:${p.color};"><b aria-hidden="true">!</b> ${p.label}</span>`; };
  const statoTag = (t) => `<span class="td-tag" style="--c:${taskStato(t.stato).color};">${taskStato(t.stato).label}</span>`;
  const riga = (t) => {
    const { attivita, cliente, ordine } = taskParti(t);
    const g = taskScad(t), m = taskBrand(t) === '_' ? null : taskCatInfo(taskBrand(t)), chiuso = taskChiuso(t);
    const dist = g ? taskDistanza(g) : null, late = taskScaduto(t);
    const ora = t.scadenza && ctrlFmtOra(t.scadenza) !== '00:00' ? ` ${ctrlFmtOra(t.scadenza)}` : '';
    const inLista = chiuso ? '' : taskInListaTesto(t);
    return `
      <tr class="${t.stato === 'completato' && !['github', 'claude_code', 'shopify_admin', 'file'].includes(t.fonte) ? 'is-done' : ''} ${v.sel.has(t.id) ? 'is-sel' : ''}">
        <td class="tk-check">${chiuso ? '' : `<input type="checkbox" ${v.sel.has(t.id) ? 'checked' : ''} onchange="taskToggleSel('${t.id}', this.checked)" aria-label="Seleziona ${escapeHtml(t.titolo)}">`}</td>
        <td>${prioTag(t)}</td>
        <td><button type="button" class="tk-act" onclick="openTaskDetail('${t.id}')" title="${escapeHtml(t.titolo)}">
          <span class="tk-act-icon" aria-hidden="true">${taskIcona(t)}</span><span>${escapeHtml(attivita)}</span></button></td>
        <td><div class="tk-cliente">${cliente ? escapeHtml(cliente) : '<span class="tk-none">—</span>'}</div>
          ${ordine || m ? `<small>${[ordine ? escapeHtml(ordine) : '', m ? `<span class="ctrl-macro-tag" style="--m:${m.color};">${escapeHtml(m.label)}</span>` : ''].filter(Boolean).join(' · ')}</small>` : ''}</td>
        <td>${g ? `<span class="tk-date ${late ? 'is-late' : g === ctrlOggi() ? 'is-today' : ''}">${Icons.calendarDays(14)} ${taskDataBreve(g)}${ora}</span>
          ${dist && !chiuso ? `<span class="tk-delta ${dist.passato ? 'is-late' : ''}">${taskDistanzaTesto(dist)}</span>` : ''}`
          : chiuso ? '' : '<span class="tk-none">Nessuna</span>'}
          ${inLista ? `<small class="tk-inlista">${inLista}</small>` : ''}
          ${chiuso && t.completato_at ? `<small class="tk-inlista">${t.fonte === 'github' ? 'commit' : ['claude_code', 'shopify_admin', 'file'].includes(t.fonte) ? 'sessione fino' : 'fatto'} ${ctrlGiornoDi(t.completato_at) === ctrlOggi() ? 'alle' : `il ${taskDataBreve(ctrlGiornoDi(t.completato_at))},`} ${ctrlFmtOra(t.completato_at)}</small>` : ''}</td>
        <td>${taskChiSelect(t)}</td>
        <td class="tk-num">${t.minuti_stimati ? ctrlFmtMin(t.minuti_stimati) : '<span class="tk-none">—</span>'}</td>
        <td>${statoTag(t)}</td>
        <td class="tk-more"><button class="btn-icon" onclick="openTaskDetail('${t.id}')" aria-label="Dettagli di ${escapeHtml(t.titolo)}">${CtrlIcons.more()}</button></td>
      </tr>`;
  };
  return `
    ${v.sel.size ? renderTaskBulk() : conta}
    <div class="table-scroll"><table class="data-table tk-table">
      <thead><tr>
        <th class="tk-check">${selezionabili.length ? `<input type="checkbox" ${tutti ? 'checked' : ''} onchange="taskSelAll(this.checked)" aria-label="Seleziona tutti i task mostrati">` : ''}</th>
        <th>Priorità</th><th>Attività</th><th>Cliente / Ordine</th><th>Scadenza</th><th>Assegnato a</th><th class="tk-num">Tempo</th><th>Stato</th><th><span class="sr-only">Azioni</span></th></tr></thead>
      <tbody>${mostrati.map(riga).join('')}</tbody>
    </table></div>
    ${list.length > mostrati.length ? `<div class="tk-more-rows"><button type="button" class="btn btn-secondary btn-sm" onclick="TaskView.limite += ${TASK_PAGINA};taskRefreshTable()">Mostra altri ${Math.min(TASK_PAGINA, list.length - mostrati.length)} di ${list.length - mostrati.length}</button></div>` : ''}`;
}

// Barra della selezione: a chi assegnare, con il carico che avrebbe dopo
function renderTaskBulk() {
  const v = TaskView, sel = [...v.sel].map(id => Ctrl.get(id)).filter(Boolean);
  const min = sel.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
  const dopo = v.bulkChi && v.bulkChi !== '_' ? taskCarico(v.bulkChi, sel.filter(t => t.assegnato_a !== v.bulkChi).reduce((n, t) => n + (t.minuti_stimati || 0), 0)) : null;
  const ora = v.bulkChi && v.bulkChi !== '_' ? taskCarico(v.bulkChi) : null;
  return `
    <div class="tk-bulk" role="region" aria-label="Task selezionati">
      <strong>${sel.length} selezionat${sel.length === 1 ? 'o' : 'i'}</strong><span class="tk-none">${ctrlFmtMin(min)} stimate</span>
      <select class="filter-pill" aria-label="Assegna i selezionati a" onchange="TaskView.bulkChi=this.value;taskRefreshTable()">
        <option value="">Assegna a…</option>
        <option value="_" ${v.bulkChi === '_' ? 'selected' : ''}>Coda comune</option>
        ${Ctrl.users.map(u => { const c = taskCarico(u); return `<option value="${escapeHtml(u)}" ${v.bulkChi === u ? 'selected' : ''}>${escapeHtml(u)} · ${taskCaricoTesto(c)}${Ctrl.assenti.has(u) && u !== 'claude' ? ' · assente' : ''}</option>`; }).join('')}
      </select>
      ${dopo ? `<span class="tk-bulk-load">Carico di ${escapeHtml(v.bulkChi)}: ${taskCaricoTesto(ora)} → <b class="${dopo.pct >= 100 ? 'is-over' : ''}">${taskCaricoTesto(dopo)}${dopo.pct != null ? ` (${dopo.pct}%)` : ''}</b></span>` : ''}
      <button type="button" class="btn btn-primary btn-sm" ${v.bulkChi ? '' : 'disabled'} onclick="taskBulkAssign()">Assegna</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="taskSelClear()">Annulla selezione</button>
    </div>`;
}

function taskToggleSel(id, on) {
  on ? TaskView.sel.add(id) : TaskView.sel.delete(id);
  taskRefreshTable();
}

function taskSelAll(on) {
  taskBoardList().slice(0, TaskView.limite).filter(t => !taskChiuso(t)).forEach(t => on ? TaskView.sel.add(t.id) : TaskView.sel.delete(t.id));
  taskRefreshTable();
}

function taskSelClear() {
  TaskView.sel.clear();
  TaskView.bulkChi = '';
  taskRefreshTable();
}

async function taskBulkAssign() {
  const v = TaskView, ids = [...v.sel], chi = v.bulkChi === '_' ? null : v.bulkChi;
  if (!ids.length || !v.bulkChi) return;
  const n = ids.length === 1 ? 'il task selezionato' : `i ${ids.length} task selezionati`;
  if (!(await uiConfirm(chi ? `Assegnare ${n} a ${chi}?` : `Rimettere ${n} in coda comune?`, { ok: chi ? 'Assegna' : 'Rimetti in coda' }))) return;
  try {
    const { error } = await supabaseClient.from('tasks').update({ assegnato_a: chi }).in('id', ids);
    if (error) throw Ctrl._fail(error);
    showToast(chi ? `${ids.length} task assegnati a ${chi}` : `${ids.length} task rimessi in coda comune`);
    taskSelClear();
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

function taskRefreshTable() {
  const el = document.getElementById('tk-table');
  if (el) el.innerHTML = renderTaskTable();
}

function setTaskView(key, value) {
  TaskView[key] = value;
  TaskView.limite = TASK_PAGINA;
  refreshControlPage();
}

function setTaskSearch(value) {
  TaskView.q = value;
  TaskView.limite = TASK_PAGINA;
  taskRefreshTable();
}

function resetTaskView() {
  Object.assign(TaskView, { brand: '', tipo: '', chi: '', prio: '', stato: '', scad: '', q: '', limite: TASK_PAGINA });
  refreshControlPage();
}

// Dai numeri in alto e da "Vedi tutti" alla tabella, con la scheda e la priorità giuste
function taskVaiA(tab, prio = '') {
  Object.assign(TaskView, { tab, prio, limite: TASK_PAGINA });
  refreshControlPage();
  document.getElementById('tk-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Carico del team: tutti i task della persona nella tabella (aperti e chiusi del giorno); un altro clic toglie il filtro
// Clic sul nome nel team: i task fatti nel giorno da quella persona (solo per TEAM_VEDE_FATTI)
function taskPersona(nick) {
  if (!TEAM_VEDE_FATTI.has(Ctrl._me())) return;
  const giaAperta = TaskView.chi === nick && TaskView.tab === 'chiusi';
  Object.assign(TaskView, { brand: '', tipo: '', prio: '', stato: '', scad: '', q: '', limite: TASK_PAGINA,
    chi: giaAperta ? '' : nick, tab: giaAperta ? 'coda' : 'chiusi' });
  refreshControlPage();
  if (!giaAperta) document.getElementById('tk-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openPersonTasks(nick) {
  Ctrl.persona = nick;
  refreshControlPage();
  window.scrollTo({ top: 0 });
}

async function taskAssign(id, nick) {
  try {
    await Ctrl.saveTask(id, { assegnato_a: nick || null });
    showToast(nick ? `Assegnato a ${nick}` : 'Rimesso in coda comune');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

function taskSub(title, list, opts = {}) {
  if (!list.length) return '';
  return `<div class="ctrl-sub">${title}</div><div class="task-list task-stack">${renderTaskItems(list, opts)}</div>`;
}

// Numero d'ordine del task: nel titolo, o nell'analisi se la mail riguarda un ordine solo
function taskOrdine(t) {
  return t.titolo.match(/#\d{3,}/)?.[0] || (t.analisi?.ordini?.length === 1 ? t.analisi.ordini[0].numero : null);
}

// Gruppo d'ordine del task: numero Shopify (#1234) o ordine del gestionale
function taskGruppo(t) {
  const n = taskOrdine(t);
  if (n) return `${taskBrand(t)}|${n}`;
  return t.fonte === 'gestionale' && t.fonte_rif?.ordine ? `g|${t.fonte_rif.ordine}` : null;
}

// I task dello stesso ordine stanno in un blocco unico, al posto del più importante
function renderTaskItems(list, opts = {}) {
  const ordinati = sortTasks(list);
  const gruppi = new Map();
  ordinati.forEach(t => { const k = taskGruppo(t); if (k) gruppi.set(k, [...(gruppi.get(k) || []), t]); });
  const mostrati = new Set();
  return ordinati.map(t => {
    const k = taskGruppo(t), g = k && gruppi.get(k);
    if (!g || g.length < 2) return renderTaskRow(t, opts);
    if (mostrati.has(k)) return '';
    mostrati.add(k);
    return renderTaskOrder(g, opts);
  }).join('');
}

function renderTaskOrder(g, opts) {
  const primo = (fn) => g.map(fn).find(Boolean);
  const og = taskOrdineGest(g[0]);
  const numero = og ? og.nome || `Ordine ${g[0].fonte_rif.ordine}` : taskOrdine(g[0]);
  const cliente = og ? '' : primo(t => t.analisi?.cliente?.nome) || primo(t => t.titolo.match(/·\s*ordine\s+#\d+\s*·\s*(.+)$/i)?.[1]);
  const situazione = primo(t => t.analisi?.spedizione?.storico?.[0]?.stato);
  const negozio = opts.showStore && taskBrand(g[0]) !== '_' ? taskCatInfo(taskBrand(g[0])) : null;
  const minuti = g.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
  // Nel blocco il nome dell'ordine è già in testa: la riga dice solo cosa fare
  const corto = (t) => og ? t.titolo.replace(/\s*[·:]\s*[^·:]+$/, '') : t.titolo.replace(/\s*·\s*ordine\s+#\d+(\s*·\s*[^·]+)?$/i, '');
  return `
    <section class="task-order" aria-label="Ordine ${escapeHtml(numero)}">
      <header class="task-order-head">
        <strong>${escapeHtml(numero)}</strong>
        ${og ? `<span class="task-order-who">ordine ${escapeHtml(g[0].fonte_rif.ordine)}</span>` : ''}
        ${cliente ? `<span class="task-order-who">${escapeHtml(cliente)}</span>` : ''}
        ${negozio ? `<span class="ctrl-macro-tag" style="--m:${negozio.color};">${escapeHtml(negozio.label)}</span>` : ''}
        ${situazione ? `<span class="task-order-state">GLS · ${escapeHtml(situazione)}</span>` : ''}
        <span class="task-order-sum">${g.length} task${minuti ? ` · ${ctrlFmtMin(minuti)}` : ''}</span>
      </header>
      <div class="task-order-rows">${g.map(t => renderTaskRow(t, { ...opts, showStore: false, titolo: corto(t) })).join('')}</div>
    </section>`;
}

// Un solo avviso in cima alla lista: il motivo è dentro ogni task
function taskAutoNote(list) {
  const n = list.filter(t => t.automazione_errore).length;
  if (!n) return '';
  return `<div class="task-auto-note">${n === 1 ? '1 task arriva' : `${n} task arrivano`} da un'automazione non riuscita: il motivo è dentro al task.</div>`;
}

// Pulsante di filtro per negozio
// L'animazione parte solo sul filtro appena cliccato, non quando la pagina si aggiorna da sola
const CtrlAnim = { filtro: null };

function ctrlFilter(attivo, label, n, color, onclick) {
  const chiave = taskSlug(label);
  const appena = attivo && CtrlAnim.filtro === chiave;
  return `<button type="button" class="ctrl-filter ${attivo ? 'is-on' : ''} ${appena ? 'is-just' : ''}" aria-pressed="${attivo}" style="--m:${color || 'var(--text-primary)'};" onclick="CtrlAnim.filtro='${chiave}';${onclick}">
    ${color ? '<i aria-hidden="true"></i>' : ''}<span>${escapeHtml(label)}</span>${n != null ? `<b>${n}</b>` : ''}</button>`;
}

// Coda comune: DTF-FILE, DTF-STAMPA, Stampa, Altre lavorazioni, Negozi
function renderTaskQueue(coda, emptyText = '') {
  if (!coda.length && !emptyText) return '';
  const cat = codaAttiva();
  const info = TASK_CODE_Q.find(c => c.id === cat);
  const righe = codaDtfRighe();
  const perCoda = (id) => coda.filter(t => taskCoda(t) === id);
  let list = perCoda(cat);
  // Negozi: filtro per negozio
  const negozio = cat === 'negozi' && Ctrl.codaNegozio && list.some(t => taskCat(t) === Ctrl.codaNegozio) ? Ctrl.codaNegozio : null;
  const tuttiNegozi = list;
  if (negozio) list = list.filter(t => taskCat(t) === negozio);
  // DTF-FILE, STAMPA e ALTRE LAVORAZIONI: filtro per tag (come nella lista ordini)
  const conTag = ['dtffile', 'stampa', 'altre'].includes(cat);
  const tagRow = conTag ? codaTagBar(cat === 'dtffile' ? [...list, ...righe.file] : list) : '';
  if (conTag && codaTagAttivi().length) {
    list = list.filter(codaTagOk);
    righe.file = righe.file.filter(codaTagOk);
  }
  const opts = { showStore: true, showAuto: false };
  const ordinati = sortTasks;
  const sub = (titolo, html) => `<div class="ctrl-sub">${titolo}</div><div class="task-list task-stack">${html}</div>`;
  let corpo, n;
  if (cat === 'dtffile') {
    n = list.length + righe.file.length;
    // Tre categorie, sempre in quest'ordine, come pulsanti in alto: 1 caricare (proposte + ordini senza DTF), 2 creare i TIF, 3 rinominare
    const di = (pref) => list.filter(t => String(t.fonte_rif?.dtf || '').startsWith(pref + ':'));
    const tif = di('tif'), nomi = di('nome'), proposte = list.filter(t => !tif.includes(t) && !nomi.includes(t));
    const parti = [
      { id: 'caricare', label: 'Caricare', n: proposte.length + righe.file.length,
        html: () => ordinati(proposte).map(renderDtfTaskRiga).join('') + righe.file.map((o, i) => renderOrdineRiga(o, { pos: i + 1, dtf: true, azione: 'file' })).join('') },
      { id: 'tif', label: 'Creare TIF', n: tif.length, html: () => ordinati(tif).map(renderDtfTaskRiga).join('') },
      { id: 'rinominare', label: 'Rinominare', n: nomi.length, html: () => ordinati(nomi).map(renderDtfTaskRiga).join('') },
    ];
    corpo = tagRow + codaParti('dtffile', parti, 'Niente da fare.');
  } else if (cat === 'dtfstampa') {
    n = list.length + righe.stampa.length;
    const riga = (x, i) => x.kind === 'ct' ? renderCtRiga(x, i + 1) : x.kind === 'negozio' ? renderNegozioRiga(x, i + 1) : x.kind === 'cartella' ? renderCartellaRiga(x.c, i + 1) : renderOrdineRiga(x.o, { pos: i + 1, dtf: true });
    corpo = codaParti('dtfstampa', [
      { id: 'controllare', label: 'Da controllare', n: list.length, html: () => ordinati(list).map(renderDtfTaskRiga).join('') },
      { id: 'stampare', label: 'Da stampare', n: righe.stampa.length, html: () => righe.stampa.map(riga).join('') },
    ], 'Niente da stampare al DTF.');
  } else if (cat === 'stampa') {
    // Una coda sola, senza "In ritardo" e "Da fare"
    n = list.length;
    corpo = tagRow + (list.length ? `<div class="task-list task-stack">${renderTaskItems(ordinati(list), opts)}</div>`
                                  : `<div class="empty-list">${emptyText && !coda.length ? emptyText : 'Nessun task in questa coda.'}</div>`);
  } else {
    n = list.length;
    const chips = cat === 'negozi' ? (() => {
      const conta = {};
      tuttiNegozi.forEach(t => { const c = taskCat(t); conta[c] = (conta[c] || 0) + 1; });
      const cats = [...TASK_BRAND, ...taskTagCategorie(), TASK_SENZA_CAT].filter(c => conta[c.id]);
      return cats.length > 1 ? `<div class="ctrl-macro-bar" role="group" aria-label="Filtra per negozio">
          ${ctrlFilter(!negozio, 'Tutti', tuttiNegozi.length, null, 'setCodaNegozio(null)')}
          ${cats.map(c => ctrlFilter(negozio === c.id, c.label, conta[c.id], c.color, `setCodaNegozio('${c.id}')`)).join('')}
        </div>` : '';
    })() : '';
    corpo = chips + tagRow + (list.length ? taskSections(list).map(([titolo, r]) => taskSub(`${titolo} · ${r.length}`, r, opts)).join('')
                                 : `<div class="empty-list">${emptyText && !coda.length ? emptyText : 'Nessun task in questa coda.'}</div>`);
  }
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${escapeHtml(info.label)}</h2><span class="table-count">${n}</span>
        <span class="ctrl-group-hint">${escapeHtml(info.hint)}</span></div>
      ${taskCodaBar(coda, righe)}
      ${list.length && !['dtffile', 'dtfstampa'].includes(cat) ? taskAutoNote(list) : ''}
      <div class="tk-split-list ${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${corpo}</div>
    </section>`;
}

// Tag di una riga della coda: un ordine ha i suoi tag; un task quelli del suo ordine, o il suo brand
function codaTagDi(x) {
  if (!('titolo' in x)) return (x.tags || []).map(taskSlug);
  const [tipo, ...resto] = String(x.fonte_rif?.dtf || '').split(':');
  const o = taskOrdineGest(x) || (['proposta', 'mancante'].includes(tipo) && typeof TCFactory !== 'undefined' ? TCFactory.getOrderById(resto.join(':')) : null);
  if (o) return (o.tags || []).map(taskSlug);
  return [taskBrand(x)];
}
const codaTagAttivi = () => {
  const ok = new Set(TCFactory.getTags().map(t => taskSlug(t.name)));
  return (Ctrl.codaTags || []).filter(id => ok.has(id));
};
const codaTagOk = (x) => { const sel = codaTagAttivi(); return !sel.length || codaTagDi(x).some(id => sel.includes(id)); };
function codaTagBar(righe) {
  const tags = TCFactory.getTags().filter(t => !TASK_TAG_ESCLUSI.has(taskSlug(t.name)));
  if (!tags.length) return '';
  const sel = codaTagAttivi();
  const conta = {};
  righe.forEach(x => new Set(codaTagDi(x)).forEach(id => { conta[id] = (conta[id] || 0) + 1; }));
  const visibili = tags.filter(t => conta[taskSlug(t.name)] || sel.includes(taskSlug(t.name)));
  if (!visibili.length) return '';
  return `
    <div class="ctrl-tag-bar" role="group" aria-label="Filtra per tag">
      <span class="ctrl-tag-label">Tag:</span>
      ${visibili.map(t => {
        const id = taskSlug(t.name), on = sel.includes(id);
        return `<button type="button" class="chip chip-btn" aria-pressed="${on}" onclick="toggleCodaTag('${id}')"
          style="background:${on ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`};color:${on ? '#fff' : t.color};">
          <span class="chip-dot" style="background:${on ? '#fff' : t.color};"></span>${escapeHtml(t.name)}</button>`;
      }).join('')}
      ${sel.length ? `<button type="button" class="btn btn-ghost btn-sm ctrl-tag-clear" onclick="toggleCodaTag(null)">× rimuovi filtri</button>` : ''}
    </div>`;
}
function toggleCodaTag(id) {
  const sel = codaTagAttivi();
  Ctrl.codaTags = id == null ? [] : sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id];
  refreshControlPage();
}

// Categorie di una coda come pulsanti in alto: se ne vede una alla volta (di base la prima con qualcosa)
function codaParti(coda, parti, vuota) {
  const scelta = (Ctrl.codaParte || {})[coda];
  const attiva = parti.find(p => p.id === scelta) || parti.find(p => p.n) || parti[0];
  return `<div class="ctrl-macro-bar" role="group" aria-label="Categorie">
      ${parti.map(p => ctrlFilter(p.id === attiva.id, p.label, p.n, null, `setCodaParte('${coda}','${p.id}')`)).join('')}
    </div>`
    + (attiva.n ? `<div class="task-list task-stack">${attiva.html()}</div>` : `<div class="empty-list">${vuota}</div>`);
}
function setCodaParte(coda, id) {
  Ctrl.codaParte = { ...(Ctrl.codaParte || {}), [coda]: id };
  refreshControlPage();
}

function setCodaNegozio(id) {
  Ctrl.codaNegozio = id;
  refreshControlPage();
}

// Cartella di 1. Stampare senza ordine nella coda DTF-STAMPA
function renderCartellaRiga(c, pos) {
  const st = typeof dtfCartellaStats === 'function' ? dtfCartellaStats(c) : { files: c.files, metri: c.metri || 0 };
  return `
    <article class="task-row is-task">
      <span class="task-pos" aria-label="Posizione ${pos}">${pos}</span>
      <button type="button" class="task-main" onclick="Nav.go('dtf', 'interno')" aria-label="Cartella ${escapeHtml(c.nome)}: apri DTF interno">
        <span class="task-title">${escapeHtml(c.nome)}</span>
        <span class="task-meta"><span class="task-late">cartella senza ordine</span><span aria-hidden="true"> · </span>${st.files} file · ${dtfMetri(st.metri)} m</span>
      </button>
      <div class="task-badges"><span class="td-tag" style="--c:#dc2626;">Senza ordine</span></div>
      <span class="task-time"></span>
      <div class="task-actions"><button type="button" class="ctrl-btn" onclick="Nav.go('dtf', 'interno')">Apri DTF interno</button></div>
    </article>`;
}


// Task dell'automazione della cartella DTF, con l'azione giusta a portata di clic
// Cartella "senza ordine" che è di un ordine già segnato stampato o tolto dalla lista DTF
function dtfOrdineFuoriLista(nomeCartella) {
  if (typeof dtfLists !== 'function' || typeof DtfCartella === 'undefined') return null;
  const { printed, removedList } = dtfLists();
  const o = DtfCartella.abbina(nomeCartella, [...printed, ...removedList.map(x => x.o)]);
  if (!o || o === 'ambiguo') return null;
  return { o, tolto: !printed.includes(o) };
}

async function dtfTaskRipristina(orderId, tolto) {
  if (tolto) await dtfRestoreRemoved(orderId); else await dtfRestorePrinted(orderId);
  showToast('Ordine di nuovo da stampare: il task si chiude da solo entro un minuto');
  refreshControlPage();
}

// PDF → TIF: la richiesta va al Mac mini (dtf_cartella.py), che crea i TIF entro un paio di minuti
const dtfTiffRichieste = () => TCFactory._settings.dtf_tiff_richieste || {};
const dtfTiffPdf = (nome) => (typeof DtfCartella !== 'undefined' ? DtfCartella.info()?.pdf || [] : []).find(x => x.nome === nome);
// In attesa del Mac mini: richiesta fatta e PDF ancora lì senza un errore più nuovo (al massimo 30 minuti)
function dtfTiffInCorso(nome) {
  const r = dtfTiffRichieste()[nome], sv = typeof DtfCartella !== 'undefined' ? DtfCartella.server() : null;
  if (!r?.at || Date.now() - new Date(r.at).getTime() > 30 * 60 * 1000) return false;
  return !(sv?.at && new Date(sv.at) > new Date(r.at) && dtfTiffPdf(nome)?.errore);
}
// Dove salvare sul NAS i file pronti (calcolato dal Mac mini: cartella del cliente, anno, lavorazione, dtf/tiff)
const DTF_NAS = '192.168.1.200';
const dtfNasTesto = (a) => `DATI/${a.percorso}`;
// Percorso da incollare: Finder (Vai → Vai alla cartella) sul Mac, Esplora file su Windows
function dtfNasCopia(percorso) {
  const win = /win/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  ctrlCopia(win ? `\\\\${DTF_NAS}\\DATI\\${percorso.replaceAll('/', '\\')}` : `/Volumes/DATI/${percorso}`,
    win ? 'Percorso copiato: incollalo in Esplora file' : 'Percorso copiato: nel Finder Vai → Vai alla cartella (⇧⌘G) e incollalo');
}
async function dtfTiffGenera(nome) {
  const p = dtfTiffPdf(nome);
  const elenco = p?.files?.length ? `\n\nPDF: ${p.files.join(', ')}` : '';
  const nas = p?.archivio ? `\n\nPoi salva i TIF anche sul NAS in ${dtfNasTesto(p.archivio)}${p.archivio.esiste ? '' : ' (cartella da creare)'}.` : '';
  const rid = await uiScegli(`Di quanti pixel ridurre lo SPOT (il bianco)?${elenco}\n\nIl Mac mini crea i TIF accanto ai PDF (CMYK FOGRA39 + SPOT, 300 dpi, neri K100) e sposta i PDF in «PDF originali».${nas}`,
    [0, 1, 2, 3].map(n => ({ value: n, label: `${n} px` })), { title: `Genera TIFF automatico · ${nome}` });
  if (rid == null) return;
  // Le richieste più vecchie di 7 giorni si tolgono
  const tutte = Object.fromEntries(Object.entries(dtfTiffRichieste()).filter(([, r]) => r?.at && Date.now() - new Date(r.at).getTime() < 7 * 864e5));
  tutte[nome] = { riduzione: rid, at: new Date().toISOString() };
  try {
    await TCFactory.setSetting('dtf_tiff_richieste', tutte);
    showToast(DtfCartella.server() ? 'Il Mac mini crea i TIF entro un paio di minuti: poi il task ti ricorda di salvarli sul NAS' : 'Richiesta salvata: i TIF arrivano quando il Mac mini è attivo', DtfCartella.server() ? 'success' : 'error');
  } catch (e) { console.error('[dtf tiff]', e); showToast('Richiesta non salvata: riprova', 'error'); }
  refreshControlPage();
}

function renderDtfTaskRiga(t) {
  const [tipo, ...resto] = String(t.fonte_rif?.dtf || '').split(':');
  const rif = resto.join(':'), pr = taskPrio(t.priorita);
  const fuori = tipo === 'senza' ? dtfOrdineFuoriLista(rif) : null;
  const tif = tipo === 'tif' ? { p: dtfTiffPdf(rif), corso: dtfTiffInCorso(rif) } : null;
  // Rinominare: elenco aggiornato dal Mac mini (ogni minuto), nome giusto accanto a quello di adesso
  const nomi = tipo === 'nome' && typeof DtfCartella !== 'undefined' ? (DtfCartella.info()?.nomi || []).find(x => x.nome === rif) : null;
  const metaNomi = nomi?.files?.length
    ? `${nomi.dir ? `Cartella «${escapeHtml(nomi.dir)}»` : 'File sciolto'} · regola: <strong>parte-parte-12pz</strong>
       <span class="dtf-nomi">${nomi.files.map(f => `<span class="dtf-nome"><span class="dtf-nome-da">${escapeHtml(f.file)}</span> → <strong>${escapeHtml(f.proposto)}</strong> <em>${escapeHtml(f.motivi.join(', '))}</em></span>`).join('')}</span>`
    : '';
  // TIF e Rinominare: dove salvare i file sul NAS; a lavoro fatto il task resta col promemoria fino al Fatto
  const archiviare = ['tif', 'nome'].includes(tipo) && t.fonte_rif?.fase === 'archiviare';
  const arch = (tipo === 'tif' ? tif.p?.archivio : nomi?.archivio) || t.fonte_rif?.archivio || null;
  const colla = /^colla\s*nera$/i.test(rif.trim());
  const dove = arch ? `<strong>${escapeHtml(dtfNasTesto(arch))}</strong>${arch.esiste ? '' : ' <em>(cartella da creare)</em>'}`
    : colla ? 'la cartella del cliente di ogni file' : '';
  const nasRiga = dove ? `<span class="dtf-nas">Poi salvali sul NAS in ${dove}</span>` : '';
  const pronti = archiviare ? (t.fonte_rif?.files || []).map(f => tipo === 'tif' ? String(f).replace(/\s*\.pdf$/i, '.tif') : (f.proposto || f.file || '')).filter(Boolean) : [];
  const metaArch = archiviare
    ? `<span><strong>${tipo === 'tif' ? 'TIF pronti' : 'Nomi a posto'}:</strong> salvali sul NAS in ${dove || 'la cartella del cliente'}, poi premi Fatto.</span>
       ${pronti.length ? `<span class="dtf-nomi">${pronti.map(f => `<span class="dtf-nome">${escapeHtml(f)}</span>`).join('')}</span>` : ''}`
    : '';
  const copia = arch ? `<button type="button" class="ctrl-btn" onclick="dtfNasCopia(${escapeHtml(JSON.stringify(arch.percorso))})" title="Copia il percorso della cartella sul NAS">Copia percorso</button>` : '';
  const fatto = `<button type="button" class="ctrl-btn is-primary" onclick="taskSetStato('${t.id}', 'completato')" title="File salvati sul NAS">${CtrlIcons.check()} <span>Fatto</span></button>`;
  const azioni = archiviare ? copia + fatto : {
    proposta: `<button type="button" class="ctrl-btn" onclick="dtfPrepApri('${escapeHtml(rif)}')" title="Controlla file e pezzi, poi approva o rifiuta">${CtrlIcons.check()} <span>Controlla</span></button>`,
    senza: (fuori ? `<button type="button" class="ctrl-btn" onclick="dtfTaskRipristina('${fuori.o.id}', ${fuori.tolto})" title="Rimette ${escapeHtml(fuori.o.nome)} tra gli ordini da stampare: la cartella si riabbina">${CtrlIcons.check()} <span>Ripristina</span></button>` : '')
      + `<button type="button" class="ctrl-btn" onclick="Nav.go('dtf', 'interno')" title="Apri la coda DTF interno">${fuori ? '' : `${CtrlIcons.check()} `}<span>Apri DTF interno</span></button>`,
    mancante: `<button type="button" class="ctrl-btn" onclick="openOrderDetail('${escapeHtml(rif)}')">Apri ordine</button>
      <button type="button" class="ctrl-btn" onclick="dtfMarkPrinted('${escapeHtml(rif)}')" title="Segna il DTF come stampato">${CtrlIcons.check()} <span>Stampato</span></button>`,
    nome: copia,
    tif: tif?.corso
      ? `<button type="button" class="ctrl-btn" disabled title="Il Mac mini sta creando i TIF">TIFF in preparazione…</button>`
      : `<button type="button" class="ctrl-btn" onclick="dtfTiffGenera(${escapeHtml(JSON.stringify(rif))})" title="Crea i TIF dai PDF: scegli la riduzione dello SPOT">${CtrlIcons.check()} <span>Genera TIFF automatico</span></button>` + copia,
  }[tipo] || '';
  const metaTif = tif && (tif.p?.errore && !tif.corso
    ? `<strong>Conversione non riuscita:</strong> ${escapeHtml(tif.p.errore)}`
    : tif.p?.files?.length ? `${tif.p.dir ? `Cartella «${escapeHtml(tif.p.dir)}»: ` : ''}${tif.p.files.map(escapeHtml).join(', ')}` : '');
  return `
    <article class="task-row is-task${copia && (archiviare || tipo === 'tif') ? ' dtf-2az' : ''}">
      <i class="task-prio" style="--p:${pr.color};" role="img" title="Priorità ${pr.label.toLowerCase()}" aria-label="Priorità ${pr.label.toLowerCase()}"></i>
      <button type="button" class="task-main" onclick="${tipo === 'proposta' ? `dtfPrepApri('${escapeHtml(rif)}')` : tipo === 'mancante' ? `openOrderDetail('${escapeHtml(rif)}')` : `Nav.go('dtf', 'interno')`}">
        <span class="task-title">${escapeHtml(t.titolo)}</span>
        <span class="task-meta">${fuori
          ? `<strong>${escapeHtml(fuori.o.nome)}</strong> è già ${fuori.tolto ? 'tolto dalla lista DTF' : 'segnato stampato'}: se manca ancora qualcosa premi <strong>Ripristina</strong>, se è tutto stampato sposta la cartella in 00 - Stampato.`
          : metaArch || ((metaTif || metaNomi) ? (metaTif || metaNomi) + nasRiga : escapeHtml(t.descrizione || ''))}</span>
      </button>
      <div class="task-badges">${t.priorita === 'urgente' ? `<span class="td-tag" style="--c:${pr.color};">Urgente</span>` : ''}</div>
      <span class="task-time"></span>
      <div class="task-actions">${azioni}</div>
    </article>`;
}

// Riga del conto terzi (cartella del cliente copiata da Google Drive) in cima alla coda DTF
function renderCtRiga(r, pos) {
  const st = dtfCartellaStats(r.c);
  return `
    <article class="task-row is-task">
      <span class="task-pos" aria-label="Posizione ${pos}">${pos}</span>
      <button type="button" class="task-main" onclick="Nav.go('dtf', 'interno')" aria-label="Conto terzi ${escapeHtml(r.cliente.nome)}: apri DTF interno">
        <span class="task-title">Conto terzi · ${escapeHtml(r.cliente.nome)}</span>
        <span class="task-meta">cartella «${escapeHtml(r.c.dir || r.c.nome)}» in 1. Stampare<span aria-hidden="true"> · </span>${st.files} file · ${dtfMetri(st.metri)} m · metri già nel conto terzi</span>
      </button>
      <div class="task-badges"><span class="td-tag" style="--c:#0ea5e9;">Conto terzi</span></div>
      <span class="task-time"></span>
    </article>`;
}

// Lavorazione per i negozi in 1. Stampare ("ordine-bienjugado", "ordini-sito"…): prima di tutto
function renderNegozioRiga(r, pos) {
  const st = dtfCartellaStats(r.c);
  return `
    <article class="task-row is-task">
      <span class="task-pos" aria-label="Posizione ${pos}">${pos}</span>
      <button type="button" class="task-main" onclick="Nav.go('dtf', 'interno')" aria-label="Negozi ${escapeHtml(r.c.negozio)}: apri DTF interno">
        <span class="task-title">Negozi · ${escapeHtml(r.c.negozio)}</span>
        <span class="task-meta">${r.c.dir ? 'cartella' : 'file'} «${escapeHtml(r.c.dir || r.c.nome)}» in 1. Stampare<span aria-hidden="true"> · </span>${st.files} file · ${dtfMetri(st.metri)} m</span>
      </button>
      <div class="task-badges"><span class="td-tag" style="--c:#ef4444;">Priorità negozi</span></div>
      <span class="task-time"></span>
    </article>`;
}

// Riga di un ordine (code File e DTF): si apre l'ordine
function renderOrdineRiga(o, { pos = null, dtf = false, azione = null } = {}) {
  const urg = typeof isUrgentOrder === 'function' ? isUrgentOrder(o) : o.priorityId === 'urgente';
  const fmt = (d) => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  const dl = TCFactory.getEffectiveDeadline?.(o)?.date || o.deadline;
  const late = dl && dl < ctrlOggi();
  const tags = (o.tags || []).filter(t => !TASK_TAG_ESCLUSI.has(taskSlug(t)));
  const st = dtf && typeof dtfOrderStats === 'function' ? dtfOrderStats(o) : null;
  const meta = [
    tags.map(t => `<span class="ctrl-macro-tag" style="--m:${TCFactory.getTagColor(t)};">${escapeHtml(t)}</span>`).join(' '),
    `ordine ${escapeHtml(o.id)}`,
    dl ? `<span class="${late ? 'task-late' : ''}">consegna ${late ? 'scaduta il' : 'entro il'} ${fmt(dl)}</span>` : '',
    st ? (st.files ? `${st.files} file · ${dtfMetri(st.metri)} m${st.ore != null ? ` · ${dtfFmtTime(st.ore)}` : ''}` : '<span class="task-late">file DTF da aggiungere</span>')
       : (o.dtfItems || []).length ? `${o.dtfItems.length} DTF caricati` : '',
  ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  const pr = taskPrio(urg ? 'urgente' : 'normale');
  return `
    <article class="task-row is-task">
      ${pos ? `<span class="task-pos" aria-label="Posizione ${pos}">${pos}</span>`
            : `<i class="task-prio" style="--p:${pr.color};" role="img" title="Priorità ${pr.label.toLowerCase()}" aria-label="Priorità ${pr.label.toLowerCase()}"></i>`}
      <button type="button" class="task-main" onclick="openOrderDetail('${o.id}')" aria-label="${escapeHtml(o.nome)}: apri l'ordine">
        <span class="task-title">${escapeHtml(o.nome)}</span>
        <span class="task-meta">${meta}</span>
      </button>
      <div class="task-badges">${urg ? `<span class="td-tag" style="--c:${pr.color};">Urgente</span>` : ''}${dtf ? '' : '<span class="td-tag" style="--c:#a855f7;">Senza file</span>'}</div>
      <span class="task-time"></span>
      <div class="task-actions">${azione === 'file'
        ? `<button type="button" class="ctrl-btn" onclick="dtfOpenOrderFiles('${o.id}')" title="Aggiungi i file DTF dell'ordine">${CtrlIcons.check()} <span>Aggiungi file</span></button>`
        : `<button type="button" class="ctrl-btn" onclick="${dtf ? 'codaDtfFatto' : 'codaFileFatto'}('${o.id}')" title="${dtf ? 'Segna il DTF come stampato' : 'Togli l\'ordine dalla coda File'}">${CtrlIcons.check()} <span>Fatto</span></button>`}
        <button type="button" class="ctrl-btn task-open" onclick="openOrderDetail('${o.id}')" aria-label="Apri l'ordine ${escapeHtml(o.nome)}">Apri</button></div>
    </article>`;
}

// DTF stampato dalla coda: come "Stampato" nella pagina DTF (giallo Stampa sull'ordine), poi l'ordine passa avanti
async function codaDtfFatto(id) {
  await dtfMarkPrinted(id);
  refreshControlPage();
}

// Filtro della coda comune: prima le code di produzione (sempre), poi i brand con almeno un task
function taskCodaBar(list, righe) {
  const conta = { dtffile: righe.file.length, dtfstampa: righe.stampa.length };
  list.forEach(t => { const c = taskCoda(t); if (c) conta[c] = (conta[c] || 0) + 1; });
  const att = codaAttiva();
  return `
    <div class="ctrl-macro-bar" role="group" aria-label="Code">
      ${TASK_CODE_Q.map(c => ctrlFilter(att === c.id, c.label, conta[c.id] || 0, c.color, `setControlCoda('${c.id}')`)).join('')}
    </div>`;
}

function setControlCoda(id) {
  Ctrl.coda = id;
  refreshControlPage();
}

// Un task è in ritardo se la scadenza è passata o se arriva dai giorni prima
const taskInRitardo = (t) => {
  const o = taskOrdineGest(t);
  if (o) { const d = ordineScad(o); return d !== '9' && d < ctrlOggi(); }
  return (t.scadenza && new Date(t.scadenza) < new Date()) || t.giorno < Ctrl.giorno;
};

// La coda divisa per urgenza; i task dello stesso ordine restano insieme, nella sezione del più importante
function taskSections(list) {
  const livello = (t) => taskInRitardo(t) ? 1 : 2;
  const chiave = (t) => taskGruppo(t) || t.id;
  const min = new Map();
  list.forEach(t => { const k = chiave(t); min.set(k, Math.min(min.get(k) ?? 9, livello(t))); });
  return [['Urgenti', 0], ['In ritardo', 1], ['Da fare', 2]]
    .map(([titolo, n]) => [titolo, list.filter(t => min.get(chiave(t)) === n)])
    .filter(([, righe]) => righe.length);
}

// Filtro per categoria: i brand e i tag degli ordini; le categorie vuote non si mostrano
function taskMacroBar(list) {
  const conta = {};
  list.forEach(t => { const c = taskCat(t); conta[c] = (conta[c] || 0) + 1; });
  const chip = (id, label, n, color) => ctrlFilter(Ctrl.macroarea === id, label, n, color, `setControlMacro(${id ? `'${id}'` : 'null'})`);
  const cat = [...taskCategorie(), TASK_SENZA_CAT].filter(c => conta[c.id] || Ctrl.macroarea === c.id);
  return `
    <div class="ctrl-macro-bar" role="group" aria-label="Filtra per categoria">
      ${chip(null, 'Tutte', list.length)}
      ${cat.map(c => chip(c.id, c.label, conta[c.id] || 0, c.color)).join('')}
    </div>`;
}

function setControlMacro(id) {
  Ctrl.macroarea = id;
  refreshControlPage();
}

// Scadenza: l'ora se è nel giorno del task, la sola data se è a mezzanotte
function taskScadenzaTesto(t) {
  const ts = t.scadenza, giorno = ctrlGiornoDi(ts);
  if (giorno === t.giorno) return `le ${ctrlFmtOra(ts)}`;
  const data = new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
  return ctrlFmtOra(ts) === '00:00' ? `il ${data}` : `il ${data}, ${ctrlFmtOra(ts)}`;
}

function renderTaskRow(t, { showOwner = false, showStore = true, showAuto = true, titolo = t.titolo } = {}) {
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id);
  const scaduto = t.scadenza && !['completato', 'non_completato'].includes(t.stato) && new Date(t.scadenza) < new Date();
  const meta = [
    showStore && taskBrand(t) !== '_' ? `<span class="ctrl-macro-tag" style="--m:${taskCatInfo(taskBrand(t)).color};">${escapeHtml(taskCatInfo(taskBrand(t)).label)}</span>` : '',
    showOwner ? `<strong>${t.assegnato_a ? escapeHtml(t.assegnato_a) : 'Coda comune'}</strong>` : '',
    showAuto && t.automazione_errore ? '<span class="task-late">automazione non riuscita</span>' : '',
    t.delega?.da ? `delegato da ${escapeHtml(t.delega.da)}` : '',
    // Il tipo solo se il titolo non lo dice già
    tipo && !titolo.toLowerCase().startsWith(tipo.nome.toLowerCase()) ? escapeHtml(tipo.nome) : '',
    t.scadenza ? `<span class="${scaduto ? 'task-late' : ''}">${scaduto ? 'scaduto' : 'entro'} ${taskScadenzaTesto(t)}</span>` : '',
    t.giorno < Ctrl.giorno ? `<span class="${scaduto ? '' : 'task-late'}">in lista dal ${ctrlFmtGiorno(t.giorno).toLowerCase()}</span>` : '',
    t.rinvii ? `rimandato ${t.rinvii}×` : '',
  ].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  const chip = (label, color) => `<span class="td-tag" style="--c:${color};">${label}</span>`;
  const badges = [
    t.priorita === 'urgente' ? chip(pr.label, pr.color) : '',
    !['da_fare', 'in_lavorazione', 'in_pausa'].includes(t.stato) ? chip(st.label, st.color) : '',
    t.bozza_risposta && !t.risposta_inviata_at ? chip('Bozza pronta', '#2563eb') : '',
    t.risposta_inviata_at ? chip('Risposta inviata', '#16a34a') : '',
  ].join('');

  return `
    <article class="task-row is-task ${t.stato === 'completato' ? 'is-done' : ''}">
      <i class="task-prio" style="--p:${pr.color};" role="img" title="Priorità ${pr.label.toLowerCase()}" aria-label="Priorità ${pr.label.toLowerCase()}"></i>
      <button type="button" class="task-main" onclick="openTaskDetail('${t.id}')" aria-label="${escapeHtml(t.titolo)}: dettagli">
        <span class="task-title">${escapeHtml(titolo)}</span>
        ${meta ? `<span class="task-meta">${meta}</span>` : ''}
        ${taskMotivoVisibile(t.stato, t.motivo) ? `<span class="task-motivo">${escapeHtml(t.motivo)}</span>` : ''}
      </button>
      <div class="task-badges">${badges}</div>
      <span class="task-time">${t.minuti_stimati ? `${Icons.clock(12)} ${ctrlFmtMin(t.minuti_stimati)}` : ''}${taskMisurato(t) ? `<span class="task-timer ${t.stato === 'in_lavorazione' ? 'is-on' : ''}" data-task-timer="${t.id}" title="Tempo misurato">${ctrlFmtDur(taskLavoratoSec(t))}</span>` : ''}</span>
      <div class="task-actions">${Ctrl.canAct(t) ? taskQuickActions(t, { assegna: false, fatto: false }) : ''}
        <button type="button" class="ctrl-btn task-open" onclick="openTaskDetail('${t.id}')" aria-label="Apri ${escapeHtml(t.titolo)}">Apri</button>
      </div>
    </article>`;
}

function taskQuickActions(t, { fatto = true, assegna = true } = {}) {
  if (TCAuth.isAdmin() && t.assegnato_a !== Ctrl._me()) {
    if (!assegna || ['completato', 'non_completato'].includes(t.stato)) return '';
    return `<select class="ctrl-assign" aria-label="Assegna il task" onchange="taskAssign('${t.id}', this.value)">
      <option value="">${t.assegnato_a ? 'Coda comune' : 'Assegna a…'}</option>
      ${Ctrl.users.map(u => `<option value="${escapeHtml(u)}" ${t.assegnato_a === u ? 'selected' : ''}>${escapeHtml(u)}${!t.assegnato_a && t.designato === u ? ' (designato)' : ''}</option>`).join('')}
    </select>`;
  }
  const btn = (stato, icon, label, cls = '') =>
    `<button class="ctrl-btn ${cls}" onclick="taskSetStato('${t.id}','${stato}')">${icon} <span>${label}</span></button>`;
  const primo = Ctrl._prossimo === t.id ? 'is-primary' : '';
  if (['completato', 'non_completato'].includes(t.stato)) return btn('da_fare', CtrlIcons.undo(), 'Riapri');
  // Prova dei tempi: sui task produttivi chi lavora preme Inizia (e se lo prende); la fine arriva dal pulsante dell'ordine
  const cronometro = !taskInProva(t) ? ''
    : t.stato === 'in_lavorazione' ? btn('in_pausa', CtrlIcons.pause(), 'Pausa') : btn('in_lavorazione', CtrlIcons.play(), t.lavorato_sec ? 'Riprendi' : 'Inizia');
  const prendi = !t.assegnato_a && !cronometro ? `<button class="ctrl-btn ${t.designato === Ctrl._me() ? 'is-primary' : ''}" onclick="taskPrendi('${t.id}')">${CtrlIcons.hand()} <span>Prendi</span></button>` : '';
  return prendi + cronometro + (fatto ? btn('completato', CtrlIcons.check(), 'Fatto', primo) : '');
}

async function taskSetStato(id, stato, motivo = null, giorno = null) {
  try {
    await Ctrl.setStato(id, stato, motivo, giorno);
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
    return true;
  } catch (e) { showToast(e.message, 'error'); return false; }
}

// Task di una fase dell'ordine fatto → lo stato dell'ordine si aggiorna da solo, come col pulsante
// (il registro dell'ordine segna chi ha fatto il task). Chiave della fase: prod:<ordine>:<chiave>
async function taskAggiornaOrdine(t) {
  const ev = t.fonte_rif?.evento_id || '';
  if (t.fonte !== 'gestionale' || !ev.startsWith('prod:') || typeof Pulsanti === 'undefined') return;
  const resto = ev.slice(5), i = resto.indexOf(':');
  const ordine = t.fonte_rif?.ordine || resto.slice(0, i), fase = resto.slice(i + 1);   // es. "applica_dtf", "invio:le-…"
  const o = TCFactory.getOrderById(ordine);
  if (!o) return;
  try {
    let segnato = null;
    const P = (id) => Pulsanti.get(id), evade = () => Pulsanti.visibili(o).find(p => p.ruolo === 'evade');
    if (fase === 'merce') segnato = await Pulsanti.daTask(ordine, P('merceCompleta'));
    else if (fase === 'stampa_dtf') segnato = await Pulsanti.daTask(ordine, Pulsanti.byStage('dtfPronti'), true);
    else if (fase === 'applica_dtf') segnato = await Pulsanti.daTask(ordine, Pulsanti.byStage('dtfPronti'));
    else if (/^li-/.test(fase)) segnato = await Pulsanti.daTask(ordine, Pulsanti.byLink(`interne:${fase}`));
    else if (/^invio:/.test(fase)) segnato = await Pulsanti.daTask(ordine, Pulsanti.byLink(`esterne:${fase.slice(6)}`) || Pulsanti.byStage('lavorazioneEsterna'), true);
    else if (fase === 'controllo') segnato = await Pulsanti.daTask(ordine, P('ordineStampato'));
    else if (fase === 'spedire') segnato = await Pulsanti.daTask(ordine, evade());
    else if (fase === 'fattura' && !o.invoiceConfirmed) {
      await TCFactory.updateOrder(ordine, { invoiceConfirmed: true });
      TCFactory._log('✓ Fattura confermata', ordine, o.nome, { stage: 'fattura', done: true });
      segnato = 'Fattura';
    } else if (fase === 'incasso' && !o.paymentDone) {
      const evaso = Pulsanti.isEvaso(o);
      await TCFactory.updateOrder(ordine, { paymentDone: true, paymentDate: localISODate(new Date()) });
      if (evaso) await TCFactory.setArchived(ordine, true);
      TCFactory._log('✓ Pagato', ordine, o.nome, { stage: 'pagamento', done: true });
      segnato = 'Pagato';
    }
    if (segnato) showToast(`Ordine ${o.nome || ''}: ${segnato} aggiornato`);
  } catch (e) {
    showToast(`Task fatto, ma l'ordine non si è aggiornato: ${e.message || e}`, 'error');
  }
}

async function taskPrendi(id) {
  try {
    await Ctrl.prendi(id);
    showToast('Task preso in carico');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Team (admin) ──

// ── Consuntivo (Team): cosa ha fatto ogni persona, quanto tempo e quanto è costato ──
// Tempo = misurato se c'è, altrimenti la stima. Periodo che finisce nel giorno scelto.
const CtrlCons = { periodo: 'giorno', chiave: null, dati: null, errore: null };
const consEuro = (v) => `${(Number(v) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
function consPeriodo() {
  const d = Ctrl.giorno;
  const dal = CtrlCons.periodo === 'settimana' ? ctrlAddDays(d, -6) : CtrlCons.periodo === 'mese' ? `${d.slice(0, 8)}01` : d;
  return { dal, al: d };
}
async function loadConsuntivo() {
  const { dal, al } = consPeriodo(), chiave = `${dal}|${al}`;
  CtrlCons.chiave = chiave;
  try {
    const r = await Ctrl._rpc('tc_consuntivo', { p_dal: dal, p_al: al });
    if (CtrlCons.chiave !== chiave) return;
    CtrlCons.dati = r; CtrlCons.errore = null;
  } catch (e) { CtrlCons.errore = e; }
  refreshControlPage();
}
function setConsPeriodo(p) { CtrlCons.periodo = p; CtrlCons.dati = null; loadConsuntivo(); refreshControlPage(); }
async function cambiaCostoOra() {
  const v = await uiPrompt('Manodopera (€ lordi all\'ora)', { value: String(CtrlCons.dati?.costo_ora ?? 11.31).replace('.', ','), ok: 'Salva' });
  if (v === null) return;
  const n = parseFloat(String(v).replace(',', '.'));
  if (!(n >= 0)) { showToast('Scrivi un numero', 'error'); return; }
  try { await Ctrl._rpc('tc_costo_ora_imposta', { p_valore: n }); showToast('Manodopera salvata'); loadConsuntivo(); }
  catch (e) { showToast(e.message, 'error'); }
}

function renderConsuntivo() {
  const { dal, al } = consPeriodo();
  if (CtrlCons.chiave !== `${dal}|${al}`) { CtrlCons.dati = null; loadConsuntivo(); }
  const c = CtrlCons.dati, per = CtrlCons.periodo;
  const chip = (id, label) => `<button type="button" class="ctrl-btn ${per === id ? 'is-primary' : ''}" aria-pressed="${per === id}" onclick="setConsPeriodo('${id}')">${label}</button>`;
  const periodoTesto = dal === al ? ctrlFmtGiorno(al) : `dal ${ctrlFmtGiorno(dal).toLowerCase()} al ${ctrlFmtGiorno(al).toLowerCase()}`;
  const corpo = CtrlCons.errore ? `<div class="empty-list">${CtrlCons.errore.notInstalled ? 'Esegui lo script <strong>sql/consuntivo-costi.sql</strong> su Supabase.' : escapeHtml(CtrlCons.errore.message)}</div>`
    : !c ? '<div class="empty-list">Caricamento…</div>'
    : !c.persone.length ? '<div class="empty-list">Nessun task fatto in questo periodo.</div>'
    : `
      <div class="tempi-totale">
        <div><span>Task fatti</span><strong>${c.totale.task}</strong></div>
        <div><span>Tempo di lavoro</span><strong>${ctrlFmtMin(c.totale.minuti)}</strong></div>
        <div><span>Costo</span><strong>${consEuro(c.totale.costo)}</strong></div>
        ${c.sviluppo?.task ? `<div><span>Sviluppo con Claude, a parte</span><strong>${c.sviluppo.task} sessioni</strong></div>` : ''}
      </div>
      <div class="table-scroll"><table class="data-table tempi-table">
        <thead><tr><th>Persona</th><th>Task fatti</th><th>Tempo stimato</th><th>Costo</th></tr></thead>
        <tbody>${c.persone.map(p => `
          <tr><td><strong>${escapeHtml(p.chi)}</strong>${p.chi === 'tcfactory' ? '<div class="ctrl-cell-sub">account condiviso</div>' : ''}</td>
            <td>${p.task}</td><td>${ctrlFmtMin(p.minuti)}</td>
            <td><strong>${consEuro(p.costo)}</strong></td></tr>`).join('')}</tbody>
      </table></div>
      ${c.ordini.length ? `
        <h3 class="tempi-h3">Costo degli ordini lavorati <span class="ctrl-cell-sub">· manodopera delle fasi fatte, DTF, lavorazioni e merce · i lotti Shopify divisi tra i loro ordini</span></h3>
        <div class="table-scroll"><table class="data-table tempi-table">
          <thead><tr><th>Ordine</th><th>Origine</th><th>Manodopera</th><th>DTF</th><th>Lavorazioni</th><th>Merce</th><th>Totale</th></tr></thead>
          <tbody>${c.ordini.slice(0, 60).map(o => `
            <tr><td><strong>${escapeHtml(o.nome || '—')}</strong>
                ${(o.mancano || []).length ? `<div class="ctrl-cell-sub task-late">Manca: ${o.mancano.map(escapeHtml).join(' · ')}</div>` : ''}</td>
              <td>${escapeHtml(o.origine)}</td>
              <td>${consEuro(o.manodopera)}<div class="ctrl-cell-sub">${ctrlFmtMin(o.minuti)}</div></td>
              <td>${o.dtf ? `${consEuro(o.dtf)}<div class="ctrl-cell-sub">${String(o.metri_dtf).replace('.', ',')} m</div>` : '<span class="ctrl-cell-sub">—</span>'}</td>
              <td>${o.lavorazioni ? consEuro(o.lavorazioni) : '<span class="ctrl-cell-sub">—</span>'}</td>
              <td>${o.merce ? consEuro(o.merce) : '<span class="ctrl-cell-sub">—</span>'}</td>
              <td><strong>${consEuro(o.totale)}</strong></td></tr>`).join('')}</tbody>
        </table></div>` : ''}`;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Consuntivo</h2>
        <span class="ctrl-group-hint">${periodoTesto} · manodopera ${consEuro(c?.costo_ora ?? 11.31)}/h
          <button type="button" class="ctrl-btn" onclick="cambiaCostoOra()">Cambia</button></span></div>
      <div class="ctrl-skill-people" role="group" aria-label="Periodo">${chip('giorno', 'Giorno')}${chip('settimana', '7 giorni')}${chip('mese', 'Mese')}</div>
      ${corpo}
      <p class="ctrl-cell-sub">Tempo: la stima del task (tempi per categoria e minuti dei tipi di task); il cronometro serve solo nella prova dei tempi.
        I costi si impostano in <button type="button" class="ctrl-btn" onclick="setControlView('costivivi')">Costi vivi</button>.</p>
    </section>`;
}

// ── Costi vivi: manodopera, DTF, lavorazioni, merce (dal costo di ogni prodotto). Quello senza valore è "da impostare" ──
const CtrlVivi = { dati: null, errore: null };
const DTF_MATERIALI_CV = [
  ['Supporto', 'dtf_supporto_eur', 'dtf_supporto_m', 'rotolo'], ['Inchiostro bianco', 'dtf_ink_white_eur', 'dtf_ink_white_m', 'inchiostro'],
  ['Inchiostro CMYK (uno dei 4)', 'dtf_ink_cmyk_eur', 'dtf_ink_cmyk_m', 'inchiostro'], ['Colla', 'dtf_colla_eur', 'dtf_colla_m', 'confezione'],
];
async function loadCostiVivi() {
  try { CtrlVivi.dati = await Ctrl._rpc('tc_costi_vivi'); CtrlVivi.errore = null; }
  catch (e) { CtrlVivi.errore = e; }
  refreshControlPage();
}
const cvNum = (v) => { const t = String(v ?? '').trim().replace(',', '.'); return t === '' ? null : Math.max(0, parseFloat(t) || 0); };
const cvVal = (v) => v == null ? '' : String(Number(v)).replace('.', ',');
const cvDaImpostare = '<span class="td-tag" style="--c:#dc2626;">Da impostare</span>';
async function cvSalva(fn, msg = 'Costo salvato') {
  try { await fn(); showToast(msg); CtrlCons.chiave = null; await loadCostiVivi(); }
  catch (e) { showToast(e.message || String(e), 'error'); }
}
const cvSalvaLav = (voce, v) => cvSalva(async () => {
  const { error } = await supabaseClient.from('costi_vivi').upsert({ voce, valore: cvNum(v), updated_at: new Date().toISOString(), updated_by: Ctrl._me() });
  if (error) throw Ctrl._fail(error);
});
// Costo del prodotto scritto qui: si salva sul prodotto (come dalla scheda Prodotti) e sparisce dall'elenco
const cvSalvaProdotto = (id, v) => cvNum(v) ? cvSalva(() => TCFactory.saveProduct(id, { costo: cvNum(v) }), 'Costo del prodotto salvato') : null;
const cvSalvaOra = (v) => cvSalva(() => Ctrl._rpc('tc_costo_ora_imposta', { p_valore: cvNum(v) ?? 0 }));
const cvSalvaDtf = (key, v) => cvSalva(() => TCFactory.setSetting(key, cvNum(v) ?? 0));

function renderCostiVivi() {
  if (CtrlVivi.errore) return `<div class="glass-card page-card"><div class="empty-list">${CtrlVivi.errore.notInstalled ? 'Esegui lo script <strong>sql/costi-vivi.sql</strong> su Supabase.' : escapeHtml(CtrlVivi.errore.message)}</div></div>`;
  const d = CtrlVivi.dati;
  if (!d) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const lavSenza = d.lavorazioni.filter(l => l.valore == null);
  const daFare = lavSenza.length + d.prodotti_senza_costo.length + (Number(d.dtf_costo_m) > 0 ? 0 : 1);
  const input = (val, on, label, extra = '') => `<input class="form-input tempi-num" inputmode="decimal" value="${cvVal(val)}" aria-label="${escapeHtml(label)}" onchange="${on}" ${extra}>`;
  const sez = (titolo, n, hint, corpo) => `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${titolo}</h2>${n ? `<span class="table-count">${n}</span>` : ''}<span class="ctrl-group-hint">${hint}</span></div>
      ${corpo}
    </section>`;
  const set = TCFactory._settings || {};
  const ora = d.costo_ora?.valore ?? 11.31;
  return `
    <div class="tempi-totale">
      <div><span>Costi da impostare</span><strong class="${daFare ? 'task-late' : ''}">${daFare}</strong></div>
      <div><span>Manodopera</span><strong>${consEuro(ora)}/h</strong></div>
      <div><span>DTF</span><strong>${Number(d.dtf_costo_m) > 0 ? `${consEuro(d.dtf_costo_m)}/m` : 'Da impostare'}</strong></div>
    </div>

    ${sez('Manodopera', 0, 'Costo lordo all\'ora × il tempo stimato dei task', `
      <div class="table-scroll"><table class="data-table tempi-table">
        <thead><tr><th>Voce</th><th>€ all'ora</th></tr></thead>
        <tbody><tr><td><strong>Manodopera</strong>${d.costo_ora?.nota ? `<div class="ctrl-cell-sub">${escapeHtml(d.costo_ora.nota)}</div>` : ''}</td>
          <td>${input(ora, 'cvSalvaOra(this.value)', 'Manodopera all\'ora')}</td></tr></tbody>
      </table></div>`)}

    ${sez('DTF', 0, `Materiali del rotolo: ${Number(d.dtf_costo_m) > 0 ? `<strong>${consEuro(d.dtf_costo_m)} al metro</strong>` : cvDaImpostare} · nel costo dell'ordine × i metri dei suoi DTF`, `
      <div class="table-scroll"><table class="data-table tempi-table">
        <thead><tr><th>Materiale</th><th>Prezzo €</th><th>Metri stampati</th><th>€ al metro</th></tr></thead>
        <tbody>${DTF_MATERIALI_CV.map(([nome, eur, m, per]) => {
          const e = parseFloat(set[eur]) || 0, mm = parseFloat(set[m]) || (eur === 'dtf_supporto_eur' ? 100 : 0);
          const alM = mm > 0 ? e / mm * (eur === 'dtf_ink_cmyk_eur' ? 4 : 1) : 0;
          return `<tr><td><strong>${nome}</strong><div class="ctrl-cell-sub">prezzo di un ${per}</div></td>
            <td>${input(set[eur], `cvSalvaDtf('${eur}', this.value)`, `Prezzo ${nome}`)}</td>
            <td>${input(set[m], `cvSalvaDtf('${m}', this.value)`, `Metri ${nome}`)}</td>
            <td>${alM ? consEuro(alM) : cvDaImpostare}</td></tr>`;
        }).join('')}</tbody>
      </table></div>`)}

    ${sez('Lavorazioni', lavSenza.length ? `${lavSenza.length} da impostare` : 0, 'Costo a pezzo: nel costo dell\'ordine × i pezzi con quella lavorazione', `
      <div class="table-scroll"><table class="data-table tempi-table">
        <thead><tr><th>Lavorazione</th><th>Tipo</th><th>Ordini (90 giorni)</th><th>€ a pezzo</th><th></th></tr></thead>
        <tbody>${d.lavorazioni.map(l => `<tr><td><strong>${escapeHtml(l.nome)}</strong></td><td>${l.tipo === 'interna' ? 'Interna' : 'Esterna'}</td><td>${l.ordini}</td>
          <td>${input(l.valore, `cvSalvaLav('${escapeHtml(l.voce)}', this.value)`, `Costo a pezzo ${l.nome}`)}</td>
          <td>${l.valore == null ? cvDaImpostare : ''}</td></tr>`).join('')}</tbody>
      </table></div>`)}

    ${sez('Prodotti senza costo', d.prodotti_senza_costo.length, 'Si imposta nella scheda Prodotti', `
      ${d.prodotti_senza_costo.length ? `<ul class="cv-prodotti">${d.prodotti_senza_costo.map(x => `
          <li><span class="cv-prodotto">${escapeHtml(x.nome || '—')}${x.codice && x.nome !== x.codice ? ` <span class="ctrl-cell-sub">${escapeHtml(x.codice)}</span>` : ''}</span>
            <input class="form-input tempi-num" inputmode="decimal" placeholder="Costo €" aria-label="Costo di ${escapeHtml(x.nome || x.codice || '')}" onchange="cvSalvaProdotto('${x.id}', this.value)">
            <button type="button" class="ctrl-btn" onclick="openProductForm('${x.id}')">Scheda</button></li>`).join('')}</ul>`
        : '<div class="empty-list">Tutti i prodotti hanno un costo.</div>'}`)}`;
}

function renderControlTeam() {
  const d = Ctrl.giorno;
  const people = Ctrl.users;
  const card = (nick) => {
    const list = Ctrl.tasks.filter(t => t.assegnato_a === nick && t.giorno === d);
    const p = Ctrl.punteggi[nick], p7 = Ctrl.punteggi7[nick];
    const fatti = list.filter(t => t.stato === 'completato').length;
    const minTot = p ? p.minuti_assegnati : 0, minFatti = p ? p.minuti_completati : 0;
    const pct = minTot ? Math.min(100, Math.round(minFatti / minTot * 100)) : 0;
    const arretrati = Ctrl.tasks.filter(t => t.assegnato_a === nick && t.giorno < d).length;
    const bloccati = list.filter(t => t.stato === 'bloccato').length;
    return `
      <article class="glass-card ctrl-person">
        <header>
          <h3>${escapeHtml(nick)}</h3>
          <div class="ctrl-score" title="Punteggio del giorno">
            <strong>${p ? p.punteggio : '—'}</strong><small>7 gg: ${p7 ? p7.punteggio : '—'}</small>
          </div>
        </header>
        <div class="ctrl-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
          aria-label="Minuti completati"><span style="width:${pct}%"></span></div>
        <div class="ctrl-person-meta">
          <span>${fatti}/${list.length} task</span>
          <span>${ctrlFmtMin(minFatti)} / ${ctrlFmtMin(minTot)}</span>
          ${arretrati ? `<span class="task-late">${arretrati} arretrati</span>` : ''}
          ${bloccati ? `<span>${bloccati} bloccati</span>` : ''}
        </div>
      </article>`;
  };

  const tutti = Ctrl.tasks.filter(t => t.giorno === d && t.assegnato_a);
  const haTask = (nick) => Ctrl.tasks.some(t => t.assegnato_a === nick);
  const attiviOggi = people.filter(haTask);
  return `
    ${renderConsuntivo()}
    <div class="ctrl-team">${attiviOggi.map(card).join('')}</div>
    ${renderTeamTable(people)}
    ${taskGroupOwner('Tutti i task del giorno', tutti, 'Nessun task assegnato per questo giorno.')}
    <p class="settings-section-hint ctrl-note">Punteggio: 70% minuti standard completati sui minuti assegnati, 20% puntualità, 10% task non riaperti.
      I bloccati non contano, i rimandati contano dal nuovo giorno. Visibile solo agli admin.</p>`;
}

function taskGroupOwner(title, list, emptyText = '', hint = '') {
  if (!list.length && !emptyText) return '';
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${title}</h2><span class="table-count">${list.length}</span>
        ${hint ? `<span class="ctrl-group-hint">${hint}</span>` : ''}</div>
      ${list.length ? `<div class="task-list task-stack">${sortTasks(list).map(t => renderTaskRow(t, { showOwner: true })).join('')}</div>`
                    : `<div class="empty-list">${emptyText}</div>`}
    </section>`;
}

// ── Tipi di task (admin) ──

function renderControlTypes() {
  const rows = Ctrl.tipi.map(tp => {
    const aut = TASK_AUTONOMIA.find(a => a.id === tp.autonomia) || TASK_AUTONOMIA[0];
    return `
      <tr class="${tp.attivo ? '' : 'ctrl-off'}">
        <td><strong>${escapeHtml(tp.nome)}</strong>${tp.descrizione ? `<div class="ctrl-cell-sub">${escapeHtml(tp.descrizione)}</div>` : ''}</td>
        <td>${ctrlFmtMin(tp.minuti_standard)}</td>
        <td>${tp.competenza ? escapeHtml(competenzaLabel(tp.competenza)) : '<span class="ctrl-cell-sub">—</span>'}</td>
        <td title="${aut.hint}">${aut.label}</td>
        <td class="ctrl-cell-actions">
          <button class="btn-icon" onclick="openTaskTypeForm('${tp.id}')" aria-label="Modifica ${escapeHtml(tp.nome)}">${Icons.edit()}</button>
          <button class="btn-icon" onclick="removeTaskType('${tp.id}')" aria-label="Elimina ${escapeHtml(tp.nome)}">${Icons.trash()}</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <section class="glass-card page-card">
      <div class="page-card-head"><h2>Tipi di task</h2><span class="table-count">${Ctrl.tipi.length}</span>
        <span class="ctrl-group-hint">Il tempo standard è la stima di partenza di ogni task di questo tipo.</span></div>
      ${Ctrl.tipi.length ? `
        <div class="table-scroll"><table class="data-table ctrl-types">
          <thead><tr><th>Tipo</th><th>Standard</th><th>Competenza</th><th>Autonomia</th><th><span class="sr-only">Azioni</span></th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : `<div class="empty-list">Nessun tipo ancora. Crea i tipi di lavoro ricorrenti (es. "Risposta a un cliente", "Preparare una spedizione") con il loro tempo standard.</div>`}
    </section>`;
}

async function applyRealTime(id, minuti) {
  try {
    await Ctrl.saveTipo(id, { minuti_standard: minuti });
    showToast(`Tempo standard aggiornato a ${minuti} minuti`);
    await Ctrl.load();
    refreshControlPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeTaskType(id) {
  const tp = Ctrl.tipo(id);
  if (!(await uiConfirm(`Eliminare il tipo "${tp?.nome}"? I task già creati restano, senza tipo.`, { ok: 'Elimina', danger: true }))) return;
  try {
    await Ctrl.deleteTipo(id);
    showToast('Tipo eliminato');
    await Ctrl.load();
    refreshControlPage();
  } catch (e) { showToast(e.message, 'error'); }
}

// ─────────────────────────────────────────────
// FINESTRE
// ─────────────────────────────────────────────

const CTRL_MODAL = 'ctrl-modal';

function ctrlModal(html, width = 520, cls = '') {
  const modal = document.getElementById(CTRL_MODAL);
  modal.innerHTML = `<div class="modal ${cls}" style="max-width:${width}px;" role="dialog" aria-modal="true" aria-labelledby="ctrl-modal-title">${html}</div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal(CTRL_MODAL); };
}

const ctrlModalHead = (title) => `
  <div class="modal-header">
    <h2 id="ctrl-modal-title">${title}</h2>
    <button class="btn-icon" onclick="closeModal('${CTRL_MODAL}')" aria-label="Chiudi">${Icons.x()}</button>
  </div>`;

// ── Dettaglio task: stato, motivo, storico ──

let _taskAction = null;   // stato con motivo in compilazione

let _taskMail = null;     // mail d'origine del task aperto
let _taskBozza = null;    // bozza in modifica

async function openTaskDetail(id, action = null) {
  _taskAction = action;
  const t = Ctrl.get(id);
  if (_taskMail?.taskId !== id) { _taskMail = null; _taskBozza = window.MailFirme && t?.mail_id && !t.risposta_inviata_at ? MailFirme.applica(t.bozza_risposta || '', t.macroarea) : (t?.bozza_risposta || ''); }
  renderTaskDetail(id, null);
  if (t?.mail_id && !_taskMail) {
    const { data } = await supabaseClient.rpc('tc_task_mail', { p_task: id });
    _taskMail = { taskId: id, mail: data?.success ? data.mail : null };
  }
  if (t?.analisi?.contatto && _taskCollegato?.taskId !== id) {
    _taskCollegato = { taskId: id, task: await taskCollegatoContatto(t).catch(() => null) };
  }
  try { renderTaskDetail(id, await Ctrl.storico(id)); }
  catch { renderTaskDetail(id, []); }
}

// Task di un pacco fermo: il task delle istruzioni a GLS (svincolo) o della mail del cliente
let _taskCollegato = null;
async function taskCollegatoContatto(t) {
  const tracking = t.analisi?.spedizione?.tracking;
  const email = (t.analisi?.cliente?.email || '').toLowerCase();
  const dal = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const migliore = (rows) => (rows || []).filter(x => x.id !== t.id)
    .sort((a, b) => (TASK_APERTI.includes(b.stato) - TASK_APERTI.includes(a.stato)) || String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  // Fermo di nuovo dopo lo svincolo: le vecchie istruzioni a GLS non servono, conta la mail del cliente
  if (tracking && t.analisi?.contatto?.stato !== 'dopo_svincolo') {
    const { data } = await supabaseClient.from('tasks').select('*').eq('analisi->svincolo->>tracking', tracking).gte('created_at', dal);
    const sv = migliore(data);
    if (sv) return { ...sv, _tipo: 'svincolo' };
  }
  if (!email) return null;
  const { data: mail } = await supabaseClient.from('mail_messaggi').select('id').eq('direzione', 'in').ilike('da_email', email).gte('ricevuto_at', dal);
  if (!mail?.length) return null;
  const { data } = await supabaseClient.from('tasks').select('*').in('mail_id', mail.map(m => m.id));
  const m = migliore(data);
  return m ? { ...m, _tipo: 'mail' } : null;
}

function apriTaskCollegato() {
  const c = _taskCollegato?.task;
  if (!c) return;
  if (!Ctrl.get(c.id)) { const { _tipo, ...row } = c; Ctrl.tasks.push(row); }
  openTaskDetail(c.id);
}

// Mail d'origine e risposta, divise per colonna del dettaglio
// Cosa sappiamo già del cliente dalle mail precedenti (clienti_memoria)
function renderTaskMemoria(m) {
  if (!m || !(m.telefono || m.campanello || m.indirizzo || (m.note || []).length)) return '';
  const ind = m.indirizzo ? [m.indirizzo.via, [m.indirizzo.cap, m.indirizzo.citta].filter(Boolean).join(' '), m.indirizzo.provincia].filter(Boolean).join(', ') : '';
  return `
    <div class="td-memoria">
      <strong>Già detto dal cliente</strong>
      <ul>
        ${m.telefono ? `<li>Telefono: <a href="tel:${escapeHtml(m.telefono)}">${escapeHtml(m.telefono)}</a></li>` : ''}
        ${ind ? `<li>Indirizzo indicato: ${escapeHtml(ind)}</li>` : ''}
        ${m.campanello ? `<li>Campanello: ${escapeHtml(m.campanello)}</li>` : ''}
        ${(m.note || []).map(n => `<li>${escapeHtml(n.testo)} <span class="td-small">(${escapeHtml(String(n.at).slice(8, 10) + '/' + String(n.at).slice(5, 7))})</span></li>`).join('')}
      </ul>
    </div>`;
}

function taskMailParts(t, can) {
  if (!t.mail_id) return null;
  const m = _taskMail?.taskId === t.id ? _taskMail.mail : null;
  const ordini = (t.analisi?.ordini || []).map(o => `${escapeHtml(taskMacro(o.negozio)?.label || o.negozio)} ${escapeHtml(o.numero)}${o.trovato_con === 'telefono_e_nome' ? ' (stesso telefono e nome, email diversa)' : o.verificato ? '' : o.trovato_con === 'telefono' ? ' (stesso telefono, email diversa)' : ' (email diversa dal mittente)'}`);
  const ricevuta = `
    <section class="td-sec td-mail">
      <h3>Mail ricevuta</h3>
      ${m ? `
        <div class="td-mail-head"><strong>${escapeHtml(m.da_nome || m.da_email || '')}</strong>
          <span>${escapeHtml(m.da_email || '')} · ${ctrlFmtQuando(m.ricevuto_at)}</span></div>
        <div class="td-mail-subj">${escapeHtml(m.oggetto || '(senza oggetto)')}</div>
        <p class="td-mail-text">${escapeHtml(m.testo || '(mail senza testo)')}</p>
        ${(m.allegati || []).length ? `<div class="td-small">Allegati: ${m.allegati.map(x => escapeHtml(x.nome)).join(', ')}</div>` : ''}`
      : `<p class="td-empty">${_taskMail?.taskId === t.id ? 'Mail non disponibile.' : 'Caricamento…'}</p>`}
      ${ordini.length ? `<div class="td-small"><strong>Ordini trovati:</strong> ${ordini.join(' · ')}</div>` : ''}
      ${renderTaskMemoria(t.analisi?.memoria)}
    </section>`;
  const risposta = t.risposta_inviata_at ? `
    <section class="td-sec td-reply">
      <h3>Risposta inviata <span>${ctrlFmtQuando(t.risposta_inviata_at)}</span></h3>
      <p class="td-mail-text">${t.risposta_fuori_cs ? 'Risposta data dal programma di posta: il testo è nella cartella Inviata della casella.' : escapeHtml(t.bozza_risposta || '')}</p>
    </section>` : can ? `
    <section class="td-sec td-reply">
      <h3><label for="task-bozza">Risposta${m?.da_email ? ` a <span>${escapeHtml(m.da_email)}</span>` : ' al cliente'}</label></h3>
      <textarea id="task-bozza" class="form-textarea" maxlength="20000"
        oninput="_taskBozza=this.value" placeholder="Scrivi la risposta…">${escapeHtml(_taskBozza ?? '')}</textarea>
      <div class="td-reply-actions">
        <button type="button" class="btn btn-ghost btn-sm" onclick="markTaskSpam('${t.id}')">È spam</button>
        ${TCAuth.isAdmin() ? `<button type="button" class="btn btn-secondary btn-sm" onclick="saveTaskBozza('${t.id}')">Salva bozza</button>` : ''}
        <button type="button" class="btn btn-primary btn-sm" id="task-send" onclick="sendTaskReply('${t.id}')">Invia risposta</button>
      </div>
    </section>` : '';
  return { ricevuta, risposta, daInviare: can && !t.risposta_inviata_at };
}

async function markTaskSpam(id) {
  const dest = _taskMail?.taskId === id ? _taskMail.mail?.da_email : '';
  if (!(await uiConfirm(`Segnare come spam${dest ? ` ${dest}` : ''}? Il task sparisce e il cervello imparerà a scartare mail simili.`, { ok: 'Segna come spam' }))) return;
  try {
    await Ctrl._rpc('tc_task_spam', { p_id: id });
    closeModal(CTRL_MODAL);
    showToast('Segnata come spam');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

async function saveTaskBozza(id) {
  try {
    await Ctrl.saveTask(id, { bozza_risposta: (_taskBozza || '').trim() || null });
    showToast('Bozza salvata');
    await Ctrl.load();
    refreshControlPage();
  } catch (e) { showToast(e.message, 'error'); }
}

async function sendTaskReply(id) {
  const testo = (_taskBozza || '').trim();
  if (!testo) { showToast('Scrivi la risposta', 'error'); return; }
  const dest = _taskMail?.taskId === id ? _taskMail.mail?.da_email : '';
  const tipo = Ctrl.tipo(Ctrl.tasks.find(x => x.id === id)?.tipo_id);
  const dopo = tipo?.chiude_con_risposta === false ? 'Il task resta aperto finché il lavoro non è fatto.' : 'Il task verrà completato.';
  if (!(await uiConfirm(`Inviare la risposta a ${dest || 'al cliente'}? ${dopo}`.replace(' a al ', ' al '), { ok: 'Invia' }))) return;
  const btn = document.getElementById('task-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }
  try {
    const { data, error } = await supabaseClient.functions.invoke('mail-send', { body: { task_id: id, testo } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'Invio non riuscito');
    }
    if (!data?.success) throw new Error(data?.error || 'Invio non riuscito');
    closeModal(CTRL_MODAL);
    showToast(data.copia_in_inviata !== false ? 'Risposta inviata' : 'Risposta inviata (copia in Inviata non riuscita)');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Invia risposta'; }
  }
}

const TASK_ORIGINI = { manuale: 'Inserito a mano', mail: 'Mail', shopify: 'Shopify', gestionale: 'Gestionale', automazione: 'Automazione', stampe: 'Stampe del giorno' };

// Spedizione del task: storico GLS come linea del tempo
// Contatto col cliente per un pacco fermo (tracking-check): mail mandate, risposta, quando chiamare
function renderTaskContatto(t) {
  const c = t.analisi?.contatto;
  if (!c) return '';
  const g = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
  const ct = _taskCollegato?.taskId === t.id ? _taskCollegato.task : null;
  const tel = c.telefono ? `<a class="ctrl-btn ${ct ? '' : 'is-primary'} td-call" href="tel:${escapeHtml(c.telefono)}">${Icons.phone ? Icons.phone(14) : ''} Chiama ${escapeHtml(c.telefono)}</a>` : `<span class="td-small">Nell'ordine non c'è il telefono.</span>`;
  const testo = {
    chiamare: `<strong>Da chiamare.</strong> ${c.mail_n} ${c.mail_n === 1 ? 'mail inviata' : 'mail inviate'}, l'ultima il ${g(c.ultima_mail_at)}: nessuna risposta.`,
    in_attesa: `<strong>Mail inviata il ${g(c.ultima_mail_at)}</strong>, in attesa di risposta. Se non risponde entro un giorno lavorativo diventa da chiamare.`,
    risposto: `<strong>Il cliente ha risposto il ${g(c.risposta_at)}.</strong> La sua mail è nel task della mail, con le istruzioni per GLS.`,
    da_contattare: `<strong>Non ancora contattato.</strong> Nessuna mail inviata al cliente per questa spedizione.`,
    senza_email: `<strong>Nell'ordine non c'è l'email:</strong> va chiamato.`,
    dopo_svincolo: `<strong>Da chiamare.</strong> Già svincolato ${c.svincoli > 1 ? `${c.svincoli} volte` : 'una volta'} e fermo di nuovo: niente altro svincolo prima di aver parlato col cliente.`,
  }[c.stato] || '';
  const col = ct ? `<button type="button" class="ctrl-btn is-primary" onclick="apriTaskCollegato()">${ct._tipo === 'svincolo' ? `${Icons.truck(14)} Vai alle istruzioni GLS` : 'Vai alla mail del cliente'}</button>` : '';
  return `
    <section class="td-box td-contatto is-${escapeHtml(c.stato)}">
      <p class="td-todo">${testo}</p>
      ${['chiamare', 'senza_email', 'dopo_svincolo'].includes(c.stato) || c.telefono || col ? `<div class="td-contacts">${col}${['chiamare', 'senza_email', 'dopo_svincolo'].includes(c.stato) || c.telefono ? tel : ''}</div>` : ''}
    </section>`;
}

// Cosa dire al cliente al telefono (tracking-check o cervello, _shared/telefonata.ts): sezioni in maiuscolo
function renderTaskTelefonata(t) {
  const testo = t.analisi?.telefonata;
  if (!testo || ['completato', 'non_completato'].includes(t.stato)) return '';
  const blocchi = testo.split(/\n{2,}/).map(b => {
    const [titolo, ...righe] = b.split('\n');
    return `<div class="td-call-blk"><h4>${escapeHtml(titolo)}</h4>${righe.map(r => `<p>${escapeHtml(r)}</p>`).join('')}</div>`;
  }).join('');
  return `
    <details class="td-sec td-box td-call-script" open>
      <summary><h3>Cosa dire al telefono</h3>
        <button type="button" class="ctrl-btn td-push" onclick="event.preventDefault();ctrlCopia(Ctrl.get('${t.id}').analisi.telefonata, 'Testo copiato')">Copia</button></summary>
      ${blocchi}
    </details>`;
}

// Chi non risponde (solleciti) o va chiamato (dati mancanti): testo pronto del messaggio e della telefonata
function taskWhatsApp(tel) {
  let d = String(tel || '').replace(/\D/g, '').replace(/^00/, '');
  if (/^3\d{8,9}$/.test(d)) d = `39${d}`;
  return /^\d{10,15}$/.test(d) && !/^390/.test(d) ? d : '';
}
function renderTaskTestiContatto(t) {
  const x = t.analisi?.testi_contatto, s = t.analisi?.sollecito;
  if (!x?.messaggio && !s) return '';
  const tel = x?.telefono || t.analisi?.cliente?.telefono || '';
  const wa = taskWhatsApp(tel);
  const g = (iso) => iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '';
  const rif = `Ctrl.get('${t.id}').analisi.testi_contatto`;
  const mail = s ? `
    <details class="td-sollecito-mail">
      <summary>La nostra mail del ${g(s.inviata_at)} senza risposta · ${escapeHtml(s.oggetto || 'senza oggetto')}</summary>
      <p class="td-mail-text">${escapeHtml(s.testo || '')}</p>
    </details>` : '';
  if (!x?.messaggio) return `<section class="td-sec td-box">${mail}</section>`;
  return `
    <section class="td-sec td-box td-testi">
      <div class="td-box-head"><h3>${tel ? 'Messaggio da mandare' : 'Mail da rimandare'}</h3>
        <span class="td-small">${tel ? 'su WhatsApp o SMS' : 'non abbiamo il telefono'}</span></div>
      <p class="td-testo">${escapeHtml(x.messaggio)}</p>
      <div class="td-contacts">
        <button type="button" class="ctrl-btn" onclick="ctrlCopia(${rif}.messaggio, 'Messaggio copiato')">Copia il messaggio</button>
        ${wa ? `<a class="ctrl-btn is-primary" href="https://wa.me/${wa}?text=${encodeURIComponent(x.messaggio)}" target="_blank" rel="noopener">Apri WhatsApp</a>` : ''}
        ${tel ? `<a class="ctrl-btn td-call" href="tel:${escapeHtml(String(tel).replace(/[^\d+]/g, ''))}">Chiama ${escapeHtml(tel)}</a>` : ''}
      </div>
      ${x.chiamata ? `
        <div class="td-box-head td-testi-chiamata"><h3>Cosa dire al telefono</h3>
          <button type="button" class="td-link" onclick="ctrlCopia(${rif}.chiamata, 'Traccia copiata')">Copia</button></div>
        <pre class="td-testo td-traccia">${escapeHtml(x.chiamata)}</pre>` : ''}
      ${mail}
    </section>`;
}

// Storico preciso di un pacco fermo più volte (tracking-check o cervello): eventi GLS, svincoli, mail
const GIACENZA_RIGA = { problema: 'is-bad', svincolo: 'is-sv', mail_out: 'is-mail', mail_in: 'is-mail', gls: '' };
function renderTaskStoricoGiacenza(t) {
  const righe = t.analisi?.storico_giacenza || t.analisi?.chiamare_cliente?.[0]?.storico;
  if (!righe?.length) return '';
  return `
    <section class="td-sec td-box">
      <div class="td-box-head"><h3>Cosa è successo</h3><span class="td-small">da dire al cliente al telefono</span></div>
      <ol class="td-storico-g">${righe.map(r => `
        <li class="${GIACENZA_RIGA[r.tipo] || ''}"><span>${escapeHtml(r.quando)}</span><strong>${escapeHtml(r.testo)}</strong></li>`).join('')}</ol>
    </section>`;
}

function renderTaskShipment(t) {
  const sp = t.analisi?.spedizione;
  if (!sp) return '';
  const quando = (e) => {
    const f = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    return e.volte > 1 ? `dal ${f(e.dal)} al ${f(e.al)}` : `${f(e.al)} · ${e.al.slice(11, 16)}`;
  };
  return `
    <section class="td-sec td-box">
      <div class="td-box-head">
        <h3>Spedizione GLS</h3>
        <span class="td-mono">${escapeHtml(sp.tracking)}</span>
        <a class="ctrl-btn td-push" href="${escapeHtml(sp.url)}" target="_blank" rel="noopener">${Icons.truck(14)} Apri su GLS</a>
      </div>
      ${(sp.anomalie || []).length ? `<div class="td-todo is-advice"><strong>Indirizzo da verificare:</strong><ul class="td-anomalie">${sp.anomalie.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : ''}
      ${sp.destinazione?.sede ? `<p class="td-small">Sede GLS: ${escapeHtml(sp.destinazione.sede)}${sp.destinazione.sede_indirizzo ? `, ${escapeHtml(sp.destinazione.sede_indirizzo)}` : ''}${sp.destinazione.sede_telefono ? ` · <a href="tel:${escapeHtml(sp.destinazione.sede_telefono.replace(/\s+/g, ''))}">${escapeHtml(sp.destinazione.sede_telefono)}</a>` : ''}</p>` : ''}
      ${(sp.storico || []).length ? `<ol class="td-time">${sp.storico.map((e, i) => `
        <li class="${i === 0 ? 'is-now' : ''}">
          <strong>${escapeHtml(e.stato)}</strong>
          <span>${quando(e)}${e.luogo ? ` · ${escapeHtml(e.luogo)}` : ''}</span>
        </li>`).join('')}</ol>` : `<p class="td-empty">GLS non ha ancora dati su questa spedizione.</p>`}
    </section>`;
}

// Istruzioni a GLS per un pacco in giacenza, proposte dal cervello dalla risposta del cliente.
// Partono solo con il clic (gls-svincolo): fase di prova fino a venerdì 13/11/2026.
const SVINCOLO_SCELTE = [
  ['riconsegna_preavviso', 'Riconsegna con telefonata del corriere'],
  ['riconsegna', 'Riconsegna allo stesso indirizzo'],
  ['altro_indirizzo', 'Consegna a un altro indirizzo'],
  ['ritiro_sede', 'Ritiro alla sede GLS'],
  ['reso_mittente', 'Reso al mittente'],
];

// Deposito GLS per il ritiro in sede (tracking-check, dall'XML). Se gli eventi sono in un'altra
// città il pacco può stare in un punto GLS più vicino: l'indirizzo va confermato con una telefonata.
function renderSvDeposito(d) {
  if (!d?.sede) return '';
  const tel = d.telefono ? ` · <a href="tel:${escapeHtml(d.telefono.replace(/\s+/g, ''))}">${escapeHtml(d.telefono)}</a>` : '';
  const ind = [d.indirizzo, [d.cap, d.sede].filter(Boolean).join(' ') + (d.provincia ? ` (${d.provincia})` : '')].filter(Boolean).map(escapeHtml).join(', ');
  return `<div class="td-sv-dep">
    <span>Deposito GLS</span>
    <strong>GLS ${escapeHtml(d.sede)}</strong> · ${ind}${tel}
    ${d.coincide === false && d.luogo_eventi ? `<p class="td-small">Gli ultimi eventi sono a ${escapeHtml(d.luogo_eventi)}: GLS li registra col paese del corriere, il deposito di solito è questo. Se hai dubbi sul punto di ritiro, chiama la sede.</p>` : ''}
  </div>`;
}

function renderTaskSvincolo(t, can) {
  const sv = t.analisi?.svincolo;
  if (!sv?.tracking) return '';
  if (sv.stato === 'inviato') return `
    <section class="td-sec td-box">
      <div class="td-box-head"><h3>Istruzioni a GLS</h3><span class="td-mono">${escapeHtml(sv.tracking)}</span></div>
      <p class="td-todo">${escapeHtml(sv.tipo_label || '')} · mandate ${ctrlFmtQuando(sv.inviato_at)}${sv.inviato_da ? ` da ${escapeHtml(sv.inviato_da)}` : ''}${sv.data ? ` · riconsegna dal ${escapeHtml(sv.data)}` : ''}</p>
    </section>`;
  const v = (k) => escapeHtml(sv[k] || '');
  const campo = (id, label, k, max, extra = '') => `<label class="td-sv-f ${extra}"><span>${label}</span><input id="sv-${id}" class="form-input" maxlength="${max}" value="${v(k)}" ${can ? '' : 'disabled'}></label>`;
  return `
    <section class="td-sec td-box td-svincolo" data-scelta="${v('scelta')}">
      <div class="td-box-head"><h3>Istruzioni a GLS</h3><span class="td-mono">${escapeHtml(sv.tracking)}</span></div>
      <p class="td-small">Il cliente ha risposto all'avviso di ${escapeHtml((sv.problema || 'giacenza').toLowerCase())}. Controlla e manda: GLS riceve le istruzioni e il cliente la risposta qui accanto.</p>
      <div class="td-sv-grid">
        <label class="td-sv-f is-wide"><span>Cosa fare</span>
          <select id="sv-scelta" class="form-input" ${can ? '' : 'disabled'} onchange="document.querySelector('.td-svincolo').dataset.scelta=this.value">
            ${SVINCOLO_SCELTE.map(([k, l]) => `<option value="${k}" ${sv.scelta === k ? 'selected' : ''}>${l}</option>`).join('')}
          </select></label>
        ${campo('telefono', 'Telefono', 'telefono', 15)}
        ${campo('note', 'Note per il corriere', 'note', 65)}
        <label class="td-sv-f is-wide td-sv-check"><input type="checkbox" id="sv-preavviso" ${sv.preavviso || sv.ripetuta ? 'checked' : ''} ${can ? '' : 'disabled'}>
          <span>Il corriere telefona prima di passare${sv.ripetuta ? ' (giacenza ripetuta: si mette sempre)' : ''}</span></label>
        ${campo('nome', 'Nome sul campanello', 'nome', 20, 'is-addr')}
        ${campo('via', 'Via e civico', 'via', 30, 'is-addr')}
        ${campo('cap', 'CAP', 'cap', 10, 'is-addr')}
        ${campo('citta', 'Città', 'citta', 30, 'is-addr')}
        ${campo('provincia', 'Provincia', 'provincia', 2, 'is-addr')}
      </div>
      ${renderSvDeposito(sv.deposito)}
      ${!sv.telefono ? `<p class="td-todo is-advice"><strong>Telefono mancante:</strong> non lo troviamo nell'ordine né nelle mail. Se lo hai, scrivilo qui sopra.</p>` : ''}
      ${sv.errore ? `<p class="td-todo is-advice"><strong>Ultimo tentativo:</strong> ${escapeHtml(sv.errore)}</p>` : ''}
      ${can ? `<div class="td-reply-actions"><button type="button" class="btn btn-primary btn-sm" id="sv-send" onclick="sendTaskSvincolo('${t.id}')">Manda a GLS e rispondi</button></div>` : ''}
    </section>`;
}

async function sendTaskSvincolo(id) {
  const t = Ctrl.get(id);
  const val = (k) => (document.getElementById(`sv-${k}`)?.value || '').trim();
  const body = { task_id: id, preavviso: !!document.getElementById('sv-preavviso')?.checked, scelta: val('scelta'), telefono: val('telefono'), note: val('note'), nome: val('nome'), via: val('via'), cap: val('cap'), citta: val('citta'), provincia: val('provincia') };
  const testo = t?.risposta_inviata_at ? '' : (_taskBozza || '').trim();
  const label = SVINCOLO_SCELTE.find(([k]) => k === body.scelta)?.[1] || body.scelta;
  if (!(await uiConfirm(`Mandare a GLS: ${label}?${testo ? ' Poi parte la risposta al cliente e il task viene completato.' : ' Il task verrà completato.'}`, { ok: 'Manda a GLS' }))) return;
  const btn = document.getElementById('sv-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Invio a GLS…'; }
  try {
    const { data, error } = await supabaseClient.functions.invoke('gls-svincolo', { body: { ...body, testo } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'Invio non riuscito');
    }
    if (!data?.success) throw new Error(data?.error || 'Invio non riuscito');
    closeModal(CTRL_MODAL);
    showToast(data.conferma?.startsWith('non inviata') ? `GLS ok, ma la risposta al cliente ${data.conferma}` : 'Istruzioni mandate a GLS', data.conferma?.startsWith('non inviata') ? 'error' : undefined);
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Manda a GLS e rispondi'; }
    await Ctrl.load();
  }
}

function renderTaskCustomer(t) {
  const c = t.analisi?.cliente;
  if (!c || !(c.email || c.telefono)) return '';
  return `
    <section class="td-box td-customer">
      <div><h3>Cliente</h3><span>${escapeHtml(c.nome || '')}${c.citta ? ` · ${escapeHtml(c.citta)}` : ''}</span></div>
      <div class="td-contacts">
        ${c.telefono ? `<a class="ctrl-btn" href="tel:${escapeHtml(c.telefono)}">${escapeHtml(c.telefono)}</a>` : ''}
        ${c.email ? `<button type="button" class="ctrl-btn is-primary" onclick="taskScriviMail('${t.id}')" title="Scrivi dal gestionale, dalla casella del negozio">${Icons.reply(14)} Scrivi a ${escapeHtml(c.email)}</button>` : ''}
      </div>
    </section>`;
}

// Pacco rimandato indietro da GLS: i passi da fare, con i bottoni per farli da qui
function renderTaskRientro(t) {
  const c = t.analisi?.cliente;
  if (!/Rientro al mittente/i.test(t.titolo) || !c) return '';
  const tel = c.telefono ? String(c.telefono).replace(/[^\d+]/g, '') : '';
  return `
    <section class="td-box td-azioni">
      <h3>Azioni</h3>
      <ol class="td-passi">
        <li><strong>Avvisa il cliente</strong> e chiedi se vuole il pacco rispedito (con indirizzo e telefono giusti) o il rimborso.
          <div class="td-contacts">
            ${c.email ? `<button type="button" class="ctrl-btn is-primary" onclick="taskScriviMail('${t.id}')">${Icons.reply(14)} Manda la mail (già pronta)</button>` : ''}
            ${tel ? `<a class="ctrl-btn" href="tel:${escapeHtml(tel)}">Chiama ${escapeHtml(c.telefono)}</a>` : ''}
          </div></li>
        <li><strong>Quando risponde:</strong> rispedisci con i dati nuovi, oppure fai il rimborso su Shopify.</li>
        <li><strong>Pacco rispedito o rimborso fatto:</strong> segna il task Completato.</li>
      </ol>
    </section>`;
}

// Testo pronto per i problemi di consegna che chiedono di scrivere al cliente (mai segnaposto)
function taskTestoCliente(t, ordine) {
  const nome = String(t.analisi?.cliente?.nome || '').trim().split(/\s+/)[0];
  const ciao = nome ? `Ciao ${nome},` : 'Ciao,';
  const ord = ordine ? `del tuo ordine ${ordine} ` : '';
  if (/Rientro al mittente/i.test(t.titolo)) return {
    oggetto: `Il tuo ordine ${ordine || ''} ci è tornato indietro`.replace(/\s+/g, ' ').trim(),
    corpo: [ciao, '', `il corriere GLS non è riuscito a consegnarti il pacco ${ord}e ce lo sta rimandando indietro.`, '',
      'Vuoi che te lo rispediamo? Rispondi a questa mail confermandoci l\'indirizzo completo (con numero civico, interno e nome sul campanello) e un numero di telefono per il corriere.', '',
      'Appena ci rispondi organizziamo la nuova spedizione.', ''].join('\n'),
  };
  return { oggetto: ordine ? `Il tuo ordine ${ordine}` : '', corpo: `${ciao}\n\n` };
}

// Mail al cliente dal task: la finestra "Nuova mail" con negozio, destinatario e testo già pronti
async function taskScriviMail(id) {
  const t = Ctrl.get(id), c = t?.analisi?.cliente;
  if (!c?.email) return;
  const ordine = (String(t.titolo).match(/#\d+/) || [''])[0];
  const testo = taskTestoCliente(t, ordine);
  if (typeof openMailCompose !== 'function' || typeof MailBox === 'undefined') {
    location.href = `mailto:${c.email}?subject=${encodeURIComponent(testo.oggetto)}&body=${encodeURIComponent(testo.corpo)}`;
    return;
  }
  try {
    if (!MailBox.caselle.length) await Promise.all([MailBox.loadCaselle(), window.MailFirme?.load?.(), window.MailModelli?.load?.()]);
  } catch (e) { showToast(e.message, 'error'); return; }
  // Le due finestre sono allo stesso livello e quella del task starebbe sopra: si chiude prima
  closeModal(CTRL_MODAL);
  openMailCompose();
  if (MailBox.caselle.some(x => x.id === t.macroarea)) setComposeBox(t.macroarea);
  document.getElementById('mc-a').value = c.email;
  document.getElementById('mc-a-nome').value = c.nome || '';
  document.getElementById('mc-oggetto').value = testo.oggetto;
  document.getElementById('mc-testo').value = MailFirme.applica(testo.corpo, MailNuova.casella);
  setTimeout(() => { const el = document.getElementById('mc-testo'); el?.focus(); el?.setSelectionRange?.(0, 0); }, 60);
}

function renderTaskDetail(id, storico) {
  const t = Ctrl.get(id);
  if (!t) { closeModal(CTRL_MODAL); return; }
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id), macro = taskBrand(t) === '_' ? null : taskCatInfo(taskBrand(t));
  const can = Ctrl.canAct(t);
  const a = _taskAction;
  const chiuso = ['completato', 'non_completato'].includes(t.stato);
  const colleghi = Ctrl.users.filter(u => u !== Ctrl._me() && u !== 'claude' && u !== t.assegnato_a);

  const motivoBtn = (stato, label) => t.stato === stato ? '' :
    `<button type="button" class="td-link" onclick="_taskAction='${stato}';renderTaskDetail('${id}', _taskStoricoCache)">${label}</button>`;
  const mail = taskMailParts(t, can);
  const sped = renderTaskShipment(t);
  // Colonna destra: la risposta se il task nasce da una mail, altrimenti la spedizione
  const destra = mail ? mail.risposta : sped;
  const split = !!destra;
  const sep = '<span aria-hidden="true">·</span>';
  const meta = [
    macro ? `<span class="td-store" style="--m:${macro.color};"><i></i>${escapeHtml(macro.label)}</span>` : '',
    t.priorita !== 'normale' ? `<span style="color:${pr.color};font-weight:700;">${pr.label}</span>` : '',
    !['da_fare', 'in_lavorazione', 'in_pausa'].includes(t.stato) ? `<span style="color:${st.color};font-weight:700;">${st.label}</span>` : '',
    `<span>${Icons.clock(12)} ${ctrlFmtMin(t.minuti_stimati)} stimati</span>`,
    tipo ? `<span>${escapeHtml(tipo.nome)}</span>` : '',
    t.scadenza ? `<span>entro ${ctrlFmtQuando(t.scadenza)}</span>` : '',
    t.giorno !== ctrlOggi() ? `<span>${ctrlFmtGiorno(t.giorno)}</span>` : '',
  ].filter(Boolean).join(sep);
  const fatti = [
    t.assegnato_a !== Ctrl._me() ? (t.assegnato_a ? `${taskChiuso(t) ? 'Fatto da' : 'Preso da'} ${escapeHtml(t.assegnato_a)}` : t.designato ? `Libero · designato: ${escapeHtml(t.designato)}` : 'Libero · senza designato') : '',
    t.assegnato_a && t.designato && t.designato !== t.assegnato_a ? `Designato: ${escapeHtml(t.designato)}` : '',
    t.delega?.da ? `Delegato da ${escapeHtml(t.delega.da)}${t.delega.nota ? ` («${escapeHtml(t.delega.nota)}»)` : ''}` : '',
    `${TASK_ORIGINI[t.fonte] || escapeHtml(t.fonte)} · ${ctrlFmtQuando(t.created_at)}${t.creato_da ? ` · ${escapeHtml(t.creato_da)}` : ''}`,
    t.automazione_errore ? `Automazione non riuscita: ${escapeHtml(t.automazione_errore)}` : '',
  ].filter(Boolean).join(' · ');

  const formDelega = `
    <form class="td-form" onsubmit="event.preventDefault();submitTaskDelega('${id}')">
      <strong>Delega a</strong>
      <select id="tm-delega" class="form-input" required aria-label="A chi">
        <option value="">Scegli…</option>
        ${colleghi.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}
      </select>
      <input id="tm-nota" class="form-input" maxlength="300" placeholder="Nota (es. tu conosci già questo cliente)" aria-label="Nota">
      <button type="button" class="ctrl-btn" onclick="_taskAction=null;renderTaskDetail('${id}', _taskStoricoCache)">Annulla</button>
      <button type="submit" class="ctrl-btn is-primary" id="tm-delega-ok">Delega</button>
    </form>`;
  const formMotivo = a && a !== 'delega' ? `
    <form class="td-form" onsubmit="event.preventDefault();submitTaskMotivo('${id}')">
      <strong>${taskStato(a).label}</strong>
      ${a === 'rimandato' ? `<input id="tm-giorno" type="date" class="form-input td-date" aria-label="A quale giorno" min="${ctrlAddDays(ctrlOggi(), 1)}" value="${ctrlAddDays(ctrlOggi(), 1)}" required>` : ''}
      <input id="tm-motivo" class="form-input" maxlength="500" required aria-label="Motivo"
        placeholder="Motivo: ${a === 'bloccato' ? 'es. in attesa della conferma del cliente' : a === 'rimandato' ? 'es. manca la merce, arriva giovedì' : 'es. il cliente ha annullato'}">
      <button type="button" class="ctrl-btn" onclick="_taskAction=null;renderTaskDetail('${id}', _taskStoricoCache)">Annulla</button>
      <button type="submit" class="ctrl-btn is-primary">Conferma</button>
    </form>` : '';
  const azioni = `
    <div class="td-foot-links">
      ${!chiuso ? `${motivoBtn('rimandato', 'Rimanda')}${motivoBtn('bloccato', 'Bloccato')}${motivoBtn('non_completato', 'Non completato')}${!TCAuth.isAdmin() && colleghi.length ? motivoBtn('delega', 'Delega') : ''}` : ''}
      ${TCAuth.isAdmin() ? `<button class="td-link" onclick="openTaskForm('${id}')">${Icons.edit(13)} Modifica</button>
        <button class="td-link is-danger" onclick="removeTask('${id}')">${Icons.trash(13)} Elimina</button>` : ''}
    </div>
    <div class="td-foot-main">
      ${taskQuickActions(t, { fatto: false }).replaceAll('taskSetStato(', 'taskDetailStato(').replaceAll('taskPrendi(', 'taskDetailPrendi(')}
      ${!chiuso ? `<button type="button" class="ctrl-btn ${mail?.daInviare ? '' : 'is-primary'}" onclick="taskDetailStato('${id}','completato')">${CtrlIcons.check()} Completato</button>` : ''}
    </div>`;

  window._taskStoricoCache = storico;
  ctrlModal(`
    <div class="modal-header td-head">
      <div>
        <h2 id="ctrl-modal-title">${escapeHtml(t.titolo)}</h2>
        <div class="td-meta">${meta}</div>
      </div>
      <button class="btn-icon" onclick="closeModal('${CTRL_MODAL}')" aria-label="Chiudi">${Icons.x()}</button>
    </div>
    <div class="td-grid">
      <div class="td-col">
        ${renderTaskOrdineFile(t)}
        ${t.descrizione ? `<section class="td-sec"><h3>${t.fonte === 'file' ? 'File lavorati' : 'Cosa fare'}</h3><p class="td-todo">${escapeHtml(t.descrizione)}</p></section>` : ''}
        ${taskMotivoVisibile(t.stato, t.motivo) ? `<p class="td-todo is-reason"><strong>Motivo:</strong> ${escapeHtml(t.motivo)}</p>` : ''}
        ${t.analisi?.dubbi ? `<p class="td-todo is-advice"><strong>Da controllare:</strong> ${escapeHtml(t.analisi.dubbi)}</p>` : ''}
        ${renderTaskContatto(t)}
        ${renderTaskTelefonata(t)}
        ${renderTaskStoricoGiacenza(t)}
        ${renderTaskTestiContatto(t)}
        ${t.analisi?.rimborso ? `<p class="td-todo is-advice"><strong>Rimborso richiesto:</strong> va gestito a mano.</p>` : ''}
        ${t.analisi?.note ? `<p class="td-todo is-note"><strong>Note:</strong> ${escapeHtml(t.analisi.note)}</p>` : ''}
        ${renderTaskSvincolo(t, can)}
        ${t.riferimento ? `<div>${MsgRef.chip(t.riferimento, `closeModal('${CTRL_MODAL}');MsgRef.open(Ctrl.get('${t.id}').riferimento)`)}</div>` : ''}
        ${renderTaskRientro(t)}
        ${renderTaskCustomer(t)}
        ${mail ? sped + mail.ricevuta : ''}
        <div class="td-facts">
          <span>${fatti}</span>
          <details class="td-log">
            <summary>Attività${storico?.length ? ` · ${storico.length}` : ''}</summary>
            ${storico === null ? `<p class="td-empty">Caricamento…</p>` :
              storico.length ? `<ol>${storico.map(h => `
                <li><span class="task-history-dot" style="background:${taskStato(h.a_stato).color};"></span>
                  <span><strong>${h.da_stato === h.a_stato ? 'Delegato' : taskStato(h.a_stato).label}</strong>${h.utente ? ` · ${escapeHtml(h.utente)}` : ''} · ${ctrlFmtQuando(h.at)}
                  ${h.motivo && (h.da_stato === h.a_stato || taskMotivoVisibile(h.a_stato, h.motivo)) ? `<em>${escapeHtml(h.motivo)}</em>` : ''}</span></li>`).join('')}</ol>`
              : `<p class="td-empty">Nessun passaggio registrato.</p>`}
          </details>
        </div>
      </div>
      ${split ? `<div class="td-col td-side">${destra}</div>` : ''}
    </div>
    ${can ? `<div class="td-foot">${a === 'delega' ? formDelega : a ? formMotivo : azioni}</div>`
          : TCAuth.isAdmin() ? `<div class="td-foot">${azioni}</div>` : ''}`,
    split ? 1120 : 680, `td-modal ${split ? 'is-split' : ''} ${mail?.risposta ? 'is-reply' : ''}`);

  if (a) setTimeout(() => document.getElementById(a === 'rimandato' ? 'tm-giorno' : a === 'delega' ? 'tm-delega' : 'tm-motivo')?.focus(), 30);
  startControlTicker();
}

// Ordine del gestionale: modulo d'ordine e allegati (bozze) subito apribili dal task
function renderTaskOrdineFile(t) {
  const o = taskOrdineGest(t);
  if (!o) return '';
  const righe = o.orderModule?.rows?.length || 0, files = o.files || [];
  if (!righe && !files.length) return '';
  const icona = (f) => f.type?.startsWith('image/') ? '🖼' : f.type === 'application/pdf' ? '📄' : '📎';
  return `
    <section class="td-sec td-ordine-file">
      <h3>Ordine ${escapeHtml(o.nome || '')}</h3>
      <div class="td-ordine-btns">
        ${righe ? `<button type="button" class="td-file is-modulo" onclick="previewOrderModule('${o.id}')">📋 <span>Modulo d'ordine · ${righe} ${righe === 1 ? 'riga' : 'righe'}</span></button>` : ''}
        ${files.map((f, i) => `<button type="button" class="td-file" onclick="taskApriAllegato('${o.id}', ${i})" title="${escapeHtml(f.name || '')}">${icona(f)} <span>${escapeHtml(f.name || 'Allegato')}</span></button>`).join('')}
      </div>
    </section>`;
}

function taskApriAllegato(orderId, i) {
  const f = TCFactory.getOrderById(orderId)?.files?.[i];
  if (f) previewFile(f);
}

async function taskDetailStato(id, stato) {
  if (await taskSetStato(id, stato)) {
    showToast(`Task: ${taskStato(stato).label.toLowerCase()}`);
    openTaskDetail(id);
  }
}

async function taskDetailPrendi(id) {
  await taskPrendi(id);
  openTaskDetail(id);
}

async function submitTaskDelega(id) {
  const a = document.getElementById('tm-delega')?.value;
  if (!a) { document.getElementById('tm-delega')?.focus(); showToast('Scegli a chi delegare', 'error'); return; }
  const btn = document.getElementById('tm-delega-ok');
  btn.disabled = true;
  try {
    await Ctrl._rpc('tc_task_delega', { p_id: id, p_a: a, p_nota: document.getElementById('tm-nota')?.value || null });
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    return;
  }
  _taskAction = null;
  closeModal(CTRL_MODAL);
  showToast(`Delegato a ${a}`);
  await Ctrl.load();
  refreshControlPage();
}

async function submitTaskMotivo(id) {
  const stato = _taskAction;
  const motivo = document.getElementById('tm-motivo')?.value.trim();
  const giorno = document.getElementById('tm-giorno')?.value || null;
  if (!motivo) { document.getElementById('tm-motivo')?.focus(); showToast('Scrivi il motivo', 'error'); return; }
  if (await taskSetStato(id, stato, motivo, giorno)) {
    showToast(stato === 'rimandato' ? `Rimandato a ${ctrlFmtGiorno(giorno).toLowerCase()}` : `Task: ${taskStato(stato).label.toLowerCase()}`);
    _taskAction = null;
    if (Ctrl.get(id)) openTaskDetail(id); else closeModal(CTRL_MODAL);
  }
}

async function removeTask(id) {
  const t = Ctrl.get(id);
  if (!(await uiConfirm(`Eliminare il task "${t?.titolo}"? Impossibile annullare.`, { ok: 'Elimina', danger: true }))) return;
  try {
    await Ctrl.deleteTask(id);
    closeModal(CTRL_MODAL);
    showToast('Task eliminato');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Nuovo / modifica task (admin) ──

let _taskDraft = null;

function openTaskForm(id = null) {
  const t = id ? Ctrl.get(id) : null;
  _taskDraft = {
    id,
    priorita: t?.priorita || 'normale',
    minutiToccati: !!t,     // se l'admin non li ha cambiati, i minuti seguono il tipo scelto
  };
  const scad = t?.scadenza ? new Date(t.scadenza) : null;
  const scadLocal = scad ? new Date(scad.getTime() - scad.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const tipiAttivi = Ctrl.tipi.filter(tp => tp.attivo || tp.id === t?.tipo_id);
  const people = Ctrl.users.length ? Ctrl.users : [Ctrl._me()];

  ctrlModal(`
    ${ctrlModalHead(t ? 'Modifica task' : 'Nuovo task')}
    <form class="modal-body" style="gap:14px;" onsubmit="event.preventDefault();submitTaskForm()">
      <div class="form-group">
        <label class="form-label" for="tf-titolo">Titolo *</label>
        <input id="tf-titolo" class="form-input" maxlength="200" required value="${escapeHtml(t?.titolo || '')}" placeholder="es. Rispondere a Mario Rossi sull'ordine #1043">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="tf-tipo">Tipo</label>
          <select id="tf-tipo" class="form-select" onchange="taskFormTipo(this.value)">
            <option value="">Nessun tipo</option>
            ${tipiAttivi.map(tp => `<option value="${tp.id}" ${t?.tipo_id === tp.id ? 'selected' : ''}>${escapeHtml(tp.nome)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="tf-minuti">Minuti stimati</label>
          <input id="tf-minuti" type="number" class="form-input" min="1" max="960" value="${t?.minuti_stimati || 15}" oninput="_taskDraft.minutiToccati=true">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="tf-chi">Assegnato a</label>
          <select id="tf-chi" class="form-select">
            <option value="">Coda comune</option>
            ${people.map(u => `<option value="${escapeHtml(u)}" ${t?.assegnato_a === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="tf-giorno">Giorno</label>
          <input id="tf-giorno" type="date" class="form-input" required value="${t?.giorno || Ctrl.giorno}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="tf-macro">Macroarea</label>
        <select id="tf-macro" class="form-select">
          <option value="">Nessuna</option>
          ${TASK_BRAND.map(m => `<option value="${m.id}" ${(t?.macroarea || (!t && (Ctrl.macroarea || Ctrl.coda))) === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <span class="form-label" id="tf-prio-label">Priorità</span>
        <div class="segmented" role="radiogroup" aria-labelledby="tf-prio-label">
          ${TASK_PRIORITA.map(p => `<button type="button" role="radio" aria-checked="${_taskDraft.priorita === p.id}"
            class="${_taskDraft.priorita === p.id ? 'active' : ''}" onclick="taskFormPrio('${p.id}')">${p.label}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="tf-scadenza">Scadenza <span class="ctrl-cell-sub">(facoltativa)</span></label>
        <input id="tf-scadenza" type="datetime-local" class="form-input" value="${scadLocal}">
      </div>
      <div class="form-group">
        <label class="form-label" for="tf-desc">Descrizione</label>
        <textarea id="tf-desc" class="form-textarea" rows="3" maxlength="5000" placeholder="Cosa fare, link, dettagli utili">${escapeHtml(t?.descrizione || '')}</textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal('${CTRL_MODAL}')">Annulla</button>
        <button type="submit" class="btn btn-primary" id="tf-save">${t ? 'Salva' : 'Crea task'}</button>
      </div>
    </form>`);
  setTimeout(() => document.getElementById('tf-titolo')?.focus(), 30);
}

function taskFormTipo(id) {
  const tp = Ctrl.tipo(id);
  if (tp && !_taskDraft.minutiToccati) document.getElementById('tf-minuti').value = tp.minuti_standard;
}

function taskFormPrio(id) {
  _taskDraft.priorita = id;
  document.querySelectorAll('[aria-labelledby="tf-prio-label"] button').forEach((b, i) => {
    const on = TASK_PRIORITA[i].id === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
}

async function submitTaskForm() {
  const val = (id) => document.getElementById(id)?.value.trim() || '';
  const titolo = val('tf-titolo');
  const minuti = parseInt(val('tf-minuti'), 10);
  if (!titolo) { document.getElementById('tf-titolo')?.focus(); showToast('Scrivi il titolo', 'error'); return; }
  if (!(minuti >= 1 && minuti <= 960)) { document.getElementById('tf-minuti')?.focus(); showToast('Minuti tra 1 e 960', 'error'); return; }
  const scad = val('tf-scadenza');
  const row = {
    titolo,
    tipo_id: val('tf-tipo') || null,
    minuti_stimati: minuti,
    assegnato_a: val('tf-chi') || null,
    giorno: val('tf-giorno') || Ctrl.giorno,
    macroarea: val('tf-macro') || null,
    priorita: _taskDraft.priorita,
    scadenza: scad ? new Date(scad).toISOString() : null,
    descrizione: val('tf-desc'),
  };
  const btn = document.getElementById('tf-save');
  btn.disabled = true;
  try {
    await Ctrl.saveTask(_taskDraft.id, row);
    closeModal(CTRL_MODAL);
    showToast(_taskDraft.id ? 'Task salvato' : `Task creato${row.assegnato_a ? ` per ${row.assegnato_a}` : ' in coda comune'}`);
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
}

// ── Nuovo / modifica tipo di task (admin) ──

function openTaskTypeForm(id = null) {
  const tp = id ? Ctrl.tipo(id) : null;
  ctrlModal(`
    ${ctrlModalHead(tp ? 'Modifica tipo di task' : 'Nuovo tipo di task')}
    <form class="modal-body" style="gap:14px;" onsubmit="event.preventDefault();submitTaskTypeForm(${tp ? `'${tp.id}'` : 'null'})">
      <div class="form-group">
        <label class="form-label" for="tt-nome">Nome *</label>
        <input id="tt-nome" class="form-input" maxlength="80" required value="${escapeHtml(tp?.nome || '')}" placeholder="es. Risposta a un cliente">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="tt-minuti">Tempo standard (minuti) *</label>
          <input id="tt-minuti" type="number" class="form-input" min="1" max="960" required value="${tp?.minuti_standard || 15}">
        </div>
        <div class="form-group">
          <label class="form-label" for="tt-comp">Competenza</label>
          <select id="tt-comp" class="form-select">
            <option value="">Nessuna</option>
            ${TASK_COMPETENZE.map(c => `<option value="${c.id}" ${tp?.competenza === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="tt-aut">Autonomia del cervello</label>
        <select id="tt-aut" class="form-select">
          ${TASK_AUTONOMIA.map(a => `<option value="${a.id}" ${(tp?.autonomia || 'solo_task') === a.id ? 'selected' : ''}>${a.label} — ${a.hint}</option>`).join('')}
        </select>
        <span class="settings-section-hint" style="margin:4px 0 0;">Entrerà in funzione con i collegamenti a mail, WhatsApp e Shopify.</span>
      </div>
      <div class="form-group">
        <label class="form-label" for="tt-desc">Descrizione</label>
        <textarea id="tt-desc" class="form-textarea" rows="2" maxlength="1000">${escapeHtml(tp?.descrizione || '')}</textarea>
      </div>
      <label class="switch-row" style="padding:0;">
        <span><strong>Attivo</strong><small>I tipi disattivati non si possono scegliere per i nuovi task</small></span>
        <input id="tt-attivo" type="checkbox" class="switch" ${tp?.attivo === false ? '' : 'checked'}>
      </label>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal('${CTRL_MODAL}')">Annulla</button>
        <button type="submit" class="btn btn-primary" id="tt-save">${tp ? 'Salva' : 'Crea tipo'}</button>
      </div>
    </form>`);
  setTimeout(() => document.getElementById('tt-nome')?.focus(), 30);
}

async function submitTaskTypeForm(id) {
  const val = (k) => document.getElementById(k)?.value.trim() || '';
  const nome = val('tt-nome');
  const minuti = parseInt(val('tt-minuti'), 10);
  if (!nome) { document.getElementById('tt-nome')?.focus(); showToast('Scrivi il nome', 'error'); return; }
  if (!(minuti >= 1 && minuti <= 960)) { document.getElementById('tt-minuti')?.focus(); showToast('Minuti tra 1 e 960', 'error'); return; }
  const btn = document.getElementById('tt-save');
  btn.disabled = true;
  try {
    await Ctrl.saveTipo(id, {
      nome, minuti_standard: minuti,
      competenza: val('tt-comp') || null,
      autonomia: val('tt-aut') || 'solo_task',
      descrizione: val('tt-desc'),
      attivo: document.getElementById('tt-attivo').checked,
    });
    closeModal(CTRL_MODAL);
    showToast(id ? 'Tipo salvato' : 'Tipo creato');
    await Ctrl.load();
    refreshControlPage();
  } catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
}

// ─────────────────────────────────────────────
// COLLEGAMENTI (admin): negozi Shopify e ricerca ordini
// ─────────────────────────────────────────────

const ShopLinks = {
  negozi: null,      // stato dei negozi (tc_shopify_stato)
  social: null,      // profili Instagram (e poi Messenger/WhatsApp) collegati (social_account)
  caselle: null,     // stato delle caselle email (tc_mail_stato)
  mail: null,        // ultime mail scritte da persone
  mailEsiti: null,   // mail_id → evento del cervello e suo task
  scartate: [],      // mail scartate dal cervello
  regole: [],        // correzioni del team (mail_regole)
  consegne: null,    // spedizioni con problemi o ritardi (tc_spedizioni_problemi)
  consegneErrore: null,
  arrivo: null,      // ordini ancora da evadere
  arrivoErrore: null,
  ordini: null,      // risultati della ricerca
  query: '',
  negozio: null,     // filtro degli ordini in arrivo (null = tutti)
  vista: 'tutti',    // box scelta sopra gli ordini: tutti, oggi, nonpagati, problemi
  richieste: new Map(),   // richieste dei dati mancanti aperte, per ordine
  verifiche: new Map(),   // riscontro degli indirizzi sulle mappe (ordini_verifiche), per ordine
  mailCorrette: new Map(),// mail col dominio sbagliato corrette su Shopify, per ordine
  negozioGls: null,  // filtro delle spedizioni GLS (null = tutti)
  error: null,
  syncing: new Set(),
};

const SHOP_PAGAMENTO = { PAID: 'Pagato', PENDING: 'In attesa', AUTHORIZED: 'Autorizzato', PARTIALLY_PAID: 'Pagato in parte',
  REFUNDED: 'Rimborsato', PARTIALLY_REFUNDED: 'Rimborsato in parte', VOIDED: 'Annullato', EXPIRED: 'Scaduto' };
const SHOP_EVASIONE = { UNFULFILLED: 'Da evadere', FULFILLED: 'Evaso', PARTIALLY_FULFILLED: 'Evaso in parte', ON_HOLD: 'In sospeso',
  IN_PROGRESS: 'In lavorazione', SCHEDULED: 'Programmato', RESTOCKED: 'Rifornito', PENDING_FULFILLMENT: 'In attesa di evasione', OPEN: 'Aperto' };

const SHOP_DA_EVADERE = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED'];   // come tc_shopify_stato
const SHOP_ORDINE_CAMPI = 'id, store_id, numero, creato_at, annullato_at, cliente, email, telefono, totale, valuta, stato_pagamento, stato_evasione, tracking, righe, indirizzo, spedizione, ritiro';

// Richieste dei dati mancanti ancora aperte (ordini-dati, o mandate a mano): ordine → richiesta
async function loadRichiesteDati(render = true) {
  const [{ data, error }, ver, mailc] = await Promise.all([
    supabaseClient.from('ordini_richieste_dati').select('ordine_id, inviata_at, inviata_da, esito, task_id').is('risolta_at', null),
    // Solo gli esiti da mostrare; gli ordini spediti non contano
    supabaseClient.from('ordini_verifiche').select('ordine_id, esito, nota, suggerimento, prima, dopo, corretta_at')
      .in('esito', ['corretta', 'simile', 'ambigua', 'non_trovata']).gte('verificata_at', new Date(Date.now() - 30 * 86400e3).toISOString()),
    supabaseClient.from('ordini_mail_corrette').select('ordine_id, prima, dopo').gte('corretta_at', new Date(Date.now() - 30 * 86400e3).toISOString()),
  ]);
  ShopLinks.richieste = new Map(error ? [] : (data || []).map(r => [r.ordine_id, r]));
  ShopLinks.verifiche = new Map(ver.error ? [] : (ver.data || []).map(r => [r.ordine_id, r]));
  ShopLinks.mailCorrette = new Map(mailc.error ? [] : (mailc.data || []).map(r => [r.ordine_id, r]));
  if (render) refreshControlPage();
}

async function loadShopifyLinks() {
  try {
    const { data, error } = await supabaseClient.rpc('tc_shopify_stato');
    if (error) throw Ctrl._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    ShopLinks.negozi = data.negozi || [];
    ShopLinks.error = null;
  } catch (e) { ShopLinks.error = e; }
  const [caselle, mail, scartate, regole, consegne, arrivo, servizi, social] = await Promise.all([
    supabaseClient.rpc('tc_mail_stato'),
    supabaseClient.from('mail_messaggi').select('id, casella_id, da_email, da_nome, oggetto, ricevuto_at, testo, allegati')
      .eq('direzione', 'in').eq('automatica', false).order('ricevuto_at', { ascending: false }).limit(50),
    supabaseClient.from('eventi').select('id, account, payload, esito, elaborato_at')
      .eq('fonte', 'mail').not('elaborato_at', 'is', null).is('task_id', null)
      .order('elaborato_at', { ascending: false }).limit(15),
    supabaseClient.from('mail_regole').select('*').order('created_at', { ascending: false }).limit(50),
    supabaseClient.rpc('tc_spedizioni_problemi'),
    supabaseClient.from('shopify_orders').select(SHOP_ORDINE_CAMPI)
      .is('annullato_at', null).in('stato_evasione', SHOP_DA_EVADERE).order('creato_at', { ascending: false }).limit(1000),
    supabaseClient.rpc('tc_collegamenti_servizi'),
    supabaseClient.from('social_account').select('id, piattaforma, account_id, username, nome, foto, negozio, attivo, collegato_at, ultimo_errore')
      .order('piattaforma').order('username'),
  ]);
  ShopLinks.social = social.error ? null : (social.data || []);
  ShopLinks.servizi = servizi.data?.success ? servizi.data : null;
  ShopLinks.consegneErrore = consegne.error?.message || (consegne.data?.success ? null : consegne.data?.error || 'Errore');
  ShopLinks.consegne = ShopLinks.consegneErrore ? null : consegne.data.spedizioni;
  ShopLinks.arrivoErrore = arrivo.error?.message || null;
  ShopLinks.arrivo = arrivo.error ? null : (arrivo.data || []);
  await loadRichiesteDati(false);
  ShopLinks.regole = regole.error ? [] : (regole.data || []);
  ShopLinks.scartate = scartate.error ? [] : (scartate.data || []);
  ShopLinks.caselle = caselle.data?.success ? caselle.data.caselle : [];
  ShopLinks.mail = mail.error ? [] : (mail.data || []);
  await Promise.all([loadMailEsiti(), searchShopifyOrders(ShopLinks.query, false)]);
  refreshControlPage();
}

// Per ogni mail, cosa ne ha fatto il cervello: l'evento della mail e il suo task
async function loadMailEsiti() {
  const ids = (ShopLinks.mail || []).map(m => m.id);
  if (!ids.length) { ShopLinks.mailEsiti = {}; return; }
  const { data: eventi, error } = await supabaseClient.from('eventi').select('id, payload, esito, task_id, elaborato_at')
    .eq('fonte', 'mail').in('payload->>mail_id', ids);
  if (error) { ShopLinks.mailEsiti = null; return; }
  const taskIds = [...new Set((eventi || []).map(e => e.task_id).filter(Boolean))];
  const { data: tasks } = taskIds.length
    ? await supabaseClient.from('tasks').select('id, stato, assegnato_a').in('id', taskIds)
    : { data: [] };
  const perId = Object.fromEntries((tasks || []).map(t => [t.id, t]));
  ShopLinks.mailEsiti = Object.fromEntries((eventi || []).map(e => [e.payload?.mail_id, { ...e, task: perId[e.task_id] || null }]));
}

async function searchShopifyOrders(q, render = true) {
  ShopLinks.query = q = (q || '').trim();
  if (!q) {
    ShopLinks.ordini = null;
    if (render) refreshControlPage();
    return;
  }
  const safe = q.replace(/[,()%*]/g, ' ').trim();
  const cifre = q.replace(/\D/g, '');
  const parti = [`email.ilike.*${safe}*`, `cliente.ilike.*${safe}*`, `numero.ilike.*${safe}*`];
  if (cifre.length >= 6) parti.push(`telefono_cifre.like.*${cifre.slice(-9)}*`);
  const { data, error } = await supabaseClient.from('shopify_orders').select(SHOP_ORDINE_CAMPI)
    .or(parti.join(',')).order('creato_at', { ascending: false }).limit(40);
  ShopLinks.ordini = error ? [] : (data || []);
  if (render) refreshControlPage();
}

async function recoverDiscarded(id) {
  try {
    const { data, error } = await supabaseClient.rpc('tc_evento_crea_task', { p_id: id });
    if (error) throw Ctrl._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    showToast('Task creato in coda comune');
    await Ctrl.load();
    await loadShopifyLinks();
  } catch (e) { showToast(e.message, 'error'); }
}

async function syncMail(casellaId = null) {
  const key = 'mail:' + (casellaId || '*');
  ShopLinks.syncing.add(key);
  refreshControlPage();
  try {
    const { data, error } = await supabaseClient.functions.invoke('mail-sync', { body: casellaId ? { casella: casellaId } : {} });
    if (error) throw new Error(error.message || 'Controllo non riuscito');
    if (!data?.success) throw new Error(data?.error || 'Controllo non riuscito');
    const errori = data.risultati.filter(r => r.errore);
    const nuove = data.risultati.reduce((n, r) => n + (r.salvate || 0), 0);
    showToast(errori.length ? `${errori.length} caselle con errori — vedi la scheda` : nuove ? `${nuove} mail nuove` : 'Nessuna mail nuova', errori.length ? 'error' : 'success');
  } catch (e) { showToast(e.message, 'error'); }
  ShopLinks.syncing.delete(key);
  await loadShopifyLinks();
}

async function syncShopify(storeId = null) {
  const key = storeId || '*';
  ShopLinks.syncing.add(key);
  refreshControlPage();
  try {
    const { data, error } = await supabaseClient.functions.invoke('shopify-sync', { body: storeId ? { store: storeId } : {} });
    if (error) throw new Error(error.message || 'Sincronizzazione non riuscita');
    if (!data?.success) throw new Error(data?.error || 'Sincronizzazione non riuscita');
    const errori = data.risultati.filter(r => r.errore);
    const letti = data.risultati.reduce((n, r) => n + (r.letti || 0), 0);
    showToast(errori.length ? `${errori.length} negozi con errori — vedi la scheda` : `Sincronizzato: ${letti} ordini letti`, errori.length ? 'error' : 'success');
  } catch (e) { showToast(e.message, 'error'); }
  ShopLinks.syncing.delete(key);
  await loadShopifyLinks();
}

const shopNome = (id) => taskMacro(id)?.label || id;

// ── Liste a colonne di Shopify, GLS e mail: date, giorni, importi ──

// Festività nazionali: i giorni lavorativi escludono sabato, domenica e festivi
const CTRL_FESTIVI = ['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26'];
function ctrlPasquetta(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = (h + l - 7 * m + 114) % 31 + 1;
  return ctrlAddDays(`${y}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`, 1);
}
const ctrlLavorativo = (iso) => {
  const dow = new Date(iso + 'T12:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6 && !CTRL_FESTIVI.includes(iso.slice(5)) && iso !== ctrlPasquetta(+iso.slice(0, 4));
};
const ctrlGiornoDi = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
// Giorni passati da una data a oggi: totali e lavorativi
function ctrlGiorniDa(ts) {
  const dal = ctrlGiornoDi(ts), oggi = ctrlOggi();
  let tot = 0, lav = 0;
  for (let d = ctrlAddDays(dal, 1); d <= oggi && tot < 400; d = ctrlAddDays(d, 1)) { tot++; if (ctrlLavorativo(d)) lav++; }
  return { tot, lav };
}
const ctrlTestoGiorni = ({ tot, lav }) => `${tot} ${tot === 1 ? 'giorno' : 'giorni'}${lav !== tot ? ` (${lav} lavorativ${lav === 1 ? 'o' : 'i'})` : ''}`;
// "oggi, 09:29" · "ieri, 20:41" · "6 nov, 14:02"
function ctrlQuandoBreve(ts) {
  const g = ctrlGiornoDi(ts), oggi = ctrlOggi();
  const giorno = g === oggi ? 'oggi' : g === ctrlAddDays(oggi, -1) ? 'ieri'
    : new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
  return `${giorno}, ${ctrlFmtOra(ts)}`;
}
function ctrlSoldi(v, valuta) {
  if (v == null) return '';
  try { return Number(v).toLocaleString('it-IT', { style: 'currency', currency: valuta || 'EUR' }); }
  catch { return `${Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2 })} ${valuta || ''}`; }
}
const ctrlDot = (id) => `<i class="ctrl-dot" style="--m:${taskMacro(id)?.color || '#94a3b8'};" aria-hidden="true"></i>`;
const ctrlKpi = (label, valore, cls = '') => `<div class="ctrl-kpi ${cls}"><b>${valore}</b><span>${label}</span></div>`;
// Nella pagina Negozi il negozio è già scelto in alto: niente filtro
const ctrlStoreBar = (attivo, conta, totale, label, set) => Nav.current === 'comunicazione' ? '' : `
  <div class="ctrl-macro-bar" role="group" aria-label="Filtra per negozio">
    ${ctrlFilter(attivo === null, label, totale, null, `${set}(null)`)}
    ${TASK_MACROAREE.map(m => ctrlFilter(attivo === m.id, m.label, conta(m.id), m.color, `${set}('${m.id}')`)).join('')}
  </div>`;

// ── Shopify: ordini da evadere, divisi per negozio ──

function setOrdersStore(id) { ShopLinks.negozio = id; refreshControlPage(); }
function setOrdersView(v) { ShopLinks.vista = v; refreshControlPage(); }

const ORD_COLONNE = `<div class="ctrl-thead ctrl-ord" aria-hidden="true"><span>Ordine</span><span>Data</span><span>Cliente</span><span>Mail</span><span>Telefono</span><span>Indirizzo</span><span>Articoli</span><span class="is-num">Totale</span><span></span></div>`;

function ctrlShopOrderRow(o, conNegozio = true) {
  const track = (o.tracking || []).find(t => t.numero || t.url);
  const righe = o.righe || [];
  const pezzi = righe.reduce((n, r) => n + (Number(r.qnt) || 0), 0);
  const articolo = (r) => `<li><b>${r.qnt}×</b> ${escapeHtml(r.titolo)}${r.variante ? ` <span>${escapeHtml(r.variante)}</span>` : ''}</li>`;
  const eta = ctrlGiorniDa(o.creato_at);
  const pagato = ordPagato(o);
  // I problemi d'indirizzo contano solo finché l'ordine non è spedito
  const problemi = !o.annullato_at && SHOP_DA_EVADERE.includes(o.stato_evasione) ? ordProblemi(o) : [];
  // Etichetta rossa: col clic parte la mail che chiede al cliente il dato mancante.
  // Già chiesto: arancione con la data, il clic riapre la mail per sollecitare
  const chiesta = problemi.length && ShopLinks.richieste.get(o.id);
  const chiestaTesto = chiesta?.inviata_at ? `chiesto ${ctrlGiornoDi(chiesta.inviata_at) === ctrlOggi() ? 'oggi' : new Date(chiesta.inviata_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' })}` : '';
  const chiestaTitolo = chiesta?.inviata_at ? `Chiesto al cliente ${ctrlQuandoBreve(chiesta.inviata_at)}${chiesta.inviata_da === 'automatica' ? ' in automatico' : ` da ${chiesta.inviata_da}`}${chiesta.esito && chiesta.esito !== 'inviata' ? ` (${chiesta.esito})` : ''}. Clic per scrivergli di nuovo` : 'Scrivi al cliente per chiederlo';
  const tagProb = (campo) => problemi.filter(p => p[0] === campo).map(p => o.email
    ? `<button type="button" class="td-tag ctrl-prob" style="--c:${chiestaTesto ? '#d97706' : '#dc2626'};" onclick="ordineRichiediDati('${o.id}')" title="${escapeHtml(chiestaTitolo)}">${escapeHtml(p[1])}${chiestaTesto ? ` · ${chiestaTesto}` : ''}</button>`
    : `<span class="td-tag" style="--c:#dc2626;" title="Nessuna mail: va chiesto per telefono">${escapeHtml(p[1])}</span>`).join('');
  // Avvisi del riscontro (mappe, mail): arancioni, li valuta una persona; verde = corretto da solo
  const avvisi = !o.annullato_at && SHOP_DA_EVADERE.includes(o.stato_evasione) ? ordAvvisi(o) : [];
  const tagAvviso = (campo) => avvisi.filter(x => x.campo === campo).map(x =>
    x.clic ? `<button type="button" class="td-tag ctrl-prob" style="--c:${x.colore};" onclick="${x.clic}" title="${escapeHtml(x.titolo)}">${escapeHtml(x.testo)}</button>`
      : `<span class="td-tag" style="--c:${x.colore};" title="${escapeHtml(x.titolo)}">${escapeHtml(x.testo)}</span>`).join('');
  const evasione = o.annullato_at ? ['Annullato', '#94a3b8']
    : o.stato_evasione === 'FULFILLED' ? ['Evaso', '#16a34a']
    : o.stato_evasione && o.stato_evasione !== 'UNFULFILLED' ? [SHOP_EVASIONE[o.stato_evasione] || o.stato_evasione, '#f59e0b'] : null;
  const tel = o.telefono ? String(o.telefono).replace(/[^\d+]/g, '') : '';
  const negozio = conNegozio && taskMacro(o.store_id);
  const ind = ctrlIndirizzo(o.indirizzo);
  ctrlOrdiniVisti.set(o.id, o);
  return `
    <article class="ctrl-trow ctrl-ord">
      <div class="ctrl-cell ctrl-ord-num">
        <strong class="ctrl-num">${negozio ? ctrlDot(o.store_id) + ' ' : ''}${escapeHtml(o.numero)}</strong>
        ${evasione ? `<span class="td-tag" style="--c:${evasione[1]};">${escapeHtml(evasione[0])}</span>` : ''}
      </div>
      <div class="ctrl-cell"><span class="${eta.lav >= 2 && !evasione ? 'ctrl-age' : ''}" ${eta.tot >= 2 ? `title="Da ${escapeHtml(ctrlTestoGiorni(eta))}"` : ''}>${ctrlQuandoBreve(o.creato_at)}</span></div>
      <div class="ctrl-cell">${o.email || tel ? `<button type="button" class="ctrl-click ctrl-ell is-strong" onclick="apriStoricoCliente('${o.id}')" title="Storico ordini del cliente">${escapeHtml(o.cliente || 'Cliente senza nome')}</button>` : `<strong class="ctrl-ell">${escapeHtml(o.cliente || 'Cliente senza nome')}</strong>`}</div>
      <div class="ctrl-cell">${o.email ? `<button type="button" class="ctrl-click ctrl-ell" onclick="ordineScriviMail('${o.id}')" title="Scrivi a ${escapeHtml(o.email)}">${escapeHtml(o.email)}</button>` : '<small>—</small>'}${tagAvviso('mail')}</div>
      <div class="ctrl-cell">${tel ? `<button type="button" class="ctrl-click" onclick="ctrlCopia(this.textContent, 'Telefono copiato')" title="Clic per copiare">${escapeHtml(o.telefono)}</button>` : ''}${tagProb('tel') || (tel ? '' : '<small>—</small>')}</div>
      <div class="ctrl-cell">${tagProb('ind')}${tagAvviso('ind')}${ind ? `<button type="button" class="ctrl-click ctrl-ell ${problemi.some(p => p[0] === 'ind') ? 'is-prob' : ''}" onclick="ctrlCopia(this.textContent, 'Indirizzo copiato')" title="${escapeHtml(ind)} · clic per copiare">${escapeHtml(ind)}</button>` : ''}${!ind && !problemi.some(p => p[0] === 'ind') ? '<small>—</small>' : ''}</div>
      <div class="ctrl-cell">
        ${righe.length ? `<details class="ctrl-art">
          <summary>${pezzi} ${pezzi === 1 ? 'articolo' : 'articoli'}</summary>
          <ul class="ctrl-items">${righe.map(articolo).join('')}</ul>
        </details>` : '<small>—</small>'}
      </div>
      <div class="ctrl-cell is-num">
        <strong>${ctrlSoldi(o.totale, o.valuta)}</strong>
        ${pagato ? '' : `<span class="td-tag" style="--c:#dc2626;">${o.stato_pagamento === 'PENDING' ? 'Da pagare' : escapeHtml(SHOP_PAGAMENTO[o.stato_pagamento] || 'Non pagato')}</span>`}
      </div>
      <div class="ctrl-cell ctrl-cell-act">
        ${track?.url ? `<a class="ctrl-btn is-icon" href="${escapeHtml(track.url)}" target="_blank" rel="noopener" title="Tracking ${escapeHtml(track.corriere || '')}" aria-label="Tracking">${Icons.truck(14)}</a>` : ''}
        <button type="button" class="ctrl-btn is-primary ctrl-ddt" onclick="apriDdt('${o.id}')">DDT</button>
      </div>
    </article>`;
}

// ── Problemi prima della spedizione: indirizzo o telefono che il corriere non può usare ──
// (dopo la spedizione i problemi li segue la scheda Spedizioni, dal tracking).
// Stesse regole in supabase/functions/_shared/ordini-dati.ts: se ne cambi una, cambia anche l'altra.
const ordPagato = (o) => ['PAID', 'PARTIALLY_REFUNDED'].includes(o.stato_pagamento);
// Ritiro in sede o in gara: indirizzo e telefono non servono (stessa regola di conRitiro)
const ordConRitiro = (o) => !!o?.ritiro || /ritiro\s+in\s+(sede|gara)/i.test(String(o?.spedizione || ''));
function ordProblemi(o) {
  const out = [];                                   // [campo, testo]
  if (ordConRitiro(o)) return out;
  const a = o.indirizzo;
  const cifre = String(o.telefono || '').replace(/\D/g, '');
  if (!cifre) out.push(['tel', 'Manca il telefono']);
  else if (cifre.length < 8) out.push(['tel', 'Telefono incompleto']);
  else if (ordTelefonoNonValido(o.telefono, a?.paese)) out.push(['tel', 'Telefono non valido']);
  if (!a || !String(a.via || '').trim()) { out.push(['ind', 'Manca l\'indirizzo']); return out; }
  const via = String(a.via);
  // Il civico è un numero nella via; "snc" (senza numero civico) va bene
  if (!/\d/.test(via) && !/\bs\.?\s?n\.?\s?c\.?(\b|$)/i.test(via)) out.push(['ind', 'Manca il numero civico']);
  const italia = !a.paese || a.paese === 'IT';
  const cap = String(a.cap || '').trim();
  if (!cap) out.push(['ind', 'Manca il CAP']);
  else if (italia && !/^\d{5}$/.test(cap)) out.push(['ind', 'CAP non valido']);
  if (!String(a.citta || '').trim()) out.push(['ind', 'Manca la città']);
  if (italia && !String(a.provincia || '').trim()) out.push(['ind', 'Manca la provincia']);
  return out;
}

// Numero italiano che non può esistere (stessa regola di telefonoNonValido in _shared/ordini-dati.ts)
function ordTelefonoNonValido(tel, paese) {
  const raw = String(tel || '').trim();
  const c = raw.replace(/\D/g, '');
  if (c.length < 8) return false;
  let naz = c;
  if (/^(\+|00)/.test(raw)) {
    const n = raw.startsWith('00') ? c.slice(2) : c;
    if (n.startsWith('39')) naz = n.slice(2);
    else if (/^3\d{9}$/.test(n)) naz = n;
    else return false;
  } else if (paese && paese !== 'IT') return false;
  else if (c.length >= 11 && c.startsWith('39')) naz = c.slice(2);
  if (/^(\d)\1+$/.test(naz)) return true;
  return !(/^3\d{8,9}$/.test(naz) || /^0\d{5,10}$/.test(naz));
}

// Mail con il dominio scritto male (stesse regole di mailCorretta in _shared/ordini-dati.ts: se ne cambi una, cambia anche l'altra).
// In Automatica le corregge ordini-dati su Shopify; qui si vedono le altre e quelle non ancora corrette
const ORD_DOMINI_MAIL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.fr', 'hotmail.es', 'hotmail.de', 'hotmail.co.uk',
  'outlook.com', 'outlook.it', 'outlook.fr', 'outlook.es', 'live.com', 'live.it', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.it', 'yahoo.fr', 'yahoo.es', 'yahoo.de', 'yahoo.co.uk', 'libero.it', 'alice.it', 'virgilio.it', 'tiscali.it', 'tin.it',
  'email.it', 'fastwebnet.it', 'inwind.it', 'katamail.com', 'teletu.it', 'poste.it', 'iol.it', 'jumpy.it', 'pec.it', 'legalmail.it', 'postecert.it',
  'aruba.it', 'gmx.de', 'gmx.com', 'gmx.it', 'web.de', 't-online.de', 'orange.fr', 'free.fr', 'wanadoo.fr', 'aol.com', 'protonmail.com',
  'proton.me', 'bluewin.ch', 'hispeed.ch', 'sunrise.ch'];

// Lettere diverse, mancanti, in più o scambiate di posto ("gmial" = "gmail" a distanza 1)
function ordDistanza(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const ORD_FINE_COM = ['con', 'cmo', 'ocm', 'co', 'comm', 'vom', 'xom', 'cim', 'cpm', 'om', 'cm'];
const ORD_FINE_IT = ['itt', 'ti', 'ir', 'iy', 'ot', 'i', 'tt'];

function ordMailCorretta(email) {
  const e = String(email || '').trim().toLowerCase();
  const pezzi = e.split('@');
  if (pezzi.length !== 2 || !pezzi[0] || !pezzi[1].includes('.')) return null;
  const [utente, d] = pezzi;
  if (ORD_DOMINI_MAIL.includes(d) || d.length < 7) return null;
  const i = d.indexOf('.');
  const nome = d.slice(0, i), fine = d.slice(i + 1);
  if (ORD_FINE_COM.includes(fine) && ORD_DOMINI_MAIL.includes(`${nome}.com`)) return `${utente}@${nome}.com`;
  if (ORD_FINE_IT.includes(fine) && ORD_DOMINI_MAIL.includes(`${nome}.it`)) return `${utente}@${nome}.it`;
  const conNome = ORD_DOMINI_MAIL.filter(x => x.slice(0, x.indexOf('.')) === nome);
  if (conNome.length === 1 && ordDistanza(fine, conNome[0].slice(conNome[0].indexOf('.') + 1)) <= 3) return `${utente}@${conNome[0]}`;
  // Il nome è già quello di un servizio noto: non lo si scambia con un altro (gmail.it non è email.it)
  if (conNome.length) return null;
  const vicini = ORD_DOMINI_MAIL.filter(x => {
    const xn = x.slice(0, x.indexOf('.'));
    if (x.slice(x.indexOf('.') + 1) !== fine || xn.length < 4) return false;
    const k = ordDistanza(nome, xn);
    return k > 0 && k <= (xn.length >= 7 ? 2 : 1);
  });
  return vicini.length === 1 ? `${utente}@${vicini[0]}` : null;
}

// Avvisi da far valutare a una persona: indirizzo riscontrato sulle mappe, mail forse sbagliata
function ordAvvisi(o) {
  const out = [];
  const v = ShopLinks.verifiche.get(o.id);
  if (v) {
    if (v.esito === 'corretta' && v.corretta_at) out.push({ campo: 'ind', colore: '#16a34a', testo: 'Via corretta', titolo: `Corretta in automatico su Shopify: "${v.prima}" → "${v.dopo}"`, avviso: false });
    else if (v.esito === 'corretta') out.push({ campo: 'ind', colore: '#d97706', testo: `Forse "${v.dopo}"`, titolo: `${v.nota}. Non corretta su Shopify`, avviso: true });
    else if (v.esito === 'simile') out.push({ campo: 'ind', colore: '#d97706', testo: `Forse ${v.suggerimento}`, titolo: `${v.nota} (riscontro sulle mappe). Clic per cambiarla su Shopify`, avviso: true, clic: `ordineCambiaVia('${o.id}')` });
    else if (v.esito === 'ambigua') out.push({ campo: 'ind', colore: '#d97706', testo: 'Via o piazza?', titolo: v.nota, avviso: true });
    else if (v.esito === 'non_trovata') out.push({ campo: 'ind', colore: '#d97706', testo: 'Via non trovata', titolo: `${v.nota} (riscontro sulle mappe: controlla prima di spedire)`, avviso: true });
  }
  const m = ordMailCorretta(o.email);
  if (m) out.push({ campo: 'mail', colore: '#d97706', testo: `Forse ${m.split('@')[1]}`, titolo: `La mail ${o.email} sembra scritta male: forse ${m}`, avviso: true });
  const mc = ShopLinks.mailCorrette.get(o.id);
  if (mc) out.push({ campo: 'mail', colore: '#16a34a', testo: 'Mail corretta', titolo: `Corretta in automatico su Shopify: ${mc.prima} → ${mc.dopo}`, avviso: false });
  return out;
}

// La riga 1 con la via suggerita (stessa regola di rigaConVia in _shared/verifica-indirizzo.ts)
function ordRigaConVia(riga1, via) {
  const parti = String(riga1 || '').split(',').map(p => p.trim());
  const i = parti.findIndex(p => /[a-z]{3}/i.test(p));
  if (i < 0 || !String(via || '').trim()) return null;
  const w = parti[i].split(/\s+/);
  const coda = [];
  while (w.length > 1 && /^(\d+\w?(\/\w*)?|n\.?|nr\.?|civ\.?|int\.?|interno|scala|sc\.?|piano|snc|s\.n\.c\.?)$/i.test(w[w.length - 1])) coda.unshift(w.pop());
  parti[i] = [via.trim(), ...coda].join(' ');
  const nuova = parti.filter(Boolean).join(', ');
  return nuova === riga1.trim() ? null : nuova;
}

// Clic su "Forse Via …": la via suggerita dalle mappe va nell'ordine su Shopify
async function ordineCambiaVia(id) {
  const o = ctrlOrdiniVisti.get(id);
  const v = ShopLinks.verifiche.get(id);
  if (!o || v?.esito !== 'simile') return;
  // La riga 1 su Shopify: la via, senza la riga 2 (che in o.indirizzo.via è attaccata dopo una virgola)
  const riga1 = String(o.indirizzo?.via || '');
  const nuova = ordRigaConVia(riga1, v.suggerimento);
  if (!nuova) { uiAlert('Non riesco a costruire il nuovo indirizzo: cambialo a mano su Shopify.'); return; }
  if (!(await uiConfirm(`Ordine ${o.numero}: cambiare l'indirizzo su Shopify?\n\nPrima: ${riga1}\n\nDopo: ${nuova}`, { title: 'Cambia la via', ok: 'Cambia su Shopify' }))) return;
  try {
    const { data, error } = await supabaseClient.functions.invoke('ordini-dati', { body: { azione: 'cambia-via', ordine_id: id, nuova } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'Cambio non riuscito');
    }
    if (!data?.success) throw new Error(data?.error || 'Cambio non riuscito');
    // Funzione ordini-dati non ancora aggiornata: ha fatto il suo giro normale, l'indirizzo non è cambiato
    if (!data.dopo || !data.indirizzo) throw new Error('Cambio non disponibile: va pubblicata la funzione ordini-dati');
    o.indirizzo = data.indirizzo;
    showToast(`Indirizzo cambiato su Shopify: ${data.dopo}`);
    await loadRichiesteDati(true);
  } catch (e) { showToast(e.message, 'error'); }
}

// Ordini mostrati, per ritrovarli dai clic (mail, storico)
const ctrlOrdiniVisti = new Map();
const ctrlIndirizzo = (a) => !a?.via ? '' : `${a.via}, ${[a.cap, a.citta].filter(Boolean).join(' ')}${a.provincia ? ` (${a.provincia})` : ''}${a.paese && a.paese !== 'IT' ? `, ${a.paese}` : ''}`;

async function ctrlCopia(testo, msg = 'Copiato') {
  try { await navigator.clipboard.writeText(String(testo).trim()); showToast(msg); }
  catch { showToast('Copia non riuscita', 'error'); }
}

// Mail al cliente: la finestra "Nuova mail" della sezione Mail, già col negozio e l'ordine scelti
async function ordineScriviMail(id, testo = null) {
  const o = ctrlOrdiniVisti.get(id);
  if (!o?.email) return;
  if (typeof openMailCompose !== 'function' || typeof MailBox === 'undefined') {
    location.href = `mailto:${o.email}${testo ? `?subject=${encodeURIComponent(testo.oggetto)}&body=${encodeURIComponent(testo.corpo)}` : ''}`;
    return;
  }
  try {
    if (!MailBox.caselle.length) await Promise.all([MailBox.loadCaselle(), window.MailFirme?.load?.(), window.MailModelli?.load?.()]);
  } catch (e) { showToast(e.message, 'error'); return; }
  openMailCompose();
  if (MailBox.caselle.some(c => c.id === o.store_id)) setComposeBox(o.store_id);
  MailNuova.ordini = [o];
  pickComposeOrder(o.id);
  document.getElementById('mc-a').value = o.email;
  if (testo) {
    MailNuova.richiesta = o.id;
    document.getElementById('mc-oggetto').value = testo.oggetto;
    document.getElementById('mc-testo').value = MailFirme.applica(testo.corpo, MailNuova.casella);
    setTimeout(() => document.getElementById('mc-send')?.focus(), 60);
  } else setTimeout(() => document.getElementById('mc-oggetto')?.focus(), 60);
}

// Mail pronta per chiedere i dati che mancano per spedire: telefono, indirizzo, e il dubbio sulla via dalle mappe.
// Stesso testo di testoRichiesta in _shared/ordini-dati.ts: se ne cambi uno, cambia anche l'altro
const ORD_MANCA = { 'Manca il numero civico': 'il numero civico', 'Manca il CAP': 'il CAP', 'CAP non valido': 'il CAP corretto',
  'Manca la città': 'la città', 'Manca la provincia': 'la provincia' };
function ordDubbioVia(v) {
  if (!v) return null;
  if (v.esito === 'simile' && v.suggerimento) return `la via non la troviamo sulle mappe: intendevi ${v.suggerimento}?`;
  if (v.esito === 'ambigua' && v.suggerimento) return `non è chiaro se è ${String(v.suggerimento).split(' / ').join(' o ')}`;
  if (v.esito === 'non_trovata') return 'la via non la troviamo sulle mappe: puoi controllarla?';
  return null;
}
function ordineRichiediDati(id) {
  const o = ctrlOrdiniVisti.get(id);
  if (!o) return;
  const probs = ordProblemi(o);
  const tel = probs.find(p => p[0] === 'tel')?.[1];
  const ind = probs.filter(p => p[0] === 'ind').map(p => p[1]);
  const senza = ind.includes('Manca l\'indirizzo');
  const dubbio = senza ? null : ordDubbioVia(ShopLinks.verifiche.get(o.id));
  const nome = String(o.indirizzo?.nome || o.cliente || '').trim().split(/\s+/)[0];
  const elenco = (v) => v.length > 1 ? `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}` : v[0];
  const punti = [];
  if (senza) punti.push('nell\'ordine non è arrivato l\'indirizzo di spedizione');
  else if (ind.length) punti.push(`nell'indirizzo manca ${elenco(ind.map(t => ORD_MANCA[t] || t.toLowerCase()))}`);
  if (dubbio) punti.push(dubbio);
  if (tel === 'Manca il telefono') punti.push('ci serve un numero di telefono per il corriere');
  else if (tel) punti.push(`il numero di telefono (${o.telefono}) ${tel === 'Telefono incompleto' ? 'è incompleto' : 'non sembra valido'}`);
  if (!punti.length) return;
  const chiedi = [senza ? 'via, numero civico, CAP e città' : ind.length ? 'l\'indirizzo completo' : dubbio ? 'l\'indirizzo giusto' : '',
    tel ? 'un numero di telefono' : ''].filter(Boolean);
  const righe = [`${nome ? `Ciao ${nome}` : 'Ciao'},`, '',
    punti.length > 1 ? `per spedire l'ordine ${o.numero} ci serve un aiuto:\n${punti.map(p => `- ${p}`).join('\n')}` : `per spedire l'ordine ${o.numero} ci serve un aiuto: ${punti[0]}.`];
  if (!senza && (ind.length || dubbio)) righe.push('', `Indirizzo che ci hai lasciato: ${ctrlIndirizzo(o.indirizzo)}`);
  righe.push('', `Ci scrivi ${elenco(chiedi)}? Appena ci rispondi spediamo. Grazie!`);
  ordineScriviMail(id, { oggetto: `Ordine ${o.numero}: ci servono dei dati per spedirlo`, corpo: righe.join('\n') });
}

// Storico ordini del cliente: stessa email, oppure stesso telefono se l'email manca
async function apriStoricoCliente(id) {
  const o = ctrlOrdiniVisti.get(id);
  if (!o) return;
  const cifre = String(o.telefono || '').replace(/\D/g, '').slice(-9);
  const titolo = `<div class="modal-header"><h2 id="ctrl-modal-title">${escapeHtml(o.cliente || 'Cliente')}</h2>
    <button class="btn-icon" onclick="closeModal(CTRL_MODAL)" aria-label="Chiudi">${Icons.x()}</button></div>`;
  ctrlModal(`${titolo}<div class="modal-body"><div class="empty-list">Caricamento…</div></div>`, 1240, 'ctrl-storico');
  let q = supabaseClient.from('shopify_orders').select(SHOP_ORDINE_CAMPI);
  q = o.email ? q.ilike('email', o.email.replace(/[%_]/g, '\\$&')) : q.eq('telefono_cifre', cifre);
  const { data, error } = await q.order('creato_at', { ascending: false }).limit(100);
  const lista = data || [];
  const spesa = lista.filter(x => !x.annullato_at).reduce((n, x) => n + (Number(x.totale) || 0), 0);
  ctrlModal(`${titolo}
    <div class="modal-body">
      ${error ? `<div class="empty-list">Storico non caricato: ${escapeHtml(error.message)}</div>` : `
      <p class="ctrl-storico-sub">${escapeHtml(o.email || o.telefono || '')} · ${lista.length} ${lista.length === 1 ? 'ordine' : 'ordini'} · ${ctrlSoldi(spesa, o.valuta)} in totale</p>
      <div class="ctrl-table">${ORD_COLONNE}${lista.map(x => ctrlShopOrderRow(x)).join('')}</div>`}
    </div>`, 1240, 'ctrl-storico');
}

// ── DDT: stesso modello del PDF dell'automazione del mattino (automazioni/shopify-mattino/mattino.py) ──
const DDT_CAMPI_NASCOSTI = ['stampa nome', 'stampe', 'cosa vuoi personalizzare?', 'quante bandiere vuoi stampare?'];
const DDT_INIZI_NASCOSTI = ['stampa nome (', 'stampa nome alto (', 'stampa nome basso (', 'stampa logo ', 'stampa bandiera (', 'scegli il font', 'image-swatches'];
const DDT_MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function ddtHtml(o, shop) {
  const e = escapeHtml;
  const indirizzo = (a) => !a ? [] : [a.name, a.company, a.address1, a.address2,
    [a.zip, a.city, a.provinceCode].filter(Boolean).join(' '), a.countryCodeV2 === 'IT' ? 'Italia' : a.country].filter(Boolean);
  const aggiunta = (l) => l.title === 'Stampa Nome' || (l.customAttributes || []).some(a => a.key.startsWith('_gpo_parent') || a.key.startsWith('_customily-upsell-id'));
  const spedibili = o.lineItems.nodes.filter(l => l.requiresShipping && !aggiunta(l));
  const aperte = spedibili.filter(l => l.unfulfilledQuantity > 0);
  const righe = aperte.length ? aperte : spedibili;   // ordine già evaso: tutte le righe
  const visibile = (a) => { const k = a.key.trim().toLowerCase(); return !k.startsWith('_') && !DDT_CAMPI_NASCOSTI.includes(k) && !DDT_INIZI_NASCOSTI.some(x => k.startsWith(x)); };
  const link = (v) => /^https?:\/\//.test(v || '');
  const d = new Date(o.createdAt);
  const giorno = Number(d.toLocaleDateString('it-IT', { day: 'numeric', timeZone: 'Europe/Rome' }));
  const mese = Number(d.toLocaleDateString('it-IT', { month: 'numeric', timeZone: 'Europe/Rome' }));
  const anno = d.toLocaleDateString('it-IT', { year: 'numeric', timeZone: 'Europe/Rome' });
  const pagato = ['PAID', 'PARTIALLY_REFUNDED'].includes(o.displayFinancialStatus);
  const sa = shop.billingAddress || {};
  const sede = [sa.address1, [sa.zip, sa.city, sa.provinceCode].filter(Boolean).join(' '), sa.countryCodeV2 === 'IT' ? 'Italia' : sa.country].filter(Boolean).join(', ');
  const riga = (l) => {
    const attr = (l.customAttributes || []).filter(visibile);
    return `<tr>
      <td class="img">${l.image?.url ? `<img src="${e(l.image.url)}" alt="">` : ''}</td>
      <td><div>${e(l.title)}</div>${l.variantTitle ? `<div>${e(l.variantTitle)}</div>` : ''}
        ${attr.filter(a => !link(a.value)).map(a => `<div>${e(a.key)}: ${e(a.value)}</div>`).join('')}
        ${attr.some(a => link(a.value)) ? `<div class="loghi">${attr.filter(a => link(a.value)).map(a => `<a href="${e(a.value)}" target="_blank" rel="noopener"><img src="${e(a.value)}" alt=""><span>${e(a.key.slice(0, 14))}</span></a>`).join('')}</div>` : ''}
      </td>
      <td class="q">${aperte.length ? l.unfulfilledQuantity : l.quantity} di ${l.quantity}</td>
    </tr>`;
  };
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>DDT ${e(o.name)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e5e5e5; font: 12.3px/1.5 "Noto Sans", -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; }
  .bar { position: sticky; top: 0; display: flex; gap: 8px; justify-content: center; padding: 10px; background: #111; }
  .bar button { font: 600 13px/1 inherit; padding: 9px 18px; border-radius: 999px; border: 0; cursor: pointer; background: #f5c542; }
  .bar button + button { background: #fff; }
  .page { width: 210mm; min-height: 297mm; margin: 20px auto; padding: 22mm 32mm 20mm 29.6mm; background: #fff; }
  .fascia { background: #cc1a1a; color: #fff; font-weight: 700; font-size: 11.3px; padding: 6px 10px; margin: -16mm 0 6mm; }
  header { display: flex; justify-content: space-between; align-items: flex-start; }
  header h1 { margin: 0; font-size: 23px; font-weight: 400; letter-spacing: 0.01em; }
  header div { text-align: right; }
  .ind { display: grid; grid-template-columns: 65mm 1fr; margin-top: 9mm; padding-bottom: 3mm; border-bottom: 1.6px solid #000; }
  h2 { margin: 0 0 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.02em; }
  .ind p { margin: 0; }
  .nota { margin-top: 4mm; padding: 3mm 3.5mm; border: 1.6px solid #000; }
  .nota p { margin: 0; font-weight: 700; white-space: pre-wrap; }
  table { width: calc(100% - 4.9mm); margin: 7mm 0 0 2.5mm; border-collapse: collapse; }
  th { font-size: 10px; font-weight: 700; text-align: left; padding-bottom: 6px; }
  th:last-child, td.q { text-align: right; white-space: nowrap; }
  td { vertical-align: middle; padding: 4px 0; }
  td.img { width: 17mm; } td.img img { width: 12.7mm; height: 12.7mm; object-fit: contain; display: block; }
  tbody tr:last-child td { padding-bottom: 8px; }
  tfoot td { border-top: 1.6px solid #000; padding: 0; }
  .loghi { display: flex; gap: 8px; margin-top: 4px; }
  .loghi a { display: flex; flex-direction: column; align-items: center; color: #000; text-decoration: none; font-size: 10px; }
  .loghi img { width: 18mm; height: 15mm; object-fit: contain; }
  footer { text-align: center; margin-top: 9mm; }
  footer p { margin: 0; }
  footer .grazie { margin-bottom: 9mm; }
  @media print { body { background: #fff; } .bar { display: none; } .page { margin: 0; } }
</style></head><body>
<div class="bar"><button onclick="print()">Stampa</button><button onclick="close()">Chiudi</button></div>
<div class="page">
  ${pagato ? '' : `<div class="fascia">ORDINE NON PAGATO (${e(String(o.displayFinancialStatus || '').toLowerCase().replace(/_/g, ' '))}): NON SPEDIRE</div>`}
  <header><h1>${e((shop.name || '').toUpperCase())}</h1><div>Ordine ${e(o.name)}<br>${giorno} ${DDT_MESI[mese - 1]} ${anno}</div></header>
  <section class="ind">
    <div><h2>SPEDISCI A</h2>${indirizzo(o.shippingAddress).map(x => `<p>${e(x)}</p>`).join('')}</div>
    <div><h2>DESTINATARIO FATTURA</h2>${indirizzo(o.billingAddress).map(x => `<p>${e(x)}</p>`).join('')}</div>
  </section>
  ${(o.note || '').trim() ? `<section class="nota"><h2>NOTE DEL CLIENTE</h2><p>${e(o.note.trim())}</p></section>` : ''}
  <table>
    <thead><tr><th colspan="2">ARTICOLI</th><th>QUANTITÀ</th></tr></thead>
    <tbody>${righe.map(riga).join('')}</tbody>
    <tfoot><tr><td colspan="3"></td></tr></tfoot>
  </table>
  <footer>
    <p class="grazie">Grazie per aver acquistato da noi!</p>
    ${[shop.name, sede, shop.contactEmail, shop.primaryDomain?.host].filter(Boolean).map(x => `<p>${e(x)}</p>`).join('')}
  </footer>
</div></body></html>`;
}

// Elenco articoli: si chiude cliccando altrove, come su Shopify
document.addEventListener('click', (ev) => {
  document.querySelectorAll('.ctrl-art[open]').forEach(d => { if (!d.contains(ev.target)) d.open = false; });
});

async function apriDdt(id) {
  // La finestra si apre subito, nel clic: dopo l'attesa il browser la bloccherebbe
  const w = window.open('', '_blank');
  if (!w) { uiAlert('Il browser ha bloccato la finestra del DDT: consenti i popup per cs.pngs.it.'); return; }
  w.document.write('<!doctype html><meta charset="utf-8"><title>DDT</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#666">Preparo il DDT…</body>');
  try {
    const { data, error } = await supabaseClient.functions.invoke('shopify-ddt', { body: { ordine_id: id } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'DDT non disponibile');
    }
    if (!data?.success) throw new Error(data?.error || 'DDT non disponibile');
    w.document.open();
    w.document.write(ddtHtml(data.ordine, data.negozio));
    w.document.close();
  } catch (e) {
    w.document.body.textContent = `DDT non disponibile: ${e.message}`;
  }
}

function renderControlOrders() {
  // Nella pagina Negozi la ricerca resta nel negozio scelto
  const inNegozio = Nav.current === 'comunicazione' && ShopLinks.negozio;
  const trovati = inNegozio && ShopLinks.ordini ? ShopLinks.ordini.filter(o => o.store_id === ShopLinks.negozio) : ShopLinks.ordini;
  return `
    <form class="ctrl-search glass-card" onsubmit="event.preventDefault();searchShopifyOrders(this.q.value)" role="search">
      <label class="sr-only" for="shop-q">Cerca ordine</label>
      <input id="shop-q" name="q" class="form-input" value="${escapeHtml(ShopLinks.query)}"
        placeholder="Cerca per email, telefono, nome o numero d'ordine${inNegozio ? '' : ', in tutti i negozi Shopify'}">
      <button class="ctrl-btn is-primary" type="submit">${Icons.search(14)} Cerca</button>
      ${ShopLinks.query ? `<button class="ctrl-btn" type="button" onclick="searchShopifyOrders('')">Azzera</button>` : ''}
    </form>
    ${ShopLinks.query ? `
    <section class="glass-card page-card ctrl-group ctrl-ord-card">
      <div class="page-card-head"><h2>Ordini trovati</h2><span class="table-count">${trovati?.length ?? 0}</span>
        <span class="ctrl-group-hint">Per «${escapeHtml(ShopLinks.query)}»${inNegozio ? '' : ', in tutti i negozi'}, anche evasi</span></div>
      ${!trovati ? `<div class="empty-list">Caricamento…</div>`
        : trovati.length ? `<div class="ctrl-table">${ORD_COLONNE}${trovati.map(o => ctrlShopOrderRow(o, !inNegozio)).join('')}</div>`
        : `<div class="empty-list">Nessun ordine trovato.</div>`}
    </section>` : renderOrdersIncoming()}`;
}

function renderOrdersIncoming() {
  const head = (n) => `<div class="page-card-head"><h2>Ordini da evadere</h2>${n != null ? `<span class="table-count">${n}</span>` : ''}
    <span class="ctrl-group-hint">Da Shopify, aggiornati ogni 5 minuti</span></div>`;
  if (ShopLinks.arrivoErrore) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Ordini non caricati: ${escapeHtml(ShopLinks.arrivoErrore)}</div></section>`;
  if (!ShopLinks.arrivo) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Caricamento…</div></section>`;
  const tutti = ShopLinks.arrivo;
  const conta = (id) => tutti.filter(o => o.store_id === id).length;
  const vis = ShopLinks.negozio ? tutti.filter(o => o.store_id === ShopLinks.negozio) : tutti;
  const gruppi = TASK_MACROAREE.filter(m => (!ShopLinks.negozio || ShopLinks.negozio === m.id) && conta(m.id));

  const oggi = ctrlOggi();
  const filtri = {
    tutti:     { label: 'Da evadere',    test: () => true,                                    vuoto: 'Nessun ordine da evadere.' },
    oggi:      { label: 'Arrivati oggi', test: (o) => ctrlGiornoDi(o.creato_at) === oggi,    vuoto: 'Nessun ordine arrivato oggi.' },
    nonpagati: { label: 'Non pagati',    test: (o) => !ordPagato(o),                          vuoto: 'Nessun ordine da pagare.' },
    problemi:  { label: 'Problemi',      test: (o) => ordProblemi(o).length > 0 || ordAvvisi(o).some(x => x.avviso), vuoto: 'Nessun problema: indirizzi e telefoni a posto.' },
  };
  const vista = filtri[ShopLinks.vista] ? ShopLinks.vista : 'tutti';
  const n = (k) => vis.filter(filtri[k].test).length;
  const box = (k, cls = '') => {
    const v = n(k), on = vista === k;
    return `<button type="button" class="ctrl-kpi is-click ${on ? 'is-on' : ''} ${v && cls ? cls : ''}" aria-pressed="${on}"
      onclick="CtrlAnim.filtro='kpi-${k}';setOrdersView('${on && k !== 'tutti' ? 'tutti' : k}')"><b>${v}</b><span>${filtri[k].label}</span></button>`;
  };
  const elenco = (id) => tutti.filter(o => o.store_id === id && filtri[vista].test(o));
  const gruppiVis = gruppi.filter(m => elenco(m.id).length);
  return `
    <section class="glass-card page-card ctrl-group ctrl-ord-card">
      ${head(vis.length)}
      ${ctrlStoreBar(ShopLinks.negozio, conta, tutti.length, 'Tutti', 'setOrdersStore')}
      ${vis.length ? `
        <div class="ctrl-kpis" role="group" aria-label="Filtra gli ordini">
          ${box('oggi')}${box('tutti')}${box('nonpagati', 'is-alert')}${box('problemi', 'is-alert')}
        </div>
        ${vista === 'problemi' && gruppiVis.length ? `<p class="ctrl-kpi-hint">Indirizzi senza civico, CAP, città o provincia e telefoni mancanti, da sistemare prima di spedire. In rosso da chiedere, in arancione già chiesti al cliente. Dopo la spedizione i problemi passano in Spedizioni.</p>` : ''}` : ''}
      ${gruppiVis.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${gruppiVis.map(m => `
        ${Nav.current === 'comunicazione' ? '' : `<div class="ctrl-store-head" style="--m:${m.color};"><i aria-hidden="true"></i>${m.label}<b>${elenco(m.id).length}</b></div>`}
        <div class="ctrl-table">${ORD_COLONNE}${elenco(m.id).map(o => ctrlShopOrderRow(o, false)).join('')}</div>`).join('')}</div>`
        : `<div class="empty-list">${vis.length ? filtri[vista].vuoto : 'Nessun ordine da evadere.'}</div>`}
    </section>`;
}

// ── GLS: spedizioni con problemi e ritardi, raggruppate per problema ──

function setGlsStore(id) { ShopLinks.negozioGls = id; refreshControlPage(); }

const glsUrl = (numero) => `https://www.gls-italy.com/?option=com_gls&view=track_e_trace&mode=search&diretto=yes&numsped=${encodeURIComponent(numero.slice(2))}&locpartenza=${encodeURIComponent(numero.slice(0, 2))}`;

function renderGlsRow(c, { ritardo = false, conFare = true } = {}) {
  const giorni = (c.giorni_testo || '').match(/^(\d+\s+\S+)\s*\((.+)\)$/);
  const tel = c.telefono ? String(c.telefono).replace(/[^\d+]/g, '') : '';
  return `
    <article class="ctrl-trow ctrl-gls">
      <div class="ctrl-cell">
        <strong><span class="ctrl-num">${escapeHtml(c.ordine || '')}</span> · ${escapeHtml(c.cliente || 'Cliente senza nome')}</strong>
        ${c.esterna ? `<small>Fuori dai negozi collegati${c.citta ? ` · ${escapeHtml(c.citta)}` : ''}</small>` : `<small class="ctrl-macro-tag" style="--m:${taskMacro(c.store_id)?.color || '#94a3b8'};">${ctrlDot(c.store_id)} ${escapeHtml(shopNome(c.store_id))}${c.citta ? ` <span>· ${escapeHtml(c.citta)}</span>` : ''}</small>`}
      </div>
      <div class="ctrl-cell">
        ${ritardo && c.problema ? `<strong>${escapeHtml(c.problema)}</strong>` : ''}
        ${c.ultimo_evento ? `<span>${escapeHtml(c.ultimo_evento)}</span>` : ''}
        ${c.ultimo_at ? `<small>Ultimo aggiornamento GLS: ${ctrlQuandoBreve(c.ultimo_at)}</small>` : ''}
        ${conFare && c.fare ? `<span class="ctrl-fare"><strong>Da fare:</strong> ${escapeHtml(c.fare)}</span>` : ''}
      </div>
      <div class="ctrl-cell">
        ${giorni ? `<strong>${escapeHtml(giorni[1])}</strong><small>${escapeHtml(giorni[2])}</small>` : c.giorni_testo ? `<strong>${escapeHtml(c.giorni_testo)}</strong>` : '<small>—</small>'}
      </div>
      <div class="ctrl-cell">
        ${tel ? `<a class="ctrl-link" href="tel:${escapeHtml(tel)}">${escapeHtml(c.telefono)}</a>` : ''}
        ${c.email ? `<a class="ctrl-link" href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ''}
        ${!tel && !c.email ? '<small>Nessun contatto</small>' : ''}
      </div>
      <div class="ctrl-cell ctrl-cell-act">
        ${c.task_id && Ctrl.get(c.task_id) ? `<button class="ctrl-btn is-primary" type="button" onclick="openTaskDetail('${c.task_id}')">Apri task</button>` : ''}
        <a class="ctrl-btn" href="${escapeHtml(glsUrl(c.numero))}" target="_blank" rel="noopener" title="Tracking GLS">${Icons.truck(14)} ${escapeHtml(c.numero)}</a>
      </div>
    </article>`;
}

// Giacenze: in evidenza in cima, una scheda per pacco con tutto quello che serve per gestirlo
const GIACENZE = ['Giacenza in deposito GLS', 'Indirizzo errato', 'Destinatario chiuso per ferie'];
const glsGiorno = (iso) => iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' }) : '';
const telLink = (t) => t ? `<a class="ctrl-link" href="tel:${escapeHtml(String(t).replace(/[^\d+]/g, ''))}">${escapeHtml(t)}</a>` : '';

// Il cliente ha risposto e lo svincolo non è ancora partito: oltre mezza giornata (4 ore) è in ritardo
const SVINCOLO_ATTESA_MAX_H = 4;
const svincoloOre = (c) => c.task_svincolo_at ? Math.floor((Date.now() - new Date(c.task_svincolo_at).getTime()) / 3_600_000) : 0;

// Giorni lavorativi che mancano a quando GLS può rendere il pacco (0 = da oggi, negativo = già possibile)
function giacenzaRientro(c) {
  if (!c.rientro_dal) return null;
  const oggi = ctrlOggi();
  let n = 0;
  if (c.rientro_dal > oggi) { for (let d = ctrlAddDays(oggi, 1); d <= c.rientro_dal && n < 60; d = ctrlAddDays(d, 1)) if (ctrlLavorativo(d)) n++; }
  else if (c.rientro_dal < oggi) n = -1;
  return n;
}

function giacenzaStato(c) {
  if (c.di_nuovo_ferma) return { id: 'nuova', label: `Di nuovo ferma dopo lo svincolo del ${glsGiorno(c.svincolata_at)}: chiamare il cliente` };
  if (c.task_svincolo_id && svincoloOre(c) >= SVINCOLO_ATTESA_MAX_H) return { id: 'nuova', label: `Il cliente ha risposto da ${svincoloOre(c)} ore: manda subito le istruzioni a GLS` };
  if (c.task_svincolo_id) return { id: 'istruzioni', label: 'Il cliente ha risposto: istruzioni GLS da mandare' };
  if (c.problema === 'Destinatario chiuso per ferie') return { id: 'ferie', label: 'Riconsegna alla riapertura' };
  return { id: 'gestire', label: 'Da gestire' };
}

function giacenzaContatto(c) {
  if (c.esterna) return `<strong>Spedizione senza ordine Shopify</strong><small>Contatta il destinatario dal canale di vendita${c.ordine ? ` (riferimento ${escapeHtml(c.ordine)})` : ''}</small>`;
  const k = c.contatto;
  if (k?.stato === 'risposto') return `<strong>Ha risposto il ${glsGiorno(k.risposta_at)}</strong>`;
  if (k?.stato === 'chiamare') return `<strong class="gz-red">Da chiamare</strong><small>${k.mail_n} ${k.mail_n === 1 ? 'mail' : 'mail'} senza risposta, l'ultima il ${glsGiorno(k.ultima_mail_at)}</small>`;
  if (k?.stato === 'in_attesa') return `<strong>Mail inviata il ${glsGiorno(k.ultima_mail_at)}</strong><small>In attesa di risposta</small>`;
  if (k?.stato === 'senza_email') return `<strong class="gz-red">Senza email: va chiamato</strong>`;
  if (k?.stato === 'dopo_svincolo') return `<strong class="gz-red">Da chiamare</strong><small>Già svincolata${k.svincoli > 1 ? ` ${k.svincoli} volte` : ''}: niente altro svincolo prima della telefonata</small>`;
  if (c.avviso_cliente_esito === 'inviata') return `<strong>Avviso inviato il ${glsGiorno(c.avviso_cliente_at)}</strong>`;
  if (c.avviso_cliente_esito?.startsWith('errore')) return `<strong class="gz-red">Avviso non partito</strong><small>${escapeHtml(c.avviso_cliente_esito)}</small>`;
  return `<strong class="gz-red">Non ancora contattato</strong>`;
}

function renderGiacenza(c) {
  const st = giacenzaStato(c);
  const rientro = giacenzaRientro(c);
  const ind = c.indirizzo || {};
  const d = c.deposito;
  const indDep = d ? [d.indirizzo, [d.cap, d.sede].filter(Boolean).join(' ') + (d.provincia ? ` (${d.provincia})` : '')].filter(Boolean).join(', ') : '';
  const ripetuta = (c.giacenze_n || 0) > 1 ? `${c.giacenze_n}ª giacenza, la prima il ${glsGiorno(c.prima_giacenza_at)}` : '';
  const tentativi = c.tentativi ? `${c.tentativi} ${c.tentativi === 1 ? 'tentativo fallito' : 'tentativi falliti'}` : '';
  const ultimo = (c.eventi || [])[0];
  return `
    <article class="gz-card is-${st.id}">
      <header class="gz-head">
        <div class="gz-who">
          <strong><span class="ctrl-num">${escapeHtml(c.ordine || '')}</span> · ${escapeHtml(c.cliente || 'Cliente senza nome')}</strong>
          ${c.esterna ? `<small>Fuori dai negozi collegati${c.citta ? ` · ${escapeHtml(c.citta)}` : ''}</small>`
            : `<small class="ctrl-macro-tag" style="--m:${taskMacro(c.store_id)?.color || '#94a3b8'};">${ctrlDot(c.store_id)} ${escapeHtml(shopNome(c.store_id))}</small>`}
        </div>
        <span class="gz-tipo">${escapeHtml(c.problema)}</span>
        <span class="gz-stato">${escapeHtml(st.label)}</span>
      </header>
      <div class="gz-grid">
        <div class="gz-f"><span>Ferma</span>
          <strong>${c.ferma_dal ? `dal ${glsGiorno(c.ferma_dal)} · ${escapeHtml(c.ferma_testo || '')}` : '—'}</strong>
          ${ripetuta || tentativi ? `<small>${[ripetuta, tentativi].filter(Boolean).join(' · ')}</small>` : ''}
          ${c.giorni_testo ? `<small>Spedita da ${escapeHtml(c.giorni_testo)}</small>` : ''}
        </div>
        ${rientro != null && st.id !== 'ferie' ? `<div class="gz-f"><span>Rientro al mittente</span>
          <strong class="${rientro <= 1 ? 'gz-red' : ''}">${rientro < 0 ? 'Possibile da un momento all\'altro' : rientro === 0 ? 'Possibile da oggi' : rientro === 1 ? 'Possibile da domani' : `Tra ${rientro} giorni lavorativi`}</strong>
          <small>GLS può renderlo dal ${glsGiorno(c.rientro_dal + 'T12:00:00Z')}: istruzioni prima</small>
        </div>` : ''}
        <div class="gz-f"><span>Ultimo evento GLS</span>
          <strong>${escapeHtml(c.ultimo_evento || ultimo?.stato || '—')}</strong>
          ${c.ultimo_at ? `<small>${ctrlQuandoBreve(c.ultimo_at)}${ultimo?.luogo ? ` · ${escapeHtml(ultimo.luogo)}` : ''}</small>` : ''}
        </div>
        <div class="gz-f"><span>Cliente</span>
          ${c.esterna ? `<strong>${escapeHtml(c.cliente || '')}</strong>` : c.telefono ? `<strong>${telLink(c.telefono)}</strong>` : c.contatto?.telefono ? `<strong>${telLink(c.contatto.telefono)}</strong>` : '<strong class="gz-red">Senza telefono</strong>'}
          ${c.email ? `<a class="ctrl-link" href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ''}
          ${ind.via ? `<small>${escapeHtml(ind.via)}, ${escapeHtml([ind.cap, ind.citta].filter(Boolean).join(' '))}${ind.provincia ? ` (${escapeHtml(ind.provincia)})` : ''}</small>` : ''}
        </div>
        <div class="gz-f"><span>Contatto col cliente</span>${giacenzaContatto(c)}</div>
        <div class="gz-f"><span>Deposito GLS</span>
          ${d?.sede ? `<strong>GLS ${escapeHtml(d.sede)}${d.telefono ? ` · ${telLink(d.telefono)}` : ''}</strong>
            <small>${escapeHtml(indDep)}</small>
            ${d.coincide === false && d.luogo_eventi ? `<small>Ultimi eventi a ${escapeHtml(d.luogo_eventi)}: per il ritiro conferma il punto con la sede</small>` : ''}` : '<small>Non ancora letto da GLS</small>'}
        </div>
      </div>
      ${c.fare && st.id !== 'istruzioni' ? `<p class="gz-nota"><strong>Da fare:</strong> ${escapeHtml(c.fare)}</p>` : ''}
      <footer class="gz-foot">
        ${(c.eventi || []).length ? `<details class="gz-ev"><summary>Ultimi eventi GLS</summary><ol>${c.eventi.map(e => `<li><strong>${escapeHtml(e.stato)}</strong><small>${ctrlQuandoBreve(e.at)}${e.luogo ? ` · ${escapeHtml(e.luogo)}` : ''}</small></li>`).join('')}</ol></details>` : '<span></span>'}
        <div class="gz-act">
          ${c.task_svincolo_id && Ctrl.get(c.task_svincolo_id) ? `<button class="ctrl-btn is-primary" type="button" onclick="openTaskDetail('${c.task_svincolo_id}')">${Icons.truck(14)} Istruzioni GLS</button>` : ''}
          ${c.task_id && Ctrl.get(c.task_id) ? `<button class="ctrl-btn ${c.task_svincolo_id ? '' : 'is-primary'}" type="button" onclick="openTaskDetail('${c.task_id}')">Apri task</button>` : ''}
          <button class="ctrl-btn" type="button" onclick="segnaSvincolata('${escapeHtml(c.numero)}', '${escapeHtml(String(c.ordine || '').replace(/'/g, ''))}')">Già svincolata su GLS</button>
          <a class="ctrl-btn" href="${escapeHtml(glsUrl(c.numero))}" target="_blank" rel="noopener" title="Tracking GLS">${Icons.truck(14)} ${escapeHtml(c.numero)}</a>
        </div>
      </footer>
    </article>`;
}

// Svincolo fatto dal portale GLS: la giacenza sparisce finché il pacco non si ferma di nuovo
async function segnaSvincolata(numero, ordine) {
  if (!(await uiConfirm(`Hai già dato le istruzioni per ${ordine || numero} dal portale GLS? La giacenza sparisce dal gestionale e torna solo se il pacco si ferma di nuovo.`, { ok: 'Sì, già svincolata' }))) return;
  const { data, error } = await supabaseClient.rpc('tc_spedizione_svincolata', { p_numero: numero });
  if (error || !data?.success) { showToast(error?.message || data?.error || 'Non riuscito', 'error'); return; }
  ShopLinks.consegne = (ShopLinks.consegne || []).map(c => c.numero === numero ? { ...c, svincolata: true } : c);
  refreshControlPage();
  showToast('Segnata come svincolata');
  Ctrl.loadBadge();
}

function renderControlGls() {
  const head = (n) => `<div class="page-card-head"><h2>Spedizioni da seguire</h2>${n != null ? `<span class="table-count">${n}</span>` : ''}
    <span class="ctrl-group-hint">Tracking GLS controllato ogni 15 minuti, dalle 7 alle 20</span></div>`;
  if (ShopLinks.consegneErrore) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Spedizioni non caricate: ${escapeHtml(ShopLinks.consegneErrore)}</div></section>`;
  if (!ShopLinks.consegne) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Caricamento…</div></section>`;

  const tutte = ShopLinks.consegne;
  // Svincolate: istruzioni date a GLS (dal gestionale o dal portale), spariscono finché il pacco non si ferma di nuovo
  const visibili = tutte.filter(c => !c.svincolata);
  // 'tcfactory' (pagina Negozi): le spedizioni fuori dai negozi collegati
  const list = ShopLinks.negozioGls === 'tcfactory' ? visibili.filter(c => c.esterna)
    : ShopLinks.negozioGls ? visibili.filter(c => c.store_id === ShopLinks.negozioGls) : visibili;
  // In cima ciò che va fatto subito: in ritardo, poi le istruzioni da mandare (basta un clic), poi le altre; a parità, chi rientra prima
  const ordine = { nuova: 0, istruzioni: 1, gestire: 2, ferie: 3 };
  const giacenze = list.filter(c => GIACENZE.includes(c.problema))
    .sort((a, b) => ordine[giacenzaStato(a).id] - ordine[giacenzaStato(b).id] || String(a.rientro_dal || a.ferma_dal).localeCompare(String(b.rientro_dal || b.ferma_dal)));
  const altre = list.filter(c => !GIACENZE.includes(c.problema));
  const daGestire = giacenze.filter(c => giacenzaStato(c).id !== 'ferie').length;

  // Il resto: problemi uguali insieme, poi i ritardi
  const problemi = altre.filter(c => c.stato === 'problema');
  const ritardi = altre.filter(c => c.stato === 'ritardo');
  const tipi = new Map();
  problemi.forEach(c => { const k = c.problema || 'Altro problema'; tipi.set(k, [...(tipi.get(k) || []), c]); });
  const gruppiProblemi = [...tipi.entries()].sort((a, b) => b[1].length - a[1].length);
  const colonne = `<div class="ctrl-thead ctrl-gls" aria-hidden="true"><span>Ordine e cliente</span><span>Situazione</span><span>Spedita da</span><span>Contatti</span><span></span></div>`;
  const gruppo = (titolo, righe, colore, ritardo = false) => {
    const fare = [...new Set(righe.map(c => c.fare).filter(Boolean))];
    const fareUnico = !ritardo && fare.length === 1 && righe.every(c => c.fare) ? fare[0] : null;
    return `
      <div class="ctrl-ghead" style="--g:${colore};">
        <h3>${escapeHtml(titolo)}</h3><b>${righe.length}</b>
        ${fareUnico ? `<p><strong>Da fare:</strong> ${escapeHtml(fareUnico)}</p>` : ''}
      </div>
      <div class="ctrl-table">${colonne}${righe.map(c => renderGlsRow(c, { ritardo, conFare: !fareUnico })).join('')}</div>`;
  };
  return `
    <section class="glass-card page-card ctrl-group gz-section">
      <div class="page-card-head"><h2>Giacenze</h2><span class="table-count">${giacenze.length}</span>
        <span class="ctrl-group-hint">${daGestire ? `${daGestire} da gestire` : 'Niente da gestire'}${giacenze.length - daGestire ? ` · ${giacenze.length - daGestire} chiuse per ferie` : ''} · controllate ogni 15 minuti</span></div>
      ${ctrlStoreBar(ShopLinks.negozioGls, (id) => visibili.filter(c => c.store_id === id).length, visibili.length, 'Tutti', 'setGlsStore')}
      ${giacenze.length ? `<div class="gz-list ${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${giacenze.map(renderGiacenza).join('')}</div>`
        : `<div class="empty-list">Nessun pacco in giacenza.</div>`}
    </section>
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Altre spedizioni da seguire</h2><span class="table-count">${altre.length}</span>
        <span class="ctrl-group-hint">Consegne non riuscite, rientri, ritardi e tracking non attivi</span></div>
      ${altre.length ? `
        <div class="ctrl-kpis">
          ${ctrlKpi('Problemi', problemi.length, problemi.length ? 'is-alert' : '')}
          ${ctrlKpi('Ritardi', ritardi.length, ritardi.length ? 'is-warn' : '')}
        </div>
        <div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">
          ${gruppiProblemi.map(([titolo, righe]) => gruppo(titolo, righe, '#ef4444')).join('')}
          ${ritardi.length ? gruppo('Ritardi', ritardi, '#f59e0b', true) : ''}
        </div>` : `<div class="empty-list">Nessun ritardo o altro problema.</div>`}
    </section>`;
}

// ── Instagram e Facebook: conversazioni dei negozi (social_conversazioni / social_messaggi) ──
const CtrlSocial = { conv: null, errore: null, sel: null, msgs: null, filtro: null, invio: false, sync: false };
const SOCIAL_ICONA = { instagram: 'Instagram', messenger: 'Facebook' };

// La chat social sta nella sezione Comunicazione
function socialRidisegna() {
  if (Nav.current === 'comunicazione') renderComunicazionePage();
}

async function loadSocial() {
  const { data, error } = await supabaseClient.from('social_conversazioni')
    .select('id, utente_id, utente_nome, ultimo_at, ultimo_testo, ultimo_da, da_leggere, social_account(id, piattaforma, username, negozio, ultimo_errore)')
    .not('ultimo_at', 'is', null).order('ultimo_at', { ascending: false }).limit(300);
  CtrlSocial.errore = error ? (/does not exist|schema cache/.test(error.message) ? 'Esegui sql/social-messaggi.sql su Supabase.' : error.message) : null;
  CtrlSocial.conv = error ? [] : (data || []);
  socialRidisegna();
}

async function apriSocial(id) {
  CtrlSocial.sel = id;
  CtrlSocial.msgs = null;
  socialRidisegna();
  const { data } = await supabaseClient.from('social_messaggi').select('id, direzione, testo, allegati, at, errore')
    .eq('conversazione', id).order('at').limit(500);
  if (CtrlSocial.sel !== id) return;
  CtrlSocial.msgs = data || [];
  const c = CtrlSocial.conv?.find(x => x.id === id);
  if (c?.da_leggere) { c.da_leggere = false; supabaseClient.rpc('tc_social_letta', { p_id: id }).then(() => comLoadBadge()); }
  socialRidisegna();
  document.querySelector('.soc-thread-body')?.scrollTo({ top: 1e9 });
}

async function aggiornaSocial() {
  CtrlSocial.sync = true;
  socialRidisegna();
  try {
    const { data, error } = await supabaseClient.functions.invoke('social-sync', { body: {} });
    if (error || !data?.success) throw new Error(data?.error || error?.message || 'Lettura non riuscita');
    const nuovi = data.risultati.reduce((n, r) => n + (r.nuovi || 0), 0);
    showToast(nuovi ? `${nuovi} messaggi nuovi` : 'Nessun messaggio nuovo', 'success');
  } catch (e) { showToast(e.message, 'error'); }
  CtrlSocial.sync = false;
  await loadSocial();
  if (CtrlSocial.sel) apriSocial(CtrlSocial.sel);
}

async function inviaSocial(ev) {
  ev.preventDefault();
  const campo = document.getElementById('soc-testo');
  const testo = campo.value.trim();
  if (!testo || !CtrlSocial.sel || CtrlSocial.invio) return;
  CtrlSocial.invio = true;
  document.getElementById('soc-invia').disabled = true;
  try {
    const { data, error } = await supabaseClient.functions.invoke('social-invia', { body: { conversazione: CtrlSocial.sel, testo } });
    if (error && !data) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Invio non riuscito');
    campo.value = '';
    showToast('Risposta inviata', 'success');
    await loadSocial();
    await apriSocial(CtrlSocial.sel);
  } catch (e) {
    uiAlert('Risposta non inviata: ' + e.message);
  } finally {
    CtrlSocial.invio = false;
    const b = document.getElementById('soc-invia');
    if (b) b.disabled = false;
  }
}

function setSocialFiltro(f) { CtrlSocial.filtro = f; socialRidisegna(); }

// fisso = { negozio, piattaforma }: solo quel negozio e quel canale (pagina Comunicazione), senza filtro
function renderCommsSocial(fisso = null) {
  if (CtrlSocial.conv === null) { loadSocial(); return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`; }
  if (CtrlSocial.errore) return `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlSocial.errore)}</div></div>`;
  const tutte = fisso ? CtrlSocial.conv.filter(c => c.social_account?.negozio === fisso.negozio && c.social_account?.piattaforma === fisso.piattaforma) : CtrlSocial.conv;
  if (fisso && CtrlSocial.sel && !tutte.some(c => c.id === CtrlSocial.sel)) { CtrlSocial.sel = null; CtrlSocial.msgs = null; }
  const filtri = [[null, 'Tutte'], ['da_leggere', 'Da leggere'], ['instagram', 'Instagram'], ['messenger', 'Facebook'],
    ...SOCIAL_NEGOZI.map(n => [n.id, n.label])];
  const passa = (c, f) => !f ? true : f === 'da_leggere' ? c.da_leggere
    : (f === 'instagram' || f === 'messenger') ? c.social_account?.piattaforma === f : c.social_account?.negozio === f;
  const lista = fisso ? tutte : tutte.filter(c => passa(c, CtrlSocial.filtro));
  const negozio = (c) => SOCIAL_NEGOZI.find(n => n.id === c.social_account?.negozio)?.label || c.social_account?.username || '';
  const sel = tutte.find(c => c.id === CtrlSocial.sel);
  const errori = [...new Map(tutte.concat([]).map(c => c.social_account).filter(a => a?.ultimo_errore).map(a => [a.id, a])).values()];

  const riga = (c) => `
    <button type="button" class="soc-row ${c.id === CtrlSocial.sel ? 'is-sel' : ''} ${c.da_leggere ? 'is-new' : ''}" onclick="apriSocial('${c.id}')">
      <span class="soc-row-top">
        <strong>${escapeHtml(c.utente_nome || 'Cliente')}</strong>
        <small>${ctrlFmtQuando(c.ultimo_at)}</small>
      </span>
      <small class="soc-row-sub">${SOCIAL_ICONA[c.social_account?.piattaforma] || ''} · ${escapeHtml(negozio(c))}</small>
      <span class="soc-row-text">${c.ultimo_da === 'noi' ? '<em>Tu:</em> ' : ''}${escapeHtml((c.ultimo_testo || '').slice(0, 140))}</span>
    </button>`;

  const ultimoCliente = (CtrlSocial.msgs || []).filter(m => m.direzione === 'in').pop();
  const scaduta = ultimoCliente && Date.now() - new Date(ultimoCliente.at).getTime() > 24 * 3600_000;
  const thread = !sel ? `<div class="soc-empty">Scegli una conversazione</div>` : `
    <div class="soc-thread-head">
      <strong>${escapeHtml(sel.utente_nome || 'Cliente')}</strong>
      <small>${SOCIAL_ICONA[sel.social_account?.piattaforma] || ''} · ${escapeHtml(negozio(sel))}</small>
    </div>
    <div class="soc-thread-body">
      ${CtrlSocial.msgs === null ? '<div class="soc-empty">Caricamento…</div>'
        : CtrlSocial.msgs.map(m => `
          <div class="soc-msg ${m.direzione === 'out' ? 'is-out' : ''}">
            ${m.testo ? `<p>${escapeHtml(m.testo)}</p>` : ''}
            ${(m.allegati || []).length ? `<p class="soc-att">📎 ${(m.allegati || []).length === 1 ? 'Allegato' : `${m.allegati.length} allegati`} (aprilo da Meta Business Suite)</p>` : ''}
            <small>${ctrlFmtQuando(m.at)}</small>
          </div>`).join('')}
    </div>
    <form class="soc-reply" onsubmit="inviaSocial(event)">
      ${scaduta ? `<div class="soc-warn">Sono passate più di 24 ore dall'ultimo messaggio del cliente: Meta potrebbe non consegnare la risposta.</div>` : ''}
      <textarea id="soc-testo" class="form-input" rows="3" maxlength="2000" placeholder="Scrivi la risposta…" aria-label="Risposta"></textarea>
      <button id="soc-invia" class="ctrl-btn is-primary" type="submit">Invia</button>
    </form>`;

  return `
    ${errori.map(a => `<div class="glass-card page-card soc-alert"><strong>${escapeHtml(a.username)}</strong>: ${escapeHtml(a.ultimo_errore)}</div>`).join('')}
    <section class="glass-card page-card soc-box">
      <div class="soc-list">
        <div class="soc-list-head">
          ${fisso ? `<span class="soc-list-title">${lista.length} conversazioni · ${lista.filter(c => c.da_leggere).length} da leggere</span>` : `<select class="ctrl-assign" aria-label="Filtro" onchange="setSocialFiltro(this.value || null)">
            ${filtri.map(([id, label]) => `<option value="${id || ''}" ${CtrlSocial.filtro === id ? 'selected' : ''}>${escapeHtml(label)}${id === 'da_leggere' ? ` (${tutte.filter(c => c.da_leggere).length})` : ''}</option>`).join('')}
          </select>`}
          <button class="ctrl-btn" ${CtrlSocial.sync ? 'disabled' : ''} onclick="aggiornaSocial()">${CtrlSocial.sync ? '…' : '↻ Aggiorna'}</button>
        </div>
        <div class="soc-list-body">${lista.length ? lista.map(riga).join('') : '<div class="soc-empty">Nessuna conversazione</div>'}</div>
      </div>
      <div class="soc-thread">${thread}</div>
    </section>`;
}

// ── Cervello: regole dei brand, tipi di task, mail scartate, correzioni ──

const REGOLE_SEZIONI = [
  { id: 'spedizioni', label: 'Spedizioni', voci: [['corriere', 'Corriere'], ['preparazione', 'Tempi di preparazione'], ['consegna', 'Tempi di consegna'], ['costi', 'Costi di spedizione'], ['gratuita', 'Spedizione gratuita'], ['destinazioni', 'Dove spediamo'], ['tracking', 'Tracking']] },
  { id: 'resi', label: 'Resi', voci: [['tempo', 'Tempo per chiedere il reso'], ['condizioni', 'Condizioni'], ['esclusi', 'Articoli esclusi'], ['come', 'Come si chiede'], ['indirizzo', 'Indirizzo per i resi'], ['costi', 'Chi paga la spedizione del reso']] },
  { id: 'cambi', label: 'Cambi', voci: [['possibile', 'Si può cambiare?'], ['come', 'Come funziona']] },
  { id: 'rimborsi', label: 'Rimborsi', voci: [['tempi', 'Tempi'], ['metodo', 'Metodo'], ['trattenute', 'Trattenute']] },
  { id: 'ordini', label: 'Ordini', voci: [['modifiche', 'Modifiche e annullamenti'], ['danni', 'Prodotto danneggiato o sbagliato'], ['minimo', 'Quantità minima'], ['personalizzati', 'Prodotti personalizzati']] },
  { id: 'assistenza', label: 'Assistenza', voci: [['orari', 'Orari'], ['firma', 'Firma delle mail'], ['tono', 'Tono delle risposte']] },
];

// Brand con le regole: i negozi Shopify più T&C Factory e Live Printing (sezioni: solo quelle elencate)
const REGOLE_BRAND = [
  ...TASK_MACROAREE,
  { id: 'liveprinting', label: 'Live Printing', color: '#ef4123' },
  { id: 'tcfactory',    label: 'T&C Factory',   color: '#d49c6b', sezioni: ['spedizioni'] },
];
const regoleBrand = (id) => REGOLE_BRAND.find(b => b.id === id);
const regoleSezioni = (id) => REGOLE_SEZIONI.filter(s => !regoleBrand(id)?.sezioni || regoleBrand(id).sezioni.includes(s.id));

const CtrlBrain = { sez: 'regole', negozio: TASK_MACROAREE[0].id, regole: null, modificato: false };

async function loadBrainRules() {
  const { data, error } = await supabaseClient.from('negozi_conoscenza').select('store_id, campi, aggiornato_at, aggiornato_da');
  CtrlBrain.regole = error ? {} : Object.fromEntries((data || []).map(r => [r.store_id, r]));
  refreshControlPage();
}

async function setBrainSection(id) {
  if (!(await leaveRulesOk())) return;
  CtrlBrain.sez = id;
  refreshControlPage();
  if (id === 'tempi') loadTempiLavorazione();
}

async function setBrainStore(id) {
  if (!(await leaveRulesOk())) return;
  CtrlBrain.negozio = id;
  refreshControlPage();
}

async function leaveRulesOk() {
  if (CtrlBrain.modificato && !(await uiConfirm('Ci sono modifiche non salvate alle regole. Uscire senza salvare?', { ok: 'Esci senza salvare', danger: true }))) return false;
  CtrlBrain.modificato = false;
  return true;
}

function renderControlBrain() {
  const sezioni = [['regole', 'Regole dei brand'], ['tipi', 'Tipi di task'], ['tempi', 'Tempi di lavorazione'], ['scartate', `Mail scartate · ${ShopLinks.scartate.length}`], ['correzioni', `Correzioni · ${ShopLinks.regole.length}`]];
  const body = CtrlBrain.sez === 'tipi' ? renderControlTypes()
    : CtrlBrain.sez === 'tempi' ? renderTempiLavorazione()
    : CtrlBrain.sez === 'scartate' ? renderBrainDiscarded()
    : CtrlBrain.sez === 'correzioni' ? renderBrainCorrections()
    : renderBrainRules();
  return `
    <div class="ctrl-bar">
      <div class="segmented" role="tablist" aria-label="Sezione del cervello">
        ${sezioni.map(([id, label]) => `<button role="tab" aria-selected="${CtrlBrain.sez === id}" class="${CtrlBrain.sez === id ? 'active' : ''}" onclick="setBrainSection('${id}')">${label}</button>`).join('')}
      </div>
    </div>
    ${body}`;
}

function renderBrainRules() {
  if (!CtrlBrain.regole) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const r = CtrlBrain.regole[CtrlBrain.negozio] || {};
  const c = r.campi || {};
  const riga = (sez, [k, label]) => {
    const key = `${sez.id}.${k}`;
    return `
      <label class="ctrl-rule">
        <span>${label}</span>
        <textarea class="form-textarea" rows="1" data-rule="${key}" placeholder="Non indicato"
          oninput="ctrlGrow(this);CtrlBrain.modificato=true">${escapeHtml(c[key] || '')}</textarea>
      </label>`;
  };
  return `
    <div class="ctrl-macro-bar ctrl-rule-stores" role="group" aria-label="Brand">
      ${REGOLE_BRAND.map(m => ctrlFilter(CtrlBrain.negozio === m.id, m.label, null, m.color, `setBrainStore('${m.id}')`)).join('')}
    </div>
    <form onsubmit="event.preventDefault();saveBrainRules()">
      <div class="ctrl-rules">
        ${regoleSezioni(CtrlBrain.negozio).map(sez => `
          <section class="glass-card page-card">
            <div class="page-card-head"><h2>${sez.label}</h2></div>
            <div class="ctrl-rule-list">${sez.voci.map(v => riga(sez, v)).join('')}</div>
          </section>`).join('')}
        <section class="glass-card page-card">
          <div class="page-card-head"><h2>Altre regole</h2>
            <button type="button" class="ctrl-btn" style="margin-left:auto;" onclick="addBrainRule()">${Icons.plus(13)} Aggiungi</button></div>
          <div class="ctrl-rule-list" id="ctrl-rule-extra">
            ${(c.altre || []).map(ctrlExtraRule).join('')}
          </div>
        </section>
      </div>
      <div class="ctrl-rule-save">
        <span class="settings-section-hint" style="margin:0;">Il cervello usa solo questi dati. Se un campo è vuoto, la bozza non cita quel dato.${r.aggiornato_da ? ` Ultima modifica: ${escapeHtml(r.aggiornato_da)}, ${ctrlFmtQuando(r.aggiornato_at)}.` : ''}</span>
        <button class="ctrl-btn is-primary" id="rules-save" type="submit">Salva le regole di ${regoleBrand(CtrlBrain.negozio)?.label || CtrlBrain.negozio}</button>
      </div>
    </form>`;
}

const ctrlExtraRule = (x = {}) => `
  <div class="ctrl-rule ctrl-rule-extra">
    <input class="form-input" data-extra="voce" value="${escapeHtml(x.voce || '')}" placeholder="Argomento" oninput="CtrlBrain.modificato=true">
    <textarea class="form-textarea" rows="1" data-extra="valore" placeholder="Regola" oninput="ctrlGrow(this);CtrlBrain.modificato=true">${escapeHtml(x.valore || '')}</textarea>
    <button type="button" class="btn-icon" aria-label="Togli" onclick="this.parentElement.remove();CtrlBrain.modificato=true">${Icons.x(14)}</button>
  </div>`;

function ctrlGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function addBrainRule() {
  const box = document.getElementById('ctrl-rule-extra');
  box.insertAdjacentHTML('beforeend', ctrlExtraRule());
  box.lastElementChild.querySelector('input').focus();
}

// Il cervello legge la versione testuale, ricostruita a ogni salvataggio
function brainRulesText(campi) {
  const blocchi = REGOLE_SEZIONI.map(sez => {
    const righe = sez.voci.filter(([k]) => campi[`${sez.id}.${k}`]).map(([k, label]) => `- ${label}: ${campi[`${sez.id}.${k}`]}`);
    return righe.length ? `${sez.label.toUpperCase()}\n${righe.join('\n')}` : '';
  });
  if (campi.altre?.length) blocchi.push(`ALTRE REGOLE\n${campi.altre.map(x => `- ${x.voce}: ${x.valore}`).join('\n')}`);
  return blocchi.filter(Boolean).join('\n\n');
}

async function saveBrainRules() {
  const campi = {};
  document.querySelectorAll('[data-rule]').forEach(el => { if (el.value.trim()) campi[el.dataset.rule] = el.value.trim(); });
  const altre = [...document.querySelectorAll('.ctrl-rule-extra')].map(r => ({
    voce: r.querySelector('[data-extra="voce"]').value.trim(), valore: r.querySelector('[data-extra="valore"]').value.trim(),
  })).filter(x => x.voce && x.valore);
  if (altre.length) campi.altre = altre;
  const btn = document.getElementById('rules-save');
  btn.disabled = true;
  const { error } = await supabaseClient.from('negozi_conoscenza').upsert({
    store_id: CtrlBrain.negozio, campi, testo: brainRulesText(campi),
    aggiornato_at: new Date().toISOString(), aggiornato_da: Ctrl._me(),
  });
  btn.disabled = false;
  if (error) { showToast(Ctrl._fail(error).message, 'error'); return; }
  CtrlBrain.modificato = false;
  showToast('Regole salvate');
  await loadBrainRules();
}

function renderBrainDiscarded() {
  if (!ShopLinks.scartate.length) return `<div class="glass-card page-card"><div class="empty-list">Nessuna mail scartata.</div></div>`;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Mail scartate</h2><span class="ctrl-group-hint">Spam, phishing e mail senza richieste. Se una era di un cliente, recuperala: il cervello imparerà.</span></div>
      <div class="task-list">${ShopLinks.scartate.map(e => `
        <article class="task-row ctrl-order" style="--p:${taskMacro(e.account)?.color || '#94a3b8'};">
          <div class="task-main" style="cursor:default;">
            <span class="task-title">${escapeHtml(e.payload?.oggetto || '(senza oggetto)')}</span>
            <span class="task-meta"><span class="ctrl-macro-tag" style="--m:${taskMacro(e.account)?.color || '#94a3b8'};">${escapeHtml(shopNome(e.account))}</span><span aria-hidden="true"> · </span>${escapeHtml(e.payload?.da || '')}<span aria-hidden="true"> · </span>${ctrlFmtQuando(e.elaborato_at)}</span>
            <span class="ctrl-row-text">${escapeHtml((e.esito || '').replace(/^Scartata[^:]*:\s*/, ''))}</span>
          </div>
          <button class="ctrl-btn" onclick="recoverDiscarded('${e.id}')">Recupera</button>
        </article>`).join('')}</div>
    </section>`;
}

function renderBrainCorrections() {
  if (!ShopLinks.regole.length) return `<div class="glass-card page-card"><div class="empty-list">Nessuna correzione. Si creano col pulsante "È spam" nei task e recuperando una mail scartata.</div></div>`;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Correzioni</h2><span class="ctrl-group-hint">Valgono anche per mail simili da mittenti nuovi</span></div>
      <div class="task-list">${ShopLinks.regole.map(r => `
        <article class="task-row ctrl-order" style="--p:${r.azione === 'scarta' ? '#ef4444' : '#22c55e'};">
          <div class="task-main" style="cursor:default;">
            <span class="task-title">${escapeHtml(r.mittente)}</span>
            <span class="task-meta">${r.azione === 'scarta' ? 'Sempre spam' : 'Mittente vero'}${r.creato_da ? `<span aria-hidden="true"> · </span>${escapeHtml(r.creato_da)}` : ''}</span>
            ${r.esempio ? `<span class="ctrl-row-text">${escapeHtml(r.esempio.slice(0, 140))}</span>` : ''}
          </div>
          <button class="btn-icon" onclick="removeMailRule('${escapeHtml(r.mittente)}')" aria-label="Togli la correzione">${Icons.trash()}</button>
        </article>`).join('')}</div>
    </section>`;
}

// ── Tempi di lavorazione per categoria e prova dei tempi ──

const CtrlTempi = { categorie: null, prova: null, error: null };

async function loadTempiLavorazione() {
  try {
    const [cat, prova] = await Promise.all([
      supabaseClient.from('tempi_categorie').select('*').order('ordine').order('id'),
      Ctrl._rpc('tc_tempi_test'),
    ]);
    if (cat.error) throw Ctrl._fail(cat.error);
    CtrlTempi.categorie = cat.data || [];
    CtrlTempi.prova = prova;
    CtrlTempi.error = null;
  } catch (e) { CtrlTempi.error = e; }
  refreshControlPage();
}

const tempiFmtSec = (sec) => {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}″`;
  const m = Math.floor(sec / 60), r = sec % 60;
  return m >= 60 ? ctrlFmtMin(m) : `${m}′${r ? ` ${r}″` : ''}`;
};
const tempiScarto = (stima, reale) => {
  if (!stima) return '<span class="ctrl-cell-sub">—</span>';
  const p = Math.round((reale - stima) / stima * 100);
  return `<span class="tempi-scarto ${Math.abs(p) <= 15 ? 'is-ok' : p > 0 ? 'is-over' : 'is-under'}">${p > 0 ? '+' : ''}${p}%</span>`;
};

function renderTempiLavorazione() {
  if (CtrlTempi.error) return `<div class="glass-card page-card"><div class="empty-list">${CtrlTempi.error.notInstalled ? 'Esegui lo script <strong>sql/tempi-lavorazione.sql</strong> su Supabase.' : escapeHtml(CtrlTempi.error.message)}</div></div>`;
  if (!CtrlTempi.categorie) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const cats = CtrlTempi.categorie, pr = CtrlTempi.prova || {}, test = Ctrl.tempiTest || {};
  const lotti = pr.lotti || [], senza = pr.senza_categoria || [], fasi = pr.fasi || [];
  // Fasi per tipo e ordini con il tempo di tutte le loro fasi misurate
  const perTipo = {}, perOrdine = {};
  fasi.forEach(f => {
    const t = perTipo[f.tipo] ||= { n: 0, stima: 0, reale: 0 };
    t.n++; t.stima += f.stima_sec; t.reale += f.reale_sec;
    if (!f.ordine) return;
    const o = perOrdine[f.ordine] ||= { nome: f.ordine_nome, fasi: [], reale: 0, stima: 0, at: f.at };
    o.fasi.push(f.tipo); o.reale += f.reale_sec; o.stima += f.stima_sec; if (f.at > o.at) o.at = f.at;
  });
  const ordini = Object.values(perOrdine).sort((a, b) => b.at.localeCompare(a.at));

  const righe = cats.map(c => `
    <tr>
      <td><input class="form-input" value="${escapeHtml(c.nome)}" maxlength="60" aria-label="Nome" onchange="saveTempoCategoria(${c.id}, 'nome', this.value)"></td>
      <td><input class="form-input" value="${escapeHtml((c.inizia_con || []).join(', '))}" aria-label="Il titolo inizia con" placeholder="es. calzin, calzino"
        onchange="saveTempoCategoria(${c.id}, 'inizia_con', this.value)"></td>
      <td><input class="form-input tempi-num" type="number" min="0" max="3600" value="${c.secondi}" aria-label="Secondi a stampa" onchange="saveTempoCategoria(${c.id}, 'secondi', this.value)"></td>
      <td><input class="form-input tempi-num" type="number" min="1" max="10" value="${c.stampe}" aria-label="Stampe per capo" onchange="saveTempoCategoria(${c.id}, 'stampe', this.value)"></td>
      <td class="tempi-capo">${tempiFmtSec(c.secondi * c.stampe)}</td>
      <td class="ctrl-cell-actions"><button class="btn-icon" onclick="removeTempoCategoria(${c.id})" aria-label="Elimina ${escapeHtml(c.nome)}">${Icons.trash()}</button></td>
    </tr>`).join('');

  // Confronto per categoria: solo i lotti con capi di una categoria sola
  const perCat = {};
  lotti.forEach(l => {
    const nomi = Object.keys(l.capi || {});
    if (nomi.length !== 1 || nomi[0] === 'Senza categoria') return;
    const c = cats.find(x => x.nome === nomi[0]); if (!c) return;
    const p = perCat[c.nome] ||= { lotti: 0, capi: 0, reale: 0, stima: 0 };
    p.lotti++; p.capi += l.capi[c.nome]; p.reale += l.reale_sec; p.stima += l.stima_sec;
  });
  const totStima = lotti.reduce((a, l) => a + l.stima_sec, 0), totReale = lotti.reduce((a, l) => a + l.reale_sec, 0);
  const capiTesto = (capi) => Object.entries(capi || {}).map(([k, v]) => `${v} ${escapeHtml(k.toLowerCase())}`).join(', ');

  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Tempi per categoria</h2><span class="table-count">${cats.length}</span>
        <span class="ctrl-group-hint">Stampa, applicazione DTF o lavorazione simile. Un prodotto è della categoria se il titolo inizia con una delle parole.</span></div>
      <div class="table-scroll"><table class="data-table tempi-table">
        <thead><tr><th>Categoria</th><th>Il titolo inizia con</th><th>Secondi a stampa</th><th>Stampe a capo</th><th>A capo</th><th><span class="sr-only">Azioni</span></th></tr></thead>
        <tbody>${righe}</tbody>
      </table></div>
      <div class="tempi-foot"><button class="ctrl-btn" onclick="addTempoCategoria()">${Icons.plus(14)} Aggiungi categoria</button>
        <span class="ctrl-cell-sub">La stima di un lotto "Lavorazione ordini" è la somma dei capi dei suoi ordini.</span></div>
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Prova dei tempi</h2>
        <span class="ctrl-group-hint">${test.attivo ? `In corso dal ${ctrlFmtGiorno(test.dal).toLowerCase()}` : test.dal ? `Ferma · risultati dal ${ctrlFmtGiorno(test.dal).toLowerCase()}` : 'Non avviata'}</span></div>
      <p class="tempi-help">Durante la prova, su tutti i task produttivi chi lavora preme <strong>Inizia</strong> (il task diventa suo) e <strong>Pausa</strong> se si ferma.
        Alla fine preme <strong>Fatto</strong> sul task: il cronometro si ferma e lo stato dell'ordine si aggiorna da solo (es. Stampa DTF → STAMPA giallo, Applicazione DTF → DTF verde).
        Se invece qualcuno preme il pulsante sull'ordine, il cronometro si ferma all'ora di quel clic. Il tempo misurato si confronta con la stima.</p>
      <div class="tempi-foot">
        ${test.attivo ? `<button class="ctrl-btn" onclick="setTempiTest(false)">${CtrlIcons.pause()} Ferma la prova</button>`
          : `<button class="ctrl-btn is-primary" onclick="setTempiTest(true)">${CtrlIcons.play()} ${test.dal ? 'Avvia una nuova prova' : 'Avvia la prova'}</button>`}
      </div>
      ${lotti.length ? `
        <div class="tempi-totale">
          <div><span>Lotti misurati</span><strong>${lotti.length}</strong></div>
          <div><span>Stima</span><strong>${tempiFmtSec(totStima)}</strong></div>
          <div><span>Tempo reale</span><strong>${tempiFmtSec(totReale)}</strong></div>
          <div><span>Scarto</span><strong>${tempiScarto(totStima, totReale)}</strong></div>
        </div>
        ${Object.keys(perCat).length ? `
          <h3 class="tempi-h3">Per categoria <span class="ctrl-cell-sub">· solo i lotti con capi di una categoria</span></h3>
          <div class="table-scroll"><table class="data-table tempi-table">
            <thead><tr><th>Categoria</th><th>Lotti</th><th>Capi</th><th>Stima a capo</th><th>Reale a capo</th><th>Scarto</th></tr></thead>
            <tbody>${Object.entries(perCat).map(([nome, p]) => `
              <tr><td><strong>${escapeHtml(nome)}</strong></td><td>${p.lotti}</td><td>${p.capi}</td>
                <td>${tempiFmtSec(p.stima / p.capi)}</td><td>${tempiFmtSec(p.reale / p.capi)}</td><td>${tempiScarto(p.stima, p.reale)}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}
        <h3 class="tempi-h3">Lotti</h3>
        <div class="table-scroll"><table class="data-table tempi-table">
          <thead><tr><th>Quando</th><th>Chi</th><th>Negozio</th><th>Capi</th><th>Stima</th><th>Reale</th><th>Scarto</th></tr></thead>
          <tbody>${lotti.map(l => `
            <tr><td>${ctrlFmtQuando(l.at)}</td><td>${escapeHtml(l.chi || '—')}</td><td>${escapeHtml(shopNome(l.negozio))}</td>
              <td>${capiTesto(l.capi)}<div class="ctrl-cell-sub">${l.ordini} ${l.ordini === 1 ? 'ordine' : 'ordini'}</div></td>
              <td>${tempiFmtSec(l.stima_sec)}</td><td>${tempiFmtSec(l.reale_sec)}</td><td>${tempiScarto(l.stima_sec, l.reale_sec)}</td></tr>`).join('')}</tbody>
        </table></div>`
      : test.dal ? `<div class="empty-list">Nessun lotto misurato finora.</div>` : ''}
      ${fasi.length ? `
        <h3 class="tempi-h3">Fasi degli ordini <span class="ctrl-cell-sub">· ${fasi.length} misurate</span></h3>
        <div class="table-scroll"><table class="data-table tempi-table">
          <thead><tr><th>Fase</th><th>Volte</th><th>Stima media</th><th>Reale media</th><th>Scarto</th></tr></thead>
          <tbody>${Object.entries(perTipo).sort((a, b) => b[1].n - a[1].n).map(([nome, t]) => `
            <tr><td><strong>${escapeHtml(nome)}</strong></td><td>${t.n}</td>
              <td>${tempiFmtSec(t.stima / t.n)}</td><td>${tempiFmtSec(t.reale / t.n)}</td><td>${tempiScarto(t.stima, t.reale)}</td></tr>`).join('')}</tbody>
        </table></div>
        ${ordini.length ? `
          <h3 class="tempi-h3">Per ordine <span class="ctrl-cell-sub">· somma delle fasi misurate</span></h3>
          <div class="table-scroll"><table class="data-table tempi-table">
            <thead><tr><th>Ordine</th><th>Fasi misurate</th><th>Stima</th><th>Reale</th><th>Scarto</th></tr></thead>
            <tbody>${ordini.map(o => `
              <tr><td><strong>${escapeHtml(o.nome || '—')}</strong></td><td>${escapeHtml(o.fasi.join(', '))}</td>
                <td>${tempiFmtSec(o.stima)}</td><td>${tempiFmtSec(o.reale)}</td><td>${tempiScarto(o.stima, o.reale)}</td></tr>`).join('')}</tbody>
          </table></div>` : ''}` : ''}
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Prodotti senza categoria</h2><span class="table-count">${senza.length}</span>
        <span class="ctrl-group-hint">Ordini degli ultimi 60 giorni: questi capi non hanno tempo nella stima</span></div>
      ${senza.length ? `<ul class="tempi-senza">${senza.map(x => `<li><span>${escapeHtml(x.titolo || '(senza titolo)')}</span><span class="ctrl-cell-sub">${x.capi} ${x.capi === 1 ? 'capo' : 'capi'}</span></li>`).join('')}</ul>`
        : `<div class="empty-list">Tutti i prodotti hanno una categoria.</div>`}
    </section>`;
}

async function saveTempoCategoria(id, campo, valore) {
  let v = valore;
  if (campo === 'inizia_con') v = valore.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (campo === 'secondi' || campo === 'stampe') v = parseInt(valore, 10);
  if (campo === 'nome' && !String(v).trim()) { showToast('Il nome non può essere vuoto', 'error'); return loadTempiLavorazione(); }
  if ((campo === 'secondi' && !(v >= 0 && v <= 3600)) || (campo === 'stampe' && !(v >= 1 && v <= 10))) {
    showToast(campo === 'secondi' ? 'Secondi tra 0 e 3600' : 'Stampe tra 1 e 10', 'error'); return loadTempiLavorazione();
  }
  const { error } = await supabaseClient.from('tempi_categorie').update({ [campo]: typeof v === 'string' ? v.trim() : v }).eq('id', id);
  if (error) showToast(Ctrl._fail(error).message, 'error'); else showToast('Tempo salvato, stime dei lotti aggiornate');
  loadTempiLavorazione();
}

async function addTempoCategoria() {
  const nome = (await uiPrompt('Nome della categoria', { placeholder: 'es. Canotta', ok: 'Aggiungi' }))?.trim();
  if (!nome) return;
  const ordine = Math.max(0, ...CtrlTempi.categorie.map(c => c.ordine)) + 1;
  const { error } = await supabaseClient.from('tempi_categorie').insert({ nome, inizia_con: [nome.toLowerCase()], secondi: 0, stampe: 1, ordine });
  if (error) showToast(error.code === '23505' ? 'Esiste già una categoria con questo nome' : Ctrl._fail(error).message, 'error');
  loadTempiLavorazione();
}

async function removeTempoCategoria(id) {
  const c = CtrlTempi.categorie.find(x => x.id === id);
  if (!(await uiConfirm(`Eliminare la categoria "${c?.nome}"? I suoi prodotti resteranno senza tempo.`, { ok: 'Elimina', danger: true }))) return;
  const { error } = await supabaseClient.from('tempi_categorie').delete().eq('id', id);
  if (error) showToast(Ctrl._fail(error).message, 'error');
  loadTempiLavorazione();
}

async function setTempiTest(attivo) {
  if (!attivo && !(await uiConfirm('Fermare la prova? Spariscono Inizia e Pausa dai lotti; i risultati restano.', { ok: 'Ferma la prova' }))) return;
  const value = attivo ? { attivo: true, dal: ctrlOggi() } : { ...Ctrl.tempiTest, attivo: false };
  const { error } = await supabaseClient.from('app_settings').upsert({ key: 'tempi_test', value, updated_at: new Date().toISOString() });
  if (error) { showToast(Ctrl._fail(error).message, 'error'); return; }
  Ctrl.tempiTest = value;
  showToast(attivo ? 'Prova dei tempi avviata' : 'Prova dei tempi fermata');
  loadTempiLavorazione();
}

// ── Collegamenti: solo lo stato ──

function renderControlLinks() {
  if (ShopLinks.error?.notInstalled) return `<div class="glass-card page-card"><div class="empty-list">Collegamento Shopify da attivare: esegui <strong>sql/shopify.sql</strong>.</div></div>`;
  if (!ShopLinks.negozi) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;

  const stato = (x) => !x.ultimo_sync_at ? ['In attesa', '#94a3b8'] : x.ultimo_errore ? ['Errore', '#ef4444'] : ['Attivo', '#22c55e'];
  const riga = (nome, sotto, x, dati, azione, busy) => {
    const [label, color] = stato(x);
    return `
      <tr>
        <td><strong>${escapeHtml(nome)}</strong><div class="ctrl-cell-sub">${escapeHtml(sotto)}</div>
          ${x.ultimo_errore ? `<div class="ctrl-shop-error">${escapeHtml(x.ultimo_errore)}</div>` : ''}</td>
        <td><span class="ctrl-status" style="--st:${color};">${label}</span></td>
        <td class="ctrl-cell-sub">${x.ultimo_sync_at ? ctrlFmtQuando(x.ultimo_sync_at) : '—'}</td>
        <td>${dati}</td>
        <td class="ctrl-cell-actions"><button class="ctrl-btn" ${busy ? 'disabled' : ''} onclick="${azione}">${busy ? '…' : '↻ Controlla'}</button></td>
      </tr>`;
  };
  const shopBusy = (id) => ShopLinks.syncing.has(id) || ShopLinks.syncing.has('*');
  const mailBusy = (id) => ShopLinks.syncing.has('mail:' + id) || ShopLinks.syncing.has('mail:*');
  const testa = `<thead><tr><th>Collegamento</th><th>Stato</th><th>Ultimo controllo</th><th>Dati</th><th><span class="sr-only">Azioni</span></th></tr></thead>`;

  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Negozi Shopify</h2><span class="ctrl-group-hint">Controllo automatico ogni 5 minuti</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links">${testa}<tbody>
        ${ShopLinks.negozi.map(n => riga(n.nome, n.dominio, n, `${n.da_evadere} ordini da evadere · ${n.in_consegna} ordini in consegna`, `syncShopify('${n.id}')`, shopBusy(n.id))).join('')}
      </tbody></table></div>
    </section>
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Caselle email</h2><span class="ctrl-group-hint">Controllo automatico ogni 5 minuti, in sola lettura</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links">${testa}<tbody>
        ${(ShopLinks.caselle || []).map(c => riga(c.indirizzo, c.nome, c, `${c.da_persone} da persone · ${c.ricevute - c.da_persone} automatiche`, `syncMail('${c.id}')`, mailBusy(c.id))).join('')}
      </tbody></table></div>
    </section>
    ${renderControlSocial()}
    ${renderControlServices()}`;
}

// ── Instagram e Pagine Facebook (app Meta "CS Direct Connect" e "CS Chat Connect", login per portfolio) ──
const META_APP = {
  instagram: { appId: '29503917439294554', configId: '1823367478810968', titolo: 'Instagram', cosa: 'Messaggi diretti e commenti dei profili dei negozi' },
  messenger: { appId: '1778695599875719', configId: '1676244014165843', titolo: 'Facebook · Messenger', cosa: 'Messaggi delle Pagine Facebook dei negozi' },
};
const SOCIAL_NEGOZI = [
  ...TASK_MACROAREE.filter(m => m.id !== 'asteroidi').map(m => ({ id: m.id, label: m.label })),
  { id: 'liveprinting', label: 'Live Printing' },
];

function renderControlSocial() {
  return renderSocialGruppo('instagram') + renderSocialGruppo('messenger');
}

function renderSocialGruppo(piattaforma) {
  const app = META_APP[piattaforma];
  const lista = ShopLinks.social;
  if (lista === null) return `<section class="glass-card page-card ctrl-group"><div class="page-card-head"><h2>${app.titolo}</h2></div>
    <div class="empty-list">Collegamento da attivare: esegui <strong>sql/meta-instagram.sql</strong>.</div></section>`;
  const conti = lista.filter(a => a.piattaforma === piattaforma);
  const riga = (a) => `
    <tr>
      <td><strong>${piattaforma === 'instagram' ? '@' : ''}${escapeHtml(a.username || a.account_id)}</strong><div class="ctrl-cell-sub">${escapeHtml(a.nome && a.nome !== a.username ? a.nome : '')}</div>
        ${a.ultimo_errore ? `<div class="ctrl-shop-error">${escapeHtml(a.ultimo_errore)}</div>` : ''}</td>
      <td><span class="ctrl-status" style="--st:${a.ultimo_errore ? '#ef4444' : '#22c55e'};">${a.ultimo_errore ? 'Errore' : 'Collegato'}</span></td>
      <td class="ctrl-cell-sub">${ctrlFmtQuando(a.collegato_at)}</td>
      <td><select class="ctrl-assign" aria-label="Negozio" onchange="socialNegozio('${a.id}', this.value)">
        <option value="">Negozio…</option>
        ${SOCIAL_NEGOZI.map(n => `<option value="${n.id}" ${a.negozio === n.id ? 'selected' : ''}>${escapeHtml(n.label)}</option>`).join('')}
      </select></td>
      <td class="ctrl-cell-actions"><button class="ctrl-btn" onclick="scollegaSocial('${a.id}')">Scollega</button></td>
    </tr>`;
  const cosa = piattaforma === 'instagram' ? 'i profili Instagram' : 'le Pagine Facebook';
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${app.titolo}</h2><span class="ctrl-group-hint">${app.cosa}</span>
        <button class="ctrl-btn" onclick="collegaMeta('${piattaforma}')">+ Collega</button></div>
      ${conti.length ? `<div class="table-scroll"><table class="data-table ctrl-links">
        <thead><tr><th>${piattaforma === 'instagram' ? 'Profilo' : 'Pagina'}</th><th>Stato</th><th>Collegato</th><th>Negozio</th><th><span class="sr-only">Azioni</span></th></tr></thead>
        <tbody>${conti.map(riga).join('')}</tbody></table></div>`
      : `<div class="empty-list">Nessun collegamento. Premi <strong>+ Collega</strong>: Meta collega un portfolio alla volta, nel login scegli ${cosa} da collegare.</div>`}
    </section>`;
}

async function collegaMeta(piattaforma) {
  const app = META_APP[piattaforma];
  if (!app.configId) { uiAlert(`Il collegamento ${app.titolo} non è ancora configurato su Meta.`); return; }
  try {
    const { data, error } = await supabaseClient.rpc('tc_meta_login_inizia', { p_piattaforma: piattaforma });
    if (error) throw Ctrl._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    const q = new URLSearchParams({
      client_id: app.appId, config_id: app.configId, display: 'page', override_default_response_type: 'true',
      redirect_uri: `${SUPABASE_URL}/functions/v1/meta-login`, response_type: 'code', state: data.state,
    });
    location.href = 'https://www.facebook.com/dialog/oauth?' + q;
  } catch (e) { showToast(e.message, 'error'); }
}

async function socialNegozio(id, negozio) {
  const { data, error } = await supabaseClient.rpc('tc_social_account_negozio', { p_id: id, p_negozio: negozio });
  if (error || !data?.success) { showToast(error?.message || data?.error || 'Errore', 'error'); return; }
  const a = (ShopLinks.social || []).find(x => x.id === id);
  if (a) a.negozio = negozio || null;
  showToast('Negozio salvato', 'success');
}

async function scollegaSocial(id) {
  const a = (ShopLinks.social || []).find(x => x.id === id);
  if (!(await uiConfirm(`Scollegare @${a?.username || ''} dal gestionale? Per ricollegarlo basta rifare il login.`, { ok: 'Scollega' }))) return;
  const { data, error } = await supabaseClient.rpc('tc_social_account_scollega', { p_id: id });
  if (error || !data?.success) { showToast(error?.message || data?.error || 'Errore', 'error'); return; }
  await loadShopifyLinks();
}

// Ritorno dal login Meta: #/controllo/collegamenti/<instagram|messenger>:ok:2 oppure :errore:<motivo>
function esitoLoginMeta(esito) {
  const [piattaforma, tipo, ...resto] = decodeURIComponent(esito || '').split(':');
  const nome = META_APP[piattaforma]?.titolo || 'Meta';
  if (tipo === 'ok') showToast(`${nome} collegato: ${resto[0]} account`, 'success');
  else if (tipo === 'errore') uiAlert(`Collegamento ${nome} non riuscito: ` + resto.join(':'));
}

// Servizi esterni (GLS, Claude, mappe, invio mail, Mac mini) e operazioni pianificate del database
const CRON_NOMI = {
  'shopify-sync': 'Ordini dai negozi Shopify',
  'mail-sync': 'Lettura delle caselle email',
  'cervello': 'Cervello: mail lette da Claude',
  'mail-riordina': 'Spam nel cestino, automatiche in archivio',
  'mail-risposte': 'Risposte dei clienti ai task',
  'ordini-dati': 'Richiesta dei dati mancanti per spedire',
  'task-automatici': 'Task automatici',
  'linea-produttiva': 'Linea produttiva',
  'ordini-fermi': 'Ordini fermi',
  'tracking-check': 'Tracking GLS delle spedizioni',
  'task-piano': 'Piano del giorno del team',
  'briefing': 'Briefing del mattino',
  'mattino-controllo': 'Controllo dell\'automazione del mattino',
};

function cronQuando(s) {
  const p = (s || '').split(' ');
  if (p.length !== 5) return s || '';
  const [min, ora, , , gg] = p;
  const giorni = gg === '*' ? '' : gg === '1-5' ? ', lun-ven' : gg === '1-6' ? ', lun-sab' : `, giorni ${gg}`;
  const m = min.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
  if (m && ora === '*') return `Ogni ${m[1]} minuti${giorni}`;
  if (/^\d+$/.test(min) && ora === '*') return `Ogni ora${giorni}`;
  if (/^\d+$/.test(min) && /^[\d,]+$/.test(ora)) {
    // pg_cron gira in UTC: orario italiano
    const d = new Date();
    const it = ora.split(',').map(h => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +h, +min)).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }));
    return `Alle ${it.join(' e ')}${giorni}`;
  }
  return s;
}

function renderControlServices() {
  const S = ShopLinks.servizi;
  if (!S) return `<section class="glass-card page-card ctrl-group"><div class="page-card-head"><h2>Servizi esterni</h2></div>
    <div class="empty-list">Stato non disponibile: esegui <strong>sql/collegamenti-servizi.sql</strong>.</div></section>`;
  const testa = `<thead><tr><th>Collegamento</th><th>Stato</th><th>Ultimo uso</th><th>Dati</th></tr></thead>`;
  const servizio = (x) => {
    const [label, color] = x.errore ? ['Errore', '#ef4444'] : !x.ultimo ? ['Mai usato', '#94a3b8'] : ['Attivo', '#22c55e'];
    return `
      <tr>
        <td><strong>${escapeHtml(x.nome)}</strong><div class="ctrl-cell-sub">${escapeHtml(x.sotto)}</div>
          ${x.errore ? `<div class="ctrl-shop-error">${escapeHtml(x.errore)}</div>` : ''}</td>
        <td><span class="ctrl-status" style="--st:${color};">${label}</span></td>
        <td class="ctrl-cell-sub">${x.ultimo ? ctrlFmtQuando(x.ultimo) : '—'}<div>${escapeHtml(x.ogni)}</div></td>
        <td>${escapeHtml(x.dati || '—')}</td>
      </tr>`;
  };
  const pianificata = (j) => {
    const [label, color] = !j.attiva ? ['Spenta', '#94a3b8'] : j.stato === 'failed' ? ['Errore', '#ef4444']
      : j.stato === 'succeeded' ? ['Attiva', '#22c55e'] : j.stato ? ['In corso', '#f59e0b'] : ['Mai partita', '#94a3b8'];
    return `
      <tr>
        <td><strong>${escapeHtml(CRON_NOMI[j.nome] || j.nome)}</strong><div class="ctrl-cell-sub">${escapeHtml(j.nome)}</div>
          ${j.messaggio ? `<div class="ctrl-shop-error">${escapeHtml(j.messaggio)}</div>` : ''}</td>
        <td><span class="ctrl-status" style="--st:${color};">${label}</span></td>
        <td class="ctrl-cell-sub">${j.ultimo ? ctrlFmtQuando(j.ultimo) : '—'}</td>
        <td>${escapeHtml(cronQuando(j.schedule))}</td>
      </tr>`;
  };
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Servizi esterni</h2><span class="ctrl-group-hint">Corrieri, intelligenza artificiale, mappe, invio mail e Mac mini</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links">${testa}<tbody>${S.servizi.map(servizio).join('')}</tbody></table></div>
    </section>
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Operazioni pianificate</h2><span class="ctrl-group-hint">Partono da sole dal database, orari italiani</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links"><thead><tr><th>Operazione</th><th>Stato</th><th>Ultima partenza</th><th>Quando</th></tr></thead>
        <tbody>${S.pianificate.map(pianificata).join('')}</tbody></table></div>
    </section>`;
}

// ─────────────────────────────────────────────
// PIANO DEL GIORNO (admin)
// ─────────────────────────────────────────────

async function distributeQueue() {
  if (!(await uiConfirm('Distribuire ora la coda comune tra gli operatori attivi?', { ok: 'Distribuisci' }))) return;
  try {
    const data = await Ctrl._rpc('tc_task_distribuisci');
    showToast(data.assegnati ? `${data.assegnati} task assegnati` : 'Nessun task assegnato: niente in coda o minuti esauriti');
    await Ctrl.load();
    refreshControlPage();
  } catch (e) { showToast(e.message, 'error'); }
}

// Tabella del team: chi entra nel piano, i suoi minuti e quante competenze segue come primario o secondario
function renderTeamTable(people) {
  const riga = (nick) => {
    const o = Ctrl.operatori.find(x => x.nickname === nick) || {};
    const voci = Object.values(Ctrl.responsabili);
    const prim = voci.filter(r => r.primario === nick).length, sec = voci.filter(r => r.secondario === nick).length;
    const attivo = o.attivo !== false;
    const pr = (Presenze.stato?.tutti || []).find(x => x.nickname === nick);
    const presenza = !pr ? '<span class="ctrl-cell-sub">—</span>'
      : pr.confermato_at ? `<span class="ctrl-status" style="--st:#22c55e;">Dalle ${ctrlFmtOra(pr.confermato_at)}</span>${pr.confermato_da !== nick ? `<div class="ctrl-cell-sub">da ${escapeHtml(pr.confermato_da)}</div>` : ''}`
      : pr.scaduto ? '<span class="task-late">Non confermata</span>' : '<span class="ctrl-cell-sub">In attesa</span>';
    return `
      <tr>
        <td><strong>${escapeHtml(nick)}</strong></td>
        <td>${attivo ? '<span class="ctrl-status" style="--st:#22c55e;">Sì</span>' : '<span class="ctrl-cell-sub">No</span>'}</td>
        <td>${!attivo ? '<span class="ctrl-cell-sub">—</span>' : nick === 'claude' ? 'Senza limite' : ctrlFmtMin(o.minuti_giorno || 420)}</td>
        <td>${prim || sec ? `${prim} primario · ${sec} secondario` : '<span class="ctrl-cell-sub">Nessuna competenza</span>'}</td>
        <td>${o.ora_inizio ? o.ora_inizio.slice(0, 5) : '<span class="ctrl-cell-sub">—</span>'}${o.addetto_presenze ? '<div class="ctrl-cell-sub">addetto presenze</div>' : ''}</td>
        <td>${presenza}</td>
        <td class="ctrl-cell-actions"><button class="ctrl-btn" onclick="openMemberForm('${escapeHtml(nick)}')">Piano</button></td>
      </tr>`;
  };
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Team</h2><span class="table-count">${people.length}</span>
        <span class="ctrl-group-hint">Le competenze si assegnano dalla scheda Competenze</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links">
        <thead><tr><th>Persona</th><th>Nel piano</th><th>Tempo al giorno</th><th>Competenze</th><th>Entrata</th><th>Presenza oggi</th><th><span class="sr-only">Azioni</span></th></tr></thead>
        <tbody>${people.map(riga).join('')}</tbody>
      </table></div>
    </section>
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Rete del posto di lavoro</h2><span class="table-count">${(Ctrl.reti || []).length}</span>
        <span class="ctrl-group-hint">La presenza si conferma solo da queste reti</span></div>
      ${(Ctrl.reti || []).length ? `<ul class="tempi-senza">${(Ctrl.reti || []).map(r => `
        <li><span>${escapeHtml(r.nome || r.rete)}${r.nome ? ` <span class="ctrl-cell-sub">${escapeHtml(r.rete)}</span>` : ''}</span>
          <button class="btn-icon" onclick="removeRetePresenze('${escapeHtml(r.rete)}')" aria-label="Togli la rete">${Icons.trash()}</button></li>`).join('')}</ul>`
        : `<div class="empty-list">Nessuna rete: finché non ne aggiungi una, nessuno può confermare la presenza.</div>`}
      <div class="tempi-foot"><button class="ctrl-btn" onclick="addRetePresenze()">${Icons.plus(14)} Aggiungi la rete di questo dispositivo</button>
        <span class="ctrl-cell-sub">Da usare quando sei collegato al Wi-Fi del laboratorio.</span></div>
    </section>`;
}

// Scheda Competenze: per ogni competenza il primario (giallo) e il secondario (bordo giallo).
// Una competenza con primario claude è un'automazione.
const skillRuolo = (voce, nick) => {
  const r = Ctrl.responsabili[voce];
  return r?.primario === nick ? 'primario' : r?.secondario === nick ? 'secondario' : '';
};
const SKILL_CLASSE = { primario: 'is-primary', secondario: 'is-secondary' };

function renderControlSkills() {
  const fuoriPiano = Ctrl.users.filter(nick => Ctrl.operatori.find(o => o.nickname === nick)?.attivo === false);
  const pulsante = (voce, nick) => {
    const ruolo = skillRuolo(voce, nick);
    return `<button type="button" class="ctrl-btn ${SKILL_CLASSE[ruolo] || ''}" aria-pressed="${!!ruolo}"
      aria-label="${escapeHtml(nick)}${ruolo ? `: ${ruolo}` : ''}"
      data-nick="${escapeHtml(nick)}" data-voce="${voce}" onclick="toggleSkillOwner(this)">${escapeHtml(nick)}</button>`;
  };
  const riga = (a, c) => {
    const voce = `${a.id}:${c}`;
    // Claude non verifica sé stesso
    const persone = ['automazioni', 'sviluppo'].includes(a.id) ? Ctrl.users.filter(nick => nick !== 'claude') : Ctrl.users;
    return `<tr class="${Ctrl.responsabili[voce]?.primario === 'claude' ? 'is-auto' : ''}">
      <th scope="row"><strong>${a.etichette?.[c] || competenzaLabel(c)}</strong><span class="ctrl-auto-tag">${Icons.zap(11)} Automazione</span></th>
      <td><div class="ctrl-skill-people">${persone.map(nick => pulsante(voce, nick)).join('') || '<span class="ctrl-cell-sub">Nessuno nel team</span>'}</div></td></tr>`;
  };
  return `
    <section class="glass-card page-card ctrl-group ctrl-skills-help">
      <div class="ctrl-skill-people" aria-hidden="true">
        <span class="ctrl-btn is-primary">Primario</span><span class="ctrl-btn is-secondary">Secondario</span>
        <span class="ctrl-auto-tag is-on">${Icons.zap(11)} Automazione</span>
      </div>
      <p>Il primo clic su una persona la rende primario, il secondo clic su un'altra la rende secondario; un clic su chi è evidenziato lo toglie.
        Se il primario è in ferie o a un evento il task passa al secondario; se manca anche lui resta in coda comune.
        Un clic su claude rende la competenza un'automazione: se non funziona, il task passa al secondario e nasce un task di verifica nell'area Automazioni. Quando chi verifica segna Fatto, i task non ancora iniziati tornano a Claude.
        Tutti, Claude compreso, lavorano da lunedì a venerdì: fermi nei festivi e nelle chiusure del Planner.
        ${fuoriPiano.length ? `Fuori dal piano del giorno: ${fuoriPiano.map(escapeHtml).join(', ')}.` : ''}</p>
    </section>
    ${TASK_AREE.map(a => `
    <section class="glass-card page-card ctrl-group ctrl-skill-section">
      <div class="page-card-head"><h2>${a.label}</h2><span class="table-count">${a.competenze.length}</span></div>
      <div class="table-scroll"><table class="data-table ctrl-skills-list">
        <tbody>${a.competenze.map(c => riga(a, c)).join('')}</tbody>
      </table></div>
    </section>`).join('')}`;
}

// Chi è evidenziato si toglie; gli altri occupano il posto da primario se è libero, altrimenti quello da secondario.
// Claude va sempre primario: chi lo era diventa secondario, se il posto è libero.
// I salvataggi vanno in fila, così con più clic di seguito vince sempre l'ultimo.
function toggleSkillOwner(btn) {
  const { nick, voce } = btn.dataset;
  const r = { voce, primario: null, secondario: null, ...Ctrl.responsabili[voce] };
  const ruolo = skillRuolo(voce, nick);
  if (ruolo) r[ruolo] = null;
  else if (nick === 'claude') { r.secondario = r.secondario || r.primario; r.primario = nick; }
  else if (!r.primario) r.primario = nick;
  else r.secondario = nick;
  Ctrl.responsabili[voce] = r;
  btn.closest('tr').classList.toggle('is-auto', r.primario === 'claude');
  btn.closest('.ctrl-skill-people').querySelectorAll('button').forEach(b => {
    const q = skillRuolo(voce, b.dataset.nick);
    b.classList.toggle('is-primary', q === 'primario');
    b.classList.toggle('is-secondary', q === 'secondario');
    b.setAttribute('aria-pressed', !!q);
    b.setAttribute('aria-label', b.dataset.nick + (q ? `: ${q}` : ''));
  });
  Ctrl._skillSave = (Ctrl._skillSave || Promise.resolve()).then(async () => {
    try {
      const { error } = await supabaseClient.from('competenze_responsabili').upsert(r);
      if (error) throw Ctrl._fail(error);
    } catch (e) {
      showToast(e.message, 'error');
      await Ctrl.load();   // rimette a video quello che è davvero salvato
      refreshControlPage();
    }
  });
}

function openMemberForm(nick) {
  const o = Ctrl.operatori.find(x => x.nickname === nick) || {};
  ctrlModal(`
    ${ctrlModalHead(`Piano di ${escapeHtml(nick)}`)}
    <form class="modal-body" style="gap:14px;" onsubmit="event.preventDefault();submitMemberForm('${escapeHtml(nick)}')">
      <label class="switch-row" style="padding:0;">
        <span><strong>Nel piano del giorno</strong><small>Riceve i task delle sue competenze ogni mattina</small></span>
        <input id="mb-attivo" type="checkbox" class="switch" ${o.attivo !== false ? 'checked' : ''}>
      </label>
      ${nick === 'claude' ? '' : `<div class="form-group">
        <label class="form-label" for="mb-minuti">Minuti di lavoro al giorno</label>
        <input id="mb-minuti" type="number" class="form-input" min="30" max="720" value="${o.minuti_giorno || 420}">
      </div>
      <div class="form-group">
        <label class="form-label" for="mb-entrata">Orario di entrata</label>
        <input id="mb-entrata" type="time" class="form-input" value="${o.ora_inizio ? o.ora_inizio.slice(0, 5) : ''}">
        <small class="ctrl-cell-sub">Vuoto: non deve confermare la presenza. Dopo 30 minuti senza conferma si apre il popup.</small>
      </div>
      <label class="switch-row" style="padding:0;">
        <span><strong>Addetto alle presenze</strong><small>Può confermare la presenza degli altri e riceve il popup di chi non ha confermato</small></span>
        <input id="mb-addetto" type="checkbox" class="switch" ${o.addetto_presenze ? 'checked' : ''}>
      </label>`}
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal('${CTRL_MODAL}')">Annulla</button>
        <button type="submit" class="btn btn-primary" id="mb-save">Salva</button>
      </div>
    </form>`, 460);
}

async function submitMemberForm(nick) {
  const minuti = document.getElementById('mb-minuti');
  const row = { nickname: nick, attivo: document.getElementById('mb-attivo').checked };
  if (minuti) row.minuti_giorno = Math.min(720, Math.max(30, parseInt(minuti.value, 10) || 420));
  if (minuti) {
    row.ora_inizio = document.getElementById('mb-entrata').value || null;
    row.addetto_presenze = document.getElementById('mb-addetto').checked;
  }
  const btn = document.getElementById('mb-save');
  btn.disabled = true;
  const { error } = await supabaseClient.from('task_operatori').upsert(row);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); btn.disabled = false; return; }
  closeModal(CTRL_MODAL);
  showToast('Piano salvato');
  await Ctrl.load();
  refreshControlPage();
}

async function addRetePresenze() {
  const nome = await uiPrompt('Nome della rete', { placeholder: 'es. Wi-Fi laboratorio', ok: 'Aggiungi' });
  if (nome === null) return;
  try {
    const r = await Ctrl._rpc('tc_presenze_rete_aggiungi', { p_nome: nome.trim() });
    showToast(`Rete aggiunta: ${r.rete}`);
    await Ctrl.load(); refreshControlPage(); Presenze.check();
  } catch (e) { showToast(e.message, 'error'); }
}

async function removeRetePresenze(rete) {
  if (!(await uiConfirm(`Togliere la rete ${rete}? Da lì non si potrà più confermare la presenza.`, { ok: 'Togli', danger: true }))) return;
  const { error } = await supabaseClient.from('presenze_reti').delete().eq('rete', rete);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); return; }
  await Ctrl.load(); refreshControlPage(); Presenze.check();
}

async function removeMailRule(mittente) {
  if (!(await uiConfirm(`Togliere la correzione per ${mittente}?`, { ok: 'Togli', danger: true }))) return;
  const { error } = await supabaseClient.from('mail_regole').delete().eq('mittente', mittente);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); return; }
  await loadShopifyLinks();
}

// ─────────────────────────────────────────────
// REPORT (admin)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// AUTOMAZIONI (admin): ogni esecuzione con il suo output
// ─────────────────────────────────────────────

const AUTOMAZIONI = {
  mattino: { nome: 'DDT e file di stampa', quando: 'Giorni lavorativi alle 5:00' },
  pulizia: { nome: 'Pulizia della cartella', quando: 'Domenica alle 23:59' },
  rigenera: { nome: 'Rigenerazione di un giorno', quando: 'A mano' },
  'mattino-server': { nome: 'DDT e file di stampa sul server (prova)', quando: 'Giorni lavorativi alle 5:00, file in prova-server' },
  'avviso-giacenza': { nome: 'Mail ai clienti per le giacenze', quando: 'Ogni ora, anche nel weekend' },
  'dtf-cartella': { nome: 'Cartella DTF: file, metri e numeri', quando: 'Ogni minuto dal Mac mini, solo quando cambia qualcosa' },
  'richiesta-dati': { nome: 'Richiesta dei dati mancanti', quando: 'Ogni 5 minuti; mail dalle 8 alle 21', modo: true },
  'verifica-indirizzi': { nome: 'Riscontro degli indirizzi', quando: 'Ogni 5 minuti, sugli ordini nuovi', modo: true, modi: [
    ['prova', 'Prova', 'Segnala soltanto, nella scheda Shop: non cambia niente su Shopify'],
    ['automatica', 'Automatica', 'Se manca solo "Via" o "Piazza", o la via ha un errore di battitura sicuro (es. "valter tobagi" → "Walter Tobagi"), la corregge su Shopify; corregge le mail col dominio scritto male; il resto lo segnala'],
    ['spenta', 'Spenta', 'Nessun riscontro']] },
};
const AUTOMAZIONE_MODI = [['prova', 'Prova', 'La mail la manda una persona, col clic sull\'etichetta rossa nella scheda Shop'],
  ['automatica', 'Automatica', 'La mail parte da sola'], ['spenta', 'Spenta', 'Niente mail, niente task']];
const AUTOMAZIONE_STATI = {
  in_corso: ['In corso', '#f59e0b'], ok: ['Riuscita', '#22c55e'], errore: ['Errore', '#ef4444'],
  saltato: ['Non lavorativo', '#94a3b8'], prova: ['Prova', '#6366f1'], interrotta: ['Interrotta', '#ef4444'],
};
const CtrlAuto = { righe: null, error: null, modi: {}, consumi: [], oggetti: {}, channel: null, nuove: new Set(),
  eventi: {}, verifiche: {}, solleciti: {}, testi: {}, cercati: new Set(), aperta: null, quante: 15 };

async function loadControlAutomations() {
  const [{ data, error }, imp, consumi] = await Promise.all([
    supabaseClient.from('automazione_esecuzioni').select('*').order('at', { ascending: false }).limit(100),
    supabaseClient.from('automazioni_impostazioni').select('nome, modo, aggiornato_at, aggiornato_da'),
    supabaseClient.from('cervello_consumi').select('id, at, modello, costo_usd, prova, input, output, mail_id, evento_id').gte('at', new Date(Date.now() - 30 * 86400e3).toISOString()).order('at').limit(10000),
  ]);
  CtrlAuto.consumi = consumi.error ? [] : (consumi.data || []);
  await consumiOggetti(CtrlAuto.consumi.filter(c => !c.prova).slice(-CtrlAuto.quante));
  consumiInDiretta();
  CtrlAuto.modi = Object.fromEntries((imp.data || []).map(r => [r.nome, r]));
  CtrlAuto.righe = data || [];
  CtrlAuto.error = error ? Ctrl._fail(error) : null;
  if (Ctrl.view === 'automazioni') refreshControlPage();
}

// ── Consumi del cervello in diretta: ogni chiamata a Claude arriva da sola (Realtime su cervello_consumi) ──
// Per ogni chiamata si legge anche cosa ne è uscito: esito dell'evento, task creato, verifica, sollecito
async function consumiOggetti(righe) {
  righe = righe.filter(c => !CtrlAuto.cercati.has(c.id));
  if (!righe.length) return;
  righe.forEach(c => CtrlAuto.cercati.add(c.id));
  const mailIds = [...new Set(righe.map(c => c.mail_id).filter(id => id && !(id in CtrlAuto.oggetti)))];
  const evIds = [...new Set(righe.map(c => c.evento_id).filter(Boolean))];
  const senzaEvento = [...new Set(righe.filter(c => !c.evento_id && c.mail_id).map(c => c.mail_id))];
  const [mail, eventi, taskMail, solleciti] = await Promise.all([
    mailIds.length ? supabaseClient.from('mail_messaggi').select('id, oggetto').in('id', mailIds) : { data: [] },
    evIds.length ? supabaseClient.from('eventi').select('id, esito, task_id, elaborato_at').in('id', evIds) : { data: [] },
    senzaEvento.length ? supabaseClient.from('tasks').select('id, mail_id').in('mail_id', senzaEvento) : { data: [] },
    senzaEvento.length ? supabaseClient.from('tasks').select('id, fonte_rif').in('fonte_rif->>evento_id', senzaEvento.map(m => `sollecito:${m}`)) : { data: [] },
  ]);
  (mail.data || []).forEach(m => { CtrlAuto.oggetti[m.id] = m.oggetto || '(senza oggetto)'; });
  (eventi.data || []).forEach(e => { CtrlAuto.eventi[e.id] = e; });
  (solleciti.data || []).forEach(t => { CtrlAuto.solleciti[String(t.fonte_rif?.evento_id).replace('sollecito:', '')] = t.id; });
  const taskIds = (taskMail.data || []).map(t => t.id);
  if (taskIds.length) {
    const { data } = await supabaseClient.from('task_verifiche').select('task_id, at, esito, certo, motivo, chiuso, prova').in('task_id', taskIds);
    const mailDi = new Map((taskMail.data || []).map(t => [t.id, t.mail_id]));
    (data || []).forEach(v => { const m = mailDi.get(v.task_id); (CtrlAuto.verifiche[m] ||= []).push(v); });
  }
}

const CONSUMO_TONI = { ok: '#22c55e', task: '#6366f1', scarto: '#94a3b8', avanti: '#0ea5e9', attesa: '#f59e0b', errore: '#ef4444' };
const VERIFICA_ESITI = { fatto: 'Già fatto', non_necessario: 'Non necessario', doppione: 'Doppione', aperto: 'Lasciato aperto', errore: 'Errore' };

// Cosa ha fatto una chiamata: ruolo, esito breve, spiegazione e task a cui rimanda
function esitoConsumo(c) {
  const haiku = /haiku/i.test(c.modello);
  if (c.evento_id) {
    const ev = CtrlAuto.eventi[c.evento_id];
    const testo = ev?.esito || '';
    if (haiku && CtrlAuto.consumi.some(x => x.evento_id === c.evento_id && !x.prova && /opus/i.test(x.modello))) {
      return { ruolo: 'filtro', etichetta: 'Passata a Opus', tono: 'avanti', testo: 'Haiku non l\'ha considerata spam: l\'ha analizzata Opus (riga sopra).', taskId: null };
    }
    if (!ev?.elaborato_at) return { ruolo: haiku ? 'filtro' : 'analisi e bozza', etichetta: 'In corso', tono: 'attesa', testo: '', taskId: null };
    const scartata = /^Scartata/i.test(testo);
    return {
      ruolo: haiku ? 'filtro' : 'analisi e bozza',
      etichetta: scartata ? 'Scartata' : /^Risposta automatica/i.test(testo) ? 'Risposta inviata' : /^Task creato/i.test(testo) ? 'Task creato' : (testo.split(/[:(]/)[0] || 'Fatto'),
      tono: scartata ? 'scarto' : /^Risposta automatica/i.test(testo) ? 'ok' : ev.task_id ? 'task' : 'errore',
      testo: scartata ? testo.replace(/^Scartata\s*/, '') : testo,
      taskId: ev.task_id || null,
    };
  }
  // Senza evento: verifica di chiusura dei task (Haiku) o sollecito / testi di contatto (Opus)
  const v = (CtrlAuto.verifiche[c.mail_id] || []).filter(x => !!x.prova === !!c.prova)
    .map(x => [x, Math.abs(new Date(x.at) - new Date(c.at))]).filter(([, d]) => d < 10 * 60e3).sort((a, b) => a[1] - b[1])[0]?.[0];
  if (v) return {
    ruolo: 'verifica task', etichetta: v.chiuso ? 'Task chiuso' : (VERIFICA_ESITI[v.esito] || v.esito),
    tono: v.chiuso ? 'ok' : v.esito === 'errore' ? 'errore' : v.esito === 'aperto' ? 'task' : 'attesa',
    testo: `${v.motivo || ''}${!v.chiuso && v.esito !== 'aperto' && v.esito !== 'errore' ? (v.certo ? ' · Non chiuso: questo tipo di task non si chiude da solo.' : ' · Non chiuso: Haiku non era sicuro.') : ''}`.trim(),
    taskId: v.task_id,
  };
  if (c.mail_id && CtrlAuto.solleciti[c.mail_id]) return { ruolo: 'sollecito', etichetta: 'Task sollecito', tono: 'task', testo: 'Il cliente non ha risposto: messaggio e traccia della telefonata sono nel task.', taskId: CtrlAuto.solleciti[c.mail_id] };
  if (c.mail_id) return { ruolo: haiku ? 'verifica task' : 'sollecito', etichetta: '—', tono: null, testo: '', taskId: null };
  return { ruolo: 'testi contatto', etichetta: 'Testi scritti', tono: 'task', testo: 'Messaggio e traccia della telefonata per un task "Dati mancanti per spedire".', taskId: null };
}

async function ricaricaEsiti() {
  const recenti = CtrlAuto.consumi.filter(c => !c.prova && Date.now() - new Date(c.at) < 15 * 60e3);
  const daRifare = recenti.filter(c => c.evento_id ? !CtrlAuto.eventi[c.evento_id]?.elaborato_at : true);
  if (!daRifare.length) return;
  daRifare.forEach(c => CtrlAuto.cercati.delete(c.id));
  await consumiOggetti(daRifare);
  aggiornaConsumiDiretta();
}

async function apriConsumo(id) {
  CtrlAuto.aperta = CtrlAuto.aperta === id ? null : id;
  aggiornaConsumiDiretta();
  const c = CtrlAuto.consumi.find(x => x.id === id);
  if (CtrlAuto.aperta && c?.mail_id && !(c.mail_id in CtrlAuto.testi)) {
    const { data } = await supabaseClient.from('mail_messaggi').select('da_nome, da_email, a, direzione, ricevuto_at, testo').eq('id', c.mail_id).maybeSingle();
    CtrlAuto.testi[c.mail_id] = data || null;
    aggiornaConsumiDiretta();
  }
}

async function altriConsumi() {
  CtrlAuto.quante += 30;
  await consumiOggetti(CtrlAuto.consumi.filter(c => !c.prova).slice(-CtrlAuto.quante));
  aggiornaConsumiDiretta();
}

function dettaglioConsumo(c, e) {
  const m = c.mail_id ? CtrlAuto.testi[c.mail_id] : null;
  const caricata = !c.mail_id || c.mail_id in CtrlAuto.testi;
  const chi = m ? (m.direzione === 'out' ? `A ${m.a || ''}` : `Da ${m.da_nome ? `${m.da_nome} ` : ''}<${m.da_email || ''}>`) : '';
  return `<tr class="ctrl-live-detail"><td colspan="6"><div class="ctrl-live-detail-box">
    ${e.testo ? `<p class="ctrl-live-esito"><strong>Cosa ha fatto:</strong> ${escapeHtml(e.testo)}</p>` : ''}
    ${e.taskId ? `<button type="button" class="ctrl-btn" onclick="event.stopPropagation(); apriTaskDaLink('${e.taskId}')">Apri task</button>` : ''}
    ${c.mail_id ? (!caricata ? '<p class="ctrl-cell-sub">Carico la mail…</p>' : m ? `
      <div class="ctrl-live-mail"><span class="ctrl-cell-sub">${escapeHtml(chi)} · ${ctrlFmtQuando(m.ricevuto_at)}</span>
        <div class="ctrl-live-mail-text">${escapeHtml(String(m.testo || '(mail senza testo)').slice(0, 2000))}${String(m.testo || '').length > 2000 ? '…' : ''}</div></div>`
      : '<p class="ctrl-cell-sub">Mail non più disponibile.</p>') : ''}
  </div></td></tr>`;
}

function consumiInDiretta() {
  if (CtrlAuto.channel || !TCAuth.isAdmin()) return;
  CtrlAuto.channel = supabaseClient.channel('cervello-consumi')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cervello_consumi' }, async (p) => {
      if (!p.new || CtrlAuto.consumi.some(c => c.id === p.new.id)) return;
      CtrlAuto.consumi.push(p.new);
      CtrlAuto.nuove.add(p.new.id);
      await consumiOggetti([p.new]);
      aggiornaConsumiDiretta();
      // L'esito si scrive dopo la chiamata: si rilegge poco dopo
      [20e3, 90e3].forEach(ms => setTimeout(ricaricaEsiti, ms));
    })
    .subscribe((stato) => { CtrlAuto.collegata = stato === 'SUBSCRIBED'; aggiornaConsumiDiretta(); });
}

function fermaConsumiInDiretta() {
  if (CtrlAuto.channel) supabaseClient.removeChannel(CtrlAuto.channel);
  CtrlAuto.channel = null;
  CtrlAuto.collegata = false;
}

// Si ridisegna solo il riquadro: le righe aperte delle esecuzioni restano aperte
function aggiornaConsumiDiretta() {
  const el = document.getElementById('ctrl-consumi-diretta');
  if (!el || Nav.current !== 'controllo' || Ctrl.view !== 'automazioni') return;
  el.outerHTML = renderConsumiDiretta();
}

function renderConsumiDiretta() {
  const usd = (v, cifre = 2) => `${Number(v).toLocaleString('it-IT', { minimumFractionDigits: cifre, maximumFractionDigits: cifre })} $`;
  const vere = CtrlAuto.consumi.filter(c => !c.prova);
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const diOggi = vere.filter(c => new Date(c.at) >= oggi);
  const ora = vere.filter(c => Date.now() - new Date(c.at) < 3600e3);
  const somma = (r) => r.reduce((t, c) => t + Number(c.costo_usd || 0), 0);
  const modello = (m) => /haiku/i.test(m) ? ['Haiku', 'filtro'] : /opus/i.test(m) ? ['Opus', 'analisi e bozza'] : /sonnet/i.test(m) ? ['Sonnet', ''] : [m, ''];
  // Mail fermate da Haiku: c'è la chiamata di Haiku ma non quella di Opus
  const perMail = new Map();
  diOggi.forEach(c => { if (c.mail_id) perMail.set(c.mail_id, [...(perMail.get(c.mail_id) || []), c.modello]); });
  const fermate = [...perMail.values()].filter(m => m.some(x => /haiku/i.test(x)) && !m.some(x => /opus/i.test(x))).length;
  const opusOggi = diOggi.filter(c => /opus/i.test(c.modello));
  const ultime = vere.slice(-CtrlAuto.quante).reverse();
  const quando = (iso) => {
    const d = new Date(iso);
    return d >= oggi ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : ctrlFmtQuando(iso);
  };
  const numero = (valore, etichetta) => `<div class="ctrl-live-num"><strong>${valore}</strong><span>${etichetta}</span></div>`;
  const html = `
    <section class="glass-card page-card ctrl-group" id="ctrl-consumi-diretta">
      <div class="page-card-head"><h2>Consumi in diretta</h2>
        <span class="ctrl-onair ${CtrlAuto.collegata ? 'on' : ''}">${CtrlAuto.collegata ? 'In diretta' : 'Collegamento…'}</span>
        <span class="ctrl-group-hint">Ogni chiamata a Claude compare qui appena succede · clicca una riga per vedere cosa ha fatto</span></div>
      <div class="ctrl-live-nums">
        ${numero(usd(somma(diOggi)), `oggi · ${diOggi.length} ${diOggi.length === 1 ? 'chiamata' : 'chiamate'}`)}
        ${numero(usd(somma(ora)), 'ultima ora')}
        ${numero(opusOggi.length, `mail analizzate da Opus oggi${opusOggi.length ? ` · ${usd(somma(opusOggi) / opusOggi.length, 3)} l'una` : ''}`)}
        ${numero(fermate, 'mail fermate da Haiku oggi (Opus risparmiato)')}
      </div>
      ${ultime.length ? `<div class="table-scroll"><table class="data-table ctrl-live-table">
        <thead><tr><th>Ora</th><th>Modello</th><th>Mail</th><th>Esito</th><th>Token</th><th>Costo</th></tr></thead>
        <tbody>${ultime.map(c => {
          const [nome] = modello(c.modello);
          const e = esitoConsumo(c);
          const aperta = CtrlAuto.aperta === c.id;
          return `<tr class="ctrl-live-row ${CtrlAuto.nuove.has(c.id) ? 'ctrl-live-new' : ''} ${aperta ? 'is-open' : ''}" onclick="apriConsumo(${c.id})" tabindex="0" onkeydown="if(event.key==='Enter')apriConsumo(${c.id})" aria-expanded="${aperta}">
            <td>${quando(c.at)}</td>
            <td><strong>${escapeHtml(nome)}</strong> <span class="ctrl-cell-sub">${escapeHtml(e.ruolo)}</span></td>
            <td class="ctrl-live-subject">${escapeHtml(CtrlAuto.oggetti[c.mail_id] || '—')}</td>
            <td>${e.tono ? `<span class="ctrl-status" style="--st:${CONSUMO_TONI[e.tono]};">${escapeHtml(e.etichetta)}</span>` : '<span class="ctrl-cell-sub">—</span>'}</td>
            <td class="ctrl-cell-sub">${Number(c.input || 0).toLocaleString('it-IT')} → ${Number(c.output || 0).toLocaleString('it-IT')}</td>
            <td>${usd(c.costo_usd || 0, 3)}</td></tr>${aperta ? dettaglioConsumo(c, e) : ''}`;
        }).join('')}</tbody></table></div>
        ${vere.length > ultime.length ? `<div class="ctrl-live-more"><button type="button" class="ctrl-btn" onclick="altriConsumi()">Mostra altre</button></div>` : ''}`
      : '<div class="empty-list">Nessuna chiamata a Claude negli ultimi 30 giorni.</div>'}
    </section>`;
  CtrlAuto.nuove.clear();
  return html;
}

async function setAutomazioneModo(nome, modo) {
  const ora = CtrlAuto.modi[nome];
  if (!ora || ora.modo === modo) return;
  const modi = AUTOMAZIONI[nome]?.modi || AUTOMAZIONE_MODI;
  const label = modi.find(x => x[0] === modo)?.[1] || modo;
  const effetto = AUTOMAZIONI[nome]?.modi ? 'Le correzioni sicure verranno scritte da sole su Shopify.' : 'Le mail ai clienti partiranno da sole.';
  if (modo === 'automatica' && !(await uiConfirm(`${AUTOMAZIONI[nome]?.nome || nome}: passare ad Automatica? ${effetto}`, { ok: 'Attiva' }))) return;
  const { error } = await supabaseClient.from('automazioni_impostazioni')
    .update({ modo, aggiornato_at: new Date().toISOString(), aggiornato_da: TCAuth.getNickname() }).eq('nome', nome);
  if (error) { showToast(error.message, 'error'); return; }
  CtrlAuto.modi[nome] = { ...ora, modo };
  showToast(`${AUTOMAZIONI[nome]?.nome || nome}: ${label}`);
  refreshControlPage();
}

// Partita da più di due ore e mai conclusa: il processo si è fermato senza dire nulla
function automazioneStato(r) {
  return r.stato === 'in_corso' && Date.now() - new Date(r.at) > 2 * 3600e3 ? 'interrotta' : r.stato;
}

function renderControlAutomations() {
  if (CtrlAuto.error) return `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlAuto.error.message)}</div></div>`;
  if (!CtrlAuto.righe) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const pillola = (r) => {
    const [label, color] = AUTOMAZIONE_STATI[automazioneStato(r)] || [r.stato, '#94a3b8'];
    return `<span class="ctrl-status" style="--st:${color};">${label}</span>`;
  };
  const scheda = ([id, a]) => {
    const ultima = CtrlAuto.righe.find(r => r.nome === id);
    return `
      <article class="glass-card ctrl-person">
        <header><h3 style="text-transform:none;">${a.nome}</h3></header>
        <div class="ctrl-person-meta"><span>${a.quando}</span></div>
        <div class="ctrl-person-now">${ultima ? `${pillola(ultima)} <span class="ctrl-cell-sub">${ctrlFmtQuando(ultima.at)}</span>` : '<span class="ctrl-idle">Non è ancora partita</span>'}</div>
        ${a.modo && CtrlAuto.modi[id] ? `
          <div class="segmented ctrl-auto-modo" role="radiogroup" aria-label="Modalità di ${escapeHtml(a.nome)}">
            ${(a.modi || AUTOMAZIONE_MODI).map(([m, label, aiuto]) => `<button type="button" role="radio" aria-checked="${CtrlAuto.modi[id].modo === m}" class="${CtrlAuto.modi[id].modo === m ? 'active' : ''}" title="${escapeHtml(aiuto)}" onclick="setAutomazioneModo('${id}', '${m}')">${label}</button>`).join('')}
          </div>
          <small class="ctrl-cell-sub">${escapeHtml((a.modi || AUTOMAZIONE_MODI).find(x => x[0] === CtrlAuto.modi[id].modo)?.[2] || '')}</small>` : ''}
      </article>`;
  };
  const durata = (r) => r.fine ? `${Math.max(1, Math.round((new Date(r.fine) - new Date(r.at)) / 1000))} s` : '';
  const numeri = (r) => {
    const x = r.riepilogo || {};
    return [
      x.ordini != null ? `${x.ordini} DDT` : '',
      x.pagine_stampa != null ? `${x.pagine_stampa} pagine di stampa` : '',
      x.tag != null ? `${x.tag} tag` : '',
      x.mail != null ? (x.mail === 1 ? '1 mail inviata' : `${x.mail} mail inviate`) : '',
      x.verificati != null ? `${x.verificati} ${x.verificati === 1 ? 'ordine verificato' : 'ordini verificati'}` : '',
      x.corretti ? `${x.corretti} ${x.corretti === 1 ? 'indirizzo corretto' : 'indirizzi corretti'}` : '',
      x.mail_corrette ? `${x.mail_corrette} ${x.mail_corrette === 1 ? 'mail corretta' : 'mail corrette'}` : '',
      x.errori ? (x.errori === 1 ? '1 errore' : `${x.errori} errori`) : '',
      x.cancellate != null ? (x.cancellate === 1 ? '1 cartella cancellata' : `${x.cancellate} cartelle cancellate`) : '',
      x.motivo ? escapeHtml(x.motivo) : '',
    ].filter(Boolean).join(' · ');
  };
  const riga = (r) => `
    <details class="ctrl-auto-run">
      <summary>
        <span class="ctrl-auto-when">${ctrlFmtQuando(r.at)}</span>
        <strong>${escapeHtml(AUTOMAZIONI[r.nome]?.nome || r.nome)}</strong>
        ${pillola(r)}
        <span class="ctrl-cell-sub">${[numeri(r), durata(r)].filter(Boolean).join(' · ')}</span>
      </summary>
      <pre>${escapeHtml(r.output || 'Nessun output.')}</pre>
    </details>`;
  // Costo del cervello (Claude): chiamate vere, la prova dei modelli a parte
  const costo = (giorni, prova = false) => {
    const da = Date.now() - giorni * 86400e3;
    const r = CtrlAuto.consumi.filter(c => !!c.prova === prova && new Date(c.at) >= da);
    return { n: r.length, usd: r.reduce((t, c) => t + Number(c.costo_usd || 0), 0) };
  };
  const usd = (v) => `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const c7 = costo(7), c30 = costo(30), cp = costo(30, true);
  const giorniDati = CtrlAuto.consumi.length ? Math.max(1, (Date.now() - Math.min(...CtrlAuto.consumi.map(c => new Date(c.at)))) / 86400e3) : 0;
  const cervello = `
    <article class="glass-card ctrl-person">
      <header><h3 style="text-transform:none;">Costo del cervello</h3></header>
      <div class="ctrl-person-meta"><span>Claude, a consumo: una chiamata per mail analizzata</span></div>
      ${CtrlAuto.consumi.length ? `
        <div class="ctrl-person-now"><strong>${usd(c7.usd)}</strong> <span class="ctrl-cell-sub">ultimi 7 giorni · ${c7.n} mail</span></div>
        <div class="ctrl-person-now"><strong>${usd(c30.usd)}</strong> <span class="ctrl-cell-sub">ultimi 30 giorni · ${c30.n} mail${c30.n ? ` · ${usd(c30.usd / c30.n)} a mail` : ''}</span></div>
        ${giorniDati < 28 && c30.n ? `<small class="ctrl-cell-sub">Al mese, a questo ritmo: circa ${usd(c30.usd / giorniDati * 30)}</small>` : ''}
        ${cp.n ? `<small class="ctrl-cell-sub">Prova dei modelli: ${usd(cp.usd)} (${cp.n} chiamate)</small>` : ''}`
      : '<div class="ctrl-person-now"><span class="ctrl-idle">Nessun consumo registrato ancora</span></div>'}
    </article>`;
  return `
    <div class="ctrl-team">${Object.entries(AUTOMAZIONI).map(scheda).join('')}${cervello}</div>
    ${TCAuth.isAdmin() ? renderConsumiDiretta() : ''}
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Esecuzioni</h2><span class="table-count">${CtrlAuto.righe.length}</span>
        <span class="ctrl-group-hint">Le ultime 100. Clicca una riga per leggere l'output</span>
        <button class="ctrl-btn" onclick="loadControlAutomations()">↻ Aggiorna</button></div>
      ${CtrlAuto.righe.length ? `<div class="ctrl-auto-list">${CtrlAuto.righe.map(riga).join('')}</div>` : '<div class="empty-list">Nessuna esecuzione registrata.</div>'}
    </section>`;
}

const CtrlReport = { giorni: 7, dati: null, error: null };

async function loadControlReport() {
  const al = ctrlOggi();
  try {
    CtrlReport.dati = await Ctrl._rpc('tc_report', { p_dal: ctrlAddDays(al, 1 - CtrlReport.giorni), p_al: al });
    CtrlReport.error = null;
  } catch (e) { CtrlReport.error = e; }
  refreshControlPage();
}

function setReportDays(n) {
  CtrlReport.giorni = n;
  CtrlReport.dati = null;
  refreshControlPage();
  loadControlReport();
}

function renderControlReport() {
  const r = CtrlReport.dati;
  const periodi = `<div class="segmented" role="radiogroup" aria-label="Periodo" style="margin-bottom:var(--space-md,16px);">
    ${[[7, '7 giorni'], [30, '30 giorni'], [90, '90 giorni']].map(([n, l]) => `<button type="button" role="radio" aria-checked="${CtrlReport.giorni === n}"
      class="${CtrlReport.giorni === n ? 'active' : ''}" onclick="setReportDays(${n})">${l}</button>`).join('')}</div>`;
  if (CtrlReport.error) return `${periodi}<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlReport.error.message)}</div></div>`;
  if (!r) return `${periodi}<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;

  const stat = (label, value, sub = '') => `
    <div class="glass-card stat-card"><div class="stat-card-label">${label}</div>
      <div class="stat-card-value">${value}</div>${sub ? `<div class="ctrl-stat-sub">${sub}</div>` : ''}</div>`;
  const euro = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fonti = { manuale: 'Manuali', mail: 'Mail', shopify: 'Shopify', gestionale: 'Gestionale' };
  const operatori = (r.operatori || []).slice().sort((a, b) => b.punteggio - a.punteggio);
  const m = r.mail || {};

  return `
    ${periodi}
    <div class="stat-grid ctrl-stats">
      ${stat('Task completati', r.task?.completati ?? 0, `su ${r.task?.creati ?? 0} creati`)}
      ${stat('Mail da persone', m.da_persone ?? 0, `${m.scartate ?? 0} scartate dal cervello`)}
      ${stat('Risposte inviate', m.risposte ?? 0, `${m.automatiche ?? 0} automatiche`)}
      ${stat('Tempo di risposta', m.minuti_risposta != null ? ctrlFmtMin(m.minuti_risposta) : '—', 'mediana')}
    </div>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Operatori</h2><span class="ctrl-group-hint">Solo admin</span></div>
      ${operatori.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Operatore</th><th>Punteggio</th><th>Task</th><th>Minuti stimati</th></tr></thead>
        <tbody>${operatori.map(o => `<tr><td><strong>${escapeHtml(o.operatore)}</strong></td><td>${o.punteggio}</td>
          <td>${o.completati}/${o.task}</td><td>${ctrlFmtMin(o.minuti_completati)} / ${ctrlFmtMin(o.minuti_assegnati)}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-list">Nessun task assegnato in questo periodo.</div>`}
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Ordini online</h2></div>
      ${(r.negozi || []).length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Negozio</th><th>Ordini</th><th>Totale</th></tr></thead>
        <tbody>${r.negozi.map(n => `<tr><td><strong>${escapeHtml(n.nome)}</strong></td><td>${n.ordini}</td><td>${euro(n.totale)} ${escapeHtml(n.valuta || '')}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-list">Nessun ordine in questo periodo.</div>`}
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Da dove arrivano i task</h2></div>
      <div class="ctrl-person-meta" style="padding:12px 16px;">
        ${Object.entries(r.task?.per_fonte || {}).map(([k, n]) => `<span><strong>${n}</strong> ${escapeHtml(fonti[k] || k)}</span>`).join('') || 'Nessun task in questo periodo.'}
      </div>
    </section>`;
}

// ── Attivazioni: TC Lavoro sui Mac (tempo sui file dei clienti → task "Lavorazione grafica") ──
// L'admin, dal Mac da collegare, sceglie la persona: il gestionale crea la chiave e dà il comando da incollare nel Terminale.
const CtrlAtt = { lista: null, error: null, persona: '', nuova: null };
const ATT_COMANDO = (chiave) => `curl -fsSL https://cs.pngs.it/mac/installa.zsh | zsh -s ${chiave}`;

async function loadControlAttivazioni() {
  const { data, error } = await supabaseClient.from('lavoro_dispositivi').select('*').order('utente').order('created_at');
  CtrlAtt.lista = data || [];
  CtrlAtt.error = error || null;
  refreshControlPage();
}

async function attivaMac() {
  const chi = CtrlAtt.persona;
  if (!chi) return showToast('Scegli la persona che usa questo Mac', 'error');
  const giaN = (CtrlAtt.lista || []).filter(d => d.utente === chi).length;
  const nome = `Mac di ${chi.charAt(0).toUpperCase()}${chi.slice(1)}${giaN ? ` (${giaN + 1})` : ''}`;
  const { data, error } = await supabaseClient.rpc('tc_lavoro_attiva', { p_utente: chi, p_nome: nome });
  if (error) return showToast(error.message, 'error');
  CtrlAtt.nuova = data;
  await loadControlAttivazioni();
  ctrlCopia(ATT_COMANDO(data), 'Comando copiato: incollalo nel Terminale di questo Mac');
}

async function usoMacOnOff(chiave, nome, on) {
  if (on && !(await uiConfirm(`Accendere l'uso del Mac su ${nome}? Vengono contati solo i tool di lavoro col loro nome; `
    + `tutto il resto è sommato in "Altro", senza registrare siti o ricerche. Prima di accenderlo la persona deve aver ricevuto `
    + `l'informativa (art. 4 Statuto dei Lavoratori): falla confermare al consulente del lavoro. Al Mac arriva entro 5 minuti; `
    + `il browser chiederà una volta il permesso.`, { ok: 'Accendi' }))) return;
  const { error } = await supabaseClient.rpc('tc_lavoro_uso', { p_chiave: chiave, p_on: on });
  if (error) return showToast(error.message, 'error');
  showToast(on ? 'Uso del Mac acceso' : 'Uso del Mac spento');
  loadControlAttivazioni();
}

async function rimuoviMac(chiave, nome) {
  if (!(await uiConfirm(`Scollegare ${nome}? Il tempo già registrato resta nei task; da quel Mac non arriva più niente.`, { ok: 'Scollega', danger: true }))) return;
  const { error } = await supabaseClient.rpc('tc_lavoro_rimuovi', { p_chiave: chiave });
  if (error) return showToast(error.message, 'error');
  if (CtrlAtt.nuova === chiave) CtrlAtt.nuova = null;
  loadControlAttivazioni();
}

function renderControlAttivazioni() {
  if (CtrlAtt.error) return `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlAtt.error.message)}</div></div>`;
  if (!CtrlAtt.lista) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const persone = (Ctrl.users || []).filter(u => u !== 'claude');
  const contatto = (d) => !d.ultimo_contatto ? 'Mai: non ancora installato'
    : `${ctrlGiornoDi(d.ultimo_contatto) === ctrlOggi() ? 'Oggi' : taskDataBreve(ctrlGiornoDi(d.ultimo_contatto))}, ${ctrlFmtOra(d.ultimo_contatto)}`;
  const comando = (chiave) => `
    <div class="att-cmd">
      <code>${escapeHtml(ATT_COMANDO(chiave))}</code>
      <button type="button" class="ctrl-btn is-primary" onclick="ctrlCopia(ATT_COMANDO('${chiave}'), 'Comando copiato')">Copia</button>
    </div>`;

  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>TC Lavoro sui Mac</h2><span class="ctrl-group-hint">Tempo sui file dei clienti, NAS e locale</span></div>
      <div class="att-body">
        <p class="att-testo">Apri questa pagina dal Mac da collegare, scegli chi lo usa e premi Attiva. Il comando viene copiato:
          aprilo nel <strong>Terminale</strong> (Applicazioni ▸ Utility), incolla e premi Invio. Poi in Impostazioni ▸ Privacy e sicurezza ▸
          Accessibilità attiva <strong>TC Lavoro</strong>, e quando Illustrator, Photoshop o InDesign lo chiedono rispondi Consenti.</p>
        <div class="att-form">
          <select class="filter-pill" aria-label="Chi usa questo Mac" onchange="CtrlAtt.persona=this.value">
            <option value="">Chi usa questo Mac?</option>
            ${persone.map(u => `<option value="${escapeHtml(u)}" ${CtrlAtt.persona === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
          </select>
          <button type="button" class="ctrl-btn is-primary" onclick="attivaMac()">Attiva questo Mac</button>
        </div>
        ${CtrlAtt.nuova ? comando(CtrlAtt.nuova) : ''}
      </div>
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Mac collegati</h2></div>
      ${CtrlAtt.lista.length ? `<div class="table-scroll"><table class="data-table">
        <thead><tr><th>Persona</th><th>Mac</th><th>Ultimo invio</th><th>Uso del Mac</th><th></th></tr></thead>
        <tbody>${CtrlAtt.lista.map(d => `<tr>
          <td><strong>${escapeHtml(d.utente)}</strong></td>
          <td>${escapeHtml(d.nome)}</td>
          <td>${contatto(d)}</td>
          <td><button type="button" class="ctrl-btn ${d.uso ? 'is-primary' : ''}" aria-pressed="${!!d.uso}"
            onclick="usoMacOnOff('${d.chiave}', '${escapeHtml(d.nome).replace(/'/g, '&#39;')}', ${!d.uso})">${d.uso ? 'Acceso' : 'Spento'}</button></td>
          <td class="att-azioni">
            <button type="button" class="ctrl-btn" onclick="ctrlCopia(ATT_COMANDO('${d.chiave}'), 'Comando copiato: incollalo nel Terminale del Mac')">Copia comando</button>
            <button type="button" class="ctrl-btn" onclick="rimuoviMac('${d.chiave}', '${escapeHtml(d.nome).replace(/'/g, '&#39;')}')">Scollega</button>
          </td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="empty-list">Nessun Mac collegato.</div>`}
    </section>`;
}


// ── Uso dei Mac: tempo nei tool di lavoro e quota "Altro", per persona (sql/uso-mac.sql, raccolti da TC Lavoro dove è acceso) ──
// Solo totali del giorno: i tool di lavoro col loro nome, tutto il resto in un'unica "Altro" senza nome.
const USO_COLORI = ['#16a34a', '#0ea5e9', '#6366f1', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#84cc16', '#06b6d4', '#f97316'];
const USO_ALTRO = '#94a3b8';
const CtrlUso = { periodo: 'oggi', righe: null, error: null };

function usoIntervallo() {
  const oggi = ctrlOggi();
  return { oggi: [oggi, oggi], ieri: [ctrlAddDays(oggi, -1), ctrlAddDays(oggi, -1)],
    '7': [ctrlAddDays(oggi, -6), oggi], '30': [ctrlAddDays(oggi, -29), oggi] }[CtrlUso.periodo];
}

async function loadUsoMac() {
  const [dal, al] = usoIntervallo();
  const { data, error } = await supabaseClient.from('lavoro_uso').select('utente, giorno, categoria, voce, minuti')
    .gte('giorno', dal).lte('giorno', al).limit(10000);
  CtrlUso.righe = data || [];
  CtrlUso.error = error || null;
  refreshControlPage();
}

function setUsoPeriodo(p) {
  CtrlUso.periodo = p;
  CtrlUso.righe = null;
  refreshControlPage();
  loadUsoMac();
}

function renderUsoMac() {
  const periodi = `<div class="segmented" role="radiogroup" aria-label="Periodo" style="margin-bottom:var(--space-md,16px);">
    ${[['oggi', 'Oggi'], ['ieri', 'Ieri'], ['7', '7 giorni'], ['30', '30 giorni']].map(([p, l]) => `<button type="button" role="radio"
      aria-checked="${CtrlUso.periodo === p}" class="${CtrlUso.periodo === p ? 'active' : ''}" onclick="setUsoPeriodo('${p}')">${l}</button>`).join('')}</div>`;
  if (CtrlUso.error) return `${periodi}<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlUso.error.message)}</div></div>`;
  if (!CtrlUso.righe) return `${periodi}<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;

  const persone = {};
  for (const r of CtrlUso.righe) {
    const p = persone[r.utente] = persone[r.utente] || { tot: 0, lavoro: 0, altro: 0, tool: {}, giorni: new Set() };
    p.tot += r.minuti;
    p.giorni.add(r.giorno);
    if (r.categoria === 'lavoro') { p.lavoro += r.minuti; p.tool[r.voce] = (p.tool[r.voce] || 0) + r.minuti; }
    else p.altro += r.minuti;
  }
  const nota = `<p class="uso-nota">Solo i Mac con l'uso acceso (Attivazioni). Si contano i minuti in cui il tool è davanti e la persona
    usa mouse o tastiera. I tool di lavoro si vedono col loro nome; tutto il resto — altri siti, musica, messaggi personali — è
    sommato in <strong>Altro</strong>, senza mai registrare quali siti o cosa si cerca. I dati si cancellano dopo 90 giorni.</p>`;
  const nomi = Object.keys(persone).sort((a, b) => persone[b].altro - persone[a].altro);
  if (!nomi.length) return `${periodi}<div class="glass-card page-card"><div class="empty-list">Nessun dato in questo periodo.</div>${nota}</div>`;

  const pct = (m, tot) => tot ? Math.round(m / tot * 100) : 0;
  const card = (nick) => {
    const p = persone[nick];
    const nG = p.giorni.size;
    const pAltro = pct(p.altro, p.tot);
    const tool = Object.entries(p.tool).sort((a, b) => b[1] - a[1]);
    const seg = [...tool.map(([v, m], i) => ({ label: v, m, color: USO_COLORI[i % USO_COLORI.length] })),
      ...(p.altro ? [{ label: 'Altro', m: p.altro, color: USO_ALTRO }] : [])];
    return `
      <section class="glass-card page-card ctrl-group uso-card">
        <div class="page-card-head"><h2>${escapeHtml(nick)}</h2>
          <span class="ctrl-group-hint">${ctrlFmtMin(p.tot)} al Mac${nG > 1 ? ` in ${nG} giorni` : ''} · lavoro <strong>${ctrlFmtMin(p.lavoro)}</strong> ·
            Altro <strong class="${pAltro >= 20 ? 'uso-alto' : ''}">${ctrlFmtMin(p.altro)} (${pAltro}%)</strong>${nG > 1 && p.altro ? `, ${ctrlFmtMin(p.altro / nG)} al giorno` : ''}</span></div>
        <div class="uso-body">
          <div class="uso-barra" role="img" aria-label="${seg.map(s => `${s.label} ${pct(s.m, p.tot)}%`).join(', ')}">
            ${seg.map(s => `<span style="width:${s.m / p.tot * 100}%;background:${s.color}" title="${escapeHtml(s.label)}: ${ctrlFmtMin(s.m)}"></span>`).join('')}
          </div>
          <div class="uso-voci">
            ${tool.map(([v, m], i) => `<div class="uso-voce"><i style="background:${USO_COLORI[i % USO_COLORI.length]}"></i>
              <span>${escapeHtml(v)}</span><strong>${ctrlFmtMin(m)}</strong></div>`).join('')}
            ${p.altro ? `<div class="uso-voce uso-voce-altro"><i style="background:${USO_ALTRO}"></i>
              <span>Altro <em>(siti e app non di lavoro, senza nome)</em></span><strong>${ctrlFmtMin(p.altro)}</strong></div>` : ''}
          </div>
        </div>
      </section>`;
  };
  return `${periodi}${nomi.map(card).join('')}<div class="glass-card page-card">${nota}</div>`;
}

// ── Costi: i servizi a pagamento di Creative System, Live Printing e Kamon, mese per mese (sql/costi-gestionale.sql) ──
// Claude dai consumi veri (vista cervello_costo_giorni), gli altri fissi dal mese in cui si pagano.
// Previsione: speso finora + ritmo per giorno lavorativo × giorni lavorativi che mancano; il ritmo
// mescola quello del mese e quello del mese prima, pesati su quanto mese è passato.
const CtrlCosti = { righe: null, giorni: [], error: null, aperto: null };

function apriMeseCosti(m) {
  CtrlCosti.aperto = CtrlCosti.aperto === m ? null : m;
  refreshControlPage();
}

async function loadControlCosti() {
  const [fissi, claude] = await Promise.all([
    supabaseClient.from('costi_gestionale').select('*').order('ordine').order('created_at'),
    supabaseClient.from('cervello_costo_giorni').select('giorno, usd').order('giorno').limit(5000),
  ]);
  CtrlCosti.error = fissi.error || claude.error || null;
  CtrlCosti.righe = fissi.data || [];
  CtrlCosti.giorni = (claude.data || []).map(g => ({ giorno: g.giorno, usd: Number(g.usd || 0) }));
  refreshControlPage();
}

async function salvaCosto(id, campo, valore) {
  let v = String(valore).trim();
  if (campo === 'importo') v = Math.max(0, Number(v.replace(',', '.')) || 0);
  if (campo === 'dal') { if (!/^\d{4}-\d{2}$/.test(v)) return; v += '-01'; }
  if (campo === 'nome' && !v) return showToast('Il nome non può essere vuoto', 'error');
  const { error } = await supabaseClient.from('costi_gestionale').update({ [campo]: v }).eq('id', id);
  if (error) return showToast(error.message, 'error');
  const r = CtrlCosti.righe.find(x => x.id === id);
  if (r) r[campo] = v;
  refreshControlPage();
}

async function aggiungiCosto() {
  const nome = (await uiPrompt('Nome del servizio', { placeholder: 'es. Customily', ok: 'Aggiungi' }))?.trim();
  if (!nome) return;
  const ordine = Math.max(0, ...CtrlCosti.righe.map(r => r.ordine)) + 1;
  const { error } = await supabaseClient.from('costi_gestionale').insert({ nome, ordine, dal: ctrlOggi().slice(0, 8) + '01' });
  if (error) return showToast(error.message, 'error');
  loadControlCosti();
}

async function eliminaCosto(id, nome) {
  if (!(await uiConfirm(`Togliere ${nome} dai costi? Sparisce anche dai mesi passati.`, { ok: 'Togli', danger: true }))) return;
  const { error } = await supabaseClient.from('costi_gestionale').delete().eq('id', id);
  if (error) return showToast(error.message, 'error');
  loadControlCosti();
}

// Mesi dal primo costo a oggi, ognuno con effettivo e previsione (Claude + fissi)
function costiMesi() {
  const oggi = ctrlOggi(), meseOggi = oggi.slice(0, 7);
  const primoDato = CtrlCosti.giorni[0]?.giorno || null;
  const fissiMese = (m) => CtrlCosti.righe.filter(r => String(r.dal).slice(0, 7) <= m)
    .map(r => ({ nome: r.nome, usd: r.periodo === 'anno' ? Number(r.importo) / 12 : Number(r.importo) }));
  // Giorni lavorativi di un mese da un giorno a un altro (compresi)
  const lav = (da, a) => { let n = 0; for (let d = da; d <= a; d = ctrlAddDays(d, 1)) if (ctrlLavorativo(d)) n++; return n; };
  const fineMese = (m) => ctrlAddDays(ctrlAddDays(m + '-01', 32).slice(0, 8) + '01', -1);
  const meseDopo = (m) => ctrlAddDays(m + '-01', 32).slice(0, 7);
  const claude = (m) => CtrlCosti.giorni.filter(g => g.giorno.startsWith(m) && g.giorno <= oggi).reduce((t, g) => t + g.usd, 0);
  // Ritmo per giorno lavorativo di un mese, contando solo i giorni da quando ci sono dati
  const ritmo = (m, finoA) => {
    if (!primoDato || primoDato > finoA) return null;
    const da = primoDato > m + '-01' ? primoDato : m + '-01';
    const n = lav(da, finoA);
    return n ? claude(m) / n : null;
  };

  const inizi = [...CtrlCosti.righe.map(r => String(r.dal).slice(0, 7)), primoDato?.slice(0, 7)].filter(Boolean);
  if (!inizi.length) return [];
  const mesi = [];
  for (let m = inizi.sort()[0]; m <= meseOggi; m = meseDopo(m)) {
    const prima = ctrlAddDays(m + '-01', -1).slice(0, 7);
    const rPrima = ritmo(prima, fineMese(prima));
    const totLav = lav(m + '-01', fineMese(m));
    const corrente = m === meseOggi;
    const speso = claude(m);
    let prevClaude = null;
    if (corrente) {
      // Quanto mese è passato, contando da quando ci sono dati; i giorni che mancano si stimano col ritmo
      const da = primoDato && primoDato > m + '-01' ? primoDato : m + '-01';
      const quota = da > oggi ? 0 : lav(da, oggi) / Math.max(1, lav(da, fineMese(m)));
      const rOra = ritmo(m, oggi);
      const r = rOra == null ? rPrima : rPrima == null ? rOra : quota * rOra + (1 - quota) * rPrima;
      prevClaude = r == null ? null : speso + r * lav(ctrlAddDays(oggi, 1), fineMese(m));
    } else if (rPrima != null) prevClaude = rPrima * totLav;
    const fissi = fissiMese(m);
    const fisso = fissi.reduce((t, f) => t + f.usd, 0);
    mesi.push({ mese: m, corrente, totLav, speso, fisso, fissi,
      effettivo: speso + fisso,
      previsione: prevClaude == null && !fisso ? null : (prevClaude ?? 0) + fisso,
      prevClaude });
  }
  return mesi.reverse();
}

function renderControlCosti() {
  if (CtrlCosti.error) return `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(CtrlCosti.error.message)}</div></div>`;
  if (!CtrlCosti.righe) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const usd = (v) => v == null ? '—' : `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const alMese = (r) => r.periodo === 'anno' ? Number(r.importo) / 12 : Number(r.importo);
  const q = (s) => escapeHtml(s).replace(/'/g, '&#39;');
  const mesi = costiMesi();
  const ora = mesi.find(m => m.corrente);
  const nomeMese = (m) => { const t = new Date(m + '-15T12:00:00Z').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };

  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Mese per mese</h2>
        <span class="ctrl-group-hint">Previsione sui giorni lavorativi, col ritmo di questo mese e del mese prima</span></div>
      ${mesi.length ? `<div class="table-scroll"><table class="data-table costi-table">
        <thead><tr><th>Mese</th><th>Previsione</th><th>Effettivo</th><th>Di cui Claude</th><th>Giorni lavorativi</th></tr></thead>
        <tbody>${mesi.map(m => {
          const aperto = CtrlCosti.aperto === m.mese;
          return `<tr class="costi-mese ${aperto ? 'is-open' : ''}" tabindex="0" role="button" aria-expanded="${aperto}"
              onclick="apriMeseCosti('${m.mese}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();apriMeseCosti('${m.mese}')}">
            <td><span class="costi-freccia" aria-hidden="true">›</span> <strong>${nomeMese(m.mese)}</strong>${m.corrente ? ' <span class="ctrl-cell-sub">in corso</span>' : ''}</td>
            <td>${usd(m.previsione)}</td>
            <td><strong>${usd(m.effettivo)}</strong>${m.corrente ? ' <span class="ctrl-cell-sub">finora</span>' : ''}</td>
            <td>${usd(m.speso)}${m.corrente && m.prevClaude != null ? ` <span class="ctrl-cell-sub">→ ${usd(m.prevClaude)}</span>` : ''}</td>
            <td>${m.totLav}</td>
          </tr>${aperto ? `<tr class="costi-dett"><td colspan="5"><table class="costi-dett-table">
            <thead><tr><th>Servizio</th><th>Previsione</th><th>Effettivo</th></tr></thead>
            <tbody>
              <tr><td>API Claude</td><td>${usd(m.prevClaude)}</td><td>${usd(m.speso)}${m.corrente ? ' <span class="ctrl-cell-sub">finora</span>' : ''}</td></tr>
              ${m.fissi.map(f => `<tr><td>${escapeHtml(f.nome)}</td><td>${usd(f.usd)}</td><td>${usd(f.usd)}</td></tr>`).join('')}
            </tbody></table></td></tr>` : ''}`;
        }).join('')}</tbody>
        <tfoot><tr><td><strong>Totale dall'inizio</strong></td>
          <td>${usd(mesi.reduce((t, m) => t + (m.previsione ?? 0), 0))}</td>
          <td><strong>${usd(mesi.reduce((t, m) => t + m.effettivo, 0))}</strong></td>
          <td>${usd(mesi.reduce((t, m) => t + m.speso, 0))}</td><td></td></tr></tfoot>
      </table></div>` : '<div class="empty-list">Nessun costo ancora.</div>'}
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Servizi</h2>
        <span class="ctrl-group-hint">Quelli a pagamento di Creative System, Live Printing e Kamon. Importi in dollari</span>
        <button type="button" class="ctrl-btn" onclick="aggiungiCosto()">+ Aggiungi costo</button></div>
      <div class="table-scroll"><table class="data-table costi-table">
        <thead><tr><th>Servizio</th><th>Costo</th><th>Ogni</th><th>Dal</th><th>Al mese</th><th>Nota</th><th></th></tr></thead>
        <tbody>
          <tr>
            <td><strong>API Claude</strong></td>
            <td class="ctrl-cell-sub">a consumo</td>
            <td></td><td></td>
            <td><strong>${usd(ora?.prevClaude ?? null)}</strong></td>
            <td class="ctrl-cell-sub">Il cervello di Creative System (Live Printing e Kamon non usano Claude): previsione di questo mese</td>
            <td></td>
          </tr>
          ${CtrlCosti.righe.map(r => `<tr>
            <td><input class="form-input costi-nome" value="${escapeHtml(r.nome)}" aria-label="Servizio" onchange="salvaCosto('${r.id}', 'nome', this.value)"></td>
            <td><input class="form-input costi-num" inputmode="decimal" value="${Number(r.importo).toLocaleString('it-IT', { minimumFractionDigits: 2 })}" aria-label="Costo in dollari" onchange="salvaCosto('${r.id}', 'importo', this.value)"></td>
            <td><select class="filter-pill" aria-label="Ogni" onchange="salvaCosto('${r.id}', 'periodo', this.value)">
              <option value="mese" ${r.periodo === 'mese' ? 'selected' : ''}>mese</option>
              <option value="anno" ${r.periodo === 'anno' ? 'selected' : ''}>anno</option></select></td>
            <td><input type="month" class="form-input costi-dal" value="${String(r.dal).slice(0, 7)}" aria-label="Si paga dal mese" onchange="salvaCosto('${r.id}', 'dal', this.value)"></td>
            <td><strong>${usd(alMese(r))}</strong></td>
            <td><input class="form-input costi-nota" value="${escapeHtml(r.nota)}" aria-label="Nota" placeholder="Nota" onchange="salvaCosto('${r.id}', 'nota', this.value)"></td>
            <td class="att-azioni"><button type="button" class="ctrl-btn" onclick="eliminaCosto('${r.id}', '${q(r.nome)}')">Togli</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
    </section>`;
}
