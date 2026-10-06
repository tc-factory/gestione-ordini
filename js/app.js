/**
 * T&C Factory — App UI v5.0
 * Pagina unica: header, statistiche, calendario, lista ordini, dialog.
 */

// ─────────────────────────────────────────────
// STATO LOCALE DI INTERFACCIA
// ─────────────────────────────────────────────

const AppState = {
  view: 'active',
  searchQuery: '',
  sortKey: 'data',
  filterTags: [],
  calYear: new Date().getFullYear(),
  calMonth: -1, // -1 = annual, 0-11 = specific month
  calOpen: false,
  filterArchive: 'all',   // 'all' | 'fatturati' | 'non-fatturati'
  logFilterUser: '',
  logSearchQuery: '',
  logOffset: 0,
  selectedOrder: null,
  dayOpen: null,
  formEditOrder: null,
  formDefaultDate: null,
  formFiles: [],
  formInvoiceFiles: [],
  formTags: [],
  formModuleRows: [],
  formModuleAcconto: '',
  formModuleOpen: false,
  integrationOrderId: null,
  integrationRows: [],
  settingsPrioOpen: false,
  settingsTagOpen: false,
  settingsPwdOpen: false,
};



// ─────────────────────────────────────────────
// TEMA CHIARO/SCURO + ACCESSIBILITÀ
// ─────────────────────────────────────────────

const Theme = {
  KEY: 'tcf_theme',
  get() { return localStorage.getItem(this.KEY) || 'light'; },
  apply(theme) { document.documentElement.classList.toggle('dark', theme === 'dark'); },
  toggle() {
    const next = this.get() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(this.KEY, next);
    this.apply(next);
    renderApp();
    if (Nav.current === 'impostazioni') renderSettingsDialog();
  },
  init() {
    this.apply(this.get());
    A11yPrefs.init();
    initPasswordToggles();
  }
};

// Riduci trasparenza / movimento: se l'utente non ha scelto, segue il sistema operativo
const A11yPrefs = {
  PREFS: {
    transparency: { key: 'tcf_reduce_transparency', cls: 'reduce-transparency', media: '(prefers-reduced-transparency: reduce)' },
    motion:       { key: 'tcf_reduce_motion',       cls: 'reduce-motion',       media: '(prefers-reduced-motion: reduce)' },
  },
  get(name) {
    const p = this.PREFS[name];
    const saved = localStorage.getItem(p.key);
    if (saved !== null) return saved === '1';
    return window.matchMedia?.(p.media).matches || false;
  },
  set(name, on) {
    localStorage.setItem(this.PREFS[name].key, on ? '1' : '0');
    this.apply();
  },
  apply() {
    for (const name of Object.keys(this.PREFS)) {
      document.documentElement.classList.toggle(this.PREFS[name].cls, this.get(name));
    }
  },
  init() {
    this.apply();
    for (const p of Object.values(this.PREFS)) {
      window.matchMedia?.(p.media).addEventListener?.('change', () => this.apply());
    }
  },
};

// ─────────────────────────────────────────────
// MOSTRA / NASCONDI PASSWORD
// Ogni campo password riceve l'occhio, anche quelli creati dopo
// ─────────────────────────────────────────────

function enhancePasswordField(input) {
  if (input.dataset.pwToggle) return;
  input.dataset.pwToggle = '1';
  const wrap = document.createElement('div');
  wrap.className = 'pw-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  const sync = () => {
    const visible = input.type === 'text';
    btn.innerHTML = visible ? Icons.eyeOff(17) : Icons.eye(17);
    btn.setAttribute('aria-label', visible ? 'Nascondi password' : 'Mostra password');
    btn.setAttribute('aria-pressed', visible);
    btn.title = visible ? 'Nascondi password' : 'Mostra password';
  };
  // mousedown: il campo non perde il focus e il cursore resta dov'era
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; sync(); input.focus(); });
  sync();
  wrap.appendChild(btn);
}

function initPasswordToggles() {
  const scan = (root) => root.querySelectorAll?.('input[type="password"]').forEach(enhancePasswordField);
  scan(document);
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType !== 1) return;
    if (n.matches?.('input[type="password"]')) enhancePasswordField(n); else scan(n);
  }))).observe(document.body, { childList: true, subtree: true });
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.25s ease reverse';
    setTimeout(() => toast.remove(), 250);
  }, 3000);
}

// ─────────────────────────────────────────────
// RENDER PRINCIPALE
// ─────────────────────────────────────────────

function renderApp() {
  renderSidebar();
  renderHeader();
  renderStats();
  renderOrderList();
  // Sezioni che dipendono da ordini/clienti: si aggiornano anche in tempo reale
  if (Nav.current === 'cestino') renderCestinoPage();
  if (Nav.current === 'planner') renderCalendarSection();
  if (Nav.current === 'clienti') renderClientsPage();
  if (Nav.current === 'cassa')   renderCassaPage();
}

function renderStats() {
  const active  = TCFactory.getActiveOrders().length;
  const parziali = TCFactory.getParziali().length;
  const partial  = TCFactory.getEvasioneOrders().length;
  const arch    = TCFactory.getArchivedOrders().length;

  document.getElementById('stats-root').innerHTML = `
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:var(--brand-gold);"></div>
      <div class="stat-card-label">Attivi</div>
      <div class="stat-card-value">${active}</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:#f97316;"></div>
      <div class="stat-card-label">Evasione</div>
      <div class="stat-card-value" style="color:#f97316;">${partial + parziali}</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:#22c55e;"></div>
      <div class="stat-card-label">Archiviati</div>
      <div class="stat-card-value" style="color:#22c55e;">${arch}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// LISTA ORDINI
// ─────────────────────────────────────────────

function setView(v) { AppState.view = v; renderOrderList(); }
function setSortKey(v) { AppState.sortKey = v; renderOrderList(); }

function setSearchQuery(v) {
  AppState.searchQuery = v;
  renderOrderList();
  // Re-focalizza il campo cerca dopo il re-render
  const el = document.querySelector('.search-box input[type="text"]');
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}


function toggleTagFilter(tag) {
  // Selezione esclusiva: cliccare un tag deseleziona gli altri
  if (AppState.filterTags.includes(tag)) {
    AppState.filterTags = [];
  } else {
    AppState.filterTags = [tag];
  }
  renderOrderList();
}
function clearTagFilters() { AppState.filterTags = []; renderOrderList(); }

function renderOrderList() {
  const nActive   = TCFactory.getActiveOrders().length;
  const nParziali = TCFactory.getParziali().length;
  const nEvasione = TCFactory.getEvasioneOrders().length;
  const nDaRisc   = TCFactory.getDaRiscuotereOrders().length;
  const nArchived = TCFactory.getArchivedOrders().length;

  let source =
    AppState.view === 'active'       ? TCFactory.getActiveOrders()       :
    AppState.view === 'parziali'     ? TCFactory.getParziali()           :
    AppState.view === 'evasione'     ? TCFactory.getEvasioneOrders()     :
    AppState.view === 'dariscuotere' ? TCFactory.getDaRiscuotereOrders() :
                                       TCFactory.getArchivedOrders();

  // Filtro archivio
  if (AppState.view === 'archived' && AppState.filterArchive !== 'all') {
    source = source.filter(o =>
      AppState.filterArchive === 'fatturati' ? o.invoiceConfirmed : !o.invoiceConfirmed
    );
  }

  const q = AppState.searchQuery.trim().toLowerCase();
  let filtered = q
    ? source.filter(o => o.nome.toLowerCase().includes(q) || o.tags.some(t => t.toLowerCase().includes(q)))
    : source;

  if (AppState.filterTags.length > 0) {
    filtered = filtered.filter(o => AppState.filterTags.every(t => o.tags.includes(t)));
  }

  const getLavDone = (o) => {
    const s = o.stages || {};
    return (s.merceCompleta?.done?1:0) + (s.dtfPronti?.done?1:0) + (s.ordineStampato?.done?1:0);
  };
  const cmpDate        = (a, b) => (a.dataOrdine||'').localeCompare(b.dataOrdine||'');
  const cmpPriorita    = (a, b) => TCFactory.getPriorityRank(a.priorityId) - TCFactory.getPriorityRank(b.priorityId);
  const cmpAvanzamento = (a, b) => getLavDone(b) - getLavDone(a);

  if (!['data','priorita','avanzamento'].includes(AppState.sortKey)) AppState.sortKey = 'data';

  const sorted = [...filtered].sort((a, b) => {
    switch (AppState.sortKey) {
      case 'data':        return cmpDate(a,b)        || cmpAvanzamento(a,b) || cmpPriorita(a,b);
      case 'priorita':    return cmpPriorita(a,b)    || cmpAvanzamento(a,b) || cmpDate(a,b);
      case 'avanzamento': return cmpAvanzamento(a,b) || cmpPriorita(a,b)   || cmpDate(a,b);
      default: return 0;
    }
  });

  const isActive   = AppState.view === 'active';
  const isEvasione = AppState.view === 'evasione' || AppState.view === 'parziali';

  const allTags = TCFactory.getTags();
  const tagFilterRow = allTags.length > 0 ? `
    <div style="padding:8px 16px;border-bottom:1px solid var(--border);display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;flex-shrink:0;">Tag:</span>
      ${allTags.map(t => {
        const active = AppState.filterTags.includes(t.name);
        return `<button class="chip chip-btn" onclick="toggleTagFilter('${escapeHtml(t.name)}')"
          style="background:${active ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`};color:${active ? '#fff' : t.color};cursor:pointer;">
          <span class="chip-dot" style="background:${active ? '#fff' : t.color};"></span>${escapeHtml(t.name)}
        </button>`;
      }).join('')}
      ${AppState.filterTags.length > 0 ? `<button class="btn btn-ghost btn-sm" onclick="clearTagFilters()" style="font-size:0.72rem;">× rimuovi filtri</button>` : ''}
    </div>` : '';

  const archiveFilterRow = AppState.view === 'archived' ? `
    <div style="padding:6px 16px;border-bottom:1px solid var(--border);display:flex;gap:6px;align-items:center;">
      <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;">Filtro:</span>
      ${['all','fatturati','non-fatturati'].map(f => {
        const labels = {all:'Tutti', fatturati:'Fatturati 🧾', 'non-fatturati':'Non fatturati'};
        const active = AppState.filterArchive === f;
        return `<button class="chip chip-btn" onclick="setArchiveFilter('${f}')"
          style="background:${active ? 'var(--brand-gold)' : 'var(--bg-secondary)'};color:${active ? '#fff' : 'var(--text-primary)'};border:1px solid var(--border);">
          ${labels[f]}
        </button>`;
      }).join('')}
    </div>` : '';

  const emptyMsg =
    q || AppState.filterTags.length > 0 ? 'Nessun risultato.' :
    AppState.view === 'archived'       ? 'Nessun ordine archiviato.' :
    AppState.view === 'parziali'       ? 'Nessun ordine parziale.' :
    AppState.view === 'evasione'       ? 'Nessun ordine in evasione.' :
    AppState.view === 'dariscuotere'   ? 'Nessun ordine da riscuotere.' :
    'Nessun ordine attivo.';

  // Header colonne — dipende dal tab
  const hdrGrid = isActive
    ? `<div class="order-row-grid order-row-grid--active">
        <div class="orc-name orc-hdr">Nome</div>
        <div class="orc-date orc-hdr">Data</div>
        <div class="orc-tags orc-hdr">Tipologia</div>
        <div class="orc-lav orc-hdr">Lavorazione</div>
        <div class="orc-deadline orc-hdr">Scadenza</div>
        <div class="orc-priority orc-hdr">Urgenza</div>
        <div class="orc-files orc-hdr">Ordine</div>
        <div class="orc-payment orc-hdr">Pagamento</div>
      </div>`
    : `<div class="order-row-grid">
        <div class="orc-name orc-hdr">Nome</div>
        <div class="orc-date orc-hdr">Data</div>
        <div class="orc-tags orc-hdr">Tipologia</div>
        <div class="orc-lav orc-hdr">${isEvasione ? 'Stampato' : 'Lavorazione'}</div>
        <div class="orc-eva orc-hdr">${isEvasione ? 'Evasione' : 'Spedizione'}</div>
        <div class="orc-deadline orc-hdr">Scadenza</div>
        <div class="orc-priority orc-hdr">Urgenza</div>
        <div class="orc-files orc-hdr">Ordine</div>
        <div class="orc-payment orc-hdr">Pagamento</div>
      </div>`;

  document.getElementById('orderlist-root').innerHTML = `
    <div class="glass-card">
      <div class="list-card-header">
        <div class="list-title-group">
          <div class="list-title">
            <h2>Ordini</h2>
            <p>${filtered.length} di ${source.length}</p>
          </div>
          <div class="view-tabs">
            <button class="view-tab ${AppState.view==='active'?'active':''}"        onclick="setView('active')">Attivi · ${nActive}</button>
            <button class="view-tab ${AppState.view==='parziali'?'active':''}"      onclick="setView('parziali')">Parziali · ${nParziali}</button>
            <button class="view-tab ${AppState.view==='evasione'?'active':''}"      onclick="setView('evasione')">Evasione · ${nEvasione}</button>
            <button class="view-tab ${AppState.view==='dariscuotere'?'active':''}"  onclick="setView('dariscuotere')" style="${AppState.view==='dariscuotere'?'':'color:#ef4444;'}">€ Da riscuotere · ${nDaRisc}</button>
            <button class="view-tab ${AppState.view==='archived'?'active':''}"      onclick="setView('archived')">${Icons.archive(12)} Archivio · ${nArchived}</button>
          </div>
        </div>
        <div class="list-controls">
          <div class="search-box">
            ${Icons.search()}
            <input type="text" placeholder="Cerca per nome o tag…" value="${escapeHtml(AppState.searchQuery)}" oninput="setSearchQuery(this.value)">
          </div>
          <select class="form-select" style="width:auto;" onchange="setSortKey(this.value)">
            <option value="data"        ${AppState.sortKey==='data'?'selected':''}>Data</option>
            <option value="priorita"    ${AppState.sortKey==='priorita'?'selected':''}>Priorità</option>
            <option value="avanzamento" ${AppState.sortKey==='avanzamento'?'selected':''}>Avanzamento</option>
          </select>
        </div>
      </div>
      ${tagFilterRow}
      ${archiveFilterRow}
      <div class="order-rows">
        <div class="order-row-item order-row-header-row" onclick="event.stopPropagation()">
          <div class="order-row-bar" style="background:transparent;"></div>
          ${hdrGrid}
        </div>
        ${sorted.length === 0
          ? `<div class="empty-list">${emptyMsg}</div>`
          : sorted.map(o => renderOrderRow(o)).join('')}
      </div>
    </div>
  `;
}


function setArchiveFilter(f) { AppState.filterArchive = f; renderOrderList(); }


function renderOrderRow(o) {
  const p     = TCFactory.getPriority(o.priorityId);
  const color = p?.color || '#64748b';
  const view  = AppState.view;

  // Deadline badge
  let deadlineBadge = '—';
  let deadlineColor = 'var(--text-muted)';
  if (o.deadline) {
    const today = new Date().toISOString().slice(0, 10);
    const diff  = Math.ceil((new Date(o.deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    deadlineColor = diff < 0 ? '#ef4444' : diff <= 3 ? '#ef4444' : diff <= 7 ? '#f97316' : '#6366f1';
    deadlineBadge = diff < 0 ? `scad. ${Math.abs(diff)}gg` : diff === 0 ? 'oggi' : `${diff}gg`;
  }

  // Tag cliccabili
  const tagPills = o.tags.slice(0, 3).map(t => {
    const c = TCFactory.getTagColor(t);
    const active = AppState.filterTags.includes(t);
    return `<button class="chip chip-btn" onclick="event.stopPropagation();toggleTagFilter('${escapeHtml(t)}')"
      style="background:${active ? c : `color-mix(in srgb, ${c} 14%, transparent)`};color:${active ? '#fff' : c};padding:2px 6px;cursor:pointer;font-size:0.68rem;">
      <span class="chip-dot" style="background:${active ? '#fff' : c};"></span>${escapeHtml(t)}
    </button>`;
  }).join('');

  // Allegati ordine + modulo
  const filesBtns = (o.files || []).slice(0, 2).map((f, i) => {
    const icon = f.type?.startsWith('image/') ? '🖼' : f.type === 'application/pdf' ? '📄' : '📎';
    return `<button class="file-quick-btn" onclick="event.stopPropagation();quickPreviewFile('${o.id}',${i})" title="${escapeHtml(f.name)}">${icon}</button>`;
  }).join('');
  const filesExtra = (o.files||[]).length > 2 ? `<span style="font-size:0.65rem;color:var(--text-muted);">+${(o.files||[]).length - 2}</span>` : '';
  const moduleBtn  = (o.orderModule?.rows?.length || 0) > 0
    ? `<button class="file-quick-btn" onclick="event.stopPropagation();previewOrderModule('${o.id}')" title="Visualizza modulo d'ordine">📋</button>` : '';

  // Pagamento con importo colorato condizionalmente
  const payDone  = o.paymentDone || false;
  const payDate  = o.paymentDate;
  const invConf  = o.invoiceConfirmed || false;
  const importo  = parseFloat(o.importo) || 0;
  const impColor = payDone ? '#22c55e' : (importo > 0 ? '#ef4444' : 'var(--text-muted)');
  const impStr   = importo > 0 ? `€ ${importo.toLocaleString('it-IT', {minimumFractionDigits:2, maximumFractionDigits:2})}` : '';

  const paymentCell = `
    <div class="orc-payment" style="flex-direction:column;align-items:center;gap:3px;">
      <div style="display:flex;gap:4px;">
        <button class="stage-pill ${invConf?'done':''}"
          onclick="event.stopPropagation();toggleInvoiceConfirmed('${o.id}',${!invConf})"
          title="${invConf ? 'Fattura confermata' : 'Conferma fattura'}"
          style="font-size:0.82rem;padding:2px 6px;">🧾</button>
        <button class="stage-pill ${payDone?'done':''}"
          onclick="event.stopPropagation();togglePayment('${o.id}',${!payDone})"
          title="${payDone ? 'Pagato' : 'Segna come pagato'}"
          style="font-size:0.82rem;padding:2px 8px;font-weight:700;">€</button>
      </div>
      ${impStr ? `<span style="font-size:0.68rem;font-weight:700;color:${impColor};white-space:nowrap;">${impStr}</span>` : ''}
      ${payDone && payDate ? `<span style="font-size:0.6rem;color:#22c55e;">${TCFactory.formatDate(payDate,{day:'2-digit',month:'2-digit'})}</span>` : ''}
    </div>`;

  const scadenzaCell = `<div class="orc-deadline" style="color:${deadlineColor};font-size:0.75rem;font-weight:${o.deadline?'700':'400'};">${deadlineBadge}</div>`;
  const urgenzaCell  = `<div class="orc-priority">${renderPriorityChip(p)}</div>`;
  const ordineCell   = `<div class="orc-files">${filesBtns}${filesExtra}${moduleBtn}</div>`;

  // Pill "Esterna" — visibile in tutti i tab se lavorazioneEsterna=true
  const buildExternaPill = () => {
    if (!o.lavorazioneEsterna) return '';
    const externaStage = o.stages?.lavorazioneEsterna || { done: false };
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
      <button class="stage-pill ${externaStage.done?'done':''}"
        onclick="event.stopPropagation();toggleStageInline('${o.id}','lavorazioneEsterna',${!externaStage.done})"
        title="Lavorazione esterna completata" style="font-size:0.75rem;">Esterna</button>
      <span style="font-size:0.6rem;white-space:nowrap;color:${externaStage.done&&externaStage.date?'#22c55e':'transparent'};">${externaStage.done&&externaStage.date ? TCFactory.formatDate(externaStage.date,{day:'2-digit',month:'2-digit'}) : '00/00'}</span>
    </div>`;
  };

  // ── ATTIVI: solo Lavorazione, nessuna Spedizione ──────────────────────
  if (view === 'active') {
    const isMerceDone = !!o.stages?.merceCompleta?.done;
    const lavPills = LAVORAZIONE_DEFS.map(s => {
      const done  = o.stages?.[s.id]?.done;
      const stage = o.stages?.[s.id];
      // Se merce NON completa, "Stampato" diventa "Parziale"
      const label = (s.id === 'ordineStampato' && !isMerceDone) ? 'Parziale' : s.shortLabel;
      const stDate = (s.id === 'ordineStampato' && done && stage?.date)
        ? TCFactory.formatDate(stage.date, {day:'2-digit',month:'2-digit'}) : '';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <button class="stage-pill ${done?'done':''}" onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})" title="${s.label}">${label}</button>
        <span style="font-size:0.6rem;white-space:nowrap;color:${stDate?'#22c55e':'transparent'};">${stDate||'00/00'}</span>
      </div>`;
    }).join('');

    // Pill "Esterna" condizionale (solo se lavorazioneEsterna=true sull'ordine)
    const externaPill = buildExternaPill();

    return `
      <div class="order-row-item" role="button" tabindex="0"
        onclick="openOrderDetail('${o.id}')" onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
        <div class="order-row-bar" style="background:${color};"></div>
        <div class="order-row-grid order-row-grid--active">
          <div class="orc-name">${escapeHtml(o.nome)}</div>
          <div class="orc-date">${TCFactory.formatDate(o.dataOrdine,{day:'2-digit',month:'2-digit',year:'2-digit'})}</div>
          <div class="orc-tags">${tagPills}</div>
          <div class="orc-lav" style="gap:3px;flex-wrap:wrap;align-items:flex-start;">${lavPills}${externaPill}</div>
          ${scadenzaCell}
          ${urgenzaCell}
          ${ordineCell}
          ${paymentCell}
        </div>
      </div>`;
  }

  // ── EVASIONE: Data stampato + Parziale/Evaso pills con date ─────────
  if (view === 'evasione') {
    const stampatoDate = o.stages?.ordineStampato?.date
      ? TCFactory.formatDate(o.stages.ordineStampato.date, {day:'2-digit',month:'long'})
      : '—';

    const evaPills = EVASIONE_DEFS.map(s => {
      const done      = o.stages?.[s.id]?.done;
      const stageDate = done && o.stages?.[s.id]?.date
        ? TCFactory.formatDate(o.stages[s.id].date, {day:'2-digit',month:'2-digit'})
        : '';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
        <button class="stage-pill evasione ${done?'done':''}"
          onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
          title="${s.label}">${s.shortLabel}</button>
        <span style="font-size:0.6rem;white-space:nowrap;color:${stageDate?'#22c55e':'transparent'};">${stageDate||'00/00'}</span>
      </div>`;
    }).join('');

    return `
      <div class="order-row-item" role="button" tabindex="0"
        onclick="openOrderDetail('${o.id}')" onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
        <div class="order-row-bar" style="background:${color};"></div>
        <div class="order-row-grid">
          <div class="orc-name">${escapeHtml(o.nome)}</div>
          <div class="orc-date">${TCFactory.formatDate(o.dataOrdine,{day:'2-digit',month:'2-digit',year:'2-digit'})}</div>
          <div class="orc-tags">${tagPills}</div>
          <div class="orc-lav" style="flex-direction:column;gap:1px;">
            <span style="font-size:0.66rem;font-weight:700;color:var(--text-muted);">Stampato</span>
            <span style="font-size:0.78rem;font-weight:700;color:#22c55e;">${stampatoDate}</span>
            ${buildExternaPill()}
          </div>
          <div class="orc-eva" style="gap:6px;flex-wrap:nowrap;align-items:flex-start;">${evaPills}</div>
          ${scadenzaCell}
          ${urgenzaCell}
          ${ordineCell}
          ${paymentCell}
        </div>
      </div>`;
  }

  // ── DA RISCUOTERE / ARCHIVIO / ALTRI: layout completo con date ───────
  const lavPills = LAVORAZIONE_DEFS.map(s => {
    const done  = o.stages?.[s.id]?.done;
    const stage = o.stages?.[s.id];
    const stDate = (s.id === 'ordineStampato' && done && stage?.date)
      ? TCFactory.formatDate(stage.date, {day:'2-digit',month:'2-digit'}) : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
      <button class="stage-pill ${done?'done':''}" onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})" title="${s.label}">${s.shortLabel}</button>
      <span style="font-size:0.6rem;white-space:nowrap;color:${stDate?'#22c55e':'transparent'};">${stDate||'00/00'}</span>
    </div>`;
  }).join('');

  const evaPills = EVASIONE_DEFS.map(s => {
    const done      = o.stages?.[s.id]?.done;
    const stageDate = done && o.stages?.[s.id]?.date
      ? TCFactory.formatDate(o.stages[s.id].date, {day:'2-digit',month:'2-digit'})
      : '';
    return `<div style="display:flex;flex-direction:column;align-items:center;gap:1px;">
      <button class="stage-pill evasione ${done?'done':''}"
        onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
        title="${s.label}">${s.shortLabel}</button>
      <span style="font-size:0.6rem;white-space:nowrap;color:${stageDate?'#22c55e':'transparent'};">${stageDate||'00/00'}</span>
    </div>`;
  }).join('');

  return `
    <div class="order-row-item" role="button" tabindex="0"
      onclick="openOrderDetail('${o.id}')" onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
      <div class="order-row-bar" style="background:${color};"></div>
      <div class="order-row-grid">
        <div class="orc-name">${escapeHtml(o.nome)}</div>
        <div class="orc-date">${TCFactory.formatDate(o.dataOrdine,{day:'2-digit',month:'2-digit',year:'2-digit'})}</div>
        <div class="orc-tags">${tagPills}</div>
        <div class="orc-lav" style="gap:3px;flex-wrap:wrap;">${lavPills}${buildExternaPill()}</div>
        <div class="orc-eva" style="gap:4px;flex-wrap:nowrap;">${evaPills}</div>
        ${scadenzaCell}
        ${urgenzaCell}
        ${ordineCell}
        ${paymentCell}
      </div>
    </div>`;

}

function quickPreviewFile(orderId, fileIndex) {
  const order = TCFactory.getOrderById(orderId);
  if (!order || !order.files[fileIndex]) return;
  previewFile(order.files[fileIndex]);
}

function quickPreviewInvoice(orderId) {
  const order = TCFactory.getOrderById(orderId);
  if (!order || !(order.invoiceFiles||[])[0]) return;
  previewFile(order.invoiceFiles[0]);
}

async function togglePayment(orderId, done) {
  try {
    // Leggi stato PRIMA dell'aggiornamento (cache locale è aggiornata)
    const order   = TCFactory.getOrderById(orderId);
    const isEvaso = !!order?.stages?.spedito?.done;
    const today   = new Date().toISOString().slice(0, 10);

    await TCFactory.updateOrder(orderId, {
      paymentDone: done,
      paymentDate: done ? today : null,
    });

    // Archivio SOLO se ENTRAMBI Evaso E € sono true
    if (done && isEvaso) {
      await TCFactory.setArchived(orderId, true);   // → Archivio
    } else if (!done) {
      await TCFactory.setArchived(orderId, false);  // Deseleziona € → esce dall'archivio
    }
    // done=true ma !isEvaso → resta in Evasione (non archivia)

    renderApp();
  } catch(e) { showToast('Errore pagamento', 'error'); console.error(e); }
}


async function toggleInvoiceConfirmed(orderId, confirmed) {
  try {
    await TCFactory.updateOrder(orderId, { invoiceConfirmed: confirmed });
    renderApp();
  } catch(e) { showToast('Errore fattura', 'error'); }
}

// quickToggleArchive ora RIPRISTINA solo, non archivia più
async function quickToggleArchive(orderId, isArchived) {
  if (!isArchived) {
    showToast('Usa la spunta € per archiviare');
    return;
  }
  try { await moveOrderTo(orderId, 'active'); }
  catch(e) { showToast('Errore', 'error'); }
}

// Separa le righe "normali" del modulo d'ordine da quelle aggiunte come integrazione
function splitModuleRows(rows) {
  return { base: rows.filter(r => !r.integrazione), integ: rows.filter(r => r.integrazione) };
}

function previewOrderModule(orderId) {
  const order   = TCFactory.getOrderById(orderId);
  if (!order) return;
  const rows    = order.orderModule?.rows || [];
  const acconto = parseFloat(order.orderModule?.acconto || 0);
  const total   = rows.reduce((s,r) => s + (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0), 0);
  const saldo   = total - acconto;
  const tags    = order.tags || [];
  const modal   = document.getElementById('file-preview-modal');

  const tagsHtml = tags.map(t => {
    const c = TCFactory.getTagColor(t);
    return `<span style="background:${c}22;color:${c};border:1px solid ${c}66;border-radius:5px;padding:1px 8px;font-size:0.75rem;font-weight:700;">${escapeHtml(t)}</span>`;
  }).join(' ');

  const dlHtml = order.deadline ? (() => {
    const today = new Date().toISOString().slice(0, 10);
    const diff  = Math.ceil((new Date(order.deadline+'T00:00:00') - new Date(today+'T00:00:00')) / 86400000);
    const dc    = diff < 0 ? '#dc2626' : diff <= 7 ? '#ea580c' : '#6366f1';
    return `<span style="color:${dc};font-weight:700;">${new Date(order.deadline+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`;
  })() : '';

  const renderModRow = (r, i) => {
    const t   = (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0);
    const bg  = i % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-secondary)';
    return `<tr style="background:${bg};">
      <td style="padding:7px 10px;font-weight:600;">${escapeHtml(r.catalogo||'')}</td>
      <td style="padding:7px 10px;">${escapeHtml(r.codice||'')}</td>
      <td style="padding:7px 10px;">${escapeHtml(r.descrizione||'')}</td>
      <td style="padding:7px 10px;">${escapeHtml(r.colore||'')}</td>
      <td style="padding:7px 10px;text-align:center;">${r.qnt||''}</td>
      <td style="padding:7px 10px;text-align:center;">${escapeHtml(r.tg||'')}</td>
      <td style="padding:7px 10px;text-align:right;">${r.prezzo ? '€ '+parseFloat(r.prezzo).toFixed(2) : ''}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:700;color:#1e40af;">${t>0 ? '€ '+t.toFixed(2) : ''}</td>
      <td style="padding:7px 10px;text-align:center;color:#16a34a;font-size:1rem;">${r.ordinato ? '✓' : ''}</td>
      <td style="padding:7px 10px;text-align:center;color:#16a34a;font-size:1rem;">${r.lavEsterna ? '✓' : ''}</td>
      <td style="padding:7px 10px;text-align:center;color:#16a34a;font-size:1rem;">${r.neutro ? '✓' : ''}</td>
    </tr>`;
  };
  const integHeaderRow = `<tr><td colspan="11" style="padding:8px 10px;background:#1e40af1a;font-weight:800;font-size:0.7rem;text-transform:uppercase;letter-spacing:.07em;color:#1e40af;border-top:2px solid #1e40af;">Integrazioni</td></tr>`;
  const { base: modBase, integ: modInteg } = splitModuleRows(rows);
  const rowsHtml = rows.length
    ? modBase.map(renderModRow).join('') + (modInteg.length ? integHeaderRow + modInteg.map(renderModRow).join('') : '')
    : `<tr><td colspan="11" style="padding:20px;text-align:center;color:var(--text-muted);">Nessuna riga</td></tr>`;

  modal.innerHTML = `
    <div class="modal" style="max-width:820px;">
      <div class="modal-header">
        <div>
          <div style="font-size:1.8rem;font-weight:900;color:#1e40af;line-height:1.1;">${escapeHtml(tags[0] || 'Ordine')}</div>
          <div style="font-size:0.9rem;color:var(--text-muted);margin-top:3px;">${escapeHtml(order.nome)}${dlHtml ? ` · Deadline: ${dlHtml}` : ''}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-secondary btn-sm" onclick="downloadOrderModule('${order.id}')">⬇ Scarica PDF</button>
          <button class="btn-icon" onclick="closeModal('file-preview-modal')">${Icons.x()}</button>
        </div>
      </div>
      <div class="modal-body" style="padding:0;overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
          <thead>
            <tr style="background:#1e40af;">
              <th style="padding:9px 10px;text-align:left;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Catalogo</th>
              <th style="padding:9px 10px;text-align:left;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Codice</th>
              <th style="padding:9px 10px;text-align:left;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Descrizione</th>
              <th style="padding:9px 10px;text-align:left;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Colore</th>
              <th style="padding:9px 10px;text-align:center;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">QNT</th>
              <th style="padding:9px 10px;text-align:center;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">TG</th>
              <th style="padding:9px 10px;text-align:right;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Prezzo</th>
              <th style="padding:9px 10px;text-align:right;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Totale</th>
              <th style="padding:9px 10px;text-align:center;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Ord.</th>
              <th style="padding:9px 10px;text-align:center;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Lav. est.</th>
              <th style="padding:9px 10px;text-align:center;color:#fff;font-size:0.7rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;">Neutro</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div style="padding:16px 20px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;border-top:2px solid #1e40af;">
          <div style="display:flex;gap:32px;font-size:0.9rem;">
            <span style="color:var(--text-muted);">Totale ordine</span>
            <strong style="color:#1e40af;min-width:90px;text-align:right;">€ ${total.toFixed(2)}</strong>
          </div>
          <div style="display:flex;gap:32px;font-size:0.9rem;">
            <span style="color:var(--text-muted);">Acconto</span>
            <span style="min-width:90px;text-align:right;">€ ${acconto.toFixed(2)}</span>
          </div>
          <div style="display:flex;gap:32px;font-size:0.9rem;">
            <span style="color:var(--text-muted);">Saldo</span>
            <strong style="color:#dc2626;min-width:90px;text-align:right;">€ ${saldo.toFixed(2)}</strong>
          </div>
        </div>
        ${order.notes ? `<div style="padding:12px 20px;border-top:1px solid var(--border);">
          <div style="font-size:0.7rem;font-weight:800;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Note</div>
          <div style="font-size:0.85rem;white-space:pre-wrap;">${escapeHtml(order.notes)}</div>
        </div>` : ''}
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.onclick = e => { if (e.target === modal) closeModal('file-preview-modal'); };
}

function downloadOrderModule(orderId) {
  const order   = orderId ? TCFactory.getOrderById(orderId) : null;
  const nome    = order?.nome || document.getElementById('of-nome')?.value || 'Ordine';
  const rows    = order?.orderModule?.rows || AppState.formModuleRows || [];
  const acconto = parseFloat(order?.orderModule?.acconto || AppState.formModuleAcconto || 0);
  const notes   = order?.notes || document.getElementById('of-notes')?.value || '';
  const total   = rows.reduce((s,r) => s + (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0), 0);
  const saldo   = total - acconto;
  const priId   = order?.priorityId || document.getElementById('of-priority-picker')?.dataset?.selected || '';
  const isUrgent = TCFactory.getPriority(priId)?.id === 'urgente';
  const tags    = order?.tags || AppState.formTags || [];
  const dl      = order?.deadline || document.getElementById('of-deadline')?.value || '';

  // Usa jsPDF se disponibile, altrimenti fallback al print
  if (window.jspdf?.jsPDF) {
    _generatePDF({ nome, rows, acconto, total, saldo, notes, isUrgent, tags, dl });
  } else {
    _generatePrintPreview({ nome, rows, acconto, total, saldo, notes, isUrgent, tags, dl });
  }
}

function _generatePDF({ nome, rows, acconto, total, saldo, notes, isUrgent, tags, dl }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw = doc.internal.pageSize.width;

  // Header
  doc.setFontSize(22); doc.setTextColor(30, 64, 175); doc.setFont(undefined,'bold');
  const tipologia = tags[0] || 'Ordine';
  doc.text(tipologia, 15, 20);
  if (isUrgent) {
    doc.setFontSize(10); doc.setTextColor(220, 38, 38);
    doc.text('⚠ URGENTE', pw - 15, 20, { align: 'right' });
  }

  doc.setFontSize(9); doc.setTextColor(100, 116, 139); doc.setFont(undefined,'normal');
  let y = 28;
  doc.text(`${nome}`, 15, y); y += 5;
  doc.text(`Data: ${new Date().toLocaleDateString('it-IT')}`, 15, y); y += 5;
  if (dl) { doc.text(`Deadline: ${new Date(dl+'T00:00:00').toLocaleDateString('it-IT')}`, 15, y); y += 5; }
  if (tags.length) { doc.text(`Tipologia: ${tags.join(', ')}`, 15, y); y += 5; }

  // Table
  const { base: pdfBase, integ: pdfInteg } = splitModuleRows(rows);
  const rowToArr = r => {
    const t = (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0);
    return [r.catalogo||'', r.codice||'', r.descrizione||'', r.colore||'', r.qnt||'', r.tg||'',
      r.prezzo ? `€ ${parseFloat(r.prezzo).toFixed(2)}` : '',
      t > 0 ? `€ ${t.toFixed(2)}` : '', r.ordinato ? 'SI' : '', r.lavEsterna ? 'SI' : '', r.neutro ? 'SI' : ''];
  };
  const autoTableStyle = {
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [239, 246, 255] },
    columnStyles: { 3:{halign:'center'}, 4:{halign:'center'}, 5:{halign:'right'}, 6:{halign:'right'}, 7:{halign:'center'} },
  };
  doc.autoTable({
    startY: y + 3,
    head: [['Catalogo','Codice','Descrizione','Colore','QNT','TG','Prezzo','Totale','Ord.','Lav. est.','Neutro']],
    body: pdfBase.length ? pdfBase.map(rowToArr) : [['','','','','','','','','','','']],
    ...autoTableStyle,
  });

  let fy = doc.lastAutoTable.finalY + 6;

  if (pdfInteg.length) {
    doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.setTextColor(30, 64, 175);
    doc.text('INTEGRAZIONI', 15, fy); fy += 5;
    doc.autoTable({
      startY: fy,
      head: [['Catalogo','Codice','Descrizione','Colore','QNT','TG','Prezzo','Totale','Ord.','Lav. est.','Neutro']],
      body: pdfInteg.map(rowToArr),
      ...autoTableStyle,
    });
    fy = doc.lastAutoTable.finalY + 6;
  }

  // Totals
  doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.setTextColor(100, 116, 139);
  doc.text('Totale ordine', pw - 60, fy);
  doc.setTextColor(30, 64, 175); doc.setFont(undefined,'bold');
  doc.text(`€ ${total.toFixed(2)}`, pw - 15, fy, { align: 'right' }); fy += 6;
  doc.setFont(undefined,'normal'); doc.setTextColor(100, 116, 139);
  doc.text('Acconto', pw - 60, fy);
  doc.setTextColor(30, 41, 59);
  doc.text(`€ ${acconto.toFixed(2)}`, pw - 15, fy, { align: 'right' }); fy += 6;
  doc.setTextColor(100, 116, 139);
  doc.text('Saldo', pw - 60, fy);
  doc.setTextColor(220, 38, 38); doc.setFont(undefined,'bold');
  doc.text(`€ ${saldo.toFixed(2)}`, pw - 15, fy, { align: 'right' }); fy += 10;

  // Notes
  if (notes && notes.trim()) {
    doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setTextColor(100, 116, 139);
    doc.text('NOTE', 15, fy); fy += 4;
    doc.setFont(undefined,'normal'); doc.setTextColor(30, 41, 59); doc.setFontSize(8.5);
    const noteLines = doc.splitTextToSize(notes, pw - 30);
    doc.text(noteLines, 15, fy);
  }

  doc.save(`ordine-${nome.replace(/[^a-zA-Z0-9]/g,'-')}-${new Date().toISOString().slice(0,10)}.pdf`);
}

function _generatePrintPreview({ nome, rows, acconto, total, saldo, notes, isUrgent, tags, dl }) {
  // Fallback: open print dialog
  const today = new Date().toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'});
  const tagsHtml = tags.map(t => { const c=TCFactory.getTagColor(t); return `<span style="background:${c}22;color:${c};border:1.5px solid ${c}77;border-radius:5px;padding:2px 10px;font-size:12px;font-weight:700;margin-right:5px;">${t}</span>`; }).join('');
  const dlHtml = dl ? (() => { const today2=new Date().toISOString().slice(0,10); const diff=Math.ceil((new Date(dl+'T00:00:00')-new Date(today2+'T00:00:00'))/86400000); const dc=diff<0?'#dc2626':diff<=7?'#ea580c':'#1e40af'; return `<span style="color:${dc};font-weight:700;">${new Date(dl+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'})}</span>`; })() : '';
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Modulo - ${nome}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;margin:25px;color:#1e293b}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e40af;padding-bottom:12px;margin-bottom:16px}
.brand{font-size:18px;font-weight:800;color:#1e40af}.meta{font-size:12px;color:#64748b;line-height:1.8}
.urg{background:#fef2f2;color:#dc2626;border:2px solid #dc2626;border-radius:6px;padding:3px 12px;font-weight:800}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{background:#1e40af;color:#fff;padding:8px 10px;text-align:left;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.07em}
tbody tr:nth-child(odd) td{background:#fff}tbody tr:nth-child(even) td{background:#eff6ff}
tbody td{padding:7px 10px;border-bottom:1px solid #dbeafe}
.tots{margin-top:16px;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.tr{display:flex;gap:48px;font-size:13px}.tl{color:#64748b}.tv{font-weight:800;min-width:90px;text-align:right}
.notes-section{margin-top:16px;padding-top:12px;border-top:1px solid #e2e8f0}
.notes-label{font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px}
.notes-text{font-size:12px;color:#1e293b;white-space:pre-wrap}
@media print{body{margin:12px}}</style></head><body>
<div class="hdr"><div><div class="brand">T&C Factory Creative Lab</div>
<div class="meta"><strong>Ordine:</strong> ${nome}<br><strong>Data:</strong> ${today}
${dlHtml ? `<br><strong>Deadline:</strong> ${dlHtml}` : ''}
${tagsHtml ? `<br><strong>Tipologia:</strong> ${tagsHtml}` : ''}</div></div>
${isUrgent ? `<div class="urg">⚠️ URGENTE</div>` : ''}</div>
<table><thead><tr><th>Catalogo</th><th>Codice</th><th>Descrizione</th><th>Colore</th><th style="text-align:center">QNT</th><th style="text-align:center">TG</th><th style="text-align:right">Prezzo</th><th style="text-align:right">Totale</th><th style="text-align:center">Ord.</th><th style="text-align:center">Lav. est.</th><th style="text-align:center">Neutro</th></tr></thead><tbody>
${(() => {
    const rowHtml = r => { const t=(parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0); return `<tr><td><strong>${r.catalogo||''}</strong></td><td>${r.codice||''}</td><td>${r.descrizione||''}</td><td>${r.colore||''}</td><td style="text-align:center">${r.qnt||''}</td><td style="text-align:center">${r.tg||''}</td><td style="text-align:right">${r.prezzo?'€ '+parseFloat(r.prezzo).toFixed(2):''}</td><td style="text-align:right;font-weight:700;color:#1e40af">${t>0?'€ '+t.toFixed(2):''}</td><td style="text-align:center;color:#16a34a">${r.ordinato?'✓':''}</td><td style="text-align:center;color:#16a34a">${r.lavEsterna?'✓':''}</td><td style="text-align:center;color:#16a34a">${r.neutro?'✓':''}</td></tr>`; };
    const integHeaderHtml = '<tr><td colspan="11" style="padding:8px 10px;background:#eff6ff;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#1e40af;border-top:2px solid #1e40af;">Integrazioni</td></tr>';
    const { base, integ } = splitModuleRows(rows);
    return rows.length ? base.map(rowHtml).join('') + (integ.length ? integHeaderHtml + integ.map(rowHtml).join('') : '') : '<tr><td colspan="11" style="text-align:center;color:#94a3b8;padding:20px">Nessuna riga</td></tr>';
  })()}
</tbody></table>
<div class="tots"><div class="tr"><span class="tl">Totale ordine</span><span class="tv" style="color:#1e40af">€ ${total.toFixed(2)}</span></div><div class="tr"><span class="tl">Acconto</span><span class="tv">€ ${acconto.toFixed(2)}</span></div><div class="tr"><span class="tl">Saldo</span><span class="tv" style="color:#dc2626">€ ${saldo.toFixed(2)}</span></div></div>
${notes && notes.trim() ? `<div class="notes-section"><div class="notes-label">Note</div><div class="notes-text">${escapeHtml(notes.trim())}</div></div>` : ''}
<script>window.onload=()=>window.print()</script></body></html>`;
  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
  else showToast('Abilita i popup per scaricare il modulo', 'error');
}

// ── Integrazioni al modulo d'ordine ──────────

function openIntegrationForm(orderId) {
  const order = TCFactory.getOrderById(orderId);
  if (!order) return;
  AppState.integrationOrderId = orderId;
  AppState.integrationRows = [{ catalogo:'', codice:'', descrizione:'', colore:'', qnt:'', tg:'', prezzo:'' }];

  const modal = document.getElementById('file-preview-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:820px;">
      <div class="modal-header">
        <span>${Icons.plus(16)} Integrazioni — ${escapeHtml(order.nome)}</span>
        <button class="btn-icon" onclick="closeModal('file-preview-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">
        <p style="font-size:0.8rem;color:var(--text-muted);margin:0 0 12px;">Le righe inserite qui si aggiungono al modulo d'ordine sotto la voce "Integrazioni".</p>
        <div class="mod-table-scroll">
          <table class="mod-table" style="width:100%;table-layout:fixed;">
            <thead>
              <tr>
                <th style="width:15%;">CATALOGO</th>
                <th style="width:12%;">CODICE</th>
                <th style="width:19%;">DESCRIZIONE</th>
                <th style="width:11%;">COLORE</th>
                <th style="width:9%;">QNT</th>
                <th style="width:8%;">TG</th>
                <th style="width:11%;">PREZZO</th>
                <th style="width:15%;"></th>
              </tr>
            </thead>
            <tbody id="integ-rows-body"></tbody>
          </table>
        </div>
        <button type="button" onclick="addIntegrationRow()" class="btn btn-secondary btn-sm" style="margin-top:8px;">${Icons.plus(13)} Aggiungi riga</button>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('file-preview-modal')">Annulla</button>
        <button class="btn btn-primary" onclick="saveIntegrationRows()">Salva integrazioni</button>
      </div>
    </div>
  `;
  renderIntegrationRows();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('file-preview-modal'); };
}

function renderIntegrationRows() {
  const tbody = document.getElementById('integ-rows-body');
  if (!tbody) return;
  tbody.innerHTML = AppState.integrationRows.map((r, i) => `
    <tr>
      <td><input class="mod-input" value="${escapeHtml(r.catalogo||'')}" oninput="storeIntegrationField(${i},'catalogo',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.codice||'')}" oninput="storeIntegrationField(${i},'codice',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.descrizione||'')}" oninput="storeIntegrationField(${i},'descrizione',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.colore||'')}" oninput="storeIntegrationField(${i},'colore',this.value)"></td>
      <td><input class="mod-input mod-num" type="number" min="0" value="${r.qnt||''}" oninput="storeIntegrationField(${i},'qnt',this.value)"></td>
      <td><input class="mod-input mod-sm" value="${escapeHtml(r.tg||'')}" oninput="storeIntegrationField(${i},'tg',this.value)"></td>
      <td><input class="mod-input mod-num" type="number" min="0" step="0.01" value="${r.prezzo||''}" oninput="storeIntegrationField(${i},'prezzo',this.value)"></td>
      <td style="display:flex;gap:3px;">
        <button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="removeIntegrationRow(${i})">${Icons.x(12)}</button>
      </td>
    </tr>`).join('');
}

function storeIntegrationField(i, field, value) {
  if (!AppState.integrationRows[i]) return;
  const textFields = ['catalogo','codice','descrizione','colore','tg'];
  AppState.integrationRows[i][field] = textFields.includes(field) ? value : (parseFloat(value) || '');
}

function addIntegrationRow() {
  AppState.integrationRows.push({ catalogo:'', codice:'', descrizione:'', colore:'', qnt:'', tg:'', prezzo:'' });
  renderIntegrationRows();
}

function removeIntegrationRow(i) {
  AppState.integrationRows.splice(i, 1);
  if (AppState.integrationRows.length === 0) {
    AppState.integrationRows.push({ catalogo:'', codice:'', descrizione:'', colore:'', qnt:'', tg:'', prezzo:'' });
  }
  renderIntegrationRows();
}

async function saveIntegrationRows() {
  const orderId = AppState.integrationOrderId;
  const order = TCFactory.getOrderById(orderId);
  if (!order) return;

  const newRows = AppState.integrationRows
    .filter(r => r.catalogo || r.codice || r.descrizione || r.colore || r.qnt || r.prezzo)
    .map(r => ({ ...r, ordinato: false, integrazione: true }));
  if (newRows.length === 0) { showToast('Inserisci almeno una riga', 'error'); return; }

  const currentModule = order.orderModule || { rows: [], acconto: '' };
  const updatedModule = { ...currentModule, rows: [...currentModule.rows, ...newRows] };

  const btn = document.querySelector('#file-preview-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    const updated = await TCFactory.updateOrder(orderId, { orderModule: updatedModule });
    AppState.selectedOrder = updated;
    closeModal('file-preview-modal');
    renderOrderDetail();
    renderOrderList();
    showToast('Integrazioni aggiunte al modulo d\'ordine');
  } catch(e) {
    showToast('Errore salvataggio integrazioni', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Salva integrazioni'; }
  }
}

// ─────────────────────────────────────────────
// AZIONI RAPIDE LISTA
// ─────────────────────────────────────────────

async function quickToggleArchive(orderId, isCurrentlyArchived) {
  try {
    if (isCurrentlyArchived) {
      await moveOrderTo(orderId, 'active');
    } else {
      await TCFactory.setArchived(orderId, true);
      renderApp();
    }
  } catch(e) { showToast('Errore', 'error'); }
}

async function toggleStageInline(orderId, stageId, done) {
  try {
    // Leggi stato PRIMA del setStage (cache locale aggiornata immediatamente dopo)
    const orderBefore = TCFactory.getOrderById(orderId);
    const isPaidBefore  = !!orderBefore?.paymentDone;

    await TCFactory.setStage(orderId, stageId, done);

    if (stageId === 'spedito') {
      if (done) {
        // Evaso = true
        if (isPaidBefore) {
          await TCFactory.setArchived(orderId, true);   // ENTRAMBI → Archivio
        }
        // solo Evaso senza € → Da riscuotere (non archivia)
      } else {
        // De-evaso → reset pagamento e unarchive
        await TCFactory.updateOrder(orderId, { paymentDone: false, paymentDate: null });
        await TCFactory.setArchived(orderId, false);
      }
    }

    if (stageId === 'speditoParzialmente' && !done) {
      const cur = TCFactory.getOrderById(orderId);
      if (cur?.stages?.spedito?.done) {
        await TCFactory.setStage(orderId, 'spedito', false);
        await TCFactory.setArchived(orderId, false);
      }
    }

    renderApp();
  } catch(e) { showToast('Errore aggiornamento fase', 'error'); console.error(e); }
}

async function toggleStageDetail(orderId, stageId, done) {
  try {
    const orderBefore = TCFactory.getOrderById(orderId);
    const isPaidBefore = !!orderBefore?.paymentDone;

    await TCFactory.setStage(orderId, stageId, done);

    if (stageId === 'spedito') {
      if (done) {
        if (isPaidBefore) await TCFactory.setArchived(orderId, true);
      } else {
        await TCFactory.updateOrder(orderId, { paymentDone: false, paymentDate: null });
        await TCFactory.setArchived(orderId, false);
      }
    }
    if (stageId === 'speditoParzialmente' && !done) {
      const cur = TCFactory.getOrderById(orderId);
      if (cur?.stages?.spedito?.done) {
        await TCFactory.setStage(orderId, 'spedito', false);
        await TCFactory.setArchived(orderId, false);
      }
    }

    AppState.selectedOrder = TCFactory.getOrderById(orderId);
    renderOrderDetail();
    renderApp();
  } catch(e) { showToast('Errore aggiornando la fase', 'error'); console.error(e); }
}

async function moveOrderTo(id, target) {
  try {
    await TCFactory.setStage(id, 'speditoParzialmente', false);
    await TCFactory.setStage(id, 'spedito', false);
    await TCFactory.updateOrder(id, { paymentDone: false, paymentDate: null });
    await TCFactory.setArchived(id, false);
    if (target === 'partial')      await TCFactory.setStage(id, 'speditoParzialmente', true);
    if (target === 'dariscuotere') { await TCFactory.setStage(id, 'speditoParzialmente', true); await TCFactory.setStage(id, 'spedito', true); }
    AppState.selectedOrder = TCFactory.getOrderById(id);
    renderOrderDetail();
    renderApp();
    const labels = { active: 'Attivi', partial: 'Parziale', dariscuotere: 'Da riscuotere' };
    showToast('Spostato in: ' + (labels[target] || target));
  } catch(e) { showToast('Errore spostamento', 'error'); }
}
async function restoreOrder(id) {
  await moveOrderTo(id, 'active');
}

// ─────────────────────────────────────────────
// DETTAGLIO ORDINE
// ─────────────────────────────────────────────

function openOrderDetail(id) {
  const order = TCFactory.getOrderById(id);
  if (!order) { showToast('Ordine non trovato', 'error'); return; }
  AppState.selectedOrder = order;
  renderOrderDetail();
  const modal = document.getElementById('order-detail-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('order-detail-modal'); };
}

function renderOrderDetail() {
  const order = AppState.selectedOrder;
  if (!order) return;
  const modal = document.getElementById('order-detail-modal');
  const p = TCFactory.getPriority(order.priorityId);
  const prog = TCFactory.stageProgress(order);
  const { lavDone, lavTotal, allLavDone, isSpeditoP, isSpedito } = prog;

  const renderStageSection = (defs, title) => `
    <div class="progress-box">
      <div style="font-weight:700;font-size:0.85rem;margin-bottom:8px;">${title}</div>
      <div class="stage-list">
        ${defs.map(s => {
          const state = order.stages?.[s.id] || {};
          return `
            <label class="stage-item">
              <input type="checkbox" class="stage-checkbox" ${state.done ? 'checked' : ''}
                onchange="toggleStageDetail('${order.id}','${s.id}',this.checked)">
              <span class="stage-label ${state.done ? 'done' : ''}">
                <span>${s.label}</span>
                ${state.done && state.date ? `<span class="stage-date">${TCFactory.formatDate(state.date)}</span>` : ''}
              </span>
            </label>`;
        }).join('')}
      </div>
    </div>`;

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2>${escapeHtml(order.nome)}</h2>
          ${p ? `<div style="margin-top:4px;">${renderPriorityChip(p)}</div>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button class="btn btn-secondary btn-sm" onclick="closeModal('order-detail-modal');openOrderForm(AppState.selectedOrder)">${Icons.edit(14)} Modifica</button>
          <button class="btn-icon" onclick="closeModal('order-detail-modal')">${Icons.x()}</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="detail-meta">
          <div><span class="detail-meta-label">Data ordine</span><span>${TCFactory.formatDate(order.dataOrdine)}</span></div>
          ${TCFactory.getClient(order.clientId) ? `<div><span class="detail-meta-label">Cliente</span>
            <a href="#/clienti/${order.clientId}" onclick="closeModal('order-detail-modal')" style="font-weight:600;">${escapeHtml(TCFactory.clientName(TCFactory.getClient(order.clientId)))}</a></div>` : ''}
          ${order.deadline ? `<div><span class="detail-meta-label">Deadline</span>
            <span style="font-weight:600;color:${TCFactory.isDeadlinePast(order) && !allLavDone ? 'var(--priority-urgent)' : 'var(--text-primary)'};">${TCFactory.formatDate(order.deadline, { day:'numeric', month:'long', year:'numeric' })}</span>
          </div>` : ''}
          ${order.tags.length > 0 ? `<div><span class="detail-meta-label">Tag</span><div style="display:flex;gap:4px;flex-wrap:wrap;">${order.tags.map(t => renderTagChip(t)).join('')}</div></div>` : ''}
        </div>

        ${order.notes ? `<div class="detail-notes">${escapeHtml(order.notes)}</div>` : ''}

        ${renderStageSection(LAVORAZIONE_DEFS, 'Lavorazione')}
        ${renderStageSection(EVASIONE_DEFS, 'Evasione')}

        <div style="display:flex;flex-wrap:wrap;gap:6px;padding-top:4px;">
          ${order.archived ? `
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','active')">${Icons.archiveRestore(13)} → Attivi</button>
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','partial')">${Icons.truck(13)} → Sped. parz.</button>
          ` : order.stages?.speditoParzialmente?.done ? `
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','active')">${Icons.archiveRestore(13)} → Attivi</button>
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','archived')">${Icons.archive(13)} → Archivio</button>
          ` : `
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','partial')">${Icons.truck(13)} → Sped. parz.</button>
            <button class="btn btn-secondary btn-sm" onclick="moveOrderTo('${order.id}','archived')">${Icons.archive(13)} → Archivio</button>
          `}
        </div>

        ${order.files?.length > 0 ? `
          <div class="detail-files">
            <div class="detail-meta-label" style="margin-bottom:8px;">Allegati ordine</div>
            ${order.files.map((f, i) => `
              <button class="file-item" onclick="previewFile(${JSON.stringify(f).replace(/"/g, '&quot;')})">
                ${Icons.paperclip(14)} <span>${escapeHtml(f.name)}</span>
              </button>`).join('')}
          </div>` : ''}

        ${order.invoiceFiles?.length > 0 ? `
          <div class="detail-files">
            <div class="detail-meta-label" style="margin-bottom:8px;">Fattura</div>
            ${order.invoiceFiles.map((f) => `
              <button class="file-item" onclick="previewFile(${JSON.stringify(f).replace(/"/g, '&quot;')})">
                🧾 <span>${escapeHtml(f.name)}</span>
              </button>`).join('')}
          </div>` : ''}

        ${(order.orderModule?.rows?.length || 0) > 0 ? `
          <div class="detail-files">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div class="detail-meta-label" style="margin-bottom:0;">Modulo d'ordine</div>
              <button class="btn btn-secondary btn-sm" onclick="openIntegrationForm('${order.id}')">${Icons.plus(12)} Integrazione</button>
            </div>
            <button class="file-item" onclick="previewOrderModule('${order.id}')">
              📋 <span>Visualizza modulo (${order.orderModule.rows.length} righe)</span>
            </button>
          </div>` : ''}

        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
          <button class="btn btn-ghost btn-sm" style="color:var(--priority-urgent);" onclick="deleteOrderConfirm('${order.id}')">${Icons.trash(13)} Elimina ordine</button>
        </div>
      </div>
    </div>
  `;
}

async function deleteOrderConfirm(id) {
  const order = TCFactory.getOrderById(id);
  if (!order) return;
  if (!confirm(`Spostare "${order.nome}" nel cestino? Potrai ripristinarlo dalle Impostazioni per 7 giorni.`)) return;
  try {
    await TCFactory.deleteOrder(id);
    closeModal('order-detail-modal');
    renderApp();
    showToast('Ordine spostato nel cestino 🗑');
  } catch(e) { showToast('Errore eliminazione', 'error'); }
}

async function previewFile(stored) {
  if (!stored) return;
  let url;
  try { url = await TCFactory.getFileUrl(stored); }
  catch (e) { showToast('Impossibile aprire il file', 'error'); return; }
  const file = { ...stored, url };
  const modal = document.getElementById('file-preview-modal');
  const isImg = file.type?.startsWith('image/');
  const isPdf = file.type === 'application/pdf';
  modal.innerHTML = `
    <div class="modal" style="max-width:800px;">
      <div class="modal-header">
        <span>${escapeHtml(file.name)}</span>
        <div style="display:flex;gap:8px;">
          <a href="${file.url}" target="_blank" class="btn btn-secondary btn-sm">↗ Apri</a>
          <button class="btn-icon" onclick="closeModal('file-preview-modal')">${Icons.x()}</button>
        </div>
      </div>
      <div class="modal-body">
        ${isImg ? `<img src="${file.url}" style="width:100%;border-radius:var(--radius-md);">` :
          isPdf ? `<iframe src="${file.url}" style="width:100%;height:70vh;border:none;border-radius:var(--radius-md);"></iframe>` :
          `<div style="text-align:center;padding:32px;color:var(--text-muted);">${Icons.paperclip(32)}<p style="margin-top:12px;">Anteprima non disponibile</p><a href="${file.url}" target="_blank" class="btn btn-primary" style="margin-top:16px;">Apri file</a></div>`}
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('file-preview-modal'); };
}

// ─────────────────────────────────────────────
// FORM ORDINE
// ─────────────────────────────────────────────

function openOrderForm(order = null, defaultDate = null, defaultClientId = null) {
  AppState.formEditOrder    = order;
  AppState.formDefaultDate  = defaultDate;
  AppState.formFiles        = order ? [...(order.files || [])] : [];
  AppState.formInvoiceFiles = order ? [...(order.invoiceFiles || [])] : [];
  AppState.formTags         = order ? [...order.tags] : [];
  const mod = order?.orderModule || { rows: [], acconto: '' };
  AppState.formModuleRows    = mod.rows.map(r => ({...r}));
  AppState.formModuleAcconto = mod.acconto || '';

  const isEdit    = !!order;
  const priorities = TCFactory.getPriorities();
  const tags       = TCFactory.getTags();
  const modal      = document.getElementById('order-form-modal');

  modal.innerHTML = `
    <div class="modal" style="max-width:min(1100px, 95vw);">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifica ordine' : 'Nuovo ordine'}</h2>
        <button class="btn-icon" onclick="closeModal('order-form-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">

        <div class="form-group">
          <label class="form-label">Nome ordine *</label>
          <input id="of-nome" class="form-input" placeholder="es. Polo Staff T&C" value="${escapeHtml(order?.nome || '')}">
        </div>

        ${TCFactory.isClientsAvailable() ? `
        <div class="form-group">
          <label class="form-label" for="of-client">Cliente</label>
          <div style="display:flex;gap:8px;">
            <select id="of-client" class="form-select">${renderClientOptions(order?.clientId || defaultClientId)}</select>
            <button type="button" class="btn btn-secondary" onclick="openClientForm(null, (c) => { const sel = document.getElementById('of-client'); if (sel) sel.innerHTML = renderClientOptions(c.id); })">${Icons.plus()} Nuovo</button>
          </div>
        </div>` : ''}

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Data ordine *</label>
            <input id="of-data" type="date" class="form-input" value="${order?.dataOrdine || TCFactory.getDefaultDate()}">
          </div>
          <div class="form-group">
            <label class="form-label">Deadline</label>
            <input id="of-deadline" type="date" class="form-input" value="${order?.deadline || ''}" onchange="checkDeadlineUrgency(this.value)">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Importo <span style="font-size:0.72rem;color:var(--text-muted);">(auto dal modulo se compilato)</span></label>
          <div style="position:relative;">
            <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-weight:600;">€</span>
            <input id="of-importo" type="number" class="form-input" style="padding-left:28px;" step="0.01" min="0"
              value="${order?.importo || ''}" placeholder="0.00">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Priorità</label>
          <div class="chip-picker" id="of-priority-picker" data-selected="">
            ${priorities.map(p => {
              const defaultPId = order ? order.priorityId : (TCFactory.getDefaultPriorityId() || priorities[0]?.id);
              const active = defaultPId === p.id;
              return `<button type="button" class="chip chip-btn" data-prio="${p.id}"
                style="background:${active ? p.color : `color-mix(in srgb, ${p.color} 12%, transparent)`};color:${active ? '#fff' : p.color};"
                onclick="selectPriorityChip('${p.id}')">${escapeHtml(p.label)}</button>`;
            }).join('')}
          </div>
        </div>

        <div class="form-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="of-lav-esterna" ${order?.lavorazioneEsterna ? 'checked' : ''}>
            <span class="form-label" style="margin:0;">Lavorazione Esterna</span>
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">Tipologia * <span style="font-size:0.72rem;color:var(--text-muted);font-weight:400;">(seleziona 1)</span></label>
          <div class="chip-picker" id="of-tag-picker">
            ${tags.map(t => renderTagPickerChip(t)).join('')}
          </div>
        </div>

        <!-- MODULO D'ORDINE -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);cursor:pointer;" onclick="toggleFormModule()">
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="font-weight:700;font-size:0.88rem;">📋 Modulo d'ordine</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation();downloadOrderModule(null)">⬇ Scarica</button>
              <svg id="module-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="transform:rotate(${AppState.formModuleOpen?180:0}deg);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
          <div id="module-body" style="display:${AppState.formModuleOpen?'block':'none'};padding:12px 14px;">
            <div class="mod-table-scroll">
              <table class="mod-table" style="width:100%;table-layout:fixed;">
                <thead>
                  <tr>
                    <th style="width:13%;">CATALOGO</th>
                    <th style="width:10%;">CODICE</th>
                    <th style="width:14%;">DESCRIZIONE</th>
                    <th style="width:9%;">COLORE</th>
                    <th style="width:6%;">QNT</th>
                    <th style="width:5%;">TG</th>
                    <th style="width:8%;">PREZZO</th>
                    <th style="width:8%;">TOTALE</th>
                    <th style="width:5%;text-align:center;">ORD.</th>
                    <th style="width:6%;text-align:center;" title="Lavorazione esterna">LAV. EST.</th>
                    <th style="width:6%;text-align:center;">NEUTRO</th>
                    <th style="width:10%;"></th>
                  </tr>
                </thead>
                <tbody id="mod-rows-body"></tbody>
              </table>
            </div>
            <button type="button" onclick="addModRow()" class="btn btn-secondary btn-sm" style="margin-top:8px;">${Icons.plus(13)} Aggiungi riga</button>
            <div style="margin-top:12px;display:flex;flex-direction:column;align-items:flex-end;gap:6px;border-top:1px solid var(--border);padding-top:10px;">
              <div style="display:flex;align-items:center;gap:12px;font-size:0.82rem;">
                <span style="color:var(--text-muted);">Totale ordine</span>
                <strong id="mod-total-val" style="font-size:1.05rem;color:var(--brand-gold);min-width:80px;text-align:right;">€ 0.00</strong>
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:0.82rem;">
                <span style="color:var(--text-muted);">Acconto</span>
                <input type="number" id="mod-acconto" class="form-input" style="width:80px;text-align:right;" min="0" step="0.01" value="${escapeHtml(String(AppState.formModuleAcconto||''))}" placeholder="0.00" oninput="AppState.formModuleAcconto=this.value;updateModuleTotals()">
              </div>
              <div style="display:flex;align-items:center;gap:12px;font-size:0.82rem;">
                <span style="color:var(--text-muted);">Saldo</span>
                <strong id="mod-saldo-val" style="font-size:1.05rem;color:#ef4444;min-width:80px;text-align:right;">€ 0.00</strong>
              </div>
            </div>
          </div>
        </div>

        <!-- ALLEGATI ORDINE -->
        <div class="form-group">
          <label class="form-label">Allegati ordine</label>
          <div class="dropzone">
            <input type="file" id="of-file-input" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" style="display:none;" onchange="handleFormFiles(event)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('of-file-input').click()">${Icons.paperclip(14)} Carica file / foto</button>
            <p>Immagini compresse automaticamente sotto 2MB</p>
          </div>
          <div id="of-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
        </div>

        <!-- FATTURA -->
        <div class="form-group">
          <label class="form-label">Fattura</label>
          <div class="dropzone">
            <input type="file" id="of-invoice-input" multiple accept="image/*,application/pdf,.pdf" style="display:none;" onchange="handleInvoiceFiles(event)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('of-invoice-input').click()">🧾 Carica fattura</button>
            <p>PDF o immagine</p>
          </div>
          <div id="of-invoice-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
        </div>

        <div class="form-group">
          <label class="form-label">Note</label>
          <textarea id="of-notes" class="form-textarea" placeholder="Note interne, comunicazioni ai colleghi…">${escapeHtml(order?.notes || '')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('order-form-modal')">Annulla</button>
        <button class="btn btn-primary" onclick="submitOrderForm()">${isEdit ? 'Salva modifiche' : 'Crea ordine'}</button>
      </div>
    </div>
  `;

  if (!isEdit) {
    document.getElementById('of-priority-picker').dataset.selected = TCFactory.getDefaultPriorityId() || priorities[0]?.id || '';
  } else {
    document.getElementById('of-priority-picker').dataset.selected = order.priorityId;
  }

  // Seleziona tag attivi
  AppState.formTags.forEach(tagName => {
    const tag = tags.find(t => t.name === tagName);
    if (tag) selectTagChip(tagName, false);
  });

  renderFormFilesList();
  renderFormInvoiceList();
  if (AppState.formModuleOpen) renderModuleRows();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('order-form-modal'); };
}

function checkDeadlineUrgency(dateStr) {
  if (!dateStr) return;
  const today = new Date().toISOString().slice(0, 10);
  const diff  = Math.ceil((new Date(dateStr + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
  if (diff >= 0 && diff <= 7) {
    selectPriorityChip('urgente');
    showToast('Deadline entro 7 giorni → impostato Urgente');
  }
}

function toggleFormModule() {
  AppState.formModuleOpen = !AppState.formModuleOpen;
  const body = document.getElementById('module-body');
  const chev = document.getElementById('module-chevron');
  if (body) body.style.display = AppState.formModuleOpen ? 'block' : 'none';
  if (chev) chev.style.transform = `rotate(${AppState.formModuleOpen ? 180 : 0}deg)`;
  if (AppState.formModuleOpen) renderModuleRows();
}

function renderTagPickerChip(t) {
  const active = AppState.formTags.includes(t.name);
  return `<button type="button" class="chip chip-btn" data-tag="${escapeHtml(t.name)}"
    style="background:${active ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`};color:${active ? '#fff' : t.color};"
    onclick="selectTagChip('${escapeHtml(t.name)}',true)">${escapeHtml(t.name)}</button>`;
}

function selectTagChip(name, toggle = true) {
  if (toggle) {
    // Comportamento radio: seleziona questo, deseleziona tutti gli altri
    AppState.formTags = AppState.formTags.includes(name) ? [] : [name];
  }
  document.querySelectorAll('#of-tag-picker .chip-btn').forEach(btn => {
    const t = TCFactory.getTags().find(t => t.name === btn.dataset.tag);
    if (!t) return;
    const active = AppState.formTags.includes(t.name);
    btn.style.background = active ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`;
    btn.style.color = active ? '#fff' : t.color;
    btn.style.borderColor = active ? t.color : 'transparent';
  });
}

function selectPriorityChip(id) {
  document.getElementById('of-priority-picker').dataset.selected = id;
  document.querySelectorAll('#of-priority-picker .chip-btn').forEach(btn => {
    const p = TCFactory.getPriority(btn.dataset.prio);
    if (!p) return;
    const active = btn.dataset.prio === id;
    btn.style.background = active ? p.color : `color-mix(in srgb, ${p.color} 12%, transparent)`;
    btn.style.color = active ? '#fff' : p.color;
  });
}

function renderFormFilesList() {
  const container = document.getElementById('of-files-list');
  if (!container) return;
  container.innerHTML = AppState.formFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.8rem;">
      <span>${f.type?.startsWith('image/') ? '🖼' : '📄'}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
      <span style="color:var(--text-muted);">${(f.size/1024).toFixed(0)} KB</span>
      <button type="button" class="btn-icon" onclick="removeFormFile(${i})" style="color:var(--priority-urgent);">${Icons.x(13)}</button>
    </div>`).join('');
}

function removeFormFile(i) {
  AppState.formFiles.splice(i, 1);
  renderFormFilesList();
}

// ── Modulo d'ordine ──────────────────────────

function renderModuleRows() {
  const tbody = document.getElementById('mod-rows-body');
  if (!tbody) return;
  const rowHtml = (r, i) => {
    const tot = (parseFloat(r.qnt)||0) * (parseFloat(r.prezzo)||0);
    return `<tr>
      <td><input class="mod-input" value="${escapeHtml(r.catalogo||'')}" oninput="storeMod(${i},'catalogo',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.codice||'')}" oninput="storeMod(${i},'codice',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.descrizione||'')}" oninput="storeMod(${i},'descrizione',this.value)"></td>
      <td><input class="mod-input" value="${escapeHtml(r.colore||'')}" oninput="storeMod(${i},'colore',this.value)"></td>
      <td><input class="mod-input mod-num" type="number" min="0" value="${r.qnt||''}" oninput="storeMod(${i},'qnt',this.value);calcModRow(${i})"></td>
      <td><input class="mod-input mod-sm" value="${escapeHtml(r.tg||'')}" oninput="storeMod(${i},'tg',this.value)"></td>
      <td><input class="mod-input mod-num" type="number" min="0" step="0.01" value="${r.prezzo||''}" oninput="storeMod(${i},'prezzo',this.value);calcModRow(${i})"></td>
      <td><span id="mod-tot-${i}" class="mod-calc">${tot>0 ? '€ '+tot.toFixed(2) : ''}</span></td>
      <td style="text-align:center;"><input type="checkbox" ${r.ordinato?'checked':''} onchange="storeMod(${i},'ordinato',this.checked)"></td>
      <td style="text-align:center;"><input type="checkbox" title="Lavorazione esterna" ${r.lavEsterna?'checked':''} onchange="storeMod(${i},'lavEsterna',this.checked)"></td>
      <td style="text-align:center;"><input type="checkbox" title="Neutro" ${r.neutro?'checked':''} onchange="storeMod(${i},'neutro',this.checked)"></td>
      <td style="display:flex;gap:3px;">
        <button type="button" class="btn-icon" onclick="copyModRow(${i})" title="Copia riga">${Icons.copy ? Icons.copy(12) : '⧉'}</button>
        <button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="removeModRow(${i})">${Icons.x(12)}</button>
      </td>
    </tr>`;
  };
  const indexed = AppState.formModuleRows.map((r, i) => ({ r, i }));
  const base  = indexed.filter(x => !x.r.integrazione);
  const integ = indexed.filter(x => x.r.integrazione);
  const integHeaderRow = `<tr><td colspan="12" style="padding:8px 10px;background:var(--bg-secondary);font-weight:800;font-size:0.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Integrazioni</td></tr>`;
  tbody.innerHTML = base.map(x => rowHtml(x.r, x.i)).join('') + (integ.length ? integHeaderRow + integ.map(x => rowHtml(x.r, x.i)).join('') : '');
  updateModuleTotals();
}

function copyModRow(i) {
  const row = { ...AppState.formModuleRows[i] };
  AppState.formModuleRows.splice(i + 1, 0, row);
  renderModuleRows();
}

function storeMod(i, field, value) {
  if (!AppState.formModuleRows[i]) return;
  const textFields = ['catalogo','codice','descrizione','colore','tg'];
  AppState.formModuleRows[i][field] = textFields.includes(field) ? value : (['ordinato','lavEsterna','neutro'].includes(field) ? value : (parseFloat(value) || ''));
}
function calcModRow(i) {
  const r = AppState.formModuleRows[i] || {};
  const tot = (parseFloat(r.qnt)||0) * (parseFloat(r.prezzo)||0);
  const el = document.getElementById(`mod-tot-${i}`);
  if (el) el.textContent = tot > 0 ? '€ ' + tot.toFixed(2) : '';
  updateModuleTotals();
}
function updateModuleTotals() {
  const total   = AppState.formModuleRows.reduce((s,r) => s + (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0), 0);
  const acconto = parseFloat(AppState.formModuleAcconto) || 0;
  const saldo   = total - acconto;
  const et = document.getElementById('mod-total-val');
  const es = document.getElementById('mod-saldo-val');
  if (et) et.textContent = '€ ' + total.toFixed(2);
  if (es) { es.textContent = '€ ' + saldo.toFixed(2); es.style.color = saldo > 0 ? '#ef4444' : '#22c55e'; }
  // Auto-popola il campo importo se il modulo ha prezzi
  if (total > 0) {
    const importoField = document.getElementById('of-importo');
    if (importoField) importoField.value = total.toFixed(2);
  }
}
function addModRow() {
  AppState.formModuleRows.push({ catalogo:'', codice:'', colore:'', qnt:'', tg:'', prezzo:'', ordinato:false, lavEsterna:false, neutro:false });
  renderModuleRows();
}
function removeModRow(i) {
  AppState.formModuleRows.splice(i, 1);
  renderModuleRows();
}

// ── Fattura ───────────────────────────────────

function renderFormInvoiceList() {
  const c = document.getElementById('of-invoice-list');
  if (!c) return;
  c.innerHTML = AppState.formInvoiceFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.8rem;">
      <span>🧾</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.name)}</span>
      <span style="color:var(--text-muted);">${(f.size/1024).toFixed(0)} KB</span>
      <button type="button" class="btn-icon" onclick="removeInvoiceFile(${i})" style="color:var(--priority-urgent);">${Icons.x(13)}</button>
    </div>`).join('');
}

async function handleInvoiceFiles(event) {
  const list = event.target.files;
  if (!list) return;
  for (const f of Array.from(list)) {
    try {
      let file = f;
      if (f.type.startsWith('image/') && f.size > TCFactory.MAX_FILE_BYTES) {
        showToast(`Comprimo ${f.name}…`);
        file = await compressImageIfNeeded(f);
      }
      if (file.size > TCFactory.MAX_FILE_BYTES) { showToast(`${f.name} supera 2MB`, 'error'); continue; }
      const uploaded = await TCFactory.uploadFile(file);
      AppState.formInvoiceFiles.push({ ...uploaded, name: f.name });
    } catch(e) { showToast(`Errore caricando ${f.name}`, 'error'); }
  }
  event.target.value = '';
  renderFormInvoiceList();
}

function removeInvoiceFile(i) {
  AppState.formInvoiceFiles.splice(i, 1);
  renderFormInvoiceList();
}

// ── Submit ────────────────────────────────────

async function submitOrderForm() {
  const nome       = document.getElementById('of-nome')?.value?.trim();
  const dataOrdine = document.getElementById('of-data')?.value;
  const deadline   = document.getElementById('of-deadline')?.value || null;
  const notes      = document.getElementById('of-notes')?.value || '';
  const priorityId = document.getElementById('of-priority-picker')?.dataset?.selected;

  if (!nome) { showToast('Inserisci un nome', 'error'); return; }
  if (!dataOrdine) { showToast('Inserisci una data', 'error'); return; }
  if (AppState.formTags.length === 0) { showToast('Seleziona una tipologia (tag)', 'error'); return; }
  if (AppState.formTags.length > 1)   { showToast('Puoi selezionare una sola tipologia', 'error'); return; }

  // Auto-urgente se deadline entro 7 giorni
  let finalPriorityId = priorityId;
  if (deadline) {
    const today = new Date().toISOString().slice(0, 10);
    const diff  = Math.ceil((new Date(deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    if (diff >= 0 && diff <= 7 && finalPriorityId !== 'urgente') {
      finalPriorityId = 'urgente';
    }
  }

  const selectedPriority = TCFactory.getPriority(priorityId);
  if (selectedPriority?.id === 'urgente' && !deadline) {
    const dlField = document.getElementById('of-deadline');
    if (dlField) {
      dlField.focus();
      dlField.style.borderColor = 'var(--priority-urgent)';
      dlField.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--priority-urgent) 25%, transparent)';
      dlField.addEventListener('input', () => { dlField.style.borderColor = ''; dlField.style.boxShadow = ''; }, { once: true });
    }
    showToast('Gli ordini urgenti richiedono una deadline', 'error');
    return;
  }

  const payload = {
    nome, dataOrdine, deadline, notes, priorityId: finalPriorityId,
    lavorazioneEsterna: !!document.getElementById('of-lav-esterna')?.checked,
    tags: AppState.formTags,
    files: AppState.formFiles,
    invoiceFiles: AppState.formInvoiceFiles,
    importo: parseFloat(document.getElementById('of-importo')?.value) || 0,
    orderModule: { rows: AppState.formModuleRows, acconto: AppState.formModuleAcconto },
  };
  const clientSel = document.getElementById('of-client');
  if (clientSel) payload.clientId = clientSel.value || null;

  const btn = document.querySelector('#order-form-modal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }

  let saved = false;
  try {
    if (AppState.formEditOrder) {
      await TCFactory.updateOrder(AppState.formEditOrder.id, payload);
    } else {
      await TCFactory.addOrder(payload);
    }
    saved = true;
  } catch(e) {
    showToast('Errore durante il salvataggio — riprova', 'error');
    console.error('[submit]', e);
  } finally {
    // Il pulsante torna sempre cliccabile
    if (btn) {
      btn.disabled = false;
      btn.textContent = AppState.formEditOrder ? 'Salva modifiche' : 'Crea ordine';
    }
  }

  if (saved) {
    closeModal('order-form-modal');
    showToast(AppState.formEditOrder ? 'Ordine aggiornato ✓' : 'Ordine creato ✓');
  }
}

// ─────────────────────────────────────────────
// FILE COMPRESSIONE + UPLOAD
// ─────────────────────────────────────────────

async function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= TCFactory.MAX_FILE_BYTES) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.naturalWidth, h = img.naturalHeight;
      const MAX_DIM = 1920;
      if (w > MAX_DIM || h > MAX_DIM) { const s = MAX_DIM / Math.max(w, h); w = Math.round(w*s); h = Math.round(h*s); }
      const attempt = (width, height, quality) => {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= TCFactory.MAX_FILE_BYTES) {
            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
          } else if (quality > 0.25) {
            attempt(width, height, quality - 0.15);
          } else if (width > 900) {
            attempt(Math.round(width * 0.7), Math.round(height * 0.7), 0.75);
          } else { resolve(file); }
        }, 'image/jpeg', quality);
      };
      attempt(w, h, 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function handleFormFiles(event) {
  const list = event.target.files;
  if (!list) return;
  for (const f of Array.from(list)) {
    try {
      let file = f;
      if (f.type.startsWith('image/') && f.size > TCFactory.MAX_FILE_BYTES) {
        showToast(`Comprimo ${f.name}…`);
        file = await compressImageIfNeeded(f);
        if (file !== f) showToast(`📷 ${f.name} → ${(file.size / 1024).toFixed(0)} KB`);
      }
      if (file.size > TCFactory.MAX_FILE_BYTES) { showToast(`${f.name} supera 2MB`, 'error'); continue; }
      const uploaded = await TCFactory.uploadFile(file);
      AppState.formFiles.push({ ...uploaded, name: f.name });
    } catch(e) { showToast(`Errore caricando ${f.name}`, 'error'); }
  }
  event.target.value = '';
  renderFormFilesList();
}

// ─────────────────────────────────────────────
// MODAL HELPERS
// ─────────────────────────────────────────────

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal || !modal.classList.contains('active')) return;
  modal.classList.remove('active');
  if (A11yPrefs.get('motion')) return;
  // Resta visibile per l'animazione di chiusura; se viene riaperto subito, .active ha la precedenza
  modal.classList.add('closing');
  clearTimeout(modal._closeTimer);
  modal._closeTimer = setTimeout(() => modal.classList.remove('closing'), 180);
}

// ─────────────────────────────────────────────
// IMPOSTAZIONI
// ─────────────────────────────────────────────

let _newPrioColor = '#3b82f6';
let _newTagColor  = '#10b981';

function openSettings() { Nav.go('impostazioni'); }

function renderSettingsDialog() {
  const priorities = TCFactory.getPriorities();
  const tags       = TCFactory.getTags();
  const root       = document.getElementById('settings-root');
  if (!root) return;

  const sectionBtn = (label, icon, isOpen, fn) => `
    <button type="button" class="settings-section-btn" onclick="${fn}()" aria-expanded="${isOpen}"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);border:none;cursor:pointer;color:var(--text-primary);font-family:var(--font-body);font-weight:700;font-size:0.88rem;border-radius:${isOpen ? `var(--radius-md) var(--radius-md) 0 0` : 'var(--radius-md)'};margin-bottom:${isOpen ? 0 : 6}px;">
      <div style="display:flex;align-items:center;gap:8px;">${icon} ${label}</div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="transform:rotate(${isOpen ? 180 : 0}deg);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
    </button>`;

  const switchRow = (label, hint, checked, onchange) => `
    <label class="switch-row">
      <span><strong>${label}</strong><small>${hint}</small></span>
      <input type="checkbox" class="switch" ${checked ? 'checked' : ''} onchange="${onchange}">
    </label>`;

  root.innerHTML = `
    <div class="glass-card page-card page-narrow">
      <div class="page-card-body" style="display:flex;flex-direction:column;gap:8px;">

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          <div class="settings-static-head">${Icons.sun(14)} Aspetto</div>
          <div style="padding:4px 14px 10px;">
            ${switchRow('Tema scuro', 'Colori scuri per ambienti poco illuminati', Theme.get() === 'dark', 'Theme.toggle()')}
            ${switchRow('Riduci trasparenza', 'Superfici opache al posto del vetro', A11yPrefs.get('transparency'), "A11yPrefs.set('transparency', this.checked)")}
            ${switchRow('Riduci movimento', 'Disattiva animazioni e transizioni', A11yPrefs.get('motion'), "A11yPrefs.set('motion', this.checked)")}
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          <div class="settings-static-head">${Icons.calendarDays(14)} Scadenze automatiche</div>
          <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
            <div class="settings-section-hint" style="margin:0;">Per gli ordini senza deadline il Planner calcola la scadenza come data ordine + questi giorni. Vale per tutti gli utenti.</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <input id="auto-deadline-days" type="number" min="0" max="365" class="form-input" style="width:100px;" value="${TCFactory.getAutoDeadlineDays()}"
                onkeydown="if(event.key==='Enter')saveAutoDeadlineDays()">
              <span style="font-size:0.85rem;color:var(--text-secondary);">giorni dopo la data ordine</span>
              <button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="saveAutoDeadlineDays()">Salva</button>
            </div>
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Priorità', Icons.flag(14), AppState.settingsPrioOpen, 'toggleSettingsPrio')}
          ${AppState.settingsPrioOpen ? `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px;">
            <div class="settings-section-hint">L'ordine in alto determina la priorità più alta.</div>
            ${priorities.map((p, idx) => `
              <div class="config-row">
                <div class="reorder-arrows">
                  <button ${idx === 0 ? 'disabled' : ''} onclick="reorderPrio('${p.id}','up')">${Icons.arrowUp()}</button>
                  <button ${idx === priorities.length - 1 ? 'disabled' : ''} onclick="reorderPrio('${p.id}','down')">${Icons.arrowDown()}</button>
                </div>
                <div class="color-dot-picker" style="background:${p.color};">
                  <input type="color" value="${p.color}" onchange="updatePrioColor('${p.id}', this.value)">
                </div>
                <input class="form-input" value="${escapeHtml(p.label)}" maxlength="40" onchange="updatePrioLabel('${p.id}', this.value)">
                <button class="btn-icon" style="color:var(--priority-urgent);" ${priorities.length <= 1 ? 'disabled' : ''} onclick="deletePrioConfirm('${p.id}')">${Icons.trash(15)}</button>
              </div>
            `).join('')}
            <div class="config-add-row">
              <div class="color-dot-picker" style="background:${_newPrioColor};">
                <input type="color" value="${_newPrioColor}" onchange="_newPrioColor=this.value">
              </div>
              <input id="new-prio-input" class="form-input" placeholder="Nuova priorità" maxlength="40" onkeydown="if(event.key==='Enter'){addNewPriority();}">
              <button class="btn btn-secondary btn-icon" onclick="addNewPriority()">${Icons.plus()}</button>
            </div>
          </div>` : ''}
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Tag', Icons.tag(14), AppState.settingsTagOpen, 'toggleSettingsTag')}
          ${AppState.settingsTagOpen ? `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px;">
            ${tags.map(t => `
              <div class="config-row">
                <div class="color-dot-picker" style="background:${t.color};">
                  <input type="color" value="${t.color}" onchange="updateTagColorSetting('${escapeHtml(t.name)}', this.value)">
                </div>
                <span style="flex:1;font-size:0.88rem;">${escapeHtml(t.name)}</span>
                <button class="btn-icon" style="color:var(--priority-urgent);" onclick="deleteTagConfirm('${escapeHtml(t.name)}')">${Icons.trash(15)}</button>
              </div>
            `).join('')}
            <div class="config-add-row">
              <div class="color-dot-picker" style="background:${_newTagColor};">
                <input type="color" value="${_newTagColor}" onchange="_newTagColor=this.value">
              </div>
              <input id="new-tag-input" class="form-input" placeholder="Nuovo tag" maxlength="40" onkeydown="if(event.key==='Enter'){addNewTagSetting();}">
              <button class="btn btn-secondary btn-icon" onclick="addNewTagSetting()">${Icons.plus()}</button>
            </div>
          </div>` : ''}
        </div>

        ${TCAuth.isLoggedIn() ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('La mia password', Icons.lock(14), AppState.settingsPwdOpen, 'toggleSettingsPwd')}
          ${AppState.settingsPwdOpen ? `
          <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
            <div class="settings-section-hint">Inserisci la password attuale per confermarne il cambio.</div>
            <input id="pwd-old"  type="password" class="form-input" placeholder="Password attuale">
            <input id="pwd-new1" type="password" class="form-input" placeholder="Nuova password (min. ${MIN_PASSWORD_LENGTH} caratteri)">
            <input id="pwd-new2" type="password" class="form-input" placeholder="Ripeti nuova password"
              onkeydown="if(event.key==='Enter')doChangePassword()">
            <button class="btn btn-primary btn-sm" style="align-self:flex-end;" onclick="doChangePassword()">Aggiorna password</button>
          </div>` : ''}
        </div>
        ` : ''}

      </div>
    </div>
  `;
}

async function saveAutoDeadlineDays() {
  const v = parseInt(document.getElementById('auto-deadline-days')?.value, 10);
  if (!Number.isFinite(v) || v < 0 || v > 365) { showToast('Inserisci un numero tra 0 e 365', 'error'); return; }
  try {
    await TCFactory.setSetting('auto_deadline_days', v);
    showToast(`Scadenza automatica: ${v} giorni dopo la data ordine`);
  } catch (e) {
    showToast('Impossibile salvare: esegui prima sql/clienti-setup.sql su Supabase', 'error');
  }
}

function toggleSettingsPrio()  { AppState.settingsPrioOpen  = !AppState.settingsPrioOpen;  renderSettingsDialog(); }
function toggleSettingsTag()   { AppState.settingsTagOpen   = !AppState.settingsTagOpen;   renderSettingsDialog(); }
function toggleSettingsPwd()   { AppState.settingsPwdOpen   = !AppState.settingsPwdOpen;   renderSettingsDialog(); }

async function renderCestinoSection(container) {
  const trashed = TCFactory.getTrashedOrders();
  const now     = new Date();

  const isAdmin = TCAuth.isAdmin();

  // Auto-pulizia dopo 7 giorni: solo un admin può eliminare definitivamente
  if (isAdmin) for (const o of trashed) {
    const deletedMs = new Date(o.deletedAt).getTime();
    if (now - deletedMs > 7 * 24 * 60 * 60 * 1000) {
      await TCFactory.permanentDeleteOrder(o.id).catch(() => {});
    }
  }

  const current = TCFactory.getTrashedOrders(); // aggiornato dopo pulizia

  if (current.length === 0) {
    container.innerHTML = `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:12px 0;">Il cestino è vuoto.</div>`;
    return;
  }

  container.innerHTML = `
    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
      ${isAdmin ? 'Gli ordini vengono eliminati definitivamente dopo 7 giorni.' : 'Puoi ripristinare gli ordini. Solo un admin può eliminarli definitivamente.'}
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;">
      ${current.map(o => {
        const deletedDate = new Date(o.deletedAt);
        const daysLeft = Math.max(0, 7 - Math.floor((now - deletedDate) / (24*60*60*1000)));
        const dt = deletedDate.toLocaleDateString('it-IT',{day:'2-digit',month:'2-digit',year:'2-digit'});
        const tag = o.tags?.[0] ? `<span style="font-size:0.7rem;color:${TCFactory.getTagColor(o.tags[0])};font-weight:600;">${escapeHtml(o.tags[0])}</span>` : '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-secondary);border-radius:var(--radius-md);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.85rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(o.nome)}</div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:2px;">
              ${tag}
              <span style="font-size:0.7rem;color:var(--text-muted);">Eliminato ${dt} · ${daysLeft > 0 ? `${daysLeft}gg rimasti` : 'in attesa di eliminazione'}</span>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="restoreOrderFromTrash('${o.id}')">Ripristina</button>
          ${isAdmin ? `<button class="btn-icon" style="color:var(--priority-urgent);" onclick="permanentDeleteConfirm('${o.id}')" title="Elimina definitivamente" aria-label="Elimina definitivamente ${escapeHtml(o.nome)}">${Icons.trash(14)}</button>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

async function restoreOrderFromTrash(id) {
  try {
    await TCFactory.restoreOrder(id);
    showToast('Ordine ripristinato');
    renderApp();
    const b = document.getElementById('cestino-body');
    if (b) renderCestinoSection(b);
  } catch(e) { showToast('Errore ripristino', 'error'); }
}

async function permanentDeleteConfirm(id) {
  if (!TCAuth.isAdmin()) { showToast('Solo un admin può eliminare definitivamente', 'error'); return; }
  const o = TCFactory.getTrashedOrders().find(x => x.id === id);
  if (!confirm(`Eliminare definitivamente "${o?.nome || id}"? Impossibile annullare.`)) return;
  try {
    await TCFactory.permanentDeleteOrder(id);
    showToast('Eliminato definitivamente');
    const b = document.getElementById('cestino-body');
    if (b) renderCestinoSection(b);
  } catch(e) { showToast(e.message || 'Errore', 'error'); }
}

async function doChangePassword() {
  const oldPwd = document.getElementById('pwd-old')?.value;
  const newPwd = document.getElementById('pwd-new1')?.value;
  const repPwd = document.getElementById('pwd-new2')?.value;
  if (!oldPwd || !newPwd) { showToast('Compila tutti i campi', 'error'); return; }
  if (newPwd !== repPwd)  { showToast('Le nuove password non coincidono', 'error'); return; }
  if (newPwd.length < MIN_PASSWORD_LENGTH) { showToast(`Minimo ${MIN_PASSWORD_LENGTH} caratteri`, 'error'); return; }
  try {
    await TCAuth.changePassword(oldPwd, newPwd);
    showToast('Password aggiornata ✓');
    AppState.settingsPwdOpen = false;
    renderSettingsDialog();
  } catch(e) { showToast(e.message, 'error'); }
}

// ─────────────────────────────────────────────
// PRIORITÀ settings actions
// ─────────────────────────────────────────────

async function reorderPrio(id, dir) {
  const prios = [...TCFactory.getPriorities()];
  const idx   = prios.findIndex(p => p.id === id);
  if (dir === 'up'   && idx > 0)                { [prios[idx-1], prios[idx]] = [prios[idx], prios[idx-1]]; }
  if (dir === 'down' && idx < prios.length - 1) { [prios[idx], prios[idx+1]] = [prios[idx+1], prios[idx]]; }
  prios.forEach((p, i) => p.sort_order = i);
  try {
    for (const p of prios) await supabaseClient.from('priorities').update({ sort_order: p.sort_order }).eq('id', p.id);
    TCFactory._priorities = prios;
    renderSettingsDialog();
  } catch(e) { showToast('Errore riordinamento', 'error'); }
}

async function updatePrioColor(id, color) {
  try {
    await supabaseClient.from('priorities').update({ color }).eq('id', id);
    TCFactory._priorities = TCFactory._priorities.map(p => p.id === id ? { ...p, color } : p);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore', 'error'); }
}

async function updatePrioLabel(id, label) {
  try {
    await supabaseClient.from('priorities').update({ label }).eq('id', id);
    TCFactory._priorities = TCFactory._priorities.map(p => p.id === id ? { ...p, label } : p);
  } catch(e) { showToast('Errore', 'error'); }
}

async function deletePrioConfirm(id) {
  if (!confirm('Eliminare questa priorità?')) return;
  try {
    await supabaseClient.from('priorities').delete().eq('id', id);
    TCFactory._priorities = TCFactory._priorities.filter(p => p.id !== id);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore', 'error'); }
}

async function addNewPriority() {
  const input = document.getElementById('new-prio-input');
  const label = input?.value?.trim();
  if (!label) return;
  const id        = label.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const sort_order = TCFactory.getPriorities().length;
  try {
    const { data, error } = await supabaseClient.from('priorities').insert({ id, label, color: _newPrioColor, sort_order }).select().single();
    if (error) throw error;
    TCFactory._priorities.push(data);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore aggiunta priorità', 'error'); }
}

// ─────────────────────────────────────────────
// TAG settings actions
// ─────────────────────────────────────────────

async function updateTagColorSetting(name, color) {
  try {
    await supabaseClient.from('tags').update({ color }).eq('name', name);
    TCFactory._tags = TCFactory._tags.map(t => t.name === name ? { ...t, color } : t);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore', 'error'); }
}

async function deleteTagConfirm(name) {
  if (!confirm(`Eliminare il tag "${name}"?`)) return;
  try {
    await supabaseClient.from('tags').delete().eq('name', name);
    TCFactory._tags = TCFactory._tags.filter(t => t.name !== name);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore', 'error'); }
}

async function addNewTagSetting() {
  const input = document.getElementById('new-tag-input');
  const name  = input?.value?.trim();
  if (!name) return;
  try {
    const { data, error } = await supabaseClient.from('tags').insert({ name, color: _newTagColor }).select().single();
    if (error) throw error;
    TCFactory._tags.push(data);
    renderSettingsDialog(); renderApp();
  } catch(e) { showToast('Errore aggiunta tag', 'error'); }
}

// ─────────────────────────────────────────────
// GESTIONE UTENTI (settings)
// ─────────────────────────────────────────────

let _usersList = [];

async function renderUsersSection(container) {
  try { _usersList = await TCAuth.listUsers(); } catch(e) { _usersList = []; }
  container.innerHTML = `
    <div class="settings-section-hint">Solo gli admin possono creare e rimuovere account.</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
      ${_usersList.map(u => `
        <div class="config-row" style="justify-content:space-between;flex-wrap:wrap;gap:4px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.88rem;font-weight:600;">${escapeHtml(u.nickname)}</span>
            ${u.is_admin ? `<span class="chip" style="background:var(--brand-gold)22;color:var(--brand-gold);font-size:0.65rem;">admin</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:5px;font-size:0.75rem;cursor:pointer;" title="Può vedere la dashboard economica">
              <input type="checkbox" ${u.can_view_economics?'checked':''} ${u.nickname===TCAuth.getNickname()?'disabled':''} onchange="setUserEconomicsFlag('${escapeHtml(u.nickname)}',this.checked)">
              Gest. economica
            </label>
            <span style="font-size:0.72rem;color:var(--text-muted);">${new Date(u.created_at).toLocaleDateString('it-IT')}</span>
            ${u.nickname !== TCAuth.getNickname() ? `
              <button class="btn btn-secondary btn-sm" style="font-size:0.72rem;" onclick="adminResetPwdPrompt('${escapeHtml(u.nickname)}')" title="Reimposta password">🔑</button>
              <button class="btn-icon" style="color:var(--priority-urgent);" onclick="deleteUserConfirm('${escapeHtml(u.nickname)}')">${Icons.trash(14)}</button>
            ` : `<span style="font-size:0.7rem;color:var(--text-muted);">(sei tu)</span>`}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;background:var(--bg-secondary);">
      <div style="font-size:0.78rem;font-weight:700;margin-bottom:8px;">Crea nuovo account</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        <input id="new-user-nick" class="form-input" placeholder="Nickname" maxlength="30">
        <input id="new-user-pwd" type="password" class="form-input" placeholder="Password">
        <div style="display:flex;align-items:center;gap:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:0.82rem;cursor:pointer;">
            <input type="checkbox" id="new-user-admin"> Admin
          </label>
          <button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="createNewUser()">Crea account</button>
        </div>
      </div>
    </div>
  `;
}

async function createNewUser() {
  const nick  = document.getElementById('new-user-nick')?.value?.trim();
  const pwd   = document.getElementById('new-user-pwd')?.value;
  const isAdm = document.getElementById('new-user-admin')?.checked || false;
  if (!nick || !pwd) { showToast('Compila nickname e password', 'error'); return; }
  if (pwd.length < MIN_PASSWORD_LENGTH) { showToast(`Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)`, 'error'); return; }
  try {
    await TCAuth.createUser(nick, pwd, isAdm);
    showToast(`Account "${nick}" creato`);
    const container = document.getElementById('users-section-body');
    if (container) renderUsersSection(container);
  } catch(e) { showToast(e.message, 'error'); }
}

async function setUserEconomicsFlag(nick, value) {
  try {
    await TCAuth.setUserEconomics(nick, value);
    showToast(`Gestione economica ${value ? 'abilitata' : 'disabilitata'} per ${nick} — effettiva al prossimo accesso`);
  } catch(e) { showToast(e.message, 'error'); }
}

async function adminResetPwdPrompt(nick) {
  const newPwd = prompt(`Nuova password per "${nick}" (min. ${MIN_PASSWORD_LENGTH} caratteri):`);
  if (!newPwd) return;
  if (newPwd.length < MIN_PASSWORD_LENGTH) { showToast(`Minimo ${MIN_PASSWORD_LENGTH} caratteri`, 'error'); return; }
  try {
    await TCAuth.adminResetPassword(nick, newPwd);
    showToast(`Password di "${nick}" aggiornata ✓`);
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteUserConfirm(nick) {
  if (!confirm(`Eliminare l'account "${nick}"?`)) return;
  try {
    await TCAuth.deleteUser(nick);
    showToast(`Account "${nick}" eliminato`);
    const container = document.getElementById('users-section-body');
    if (container) renderUsersSection(container);
  } catch(e) { showToast(e.message, 'error'); }
}

async function renderLogSection(container) {
  const users = await TCFactory.getLogUsers().catch(() => []);
  container.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
      <select id="log-user-filter" class="form-select" style="width:auto;font-size:0.8rem;" onchange="AppState.logFilterUser=this.value;AppState.logOffset=0;loadLogEntries()">
        <option value="">Tutti gli utenti</option>
        ${users.map(u => `<option value="${escapeHtml(u)}" ${AppState.logFilterUser===u?'selected':''}>${escapeHtml(u)}</option>`).join('')}
      </select>
      <div class="search-box" style="flex:1;min-width:140px;">
        ${Icons.search(13)}
        <input id="log-search-input" class="form-input" style="font-size:0.8rem;" placeholder="Cerca azione o ordine…"
          value="${escapeHtml(AppState.logSearchQuery)}"
          onkeydown="if(event.key==='Enter'){AppState.logSearchQuery=this.value;AppState.logOffset=0;loadLogEntries();}">
      </div>
      <button class="btn btn-primary btn-sm" onclick="AppState.logSearchQuery=document.getElementById('log-search-input').value;AppState.logOffset=0;loadLogEntries()">Cerca</button>
      <button class="btn btn-ghost btn-sm" onclick="AppState.logFilterUser='';AppState.logSearchQuery='';AppState.logOffset=0;renderLogSection(document.getElementById('log-section-body'))">Reset</button>
    </div>
    <div id="log-entries-wrap"><div style="color:var(--text-muted);font-size:0.8rem;">Caricamento…</div></div>
  `;
  window._logContainer = container;
  loadLogEntries();
}

async function loadLogEntries() {
  const wrap = document.getElementById('log-entries-wrap');
  if (!wrap) return;
  wrap.innerHTML = `<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0;">Caricamento…</div>`;
  try {
    const { entries, total } = await TCFactory.getActivityLog({
      filterUser:  AppState.logFilterUser,
      searchQuery: AppState.logSearchQuery,
      offset:      AppState.logOffset,
      pageSize:    100,
    });
    const hasMore = AppState.logOffset + entries.length < total;
    wrap.innerHTML = entries.length === 0
      ? '<div style="font-size:0.8rem;color:var(--text-muted);">Nessuna voce trovata.</div>'
      : `<div style="display:flex;flex-direction:column;gap:3px;max-height:380px;overflow-y:auto;">
          ${entries.map(e => {
            const dt = new Date(e.created_at).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
            return `<div style="display:grid;grid-template-columns:105px 75px 1fr;gap:6px;padding:5px 8px;border-radius:4px;background:var(--bg-secondary);font-size:0.73rem;align-items:start;">
              <span style="color:var(--text-muted);">${dt}</span>
              <span style="font-weight:700;color:var(--brand-gold);">${escapeHtml(e.user_nickname)}</span>
              <div><span style="font-weight:600;">${escapeHtml(e.action)}</span>${e.order_name ? `<span style="color:var(--text-muted);"> · ${escapeHtml(e.order_name)}</span>` : ''}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:0.75rem;color:var(--text-muted);">
          <span>${AppState.logOffset+1}–${AppState.logOffset+entries.length} di ${total}</span>
          <div style="display:flex;gap:6px;">
            ${AppState.logOffset > 0 ? `<button class="btn btn-ghost btn-sm" onclick="AppState.logOffset=Math.max(0,AppState.logOffset-100);loadLogEntries()">← Prec.</button>` : ''}
            ${hasMore ? `<button class="btn btn-ghost btn-sm" onclick="AppState.logOffset+=100;loadLogEntries()">Succ. →</button>` : ''}
          </div>
        </div>`;
  } catch(e) { wrap.innerHTML = `<div style="color:var(--priority-urgent);font-size:0.8rem;">Errore: ${e.message}</div>`; }
}

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────

function renderLoginScreen() {
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="login-card glass">
      <div style="display:flex;justify-content:center;margin-bottom:16px;">
        <div class="brand-logo brand-logo-lg">${Icons.logoPlaceholder(30)}</div>
      </div>
      <h2 style="text-align:center;font-size:1.05rem;font-weight:700;margin-bottom:4px;">T&amp;C Gestione ordini</h2>
      <p style="text-align:center;font-size:0.78rem;color:var(--text-muted);margin-bottom:24px;">Accedi per continuare</p>
      <div class="form-group">
        <label class="form-label">Nickname</label>
        <input id="login-nick" class="form-input" placeholder="es. mario" autocomplete="username"
          onkeydown="if(event.key==='Enter')document.getElementById('login-pwd').focus()">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input id="login-pwd" type="password" class="form-input" placeholder="••••••••" autocomplete="current-password"
          onkeydown="if(event.key==='Enter')doLogin()">
      </div>
      <div id="login-error" style="color:var(--priority-urgent);font-size:0.82rem;min-height:18px;text-align:center;margin-bottom:8px;"></div>
      <button id="login-btn" class="btn btn-primary" style="width:100%;justify-content:center;" onclick="doLogin()">Accedi</button>
    </div>
  `;
}

async function doLogin() {
  const nick = document.getElementById('login-nick')?.value?.trim();
  const pwd  = document.getElementById('login-pwd')?.value;
  const err  = document.getElementById('login-error');
  const btn  = document.getElementById('login-btn');
  if (!nick || !pwd) { if (err) err.textContent = 'Inserisci nickname e password'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Accesso in corso…'; }
  if (err) err.textContent = '';
  try {
    await TCAuth.login(nick, pwd);
    await startApp();
  } catch(e) {
    if (err) err.textContent = e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Accedi'; }
  }
}

// Dopo il login (o con una sessione già attiva): carica i dati e mostra l'app.
// I dati si leggono solo da autenticati: il database rifiuta le richieste anonime.
async function startApp() {
  await TCFactory.init();
  document.getElementById('login-overlay').style.display = 'none';
  Nav.init();
  Nav.show(Nav._fromHash(), Nav._paramFromHash()); // ricontrolla i permessi delle sezioni per l'utente
  renderApp();
  initCalendar();
  Tickets.startPolling();
}

async function doLogout() {
  if (!confirm('Vuoi uscire?')) return;
  Tickets.stopPolling();
  Object.assign(Tickets, { _list: [], loaded: false, error: null });
  TCFactory.reset();
  await TCAuth.logout();
  renderLoginScreen();
}

// ─────────────────────────────────────────────
// HELPERS UI
// ─────────────────────────────────────────────

function renderTagChip(name) {
  const color = TCFactory.getTagColor(name);
  return `<span class="chip" style="background:color-mix(in srgb, ${color} 14%, transparent);color:${color};">
    <span class="chip-dot" style="background:${color};"></span>${escapeHtml(name)}
  </span>`;
}

function renderPriorityChip(p) {
  if (!p) return '';
  return `<span class="chip" style="background:color-mix(in srgb, ${p.color} 12%, transparent);color:${p.color};">
    <span class="chip-dot" style="background:${p.color};"></span>${escapeHtml(p.label)}
  </span>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─────────────────────────────────────────────
// ICONE SVG
// ─────────────────────────────────────────────

const Icons = {
  shirt: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>`,
  plus: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  search: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  settings: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  moon: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  sun: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  paperclip: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  archive: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  archiveRestore: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><path d="M9 13l3-3 3 3"/><line x1="12" y1="10" x2="12" y2="17"/></svg>`,
  truck: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  trash: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  edit: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  flag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  tag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  printer: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  magic: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>`,
  logOut: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  users: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  clock: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  lock: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  arrowUp: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="18 15 12 9 6 15"/></svg>`,
  arrowDown: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="6 9 12 15 18 9"/></svg>`,
  chevronLeft: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="9 18 15 12 9 6"/></svg>`,
  checkCircle: (color='currentColor', s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  package: (s=20) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  calendarDays: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
  wallet: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 8h-5a3 3 0 0 0 0 6h5a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1z"/><line x1="16" y1="11" x2="16.01" y2="11"/></svg>`,
  idBadge: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0"/><line x1="15" y1="10" x2="18" y2="10"/><line x1="15" y1="14" x2="18" y2="14"/></svg>`,
  lifeBuoy: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>`,
  menu: (s=20) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>`,
  eye: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  // Logo provvisorio — da sostituire con quello ufficiale
  logoPlaceholder: (s=26) => `<span class="brand-logo-mark" style="font-size:${Math.round(s*0.56)}px;">T&amp;C</span>`,
};

window.Icons = Icons;


// ═════════════════════════════════════════════════════════════
// CALENDARIO AZIENDALE
// ═════════════════════════════════════════════════════════════

const CAL_MODE_KEY = 'tcf_cal_mode';
const PLANNER_LAYERS_KEY = 'tcf_planner_layers';

const CalState = {
  mode: ['week','month','year'].includes(localStorage.getItem(CAL_MODE_KEY)) ? localStorage.getItem(CAL_MODE_KEY) : 'month',
  year: new Date().getFullYear(),
  month: new Date().getMonth(),   // usato dalla vista mese
  weekStart: startOfWeek(new Date()),
  pickerOpen: false,
  editingEvent: null,
  eventListOpen: false,
  slide: 0,                        // direzione dell'ultima navigazione, per l'animazione
  layers: loadPlannerLayers(),     // selettori attivi: ferie / eventi / scadenze
};

// Data locale in formato YYYY-MM-DD (toISOString userebbe UTC e sbaglierebbe giorno dopo mezzanotte)
function localISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function startOfWeek(d) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7)); // lunedì
  return r;
}

// ── Selettori del Planner (multi-selezione) ──
const PLANNER_LAYERS = [
  { id: 'ferie',    label: 'Ferie',    color: '#f97316', emoji: '🏖' },
  { id: 'eventi',   label: 'Eventi',   color: '#6366f1', emoji: '📅' },
  { id: 'scadenze', label: 'Scadenze', color: '#ef4444', emoji: '📦' },
];

function loadPlannerLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLANNER_LAYERS_KEY));
    if (Array.isArray(saved)) return saved.filter(id => ['ferie','eventi','scadenze'].includes(id));
  } catch {}
  return ['ferie', 'eventi', 'scadenze'];
}

function togglePlannerLayer(id) {
  const on = CalState.layers.includes(id);
  CalState.layers = on ? CalState.layers.filter(l => l !== id) : [...CalState.layers, id];
  try { localStorage.setItem(PLANNER_LAYERS_KEY, JSON.stringify(CalState.layers)); } catch {}
  renderCalendarSection();
}

// Indice scadenze ordini per data, ricalcolato a ogni render
let _deadlineIndex = {};
function buildDeadlineIndex() {
  const idx = {};
  TCFactory.getOrdersToDeliver().forEach(o => {
    const dl = TCFactory.getEffectiveDeadline(o);
    if (!dl) return;
    (idx[dl.date] = idx[dl.date] || []).push({ order: o, auto: dl.auto });
  });
  Object.values(idx).forEach(list => list.sort((a, b) =>
    TCFactory.getPriorityRank(a.order.priorityId) - TCFactory.getPriorityRank(b.order.priorityId)));
  _deadlineIndex = idx;
  return idx;
}

// Elementi da mostrare in un giorno, secondo i selettori attivi
function plannerItemsForDate(dateStr) {
  const L = CalState.layers;
  const items = [];

  TCFactory.getEventsForDate(dateStr).forEach(e => {
    const layer = e.event_type === 'ferie' ? 'ferie' : 'eventi';
    if (!L.includes(layer)) return;
    items.push({
      kind: 'event', color: e.color, text: getEventChipText(e),
      sub: e.event_type !== 'ferie' && (e.user_ids || []).length ? '👥 ' + e.user_ids.join(', ') : '',
      open: `openCalEventDialog('${e.id}',null)`,
    });
  });

  if (L.includes('scadenze')) {
    (_deadlineIndex[dateStr] || []).forEach(({ order: o, auto }) => {
      const client = TCFactory.getClient(o.clientId);
      const subParts = [client ? TCFactory.clientName(client) : '', auto ? 'scadenza automatica' : ''].filter(Boolean);
      items.push({
        kind: 'order', orderId: o.id, auto, color: TCFactory.getPriority(o.priorityId)?.color || '#64748b',
        text: '📦 ' + o.nome, sub: subParts.join(' · '),
        open: `openOrderDetail('${o.id}')`,
      });
    });
  }
  return items;
}

function renderPlannerChip(item, compact = false, draggable = false) {
  const drag = draggable && item.kind === 'order'
    ? `draggable="true" ondragstart="plannerDragStart(event,'${item.orderId}')" ondragend="plannerDragEnd()"` : '';
  return `<button type="button" class="pl-chip ${item.kind === 'order' ? 'pl-chip-order' : ''} ${item.auto ? 'pl-chip-auto' : ''} ${compact ? 'pl-chip-compact' : ''}"
    style="--ev:${item.color};" ${drag} onclick="event.stopPropagation();${item.open}" title="${escapeHtml(item.text + (item.sub ? ' — ' + item.sub : ''))}${drag ? ' · trascina su un altro giorno per spostare la scadenza' : ''}">
    <span class="pl-chip-title">${escapeHtml(item.text)}</span>
    ${item.sub && !compact ? `<span class="pl-chip-sub">${escapeHtml(item.sub)}</span>` : ''}
  </button>`;
}

const EVENT_TYPES = [
  { id:'impegno', label:'Impegno', color:'#6366f1' },
  { id:'ferie',   label:'Ferie',   color:'#f97316' },
  { id:'scadenza',label:'Scadenza',color:'#ef4444' },
];

async function initCalendar() {
  await TCFactory.loadCalendarEvents();
  renderCalendarSection();
}

function renderCalendarSection() {
  const root = document.getElementById('calendar-root');
  if (!root) return;

  root.innerHTML = `<div class="glass-card planner-card">${renderCalendarBody()}</div>`;
  CalState.slide = 0;
  bindPlannerGestures(root);
}

// Frecce ← → da tastiera e swipe su touch per scorrere settimane/mesi/anni
function bindPlannerGestures(root) {
  if (root._gesturesBound) return;
  root._gesturesBound = true;

  document.addEventListener('keydown', (e) => {
    if (Nav.current !== 'planner') return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('.modal-overlay.active')) return;
    if (e.key === 'ArrowLeft')  { e.preventDefault(); calNav(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); calNav(1); }
  });

  let x0 = null, y0 = null;
  root.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) calNav(dx < 0 ? 1 : -1);
  });
}

function calcCalendarStats(year) {
  const events = TCFactory.getCalendarEvents().filter(ev => {
    // Considera solo eventi che cadono nell'anno visualizzato
    return ev.date_from.slice(0, 4) === String(year) || ev.date_to.slice(0, 4) === String(year);
  });

  const stats = {}; // { nickname: { ferie: days, impegno: days, scadenza: days } }

  events.forEach(ev => {
    const d1   = new Date(ev.date_from + 'T00:00:00');
    const d2   = new Date(ev.date_to   + 'T00:00:00');
    const days = Math.round((d2 - d1) / 86400000) + 1;
    (ev.user_ids || []).forEach(user => {
      if (!stats[user]) stats[user] = { ferie: 0, impegno: 0, scadenza: 0 };
      const type = ev.event_type || 'impegno';
      stats[user][type] = (stats[user][type] || 0) + days;
    });
  });

  return stats;
}

function calPeriodLabel() {
  const MESI_LUNGHI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  if (CalState.mode === 'year')  return String(CalState.year);
  if (CalState.mode === 'month') return `${MESI_LUNGHI[CalState.month]} ${CalState.year}`;
  const ws = CalState.weekStart;
  const we = new Date(ws); we.setDate(ws.getDate() + 6);
  const fmt = (d, withYear) => d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  return `${fmt(ws, ws.getFullYear() !== we.getFullYear())} – ${fmt(we, true)}`;
}

function renderCalendarBody() {
  const MESI = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'];
  buildDeadlineIndex();

  // Statistiche utenti per anno
  const stats = calcCalendarStats(CalState.year);
  const statsEntries = Object.entries(stats).sort((a, b) => a[0].localeCompare(b[0]));

  const statsSection = statsEntries.length > 0 && (CalState.layers.includes('ferie') || CalState.layers.includes('eventi')) ? `
    <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-secondary);">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-size:0.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;">Statistiche ${CalState.year}</span>
        <span style="margin-left:auto;display:flex;gap:6px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="openStaffReport('ferie')">🏖 Riepilogo ferie</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="openStaffReport('eventi')">📅 Riepilogo eventi</button>
        </span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${statsEntries.map(([user, s]) => {
          const u = escapeHtml(user).replace(/'/g, '&#39;');
          const eventi = (s.impegno || 0) + (s.scadenza || 0);
          return `
          <div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:6px 8px 6px 12px;display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.82rem;font-weight:700;">${escapeHtml(user)}</span>
            ${eventi > 0  ? `<button type="button" class="stat-chip" style="--c:#6366f1;" onclick="openStaffReport('eventi','${u}')" title="Giorni di eventi di ${escapeHtml(user)}">📅 ${eventi}gg</button>` : ''}
            ${s.ferie > 0 ? `<button type="button" class="stat-chip" style="--c:#f97316;" onclick="openStaffReport('ferie','${u}')" title="Giorni di ferie di ${escapeHtml(user)}">🏖 ${s.ferie}gg</button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const unit = { week: 'settimana', month: 'mese', year: 'anno' }[CalState.mode];
  const modes = [['week','Settimana'],['month','Mese'],['year','Anno']];

  // Controlli navigazione
  const nav = `
    <div class="planner-toolbar">
      <div class="planner-nav">
        <button class="btn-icon" onclick="calNav(-1)" aria-label="${unit === 'settimana' ? 'Settimana precedente' : unit === 'mese' ? 'Mese precedente' : 'Anno precedente'}">${Icons.chevronLeft()}</button>
        <div style="position:relative;">
          <button class="btn btn-ghost btn-sm planner-period" onclick="toggleCalPicker()" aria-expanded="${CalState.pickerOpen}" aria-haspopup="true">
            ${calPeriodLabel()}
            ${Icons.calendarDays(13)}
          </button>
          ${CalState.pickerOpen ? `
            <div class="popover glass" role="menu">
              ${MESI.map((m,i) => `<button class="btn ${CalState.mode==='month' && CalState.month===i?'btn-primary':'btn-ghost'} btn-sm" role="menuitem" onclick="calGoMonth(${i})">${m}</button>`).join('')}
              <button class="btn btn-ghost btn-sm" role="menuitem" style="grid-column:span 4;" onclick="calGoAnnual()">Vista annuale ${CalState.year}</button>
            </div>` : ''}
        </div>
        <button class="btn-icon" onclick="calNav(1)" aria-label="${unit === 'settimana' ? 'Settimana successiva' : unit === 'mese' ? 'Mese successivo' : 'Anno successivo'}">${Icons.chevronRight()}</button>
        <button class="btn btn-secondary btn-sm" onclick="calToday()">Oggi</button>
      </div>
      <div class="segmented" role="tablist" aria-label="Vista calendario">
        ${modes.map(([id, label]) => `<button role="tab" aria-selected="${CalState.mode===id}" class="${CalState.mode===id?'active':''}" onclick="calSetMode('${id}')">${label}</button>`).join('')}
      </div>
    </div>`;

  const layersBar = `
    <div class="planner-layers" role="group" aria-label="Cosa mostrare">
      ${PLANNER_LAYERS.map(l => {
        const on = CalState.layers.includes(l.id);
        return `<button type="button" class="layer-toggle ${on ? 'on' : ''}" style="--layer:${l.color};" aria-pressed="${on}" onclick="togglePlannerLayer('${l.id}')">
          <span class="layer-check" aria-hidden="true">${on ? '✓' : ''}</span>${l.emoji} ${l.label}
        </button>`;
      }).join('')}
      ${CalState.layers.includes('scadenze') ? renderDeadlineSummary() : ''}
    </div>`;

  const slideCls = CalState.slide > 0 ? 'slide-next' : CalState.slide < 0 ? 'slide-prev' : '';
  let body;
  if (CalState.mode === 'year') {
    const months = Array.from({length:12}, (_,i) => renderMiniMonth(CalState.year, i));
    body = `<div class="cal-annual-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;padding:12px 16px;">
      ${months.join('')}
    </div>`;
  } else if (CalState.mode === 'month') {
    body = renderFullMonth(CalState.year, CalState.month);
  } else {
    body = renderWeek(CalState.weekStart);
  }
  return nav + layersBar + statsSection + `<div class="planner-body ${slideCls}">${body}</div>` + renderEventList();
}

function renderWeek(weekStart) {
  const GG    = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const today = localISODate(new Date());

  const cols = GG.map((g, i) => {
    const d       = new Date(weekStart); d.setDate(weekStart.getDate() + i);
    const dateStr = localISODate(d);
    const items   = plannerItemsForDate(dateStr);
    const isToday = dateStr === today;
    const isPast  = dateStr < today;

    return `
      <div class="week-col ${isToday ? 'today' : ''} ${i >= 5 ? 'weekend' : ''} ${isPast ? 'past' : ''}" ${plannerDropAttrs(dateStr)}>
        <div class="week-col-head">
          <span class="week-col-day">${g}</span>
          <span class="week-col-num">${d.getDate()}</span>
        </div>
        <div class="week-col-events">${items.map(it => renderPlannerChip(it, false, true)).join('')}</div>
        <button type="button" class="week-add" onclick="openCalEventDialog(null,'${dateStr}')" aria-label="Aggiungi evento il ${d.toLocaleDateString('it-IT',{day:'numeric',month:'long'})}">${Icons.plus(13)}</button>
      </div>`;
  }).join('');

  return `<div class="cal-week">${cols}</div>`;
}

// ── Trascina un ordine su un altro giorno: la deadline diventa quel giorno ──

let _dragOrderId = null;

function plannerDropAttrs(dateStr) {
  return `ondragover="plannerDragOver(event)" ondragleave="this.classList.remove('drop-target')" ondrop="plannerDrop(event,'${dateStr}')"`;
}

function plannerDragStart(e, orderId) {
  _dragOrderId = orderId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', orderId);   // Firefox richiede dati per avviare il trascinamento
  document.body.classList.add('planner-dragging');
}

function plannerDragEnd() {
  _dragOrderId = null;
  document.body.classList.remove('planner-dragging');
  document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
}

function plannerDragOver(e) {
  if (!_dragOrderId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drop-target');
}

async function plannerDrop(e, dateStr) {
  e.preventDefault();
  const id = _dragOrderId;
  plannerDragEnd();
  const o = id && TCFactory.getOrderById(id);
  if (!o) return;
  const prev = TCFactory.getEffectiveDeadline(o);
  if (prev?.date === dateStr && !prev.auto) return;

  try {
    await TCFactory.updateOrder(id, { deadline: dateStr });
    TCFactory._log('Scadenza spostata', id, o.nome, { da: o.deadline || null, a: dateStr });
    showToast(`"${o.nome}" → scadenza ${TCFactory.formatDate(dateStr, { day: 'numeric', month: 'long' })}`);
    renderCalendarSection();
    renderOrderList();
  } catch (err) {
    showToast('Impossibile spostare la scadenza', 'error');
  }
}

// Riepilogo scadenze: in ritardo + prossimi 7 giorni (cliccabili)
function renderDeadlineSummary() {
  const today = localISODate(new Date());
  const in7   = localISODate(new Date(Date.now() + 7 * 86400000));
  let late = 0, soon = 0;
  Object.entries(_deadlineIndex).forEach(([date, list]) => {
    if (date < today) late += list.length;
    else if (date <= in7) soon += list.length;
  });
  return `<div class="deadline-summary">
    <button type="button" class="summary-pill late" ${late ? '' : 'disabled'} onclick="openDeadlineList('late')">${late} in ritardo</button>
    <button type="button" class="summary-pill soon" ${soon ? '' : 'disabled'} onclick="openDeadlineList('soon')">${soon} nei prossimi 7 giorni</button>
  </div>`;
}

function openDeadlineList(which) {
  const today = localISODate(new Date());
  const in7   = localISODate(new Date(Date.now() + 7 * 86400000));
  const rows = Object.entries(_deadlineIndex)
    .filter(([date]) => which === 'late' ? date < today : date >= today && date <= in7)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([date, list]) => list.map(x => ({ date, ...x })));

  const modal = document.getElementById('day-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-header">
        <h2 style="font-size:1rem;">${which === 'late' ? 'Ordini in ritardo' : 'Scadenze nei prossimi 7 giorni'}</h2>
        <button class="btn-icon" onclick="closeModal('day-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:8px;">
        ${rows.map(({ date, order: o, auto }) => {
          const p = TCFactory.getPriority(o.priorityId);
          const client = TCFactory.getClient(o.clientId);
          return `<button type="button" class="day-order-row" onclick="closeModal('day-modal');openOrderDetail('${o.id}')">
            <span class="day-order-bar" style="background:${p?.color || '#64748b'};"></span>
            <span style="flex:1;min-width:0;">
              <strong style="display:block;font-size:0.88rem;">${escapeHtml(o.nome)}</strong>
              <span style="font-size:0.75rem;color:var(--text-muted);">${client ? escapeHtml(TCFactory.clientName(client)) + ' · ' : ''}${TCFactory.formatDate(date)}${auto ? ' · automatica' : ''}</span>
            </span>
            ${renderPriorityChip(p)}
          </button>`;
        }).join('')}
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = e => { if (e.target === modal) closeModal('day-modal'); };
}

function getEventChipText(ev) {
  const users = ev.user_ids || [];
  if (ev.event_type === 'ferie') {
    // Mostra direttamente i nomi di chi è in ferie
    return '🏖 ' + (users.length > 0 ? users.join(', ') : ev.title);
  }
  // Impegno / Scadenza: titolo + coinvolti in piccolo
  const icon = ev.event_type === 'scadenza' ? '⚠ ' : '';
  const userStr = users.length > 0
    ? ' · ' + users.slice(0, 2).join(', ') + (users.length > 2 ? ` +${users.length-2}` : '')
    : '';
  return icon + ev.title + userStr;
}

function renderMiniMonth(year, month) {
  const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const GG   = ['L','M','M','G','V','S','D'];
  const firstDay = new Date(year, month, 1).getDay();
  const offset   = firstDay === 0 ? 6 : firstDay - 1;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today    = localISODate(new Date());

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div></div>');
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items   = plannerItemsForDate(dateStr);
    const isToday = dateStr === today;
    const dots = items.slice(0,3).map(e => `<div style="width:5px;height:5px;border-radius:50%;background:${e.color};"></div>`).join('');
    cells.push(`<div onclick="${items.length ? `openDayPopup('${dateStr}')` : `openCalEventDialog(null,'${dateStr}')`}" style="text-align:center;font-size:0.7rem;cursor:pointer;padding:2px;border-radius:4px;${isToday?'background:var(--brand-gold);color:#fff;font-weight:700;':''}">
      <div>${d}</div>
      <div style="display:flex;gap:1px;justify-content:center;min-height:6px;">${dots}</div>
    </div>`);
  }

  return `<div style="padding:8px;border:1px solid var(--border-light);border-radius:var(--radius-md);margin:4px;">
    <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);text-align:center;margin-bottom:6px;cursor:pointer;" onclick="calGoMonth(${month})">${MESI[month]}</div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;">
      ${GG.map(g => `<div style="text-align:center;font-size:0.6rem;color:var(--text-muted);font-weight:700;">${g}</div>`).join('')}
      ${cells.join('')}
    </div>
  </div>`;
}

function renderFullMonth(year, month) {
  const GG   = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];
  const firstDay = new Date(year, month, 1).getDay();
  const offset   = firstDay === 0 ? 6 : firstDay - 1;
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today    = localISODate(new Date());
  const MAX_VISIBLE = 3;

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="month-cell empty"></div>');

  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const items   = plannerItemsForDate(dateStr);
    const isToday = dateStr === today;
    const hidden  = items.length - MAX_VISIBLE;

    cells.push(`
      <div class="month-cell ${isToday ? 'today' : ''}" ${plannerDropAttrs(dateStr)} onclick="${items.length > 0 ? `openDayPopup('${dateStr}')` : `openCalEventDialog(null,'${dateStr}')`}">
        <div class="month-cell-num">${d}</div>
        ${items.slice(0, MAX_VISIBLE).map(it => renderPlannerChip(it, true, true)).join('')}
        ${hidden > 0 ? `<button type="button" class="month-more" onclick="event.stopPropagation();openDayPopup('${dateStr}')">+ altri ${hidden}</button>` : ''}
      </div>`);
  }

  return `<div style="padding:12px 16px;">
    <div class="month-grid">
      ${GG.map(g => `<div class="month-head">${g}</div>`).join('')}
      ${cells.join('')}
    </div>
  </div>`;
}

function openDayPopup(dateStr) {
  buildDeadlineIndex();
  const items  = plannerItemsForDate(dateStr);
  const modal  = document.getElementById('day-modal');
  const label  = new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', {weekday:'long', day:'numeric', month:'long', year:'numeric'});

  modal.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <div class="modal-header">
        <h2 style="font-size:1rem;text-transform:capitalize;">${label}</h2>
        <button class="btn-icon" onclick="closeModal('day-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:6px;">
        ${items.length === 0 ? `<p style="color:var(--text-muted);font-size:0.85rem;">Niente in programma.</p>` :
          items.map(it => renderPlannerChip({ ...it, open: `closeModal('day-modal');${it.open}` })).join('')}
        <button class="btn btn-primary btn-sm" style="align-self:flex-start;margin-top:6px;" onclick="closeModal('day-modal');openCalEventDialog(null,'${dateStr}')">+ Aggiungi evento</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = e => { if (e.target === modal) closeModal('day-modal'); };
}

// ── Riepilogo ferie / eventi per persona, diviso per mese ──

const StaffReport = { type: 'ferie', user: '', year: new Date().getFullYear() };

function openStaffReport(type, user = '') {
  Object.assign(StaffReport, { type, user, year: CalState.year });
  renderStaffReport();
  const modal = document.getElementById('day-modal');
  modal.classList.add('active');
  modal.onclick = e => { if (e.target === modal) closeModal('day-modal'); };
}

function setStaffReport(key, value) { StaffReport[key] = value; renderStaffReport(); }

// { persona: { mese(0-11): [{ day, ev }] } } per l'anno e il tipo scelti
function buildStaffReport() {
  const year = StaffReport.year;
  const isFerie = StaffReport.type === 'ferie';
  const data = {};
  TCFactory.getCalendarEvents()
    .filter(ev => (ev.event_type === 'ferie') === isFerie)
    .forEach(ev => {
      const users = (ev.user_ids && ev.user_ids.length) ? ev.user_ids : ['(nessuno)'];
      const d = new Date(ev.date_from + 'T00:00:00');
      const end = new Date(ev.date_to + 'T00:00:00');
      for (; d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() !== year) continue;
        users.forEach(u => {
          const m = d.getMonth();
          ((data[u] = data[u] || {})[m] = data[u][m] || []).push({ day: d.getDate(), ev });
        });
      }
    });
  return data;
}

function renderStaffReport() {
  const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  const isFerie = StaffReport.type === 'ferie';
  const data  = buildStaffReport();
  const users = Object.keys(data).sort((a, b) => a.localeCompare(b, 'it'));
  const shown = StaffReport.user ? users.filter(u => u === StaffReport.user) : users;

  const monthBlock = (m, entries) => {
    entries.sort((a, b) => a.day - b.day);
    const giorni = new Set(entries.map(e => e.day)).size;
    let body;
    if (isFerie) {
      // Giorni consecutivi raggruppati: 8–10, 14, 20–24
      const days = [...new Set(entries.map(e => e.day))];
      const parts = [];
      for (let i = 0; i < days.length; i++) {
        let j = i;
        while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
        parts.push(i === j ? `${days[i]}` : `${days[i]}–${days[j]}`);
        i = j;
      }
      body = `<div class="report-days">${parts.map(p => `<span class="report-day">${p}</span>`).join('')}</div>`;
    } else {
      // Un evento per riga, con i suoi giorni nel mese
      const byEvent = new Map();
      entries.forEach(({ day, ev }) => { if (!byEvent.has(ev.id)) byEvent.set(ev.id, { ev, days: [] }); byEvent.get(ev.id).days.push(day); });
      body = [...byEvent.values()].map(({ ev, days }) => {
        const label = days.length > 1 ? `${days[0]}–${days[days.length - 1]}` : `${days[0]}`;
        const type  = EVENT_TYPES.find(t => t.id === ev.event_type) || EVENT_TYPES[0];
        return `<button type="button" class="report-event" style="--ev:${ev.color};" onclick="closeModal('day-modal');openCalEventDialog('${ev.id}',null)">
          <span class="report-event-days">${label}</span>
          <span class="report-event-title">${escapeHtml(ev.title)}</span>
          <span class="report-event-type">${type.label}</span>
        </button>`;
      }).join('');
    }
    return `<div class="report-month">
      <div class="report-month-head"><strong>${MESI[m]}</strong><span>${giorni} ${giorni === 1 ? 'giorno' : 'giorni'}</span></div>
      ${body}
    </div>`;
  };

  const personBlock = (u) => {
    const months = Object.keys(data[u]).map(Number).sort((a, b) => a - b);
    const tot = months.reduce((s, m) => s + new Set(data[u][m].map(e => e.day)).size, 0);
    return `<section class="report-person">
      <div class="report-person-head">
        <span class="user-avatar" aria-hidden="true">${escapeHtml(u.charAt(0).toUpperCase())}</span>
        <strong>${escapeHtml(u)}</strong>
        <span class="report-total">${tot} ${tot === 1 ? 'giorno' : 'giorni'} nel ${StaffReport.year}</span>
      </div>
      ${months.map(m => monthBlock(m, data[u][m])).join('')}
    </section>`;
  };

  document.getElementById('day-modal').innerHTML = `
    <div class="modal" style="max-width:640px;" role="dialog" aria-modal="true" aria-labelledby="sr-title">
      <div class="modal-header">
        <h2 id="sr-title">${isFerie ? '🏖 Ferie' : '📅 Eventi'} per persona</h2>
        <button class="btn-icon" onclick="closeModal('day-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="report-controls">
        <div class="segmented" role="tablist" aria-label="Tipo">
          <button role="tab" aria-selected="${isFerie}" class="${isFerie ? 'active' : ''}" onclick="setStaffReport('type','ferie')">Ferie</button>
          <button role="tab" aria-selected="${!isFerie}" class="${!isFerie ? 'active' : ''}" onclick="setStaffReport('type','eventi')">Eventi</button>
        </div>
        <div class="report-year">
          <button class="btn-icon" onclick="setStaffReport('year', StaffReport.year - 1)" aria-label="Anno precedente">${Icons.chevronLeft()}</button>
          <strong>${StaffReport.year}</strong>
          <button class="btn-icon" onclick="setStaffReport('year', StaffReport.year + 1)" aria-label="Anno successivo">${Icons.chevronRight()}</button>
        </div>
        <select class="form-select filter-select" aria-label="Persona" onchange="setStaffReport('user', this.value)">
          <option value="">Tutto lo staff</option>
          ${users.map(u => `<option value="${escapeHtml(u)}" ${u === StaffReport.user ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}
          ${StaffReport.user && !users.includes(StaffReport.user) ? `<option selected>${escapeHtml(StaffReport.user)}</option>` : ''}
        </select>
      </div>
      <div class="modal-body report-body">
        ${shown.length === 0
          ? `<p style="color:var(--text-muted);font-size:0.88rem;text-align:center;padding:20px 0;">Nessun${isFerie ? 'a ferie' : ' evento'} nel ${StaffReport.year}${StaffReport.user ? ' per ' + escapeHtml(StaffReport.user) : ''}.</p>`
          : shown.map(personBlock).join('')}
      </div>
    </div>`;
}

// Lista eventi collassabile
function renderEventList() {
  const showFerie  = CalState.layers.includes('ferie');
  const showEventi = CalState.layers.includes('eventi');
  if (!showFerie && !showEventi) return '';
  const all    = [...TCFactory.getCalendarEvents()]
    .filter(e => e.event_type === 'ferie' ? showFerie : showEventi)
    .sort((a,b) => a.date_from.localeCompare(b.date_from));
  const today  = localISODate(new Date());
  const nextIdx = all.findIndex(e => e.date_to >= today);

  const itemsHtml = all.map((e, i) => {
    const typeInfo = EVENT_TYPES.find(t => t.id === e.event_type) || EVENT_TYPES[0];
    const users    = e.user_ids || [];
    const isPast   = e.date_to < today;
    const isNext   = i === nextIdx;
    const isMulti  = e.date_from !== e.date_to;
    const dfrom = new Date(e.date_from+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'2-digit'});
    const dto   = new Date(e.date_to+'T00:00:00').toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'2-digit'});
    const dateStr = isMulti ? `${dfrom} → ${dto}` : dfrom;

    return `<div id="${isNext ? 'next-event-item' : ''}"
      onclick="openCalEventDialog('${e.id}',null)"
      style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:var(--radius-md);cursor:pointer;
             border:1px solid var(--border-light);
             ${isNext ? 'border-color:var(--brand-gold);box-shadow:0 0 0 2px color-mix(in srgb,var(--brand-gold) 20%,transparent);' : ''}
             ${isPast ? 'opacity:0.45;' : ''}
             background:var(--bg-card);">
      <div style="width:4px;border-radius:2px;background:${typeInfo.color};align-self:stretch;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <span style="font-size:0.82rem;font-weight:700;">${escapeHtml(getEventChipText(e))}</span>
          <span style="font-size:0.67rem;background:${typeInfo.color}22;color:${typeInfo.color};border-radius:4px;padding:1px 6px;">${typeInfo.label}</span>
          ${isNext ? '<span style="font-size:0.67rem;background:var(--brand-gold)22;color:var(--brand-gold);border-radius:4px;padding:1px 6px;font-weight:700;">prossimo</span>' : ''}
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">📅 ${dateStr}</div>
        ${users.length && e.event_type !== 'ferie' ? `<div style="font-size:0.72rem;color:var(--text-muted);">👥 ${users.join(' · ')}</div>` : ''}
        ${e.notes ? `<div style="font-size:0.7rem;color:var(--text-muted);font-style:italic;margin-top:2px;">${escapeHtml(e.notes.slice(0,60))}${e.notes.length>60?'…':''}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `
    <div style="border-top:1px solid var(--border);">
      <div onclick="toggleEventList()" style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer;background:var(--bg-secondary);">
        <span style="font-weight:700;font-size:0.88rem;">📋 ${showFerie && showEventi ? 'Tutti gli eventi e le ferie' : showFerie ? 'Tutte le ferie' : 'Tutti gli eventi'} (${all.length})</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="transform:rotate(${CalState.eventListOpen?180:0}deg);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      ${CalState.eventListOpen ? `
        <div style="max-height:380px;overflow-y:auto;padding:10px 16px;display:flex;flex-direction:column;gap:8px;" id="event-list-scroll">
          ${all.length === 0 ? '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;">Nessun evento.</p>' : itemsHtml}
        </div>` : ''}
    </div>`;
}

function toggleEventList() {
  CalState.eventListOpen = !CalState.eventListOpen;
  renderCalendarSection();
  if (CalState.eventListOpen) {
    setTimeout(() => {
      const el = document.getElementById('next-event-item');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }
}

function toggleCalPicker()   { CalState.pickerOpen = !CalState.pickerOpen; renderCalendarSection(); }

function calNav(delta) {
  if (CalState.mode === 'year') {
    CalState.year += delta;
  } else if (CalState.mode === 'month') {
    let m = CalState.month + delta;
    if (m < 0)  { m = 11; CalState.year--; }
    if (m > 11) { m = 0;  CalState.year++; }
    CalState.month = m;
  } else {
    const ws = new Date(CalState.weekStart);
    ws.setDate(ws.getDate() + 7 * delta);
    CalState.weekStart = ws;
    CalState.year  = ws.getFullYear();
    CalState.month = ws.getMonth();
  }
  CalState.pickerOpen = false;
  CalState.slide = delta;
  renderCalendarSection();
}

function calSetMode(mode) {
  if (mode === 'week' && CalState.mode !== 'week') {
    // Entrando nella vista settimana resta nel mese che si stava guardando
    const now = new Date();
    const inView = now.getFullYear() === CalState.year && (CalState.mode === 'year' || now.getMonth() === CalState.month);
    CalState.weekStart = startOfWeek(inView ? now : new Date(CalState.year, CalState.mode === 'year' ? 0 : CalState.month, 1));
  }
  if (mode === 'month' && CalState.mode === 'week') {
    CalState.year  = CalState.weekStart.getFullYear();
    CalState.month = CalState.weekStart.getMonth();
  }
  CalState.mode = mode;
  CalState.pickerOpen = false;
  try { localStorage.setItem(CAL_MODE_KEY, mode); } catch {}
  renderCalendarSection();
}

function calToday() {
  const now = new Date();
  CalState.year = now.getFullYear();
  CalState.month = now.getMonth();
  CalState.weekStart = startOfWeek(now);
  CalState.pickerOpen = false;
  renderCalendarSection();
}

function calGoMonth(m)  { CalState.month = m; CalState.mode = 'month'; CalState.pickerOpen = false; renderCalendarSection(); }
function calGoAnnual()  { CalState.mode = 'year'; CalState.pickerOpen = false; renderCalendarSection(); }

// ── Dialog eventi ─────────────────────────────

let _calSelectedType = 'impegno';

async function openCalEventDialog(eventId, dateStr) {
  const ev = eventId ? TCFactory.getCalendarEvents().find(e => e.id == eventId) : null;
  _calSelectedType = ev?.event_type || 'impegno';
  const users = await TCAuth.listUsers().catch(() => []);
  const modal = document.getElementById('cal-event-modal');
  const defaultDate = dateStr || new Date().toISOString().slice(0,10);
  const isFerie = _calSelectedType === 'ferie';

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${ev ? 'Modifica evento' : 'Nuovo evento'}</h2>
        <button class="btn-icon" onclick="closeModal('cal-event-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">

        <div class="form-group">
          <label class="form-label">Tipo</label>
          <div style="display:flex;gap:8px;">
            ${EVENT_TYPES.map(t => {
              const active = _calSelectedType === t.id;
              return `<button type="button" class="chip chip-btn" id="cal-type-${t.id}"
                style="background:${active?t.color:`color-mix(in srgb, ${t.color} 12%, transparent)`};color:${active?'#fff':t.color};"
                onclick="selectCalType('${t.id}')">${t.label}</button>`;
            }).join('')}
          </div>
        </div>

        <div id="cal-title-group" class="form-group" style="display:${isFerie?'none':'block'}">
          <label class="form-label">Titolo *</label>
          <input id="cal-title" class="form-input" value="${escapeHtml(ev?.title||'')}" placeholder="Es. Fiera del tessile">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Dal</label>
            <input id="cal-from" type="date" class="form-input" value="${ev?.date_from || defaultDate}">
          </div>
          <div class="form-group">
            <label class="form-label">Al</label>
            <input id="cal-to" type="date" class="form-input" value="${ev?.date_to || defaultDate}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">${isFerie ? 'Chi è in ferie' : 'Coinvolti'}</label>
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${users.map(u => {
              const sel = (ev?.user_ids || []).includes(u.nickname);
              return `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.85rem;">
                <input type="checkbox" id="cal-user-${escapeHtml(u.nickname)}" ${sel?'checked':''} value="${escapeHtml(u.nickname)}">
                ${escapeHtml(u.nickname)}${u.is_admin?' 👑':''}
              </label>`;
            }).join('')}
          </div>
        </div>

        <div id="cal-notes-group" class="form-group" style="display:${isFerie?'none':'block'}">
          <label class="form-label">Note</label>
          <textarea id="cal-notes" class="form-textarea" style="height:70px;" placeholder="Dettagli aggiuntivi…">${escapeHtml(ev?.notes||'')}</textarea>
        </div>

      </div>
      <div class="modal-footer">
        ${ev ? `<button class="btn btn-ghost" style="color:var(--priority-urgent);margin-right:auto;" onclick="deleteCalEvent(${ev.id})">Elimina</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('cal-event-modal')">Annulla</button>
        <button class="btn btn-primary" onclick="saveCalEvent(${ev ? ev.id : 'null'})">Salva</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.onclick = e => { if (e.target === modal) closeModal('cal-event-modal'); };
  document.getElementById('cal-from')?.addEventListener('change', function() {
    const to = document.getElementById('cal-to');
    if (to && to.value < this.value) to.value = this.value;
  });
}

function selectCalType(id) {
  _calSelectedType = id;
  EVENT_TYPES.forEach(t => {
    const btn = document.getElementById(`cal-type-${t.id}`);
    if (!btn) return;
    const active = t.id === id;
    btn.style.background = active ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`;
    btn.style.color = active ? '#fff' : t.color;
  });
  const isFerie = id === 'ferie';
  const tg = document.getElementById('cal-title-group');
  const ng = document.getElementById('cal-notes-group');
  if (tg) tg.style.display = isFerie ? 'none' : 'block';
  if (ng) ng.style.display = isFerie ? 'none' : 'block';
  // Aggiorna label coinvolti
  const lbl = document.querySelector('[for="cal-coinvolti"], .form-label');
}

async function saveCalEvent(existingId) {
  const rawTitle = document.getElementById('cal-title')?.value?.trim() || '';
  const from   = document.getElementById('cal-from')?.value;
  const to     = document.getElementById('cal-to')?.value;
  const notes  = document.getElementById('cal-notes')?.value || '';
  if (!from || !to) { showToast('Inserisci le date', 'error'); return; }

  const userIds = Array.from(document.querySelectorAll('[id^="cal-user-"]:checked')).map(el => el.value);
  const evType  = EVENT_TYPES.find(t => t.id === _calSelectedType) || EVENT_TYPES[0];

  // Per le ferie il titolo è generato dai nomi; per gli altri è obbligatorio
  let title = rawTitle;
  if (evType.id === 'ferie') {
    title = userIds.length > 0 ? userIds.join(', ') : 'Ferie';
  } else if (!title) {
    showToast('Inserisci un titolo', 'error'); return;
  }

  if (userIds.length === 0 && evType.id === 'ferie') {
    showToast('Seleziona almeno una persona in ferie', 'error'); return;
  }

  const payload = {
    title,
    date_from:  from,
    date_to:    to,
    event_type: evType.id,
    user_ids:   userIds,
    color:      evType.color,
    notes,
    created_by: TCAuth.getNickname?.() || 'sistema',
  };

  try {
    let error;
    if (existingId) {
      ({ error } = await supabaseClient.from('calendar_events').update(payload).eq('id', existingId));
    } else {
      ({ error } = await supabaseClient.from('calendar_events').insert(payload));
    }
    if (error) throw error;

    await TCFactory.loadCalendarEvents();
    closeModal('cal-event-modal');
    renderCalendarSection();
    showToast('Evento salvato ✓');
  } catch(e) {
    console.error('[calendario] ERRORE COMPLETO:', e);
    alert('ERRORE CALENDARIO:\n' + (e?.message || JSON.stringify(e)));
    showToast('Errore salvataggio evento', 'error');
  }
}

async function deleteCalEvent(id) {
  if (!confirm('Eliminare questo evento?')) return;
  try {
    await TCFactory.deleteCalendarEvent(id);
    closeModal('cal-event-modal');
    renderCalendarSection();
    showToast('Evento eliminato');
  } catch(e) { showToast('Errore eliminazione', 'error'); }
}
