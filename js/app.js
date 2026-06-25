/**
 * T&C Factory — App UI v5.0
 * Pagina unica: header, statistiche, calendario, lista ordini, dialog.
 */

// ─────────────────────────────────────────────
// STATO LOCALE DI INTERFACCIA
// ─────────────────────────────────────────────

const AppState = {
  view: 'active',           // 'active' | 'archived'
  searchQuery: '',
  sortKey: 'data',           // 'nome' | 'data' | 'priorita' | 'dataCompletato'
  calCursor: new Date(),
  selectedOrder: null,       // ordine apparso nel detail dialog
  dayOpen: null,             // { date, orders }
  formEditOrder: null,       // ordine in modifica nel form (null = nuovo)
  formDefaultDate: null,
  formFiles: [],             // allegati temporanei nel form aperto
  formTags: [],              // tag selezionati temporanei nel form aperto
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
  renderCalendar();
  renderOrderList();
}

function renderHeader() {
  const active = TCFactory.getActiveOrders();
  const archived = TCFactory.getArchivedOrders();
  const isDark = Theme.get() === 'dark';

  document.getElementById('header-root').innerHTML = `
    <div class="app-logo">
      <div class="app-logo-icon">${Icons.shirt(20)}</div>
      <div class="app-logo-text">
        <h1><span class="accent">Gestionale</span> Ordini</h1>
        <p>${active.length} attivi · ${archived.length} archiviati</p>
      </div>
    </div>
    <div class="app-header-actions">
      <span id="connection-badge" class="btn-icon" style="font-size:0.7rem;font-weight:600;padding:4px 8px;border-radius:10px;background:var(--bg-secondary);cursor:help;" title="Stato connessione">⏳</span>
      <button class="btn-icon" onclick="Theme.toggle()" title="Cambia tema">${isDark ? Icons.sun() : Icons.moon()}</button>
      <button class="btn-icon" onclick="openSettings()" title="Impostazioni">${Icons.settings()}</button>
      <button class="btn btn-primary" onclick="openOrderForm()">${Icons.plus()} <span class="new-order-btn-text">Nuovo ordine</span></button>
    </div>
  `;
}

function renderStats() {
  const active = TCFactory.getActiveOrders();
  const completed = active.filter(o => TCFactory.isCompleted(o)).length;
  const inProgress = active.length - completed;

  document.getElementById('stats-root').innerHTML = `
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:var(--brand-gold);"></div>
      <div class="stat-card-label">Attivi</div>
      <div class="stat-card-value">${active.length}</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:#3b82f6;"></div>
      <div class="stat-card-label">In corso</div>
      <div class="stat-card-value" style="color:#3b82f6;">${inProgress}</div>
    </div>
    <div class="glass-card stat-card">
      <div class="stat-card-glow" style="background:var(--priority-low);"></div>
      <div class="stat-card-label">Completati</div>
      <div class="stat-card-value" style="color:var(--priority-low);">${completed}</div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// CALENDARIO (vista mensile)
// ─────────────────────────────────────────────

function renderCalendar() {
  const cursor = AppState.calCursor;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const months = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

  const orders = TCFactory.getActiveOrders();
  const byDay = {};
  orders.forEach(o => {
    (byDay[o.dataOrdine] = byDay[o.dataOrdine] || []).push(o);
  });

  const firstDay = new Date(y, m, 1);
  let startDow = firstDay.getDay(); if (startDow === 0) startDow = 7;
  const startOffset = startDow - 1;
  const lastDate = new Date(y, m + 1, 0).getDate();
  const prevLastDate = new Date(y, m, 0).getDate();

  const todayStr = new Date().toISOString().slice(0, 10);
  const cells = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    cells.push({ day: prevLastDate - i, inMonth: false, dateStr: null });
  }
  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, inMonth: true, dateStr });
  }
  const remaining = (7 - (cells.length % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    cells.push({ day: d, inMonth: false, dateStr: null });
  }

  const weekdays = ['Lun','Mar','Mer','Gio','Ven','Sab','Dom'];

  document.getElementById('calendar-root').innerHTML = `
    <div class="glass-card cal-card">
      <div class="cal-header">
        <span class="cal-title">${months[m]} ${y}</span>
        <div class="cal-nav">
          <button class="btn btn-ghost btn-sm" onclick="calGoToday()">Oggi</button>
          <button class="btn-icon" onclick="calNav(-1)">${Icons.chevronLeft()}</button>
          <button class="btn-icon" onclick="calNav(1)">${Icons.chevronRight()}</button>
        </div>
      </div>
      <div class="cal-weekdays">${weekdays.map(w => `<div>${w}</div>`).join('')}</div>
      <div class="cal-grid">
        ${cells.map(c => {
          if (!c.inMonth) return `<div class="cal-day other-month"><div class="cal-day-top"><span class="cal-day-num">${c.day}</span></div></div>`;
          const dayOrders = byDay[c.dateStr] || [];
          const isToday = c.dateStr === todayStr;
          const visible = dayOrders.slice(0, 2);
          const overflow = dayOrders.length - visible.length;
          return `
            <div class="cal-day ${isToday ? 'today' : ''}" onclick="handleDayClick('${c.dateStr}')">
              <div class="cal-day-top">
                <span class="cal-day-num">${c.day}</span>
                ${dayOrders.length > 0 ? `<span class="cal-day-count">${dayOrders.length}</span>` : ''}
              </div>
              <div class="cal-day-orders">
                ${visible.map(o => {
                  const p = TCFactory.getPriority(o.priorityId);
                  const color = p?.color || '#64748b';
                  return `<div class="cal-order-chip" style="background:color-mix(in srgb, ${color} 18%, transparent);color:${color};" onclick="event.stopPropagation(); openOrderDetail('${o.id}')">${escapeHtml(o.nome)}</div>`;
                }).join('')}
                ${overflow > 0 ? `<div class="cal-day-overflow">+${overflow} altri</div>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function calNav(delta) {
  AppState.calCursor.setMonth(AppState.calCursor.getMonth() + delta);
  renderCalendar();
}
function calGoToday() {
  AppState.calCursor = new Date();
  renderCalendar();
}

function handleDayClick(dateStr) {
  const dayOrders = TCFactory.getActiveOrders().filter(o => o.dataOrdine === dateStr);
  if (dayOrders.length === 0) {
    openOrderForm(null, dateStr);
  } else {
    AppState.dayOpen = { date: dateStr, orders: dayOrders };
    renderDayDialog();
  }
}

// ─────────────────────────────────────────────
// LISTA ORDINI
// ─────────────────────────────────────────────

function setView(v) { AppState.view = v; renderOrderList(); }
function setSortKey(v) { AppState.sortKey = v; renderOrderList(); }
function setSearchQuery(v) { AppState.searchQuery = v; renderOrderList(); }

function renderOrderList() {
  const active = TCFactory.getActiveOrders();
  const archived = TCFactory.getArchivedOrders();
  const source = AppState.view === 'active' ? active : archived;

  const q = AppState.searchQuery.trim().toLowerCase();
  let filtered = source;
  if (q) {
    filtered = source.filter(o =>
      o.nome.toLowerCase().includes(q) || o.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  const sorted = [...filtered].sort((a, b) => {
    switch (AppState.sortKey) {
      case 'nome': return a.nome.localeCompare(b.nome);
      case 'data': return a.dataOrdine.localeCompare(b.dataOrdine);
      case 'priorita': return TCFactory.getPriorityRank(a.priorityId) - TCFactory.getPriorityRank(b.priorityId);
      case 'dataCompletato': {
        const da = TCFactory.stageProgress(a).lastDate;
        const db = TCFactory.stageProgress(b).lastDate;
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      default: return 0;
    }
  });

  document.getElementById('orderlist-root').innerHTML = `
    <div class="glass-card">
      <div class="list-card-header">
        <div class="list-title-group">
          <div class="list-title">
            <h2>Ordini</h2>
            <p>${filtered.length} di ${source.length}</p>
          </div>
          <div class="view-tabs">
            <button class="view-tab ${AppState.view === 'active' ? 'active' : ''}" onclick="setView('active')">Attivi · ${active.length}</button>
            <button class="view-tab ${AppState.view === 'archived' ? 'active' : ''}" onclick="setView('archived')">${Icons.archive(12)} Archivio · ${archived.length}</button>
          </div>
        </div>
        <div class="list-controls">
          <div class="search-box">
            ${Icons.search()}
            <input type="text" placeholder="Cerca per nome o tag…" value="${escapeHtml(AppState.searchQuery)}" oninput="setSearchQuery(this.value)">
          </div>
          <select class="form-select" style="width:auto;" onchange="setSortKey(this.value)">
            <option value="data" ${AppState.sortKey==='data'?'selected':''}>Data ordine</option>
            <option value="nome" ${AppState.sortKey==='nome'?'selected':''}>Nome</option>
            <option value="priorita" ${AppState.sortKey==='priorita'?'selected':''}>Priorità</option>
            <option value="dataCompletato" ${AppState.sortKey==='dataCompletato'?'selected':''}>Data completato</option>
          </select>
        </div>
      </div>
      <div class="order-rows">
        ${sorted.length === 0
          ? `<div class="empty-list">${q ? 'Nessun risultato.' : (AppState.view === 'archived' ? 'Nessun ordine archiviato.' : 'Nessun ordine. Premi "Nuovo ordine" per aggiungerne uno.')}</div>`
          : sorted.map(o => renderOrderRow(o)).join('')}
      </div>
    </div>
  `;
}

function renderOrderRow(o) {
  const p = TCFactory.getPriority(o.priorityId);
  const color = p?.color || '#64748b';
  const { done, total, allDone, lastDate } = TCFactory.stageProgress(o);
  const pct = (done / total) * 100;

  return `
    <button class="order-row-item" onclick="openOrderDetail('${o.id}')">
      <div class="order-row-bar" style="background:${color};"></div>
      <div class="order-row-body">
        <div class="order-row-title">
          <span class="truncate">${escapeHtml(o.nome)}</span>
          ${allDone ? Icons.checkCircle('var(--priority-low)') : ''}
          ${o.files?.length > 0 ? `<span style="display:inline-flex;align-items:center;gap:2px;font-size:0.72rem;color:var(--text-muted);">${Icons.paperclip(12)} ${o.files.length}</span>` : ''}
        </div>
        <div class="order-row-meta">
          <span>${TCFactory.formatDate(o.dataOrdine)}</span>
          ${allDone && lastDate ? `<span style="color:var(--priority-low);">Completato ${TCFactory.formatDate(lastDate)}</span>` : ''}
          ${o.tags.slice(0, 3).map(t => renderTagChip(t)).join('')}
          ${o.tags.length > 3 ? `<span>+${o.tags.length - 3}</span>` : ''}
        </div>
        <div class="order-row-progress">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
          <span class="progress-label">${done}/${total}</span>
        </div>
      </div>
      ${renderPriorityChip(p)}
    </button>
  `;
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
            <label class="form-label">Priorità</label>
            <div class="chip-picker" id="of-priority-picker">
              ${priorities.map(p => {
                const active = (order ? order.priorityId : priorities[0]?.id) === p.id;
                return `<button type="button" class="chip chip-btn" data-prio="${p.id}"
                  style="background:${active ? p.color : `color-mix(in srgb, ${p.color} 12%, transparent)`};color:${active ? '#fff' : p.color};"
                  onclick="selectFormPriority('${p.id}')">${escapeHtml(p.label)}</button>`;
              }).join('')}
            </div>
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
            <input type="file" id="of-file-input" multiple style="display:none;" onchange="handleFormFiles(event)">
            <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('of-file-input').click()">${Icons.paperclip(14)} Carica file</button>
            <p>Max 2MB per file</p>
          </div>
          <div id="of-files-list" style="display:flex;flex-direction:column;gap:6px;margin-top:8px;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('order-form-modal')">Annulla</button>
        <button class="btn btn-primary" onclick="submitOrderForm()">${isEdit ? 'Salva modifiche' : 'Crea ordine'}</button>
      </div>
    </div>
  `;

  if (!isEdit) {
    document.getElementById('of-priority-picker').dataset.selected = priorities[0]?.id || '';
  } else {
    document.getElementById('of-priority-picker').dataset.selected = order.priorityId;
  }

  renderFormFilesList();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('order-form-modal'); };
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

async function handleFormFiles(event) {
  const list = event.target.files;
  if (!list) return;
  for (const f of Array.from(list)) {
    if (f.size > TCFactory.MAX_FILE_BYTES) {
      showToast(`${f.name} supera 2MB`, 'error');
      continue;
    }
    try {
      const uploaded = await TCFactory.uploadFile(f);
      AppState.formFiles.push(uploaded);
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
  const priorityId = document.getElementById('of-priority-picker').dataset.selected;

  if (!nome) { showToast('Inserisci un nome', 'error'); return; }
  if (!dataOrdine) { showToast('Inserisci una data', 'error'); return; }

  const payload = { nome, dataOrdine, priorityId, tags: AppState.formTags, files: AppState.formFiles };

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
  const { done, total, allDone } = TCFactory.stageProgress(order);
  const pct = (done / total) * 100;

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
            ${order.files.map(f => `
              <div class="file-row">
                ${Icons.fileText(15)}
                <span class="truncate" style="font-size:0.78rem;">${escapeHtml(f.name)}</span>
                <a href="${f.url}" target="_blank" download="${escapeHtml(f.name)}" style="color:var(--brand-gold-dark);display:flex;">${Icons.download(15)}</a>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        <div class="progress-box">
          <div style="display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:0.88rem;">
            <span>Avanzamento</span>
            <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;">${done}/${total}</span>
          </div>
          <div class="progress-track" style="margin-top:8px;"><div class="progress-fill" style="width:${pct}%;"></div></div>
          <div class="stage-list">
            ${STAGE_DEFS.map(s => {
              const state = order.stages[s.id];
              return `
                <label class="stage-item">
                  <input type="checkbox" class="stage-checkbox" ${state?.done ? 'checked' : ''} onchange="toggleStage('${order.id}','${s.id}', this.checked)">
                  <span class="stage-label ${state?.done ? 'done' : ''}">
                    <span>${s.label}</span>
                    ${state?.done && state.date ? `<span class="stage-date">${TCFactory.formatDate(state.date)}</span>` : ''}
                  </span>
                </label>
              `;
            }).join('')}
          </div>
        </div>

        ${allDone && !order.archived ? `
        <div class="completed-banner">
          <div class="completed-banner-text">${Icons.checkCircle('var(--priority-low)', 18)} Ordine completato</div>
          <button class="btn btn-primary btn-sm" onclick="archiveOrder('${order.id}')">${Icons.archive(14)} Archivia</button>
        </div>` : ''}

        ${order.archived ? `
        <button class="btn btn-secondary" style="width:100%;justify-content:center;" onclick="restoreOrder('${order.id}')">${Icons.archiveRestore(14)} Ripristina dall'archivio</button>
        ` : ''}
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

async function toggleStage(orderId, stageId, done) {
  try {
    const updated = await TCFactory.setStage(orderId, stageId, done);
    AppState.selectedOrder = updated;
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

async function restoreOrder(id) {
  try {
    await TCFactory.setArchived(id, false);
    showToast('Ordine ripristinato');
    AppState.selectedOrder = TCFactory.getOrderById(id);
    renderOrderDetail();
    renderApp();
  } catch (e) { showToast('Errore', 'error'); }
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

  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2>Impostazioni</h2>
        <button class="btn-icon" onclick="closeModal('settings-modal')">${Icons.x()}</button>
      </div>
      <div class="modal-body">

        <div class="settings-section-block">
          <div class="settings-section-head">${Icons.flag(15)} Priorità</div>
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
        </div>

        <div class="settings-section-block">
          <div class="settings-section-head">${Icons.tag(15)} Tag</div>
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
        </div>

      </div>
    </div>
  `;
  modal.onclick = (e) => { if (e.target === modal) closeModal('settings-modal'); };
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
  archiveRestore: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><path d="M10 12h4"/></svg>`,
  paperclip: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  fileText: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  download: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  trash: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  pencil: (s=14) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`,
  chevronLeft: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="15 18 9 12 15 6"/></svg>`,
  chevronRight: (s=16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><polyline points="9 18 15 12 9 6"/></svg>`,
  arrowUp: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arrowDown: (s=13) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  flag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
  tag: (s=15) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${s}" height="${s}"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
};

window.AppState = AppState;
window.Theme = Theme;
window.showToast = showToast;
window.renderApp = renderApp;
