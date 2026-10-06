/**
 * T&C Factory — Cassa
 * Movimenti da riscuotere e riscossi (un movimento = un ordine con importo),
 * filtrabili e collegati ai clienti.
 */

const CassaState = {
  stato: 'tutti',      // 'tutti' | 'da-riscuotere' | 'riscossi'
  clientId: '',        // '' = tutti, '__none__' = senza cliente
  periodo: 'tutto',    // 'tutto' | 'mese' | 'mese-scorso' | 'anno' | 'custom'
  from: '',
  to: '',
  search: '',
  soloEvasi: false,
};

// Data del movimento: incasso per i riscossi, data ordine per quelli da riscuotere
function movementDate(o) {
  return o.paymentDone ? (o.paymentDate || o.dataOrdine) : o.dataOrdine;
}

function cassaPeriodRange() {
  const now = new Date();
  const iso = (d) => localISODate(d);
  switch (CassaState.periodo) {
    case 'mese':        return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
    case 'mese-scorso': return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
    case 'anno':        return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
    case 'custom':      return [CassaState.from || '0000-01-01', CassaState.to || '9999-12-31'];
    default:            return ['0000-01-01', '9999-12-31'];
  }
}

function getCassaMovements() {
  const [from, to] = cassaPeriodRange();
  const q = CassaState.search.trim().toLowerCase();

  return TCFactory.getOrders()
    .filter(o => !o.deletedAt && (o.importo || 0) > 0)
    .filter(o => CassaState.stato === 'tutti' || (CassaState.stato === 'riscossi' ? o.paymentDone : !o.paymentDone))
    .filter(o => !CassaState.soloEvasi || o.paymentDone || o.stages?.spedito?.done)
    .filter(o => !CassaState.clientId || (CassaState.clientId === '__none__' ? !o.clientId : o.clientId === CassaState.clientId))
    .filter(o => { const d = movementDate(o) || ''; return d >= from && d <= to; })
    .filter(o => {
      if (!q) return true;
      const c = TCFactory.getClient(o.clientId);
      return o.nome.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || (c && TCFactory.clientName(c).toLowerCase().includes(q));
    })
    .sort((a, b) => (movementDate(b) || '').localeCompare(movementDate(a) || ''));
}

function setCassa(key, value) {
  CassaState[key] = value;
  renderCassaPage();
}

function setCassaSearch(v) {
  CassaState.search = v;
  renderCassaPage();
  const el = document.getElementById('cassa-search');
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
}

function resetCassaFilters() {
  Object.assign(CassaState, { stato: 'tutti', clientId: '', periodo: 'tutto', from: '', to: '', search: '', soloEvasi: false });
  renderCassaPage();
}

function renderCassaPage() {
  const root = document.getElementById('economic-root');
  if (!root) return;
  if (!TCAuth.canViewEconomics()) { root.innerHTML = ''; return; }

  const moves = getCassaMovements();
  const daRisc   = moves.filter(o => !o.paymentDone);
  const riscossi = moves.filter(o => o.paymentDone);
  const sum = (list) => list.reduce((s, o) => s + (o.importo || 0), 0);
  const hasClients = TCFactory.isClientsAvailable();
  const filtersActive = CassaState.stato !== 'tutti' || CassaState.clientId || CassaState.periodo !== 'tutto' || CassaState.search || CassaState.soloEvasi;

  root.innerHTML = `
    <div class="cassa-grid">
      <button type="button" class="glass-card stat-card stat-card-btn ${CassaState.stato === 'da-riscuotere' ? 'selected' : ''}" onclick="setCassa('stato', CassaState.stato === 'da-riscuotere' ? 'tutti' : 'da-riscuotere')" aria-pressed="${CassaState.stato === 'da-riscuotere'}">
        <div class="stat-card-glow" style="background:#ef4444;"></div>
        <div class="stat-card-label" style="color:#ef4444;">Da riscuotere</div>
        <div class="stat-card-value" style="color:#ef4444;font-size:1.5rem;">${euro(sum(daRisc))}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${daRisc.length} ${daRisc.length === 1 ? 'movimento' : 'movimenti'}</div>
      </button>
      <button type="button" class="glass-card stat-card stat-card-btn ${CassaState.stato === 'riscossi' ? 'selected' : ''}" onclick="setCassa('stato', CassaState.stato === 'riscossi' ? 'tutti' : 'riscossi')" aria-pressed="${CassaState.stato === 'riscossi'}">
        <div class="stat-card-glow" style="background:#22c55e;"></div>
        <div class="stat-card-label" style="color:#16a34a;">Riscosso</div>
        <div class="stat-card-value" style="color:#16a34a;font-size:1.5rem;">${euro(sum(riscossi))}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${riscossi.length} ${riscossi.length === 1 ? 'movimento' : 'movimenti'}</div>
      </button>
    </div>

    <div class="glass-card page-card">
      <div class="table-toolbar cassa-filters">
        <div class="segmented" role="tablist" aria-label="Stato pagamento">
          ${[['tutti','Tutti'],['da-riscuotere','Da riscuotere'],['riscossi','Riscossi']].map(([id, l]) =>
            `<button role="tab" aria-selected="${CassaState.stato===id}" class="${CassaState.stato===id?'active':''}" onclick="setCassa('stato','${id}')">${l}</button>`).join('')}
        </div>

        ${hasClients ? `
        <select class="form-select filter-select" aria-label="Cliente" onchange="setCassa('clientId', this.value)">
          <option value="">Tutti i clienti</option>
          <option value="__none__" ${CassaState.clientId === '__none__' ? 'selected' : ''}>Senza cliente</option>
          ${TCFactory.getClients().map(c => `<option value="${c.id}" ${CassaState.clientId === c.id ? 'selected' : ''}>${escapeHtml(TCFactory.clientName(c))}</option>`).join('')}
        </select>` : ''}

        <select class="form-select filter-select" aria-label="Periodo" onchange="setCassa('periodo', this.value)">
          ${[['tutto','Tutto il periodo'],['mese','Questo mese'],['mese-scorso','Mese scorso'],['anno','Quest\'anno'],['custom','Date personalizzate…']].map(([id, l]) =>
            `<option value="${id}" ${CassaState.periodo === id ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        ${CassaState.periodo === 'custom' ? `
          <input type="date" class="form-input filter-date" aria-label="Dal" value="${CassaState.from}" onchange="setCassa('from', this.value)">
          <input type="date" class="form-input filter-date" aria-label="Al" value="${CassaState.to}" onchange="setCassa('to', this.value)">` : ''}

        <label class="check-inline" title="Da riscuotere: mostra solo gli ordini già evasi">
          <input type="checkbox" ${CassaState.soloEvasi ? 'checked' : ''} onchange="setCassa('soloEvasi', this.checked)"> Solo evasi
        </label>

        <div class="search-box">
          ${Icons.search()}
          <input id="cassa-search" type="text" placeholder="Cerca ordine o cliente…" value="${escapeHtml(CassaState.search)}" oninput="setCassaSearch(this.value)">
        </div>

        <div class="toolbar-end">
          ${filtersActive ? `<button class="btn btn-ghost btn-sm" onclick="resetCassaFilters()">Azzera filtri</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="exportCassaCSV()" ${moves.length ? '' : 'disabled'}>Esporta CSV</button>
        </div>
      </div>

      ${moves.length === 0 ? `<div class="empty-list">Nessun movimento${filtersActive ? ' con questi filtri' : ''}.</div>` : `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Data</th>${hasClients ? '<th>Cliente</th>' : ''}<th>Ordine</th><th class="hide-sm">Stato ordine</th>
            <th class="num">Importo</th><th>Pagamento</th>
          </tr></thead>
          <tbody>
            ${moves.map(o => {
              const c  = TCFactory.getClient(o.clientId);
              const st = orderStatus(o);
              return `<tr class="data-row" tabindex="0" onclick="openOrderDetail('${o.id}')" onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
                <td>${TCFactory.formatDate(movementDate(o), { day: '2-digit', month: '2-digit', year: '2-digit' })}</td>
                ${hasClients ? `<td>${c
                  ? `<a href="#/clienti/${c.id}" onclick="event.stopPropagation()" class="client-link">${escapeHtml(TCFactory.clientName(c))}</a>`
                  : `<span style="color:var(--text-muted);">—</span>`}</td>` : ''}
                <td><strong>${escapeHtml(o.nome)}</strong><small class="muted-id">${o.id}</small></td>
                <td class="hide-sm"><span class="status-dot" style="--st:${st.color};">${st.label}</span></td>
                <td class="num" style="font-weight:700;">${euro(o.importo)}</td>
                <td>
                  <button type="button" class="pay-badge ${o.paymentDone ? 'paid' : 'due'}" onclick="event.stopPropagation();cassaTogglePayment('${o.id}', ${!o.paymentDone})"
                    title="${o.paymentDone ? 'Segna come da riscuotere' : 'Segna come riscosso oggi'}">
                    ${o.paymentDone ? `✓ Riscosso${o.paymentDate ? ' ' + TCFactory.formatDate(o.paymentDate, { day: '2-digit', month: '2-digit' }) : ''}` : 'Da riscuotere'}
                  </button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot><tr>
            <td colspan="${hasClients ? 4 : 3}" class="hide-sm-colspan">Totale (${moves.length})</td>
            <td class="num">${euro(sum(moves))}</td><td></td>
          </tr></tfoot>
        </table>
      </div>`}
    </div>`;
}

async function cassaTogglePayment(orderId, done) {
  const o = TCFactory.getOrderById(orderId);
  const msg = done
    ? `Segnare "${o?.nome}" come riscosso oggi (${euro(o?.importo)})?`
    : `Riportare "${o?.nome}" tra i da riscuotere?`;
  if (!confirm(msg)) return;
  await togglePayment(orderId, done);
  showToast(done ? 'Segnato come riscosso' : 'Riportato tra i da riscuotere');
}

function exportCassaCSV() {
  const moves = getCassaMovements();
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Data', 'Cliente', 'Ordine', 'Codice', 'Stato ordine', 'Importo', 'Pagamento', 'Data incasso'].map(cell).join(';'),
    ...moves.map(o => [
      movementDate(o),
      TCFactory.clientName(TCFactory.getClient(o.clientId)),
      o.nome, o.id, orderStatus(o).label,
      (o.importo || 0).toFixed(2).replace('.', ','),
      o.paymentDone ? 'Riscosso' : 'Da riscuotere',
      o.paymentDate || '',
    ].map(cell).join(';')),
  ];
  // BOM iniziale: Excel apre correttamente accenti e simbolo €
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cassa-${localISODate(new Date())}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
