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
  selectedOrder: null,
  dayOpen: null,
  formEditOrder: null,
  formDefaultDate: null,
  formFiles: [],
  formTags: [],
  formDtfItems: [],
  formDtfOpen: false,
  settingsPrioOpen: false,
  settingsTagOpen: false,
  settingsUsersOpen: false,
  settingsLogOpen: false,
  settingsPwdOpen: false,
};



// ─────────────────────────────────────────────
// TEMA CHIARO/SCURO
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
  },
  init() { this.apply(this.get()); }
};

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
  toast.innerHTML = `${type === 'success' ? Icons.check() : Icons.alert()}<span>${message}</span>`;
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
  renderHeader();
  renderStats();
  renderOrderList();
}

function renderHeader() {
  const isDark = Theme.get() === 'dark';

  document.getElementById('header-root').innerHTML = `
    <div class="app-logo">
      <div class="app-logo-icon">${Icons.package(20)}</div>
      <div class="app-logo-text">
        <h1>T&amp;C <span class="accent">Gestione ordini</span></h1>
      </div>
    </div>
    <div class="app-header-actions">
      ${TCAuth.isLoggedIn() ? `<span style="font-size:0.75rem;color:var(--text-muted);padding:0 4px;">👤 ${escapeHtml(TCAuth.getNickname())}</span>` : ''}
      <button class="btn-icon" onclick="Theme.toggle()" title="Cambia tema">${isDark ? Icons.sun() : Icons.moon()}</button>
      <button class="btn-icon" onclick="openSettings()" title="Impostazioni">${Icons.settings()}</button>
      ${TCAuth.isLoggedIn() ? `<button class="btn-icon" onclick="doLogout()" title="Esci">${Icons.logOut()}</button>` : ''}
      <button class="btn btn-primary" onclick="openOrderForm()">${Icons.plus()} <span class="new-order-btn-text">Nuovo ordine</span></button>
    </div>
  `;
}

function renderStats() {
  const active  = TCFactory.getActiveOrders().length;
  const partial = TCFactory.getPartialOrders().length;
  const arch    = TCFactory.getArchivedOrders().length;

  document.getElementById('stats-root').innerHTML = `
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:var(--brand-gold);"></div>
      <div class="stat-card-label">Attivi</div>
      <div class="stat-card-value">${active}</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:#f97316;"></div>
      <div class="stat-card-label">Spedito parz.</div>
      <div class="stat-card-value" style="color:#f97316;">${partial}</div>
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

function setSearchQuery(v) { AppState.searchQuery = v; renderOrderList(); }


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
  const nPartial  = TCFactory.getPartialOrders().length;
  const nArchived = TCFactory.getArchivedOrders().length;

  const source =
    AppState.view === 'active'  ? TCFactory.getActiveOrders()  :
    AppState.view === 'partial' ? TCFactory.getPartialOrders() :
                                  TCFactory.getArchivedOrders();

  // Filtro testo
  const q = AppState.searchQuery.trim().toLowerCase();
  let filtered = q
    ? source.filter(o => o.nome.toLowerCase().includes(q) || o.tags.some(t => t.toLowerCase().includes(q)))
    : source;

  // Filtro tag
  if (AppState.filterTags.length > 0) {
    filtered = filtered.filter(o => AppState.filterTags.every(t => o.tags.includes(t)));
  }

  // Comparatori — getLavDone completamente autonomo, senza riferimenti esterni
  const getLavDone = (o) => {
    const s = o.stages || {};
    return (s.merceCompleta?.done ? 1 : 0)
         + (s.dtfPronti?.done     ? 1 : 0)
         + (s.ordineStampato?.done ? 1 : 0);
  };
  const cmpDate        = (a, b) => (a.dataOrdine || '').localeCompare(b.dataOrdine || '');
  const cmpPriorita    = (a, b) => TCFactory.getPriorityRank(a.priorityId) - TCFactory.getPriorityRank(b.priorityId);
  const cmpAvanzamento = (a, b) => getLavDone(b) - getLavDone(a); // più avanzati prima

  if (!['data','priorita','avanzamento'].includes(AppState.sortKey)) AppState.sortKey = 'data';

  const sorted = [...filtered].sort((a, b) => {
    switch (AppState.sortKey) {
      case 'data':        return cmpDate(a,b)        || cmpAvanzamento(a,b) || cmpPriorita(a,b);
      case 'priorita':    return cmpPriorita(a,b)    || cmpAvanzamento(a,b) || cmpDate(a,b);
      case 'avanzamento': return cmpAvanzamento(a,b) || cmpPriorita(a,b)   || cmpDate(a,b);
      default: return 0;
    }
  });

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

  const emptyMsg =
    q || AppState.filterTags.length > 0 ? 'Nessun risultato.' :
    AppState.view === 'archived' ? 'Nessun ordine archiviato.' :
    AppState.view === 'partial'  ? 'Nessun ordine spedito parzialmente.' :
    'Nessun ordine attivo. Premi "+ Nuovo ordine" per iniziare.';

  document.getElementById('orderlist-root').innerHTML = `
    <div class="glass-card">
      <div class="list-card-header">
        <div class="list-title-group">
          <div class="list-title">
            <h2>Ordini</h2>
            <p>${filtered.length} di ${source.length}</p>
          </div>
          <div class="view-tabs">
            <button class="view-tab ${AppState.view==='active'?'active':''}"   onclick="setView('active')">Attivi · ${nActive}</button>
            <button class="view-tab ${AppState.view==='partial'?'active':''}"  onclick="setView('partial')">${Icons.truck(12)} Sped. parz. · ${nPartial}</button>
            <button class="view-tab ${AppState.view==='archived'?'active':''}" onclick="setView('archived')">${Icons.archive(12)} Archivio · ${nArchived}</button>
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
      <div class="order-rows">
        <div class="order-row-item order-row-header-row" onclick="event.stopPropagation()">
          <div class="order-row-bar" style="background:transparent;"></div>
          <div class="order-row-grid">
            <div class="orc-name orc-hdr">Nome</div>
            <div class="orc-date orc-hdr">Data</div>
            <div class="orc-tags orc-hdr">Tipologia</div>
            <div class="orc-lav orc-hdr">Lavorazione</div>
            <div class="orc-eva orc-hdr">Spedizione</div>
            <div class="orc-deadline orc-hdr">Scadenza</div>
            <div class="orc-priority orc-hdr">Urgenza</div>
            <div class="orc-files orc-hdr">All.</div>
            <div class="orc-action orc-hdr"></div>
          </div>
        </div>
        ${sorted.length === 0
          ? `<div class="empty-list">${emptyMsg}</div>`
          : sorted.map(o => renderOrderRow(o)).join('')}
      </div>
    </div>
  `;
}

function renderOrderRow(o) {
  const p     = TCFactory.getPriority(o.priorityId);
  const color = p?.color || '#64748b';

  // Deadline badge
  let deadlineBadge = '—';
  let deadlineColor = 'var(--text-muted)';
  if (o.deadline) {
    const today = new Date().toISOString().slice(0, 10);
    const diff  = Math.ceil((new Date(o.deadline + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
    deadlineColor = diff < 0 ? '#ef4444' : diff <= 3 ? '#ef4444' : diff <= 7 ? '#f97316' : '#6366f1';
    deadlineBadge = diff < 0
      ? `scad. ${Math.abs(diff)}gg`
      : diff === 0 ? 'oggi'
      : `${diff}gg`;
  }

  // Lavorazione pills
  const lavPills = LAVORAZIONE_DEFS.map(s => {
    const done = o.stages?.[s.id]?.done;
    return `<button class="stage-pill ${done?'done':''}"
      onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
      title="${s.label}">${s.shortLabel}</button>`;
  }).join('');

  // Evasione pills
  const evaPills = EVASIONE_DEFS.map(s => {
    const done = o.stages?.[s.id]?.done;
    return `<button class="stage-pill evasione ${done?'done':''}"
      onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
      title="${s.label}">${s.shortLabel}</button>`;
  }).join('');

  // Tag cliccabili per filtro
  const tagPills = o.tags.slice(0, 3).map(t => {
    const c = TCFactory.getTagColor(t);
    const active = AppState.filterTags.includes(t);
    return `<button class="chip chip-btn" onclick="event.stopPropagation();toggleTagFilter('${escapeHtml(t)}')"
      style="background:${active ? c : `color-mix(in srgb, ${c} 14%, transparent)`};color:${active ? '#fff' : c};padding:2px 6px;cursor:pointer;font-size:0.68rem;">
      <span class="chip-dot" style="background:${active ? '#fff' : c};"></span>${escapeHtml(t)}
    </button>`;
  }).join('');

  // Allegati — icone cliccabili direttamente
  const filesBtns = (o.files || []).slice(0, 2).map((f, i) => {
    const isImg = f.type?.startsWith('image/');
    const isPdf = f.type === 'application/pdf';
    const icon  = isImg ? '🖼' : isPdf ? '📄' : '📎';
    return `<button class="file-quick-btn" onclick="event.stopPropagation();quickPreviewFile('${o.id}',${i})" title="${escapeHtml(f.name)}">${icon}</button>`;
  }).join('');
  const filesExtra = (o.files || []).length > 2
    ? `<span style="font-size:0.65rem;color:var(--text-muted);">+${(o.files||[]).length - 2}</span>` : '';

  return `
    <div class="order-row-item" role="button" tabindex="0"
      onclick="openOrderDetail('${o.id}')"
      onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
      <div class="order-row-bar" style="background:${color};"></div>
      <div class="order-row-grid">
        <div class="orc-name">${escapeHtml(o.nome)}</div>
        <div class="orc-date">${TCFactory.formatDate(o.dataOrdine, {day:'2-digit',month:'2-digit',year:'2-digit'})}</div>
        <div class="orc-tags">${tagPills}</div>
        <div class="orc-lav">${lavPills}</div>
        <div class="orc-eva">${evaPills}</div>
        <div class="orc-deadline" style="color:${deadlineColor};font-size:0.75rem;font-weight:${o.deadline ? '700' : '400'};">${deadlineBadge}</div>
        <div class="orc-priority">${renderPriorityChip(p)}</div>
        <div class="orc-files">${filesBtns}${filesExtra}</div>
        <div class="orc-action">
          <button class="file-quick-btn"
            onclick="event.stopPropagation();quickToggleArchive('${o.id}',${o.archived})"
            title="${o.archived ? 'Ripristina agli attivi' : 'Archivia ordine'}"
            style="opacity:0.45;transition:opacity 0.15s;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.45'">
            ${o.archived ? '↩' : Icons.archive(12)}
          </button>
        </div>
      </div>
    </div>
  `;
}

function quickPreviewFile(orderId, fileIndex) {
  const order = TCFactory.getOrderById(orderId);
  if (!order || !order.files[fileIndex]) return;
  previewFile(order.files[fileIndex]);
}

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

// toggleStage inline dalla lista (senza aprire il dettaglio)
async function toggleStageInline(orderId, stageId, done) {
  try {
    let updated = await TCFactory.setStage(orderId, stageId, done);
    if (stageId === 'spedito') {
      updated = await TCFactory.setArchived(orderId, done);
      if (!done && updated.stages?.speditoParzialmente?.done) {
        updated = await TCFactory.setStage(orderId, 'speditoParzialmente', false);
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
  } catch(e) { showToast('Errore aggiornamento fase', 'error'); }
}

// ─────────────────────────────────────────────
// CHIP / BADGE
// ─────────────────────────────────────────────

function renderPriorityChip(priority) {
  if (!priority) return '';
  const c = priority.color;
  return `<span class="chip" style="background:color-mix(in srgb, ${c} 16%, transparent);color:${c};box-shadow:0 0 0 1px color-mix(in srgb, ${c} 35%, transparent) inset;">
    <span class="chip-dot" style="background:${c};"></span>${escapeHtml(priority.label)}
  </span>`;
}

function renderTagChip(name) {
  const c = TCFactory.getTagColor(name);
  return `<span class="chip" style="background:color-mix(in srgb, ${c} 14%, transparent);color:${c};box-shadow:0 0 0 1px color-mix(in srgb, ${c} 30%, transparent) inset;">
    <span class="chip-dot" style="background:${c};"></span>${escapeHtml(name)}
  </span>`;
}

// ─────────────────────────────────────────────
// DIALOG: NUOVO / MODIFICA ORDINE
// ─────────────────────────────────────────────

function openOrderForm(order = null, defaultDate = null) {
  AppState.formEditOrder = order;
  AppState.formDefaultDate = defaultDate;
  AppState.formFiles = order ? [...(order.files || [])] : [];
  AppState.formTags = order ? [...order.tags] : [];
  AppState.formDtfItems = order ? (order.dtfItems || []).map(i => ({...i})) : [];

  const priorities = TCFactory.getPriorities();
  const tags = TCFactory.getTags();
  const isEdit = !!order;
  const today = TCFactory.getDefaultDate();

  const modal = document.getElementById('order-form-modal');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>${isEdit ? 'Modifica ordine' : 'Nuovo ordine'}</h2>
        <button class="btn-icon" onclick="closeModal('order-form-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Nome</label>
          <input id="of-nome" class="form-input" maxlength="120" placeholder="Nome ordine" value="${escapeHtml(order?.nome || '')}">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Data ordine</label>
            <input id="of-data" type="date" class="form-input" value="${order?.dataOrdine || defaultDate || today}">
          </div>
          <div class="form-group">
            <label class="form-label">Deadline</label>
            <input id="of-deadline" type="date" class="form-input" value="${order?.deadline || ''}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Priorità</label>
          <div class="chip-picker" id="of-priority-picker">
            ${priorities.map(p => {
              const defaultPId = order ? order.priorityId : (TCFactory.getDefaultPriorityId() || priorities[0]?.id);
              const active = defaultPId === p.id;
              return `<button type="button" class="chip chip-btn" data-prio="${p.id}"
                style="background:${active ? p.color : `color-mix(in srgb, ${p.color} 12%, transparent)`};color:${active ? '#fff' : p.color};"
                onclick="selectFormPriority('${p.id}')">${escapeHtml(p.label)}</button>`;
            }).join('')}
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Tag</label>
          <div class="chip-picker" id="of-tags-picker">
            ${tags.map(t => renderTagPickerChip(t)).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <input id="of-new-tag" class="form-input" placeholder="Aggiungi tag" maxlength="40" onkeydown="if(event.key==='Enter'){event.preventDefault();addFormTag();}">
            <button type="button" class="btn btn-secondary btn-icon" onclick="addFormTag()">${Icons.plus()}</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Allegati</label>
          <div class="dropzone">
            <input type="file" id="of-file-input" multiple accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" style="display:none;" onchange="handleFormFiles(event)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('of-file-input').click()">${Icons.paperclip(14)} Carica file o foto</button>
            <p>Immagini compresse automaticamente sotto 2MB</p>
          </div>
          <div id="of-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
        </div>

        <!-- SEZIONE DTF COLLASSABILE -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          <button type="button" onclick="toggleFormDTF()"
            style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);border:none;cursor:pointer;color:var(--text-primary);font-family:var(--font-body);font-weight:600;font-size:0.88rem;">
            <div style="display:flex;align-items:center;gap:8px;">${Icons.printer(14)} DTF</div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" id="dtf-chevron" style="transform:rotate(${AppState.formDtfOpen ? 180 : 0}deg);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div id="dtf-form-body" style="display:${AppState.formDtfOpen ? 'block' : 'none'};padding:12px 14px;">
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:10px;">Roll: 57cm · Velocità: 8m/h</div>
            <div id="dtf-rows-container" style="display:flex;flex-direction:column;gap:8px;"></div>
            <div id="dtf-total-box" style="margin-top:10px;"></div>
            <button type="button" onclick="addDTFRow()" class="btn btn-secondary btn-sm" style="margin-top:10px;">${Icons.plus(13)} Aggiungi calcolo</button>
          </div>
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

  renderFormFilesList();
  if (AppState.formDtfOpen && AppState.formDtfItems.length > 0) renderDTFRows();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('order-form-modal'); };
}

function toggleFormDTF() {
  AppState.formDtfOpen = !AppState.formDtfOpen;
  const body = document.getElementById('dtf-form-body');
  const chev = document.getElementById('dtf-chevron');
  if (body) body.style.display = AppState.formDtfOpen ? 'block' : 'none';
  if (chev) chev.style.transform = `rotate(${AppState.formDtfOpen ? 180 : 0}deg)`;
  if (AppState.formDtfOpen) renderDTFRows();
}

function renderDTFRows() {
  const container = document.getElementById('dtf-rows-container');
  if (!container) return;

  // Render solo la struttura (inputs con ID stabili) — non richiamare su ogni keystroke
  container.innerHTML = AppState.formDtfItems.map((item, i) => `
    <div data-dtf-row="${i}" style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:grid;grid-template-columns:2fr 70px 70px 60px auto;gap:6px;align-items:center;">
        <input class="form-input" placeholder="Nome (opz.)" value="${escapeHtml(item.label || '')}"
          oninput="storeDTFField(${i},'label',this.value)">
        <input class="form-input" type="number" placeholder="L cm" min="0.1" step="0.1" value="${item.width_cm || ''}"
          oninput="storeDTFField(${i},'width_cm',this.value); updateDTFCalc()">
        <input class="form-input" type="number" placeholder="H cm" min="0.1" step="0.1" value="${item.height_cm || ''}"
          oninput="storeDTFField(${i},'height_cm',this.value); updateDTFCalc()">
        <input class="form-input" type="number" placeholder="Qty" min="1" value="${item.qty || ''}"
          oninput="storeDTFField(${i},'qty',this.value); updateDTFCalc()">
        <button type="button" class="btn-icon" onclick="removeDTFRow(${i})" style="color:var(--priority-urgent);">${Icons.x(13)}</button>
      </div>
      <div id="dtf-result-${i}" style="font-size:0.75rem;color:var(--brand-gold);font-weight:600;padding-left:2px;min-height:18px;"></div>
    </div>
  `).join('');

  updateDTFCalc();
}

// Aggiorna solo i display dei risultati senza toccare gli input
function updateDTFCalc() {
  AppState.formDtfItems.forEach((item, i) => {
    const resultEl = document.getElementById(`dtf-result-${i}`);
    if (!resultEl) return;
    const calc = TCFactory.calcDTFItem(item);
    resultEl.textContent = calc.meters > 0
      ? `→ ${calc.meters}m · ${calc.hours}h ${calc.minutes}min`
      : '';
  });
  renderDTFTotal();
}

// Salva solo il valore nell'AppState senza re-render
function storeDTFField(i, field, value) {
  if (!AppState.formDtfItems[i]) return;
  AppState.formDtfItems[i][field] = field === 'label' ? value : (parseFloat(value) || '');
}

function renderDTFTotal() {
  const box = document.getElementById('dtf-total-box');
  if (!box) return;
  const tot = TCFactory.calcDTFTotal(AppState.formDtfItems);
  if (tot.meters <= 0) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div style="background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 14px;display:flex;gap:24px;align-items:center;border:1px solid var(--border);">
      <div>
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);font-weight:700;">Totale metro lineare</div>
        <div style="font-size:1.4rem;font-weight:800;color:var(--brand-gold);">${tot.meters} m</div>
      </div>
      <div>
        <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);font-weight:700;">Tempo stampa</div>
        <div style="font-size:1.4rem;font-weight:800;color:var(--brand-gold);">${tot.hours}h ${tot.minutes}min</div>
      </div>
    </div>
  `;
}

function addDTFRow() {
  AppState.formDtfItems.push({ label: '', width_cm: '', height_cm: '', qty: 1 });
  renderDTFRows();
}

function removeDTFRow(i) {
  AppState.formDtfItems.splice(i, 1);
  renderDTFRows();
}

function renderTagPickerChip(t) {
  const active = AppState.formTags.includes(t.name);
  return `<button type="button" class="chip chip-btn" data-tag="${escapeHtml(t.name)}"
    style="background:${active ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`};color:${active ? '#fff' : t.color};"
    onclick="toggleFormTag('${escapeHtml(t.name)}')">${escapeHtml(t.name)}</button>`;
}

function selectFormPriority(id) {
  document.getElementById('of-priority-picker').dataset.selected = id;
  const priorities = TCFactory.getPriorities();
  document.getElementById('of-priority-picker').innerHTML = priorities.map(p => {
    const active = id === p.id;
    return `<button type="button" class="chip chip-btn" data-prio="${p.id}"
      style="background:${active ? p.color : `color-mix(in srgb, ${p.color} 12%, transparent)`};color:${active ? '#fff' : p.color};"
      onclick="selectFormPriority('${p.id}')">${escapeHtml(p.label)}</button>`;
  }).join('');
}

function toggleFormTag(name) {
  if (AppState.formTags.includes(name)) {
    AppState.formTags = AppState.formTags.filter(t => t !== name);
  } else {
    AppState.formTags.push(name);
  }
  const tags = TCFactory.getTags();
  document.getElementById('of-tags-picker').innerHTML = tags.map(t => renderTagPickerChip(t)).join('');
}

async function addFormTag() {
  const input = document.getElementById('of-new-tag');
  const name = input.value.trim();
  if (!name) return;
  try {
    await TCFactory.addTag(name);
    if (!AppState.formTags.includes(name)) AppState.formTags.push(name);
    input.value = '';
    const tags = TCFactory.getTags();
    document.getElementById('of-tags-picker').innerHTML = tags.map(t => renderTagPickerChip(t)).join('');
  } catch (e) {
    showToast('Errore aggiungendo il tag', 'error');
  }
}

// ─────────────────────────────────────────────
// COMPRESSIONE IMMAGINI (client-side, Canvas API)
// ─────────────────────────────────────────────

async function compressImageIfNeeded(file) {
  // Solo immagini — PDF e altri file passano invariati
  if (!file.type.startsWith('image/')) return file;
  // Già sotto il limite → nessuna compressione necessaria
  if (file.size <= TCFactory.MAX_FILE_BYTES) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Dimensione di partenza — scala a max 1920px sul lato più lungo
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      const MAX_DIM = 1920;
      if (w > MAX_DIM || h > MAX_DIM) {
        const s = MAX_DIM / Math.max(w, h);
        w = Math.round(w * s);
        h = Math.round(h * s);
      }

      // Prova con qualità decrescente; se ancora troppo grande, riduce le dimensioni
      const attempt = (width, height, quality) => {
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) { resolve(file); return; }

          if (blob.size <= TCFactory.MAX_FILE_BYTES) {
            // Successo — restituisce un File col nome originale
            resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
          } else if (quality > 0.25) {
            attempt(width, height, quality - 0.15);           // abbassa qualità
          } else if (width > 900) {
            attempt(Math.round(width * 0.7), Math.round(height * 0.7), 0.75); // riduce dimensioni
          } else {
            resolve(file); // non si riesce a comprimere abbastanza
          }
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

      // Se è un'immagine sopra il limite → comprimi automaticamente
      if (f.type.startsWith('image/') && f.size > TCFactory.MAX_FILE_BYTES) {
        showToast(`Comprimo ${f.name}…`);
        file = await compressImageIfNeeded(f);
        if (file !== f) {
          showToast(`📷 ${f.name} → ${(file.size / 1024).toFixed(0)} KB`);
        }
      }

      if (file.size > TCFactory.MAX_FILE_BYTES) {
        showToast(`${f.name} supera 2MB anche dopo la compressione`, 'error');
        continue;
      }

      const uploaded = await TCFactory.uploadFile(file);
      // Mantieni il nome originale dell'utente (non il nome post-compressione)
      AppState.formFiles.push({ ...uploaded, name: f.name });

    } catch (e) {
      showToast(`Errore caricando ${f.name}`, 'error');
    }
  }
  event.target.value = '';
  renderFormFilesList();
}

function renderFormFilesList() {
  const container = document.getElementById('of-files-list');
  if (!container) return;
  container.innerHTML = AppState.formFiles.map((f, i) => `
    <div class="file-row">
      ${Icons.fileText(15)}
      <span class="truncate">${escapeHtml(f.name)}</span>
      <span class="file-size">${(f.size / 1024).toFixed(0)} KB</span>
      <button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="removeFormFile(${i})">${Icons.x()}</button>
    </div>
  `).join('');
}

function removeFormFile(i) {
  AppState.formFiles.splice(i, 1);
  renderFormFilesList();
}

async function submitOrderForm() {
  const nome = document.getElementById('of-nome').value.trim();
  const dataOrdine = document.getElementById('of-data').value;
  const deadline = document.getElementById('of-deadline').value || null;
  const notes = document.getElementById('of-notes').value;
  const priorityId = document.getElementById('of-priority-picker').dataset.selected;

  if (!nome) { showToast('Inserisci un nome', 'error'); return; }
  if (!dataOrdine) { showToast('Inserisci una data', 'error'); return; }

  // Deadline obbligatoria se priorità urgente
  const selectedPriority = TCFactory.getPriority(priorityId);
  if (selectedPriority?.id === 'urgente' && !deadline) {
    // Evidenzia il campo deadline
    const dlField = document.getElementById('of-deadline');
    if (dlField) {
      dlField.focus();
      dlField.style.borderColor = 'var(--priority-urgent)';
      dlField.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--priority-urgent) 25%, transparent)';
      dlField.addEventListener('input', () => {
        dlField.style.borderColor = '';
        dlField.style.boxShadow = '';
      }, { once: true });
    }
    showToast('Gli ordini urgenti richiedono una deadline', 'error');
    return;
  }

  const payload = { nome, dataOrdine, deadline, notes, priorityId, tags: AppState.formTags, files: AppState.formFiles, dtfItems: AppState.formDtfItems };

  try {
    if (AppState.formEditOrder) {
      await TCFactory.updateOrder(AppState.formEditOrder.id, payload);
      showToast('Ordine aggiornato');
    } else {
      await TCFactory.addOrder(payload);
      showToast('Ordine creato');
    }
    closeModal('order-form-modal');
    renderApp();
  } catch (e) {
    console.error(e);
    showToast('Errore durante il salvataggio', 'error');
  }
}

// ─────────────────────────────────────────────
// DIALOG: DETTAGLIO ORDINE
// ─────────────────────────────────────────────

function openOrderDetail(id) {
  const order = TCFactory.getOrderById(id);
  if (!order) return;
  AppState.selectedOrder = order;
  renderOrderDetail();
  document.getElementById('order-detail-modal').classList.add('active');
}

function renderOrderDetail() {
  const order = AppState.selectedOrder;
  const modal = document.getElementById('order-detail-modal');
  if (!order) { modal.classList.remove('active'); return; }

  const priority = TCFactory.getPriority(order.priorityId);
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
        <h2 style="display:flex;align-items:center;gap:8px;overflow:hidden;">
          <span class="truncate">${escapeHtml(order.nome)}</span>
          ${order.archived ? `<span class="chip" style="background:var(--bg-secondary);color:var(--text-muted);">archiviato</span>` : ''}
        </h2>
        <button class="btn-icon" onclick="closeModal('order-detail-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
          <span style="color:var(--text-muted);">Data ordine</span>
          <span style="font-weight:600;">${TCFactory.formatDate(order.dataOrdine, { day:'numeric', month:'long', year:'numeric' })}</span>
        </div>
        ${order.deadline ? `
        <div style="display:flex;justify-content:space-between;font-size:0.85rem;">
          <span style="color:var(--text-muted);">Deadline</span>
          <span style="font-weight:600;color:${TCFactory.isDeadlinePast(order) && !allLavDone ? 'var(--priority-urgent)' : 'var(--text-primary)'};">${TCFactory.formatDate(order.deadline, { day:'numeric', month:'long', year:'numeric' })}</span>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;">
          <span style="color:var(--text-muted);">Priorità</span>
          ${renderPriorityChip(priority)}
        </div>

        ${order.tags.length > 0 ? `
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:0.85rem;">
          <span style="color:var(--text-muted);flex-shrink:0;">Tag</span>
          <div style="display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;">
            ${order.tags.map(t => renderTagChip(t)).join('')}
          </div>
        </div>` : ''}

        ${order.files && order.files.length > 0 ? `
        <div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:6px;">Allegati</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${order.files.map((f, i) => `
              <div class="file-row" style="cursor:pointer;" onclick="previewOrderFile(${i})">
                ${Icons.fileText(15)}
                <span class="truncate" style="font-size:0.78rem;">${escapeHtml(f.name)}</span>
                <span style="color:var(--brand-gold-dark);display:flex;">${Icons.eye(15)}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        ${order.notes ? `
        <div>
          <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:4px;">Note</div>
          <div style="font-size:0.85rem;color:var(--text-primary);white-space:pre-wrap;background:var(--bg-secondary);border-radius:var(--radius-md);padding:10px 12px;">${escapeHtml(order.notes)}</div>
        </div>` : ''}

        ${renderStageSection(LAVORAZIONE_DEFS, 'Lavorazione')}
        ${renderStageSection(EVASIONE_DEFS, 'Evasione')}

        <!-- Azioni spostamento stato -->
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
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <button class="btn btn-danger btn-sm" onclick="deleteOrderConfirm('${order.id}')">${Icons.trash(14)} Elimina</button>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" onclick="editFromDetail('${order.id}')">${Icons.pencil(14)} Modifica</button>
          <button class="btn btn-primary btn-sm" onclick="closeModal('order-detail-modal')">Chiudi</button>
        </div>
      </div>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) closeModal('order-detail-modal'); };
}

async function toggleStageDetail(orderId, stageId, done) {
  try {
    let updated = await TCFactory.setStage(orderId, stageId, done);
    // "Spedito" → archivia automaticamente
    if (stageId === 'spedito') {
      updated = await TCFactory.setArchived(orderId, done);
      if (!done && updated.stages?.speditoParzialmente?.done) {
        updated = await TCFactory.setStage(orderId, 'speditoParzialmente', false);
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
  } catch (e) {
    showToast('Errore aggiornando la fase', 'error');
  }
}

async function archiveOrder(id) {
  try {
    await TCFactory.setArchived(id, true);
    showToast('Ordine archiviato');
    closeModal('order-detail-modal');
    renderApp();
  } catch (e) { showToast('Errore', 'error'); }
}

async function moveOrderTo(id, target) {
  try {
    const o = TCFactory.getOrderById(id);
    if (!o) return;
    // Reset evasione stages first
    await TCFactory.setStage(id, 'speditoParzialmente', false);
    await TCFactory.setStage(id, 'spedito', false);
    await TCFactory.setArchived(id, false);
    if (target === 'partial') {
      await TCFactory.setStage(id, 'speditoParzialmente', true);
    } else if (target === 'archived') {
      await TCFactory.setStage(id, 'speditoParzialmente', true);
      await TCFactory.setStage(id, 'spedito', true);
      await TCFactory.setArchived(id, true);
    }
    // target === 'active': già resettato sopra
    AppState.selectedOrder = TCFactory.getOrderById(id);
    renderOrderDetail();
    renderApp();
    const labels = { active: 'Attivi', partial: 'Spedito parz.', archived: 'Archivio' };
    showToast(`Ordine spostato in: ${labels[target]}`);
  } catch(e) { showToast('Errore spostamento ordine', 'error'); }
}

async function restoreOrder(id) {
  await moveOrderTo(id, 'active');
}

async function deleteOrderConfirm(id) {
  const order = TCFactory.getOrderById(id);
  if (!order) return;
  if (!confirm(`Eliminare l'ordine "${order.nome}"? Azione non reversibile.`)) return;
  try {
    await TCFactory.deleteOrder(id);
    showToast('Ordine eliminato');
    closeModal('order-detail-modal');
    renderApp();
  } catch (e) { showToast('Errore durante l\'eliminazione', 'error'); }
}

function editFromDetail(id) {
  const order = TCFactory.getOrderById(id);
  closeModal('order-detail-modal');
  openOrderForm(order);
}

function previewOrderFile(index) {
  const order = AppState.selectedOrder;
  if (!order || !order.files[index]) return;
  previewFile(order.files[index]);
}

function previewFile(file) {
  const modal = document.getElementById('file-preview-modal');
  const isImage = file.type && file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  let body;
  if (isImage) {
    body = `<img src="${file.url}" alt="${escapeHtml(file.name)}" style="max-width:100%;max-height:72vh;display:block;margin:0 auto;border-radius:var(--radius-md);">`;
  } else if (isPdf) {
    body = `<iframe src="${file.url}" style="width:100%;height:72vh;border:none;border-radius:var(--radius-md);"></iframe>`;
  } else {
    body = `<div style="text-align:center;padding:48px 0;color:var(--text-muted);font-size:0.85rem;">Anteprima non disponibile per questo tipo di file.<br>Usa "Scarica" per aprirlo.</div>`;
  }

  modal.innerHTML = `
    <div class="modal" style="max-width:720px;">
      <div class="modal-header">
        <h2 class="truncate" style="max-width:80%;">${escapeHtml(file.name)}</h2>
        <button class="btn-icon" onclick="closeModal('file-preview-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="padding:var(--space-md);">
        ${body}
      </div>
      <div class="modal-footer">
        <a href="${file.url}" download="${escapeHtml(file.name)}" class="btn btn-secondary">${Icons.download(14)} Scarica</a>
        <button class="btn btn-primary" onclick="closeModal('file-preview-modal')">Chiudi</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('file-preview-modal'); };
}

// ─────────────────────────────────────────────
// DIALOG: ORDINI DEL GIORNO
// ─────────────────────────────────────────────

function renderDayDialog() {
  const modal = document.getElementById('day-modal');
  const state = AppState.dayOpen;
  if (!state) { modal.classList.remove('active'); return; }

  const dateLabel = new Date(state.date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 style="text-transform:capitalize;">${dateLabel}</h2>
        <button class="btn-icon" onclick="closeDayDialog()">${Icons.x()}</button>
      </div>
      <div class="modal-body">
        ${state.orders.length === 0
          ? `<p style="text-align:center;color:var(--text-muted);padding:20px 0;">Nessun ordine in questo giorno.</p>`
          : state.orders.map(o => {
              const p = TCFactory.getPriority(o.priorityId);
              const completed = TCFactory.isCompleted(o);
              return `
                <button class="day-order-row" onclick="selectFromDayDialog('${o.id}')">
                  <div class="day-order-bar" style="background:${p?.color || '#64748b'};"></div>
                  <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <span class="truncate" style="font-weight:600;">${escapeHtml(o.nome)}</span>
                      ${completed ? Icons.checkCircle('var(--priority-low)') : ''}
                    </div>
                    ${o.tags.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;">${o.tags.map(t => renderTagChip(t)).join('')}</div>` : ''}
                  </div>
                  ${renderPriorityChip(p)}
                </button>
              `;
            }).join('')}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeDayDialog()">Chiudi</button>
        <button class="btn btn-primary" onclick="addOrderFromDayDialog()">${Icons.plus()} Aggiungi ordine</button>
      </div>
    </div>
  `;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeDayDialog(); };
}

function closeDayDialog() {
  AppState.dayOpen = null;
  document.getElementById('day-modal').classList.remove('active');
}

function selectFromDayDialog(id) {
  closeDayDialog();
  openOrderDetail(id);
}

function addOrderFromDayDialog() {
  const date = AppState.dayOpen?.date;
  closeDayDialog();
  openOrderForm(null, date);
}

// ─────────────────────────────────────────────
// DIALOG: IMPOSTAZIONI (priorità + tag)
// ─────────────────────────────────────────────

let _newPrioColor = '#6366f1';
let _newTagColor = '#8b5cf6';

function openSettings() {
  renderSettingsDialog();
  document.getElementById('settings-modal').classList.add('active');
}

function renderSettingsDialog() {
  const priorities = TCFactory.getPriorities();
  const tags = TCFactory.getTags();
  const modal = document.getElementById('settings-modal');
  const prioOpen = AppState.settingsPrioOpen;
  const tagOpen  = AppState.settingsTagOpen;

  const sectionBtn = (label, icon, isOpen, fn) => `
    <button type="button" onclick="${fn}()"
      style="width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-secondary);border:none;cursor:pointer;color:var(--text-primary);font-family:var(--font-body);font-weight:700;font-size:0.88rem;border-radius:${isOpen ? `var(--radius-md) var(--radius-md) 0 0` : 'var(--radius-md)'};margin-bottom:${isOpen ? 0 : 6}px;">
      <div style="display:flex;align-items:center;gap:8px;">${icon} ${label}</div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="transform:rotate(${isOpen ? 180 : 0}deg);transition:transform 0.2s;"><polyline points="6 9 12 15 18 9"/></svg>
    </button>`;

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Impostazioni</h2>
        <button class="btn-icon" onclick="closeModal('settings-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:8px;">

        <!-- PRIORITÀ -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Priorità', Icons.flag(14), prioOpen, 'toggleSettingsPrio')}
          ${prioOpen ? `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px;">
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

        <!-- TAG -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Tag', Icons.tag(14), tagOpen, 'toggleSettingsTag')}
          ${tagOpen ? `<div style="padding:12px 14px;display:flex;flex-direction:column;gap:6px;">
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

        ${TCAuth.isAdmin() ? `
        <!-- UTENTI (solo admin) -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Gestione utenti', Icons.users(14), AppState.settingsUsersOpen, 'toggleSettingsUsers')}
          ${AppState.settingsUsersOpen ? `<div id="users-section-body" style="padding:12px 14px;"></div>` : ''}
        </div>

        <!-- LOG (solo admin) -->
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('Registro modifiche', Icons.clock(14), AppState.settingsLogOpen, 'toggleSettingsLog')}
          ${AppState.settingsLogOpen ? `<div id="log-section-body" style="padding:12px 14px;"></div>` : ''}
        </div>
        ` : ''}

        <!-- PASSWORD (visibile a tutti gli utenti loggati) -->
        ${TCAuth.isLoggedIn() ? `
        <div style="border:1px solid var(--border);border-radius:var(--radius-md);overflow:hidden;">
          ${sectionBtn('La mia password', Icons.lock(14), AppState.settingsPwdOpen, 'toggleSettingsPwd')}
          ${AppState.settingsPwdOpen ? `
          <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
            <div class="settings-section-hint">Inserisci la password attuale per confermarne il cambio.</div>
            <input id="pwd-old"  type="password" class="form-input" placeholder="Password attuale">
            <input id="pwd-new1" type="password" class="form-input" placeholder="Nuova password (min. 4 caratteri)">
            <input id="pwd-new2" type="password" class="form-input" placeholder="Ripeti nuova password"
              onkeydown="if(event.key==='Enter')doChangePassword()">
            <button class="btn btn-primary btn-sm" style="align-self:flex-end;" onclick="doChangePassword()">Aggiorna password</button>
          </div>` : ''}
        </div>
        ` : ''}

      </div>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) closeModal('settings-modal'); };

  // Popola le sezioni async dopo il render
  if (AppState.settingsUsersOpen && TCAuth.isAdmin()) {
    const ub = document.getElementById('users-section-body');
    if (ub) renderUsersSection(ub);
  }
  if (AppState.settingsLogOpen && TCAuth.isAdmin()) {
    const lb = document.getElementById('log-section-body');
    if (lb) renderLogSection(lb);
  }
}

function toggleSettingsPrio()  { AppState.settingsPrioOpen  = !AppState.settingsPrioOpen;  renderSettingsDialog(); }
function toggleSettingsTag()   { AppState.settingsTagOpen   = !AppState.settingsTagOpen;   renderSettingsDialog(); }
function toggleSettingsUsers() { AppState.settingsUsersOpen = !AppState.settingsUsersOpen; renderSettingsDialog(); }
function toggleSettingsLog()   { AppState.settingsLogOpen   = !AppState.settingsLogOpen;   renderSettingsDialog(); }
function toggleSettingsPwd()   { AppState.settingsPwdOpen   = !AppState.settingsPwdOpen;   renderSettingsDialog(); }

async function doChangePassword() {
  const oldPwd = document.getElementById('pwd-old')?.value;
  const newPwd = document.getElementById('pwd-new1')?.value;
  const repPwd = document.getElementById('pwd-new2')?.value;
  if (!oldPwd || !newPwd) { showToast('Compila tutti i campi', 'error'); return; }
  if (newPwd !== repPwd)  { showToast('Le nuove password non coincidono', 'error'); return; }
  if (newPwd.length < 4)  { showToast('Minimo 4 caratteri', 'error'); return; }
  try {
    await TCAuth.changePassword(oldPwd, newPwd);
    showToast('Password aggiornata ✓');
    AppState.settingsPwdOpen = false;
    renderSettingsDialog();
  } catch(e) { showToast(e.message, 'error'); }
}


async function reorderPrio(id, dir) {
  try { await TCFactory.reorderPriority(id, dir); renderSettingsDialog(); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function updatePrioColor(id, color) {
  try { await TCFactory.updatePriority(id, { color }); renderSettingsDialog(); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function updatePrioLabel(id, label) {
  if (!label.trim()) return;
  try { await TCFactory.updatePriority(id, { label: label.trim() }); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function deletePrioConfirm(id) {
  if (!confirm('Eliminare questa priorità? Gli ordini che la usano resteranno senza priorità valida.')) return;
  try { await TCFactory.deletePriority(id); renderSettingsDialog(); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function addNewPriority() {
  const input = document.getElementById('new-prio-input');
  const label = input.value.trim();
  if (!label) return;
  try {
    await TCFactory.addPriority(label, _newPrioColor);
    input.value = '';
    renderSettingsDialog();
  } catch (e) { showToast('Errore', 'error'); }
}

async function updateTagColorSetting(name, color) {
  try { await TCFactory.updateTagColor(name, color); renderSettingsDialog(); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function deleteTagConfirm(name) {
  if (!confirm(`Eliminare il tag "${name}"? Verrà rimosso da tutti gli ordini.`)) return;
  try { await TCFactory.deleteTag(name); renderSettingsDialog(); renderApp(); }
  catch (e) { showToast('Errore', 'error'); }
}
async function addNewTagSetting() {
  const input = document.getElementById('new-tag-input');
  const name = input.value.trim();
  if (!name) return;
  try {
    await TCFactory.addTag(name, _newTagColor);
    input.value = '';
    renderSettingsDialog();
  } catch (e) { showToast('Errore', 'error'); }
}

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
  if (id === 'order-detail-modal') AppState.selectedOrder = null;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// ─────────────────────────────────────────────
// ICONE SVG
// ─────────────────────────────────────────────

const Icons = {
  shirt: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M20.38 3.46L16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.57a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.57a2 2 0 0 0-1.34-2.23z"/></svg>`,
  package: (s=18) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.73Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  plus: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  check: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="20 6 9 17 4 12"/></svg>`,
  checkCircle: (color='currentColor', s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
  alert: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  settings: (s=17) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  sun: (s=17) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: (s=17) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  search: () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  archive: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>`,
  truck: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  archiveRestore: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><path d="M10 12h4"/></svg>`,
  paperclip: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  fileText: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  download: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  eye: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  trash: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  pencil: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`,
  chevronLeft: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="15 18 9 12 15 6"/></svg>`,
  layoutSide: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="3" width="9" height="18" rx="1.5"/><rect x="14" y="3" width="7" height="18" rx="1.5"/></svg>`,
  layoutStack: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="3" width="18" height="9" rx="1.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/></svg>`,
  chevronRight: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="9 18 15 12 9 6"/></svg>`,
  arrowUp: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arrowDown: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  flag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  tag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  printer: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
  logOut: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  users: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  clock: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  lock: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  magic: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8 19 13"/><path d="M15 9h.01"/><path d="M17.8 6.2 19 5"/><path d="m3 21 9-9"/><path d="M12.2 6.2 11 5"/></svg>`,
  calendarDays: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
};

window.AppState = AppState;
window.Theme = Theme;
window.showToast = showToast;
window.renderApp = renderApp;

// ─────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────

function renderLoginScreen() {
  const overlay = document.getElementById('login-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="login-card glass-card">
      <div style="display:flex;justify-content:center;margin-bottom:16px;">
        <div style="width:52px;height:52px;border-radius:14px;background:var(--brand-gradient);display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 14px color-mix(in srgb, var(--brand-gold) 40%, transparent);">
          ${Icons.package(26)}
        </div>
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
    document.getElementById('login-overlay').style.display = 'none';
    renderApp();
  } catch(e) {
    if (err) err.textContent = e.message;
    if (btn) { btn.disabled = false; btn.textContent = 'Accedi'; }
  }
}

function doLogout() {
  if (!confirm('Vuoi uscire?')) return;
  TCAuth.logout();
  renderLoginScreen();
}

// ─────────────────────────────────────────────
// GESTIONE UTENTI (solo admin, dentro Impostazioni)
// ─────────────────────────────────────────────

let _usersList = [];

async function renderUsersSection(container) {
  try { _usersList = await TCAuth.listUsers(); } catch(e) { _usersList = []; }
  const priorities = TCFactory.getPriorities(); // unused here but keeps scope consistent

  container.innerHTML = `
    <div class="settings-section-hint">Solo gli admin possono creare e rimuovere account.</div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
      ${_usersList.map(u => `
        <div class="config-row" style="justify-content:space-between;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.88rem;font-weight:600;">${escapeHtml(u.nickname)}</span>
            ${u.is_admin ? `<span class="chip" style="background:var(--brand-gold)22;color:var(--brand-gold);font-size:0.65rem;">admin</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
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
  const nick   = document.getElementById('new-user-nick')?.value?.trim();
  const pwd    = document.getElementById('new-user-pwd')?.value;
  const isAdm  = document.getElementById('new-user-admin')?.checked || false;
  if (!nick || !pwd) { showToast('Compila nickname e password', 'error'); return; }
  if (pwd.length < 4) { showToast('Password troppo corta (min 4 caratteri)', 'error'); return; }
  try {
    await TCAuth.createUser(nick, pwd, isAdm);
    showToast(`Account "${nick}" creato`);
    const container = document.getElementById('users-section-body');
    if (container) renderUsersSection(container);
  } catch(e) { showToast(e.message, 'error'); }
}

async function adminResetPwdPrompt(nick) {
  const newPwd = prompt(`Nuova password per "${nick}" (min. 4 caratteri):`);
  if (!newPwd) return;
  if (newPwd.length < 4) { showToast('Minimo 4 caratteri', 'error'); return; }
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

// ─────────────────────────────────────────────
// REGISTRO MODIFICHE (log viewer)
// ─────────────────────────────────────────────

async function renderLogSection(container) {
  container.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);padding:8px 0;">Caricamento log…</div>`;
  try {
    const entries = await TCFactory.getActivityLog(100);
    if (entries.length === 0) {
      container.innerHTML = `<div style="font-size:0.8rem;color:var(--text-muted);">Nessuna attività registrata.</div>`;
      return;
    }
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;max-height:340px;overflow-y:auto;">
        ${entries.map(e => {
          const dt = new Date(e.created_at).toLocaleString('it-IT', {day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
          return `
            <div style="display:grid;grid-template-columns:110px 80px 1fr;gap:8px;padding:6px 8px;border-radius:var(--radius-sm);background:var(--bg-secondary);font-size:0.75rem;align-items:start;">
              <span style="color:var(--text-muted);">${dt}</span>
              <span style="font-weight:700;color:var(--brand-gold);">${escapeHtml(e.user_nickname)}</span>
              <div>
                <span style="font-weight:600;">${escapeHtml(e.action)}</span>
                ${e.order_name ? `<span style="color:var(--text-muted);"> · ${escapeHtml(e.order_name)}</span>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  } catch(e) {
    container.innerHTML = `<div style="color:var(--priority-urgent);font-size:0.8rem;">Errore caricamento log: ${e.message}</div>`;
  }
}
