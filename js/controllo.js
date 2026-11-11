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
];
const COMPETENZE_BASE = ['whatsapp', 'social', 'email', 'bonifico', 'ddt', 'preparazione', 'lavorazione', 'spedizione', 'post_spedizione'];
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
    'lavorazione', 'spedizione', 'post_spedizione', 'evasione',
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

async function setControlView(view) {
  if (!(await leaveRulesOk())) return;
  Ctrl.view = view;
  refreshControlPage();
  loadControlExtras();
}

// Dati delle schede che li caricano quando si aprono
function loadControlExtras() {
  if (['ordini', 'gls', 'comunicazioni', 'cervello', 'collegamenti'].includes(Ctrl.view)) loadShopifyLinks();
  if (Ctrl.view === 'cervello') loadBrainRules();
  if (Ctrl.view === 'report') loadControlReport();
  if (Ctrl.view === 'automazioni') loadControlAutomations();
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

  const tabs = [['giorno', 'Tasks'], ...(TCAuth.isAdmin() ? [['ordini', 'Shop'], ['gls', 'Spedizioni'], ['comunicazioni', 'Comunicazioni'], ['cervello', 'Cervello'], ['collegamenti', 'Collegamenti'], ['automazioni', 'Automazioni'], ['competenze', 'Competenze'], ['squadra', 'Team'], ['report', 'Report']] : [])];
  const body = !Ctrl.loaded ? `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`
    : Ctrl.error ? `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(Ctrl.error.message)}</div></div>`
    : Ctrl.view === 'squadra' ? renderControlTeam()
    : Ctrl.view === 'ordini' ? renderControlOrders()
    : Ctrl.view === 'gls' ? renderControlGls()
    : Ctrl.view === 'comunicazioni' ? renderControlComms()
    : Ctrl.view === 'cervello' ? renderControlBrain()
    : Ctrl.view === 'collegamenti' ? renderControlLinks()
    : Ctrl.view === 'automazioni' ? renderControlAutomations()
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

  const daFare   = delGiorno.filter(t => ['da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'].includes(t.stato));
  const bloccati = delGiorno.filter(t => t.stato === 'bloccato');
  const chiusi   = delGiorno.filter(t => ['completato', 'non_completato'].includes(t.stato));

  const minTot  = delGiorno.filter(t => t.stato !== 'bloccato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);
  const minFatti = delGiorno.filter(t => t.stato === 'completato').reduce((s, t) => s + (t.minuti_stimati || 0), 0);

  // Il negozio si dice una volta sola: sulla riga solo se nella lista ce ne sono diversi
  const aperti = [...daFare, ...arretrati, ...bloccati];
  const negoziLista = new Set(aperti.map(t => t.macroarea || ''));
  const conNegozio = aperti.filter(t => t.macroarea);
  const unicoNegozio = negoziLista.size === 1 ? taskMacro(conNegozio[0]?.macroarea) : null;
  const vedi = (list) => Ctrl.macroarea ? list.filter(t => t.macroarea === Ctrl.macroarea) : list;
  const visibili = vedi(aperti);
  const opts = { showStore: !Ctrl.macroarea && negoziLista.size > 1, showAuto: false };
  const barraNegozi = new Set(conNegozio.map(t => t.macroarea)).size > 1 || Ctrl.macroarea;

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
    <div class="stat-grid ctrl-stats">
      ${stat('Task', `${chiusi.filter(t => t.stato === 'completato').length}/${delGiorno.length}`, 'completati', '#22c55e')}
      ${stat('Tempo stimato', `${ctrlFmtMin(minFatti)} <small>/ ${ctrlFmtMin(minTot)}</small>`, 'dei task completati', '#6366f1')}
      ${stat('Da fare', ctrlFmtMin(minTot - minFatti), 'stima del lavoro che resta', '#f59e0b')}
    </div>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>I miei task</h2><span class="table-count">${visibili.length}</span>
        ${unicoNegozio ? `<span class="ctrl-group-hint ctrl-macro-tag" style="--m:${unicoNegozio.color};">${unicoNegozio.label}</span>` : ''}</div>
      ${barraNegozi ? taskMacroBar(aperti) : ''}
      ${taskAutoNote(visibili)}
      ${taskSub('Da fare', vedi(daFare), opts)}
      ${taskSub('Arretrati', vedi(arretrati), opts)}
      ${taskSub('Bloccati', vedi(bloccati), opts)}
      ${visibili.length ? '' : `<div class="empty-list">${aperti.length ? 'Nessun task per questo negozio.' : d === ctrlOggi() ? 'Niente da fare per oggi.' : 'Nessun task per questo giorno.'}</div>`}
    </section>
    ${renderTaskQueue(coda)}
    ${chiusi.length ? `
      <details class="glass-card page-card ctrl-group ctrl-closed">
        <summary class="page-card-head"><h2>Chiusi</h2><span class="table-count">${chiusi.length}</span></summary>
        <div class="task-list task-stack">${sortTasks(chiusi).map(t => renderTaskRow(t)).join('')}</div>
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

function taskSub(title, list, opts = {}) {
  if (!list.length) return '';
  return `<div class="ctrl-sub">${title}</div><div class="task-list task-stack">${renderTaskItems(list, opts)}</div>`;
}

// Numero d'ordine del task: nel titolo, o nell'analisi se la mail riguarda un ordine solo
function taskOrdine(t) {
  return t.titolo.match(/#\d{3,}/)?.[0] || (t.analisi?.ordini?.length === 1 ? t.analisi.ordini[0].numero : null);
}

// I task dello stesso ordine stanno in un blocco unico, al posto del più importante
function renderTaskItems(list, opts = {}) {
  const ordinati = sortTasks(list);
  const chiave = (t) => { const n = taskOrdine(t); return n ? `${t.macroarea || ''}|${n}` : null; };
  const gruppi = new Map();
  ordinati.forEach(t => { const k = chiave(t); if (k) gruppi.set(k, [...(gruppi.get(k) || []), t]); });
  const mostrati = new Set();
  return ordinati.map(t => {
    const k = chiave(t), g = k && gruppi.get(k);
    if (!g || g.length < 2) return renderTaskRow(t, opts);
    if (mostrati.has(k)) return '';
    mostrati.add(k);
    return renderTaskOrder(g, opts);
  }).join('');
}

function renderTaskOrder(g, opts) {
  const primo = (fn) => g.map(fn).find(Boolean);
  const cliente = primo(t => t.analisi?.cliente?.nome) || primo(t => t.titolo.match(/·\s*ordine\s+#\d+\s*·\s*(.+)$/i)?.[1]);
  const situazione = primo(t => t.analisi?.spedizione?.storico?.[0]?.stato);
  const negozio = opts.showStore ? taskMacro(g[0].macroarea) : null;
  const minuti = g.reduce((n, t) => n + (t.minuti_stimati || 0), 0);
  return `
    <section class="task-order" aria-label="Ordine ${escapeHtml(taskOrdine(g[0]))}">
      <header class="task-order-head">
        <strong>${escapeHtml(taskOrdine(g[0]))}</strong>
        ${cliente ? `<span class="task-order-who">${escapeHtml(cliente)}</span>` : ''}
        ${negozio ? `<span class="ctrl-macro-tag" style="--m:${negozio.color};">${negozio.label}</span>` : ''}
        ${situazione ? `<span class="task-order-state">GLS · ${escapeHtml(situazione)}</span>` : ''}
        <span class="task-order-sum">${g.length} task${minuti ? ` · ${ctrlFmtMin(minuti)}` : ''}</span>
      </header>
      <div class="task-order-rows">${g.map(t => renderTaskRow(t, { ...opts, showStore: false,
        titolo: t.titolo.replace(/\s*·\s*ordine\s+#\d+(\s*·\s*[^·]+)?$/i, '') })).join('')}</div>
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
  const appena = attivo && CtrlAnim.filtro === label;
  return `<button type="button" class="ctrl-filter ${attivo ? 'is-on' : ''} ${appena ? 'is-just' : ''}" aria-pressed="${attivo}" style="--m:${color || 'var(--text-primary)'};" onclick="CtrlAnim.filtro='${label}';${onclick}">
    ${color ? '<i aria-hidden="true"></i>' : ''}<span>${label}</span>${n != null ? `<b>${n}</b>` : ''}</button>`;
}

// Coda comune con il filtro per macroarea
function renderTaskQueue(coda, emptyText = '') {
  if (!coda.length && !emptyText) return '';
  const list = Ctrl.macroarea ? coda.filter(t => t.macroarea === Ctrl.macroarea) : coda;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Coda comune</h2><span class="table-count">${list.length}</span>
        <span class="ctrl-group-hint">Non assegnati: li prende chi li fa</span></div>
      ${taskMacroBar(coda)}
      ${taskAutoNote(list)}
      ${list.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${taskSections(list).map(([titolo, righe]) =>
          taskSub(`${titolo} · ${righe.length}`, righe, { showStore: !Ctrl.macroarea, showAuto: false })).join('')}</div>`
                    : `<div class="empty-list">${emptyText || 'Nessun task in questa macroarea.'}</div>`}
    </section>`;
}

// Un task è in ritardo se la scadenza è passata o se arriva dai giorni prima
const taskInRitardo = (t) => (t.scadenza && new Date(t.scadenza) < new Date()) || t.giorno < Ctrl.giorno;

// La coda divisa per urgenza; i task dello stesso ordine restano insieme, nella sezione del più importante
function taskSections(list) {
  const livello = (t) => t.priorita === 'urgente' ? 0 : taskInRitardo(t) ? 1 : 2;
  const chiave = (t) => { const n = taskOrdine(t); return n ? `${t.macroarea || ''}|${n}` : t.id; };
  const min = new Map();
  list.forEach(t => { const k = chiave(t); min.set(k, Math.min(min.get(k) ?? 9, livello(t))); });
  return [['Urgenti', 0], ['In ritardo', 1], ['Da fare', 2]]
    .map(([titolo, n]) => [titolo, list.filter(t => min.get(chiave(t)) === n)])
    .filter(([, righe]) => righe.length);
}

function taskMacroBar(list) {
  const conta = (id) => list.filter(t => t.macroarea === id).length;
  const chip = (id, label, n, color) => ctrlFilter(Ctrl.macroarea === id, label, n, color, `setControlMacro(${id ? `'${id}'` : 'null'})`);
  return `
    <div class="ctrl-macro-bar" role="group" aria-label="Filtra per macroarea">
      ${chip(null, 'Tutte', list.length)}
      ${TASK_MACROAREE.map(m => chip(m.id, m.label, conta(m.id), m.color)).join('')}
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
    showStore && taskMacro(t.macroarea) ? `<span class="ctrl-macro-tag" style="--m:${taskMacro(t.macroarea).color};">${taskMacro(t.macroarea).label}</span>` : '',
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
        ${t.motivo && TASK_CON_MOTIVO.includes(t.stato) ? `<span class="task-motivo">${escapeHtml(t.motivo)}</span>` : ''}
      </button>
      <div class="task-badges">${badges}</div>
      <span class="task-time">${t.minuti_stimati ? `${Icons.clock(12)} ${ctrlFmtMin(t.minuti_stimati)}` : ''}</span>
      <div class="task-actions">${Ctrl.canAct(t) ? taskQuickActions(t) : ''}
        <button class="btn-icon" onclick="openTaskDetail('${t.id}')" aria-label="Altre azioni">${CtrlIcons.more()}</button>
      </div>
    </article>`;
}

function taskQuickActions(t, { fatto = true } = {}) {
  if (TCAuth.isAdmin()) {
    if (['completato', 'non_completato'].includes(t.stato)) return '';
    return `<select class="ctrl-assign" aria-label="Assegna il task" onchange="taskAssign('${t.id}', this.value)">
      <option value="">${t.assegnato_a ? 'Coda comune' : 'Assegna a…'}</option>
      ${Ctrl.users.map(u => `<option value="${escapeHtml(u)}" ${t.assegnato_a === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
    </select>`;
  }
  const btn = (stato, icon, label, cls = '') =>
    `<button class="ctrl-btn ${cls}" onclick="taskSetStato('${t.id}','${stato}')">${icon} <span>${label}</span></button>`;
  const primo = Ctrl._prossimo === t.id ? 'is-primary' : '';
  const prendi = !t.assegnato_a ? `<button class="ctrl-btn" onclick="taskPrendi('${t.id}')">${CtrlIcons.hand()} <span>Prendi</span></button>` : '';
  if (['completato', 'non_completato'].includes(t.stato)) return btn('da_fare', CtrlIcons.undo(), 'Riapri');
  return prendi + (fatto ? btn('completato', CtrlIcons.check(), 'Fatto', primo) : '');
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
  if (tracking) {
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
  const ordini = (t.analisi?.ordini || []).map(o => `${escapeHtml(taskMacro(o.negozio)?.label || o.negozio)} ${escapeHtml(o.numero)}${o.verificato ? '' : o.trovato_con === 'telefono' ? ' (stesso telefono, email diversa)' : ' (email diversa dal mittente)'}`);
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
  }[c.stato] || '';
  const col = ct ? `<button type="button" class="ctrl-btn is-primary" onclick="apriTaskCollegato()">${ct._tipo === 'svincolo' ? `${Icons.truck(14)} Vai alle istruzioni GLS` : 'Vai alla mail del cliente'}</button>` : '';
  return `
    <section class="td-box td-contatto is-${escapeHtml(c.stato)}">
      <p class="td-todo">${testo}</p>
      ${['chiamare', 'senza_email'].includes(c.stato) || c.telefono || col ? `<div class="td-contacts">${col}${['chiamare', 'senza_email'].includes(c.stato) || c.telefono ? tel : ''}</div>` : ''}
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

  const motivoBtn = (stato, label) => t.stato === stato ? '' :
    `<button type="button" class="td-link" onclick="_taskAction='${stato}';renderTaskDetail('${id}', _taskStoricoCache)">${label}</button>`;
  const mail = taskMailParts(t, can);
  const sped = renderTaskShipment(t);
  // Colonna destra: la risposta se il task nasce da una mail, altrimenti la spedizione
  const destra = mail ? mail.risposta : sped;
  const split = !!destra;
  const sep = '<span aria-hidden="true">·</span>';
  const meta = [
    macro ? `<span class="td-store" style="--m:${macro.color};"><i></i>${macro.label}</span>` : '',
    t.priorita !== 'normale' ? `<span style="color:${pr.color};font-weight:700;">${pr.label}</span>` : '',
    !['da_fare', 'in_lavorazione', 'in_pausa'].includes(t.stato) ? `<span style="color:${st.color};font-weight:700;">${st.label}</span>` : '',
    `<span>${Icons.clock(12)} ${ctrlFmtMin(t.minuti_stimati)} stimati</span>`,
    tipo ? `<span>${escapeHtml(tipo.nome)}</span>` : '',
    t.scadenza ? `<span>entro ${ctrlFmtQuando(t.scadenza)}</span>` : '',
    t.giorno !== ctrlOggi() ? `<span>${ctrlFmtGiorno(t.giorno)}</span>` : '',
  ].filter(Boolean).join(sep);
  const fatti = [
    t.assegnato_a !== Ctrl._me() ? (t.assegnato_a ? `Assegnato a ${escapeHtml(t.assegnato_a)}` : 'Coda comune') : '',
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
        ${t.descrizione ? `<section class="td-sec"><h3>Cosa fare</h3><p class="td-todo">${escapeHtml(t.descrizione)}</p></section>` : ''}
        ${t.motivo && TASK_CON_MOTIVO.includes(t.stato) ? `<p class="td-todo is-reason"><strong>Motivo:</strong> ${escapeHtml(t.motivo)}</p>` : ''}
        ${t.analisi?.dubbi ? `<p class="td-todo is-advice"><strong>Da controllare:</strong> ${escapeHtml(t.analisi.dubbi)}</p>` : ''}
        ${renderTaskContatto(t)}
        ${t.analisi?.rimborso ? `<p class="td-todo is-advice"><strong>Rimborso richiesto:</strong> va gestito a mano.</p>` : ''}
        ${t.analisi?.note ? `<p class="td-todo is-note"><strong>Note:</strong> ${escapeHtml(t.analisi.note)}</p>` : ''}
        ${renderTaskSvincolo(t, can)}
        ${t.riferimento ? `<div>${MsgRef.chip(t.riferimento, `closeModal('${CTRL_MODAL}');MsgRef.open(Ctrl.get('${t.id}').riferimento)`)}</div>` : ''}
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
                  ${h.motivo && (h.da_stato === h.a_stato || TASK_CON_MOTIVO.includes(h.a_stato)) ? `<em>${escapeHtml(h.motivo)}</em>` : ''}</span></li>`).join('')}</ol>`
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
  negozioGls: null,  // filtro delle spedizioni GLS (null = tutti)
  error: null,
  syncing: new Set(),
};

const SHOP_PAGAMENTO = { PAID: 'Pagato', PENDING: 'In attesa', AUTHORIZED: 'Autorizzato', PARTIALLY_PAID: 'Pagato in parte',
  REFUNDED: 'Rimborsato', PARTIALLY_REFUNDED: 'Rimborsato in parte', VOIDED: 'Annullato', EXPIRED: 'Scaduto' };
const SHOP_EVASIONE = { UNFULFILLED: 'Da evadere', FULFILLED: 'Evaso', PARTIALLY_FULFILLED: 'Evaso in parte', ON_HOLD: 'In sospeso',
  IN_PROGRESS: 'In lavorazione', SCHEDULED: 'Programmato', RESTOCKED: 'Rifornito', PENDING_FULFILLMENT: 'In attesa di evasione', OPEN: 'Aperto' };

const SHOP_DA_EVADERE = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED'];   // come tc_shopify_stato
const SHOP_ORDINE_CAMPI = 'id, store_id, numero, creato_at, annullato_at, cliente, email, telefono, totale, valuta, stato_pagamento, stato_evasione, tracking, righe, indirizzo';

// Richieste dei dati mancanti ancora aperte (ordini-dati, o mandate a mano): ordine → richiesta
async function loadRichiesteDati(render = true) {
  const [{ data, error }, ver] = await Promise.all([
    supabaseClient.from('ordini_richieste_dati').select('ordine_id, inviata_at, inviata_da, esito, task_id').is('risolta_at', null),
    // Solo gli esiti da mostrare; gli ordini spediti non contano
    supabaseClient.from('ordini_verifiche').select('ordine_id, esito, nota, suggerimento, prima, dopo, corretta_at')
      .in('esito', ['corretta', 'simile', 'ambigua', 'non_trovata']).gte('verificata_at', new Date(Date.now() - 30 * 86400e3).toISOString()),
  ]);
  ShopLinks.richieste = new Map(error ? [] : (data || []).map(r => [r.ordine_id, r]));
  ShopLinks.verifiche = new Map(ver.error ? [] : (ver.data || []).map(r => [r.ordine_id, r]));
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
const ctrlStoreBar = (attivo, conta, totale, label, set) => `
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
    `<span class="td-tag" style="--c:${x.colore};" title="${escapeHtml(x.titolo)}">${escapeHtml(x.testo)}</span>`).join('');
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
function ordProblemi(o) {
  const out = [];                                   // [campo, testo]
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

// Mail con il dominio scritto male: "gmial.com", "hotmail.it" va bene, "libero.ir" no
const ORD_DOMINI = ['gmail.com', 'hotmail.com', 'hotmail.it', 'libero.it', 'yahoo.it', 'yahoo.com', 'icloud.com', 'outlook.it', 'outlook.com',
  'live.it', 'live.com', 'alice.it', 'virgilio.it', 'tiscali.it', 'tin.it', 'msn.com', 'me.com', 'email.it', 'fastwebnet.it', 'pec.it', 'aruba.it', 'inwind.it', 'katamail.com'];
function ordMailSospetta(email) {
  const d = String(email || '').toLowerCase().split('@')[1];
  if (!d) return null;
  if (ORD_DOMINI.includes(d)) return null;
  if (/\.(con|cmo|ocm|co|comm|itt|ir|tt)$/.test(d) && !/\.co\.\w+$/.test(d)) {
    const giusto = ORD_DOMINI.find(x => x.split('.')[0] === d.split('.')[0]);
    if (giusto || /\.(con|cmo|ocm|comm|itt)$/.test(d)) return giusto || d.replace(/\.\w+$/, '.com');
  }
  // Una o due lettere di differenza da un dominio comune
  const dist = (a, b) => {
    const r = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) { let p = r[0]; r[0] = i; for (let j = 1; j <= b.length; j++) { const t = r[j]; r[j] = Math.min(r[j] + 1, r[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } }
    return r[b.length];
  };
  // I domini corti si somigliano tutti (tim.it, tin.it): niente confronto
  if (d.length < 7) return null;
  return ORD_DOMINI.find(x => { const k = dist(d, x); return k > 0 && k <= (x.length > 8 ? 2 : 1); }) || null;
}

// Avvisi da far valutare a una persona: indirizzo riscontrato sulle mappe, mail forse sbagliata
function ordAvvisi(o) {
  const out = [];
  const v = ShopLinks.verifiche.get(o.id);
  if (v) {
    if (v.esito === 'corretta' && v.corretta_at) out.push({ campo: 'ind', colore: '#16a34a', testo: 'Via corretta', titolo: `Corretta in automatico su Shopify: "${v.prima}" → "${v.dopo}"`, avviso: false });
    else if (v.esito === 'corretta') out.push({ campo: 'ind', colore: '#d97706', testo: `Forse "${v.dopo}"`, titolo: `${v.nota}. Non corretta su Shopify`, avviso: true });
    else if (v.esito === 'simile') out.push({ campo: 'ind', colore: '#d97706', testo: `Forse ${v.suggerimento}`, titolo: `${v.nota} (riscontro sulle mappe)`, avviso: true });
    else if (v.esito === 'ambigua') out.push({ campo: 'ind', colore: '#d97706', testo: 'Via o piazza?', titolo: v.nota, avviso: true });
    else if (v.esito === 'non_trovata') out.push({ campo: 'ind', colore: '#d97706', testo: 'Via non trovata', titolo: `${v.nota} (riscontro sulle mappe: controlla prima di spedire)`, avviso: true });
  }
  const m = ordMailSospetta(o.email);
  if (m) out.push({ campo: 'mail', colore: '#d97706', testo: `Forse @${m}`, titolo: `La mail ${o.email} sembra scritta male: forse @${m}`, avviso: true });
  return out;
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

// Mail pronta per chiedere i dati che mancano per spedire: telefono, indirizzo, o tutti e due
const ORD_MANCA = { 'Manca il numero civico': 'il numero civico', 'Manca il CAP': 'il CAP', 'CAP non valido': 'il CAP corretto',
  'Manca la città': 'la città', 'Manca la provincia': 'la provincia' };
function ordineRichiediDati(id) {
  const o = ctrlOrdiniVisti.get(id);
  if (!o) return;
  const probs = ordProblemi(o);
  const tel = probs.some(p => p[0] === 'tel');
  const ind = probs.filter(p => p[0] === 'ind').map(p => p[1]);
  const nome = String(o.indirizzo?.nome || o.cliente || '').trim().split(/\s+/)[0];
  const elenco = (v) => v.length > 1 ? `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}` : v[0];
  const righe = [`${nome ? `Ciao ${nome}` : 'Ciao'},`, '', `grazie per il tuo ordine ${o.numero}! Lo stiamo preparando, ma prima di spedirlo ci serve un aiuto.`, ''];
  if (ind.includes('Manca l\'indirizzo')) righe.push('Nell\'ordine non è arrivato l\'indirizzo di spedizione: ci scrivi via, numero civico, CAP, città e provincia?');
  else if (ind.length) {
    righe.push(`Nell'indirizzo di spedizione che ci hai lasciato manca ${elenco(ind.map(t => ORD_MANCA[t] || t.toLowerCase()))}:`, '', ctrlIndirizzo(o.indirizzo), '',
      'Ci rispondi con l\'indirizzo completo? Così il corriere riesce a consegnare senza intoppi.');
  }
  if (tel) {
    if (ind.length) righe.push('');
    righe.push(`${ind.length ? 'Ci serve anche' : 'Ci serve'} un numero di telefono: il corriere lo usa per avvisarti della consegna e per contattarti se non ti trova.`);
  }
  righe.push('', 'Appena ci rispondi spediamo. Grazie!');
  const cosa = ind.length && tel ? 'ci servono l\'indirizzo completo e il telefono' : ind.length ? 'ci serve l\'indirizzo completo' : 'ci serve il tuo numero di telefono';
  ordineScriviMail(id, { oggetto: `Ordine ${o.numero}: ${cosa} per spedire`, corpo: righe.join('\n') });
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
  return `
    <form class="ctrl-search glass-card" onsubmit="event.preventDefault();searchShopifyOrders(this.q.value)" role="search">
      <label class="sr-only" for="shop-q">Cerca ordine</label>
      <input id="shop-q" name="q" class="form-input" value="${escapeHtml(ShopLinks.query)}"
        placeholder="Cerca per email, telefono, nome o numero d'ordine, in tutti i negozi Shopify">
      <button class="ctrl-btn is-primary" type="submit">${Icons.search(14)} Cerca</button>
      ${ShopLinks.query ? `<button class="ctrl-btn" type="button" onclick="searchShopifyOrders('')">Azzera</button>` : ''}
    </form>
    ${ShopLinks.query ? `
    <section class="glass-card page-card ctrl-group ctrl-ord-card">
      <div class="page-card-head"><h2>Ordini trovati</h2><span class="table-count">${ShopLinks.ordini?.length ?? 0}</span>
        <span class="ctrl-group-hint">Per «${escapeHtml(ShopLinks.query)}», in tutti i negozi, anche evasi</span></div>
      ${!ShopLinks.ordini ? `<div class="empty-list">Caricamento…</div>`
        : ShopLinks.ordini.length ? `<div class="ctrl-table">${ORD_COLONNE}${ShopLinks.ordini.map(o => ctrlShopOrderRow(o)).join('')}</div>`
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
      ${head(tutti.length)}
      ${ctrlStoreBar(ShopLinks.negozio, conta, tutti.length, 'Tutti', 'setOrdersStore')}
      ${vis.length ? `
        <div class="ctrl-kpis" role="group" aria-label="Filtra gli ordini">
          ${box('oggi')}${box('tutti')}${box('nonpagati', 'is-alert')}${box('problemi', 'is-alert')}
        </div>
        ${vista === 'problemi' && gruppiVis.length ? `<p class="ctrl-kpi-hint">Indirizzi senza civico, CAP, città o provincia e telefoni mancanti, da sistemare prima di spedire. In rosso da chiedere, in arancione già chiesti al cliente. Dopo la spedizione i problemi passano in Spedizioni.</p>` : ''}` : ''}
      ${gruppiVis.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${gruppiVis.map(m => `
        <div class="ctrl-store-head" style="--m:${m.color};"><i aria-hidden="true"></i>${m.label}<b>${elenco(m.id).length}</b></div>
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
        <small class="ctrl-macro-tag" style="--m:${taskMacro(c.store_id)?.color || '#94a3b8'};">${ctrlDot(c.store_id)} ${escapeHtml(shopNome(c.store_id))}${c.citta ? ` <span>· ${escapeHtml(c.citta)}</span>` : ''}</small>
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

function renderControlGls() {
  const head = (n) => `<div class="page-card-head"><h2>Spedizioni da seguire</h2>${n != null ? `<span class="table-count">${n}</span>` : ''}
    <span class="ctrl-group-hint">Tracking GLS controllato ogni ora, dalle 7 alle 17</span></div>`;
  if (ShopLinks.consegneErrore) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Spedizioni non caricate: ${escapeHtml(ShopLinks.consegneErrore)}</div></section>`;
  if (!ShopLinks.consegne) return `<section class="glass-card page-card ctrl-group">${head()}<div class="empty-list">Caricamento…</div></section>`;

  const tutte = ShopLinks.consegne;
  const list = ShopLinks.negozioGls ? tutte.filter(c => c.store_id === ShopLinks.negozioGls) : tutte;
  const problemi = list.filter(c => c.stato === 'problema');
  const ritardi = list.filter(c => c.stato === 'ritardo');

  // I problemi uguali stanno insieme: titolo e "da fare" si scrivono una volta sola
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
  const conTask = list.filter(c => c.task_id).length;
  return `
    <section class="glass-card page-card ctrl-group">
      ${head(tutte.length)}
      ${ctrlStoreBar(ShopLinks.negozioGls, (id) => tutte.filter(c => c.store_id === id).length, tutte.length, 'Tutti', 'setGlsStore')}
      ${list.length ? `
        <div class="ctrl-kpis">
          ${ctrlKpi('Problemi', problemi.length, problemi.length ? 'is-alert' : '')}
          ${ctrlKpi('Ritardi', ritardi.length, ritardi.length ? 'is-warn' : '')}
          ${ctrlKpi('Con un task aperto', conTask)}
          ${ctrlKpi('Senza task', list.length - conTask)}
        </div>
        <div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">
          ${gruppiProblemi.map(([titolo, righe]) => gruppo(titolo, righe, '#ef4444')).join('')}
          ${ritardi.length ? gruppo('Ritardi', ritardi, '#f59e0b', true) : ''}
        </div>` : `<div class="empty-list">Nessuna spedizione con ritardi o problemi.</div>`}
    </section>`;
}

// ── Comunicazioni: mail, WhatsApp, social ──

const CtrlComms = { canale: 'mail', macroarea: null, esito: null };

function setCommsChannel(id) { CtrlComms.canale = id; refreshControlPage(); }
function setCommsMacro(id) { CtrlComms.macroarea = id; refreshControlPage(); }
function setCommsEsito(id) { CtrlComms.esito = id; refreshControlPage(); }

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

// Cosa ne ha fatto il cervello: task aperto, gestita, scartata, ancora da leggere
const MAIL_ESITI = {
  aperta:   { label: 'Task aperto',  color: '#f59e0b' },
  gestita:  { label: 'Gestita',      color: '#16a34a' },
  scartata: { label: 'Scartata',     color: '#94a3b8' },
  attesa:   { label: 'Da analizzare', color: '#6366f1' },
};
function mailEsito(m) {
  const e = ShopLinks.mailEsiti?.[m.id];
  if (!e) return null;
  if (!e.elaborato_at) return { id: 'attesa' };
  if (e.task) return { id: ['completato', 'non_completato'].includes(e.task.stato) ? 'gestita' : 'aperta', task: e.task };
  if (e.task_id) return { id: 'gestita' };   // task eliminato
  return { id: 'scartata', motivo: (e.esito || '').replace(/^Scartata[^:]*:\s*/, ''), evento: e.id };
}

function renderMailRow(m) {
  const es = mailEsito(m), def = es && MAIL_ESITI[es.id];
  const anteprima = (m.testo || '').replace(/\s+/g, ' ').trim();
  return `
    <article class="ctrl-trow ctrl-mailrow">
      <div class="ctrl-cell"><strong class="ctrl-num">${ctrlFmtOra(m.ricevuto_at)}</strong></div>
      <div class="ctrl-cell">
        <strong>${escapeHtml(m.da_nome || m.da_email || 'Mittente sconosciuto')}</strong>
        ${m.da_nome && m.da_email ? `<small>${escapeHtml(m.da_email)}</small>` : ''}
        <small class="ctrl-macro-tag" style="--m:${taskMacro(m.casella_id)?.color || '#6366f1'};">${ctrlDot(m.casella_id)} ${escapeHtml(shopNome(m.casella_id))}</small>
      </div>
      <div class="ctrl-cell">
        <strong>${escapeHtml(m.oggetto || '(senza oggetto)')}${(m.allegati || []).length ? ` <span class="ctrl-clip" title="${m.allegati.length} allegati">${Icons.paperclip(12)} ${m.allegati.length}</span>` : ''}</strong>
        ${anteprima ? `<span class="ctrl-preview-text">${escapeHtml(anteprima.slice(0, 300))}</span>` : ''}
      </div>
      <div class="ctrl-cell ctrl-cell-act">
        ${def ? `<span class="td-tag" style="--c:${def.color};" ${es.motivo ? `title="${escapeHtml(es.motivo)}"` : ''}>${def.label}</span>` : ''}
        ${es?.task ? `<small>${es.task.assegnato_a ? `a ${escapeHtml(es.task.assegnato_a)}` : 'in coda comune'}</small>` : ''}
        ${es?.motivo ? `<small class="ctrl-why">${escapeHtml(es.motivo)}</small>` : ''}
        ${es?.task && Ctrl.get(es.task.id) ? `<button class="ctrl-btn" type="button" onclick="openTaskDetail('${es.task.id}')">Apri task</button>` : ''}
        ${es?.evento ? `<button class="ctrl-btn" type="button" onclick="recoverDiscarded('${es.evento}')">Recupera</button>` : ''}
      </div>
    </article>`;
}

function renderCommsMail() {
  const tutte = ShopLinks.mail || [];
  const delNegozio = CtrlComms.macroarea ? tutte.filter(m => m.casella_id === CtrlComms.macroarea) : tutte;
  const conEsito = (id) => delNegozio.filter(m => mailEsito(m)?.id === id);
  const list = CtrlComms.esito ? conEsito(CtrlComms.esito) : delNegozio;
  const esitoChip = (id, label, n, color = null) => ctrlFilter(CtrlComms.esito === id, label, n, color, `setCommsEsito(${id ? `'${id}'` : 'null'})`);
  // Divise per giorno, dalla più recente
  const giorni = new Map();
  list.forEach(m => { const g = ctrlGiornoDi(m.ricevuto_at); giorni.set(g, [...(giorni.get(g) || []), m]); });
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Mail dai clienti</h2><span class="table-count">${tutte.length}</span>
        <span class="ctrl-group-hint">Le ultime 50, senza le mail automatiche</span></div>
      ${ctrlStoreBar(CtrlComms.macroarea, (id) => tutte.filter(x => x.casella_id === id).length, tutte.length, 'Tutte', 'setCommsMacro')}
      <div class="ctrl-macro-bar ctrl-esiti" role="group" aria-label="Filtra per esito">
        ${esitoChip(null, 'Tutti gli esiti', delNegozio.length)}
        ${Object.entries(MAIL_ESITI).map(([id, e]) => esitoChip(id, e.label, conEsito(id).length, e.color)).join('')}
      </div>
      ${list.length ? `<div class="${CtrlAnim.filtro ? 'ctrl-fade' : ''}">${[...giorni.entries()].map(([g, righe]) => `
        <div class="ctrl-sub">${ctrlFmtGiorno(g)} · ${righe.length}</div>
        <div class="ctrl-table">${righe.map(renderMailRow).join('')}</div>`).join('')}</div>`
        : `<div class="empty-list">Nessuna mail.</div>`}
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

async function setBrainSection(id) {
  if (!(await leaveRulesOk())) return;
  CtrlBrain.sez = id;
  refreshControlPage();
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
        <span class="settings-section-hint" style="margin:0;">Il cervello usa solo questi dati. Se un campo è vuoto, la bozza non cita quel dato.${r.aggiornato_da ? ` Ultima modifica: ${escapeHtml(r.aggiornato_da)}, ${ctrlFmtQuando(r.aggiornato_at)}.` : ''}</span>
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
    return `
      <tr>
        <td><strong>${escapeHtml(nick)}</strong></td>
        <td>${attivo ? '<span class="ctrl-status" style="--st:#22c55e;">Sì</span>' : '<span class="ctrl-cell-sub">No</span>'}</td>
        <td>${!attivo ? '<span class="ctrl-cell-sub">—</span>' : nick === 'claude' ? 'Senza limite' : ctrlFmtMin(o.minuti_giorno || 420)}</td>
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
  'avviso-giacenza': { nome: 'Mail ai clienti per le giacenze', quando: 'Ogni ora, anche nel weekend' },
  'richiesta-dati': { nome: 'Richiesta dei dati mancanti', quando: 'Ogni 5 minuti; mail dalle 8 alle 21', modo: true },
  'verifica-indirizzi': { nome: 'Riscontro degli indirizzi', quando: 'Ogni 5 minuti, sugli ordini nuovi', modo: true, modi: [
    ['prova', 'Prova', 'Segnala soltanto, nella scheda Shop: non cambia niente su Shopify'],
    ['automatica', 'Automatica', 'Se manca solo "Via" o "Piazza" e la via è unica nel comune, la aggiunge su Shopify; il resto lo segnala'],
    ['spenta', 'Spenta', 'Nessun riscontro']] },
};
const AUTOMAZIONE_MODI = [['prova', 'Prova', 'La mail la manda una persona, col clic sull\'etichetta rossa nella scheda Shop'],
  ['automatica', 'Automatica', 'La mail parte da sola'], ['spenta', 'Spenta', 'Niente mail, niente task']];
const AUTOMAZIONE_STATI = {
  in_corso: ['In corso', '#f59e0b'], ok: ['Riuscita', '#22c55e'], errore: ['Errore', '#ef4444'],
  saltato: ['Non lavorativo', '#94a3b8'], prova: ['Prova', '#6366f1'], interrotta: ['Interrotta', '#ef4444'],
};
const CtrlAuto = { righe: null, error: null, modi: {} };

async function loadControlAutomations() {
  const [{ data, error }, imp] = await Promise.all([
    supabaseClient.from('automazione_esecuzioni').select('*').order('at', { ascending: false }).limit(100),
    supabaseClient.from('automazioni_impostazioni').select('nome, modo, aggiornato_at, aggiornato_da'),
  ]);
  CtrlAuto.modi = Object.fromEntries((imp.data || []).map(r => [r.nome, r]));
  CtrlAuto.righe = data || [];
  CtrlAuto.error = error ? Ctrl._fail(error) : null;
  if (Ctrl.view === 'automazioni') refreshControlPage();
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
  return `
    <div class="ctrl-team">${Object.entries(AUTOMAZIONI).map(scheda).join('')}</div>
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
