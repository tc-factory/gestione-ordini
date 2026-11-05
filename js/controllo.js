/**
 * T&C Factory — Centro di controllo (fase 0: motore dei task)
 *
 *   • Il mio giorno: i task della persona collegata, la coda comune e gli arretrati
 *   • Squadra (admin): carico, task in corso e punteggio di ogni operatore
 *   • Tipi di task (admin): catalogo con tempo standard e tempo reale misurato
 *
 * Dati: tabelle task_tipi / tasks / task_storico (sql/centro-controllo.sql).
 * Il tempo di lavoro lo conta il database a ogni cambio di stato (tc_task_stato).
 * La vede chi ha la scheda nei permessi; Squadra, Tipi di task, Collegamenti e il punteggio solo gli admin.
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
  view: 'giorno',        // giorno | squadra | tipi | collegamenti
  giorno: ctrlOggi(),    // giorno mostrato
  macroarea: null,       // filtro della coda comune (null = tutte)
  tasks: [],             // task del giorno + arretrati aperti dei giorni prima
  tipi: [],
  users: [],             // nickname dello staff
  operatori: [],         // impostazioni del piano del giorno (task_operatori)
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
      if (users) this.users = users.map(u => u.nickname);

      if (TCAuth.isAdmin()) {
        const [oggi, sette, tempi, operatori] = await Promise.all([
          this._rpc('tc_task_punteggi', { p_dal: d, p_al: d }),
          this._rpc('tc_task_punteggi', { p_dal: ctrlAddDays(d, -6), p_al: d }),
          this._rpc('tc_task_tempi_reali'),
          supabaseClient.from('task_operatori').select('*'),
        ]);
        this.operatori = operatori.data || [];
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
    const { count, error } = await supabaseClient.from('tasks').select('id', { count: 'exact', head: true })
      .eq('assegnato_a', this._me()).lte('giorno', ctrlOggi()).in('stato', TASK_APERTI);
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
  if (Ctrl.view === 'collegamenti') loadShopifyLinks();
}

function refreshControlPage() {
  if (Nav.current !== 'controllo') return;
  renderControlPage();
  renderHeader();
}

function setControlView(view) {
  Ctrl.view = view;
  refreshControlPage();
  if (view === 'collegamenti') loadShopifyLinks();
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

  const tabs = [['giorno', 'Il mio giorno'], ...(TCAuth.isAdmin() ? [['squadra', 'Squadra'], ['tipi', 'Tipi di task'], ['collegamenti', 'Collegamenti']] : [])];
  const body = !Ctrl.loaded ? `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`
    : Ctrl.error ? `<div class="glass-card page-card"><div class="empty-list">${escapeHtml(Ctrl.error.message)}</div></div>`
    : Ctrl.view === 'squadra' ? renderControlTeam()
    : Ctrl.view === 'tipi' ? renderControlTypes()
    : Ctrl.view === 'collegamenti' ? renderControlLinks()
    : renderControlMyDay();

  root.innerHTML = `
    <div class="ctrl-bar">
      ${tabs.length > 1 ? `<div class="segmented" role="tablist" aria-label="Vista">
        ${tabs.map(([id, label]) => `<button role="tab" aria-selected="${Ctrl.view === id}" class="${Ctrl.view === id ? 'active' : ''}"
          onclick="setControlView('${id}')">${label}</button>`).join('')}
      </div>` : ''}
      ${!['tipi', 'collegamenti'].includes(Ctrl.view) ? `
        <div class="ctrl-daynav" role="group" aria-label="Giorno">
          <button class="btn-icon" onclick="setControlDay('${ctrlAddDays(Ctrl.giorno, -1)}')" aria-label="Giorno prima">${Icons.chevronLeft(16)}</button>
          <label class="ctrl-day-label">
            <span>${ctrlFmtGiorno(Ctrl.giorno)}</span>
            <input type="date" value="${Ctrl.giorno}" onchange="setControlDay(this.value)" aria-label="Scegli il giorno">
          </label>
          <button class="btn-icon" onclick="setControlDay('${ctrlAddDays(Ctrl.giorno, 1)}')" aria-label="Giorno dopo">${Icons.chevronRight(16)}</button>
          ${Ctrl.giorno !== ctrlOggi() ? `<button class="btn btn-ghost btn-sm" onclick="setControlDay()">Oggi</button>` : ''}
        </div>` : ''}
    </div>
    ${body}`;

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

// ── Il mio giorno ──

function renderControlMyDay() {
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
  const score = Ctrl.punteggi[me];

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
      ${TCAuth.isAdmin() ? stat('Punteggio', score ? score.punteggio : '—', 'oggi · solo admin', 'var(--brand-gold)') : ''}
    </div>

    ${taskGroup('In corso', inCorso)}
    ${taskGroup('Da fare', daFare, d === ctrlOggi() ? 'Niente da fare per oggi. 🎉' : 'Nessun task per questo giorno.')}
    ${taskGroup('Arretrati', arretrati, '', 'Task dei giorni prima non ancora chiusi')}
    ${taskGroup('Bloccati', bloccati, '', 'In attesa di qualcun altro: non pesano sul punteggio')}
    ${renderTaskQueue(coda)}
    ${taskGroup('Chiusi', chiusi)}`;
}

// Coda comune con il filtro per macroarea
function renderTaskQueue(coda, emptyText = '') {
  if (!coda.length && !emptyText) return '';
  const conta = (id) => coda.filter(t => t.macroarea === id).length;
  const list = Ctrl.macroarea ? coda.filter(t => t.macroarea === Ctrl.macroarea) : coda;
  const chip = (id, label, n, color) => `
    <button type="button" class="chip chip-btn ctrl-macro ${Ctrl.macroarea === id ? 'active' : ''}" aria-pressed="${Ctrl.macroarea === id}"
      ${color ? `style="--m:${color};"` : ''} onclick="setControlMacro(${id ? `'${id}'` : 'null'})">${label} · ${n}</button>`;
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Coda comune</h2><span class="table-count">${list.length}</span>
        <span class="ctrl-group-hint">Non assegnati: li prende chi li inizia</span></div>
      <div class="ctrl-macro-bar" role="group" aria-label="Filtra per macroarea">
        ${chip(null, 'Tutte', coda.length)}
        ${TASK_MACROAREE.map(m => chip(m.id, m.label, conta(m.id), m.color)).join('')}
      </div>
      ${list.length ? `<div class="task-list">${sortTasks(list).map(t => renderTaskRow(t)).join('')}</div>`
                    : `<div class="empty-list">${emptyText || 'Nessun task in questa macroarea.'}</div>`}
    </section>`;
}

function setControlMacro(id) {
  Ctrl.macroarea = id;
  refreshControlPage();
}

function taskGroup(title, list, emptyText = '', hint = '') {
  if (!list.length && !emptyText) return '';
  return `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${title}</h2><span class="table-count">${list.length}</span>
        ${hint ? `<span class="ctrl-group-hint">${hint}</span>` : ''}</div>
      ${list.length ? `<div class="task-list">${sortTasks(list).map(t => renderTaskRow(t)).join('')}</div>`
                    : `<div class="empty-list">${emptyText}</div>`}
    </section>`;
}

function renderTaskRow(t, { showOwner = false } = {}) {
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id);
  const lav = taskLavoratoSec(t);
  const scaduto = t.scadenza && !['completato', 'non_completato'].includes(t.stato) && new Date(t.scadenza) < new Date();
  const meta = [
    taskMacro(t.macroarea) ? `<span class="ctrl-macro-tag" style="--m:${taskMacro(t.macroarea).color};">${taskMacro(t.macroarea).label}</span>` : '',
    showOwner ? `<strong>${t.assegnato_a ? escapeHtml(t.assegnato_a) : 'Coda comune'}</strong>` : '',
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
      <span class="task-state" title="Priorità ${pr.label}">${st.label}</span>
      <div class="task-actions">${Ctrl.canAct(t) ? taskQuickActions(t) : ''}
        <button class="btn-icon" onclick="openTaskDetail('${t.id}')" aria-label="Altre azioni">${CtrlIcons.more()}</button>
      </div>
    </article>`;
}

function taskQuickActions(t) {
  const btn = (stato, icon, label, cls = 'btn-secondary') =>
    `<button class="btn ${cls} btn-sm" onclick="taskSetStato('${t.id}','${stato}')">${icon} <span>${label}</span></button>`;
  const prendi = !t.assegnato_a ? `<button class="btn btn-secondary btn-sm" onclick="taskPrendi('${t.id}')">${CtrlIcons.hand()} <span>Prendi</span></button>` : '';
  switch (t.stato) {
    case 'in_lavorazione': return btn('in_pausa', CtrlIcons.pause(), 'Pausa') + btn('completato', CtrlIcons.check(), 'Fatto', 'btn-primary');
    case 'completato':     return btn('da_fare', CtrlIcons.undo(), 'Riapri', 'btn-ghost');
    case 'non_completato': return btn('da_fare', CtrlIcons.undo(), 'Riapri', 'btn-ghost');
    case 'in_pausa':
    case 'bloccato':       return prendi + btn('in_lavorazione', CtrlIcons.play(), 'Riprendi', 'btn-primary');
    default:               return prendi + btn('in_lavorazione', CtrlIcons.play(), 'Inizia', 'btn-primary');
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

// ── Squadra (admin) ──

function renderControlTeam() {
  const d = Ctrl.giorno;
  const people = [...new Set([...Ctrl.users, ...Ctrl.tasks.map(t => t.assegnato_a).filter(Boolean)])];
  const coda = Ctrl.tasks.filter(t => !t.assegnato_a);
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
  const attivi = Ctrl.operatori.filter(o => o.attivo).length;
  return `
    <div class="ctrl-bar" style="margin-bottom:10px;">
      <span class="ctrl-group-hint" style="margin:0;">${attivi ? `${attivi} operatori nel piano del giorno: la coda si distribuisce ogni mattina` : 'Nessun operatore nel piano: la coda resta comune'}</span>
      <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="openOperatorsForm()">${Icons.users(14)} Operatori</button>
      <button class="btn btn-primary btn-sm" ${attivi ? '' : 'disabled'} onclick="distributeQueue()">Distribuisci coda</button>
    </div>
    <div class="ctrl-team">${people.map(card).join('')}</div>
    ${renderTaskQueue(coda, 'Nessun task in coda.')}
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
          ${propone ? `<button class="btn btn-ghost btn-sm" onclick="applyRealTime('${tp.id}', ${Math.round(r.mediana_minuti)})">Usa ${Math.round(r.mediana_minuti)}′</button>` : ''}</td>
        <td>${tp.competenza ? escapeHtml(tp.competenza) : '<span class="ctrl-cell-sub">—</span>'}</td>
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
          ${TCAuth.isAdmin() ? `<button type="button" class="btn btn-secondary btn-sm" onclick="saveTaskBozza('${t.id}')">Salva bozza</button>` : ''}
          <button type="button" class="btn btn-primary btn-sm" id="task-send" onclick="sendTaskReply('${t.id}')">Invia risposta</button>
        </div>
      </div>` : ''}`;
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

function renderTaskDetail(id, storico) {
  const t = Ctrl.get(id);
  if (!t) { closeModal(CTRL_MODAL); return; }
  const st = taskStato(t.stato), pr = taskPrio(t.priorita), tipo = Ctrl.tipo(t.tipo_id);
  const can = Ctrl.canAct(t);
  const a = _taskAction;

  const row = (label, value) => value ? `<div class="def-row"><dt>${label}</dt><dd>${value}</dd></div>` : '';
  const stateBtn = (stato, label) => t.stato === stato ? '' :
    `<button type="button" class="btn btn-secondary btn-sm" onclick="${TASK_CON_MOTIVO.includes(stato)
      ? `_taskAction='${stato}';renderTaskDetail('${id}', _taskStoricoCache)` : `taskDetailStato('${id}','${stato}')`}">${label}</button>`;

  window._taskStoricoCache = storico;
  ctrlModal(`
    ${ctrlModalHead(escapeHtml(t.titolo))}
    <div class="modal-body" style="gap:14px;">
      <div class="task-detail-state" style="--st:${st.color};--p:${pr.color};">
        <span class="task-state">${st.label}</span>
        <span class="chip" style="color:${pr.color};background:color-mix(in srgb, ${pr.color} 14%, transparent);">${pr.label}</span>
        ${t.stato === 'in_lavorazione' ? `<span class="task-timer" data-task-timer="${t.id}">${ctrlFmtDur(taskLavoratoSec(t))}</span>` : ''}
      </div>
      ${t.descrizione ? `<p class="task-detail-desc">${escapeHtml(t.descrizione)}</p>` : ''}
      ${t.riferimento ? `<div>${MsgRef.chip(t.riferimento, `closeModal('${CTRL_MODAL}');MsgRef.open(Ctrl.get('${t.id}').riferimento)`)}</div>` : ''}
      ${renderTaskMail(t, can)}
      <dl class="def-list">
        ${row('Macroarea', taskMacro(t.macroarea)?.label || '')}
        ${row('Assegnato a', t.assegnato_a ? escapeHtml(t.assegnato_a) : 'Coda comune')}
        ${row('Tipo', tipo ? escapeHtml(tipo.nome) : '')}
        ${row('Giorno', ctrlFmtGiorno(t.giorno))}
        ${row('Scadenza', t.scadenza ? ctrlFmtQuando(t.scadenza) : '')}
        ${row('Tempo', `${ctrlFmtMin(t.minuti_stimati)} stimati · ${ctrlFmtDur(taskLavoratoSec(t))} lavorati`)}
        ${row('Motivo', t.motivo && TASK_CON_MOTIVO.includes(t.stato) ? escapeHtml(t.motivo) : '')}
        ${row('Origine', t.fonte !== 'manuale' ? escapeHtml(t.fonte) : '')}
        ${row('Creato', `${ctrlFmtQuando(t.created_at)}${t.creato_da ? ` da ${escapeHtml(t.creato_da)}` : ''}`)}
      </dl>

      ${can && !a ? `
        <div class="task-detail-actions">
          ${taskQuickActions(t).replaceAll('taskSetStato(', 'taskDetailStato(').replaceAll('taskPrendi(', 'taskDetailPrendi(')}
          ${stateBtn('rimandato', 'Rimanda')}
          ${stateBtn('bloccato', 'Bloccato')}
          ${stateBtn('non_completato', 'Non completato')}
          ${t.stato !== 'completato' && t.stato !== 'in_lavorazione' ? stateBtn('completato', 'Segna completato') : ''}
        </div>` : ''}

      ${can && a ? `
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
            <button type="button" class="btn btn-secondary btn-sm" onclick="_taskAction=null;renderTaskDetail('${id}', _taskStoricoCache)">Annulla</button>
            <button type="submit" class="btn btn-primary btn-sm">Conferma</button>
          </div>
        </form>` : ''}

      <div class="task-history">
        <span class="form-label">Storico</span>
        ${storico === null ? `<div class="ctrl-cell-sub">Caricamento…</div>` :
          storico.length ? `<ol>${storico.map(h => `
            <li><span class="task-history-dot" style="background:${taskStato(h.a_stato).color};"></span>
              <span><strong>${taskStato(h.a_stato).label}</strong>${h.utente ? ` · ${escapeHtml(h.utente)}` : ''} · ${ctrlFmtQuando(h.at)}
              ${h.motivo && TASK_CON_MOTIVO.includes(h.a_stato) ? `<em>${escapeHtml(h.motivo)}</em>` : ''}</span></li>`).join('')}</ol>`
          : `<div class="ctrl-cell-sub">Nessun passaggio registrato.</div>`}
      </div>

      ${TCAuth.isAdmin() ? `
        <div style="display:flex;gap:8px;justify-content:space-between;border-top:1px solid var(--border);padding-top:12px;">
          <button class="btn btn-ghost btn-sm" style="color:var(--priority-urgent);" onclick="removeTask('${id}')">${Icons.trash(14)} Elimina</button>
          <button class="btn btn-secondary btn-sm" onclick="openTaskForm('${id}')">${Icons.edit(14)} Modifica</button>
        </div>` : ''}
    </div>`, 540);

  if (a) setTimeout(() => document.getElementById(a === 'rimandato' ? 'tm-giorno' : 'tm-motivo')?.focus(), 30);
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
          <input id="tt-comp" class="form-input" maxlength="60" value="${escapeHtml(tp?.competenza || '')}" placeholder="es. customer care">
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
  ordini: null,      // risultati della ricerca o ultimi ordini
  query: '',
  error: null,
  syncing: new Set(),
};

const SHOP_PAGAMENTO = { PAID: 'Pagato', PENDING: 'In attesa', AUTHORIZED: 'Autorizzato', PARTIALLY_PAID: 'Pagato in parte',
  REFUNDED: 'Rimborsato', PARTIALLY_REFUNDED: 'Rimborsato in parte', VOIDED: 'Annullato', EXPIRED: 'Scaduto' };
const SHOP_EVASIONE = { UNFULFILLED: 'Da evadere', FULFILLED: 'Evaso', PARTIALLY_FULFILLED: 'Evaso in parte', ON_HOLD: 'In sospeso',
  IN_PROGRESS: 'In lavorazione', SCHEDULED: 'Programmato', RESTOCKED: 'Rifornito', PENDING_FULFILLMENT: 'In attesa di evasione', OPEN: 'Aperto' };

async function loadShopifyLinks() {
  try {
    const { data, error } = await supabaseClient.rpc('tc_shopify_stato');
    if (error) throw Ctrl._fail(error);
    if (!data?.success) throw new Error(data?.error || 'Errore');
    ShopLinks.negozi = data.negozi || [];
    ShopLinks.error = null;
  } catch (e) { ShopLinks.error = e; }
  const [caselle, mail, scartate] = await Promise.all([
    supabaseClient.rpc('tc_mail_stato'),
    supabaseClient.from('mail_messaggi').select('id, casella_id, da_email, da_nome, oggetto, ricevuto_at, testo, allegati')
      .eq('direzione', 'in').eq('automatica', false).order('ricevuto_at', { ascending: false }).limit(15),
    supabaseClient.from('eventi').select('id, account, payload, esito, elaborato_at')
      .eq('fonte', 'mail').not('elaborato_at', 'is', null).is('task_id', null)
      .order('elaborato_at', { ascending: false }).limit(15),
  ]);
  ShopLinks.scartate = scartate.error ? [] : (scartate.data || []);
  ShopLinks.caselle = caselle.data?.success ? caselle.data.caselle : [];
  ShopLinks.mail = mail.error ? [] : (mail.data || []);
  await searchShopifyOrders(ShopLinks.query, false);
  refreshControlPage();
}

async function searchShopifyOrders(q, render = true) {
  ShopLinks.query = q = (q || '').trim();
  let req = supabaseClient.from('shopify_orders')
    .select('id, store_id, numero, creato_at, annullato_at, cliente, email, telefono, totale, valuta, stato_pagamento, stato_evasione, tracking, righe')
    .order('creato_at', { ascending: false }).limit(q ? 40 : 15);
  if (q) {
    const safe = q.replace(/[,()%*]/g, ' ').trim();
    const cifre = q.replace(/\D/g, '');
    const parti = [`email.ilike.*${safe}*`, `cliente.ilike.*${safe}*`, `numero.ilike.*${safe}*`];
    if (cifre.length >= 6) parti.push(`telefono_cifre.like.*${cifre.slice(-9)}*`);
    req = req.or(parti.join(','));
  }
  const { data, error } = await req;
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

function renderControlLinks() {
  if (ShopLinks.error?.notInstalled) return `<div class="glass-card page-card"><div class="empty-list">Collegamento Shopify da attivare: esegui <strong>sql/shopify.sql</strong>.</div></div>`;
  if (!ShopLinks.negozi) return `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`;
  const nomeNegozio = (id) => ShopLinks.negozi.find(n => n.id === id)?.nome || id;

  const negozio = (n) => {
    const secretMancante = /Manca il secret/.test(n.ultimo_errore || '');
    const stato = !n.ultimo_sync_at ? ['In attesa del primo collegamento', '#94a3b8']
      : n.ultimo_errore ? [secretMancante ? 'Manca il secret' : 'Errore', '#ef4444']
      : ['Collegato', '#22c55e'];
    const busy = ShopLinks.syncing.has(n.id) || ShopLinks.syncing.has('*');
    return `
      <article class="glass-card ctrl-person ctrl-shop" style="--st:${stato[1]};">
        <header>
          <div><h3>${escapeHtml(n.nome)}</h3><div class="ctrl-cell-sub">${escapeHtml(n.dominio)}</div></div>
          <span class="task-state">${stato[0]}</span>
        </header>
        <div class="ctrl-person-meta">
          <span><strong>${n.ordini}</strong> ordini</span>
          <span><strong>${n.da_evadere}</strong> da evadere</span>
          ${n.ultimo_sync_at ? `<span>controllato ${ctrlFmtQuando(n.ultimo_sync_at)}</span>` : ''}
        </div>
        ${n.ultimo_errore ? `<div class="ctrl-shop-error">${escapeHtml(n.ultimo_errore)}</div>` : ''}
        <button class="btn btn-secondary btn-sm" ${busy ? 'disabled' : ''} onclick="syncShopify('${n.id}')">${busy ? 'Sincronizzo…' : '↻ Sincronizza ora'}</button>
      </article>`;
  };

  const ordine = (o) => {
    const track = (o.tracking || []).find(t => t.numero || t.url);
    const righe = (o.righe || []).map(r => `${r.qnt}× ${r.titolo}${r.variante ? ` (${r.variante})` : ''}`).join(' · ');
    return `
      <article class="task-row ctrl-order" style="--p:${o.annullato_at ? '#94a3b8' : o.stato_evasione === 'FULFILLED' ? '#22c55e' : '#f59e0b'};">
        <div class="task-main" style="cursor:default;">
          <span class="task-title">${escapeHtml(o.numero)} · ${escapeHtml(o.cliente || 'Cliente senza nome')}
            <span class="ctrl-cell-sub">${escapeHtml(nomeNegozio(o.store_id))}</span></span>
          <span class="task-meta">${[
            ctrlFmtQuando(o.creato_at),
            o.totale != null ? `${Number(o.totale).toLocaleString('it-IT', { minimumFractionDigits: 2 })} ${o.valuta || ''}` : '',
            SHOP_PAGAMENTO[o.stato_pagamento] || o.stato_pagamento || '',
            o.annullato_at ? '<span class="task-late">Annullato</span>' : (SHOP_EVASIONE[o.stato_evasione] || o.stato_evasione || ''),
            o.email ? escapeHtml(o.email) : '', o.telefono ? escapeHtml(o.telefono) : '',
          ].filter(Boolean).join('<span aria-hidden="true"> · </span>')}</span>
          ${righe ? `<span class="task-motivo" style="font-style:normal;">${escapeHtml(righe)}</span>` : ''}
        </div>
        ${track ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(track.url || '#')}" target="_blank" rel="noopener"
            ${track.url ? '' : 'onclick="return false"'}>${Icons.truck(14)} ${escapeHtml(track.corriere || 'Tracking')}${track.numero ? ` ${escapeHtml(track.numero)}` : ''}</a>` : '<span></span>'}
      </article>`;
  };

  const casella = (c) => {
    const stato = !c.ultimo_sync_at ? ['In attesa del primo controllo', '#94a3b8']
      : c.ultimo_errore ? [/Manca il secret/.test(c.ultimo_errore) ? 'Manca la password' : 'Errore', '#ef4444']
      : ['Collegata', '#22c55e'];
    const busy = ShopLinks.syncing.has('mail:' + c.id) || ShopLinks.syncing.has('mail:*');
    return `
      <article class="glass-card ctrl-person ctrl-shop" style="--st:${stato[1]};">
        <header>
          <div><h3>${escapeHtml(c.indirizzo)}</h3><div class="ctrl-cell-sub">${escapeHtml(c.nome)} · mail dal ${ctrlFmtQuando(c.attiva_dal)}</div></div>
          <span class="task-state">${stato[0]}</span>
        </header>
        <div class="ctrl-person-meta">
          <span><strong>${c.da_persone}</strong> da persone</span>
          <span>${c.ricevute - c.da_persone} automatiche</span>
          ${c.ultimo_sync_at ? `<span>controllata ${ctrlFmtQuando(c.ultimo_sync_at)}</span>` : ''}
        </div>
        ${c.ultimo_errore ? `<div class="ctrl-shop-error">${escapeHtml(c.ultimo_errore)}</div>` : ''}
        <button class="btn btn-secondary btn-sm" ${busy ? 'disabled' : ''} onclick="syncMail('${c.id}')">${busy ? 'Controllo…' : '↻ Controlla ora'}</button>
      </article>`;
  };
  const nomeCasella = (id) => ShopLinks.caselle?.find(c => c.id === id)?.nome || id;
  const mailRow = (m) => `
    <article class="task-row ctrl-order" style="--p:#6366f1;">
      <div class="task-main" style="cursor:default;">
        <span class="task-title">${escapeHtml(m.oggetto || '(senza oggetto)')} <span class="ctrl-cell-sub">${escapeHtml(nomeCasella(m.casella_id))}</span></span>
        <span class="task-meta">${escapeHtml(m.da_nome ? `${m.da_nome} <${m.da_email}>` : m.da_email || '')}<span aria-hidden="true"> · </span>${ctrlFmtQuando(m.ricevuto_at)}${(m.allegati || []).length ? `<span aria-hidden="true"> · </span>${Icons.paperclip(12)} ${m.allegati.length}` : ''}</span>
        ${m.testo ? `<span class="task-motivo" style="font-style:normal;">${escapeHtml(m.testo.slice(0, 220))}${m.testo.length > 220 ? '…' : ''}</span>` : ''}
      </div>
      <span></span>
    </article>`;
  const anyMail = ShopLinks.syncing.has('mail:*');

  const anySync = ShopLinks.syncing.has('*');
  return `
    <section class="ctrl-group">
      <div class="ctrl-bar" style="margin-bottom:10px;">
        <h2 class="ctrl-section-title">Caselle email</h2>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto;" ${anyMail ? 'disabled' : ''} onclick="syncMail()">${anyMail ? 'Controllo…' : '↻ Controlla tutte'}</button>
      </div>
      <div class="ctrl-team">${(ShopLinks.caselle || []).map(casella).join('')}</div>
      <p class="settings-section-hint ctrl-note">Le caselle si controllano da sole ogni 2 minuti, in sola lettura: le mail non vengono segnate come lette. Newsletter e notifiche automatiche non vanno al cervello.</p>
    </section>

    ${ShopLinks.scartate.length ? `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Scartate dal cervello</h2><span class="table-count">${ShopLinks.scartate.length}</span>
        <span class="ctrl-group-hint">Spam, phishing e mail senza richieste. Se una è di un cliente, recuperala.</span></div>
      <div class="task-list">${ShopLinks.scartate.map(e => `
        <article class="task-row ctrl-order" style="--p:#94a3b8;">
          <div class="task-main" style="cursor:default;">
            <span class="task-title">${escapeHtml(e.payload?.oggetto || '(senza oggetto)')} <span class="ctrl-cell-sub">${escapeHtml(nomeCasella(e.account))}</span></span>
            <span class="task-meta">${escapeHtml(e.payload?.da || '')}<span aria-hidden="true"> · </span>${ctrlFmtQuando(e.elaborato_at)}</span>
            <span class="task-motivo">${escapeHtml(e.esito || '')}</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="recoverDiscarded('${e.id}')">Crea task</button>
        </article>`).join('')}</div>
    </section>` : ''}

    ${ShopLinks.mail?.length ? `
    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>Ultime mail dai clienti</h2><span class="table-count">${ShopLinks.mail.length}</span></div>
      <div class="task-list">${ShopLinks.mail.map(mailRow).join('')}</div>
    </section>` : ''}

    <section class="ctrl-group">
      <div class="ctrl-bar" style="margin-bottom:10px;">
        <h2 class="ctrl-section-title">Negozi Shopify</h2>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto;" ${anySync ? 'disabled' : ''} onclick="syncShopify()">${anySync ? 'Sincronizzo…' : '↻ Sincronizza tutti'}</button>
      </div>
      <div class="ctrl-team">${ShopLinks.negozi.map(negozio).join('')}</div>
      <p class="settings-section-hint ctrl-note">Gli ordini si aggiornano da soli ogni 5 minuti. Al primo collegamento vengono importati quelli degli ultimi 60 giorni.</p>
    </section>

    <section class="glass-card page-card ctrl-group">
      <div class="page-card-head"><h2>${ShopLinks.query ? 'Ordini trovati' : 'Ultimi ordini'}</h2>
        <span class="table-count">${ShopLinks.ordini?.length ?? 0}</span></div>
      <form class="ctrl-search" onsubmit="event.preventDefault();searchShopifyOrders(this.q.value)" role="search">
        <label class="sr-only" for="shop-q">Cerca ordine</label>
        <input id="shop-q" name="q" class="form-input" value="${escapeHtml(ShopLinks.query)}"
          placeholder="Email, telefono, nome o numero d'ordine (es. #1043) — in tutti i negozi">
        <button class="btn btn-primary btn-sm" type="submit">${Icons.search(14)} Cerca</button>
        ${ShopLinks.query ? `<button class="btn btn-ghost btn-sm" type="button" onclick="searchShopifyOrders('')">Azzera</button>` : ''}
      </form>
      ${!ShopLinks.ordini ? `<div class="empty-list">Caricamento…</div>`
        : ShopLinks.ordini.length ? `<div class="task-list">${ShopLinks.ordini.map(ordine).join('')}</div>`
        : `<div class="empty-list">${ShopLinks.query ? 'Nessun ordine trovato.' : 'Ancora nessun ordine importato.'}</div>`}
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

function openOperatorsForm() {
  const riga = (nick, i) => {
    const o = Ctrl.operatori.find(x => x.nickname === nick) || {};
    return `
      <fieldset class="ctrl-op" data-nick="${escapeHtml(nick)}">
        <label class="switch-row" style="padding:0;">
          <span><strong>${escapeHtml(nick)}</strong></span>
          <input type="checkbox" class="switch" data-f="attivo" ${o.attivo ? 'checked' : ''} aria-label="${escapeHtml(nick)} nel piano">
        </label>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="op-min-${i}">Minuti al giorno</label>
            <input id="op-min-${i}" type="number" class="form-input" data-f="minuti" min="30" max="720" value="${o.minuti_giorno || 420}">
          </div>
          <div class="form-group">
            <label class="form-label" for="op-comp-${i}">Competenze</label>
            <input id="op-comp-${i}" class="form-input" data-f="competenze" value="${escapeHtml((o.competenze || []).join(', '))}" placeholder="es. customer care, spedizioni">
          </div>
        </div>
        <div class="ctrl-op-macro" role="group" aria-label="Macroaree di ${escapeHtml(nick)}">
          ${TASK_MACROAREE.map(m => `<label><input type="checkbox" data-macro="${m.id}" ${(o.macroaree || []).includes(m.id) ? 'checked' : ''}> ${m.label}</label>`).join('')}
        </div>
      </fieldset>`;
  };
  ctrlModal(`
    ${ctrlModalHead('Operatori del piano')}
    <form class="modal-body" style="gap:12px;" onsubmit="event.preventDefault();submitOperatorsForm()">
      <p class="settings-section-hint" style="margin:0;">Ogni mattina la coda comune va agli operatori attivi: per priorità, a chi può fare il task e ha più tempo libero. Nessuna macroarea spuntata = tutte. Un tipo di task con competenza va solo a chi ha quella competenza, scritta uguale.</p>
      ${Ctrl.users.map(riga).join('')}
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-secondary" onclick="closeModal('${CTRL_MODAL}')">Annulla</button>
        <button type="submit" class="btn btn-primary" id="op-save">Salva</button>
      </div>
    </form>`, 620);
}

async function submitOperatorsForm() {
  const rows = [...document.querySelectorAll('.ctrl-op')].map(f => ({
    nickname: f.dataset.nick,
    attivo: f.querySelector('[data-f="attivo"]').checked,
    minuti_giorno: Math.min(720, Math.max(30, parseInt(f.querySelector('[data-f="minuti"]').value, 10) || 420)),
    competenze: f.querySelector('[data-f="competenze"]').value.split(',').map(x => x.trim()).filter(Boolean),
    macroaree: [...f.querySelectorAll('[data-macro]:checked')].map(x => x.dataset.macro),
  }));
  const btn = document.getElementById('op-save');
  btn.disabled = true;
  const { error } = await supabaseClient.from('task_operatori').upsert(rows);
  if (error) { showToast(Ctrl._fail(error).message, 'error'); btn.disabled = false; return; }
  closeModal(CTRL_MODAL);
  showToast('Operatori salvati');
  await Ctrl.load();
  refreshControlPage();
}
