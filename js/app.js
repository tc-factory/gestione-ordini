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
  formInvoiceFiles: [],
  formTags: [],
  formModuleRows: [],
  formModuleAcconto: '',
  formModuleOpen: false,
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
            <div class="orc-files orc-hdr">Ordine</div>
            <div class="orc-payment orc-hdr">Pagamento</div>
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
    deadlineBadge = diff < 0 ? `scad. ${Math.abs(diff)}gg` : diff === 0 ? 'oggi' : `${diff}gg`;
  }

  // Lavorazione pills + data Stampato automatica
  const lavPills = LAVORAZIONE_DEFS.map(s => {
    const done = o.stages?.[s.id]?.done;
    return `<button class="stage-pill ${done?'done':''}"
      onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
      title="${s.label}">${s.shortLabel}</button>`;
  }).join('');
  const stampatoStage = o.stages?.ordineStampato;
  const stampatoDate  = stampatoStage?.done && stampatoStage?.date
    ? `<div style="font-size:0.62rem;color:#22c55e;margin-top:3px;">📅 ${TCFactory.formatDate(stampatoStage.date,{day:'2-digit',month:'2-digit'})}</div>` : '';

  // Evasione pills + archivio inline
  const evaPills = EVASIONE_DEFS.map(s => {
    const done = o.stages?.[s.id]?.done;
    return `<button class="stage-pill evasione ${done?'done':''}"
      onclick="event.stopPropagation();toggleStageInline('${o.id}','${s.id}',${!done})"
      title="${s.label}">${s.shortLabel}</button>`;
  }).join('');

  // Tag
  const tagPills = o.tags.slice(0, 3).map(t => {
    const c      = TCFactory.getTagColor(t);
    const active = AppState.filterTags.includes(t);
    return `<button class="chip chip-btn" onclick="event.stopPropagation();toggleTagFilter('${escapeHtml(t)}')"
      style="background:${active ? c : `color-mix(in srgb, ${c} 14%, transparent)`};color:${active ? '#fff' : c};padding:2px 6px;cursor:pointer;font-size:0.68rem;">
      <span class="chip-dot" style="background:${active ? '#fff' : c};"></span>${escapeHtml(t)}
    </button>`;
  }).join('');

  // Allegati ordine
  const filesBtns = (o.files || []).slice(0, 2).map((f, i) => {
    const icon = f.type?.startsWith('image/') ? '🖼' : f.type === 'application/pdf' ? '📄' : '📎';
    return `<button class="file-quick-btn" onclick="event.stopPropagation();quickPreviewFile('${o.id}',${i})" title="${escapeHtml(f.name)}">${icon}</button>`;
  }).join('');
  const filesExtra = (o.files||[]).length > 2
    ? `<span style="font-size:0.65rem;color:var(--text-muted);">+${(o.files||[]).length - 2}</span>` : '';

  // Pagamento
  const payDone    = o.paymentDone || false;
  const payDate    = o.paymentDate;
  const invFile    = (o.invoiceFiles || [])[0];

  return `
    <div class="order-row-item" role="button" tabindex="0"
      onclick="openOrderDetail('${o.id}')"
      onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
      <div class="order-row-bar" style="background:${color};"></div>
      <div class="order-row-grid">
        <div class="orc-name">${escapeHtml(o.nome)}</div>
        <div class="orc-date">${TCFactory.formatDate(o.dataOrdine,{day:'2-digit',month:'2-digit',year:'2-digit'})}</div>
        <div class="orc-tags">${tagPills}</div>
        <div class="orc-lav" style="flex-direction:column;align-items:flex-start;">
          <div style="display:flex;gap:3px;">${lavPills}</div>
          ${stampatoDate}
        </div>
        <div class="orc-eva" style="flex-wrap:nowrap;gap:4px;align-items:center;">
          ${evaPills}
          <button class="stage-pill"
            onclick="event.stopPropagation();quickToggleArchive('${o.id}',${o.archived})"
            title="${o.archived ? 'Ripristina agli attivi' : 'Archivia'}"
            style="opacity:0.55;padding:2px 5px;font-size:0.82rem;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.55'">
            📁
          </button>
        </div>
        <div class="orc-deadline" style="color:${deadlineColor};font-size:0.75rem;font-weight:${o.deadline?'700':'400'};">${deadlineBadge}</div>
        <div class="orc-priority">${renderPriorityChip(p)}</div>
        <div class="orc-files">${filesBtns}${filesExtra}</div>
        <div class="orc-payment" style="flex-direction:column;align-items:center;gap:3px;">
          ${invFile ? `<button class="file-quick-btn" onclick="event.stopPropagation();quickPreviewInvoice('${o.id}')" title="Apri fattura">🧾</button>` : ''}
          <button class="stage-pill ${payDone?'done':''}"
            onclick="event.stopPropagation();togglePayment('${o.id}',${!payDone})"
            style="font-size:0.62rem;white-space:nowrap;">
            ${payDone ? '✓ Pagato' : 'Pagamento'}
          </button>
          ${payDone && payDate ? `<span style="font-size:0.6rem;color:#22c55e;">${TCFactory.formatDate(payDate,{day:'2-digit',month:'2-digit'})}</span>` : ''}
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

function quickPreviewInvoice(orderId) {
  const order = TCFactory.getOrderById(orderId);
  if (!order || !(order.invoiceFiles||[])[0]) return;
  previewFile(order.invoiceFiles[0]);
}

async function togglePayment(orderId, done) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    await TCFactory.updateOrder(orderId, { paymentDone: done, paymentDate: done ? today : null });
    renderApp();
  } catch(e) { showToast('Errore pagamento', 'error'); }
}

function downloadOrderModule(orderId) {
  const order   = orderId ? TCFactory.getOrderById(orderId) : null;
  const nome    = order?.nome || document.getElementById('of-nome')?.value || 'Ordine';
  const rows    = order?.orderModule?.rows || AppState.formModuleRows || [];
  const acconto = parseFloat(order?.orderModule?.acconto || AppState.formModuleAcconto || 0);
  const total   = rows.reduce((s,r) => s + (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0), 0);
  const saldo   = total - acconto;
  const priId   = order?.priorityId || document.getElementById('of-priority-picker')?.dataset?.selected || '';
  const pri     = TCFactory.getPriority(priId);
  const isUrgent = pri?.id === 'urgente';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Modulo ordine - ${nome}</title>
<style>
  body{font-family:Arial,sans-serif;margin:30px;color:#1e293b}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}
  h2{color:#1e40af;margin:0 0 4px}
  .sub{font-size:13px;color:#64748b}
  .urgente{display:inline-block;background:#fee2e2;color:#dc2626;border:2px solid #dc2626;border-radius:6px;padding:4px 14px;font-weight:800;font-size:14px;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}
  thead th{background:#1e40af;color:#fff;padding:9px 10px;text-align:left;font-weight:800;font-size:11px;text-transform:uppercase;letter-spacing:.07em;border-right:1px solid #2d55c4}
  thead th:last-child{border-right:none}
  tbody td{padding:7px 10px;border-bottom:1px solid #e2e8f0}
  tbody tr:nth-child(odd)  td{background:#fff}
  tbody tr:nth-child(even) td{background:#f0f7ff}
  .tot-section{margin-top:24px;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
  .tot-row{display:flex;gap:40px;font-size:14px}
  .tot-label{color:#64748b}
  .tot-value{font-weight:700;min-width:90px;text-align:right}
  .tot-big{font-size:16px;color:#1e40af}
  @media print{body{margin:15px}}
</style></head><body>
<div class="header">
  <div><h2>T&amp;C Factory Creative Lab</h2>
  <div class="sub"><strong>Ordine:</strong> ${nome} &nbsp;·&nbsp; <strong>Data:</strong> ${new Date().toLocaleDateString('it-IT')}</div></div>
  ${isUrgent ? `<div class="urgente">⚠️ URGENTE</div>` : ''}
</div>
<table>
  <thead><tr><th>Catalogo</th><th>Codice</th><th>Colore</th><th>QNT</th><th>TG</th><th>Prezzo</th><th>Totale</th><th>Ordinato</th></tr></thead>
  <tbody>
    ${rows.length ? rows.map(r => {
      const t = (parseFloat(r.qnt)||0)*(parseFloat(r.prezzo)||0);
      return `<tr><td>${r.catalogo||''}</td><td>${r.codice||''}</td><td>${r.colore||''}</td><td>${r.qnt||''}</td><td>${r.tg||''}</td><td>${r.prezzo ? '€ '+parseFloat(r.prezzo).toFixed(2) : ''}</td><td>${t>0 ? '€ '+t.toFixed(2) : ''}</td><td style="text-align:center;font-size:16px">${r.ordinato?'✓':''}</td></tr>`;
    }).join('') : '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:20px">Nessuna riga</td></tr>'}
  </tbody>
</table>
<div class="tot-section">
  <div class="tot-row"><span class="tot-label">Totale ordine</span><span class="tot-value tot-big">€ ${total.toFixed(2)}</span></div>
  <div class="tot-row"><span class="tot-label">Acconto</span><span class="tot-value">€ ${acconto.toFixed(2)}</span></div>
  <div class="tot-row"><span class="tot-label">Saldo</span><span class="tot-value tot-big" style="color:#dc2626">€ ${saldo.toFixed(2)}</span></div>
</div>
<script>window.onload=()=>window.print()</script>
</body></html>`;
  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
  else showToast('Abilita i popup per scaricare il modulo', 'error');
}


