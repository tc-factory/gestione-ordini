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
const taskMacro = (id) => TASK_MACROAREE.find(m => m.id === id);
// Competenze: voci "area:competenza" con primario e secondario (competenze_responsabili); i task senza negozio sono dell'area "produzione"
const TASK_COMPETENZE = [
  { id: 'whatsapp',     label: 'WhatsApp' },
  { id: 'social',       label: 'Messaggi social' },
  { id: 'email',        label: 'Email' },
  { id: 'ddt',          label: 'Stampa DDT ordini Shopify' },
  { id: 'preparazione', label: 'Preparazione per la lavorazione' },
  { id: 'lavorazione',  label: 'Lavorazione' },
  { id: 'spedizione',   label: 'Spedizione' },
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
];
const COMPETENZE_BASE = ['whatsapp', 'social', 'email', 'ddt', 'preparazione', 'lavorazione', 'spedizione'];
const COMPETENZE_NUOVO_PRODOTTO = ['np_bozza', 'np_mockup', 'np_stampa', 'np_shopify', 'np_customily', 'np_check'];
const COMPETENZE_NEGOZIO = {
  ciucciamilcalzino: ['scorte_calzini_check', 'scorte_calzini_ordine', 'carta_check', 'carta_ordine', 'inchiostri_check', 'inchiostri_ordine'],
  boxfactorylab: ['grafiche', 'catalogo', 'fatturazione', 'check_pagamento'],
};
const TASK_AREE = [
  ...TASK_MACROAREE.map(m => ({
    ...m,
    competenze: [...COMPETENZE_BASE, ...(COMPETENZE_NEGOZIO[m.id] || []), ...COMPETENZE_NUOVO_PRODOTTO],
    // Stessa competenza dei task (preparazione), altro nome in questi negozi
    etichette: m.id === 'asteroidi' ? {} : { preparazione: 'Preparazione file di stampa' },
  })),
  { id: 'produzione', label: 'Linea produttiva', color: '#64748b', competenze: [
    'ordine_fornitori', 'creazione_pacchi', 'prep_file', 'stampa_dtf', 'stampa_uv', 'stampa_mimaki', 'incisione_laser',
    'lavorazione', 'spedizione', 'evasione',
    'ext_ricamo', 'ext_serigrafia', 'ext_manifattura', 'ext_arti',
    'check_ricamo', 'check_serigrafia', 'check_manifattura', 'check_arti',
    'fatturazione', 'check_pagamento',
  ] },
  { id: 'automazioni', label: 'Automazioni', color: '#111827', competenze: ['verifica'] },
];
const competenzaLabel = (id) => TASK_COMPETENZE.find(c => c.id === id)?.label || id;
// Stati ancora da lavorare: se il giorno passa, il task diventa arretrato
const TASK_APERTI = ['da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'];
// Stati che chiedono il motivo
const TASK_CON_MOTIVO = ['rimandato', 'bloccato', 'non_completato'];
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
  view: 'giorno',        // giorno | ordini | gls | comunicazioni | cervello | collegamenti | competenze | squadra | report
  giorno: ctrlOggi(),    // giorno mostrato
  macroarea: null,       // filtro della coda comune (null = tutte)
  tasks: [],             // task del giorno + arretrati aperti dei giorni prima
  tipi: [],
  users: [],             // nickname dello staff
  operatori: [],         // impostazioni del piano del giorno (task_operatori)
  responsabili: {},      // voce "area:competenza" → { primario, secondario }
  assenti: new Set(),    // chi è in ferie o a un evento nel giorno scelto
  problemi: [],          // collegamenti con problemi, in cima alla pagina (solo admin)
  soloUrgenti: false,    // lista dei task urgenti al posto della coda
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
      const [tasks, tipi, users] = await Promise.all([
        supabaseClient.from('tasks').select('*')
          .or(`giorno.eq.${d},and(giorno.lt.${d},stato.in.(${aperti}))`)
          .order('created_at'),
        supabaseClient.from('task_tipi').select('*').order('nome'),
        this.users.length ? null : TCAuth.listUsers().catch(() => []),
      ]);
      if (tasks.error) throw this._fail(tasks.error);
      if (tipi.error)  throw this._fail(tipi.error);
      this.tasks = tasks.data || [];
      this.tipi  = tipi.data || [];
      if (users) this.users = users.filter(u => !u.is_admin).map(u => u.nickname);   // l'admin non riceve task

      if (TCAuth.isAdmin()) {
        const [oggi, sette, tempi, operatori, problemi, responsabili, calendario] = await Promise.all([
          this._rpc('tc_task_punteggi', { p_dal: d, p_al: d }),
          this._rpc('tc_task_punteggi', { p_dal: ctrlAddDays(d, -6), p_al: d }),
          this._rpc('tc_task_tempi_reali'),
          supabaseClient.from('task_operatori').select('*'),
          this._rpc('tc_problemi_collegamenti').catch(() => ({ problemi: [] })),
          supabaseClient.from('competenze_responsabili').select('*'),
          supabaseClient.from('calendar_events').select('user_ids').lte('date_from', d).gte('date_to', d).in('event_type', ['ferie', 'impegno']),
        ]);
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
    const { count, error } = await (TCAuth.isAdmin() ? q.is('assegnato_a', null) : q.eq('assegnato_a', this._me()));
    const n = error ? 0 : (count || 0);
    if (n !== this.badge) { this.badge = n; renderSidebar(); }
  },

  // Aggiornamento in tempo reale: qualsiasi modifica ai task ricarica la pagina aperta
  start() {
    if (!Nav.isAllowed('controllo')) return;
    this.loadBadge();
    this._channel = supabaseClient.channel('tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => this._scheduleReload())
      .subscribe();
  },

  stop() {
    if (this._channel) supabaseClient.removeChannel(this._channel);
    clearTimeout(this._reloadTimer);
    clearInterval(this._tick);
    Object.assign(this, { _channel: null, _tick: null, tasks: [], tipi: [], users: [], punteggi: {}, punteggi7: {},
      tempi: {}, loaded: false, error: null, badge: 0, view: 'giorno', giorno: ctrlOggi() });
  },

  _scheduleReload() {
    clearTimeout(this._reloadTimer);
    this._reloadTimer = setTimeout(async () => {
      this.loadBadge();
      if (Nav.current !== 'controllo') return;
      await this.load();
      refreshControlPage();
    }, 400);
  },

  // ── Azioni ──

  async setStato(id, stato, motivo = null, giorno = null) {
    await this._rpc('tc_task_stato', { p_id: id, p_stato: stato, p_motivo: motivo, p_giorno: giorno });
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

  get(id)     { return this.tasks.find(t => t.id === id); },
  tipo(id)    { return this.tipi.find(t => t.id === id); },
  canAct(t)   { return TCAuth.isAdmin() || !t.assegnato_a || t.assegnato_a === this._me(); },
};

window.Ctrl = Ctrl;

// Ordine dentro un gruppo: in corso, poi priorità, poi scadenza, poi arrivo
function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (b.stato === 'in_lavorazione') - (a.stato === 'in_lavorazione')
    || taskPrioRank(a.priorita) - taskPrioRank(b.priorita)
    || (a.scadenza || '9').localeCompare(b.scadenza || '9')
    || a.created_at.localeCompare(b.created_at));
}

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

async function openControlPage() {
  if (!TCAuth.isAdmin() && Ctrl.view !== 'giorno') Ctrl.view = 'giorno';
  refreshControlPage();
  await Ctrl.load();
  refreshControlPage();
  loadControlExtras();
}

function refreshControlPage() {
  if (Nav.current !== 'controllo') return;
  // Un aggiornamento in tempo reale non deve cancellare le regole in modifica
  if (Ctrl.view === 'cervello' && CtrlBrain.sez === 'regole' && CtrlBrain.modificato) return;
  renderControlPage();
  renderHeader();
}

// Scelta del giorno nella testata della pagina (la inserisce renderHeader)
function controlDayNav() {
  if (Nav.current !== 'controllo' || !['giorno', 'squadra'].includes(Ctrl.view)) return '';
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

function setControlView(view) {
  if (!leaveRulesOk()) return;
  Ctrl.view = view;
  refreshControlPage();
  loadControlExtras();
}

// Dati delle schede che li caricano quando si aprono
function loadControlExtras() {
  if (['ordini', 'gls', 'comunicazioni', 'cervello', 'collegamenti'].includes(Ctrl.view)) loadShopifyLinks();
  if (Ctrl.view === 'cervello') loadBrainRules();
  if (Ctrl.view === 'report') loadControlReport();
}

async function setControlDay(iso) {
  Ctrl.giorno = iso || ctrlOggi();
  Ctrl.loaded = false;
  refreshControlPage();
  await Ctrl.load();
  refreshControlPage();
}

function renderControlPage() {
  const root = document.getElementById('controllo-root');
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

  const tabs = [['giorno', 'Tasks'], ...(TCAuth.isAdmin() ? [['ordini', 'Shopify'], ['gls', 'GLS'], ['comunicazioni', 'Comunicazioni'], ['cervello', 'Cervello'], ['collegamenti', 'Collegamenti'], ['competenze', 'Competenze'], ['squadra', 'Team'], ['report', 'Report']] : [])];
  const body = !Ctrl.loaded ? `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`
    : Ctrl.error ? `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(Ctrl.error.message)}</div></div>`
    : Ctrl.view === 'squadra' ? renderControlTeam()
    : Ctrl.view === 'ordini' ? renderControlOrders()
    : Ctrl.view === 'gls' ? renderControlGls()
    : Ctrl.view === 'comunicazioni' ? renderControlComms()
    : Ctrl.view === 'cervello' ? renderControlBrain()
    : Ctrl.view === 'collegamenti' ? renderControlLinks()
    : Ctrl.view === 'competenze' ? renderControlSkills()
    : Ctrl.view === 'report' ? renderControlReport()
    : renderControlMyDay();

  root.innerHTML = `
    <div class="ctrl-bar">
      ${tabs.length > 1 ? `<div class="segmented" role="tablist" aria-label="Vista">
        ${tabs.map(([id, label]) => `<button role="tab" aria-selected="${Ctrl.view === id}" class="${Ctrl.view === id ? 'active' : ''}"
          onclick="setControlView('${id}')">${label}</button>`).join('')}
      </div>` : ''}
    </div>
    ${TCAuth.isAdmin() && Ctrl.problemi.length ? `
      <div class="ctrl-alert" role="alert">
        <div><strong>${Ctrl.problemi.length === 1 ? 'Un collegamento ha un problema' : `${Ctrl.problemi.length} collegamenti hanno un problema`}</strong>
          ${Ctrl.problemi.map(p => `<span>${escapeHtml(p)}</span>`).join('')}</div>
        ${Ctrl.view !== 'collegamenti' ? `<button class="ctrl-btn" onclick="setControlView('collegamenti')">Vai a Collegamenti</button>` : ''}
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
    if (Nav.current !== 'controllo') { clearInterval(Ctrl._tick); Ctrl._tick = null; return; }
    document.querySelectorAll('[data-task-timer]').forEach(el => {
      const t = Ctrl.get(el.dataset.taskTimer);
      if (t) el.textContent = ctrlFmtDur(taskLavoratoSec(t));
    });
  }, 1000);
}

// ── Tasks ──

function renderControlMyDay() {
  if (TCAuth.isAdmin()) return renderControlAdminTasks();
  const me = Ctrl._me(), d = Ctrl.giorno;
  const mine = Ctrl.tasks.filter(t => t.assegnato_a === me);
  const delGiorno = mine.filter(t => t.giorno === d);
  const arretrati = mine.filter(t => t.giorno < d);
  const coda = Ctrl.tasks.filter(t => !t.assegnato_a);

  const inCorso  = delGiorno.filter(t => t.stato === 'in_lavorazione');
  const daFare   = delGiorno.filter(t => ['da_fare', 'in_pausa', 'rimandato'].includes(t.stato));
  const bloccati = delGiorno.filter(t => t.stato === 'bloccato');
  const chiusi   = delGiorno.filter(t => ['completato', 'non_completato'].includes(t.stato));

  const minTot  = delGiorno.filter(t => t.stato !== 'bloccato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);
  const minFatti = delGiorno.filter(t => t.stato === 'completato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);
  const lavorati = delGiorno.reduce((s, t) => s + taskLavoratoSec(t), 0);
  const corrente = inCorso[0] || arretrati.find(t => t.stato === 'in_lavorazione');

  const stat = (label, value, sub = '', glow = 'var(--brand-gold)') => `
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:${glow};"></div>
      <div class="stat-card-label">${label}</div>
      <div class="stat-card-value">${value}</div>
      ${sub ? `<div class="ctrl-stat-sub">${sub}</div>` : ''}
    </div>`;

  return `
    <div class="stat-grid ctrl-stats">
      ${stat('Task', `${chiusi.filter(t => t.stato === 'completato').length}/${delGiorno.length}`, 'completati', '#22c55e')}
      ${stat('Tempo', `${ctrlFmtMin(minFatti)} <small>/ ${ctrlFmtMin(minTot)}</small>`, `lavorato ${ctrlFmtDur(lavorati)}`, '#6366f1')}
      ${stat('In corso', corrente ? `<span data-task-timer="${corrente.id}">${ctrlFmtDur(taskLavoratoSec(corrente))}</span>` : '—',
             corrente ? escapeHtml(corrente.titolo) : 'nessun task avviato', '#f59e0b')}
    </div>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>I miei task</h2><span class="table-count">${inCorso.length + daFare.length + arretrati.length + bloccati.length}</span></div>
      ${taskSub('In corso', inCorso)}
      ${taskSub('Da fare', daFare)}
      ${taskSub('Arretrati', arretrati)}
      ${taskSub('Bloccati', bloccati)}
      ${inCorso.length + daFare.length + arretrati.length + bloccati.length ? '' : `<div class="empty-list">${d === ctrlOggi() ? 'Niente da fare per oggi.' : 'Nessun task per questo giorno.'}</div>`}
    </section>
    ${renderTaskQueue(coda)}
    ${chiusi.length ? `
      <details class="glass-card page-card ctrl-group ctrl-closed">
        <summary class="page-card-head"><h2>Chiusi</h2><span class="table-count">${chiusi.length}</span></summary>
        <div class="task-list">${sortTasks(chiusi).map(t => renderTaskRow(t)).join('')}</div>
      </details>` : ''}`;
}

// L'admin non ha task suoi: vede la coda e la assegna
function renderControlAdminTasks() {
  const d = Ctrl.giorno;
  const aperti = Ctrl.tasks.filter(t => TASK_APERTI.includes(t.stato) || t.stato === 'bloccato');
  const coda = Ctrl.tasks.filter(t => !t.assegnato_a && !['completato', 'non_completato'].includes(t.stato));
  const chiusi = Ctrl.tasks.filter(t => t.giorno === d && ['completato', 'non_completato'].includes(t.stato));
  const stat = (label, value, sub = '') => `
    <div class="glass-card stat-card"><div class="stat-card-label">${label}</div>
      <div class="stat-card-value">${value}</div>${sub ? `<div class="ctrl-stat-sub">${sub}</div>` : ''}</div>`;
  const urgenti = aperti.filter(t => t.priorita === 'urgente');
  return `
    <div class="stat-grid ctrl-stats">
      ${stat('Task aperti', aperti.length, `${coda.length} da assegnare`)}
      <button type="button" class="glass-card stat-card ctrl-stat-link ${Ctrl.soloUrgenti ? 'is-on' : ''}" aria-pressed="${Ctrl.soloUrgenti}" onclick="toggleUrgentTasks()">
        <div class="stat-card-label">Urgenti</div>
        <div class="stat-card-value" style="color:${urgenti.length ? '#dc2626' : 'inherit'};">${urgenti.length}</div>
        <div class="ctrl-stat-sub">${Ctrl.soloUrgenti ? 'Torna alla coda' : 'Vedi la lista'}</div>
      </button>
      ${stat('Arretrati', aperti.filter(t => t.giorno < d).length, 'dai giorni prima')}
      ${stat('Chiusi', chiusi.length, ctrlFmtGiorno(d).toLowerCase())}
    </div>
    ${renderTeamPreview()}
    ${Ctrl.soloUrgenti ? taskGroupOwner('Task urgenti', urgenti, 'Nessun task urgente.') : renderTaskQueue(coda, 'Nessun task in coda.')}`;
}

// Anteprima dei task del giorno di ogni persona: i primi in vista, gli altri a richiesta
const TEAM_PREVIEW_MAX = 5;

function renderTeamPreview() {
  const d = Ctrl.giorno;
  const riga = (t) => `
    <li><button type="button" class="ctrl-preview-task" onclick="openTaskDetail('${t.id}')">
      <i class="${t.stato === 'in_lavorazione' ? 'ctrl-live' : ''}" style="background:${taskStato(t.stato).color};" aria-hidden="true"></i>
      <span>${escapeHtml(t.titolo)}</span>
      ${t.giorno < d ? '<small class="task-late">arretrato</small>' : t.priorita === 'urgente' ? '<small class="task-late">urgente</small>' : ''}
    </button></li>`;
  const card = (nick) => {
    const suoi = Ctrl.tasks.filter(t => t.assegnato_a === nick);
    const delGiorno = suoi.filter(t => t.giorno === d);
    const aperti = sortTasks(suoi.filter(t => !['completato', 'non_completato'].includes(t.stato)));
    const fatti = delGiorno.filter(t => t.stato === 'completato').length;
    const totale = fatti + aperti.length;
    const pct = totale ? Math.round(fatti / totale * 100) : 0;
    const minuti = aperti.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
    return `
      <article class="glass-card ctrl-person ctrl-preview">
        <header>
          <h3>${escapeHtml(nick)}</h3>
          ${Ctrl.assenti.has(nick) && nick !== 'claude' ? '<span class="ctrl-preview-off">Assente</span>' : ''}
        </header>
        <div class="ctrl-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Task completati"><span style="width:${pct}%"></span></div>
        <div class="ctrl-person-meta"><span>${fatti}/${totale} task</span>${minuti ? `<span>${ctrlFmtMin(minuti)} da fare</span>` : ''}</div>
        ${aperti.length ? `<ul>${aperti.slice(0, TEAM_PREVIEW_MAX).map(riga).join('')}</ul>` : `<div class="ctrl-idle">${totale ? 'Tutto fatto' : 'Nessun task'}</div>`}
        ${aperti.length > TEAM_PREVIEW_MAX ? `<details><summary>Altri ${aperti.length - TEAM_PREVIEW_MAX}</summary><ul>${aperti.slice(TEAM_PREVIEW_MAX).map(riga).join('')}</ul></details>` : ''}
      </article>`;
  };
  return `<div class="ctrl-team ctrl-previews" aria-label="Task di ogni persona">${Ctrl.users.slice().sort((a, b) => a.localeCompare(b)).map(card).join('')}</div>`;
}

function toggleUrgentTasks() {
  Ctrl.soloUrgenti = !Ctrl.soloUrgenti;
  refreshControlPage();
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

function taskSub(title, list) {
  if (!list.length) return '';
  return `<div class="ctrl-sub">${title}</div><div class="task-list">${sortTasks(list).map(t => renderTaskRow(t)).join('')}</div>`;
}

// Pulsante di filtro per negozio
// L'animazione parte solo sul filtro appena cliccato, non quando la pagina si aggiorna da sola
const CtrlAnim = { filtro: null };

function ctrlFilter(attivo, label, n, color, onclick) {
  const appena = attivo && CtrlAnim.filtro === label;
  return `<button type="button" class="ctrl-filter ${attivo ? 'is-on' : ''} ${appena ? 'is-just' : ''}" aria-pressed="${attivo}" style="--m:${color || 'var(--text-primary)'};" onclick="CtrlAnim.filtro='${label}';${onclick}">
    ${color ? '<i aria-hidden="true"></i>' : ''}<span>${label}</span>${n != null ? `<b>${n}</b>` : ''}</button>`;
}

// Coda comune con il filtro per macroarea
function renderTaskQueue(coda, emptyText = '') {
  if (!coda.length && !emptyText) return '';
  const conta = (id) => coda.filter(t => t.macroarea === id).length;
  const list = Ctrl.macroarea ? coda.filter(t => t.macroarea === Ctrl.macroarea) : coda;
  const chip = (id, label, n, color) => ctrlFilter(Ctrl.macroarea === id, label, n, color, `setControlMacro(${id ? `'${id}'` : 'null'})`);
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Coda comune</h2><span class="table-count">${list.length}</span>
        <span class="ctrl-group-hint">Non assegnati: li prende chi li inizia</span></div>
      <div class="ctrl-macro-bar" role="group" aria-label="Filtra per macroarea">
        ${chip(null, 'Tutte', coda.length)}
        ${TASK_MACROAREE.map(m => chip(m.id, m.label, conta(m.id), m.color)).join('')}
      </div>
      ${list.length ? `<div class="task-list ${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${sortTasks(list).map(t => renderTaskRow(t)).join('')}</div>`
                    : `<div class="empty-list">${emptyText || 'Nessun task in questa macroarea.'}</div>`}
    </section>`;
}

function setControlMacro(id) {
  Ctrl.macroarea = id;
  refreshControlPage();
}

function renderTaskRow(t, { showOwner = false } = {}) {
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id);
  const lav = taskLavoratoSec(t);
  const scaduto = t.scadenza && !['completato', 'non_completato'].includes(t.stato) && new Date(t.scadenza) < new Date();
  const meta = [
    taskMacro(t.macroarea) ? `<span class="ctrl-macro-tag" style="--m:${taskMacro(t.macroarea).color};">${taskMacro(t.macroarea).label}</span>` : '',
    showOwner ? `<strong>${t.assegnato_a ? escapeHtml(t.assegnato_a) : 'Coda comune'}</strong>` : '',
    t.automazione_errore ? '<span class="task-late">automazione non riuscita</span>' : '',
    t.delega?.da ? `delegato da ${escapeHtml(t.delega.da)}` : '',
    t.bozza_risposta && !t.risposta_inviata_at ? 'bozza pronta' : '',
    t.risposta_inviata_at ? 'risposta inviata' : '',
    tipo ? escapeHtml(tipo.nome) : '',
    `${Icons.clock(12)} ${ctrlFmtMin(t.minuti_stimati)}`,
    t.stato === 'in_lavorazione' ? `<span class="task-timer" data-task-timer="${t.id}">${ctrlFmtDur(lav)}</span>`
      : lav >= 1 ? `lavorato ${ctrlFmtDur(lav)}` : '',
    t.scadenza ? `<span class="${scaduto ? 'task-late' : ''}">entro ${new Date(t.scadenza).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) === t.giorno ? ctrlFmtOra(t.scadenza) : ctrlFmtQuando(t.scadenza)}</span>` : '',
    t.giorno < Ctrl.giorno ? `<span class="task-late">dal ${ctrlFmtGiorno(t.giorno).toLowerCase()}</span>` : '',
    t.rinvii ? `rimandato ${t.rinvii}×` : '',
  ].filter(Boolean).join('<span aria-hidden="true"> · </span>');

  return `
    <article class="task-row ${t.stato === 'completato' ? 'is-done' : ''}" style="--p:${pr.color};--st:${st.color};">
      <button type="button" class="task-main" onclick="openTaskDetail('${t.id}')" aria-label="${escapeHtml(t.titolo)}: dettagli">
        <span class="task-title">${escapeHtml(t.titolo)}</span>
        <span class="task-meta">${meta}</span>
        ${t.motivo && TASK_CON_MOTIVO.includes(t.stato) ? `<span class="task-motivo">${escapeHtml(t.motivo)}</span>` : ''}
      </button>
      ${t.stato === 'da_fare' ? '<span></span>' : `<span class="task-state">${st.label}</span>`}
      <div class="task-actions">${Ctrl.canAct(t) ? taskQuickActions(t) : ''}
        <button class="btn-icon" onclick="openTaskDetail('${t.id}')" aria-label="Altre azioni">${CtrlIcons.more()}</button>
      </div>
    </article>`;
}

function taskQuickActions(t) {
  if (TCAuth.isAdmin()) {
    if (['completato', 'non_completato'].includes(t.stato)) return '';
    return `<select class="ctrl-assign" aria-label="Assegna il task" onchange="taskAssign('${t.id}', this.value)">
      <option value="">${t.assegnato_a ? 'Coda comune' : 'Assegna a…'}</option>
      ${Ctrl.users.map(u => `<option value="${escapeHtml(u)}" ${t.assegnato_a === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
    </select>`;
  }
  const btn = (stato, icon, label, cls = '') =>
    `<button class="ctrl-btn ${cls}" onclick="taskSetStato('${t.id}','${stato}')">${icon} <span>${label}</span></button>`;
  const prendi = !t.assegnato_a ? `<button class="ctrl-btn" onclick="taskPrendi('${t.id}')">${CtrlIcons.hand()} <span>Prendi</span></button>` : '';
  switch (t.stato) {
    case 'in_lavorazione': return btn('in_pausa', CtrlIcons.pause(), 'Pausa') + btn('completato', CtrlIcons.check(), 'Fatto', 'is-primary');
    case 'completato':     return btn('da_fare', CtrlIcons.undo(), 'Riapri');
    case 'non_completato': return btn('da_fare', CtrlIcons.undo(), 'Riapri');
    case 'in_pausa':
    case 'bloccato':       return prendi + btn('in_lavorazione', CtrlIcons.play(), 'Riprendi', 'is-primary');
    default:               return prendi + btn('in_lavorazione', CtrlIcons.play(), 'Inizia', 'is-primary');
  }
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

function renderControlTeam() {
  const d = Ctrl.giorno;
  const people = Ctrl.users;
  const inRitardo = Ctrl.tasks.filter(t => t.assegnato_a && (t.giorno < d
    || (t.scadenza && TASK_APERTI.includes(t.stato) && new Date(t.scadenza) < new Date())));

  const card = (nick) => {
    const list = Ctrl.tasks.filter(t => t.assegnato_a === nick && t.giorno === d);
    const p = Ctrl.punteggi[nick], p7 = Ctrl.punteggi7[nick];
    const fatti = list.filter(t => t.stato === 'completato').length;
    const minTot = p ? p.minuti_assegnati : 0, minFatti = p ? p.minuti_completati : 0;
    const pct = minTot ? Math.min(100, Math.round(minFatti / minTot * 100)) : 0;
    const corrente = Ctrl.tasks.find(t => t.assegnato_a === nick && t.stato === 'in_lavorazione');
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
        <div class="ctrl-person-now">
          ${corrente ? `<span class="ctrl-live" aria-hidden="true"></span> ${escapeHtml(corrente.titolo)}
              <span class="task-timer" data-task-timer="${corrente.id}">${ctrlFmtDur(taskLavoratoSec(corrente))}</span>`
            : `<span class="ctrl-idle">Nessun task in corso</span>`}
        </div>
      </article>`;
  };

  const tutti = Ctrl.tasks.filter(t => t.giorno === d && t.assegnato_a);
  const haTask = (nick) => Ctrl.tasks.some(t => t.assegnato_a === nick);
  const attiviOggi = people.filter(haTask);
  return `
    <div class="ctrl-team">${attiviOggi.map(card).join('')}</div>
    ${renderTeamTable(people)}
    ${taskGroupOwner('In ritardo', inRitardo, '', 'Arretrati dei giorni prima o scadenza passata')}
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
      ${list.length ? `<div class="task-list">${sortTasks(list).map(t => renderTaskRow(t, { showOwner: true })).join('')}</div>`
                    : `<div class="empty-list">${emptyText}</div>`}
    </section>`;
}

// ── Tipi di task (admin) ──

function renderControlTypes() {
  const rows = Ctrl.tipi.map(tp => {
    const r = Ctrl.tempi[tp.id];
    const propone = r && r.campioni >= TASK_CAMPIONI_MIN && Math.round(r.mediana_minuti) !== tp.minuti_standard
      && Math.round(r.mediana_minuti) >= 1;
    const aut = TASK_AUTONOMIA.find(a => a.id === tp.autonomia) || TASK_AUTONOMIA[0];
    return `
      <tr class="${tp.attivo ? '' : 'ctrl-off'}">
        <td><strong>${escapeHtml(tp.nome)}</strong>${tp.descrizione ? `<div class="ctrl-cell-sub">${escapeHtml(tp.descrizione)}</div>` : ''}</td>
        <td>${ctrlFmtMin(tp.minuti_standard)}</td>
        <td>${r ? `${ctrlFmtMin(r.mediana_minuti)} <span class="ctrl-cell-sub">su ${r.campioni}</span>` : '<span class="ctrl-cell-sub">nessun dato</span>'}
          ${propone ? `<button class="ctrl-btn" onclick="applyRealTime('${tp.id}', ${Math.round(r.mediana_minuti)})">Usa ${Math.round(r.mediana_minuti)}′</button>` : ''}</td>
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
        <span class="ctrl-group-hint">Il tempo reale è la mediana degli ultimi 90 giorni; dopo ${TASK_CAMPIONI_MIN} task completati puoi usarlo come standard.</span></div>
      ${Ctrl.tipi.length ? `
        <div class="table-scroll"><table class="data-table ctrl-types">
          <thead><tr><th>Tipo</th><th>Standard</th><th>Reale</th><th>Competenza</th><th>Autonomia</th><th><span class="sr-only">Azioni</span></th></tr></thead>
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
  if (!confirm(`Eliminare il tipo "${tp?.nome}"? I task già creati restano, senza tipo.`)) return;
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

function ctrlModal(html, width = 520) {
  const modal = document.getElementById(CTRL_MODAL);
  modal.innerHTML = `<div class="modal" style="max-width:${width}px;" role="dialog" aria-modal="true" aria-labelledby="ctrl-modal-title">${html}</div>`;
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
  if (_taskMail?.taskId !== id) { _taskMail = null; _taskBozza = t?.bozza_risposta || ''; }
  renderTaskDetail(id, null);
  if (t?.mail_id && !_taskMail) {
    const { data } = await supabaseClient.rpc('tc_task_mail', { p_task: id });
    _taskMail = { taskId: id, mail: data?.success ? data.mail : null };
  }
  try { renderTaskDetail(id, await Ctrl.storico(id)); }
  catch { renderTaskDetail(id, []); }
}

// Mail d'origine, ordini trovati e bozza di risposta
function renderTaskMail(t, can) {
  if (!t.mail_id) return '';
  const m = _taskMail?.taskId === t.id ? _taskMail.mail : null;
  const a = t.analisi || {};
  const ordini = (a.ordini || []).map(o => `${escapeHtml(taskMacro(o.negozio)?.label || o.negozio)} ${escapeHtml(o.numero)}${o.verificato ? '' : ' (email diversa dal mittente)'}`);
  return `
    ${m ? `
      <details class="task-mail">
        <summary><strong>${escapeHtml(m.da_nome || m.da_email || '')}</strong> · ${escapeHtml(m.oggetto || '(senza oggetto)')}</summary>
        <div class="ctrl-cell-sub">${escapeHtml(m.da_email || '')} · ${ctrlFmtQuando(m.ricevuto_at)}${(m.allegati || []).length ? ` · allegati: ${m.allegati.map(x => escapeHtml(x.nome)).join(', ')}` : ''}</div>
        <p>${escapeHtml(m.testo || '(mail senza testo)')}</p>
      </details>` : ''}
    ${ordini.length ? `<div class="ctrl-cell-sub"><strong>Ordini trovati:</strong> ${ordini.join(' · ')}</div>` : ''}
    ${a.dubbi ? `<div class="task-dubbi"><strong>Da controllare:</strong> ${escapeHtml(a.dubbi)}</div>` : ''}
    ${t.risposta_inviata_at ? `
      <div class="task-reply">
        <span class="form-label">Risposta inviata ${ctrlFmtQuando(t.risposta_inviata_at)}</span>
        <p class="task-detail-desc">${escapeHtml(t.bozza_risposta || '')}</p>
      </div>` : can ? `
      <div class="task-reply">
        <label class="form-label" for="task-bozza">Risposta a ${escapeHtml(m?.da_email || 'il cliente')}</label>
        <textarea id="task-bozza" class="form-textarea" rows="9" maxlength="20000"
          oninput="_taskBozza=this.value" placeholder="Scrivi la risposta…">${escapeHtml(_taskBozza ?? '')}</textarea>
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-ghost btn-sm" style="margin-right:auto;" onclick="markTaskSpam('${t.id}')">È spam</button>
          ${TCAuth.isAdmin() ? `<button type="button" class="btn btn-secondary btn-sm" onclick="saveTaskBozza('${t.id}')">Salva bozza</button>` : ''}
          <button type="button" class="btn btn-primary btn-sm" id="task-send" onclick="sendTaskReply('${t.id}')">Invia risposta</button>
        </div>
      </div>` : ''}`;
}

async function markTaskSpam(id) {
  const dest = _taskMail?.taskId === id ? _taskMail.mail?.da_email : '';
  if (!confirm(`Segnare come spam${dest ? ` ${dest}` : ''}? Il task sparisce e il cervello imparerà a scartare mail simili.`)) return;
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
  if (!confirm(`Inviare la risposta a ${dest || 'il cliente'}? Il task verrà completato.`)) return;
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
    showToast(data.copia_in_inviata ? 'Risposta inviata' : 'Risposta inviata (copia in Inviata non riuscita)');
    await Ctrl.load();
    refreshControlPage();
    Ctrl.loadBadge();
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Invia risposta'; }
  }
}

const TASK_ORIGINI = { manuale: 'Inserito a mano', mail: 'Mail', shopify: 'Shopify', gestionale: 'Gestionale', automazione: 'Automazione' };

// Spedizione del task: storico GLS come linea del tempo
function renderTaskShipment(t) {
  const sp = t.analisi?.spedizione;
  if (!sp) return '';
  const quando = (e) => {
    const f = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
    return e.volte > 1 ? `dal ${f(e.dal)} al ${f(e.al)}` : `${f(e.al)} · ${e.al.slice(11, 16)}`;
  };
  return `
    <section class="td-box">
      <div class="td-box-head">
        <h3>Spedizione GLS</h3>
        <span class="td-mono">${escapeHtml(sp.tracking)}</span>
        <a class="ctrl-btn td-push" href="${escapeHtml(sp.url)}" target="_blank" rel="noopener">${Icons.truck(14)} Apri su GLS</a>
      </div>
      ${(sp.storico || []).length ? `<ol class="td-time">${sp.storico.map((e, i) => `
        <li class="${i === 0 ? 'is-now' : ''}">
          <strong>${escapeHtml(e.stato)}</strong>
          <span>${quando(e)}${e.luogo ? ` · ${escapeHtml(e.luogo)}` : ''}</span>
        </li>`).join('')}</ol>` : `<p class="td-empty">GLS non ha ancora dati su questa spedizione.</p>`}
    </section>`;
}

function renderTaskCustomer(t) {
  const c = t.analisi?.cliente;
  if (!c || !(c.email || c.telefono)) return '';
  return `
    <section class="td-box td-customer">
      <div><h3>Cliente</h3><span>${escapeHtml(c.nome || '')}${c.citta ? ` · ${escapeHtml(c.citta)}` : ''}</span></div>
      <div class="td-contacts">
        ${c.telefono ? `<a class="ctrl-btn" href="tel:${escapeHtml(c.telefono)}">${escapeHtml(c.telefono)}</a>` : ''}
        ${c.email ? `<a class="ctrl-btn" href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : ''}
      </div>
    </section>`;
}

function renderTaskDetail(id, storico) {
  const t = Ctrl.get(id);
  if (!t) { closeModal(CTRL_MODAL); return; }
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id), macro = taskMacro(t.macroarea);
  const can = Ctrl.canAct(t);
  const a = _taskAction;
  const chiuso = ['completato', 'non_completato'].includes(t.stato);
  const colleghi = Ctrl.users.filter(u => u !== Ctrl._me() && u !== 'claude' && u !== t.assegnato_a);

  const info = (label, value) => value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '';
  const motivoBtn = (stato, label) => t.stato === stato ? '' :
    `<button type="button" class="td-act" onclick="_taskAction='${stato}';renderTaskDetail('${id}', _taskStoricoCache)">${label}</button>`;
  const tag = (label, color) => `<span class="td-tag" style="--c:${color};">${label}</span>`;

  window._taskStoricoCache = storico;
  ctrlModal(`
    ${ctrlModalHead(escapeHtml(t.titolo))}
    <div class="modal-body td-body">
      <div class="td-tags">
        ${tag(st.label, st.color)}
        ${t.priorita !== 'normale' ? tag(pr.label, pr.color) : ''}
        ${macro ? tag(macro.label, macro.color) : ''}
        ${t.stato === 'in_lavorazione' ? `<span class="task-timer" data-task-timer="${t.id}">${ctrlFmtDur(taskLavoratoSec(t))}</span>` : ''}
      </div>

      ${t.descrizione ? `<p class="td-todo ${t.analisi?.spedizione ? 'is-advice' : ''}">${escapeHtml(t.descrizione)}</p>` : ''}
      ${t.motivo && TASK_CON_MOTIVO.includes(t.stato) ? `<p class="td-todo is-reason"><strong>Motivo:</strong> ${escapeHtml(t.motivo)}</p>` : ''}
      ${t.riferimento ? `<div>${MsgRef.chip(t.riferimento, `closeModal('${CTRL_MODAL}');MsgRef.open(Ctrl.get('${t.id}').riferimento)`)}</div>` : ''}
      ${renderTaskShipment(t)}
      ${renderTaskCustomer(t)}
      ${renderTaskMail(t, can)}

      <dl class="td-info">
        ${info('Assegnato a', t.assegnato_a ? escapeHtml(t.assegnato_a) : 'Coda comune')}
        ${info('Delegato da', t.delega?.da ? `${escapeHtml(t.delega.da)}${t.delega.nota ? ` · ${escapeHtml(t.delega.nota)}` : ''}` : '')}
        ${info('Tipo', tipo ? escapeHtml(tipo.nome) : '')}
        ${info('Automazione non riuscita', t.automazione_errore ? escapeHtml(t.automazione_errore) : '')}
        ${info('Giorno', ctrlFmtGiorno(t.giorno))}
        ${info('Scadenza', t.scadenza ? ctrlFmtQuando(t.scadenza) : '')}
        ${info('Tempo stimato', ctrlFmtMin(t.minuti_stimati))}
        ${info('Tempo lavorato', taskLavoratoSec(t) >= 1 ? ctrlFmtDur(taskLavoratoSec(t)) : '')}
        ${info('Origine', TASK_ORIGINI[t.fonte] || escapeHtml(t.fonte))}
        ${info('Creato', `${ctrlFmtQuando(t.created_at)}${t.creato_da ? ` · ${escapeHtml(t.creato_da)}` : ''}`)}
      </dl>

      ${can && a === 'delega' ? `
        <form class="task-motivo-form" onsubmit="event.preventDefault();submitTaskDelega('${id}')">
          <strong>Delega a un collega</strong>
          <div class="form-group">
            <label class="form-label" for="tm-delega">A chi *</label>
            <select id="tm-delega" class="form-input" required>
              <option value="">Scegli…</option>
              ${colleghi.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="tm-nota">Nota</label>
            <textarea id="tm-nota" class="form-textarea" rows="2" maxlength="300" placeholder="es. tu conosci già questo cliente"></textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="ctrl-btn" onclick="_taskAction=null;renderTaskDetail('${id}', _taskStoricoCache)">Annulla</button>
            <button type="submit" class="ctrl-btn is-primary" id="tm-delega-ok">Delega</button>
          </div>
        </form>` : ''}

      ${can && a && a !== 'delega' ? `
        <form class="task-motivo-form" onsubmit="event.preventDefault();submitTaskMotivo('${id}')">
          <strong>${taskStato(a).label}</strong>
          ${a === 'rimandato' ? `
            <div class="form-group">
              <label class="form-label" for="tm-giorno">A quale giorno</label>
              <input id="tm-giorno" type="date" class="form-input" min="${ctrlAddDays(ctrlOggi(), 1)}" value="${ctrlAddDays(ctrlOggi(), 1)}" required>
            </div>` : ''}
          <div class="form-group">
            <label class="form-label" for="tm-motivo">Motivo *</label>
            <textarea id="tm-motivo" class="form-textarea" rows="2" maxlength="500" required
              placeholder="${a === 'bloccato' ? 'es. in attesa della conferma del cliente' : a === 'rimandato' ? 'es. manca la merce, arriva giovedì' : 'es. il cliente ha annullato'}"></textarea>
          </div>
          <div style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" class="ctrl-btn" onclick="_taskAction=null;renderTaskDetail('${id}', _taskStoricoCache)">Annulla</button>
            <button type="submit" class="ctrl-btn is-primary">Conferma</button>
          </div>
        </form>` : ''}

      ${can && !a ? `
        <div class="td-actions">
          <div class="td-actions-main">
            ${taskQuickActions(t).replaceAll('taskSetStato(', 'taskDetailStato(').replaceAll('taskPrendi(', 'taskDetailPrendi(')}
            ${!chiuso && t.stato !== 'in_lavorazione' ? `<button type="button" class="td-act is-done" onclick="taskDetailStato('${id}','completato')">${CtrlIcons.check()} Completato</button>` : ''}
          </div>
          ${!chiuso ? `<div class="td-actions-more">${motivoBtn('rimandato', 'Rimanda')}${motivoBtn('bloccato', 'Bloccato')}${motivoBtn('non_completato', 'Non completato')}${!TCAuth.isAdmin() && colleghi.length ? motivoBtn('delega', 'Delega') : ''}</div>` : ''}
        </div>` : ''}

      <details class="td-log">
        <summary>Attività del task${storico?.length ? ` · ${storico.length}` : ''}</summary>
        ${storico === null ? `<p class="td-empty">Caricamento…</p>` :
          storico.length ? `<ol>${storico.map(h => `
            <li><span class="task-history-dot" style="background:${taskStato(h.a_stato).color};"></span>
              <span><strong>${h.da_stato === h.a_stato ? 'Delegato' : taskStato(h.a_stato).label}</strong>${h.utente ? ` · ${escapeHtml(h.utente)}` : ''} · ${ctrlFmtQuando(h.at)}
              ${h.motivo && (h.da_stato === h.a_stato || TASK_CON_MOTIVO.includes(h.a_stato)) ? `<em>${escapeHtml(h.motivo)}</em>` : ''}</span></li>`).join('')}</ol>`
          : `<p class="td-empty">Nessun passaggio registrato.</p>`}
      </details>

      ${TCAuth.isAdmin() ? `
        <div class="td-admin">
          <button class="td-link" onclick="openTaskForm('${id}')">${Icons.edit(13)} Modifica</button>
          <button class="td-link is-danger" onclick="removeTask('${id}')">${Icons.trash(13)} Elimina</button>
        </div>` : ''}
    </div>`, 620);

  if (a) setTimeout(() => document.getElementById(a === 'rimandato' ? 'tm-giorno' : a === 'delega' ? 'tm-delega' : 'tm-motivo')?.focus(), 30);
  startControlTicker();
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
  if (!confirm(`Eliminare il task "${t?.titolo}"? Impossibile annullare.`)) return;
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
          ${TASK_MACROAREE.map(m => `<option value="${m.id}" ${(t?.macroarea || (!t && Ctrl.macroarea)) === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}
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
  caselle: null,     // stato delle caselle email (tc_mail_stato)
  mail: null,        // ultime mail scritte da persone
  scartate: [],      // mail scartate dal cervello
  regole: [],        // correzioni del team (mail_regole)
  consegne: null,    // spedizioni con problemi o ritardi (tc_spedizioni_problemi)
  consegneErrore: null,
  arrivo: null,      // ordini ancora da evadere
  arrivoErrore: null,
  ordini: null,      // risultati della ricerca
  query: '',
  negozio: null,     // filtro degli ordini in arrivo (null = tutti)
  negozioGls: null,  // filtro delle spedizioni GLS (null = tutti)
  error: null,
  syncing: new Set(),
};

const SHOP_PAGAMENTO = { PAID: 'Pagato', PENDING: 'In attesa', AUTHORIZED: 'Autorizzato', PARTIALLY_PAID: 'Pagato in parte',
  REFUNDED: 'Rimborsato', PARTIALLY_REFUNDED: 'Rimborsato in parte', VOIDED: 'Annullato', EXPIRED: 'Scaduto' };
const SHOP_EVASIONE = { UNFULFILLED: 'Da evadere', FULFILLED: 'Evaso', PARTIALLY_FULFILLED: 'Evaso in parte', ON_HOLD: 'In sospeso',
  IN_PROGRESS: 'In lavorazione', SCHEDULED: 'Programmato', RESTOCKED: 'Rifornito', PENDING_FULFILLMENT: 'In attesa di evasione', OPEN: 'Aperto' };

const SHOP_DA_EVADERE = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED'];   // come tc_shopify_stato
const SHOP_ORDINE_CAMPI = 'id, store_id, numero, creato_at, annullato_at, cliente, email, telefono, totale, valuta, stato_pagamento, stato_evasione, tracking, righe';

async function loadShopifyLinks() {
  try {
    const { data, error } = await supabaseClient.rpc('tc_shopify_stato');
    if (error) throw Ctrl._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    ShopLinks.negozi = data.negozi || [];
    ShopLinks.error = null;
  } catch (e) { ShopLinks.error = e; }
  const [caselle, mail, scartate, regole, consegne, arrivo] = await Promise.all([
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
  ]);
  ShopLinks.consegneErrore = consegne.error?.message || (consegne.data?.success ? null : consegne.data?.error || 'Errore');
  ShopLinks.consegne = ShopLinks.consegneErrore ? null : consegne.data.spedizioni;
  ShopLinks.arrivoErrore = arrivo.error?.message || null;
  ShopLinks.arrivo = arrivo.error ? null : (arrivo.data || []);
  ShopLinks.regole = regole.error ? [] : (regole.data || []);
  ShopLinks.scartate = scartate.error ? [] : (scartate.data || []);
  ShopLinks.caselle = caselle.data?.success ? caselle.data.caselle : [];
  ShopLinks.mail = mail.error ? [] : (mail.data || []);
  await searchShopifyOrders(ShopLinks.query, false);
  refreshControlPage();
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

// ── Shopify: ordini in arrivo, divisi per negozio ──

function setOrdersStore(id) { ShopLinks.negozio = id; refreshControlPage(); }

function renderControlOrders() {
  const ordine = (o, conNegozio = true) => {
    const track = (o.tracking || []).find(t => t.numero || t.url);
    const righe = (o.righe || []).map(r => `${r.qnt}× ${r.titolo}${r.variante ? ` (${r.variante})` : ''}`).join(' · ');
    return `
      <article class="task-row ctrl-order" style="--p:${o.annullato_at ? '#94a3b8' : o.stato_evasione === 'FULFILLED' ? '#22c55e' : '#f59e0b'};">
        <div class="task-main" style="cursor:default;">
          <span class="task-title">${escapeHtml(o.numero)} · ${escapeHtml(o.cliente || 'Cliente senza nome')}</span>
          <span class="task-meta">${[
            conNegozio && taskMacro(o.store_id) ? `<span class="ctrl-macro-tag" style="--m:${taskMacro(o.store_id).color};">${taskMacro(o.store_id).label}</span>` : '',
            ctrlFmtQuando(o.creato_at),
            o.totale != null ? `${Number(o.totale).toLocaleString('it-IT', { minimumFractionDigits: 2 })} ${o.valuta || ''}` : '',
            SHOP_PAGAMENTO[o.stato_pagamento] || o.stato_pagamento || '',
            o.annullato_at ? '<span class="task-late">Annullato</span>' : (SHOP_EVASIONE[o.stato_evasione] || o.stato_evasione || ''),
            o.email ? escapeHtml(o.email) : '', o.telefono ? escapeHtml(o.telefono) : '',
          ].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</span>
          ${righe ? `<span class="ctrl-row-text">${escapeHtml(righe)}</span>` : ''}
        </div>
        ${track?.url ? `<a class="ctrl-btn" href="${escapeHtml(track.url)}" target="_blank" rel="noopener">${Icons.truck(14)} ${escapeHtml(track.corriere || 'Tracking')}</a>` : '<span></span>'}
      </article>`;
  };
  return `
    <form class="ctrl-search glass-card" onsubmit="event.preventDefault();searchShopifyOrders(this.q.value)" role="search">
      <label class="sr-only" for="shop-q">Cerca ordine</label>
      <input id="shop-q" name="q" class="form-input" value="${escapeHtml(ShopLinks.query)}"
        placeholder="Cerca per email, telefono, nome o numero d'ordine, in tutti i negozi Shopify">
      <button class="ctrl-btn is-primary" type="submit">${Icons.search(14)} Cerca</button>
      ${ShopLinks.query ? `<button class="ctrl-btn" type="button" onclick="searchShopifyOrders('')">Azzera</button>` : ''}
    </form>
    ${ShopLinks.query ? `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Ordini trovati</h2><span class="table-count">${ShopLinks.ordini?.length ?? 0}</span></div>
      ${!ShopLinks.ordini ? `<div class="empty-list">Caricamento…</div>`
        : ShopLinks.ordini.length ? `<div class="task-list">${ShopLinks.ordini.map(o => ordine(o)).join('')}</div>`
        : `<div class="empty-list">Nessun ordine trovato.</div>`}
    </section>` : renderOrdersIncoming(ordine)}`;
}

function renderOrdersIncoming(ordine) {
  const head = (n) => `<div class="page-card-head"><h2>Ordini in arrivo</h2>${n != null ? `<span class="table-count">${n}</span>` : ''}
    <span class="ctrl-group-hint">Da evadere, aggiornati ogni 5 minuti</span></div>`;
  if (ShopLinks.arrivoErrore) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Ordini non caricati: ${escapeHtml(ShopLinks.arrivoErrore)}</div></section>`;
  if (!ShopLinks.arrivo) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Caricamento…</div></section>`;
  const tutti = ShopLinks.arrivo;
  const conta = (id) => tutti.filter(o => o.store_id === id).length;
  const chip = (id, label, n, color) => ctrlFilter(ShopLinks.negozio === id, label, n, color, `setOrdersStore(${id ? `'${id}'` : 'null'})`);
  const gruppi = TASK_MACROAREE.filter(m => (!ShopLinks.negozio || ShopLinks.negozio === m.id) && conta(m.id));
  return `
    <section class="glass-card page-card ctrl-group">
      ${head(tutti.length)}
      <div class="ctrl-macro-bar" role="group" aria-label="Filtra per negozio">
        ${chip(null, 'Tutti', tutti.length)}
        ${TASK_MACROAREE.map(m => chip(m.id, m.label, conta(m.id), m.color)).join('')}
      </div>
      ${gruppi.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${gruppi.map(m => `
        <div class="ctrl-store-head" style="--m:${m.color};"><i aria-hidden="true"></i>${m.label}<b>${conta(m.id)}</b></div>
        <div class="task-list">${tutti.filter(o => o.store_id === m.id).map(o => ordine(o, false)).join('')}</div>`).join('')}</div>`
        : `<div class="empty-list">Nessun ordine in arrivo.</div>`}
    </section>`;
}

// ── GLS: spedizioni con ritardi e problemi ──

function setGlsStore(id) { ShopLinks.negozioGls = id; refreshControlPage(); }

const glsUrl = (numero) => `https://www.gls-italy.com/?option=com_gls&view=track_e_trace&mode=search&diretto=yes&numsped=${encodeURIComponent(numero.slice(2))}&locpartenza=${encodeURIComponent(numero.slice(0, 2))}`;

function renderControlGls() {
  const head = (n) => `<div class="page-card-head"><h2>Spedizioni da seguire</h2>${n != null ? `<span class="table-count">${n}</span>` : ''}
    <span class="ctrl-group-hint">Dallo storico del tracking GLS, controllato ogni ora dalle 7 alle 17</span></div>`;
  if (ShopLinks.consegneErrore) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Spedizioni non caricate: ${escapeHtml(ShopLinks.consegneErrore)}</div></section>`;
  if (!ShopLinks.consegne) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Caricamento…</div></section>`;

  const tutte = ShopLinks.consegne;
  const list = ShopLinks.negozioGls ? tutte.filter(c => c.store_id === ShopLinks.negozioGls) : tutte;
  const chip = (id, label, n, color) => ctrlFilter(ShopLinks.negozioGls === id, label, n, color, `setGlsStore(${id ? `'${id}'` : 'null'})`);
  const sep = '<span aria-hidden="true"> · </span>';
  const riga = (c) => `
    <article class="task-row ctrl-order" style="--p:${c.stato === 'problema' ? '#ef4444' : '#f59e0b'};">
      <div class="task-main" style="cursor:default;">
        <span class="task-title">${escapeHtml(c.problema || '')}</span>
        <span class="task-meta">${[
          `<span class="ctrl-macro-tag" style="--m:${taskMacro(c.store_id)?.color || '#94a3b8'};">${escapeHtml(shopNome(c.store_id))}</span>`,
          `${escapeHtml(c.ordine || '')} ${escapeHtml(c.cliente || '')}`,
          c.citta ? escapeHtml(c.citta) : '',
          c.giorni_testo ? `spedita da ${escapeHtml(c.giorni_testo)}` : '',
          escapeHtml(c.numero),
        ].filter(Boolean).join(sep)}</span>
        ${c.ultimo_evento ? `<span class="ctrl-row-text">${escapeHtml(c.ultimo_evento)}${c.ultimo_at ? ` (${ctrlFmtQuando(c.ultimo_at)})` : ''}</span>` : ''}
        ${c.fare ? `<span class="ctrl-row-text"><strong>Da fare:</strong> ${escapeHtml(c.fare)}</span>` : ''}
        ${c.email || c.telefono ? `<span class="task-meta">${[c.telefono, c.email].filter(Boolean).map(escapeHtml).join(sep)}</span>` : ''}
      </div>
      <div class="ctrl-row-actions">
        ${c.task_id && Ctrl.get(c.task_id) ? `<button class="ctrl-btn" type="button" onclick="openTaskDetail('${c.task_id}')">Apri task</button>` : ''}
        <a class="ctrl-btn" href="${escapeHtml(glsUrl(c.numero))}" target="_blank" rel="noopener">${Icons.truck(14)} GLS</a>
      </div>
    </article>`;
  const gruppo = (titolo, righe) => righe.length ? `<div class="ctrl-sub">${titolo} (${righe.length})</div><div class="task-list">${righe.map(riga).join('')}</div>` : '';
  return `
    <section class="glass-card page-card ctrl-group">
      ${head(tutte.length)}
      <div class="ctrl-macro-bar" role="group" aria-label="Filtra per negozio">
        ${chip(null, 'Tutti', tutte.length)}
        ${TASK_MACROAREE.map(m => chip(m.id, m.label, tutte.filter(c => c.store_id === m.id).length, m.color)).join('')}
      </div>
      ${list.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">
        ${gruppo('Problemi', list.filter(c => c.stato === 'problema'))}
        ${gruppo('Ritardi', list.filter(c => c.stato === 'ritardo'))}
      </div>` : `<div class="empty-list">Nessuna spedizione con ritardi o problemi.</div>`}
    </section>`;
}

// ── Comunicazioni: mail, WhatsApp, social ──

const CtrlComms = { canale: 'mail', macroarea: null };

function setCommsChannel(id) { CtrlComms.canale = id; refreshControlPage(); }
function setCommsMacro(id) { CtrlComms.macroarea = id; refreshControlPage(); }

function renderControlComms() {
  const canali = [['mail', 'Mail'], ['whatsapp', 'WhatsApp'], ['social', 'Social']];
  return `
    <div class="ctrl-bar">
      <div class="segmented" role="tablist" aria-label="Canale">
        ${canali.map(([id, label]) => `<button role="tab" aria-selected="${CtrlComms.canale === id}" class="${CtrlComms.canale === id ? 'active' : ''}" onclick="setCommsChannel('${id}')">${label}</button>`).join('')}
      </div>
    </div>
    ${CtrlComms.canale === 'mail' ? renderCommsMail() : renderCommsPending(CtrlComms.canale)}`;
}

function renderCommsMail() {
  const tutte = ShopLinks.mail || [];
  const list = CtrlComms.macroarea ? tutte.filter(m => m.casella_id === CtrlComms.macroarea) : tutte;
  const chip = (id, label, n, color) => ctrlFilter(CtrlComms.macroarea === id, label, n, color, `setCommsMacro(${id ? `'${id}'` : 'null'})`);
  const riga = (m) => `
    <article class="task-row ctrl-order" style="--p:${taskMacro(m.casella_id)?.color || '#6366f1'};">
      <div class="task-main" style="cursor:default;">
        <span class="task-title">${escapeHtml(m.oggetto || '(senza oggetto)')}</span>
        <span class="task-meta"><span class="ctrl-macro-tag" style="--m:${taskMacro(m.casella_id)?.color || '#6366f1'};">${escapeHtml(shopNome(m.casella_id))}</span><span aria-hidden="true"> · </span>${escapeHtml(m.da_nome || m.da_email || '')}<span aria-hidden="true"> · </span>${ctrlFmtQuando(m.ricevuto_at)}${(m.allegati || []).length ? `<span aria-hidden="true"> · </span>${Icons.paperclip(12)} ${m.allegati.length}` : ''}</span>
        ${m.testo ? `<span class="ctrl-row-text">${escapeHtml(m.testo.slice(0, 220))}${m.testo.length > 220 ? '…' : ''}</span>` : ''}
      </div>
      <span></span>
    </article>`;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Ultime mail dai clienti</h2><span class="table-count">${list.length}</span></div>
      <div class="ctrl-macro-bar" role="group" aria-label="Filtra per negozio">
        ${chip(null, 'Tutte', tutte.length)}
        ${TASK_MACROAREE.map(m => chip(m.id, m.label, tutte.filter(x => x.casella_id === m.id).length, m.color)).join('')}
      </div>
      ${list.length ? `<div class="task-list ${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${list.map(riga).join('')}</div>` : `<div class="empty-list">Nessuna mail.</div>`}
    </section>`;
}

function renderCommsPending(canale) {
  const testi = {
    whatsapp: ['WhatsApp da collegare', 'Qui arriveranno i messaggi dei 4 numeri. Il collegamento parte dopo la verifica di Meta Business.'],
    social: ['Social da collegare', 'Qui arriveranno messaggi e commenti di Instagram e Facebook. Il collegamento parte dopo la verifica di Meta Business.'],
  };
  const [titolo, testo] = testi[canale];
  return `
    <div class="glass-card empty-state">
      <div class="empty-state-icon" aria-hidden="true">${Icons.messageCircle(28)}</div>
      <h2>${titolo}</h2>
      <p>${testo}</p>
    </div>`;
}

// ── Cervello: regole dei negozi, tipi di task, mail scartate, correzioni ──

const REGOLE_SEZIONI = [
  { id: 'spedizioni', label: 'Spedizioni', voci: [['corriere', 'Corriere'], ['preparazione', 'Tempi di preparazione'], ['consegna', 'Tempi di consegna'], ['costi', 'Costi di spedizione'], ['gratuita', 'Spedizione gratuita'], ['destinazioni', 'Dove spediamo'], ['tracking', 'Tracking']] },
  { id: 'resi', label: 'Resi', voci: [['tempo', 'Tempo per chiedere il reso'], ['condizioni', 'Condizioni'], ['esclusi', 'Articoli esclusi'], ['come', 'Come si chiede'], ['indirizzo', 'Indirizzo per i resi'], ['costi', 'Chi paga la spedizione del reso']] },
  { id: 'cambi', label: 'Cambi', voci: [['possibile', 'Si può cambiare?'], ['come', 'Come funziona']] },
  { id: 'rimborsi', label: 'Rimborsi', voci: [['tempi', 'Tempi'], ['metodo', 'Metodo'], ['trattenute', 'Trattenute']] },
  { id: 'ordini', label: 'Ordini', voci: [['modifiche', 'Modifiche e annullamenti'], ['danni', 'Prodotto danneggiato o sbagliato'], ['minimo', 'Quantità minima'], ['personalizzati', 'Prodotti personalizzati']] },
  { id: 'assistenza', label: 'Assistenza', voci: [['orari', 'Orari'], ['firma', 'Firma delle mail'], ['tono', 'Tono delle risposte']] },
];

const CtrlBrain = { sez: 'regole', negozio: TASK_MACROAREE[0].id, regole: null, modificato: false };

async function loadBrainRules() {
  const { data, error } = await supabaseClient.from('negozi_conoscenza').select('store_id, campi, aggiornato_at, aggiornato_da');
  CtrlBrain.regole = error ? {} : Object.fromEntries((data || []).map(r => [r.store_id, r]));
  refreshControlPage();
}

function setBrainSection(id) {
  if (!leaveRulesOk()) return;
  CtrlBrain.sez = id;
  refreshControlPage();
}

function setBrainStore(id) {
  if (!leaveRulesOk()) return;
  CtrlBrain.negozio = id;
  refreshControlPage();
}

function leaveRulesOk() {
  if (CtrlBrain.modificato && !confirm('Ci sono modifiche non salvate alle regole. Uscire senza salvare?')) return false;
  CtrlBrain.modificato = false;
  return true;
}

function renderControlBrain() {
  const sezioni = [['regole', 'Regole dei negozi'], ['tipi', 'Tipi di task'], ['scartate', `Mail scartate · ${ShopLinks.scartate.length}`], ['correzioni', `Correzioni · ${ShopLinks.regole.length}`]];
  const body = CtrlBrain.sez === 'tipi' ? renderControlTypes()
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
    <div class="ctrl-macro-bar ctrl-rule-stores" role="group" aria-label="Negozio">
      ${TASK_MACROAREE.map(m => ctrlFilter(CtrlBrain.negozio === m.id, m.label, null, m.color, `setBrainStore('${m.id}')`)).join('')}
    </div>
    <form onsubmit="event.preventDefault();saveBrainRules()">
      <div class="ctrl-rules">
        ${REGOLE_SEZIONI.map(sez => `
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
        <span class="settings-section-hint" style="margin:0;">Il cervello usa solo questi dati. Se un campo è vuoto lascia un segnaposto da completare.${r.aggiornato_da ? ` Ultima modifica: ${escapeHtml(r.aggiornato_da)}, ${ctrlFmtQuando(r.aggiornato_at)}.` : ''}</span>
        <button class="ctrl-btn is-primary" id="rules-save" type="submit">Salva le regole di ${shopNome(CtrlBrain.negozio)}</button>
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
    </section>`;
}

// ─────────────────────────────────────────────
// PIANO DEL GIORNO (admin)
// ─────────────────────────────────────────────

async function distributeQueue() {
  if (!confirm('Distribuire ora la coda comune tra gli operatori attivi?')) return;
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
    return `
      <tr>
        <td><strong>${escapeHtml(nick)}</strong></td>
        <td>${attivo ? '<span class="ctrl-status" style="--st:#22c55e;">Sì</span>' : '<span class="ctrl-cell-sub">No</span>'}</td>
        <td>${!attivo ? '<span class="ctrl-cell-sub">—</span>' : nick === 'claude' ? 'Tutti i giorni' : ctrlFmtMin(o.minuti_giorno || 420)}</td>
        <td>${prim || sec ? `${prim} primario · ${sec} secondario` : '<span class="ctrl-cell-sub">Nessuna competenza</span>'}</td>
        <td class="ctrl-cell-actions"><button class="ctrl-btn" onclick="openMemberForm('${escapeHtml(nick)}')">Piano</button></td>
      </tr>`;
  };
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Team</h2><span class="table-count">${people.length}</span>
        <span class="ctrl-group-hint">Le competenze si assegnano dalla scheda Competenze</span></div>
      <div class="table-scroll"><table class="data-table ctrl-links">
        <thead><tr><th>Persona</th><th>Nel piano</th><th>Tempo al giorno</th><th>Competenze</th><th><span class="sr-only">Azioni</span></th></tr></thead>
        <tbody>${people.map(riga).join('')}</tbody>
      </table></div>
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
    const persone = a.id === 'automazioni' ? Ctrl.users.filter(nick => nick !== 'claude') : Ctrl.users;
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
        Claude lavora tutti i giorni, gli altri da lunedì a venerdì, festivi esclusi.
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
      </div>`}
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
  const btn = document.getElementById('mb-save');
  btn.disabled = true;
  const { error } = await supabaseClient.from('task_operatori').upsert(row);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); btn.disabled = false; return; }
  closeModal(CTRL_MODAL);
  showToast('Piano salvato');
  await Ctrl.load();
  refreshControlPage();
}

async function removeMailRule(mittente) {
  if (!confirm(`Togliere la correzione per ${mittente}?`)) return;
  const { error } = await supabaseClient.from('mail_regole').delete().eq('mittente', mittente);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); return; }
  await loadShopifyLinks();
}

// ─────────────────────────────────────────────
// REPORT (admin)
// ─────────────────────────────────────────────

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
        <thead><tr><th>Operatore</th><th>Punteggio</th><th>Task</th><th>Minuti standard</th><th>Ore lavorate</th></tr></thead>
        <tbody>${operatori.map(o => `<tr><td><strong>${escapeHtml(o.operatore)}</strong></td><td>${o.punteggio}</td>
          <td>${o.completati}/${o.task}</td><td>${ctrlFmtMin(o.minuti_completati)} / ${ctrlFmtMin(o.minuti_assegnati)}</td>
          <td>${ctrlFmtDur(r.ore?.[o.operatore] || 0)}</td></tr>`).join('')}</tbody>
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
