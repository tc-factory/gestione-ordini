/**
 * T&C Factory — DTF
 * INTERNO: timeline degli ordini a lavorazione interna ancora senza DTF, in ordine di
 *   scadenza e riordinabile a mano. "Stampato" spunta la fase DTF dell'ordine; la × lo
 *   toglie dalla lista. Stampati e rimossi si ripristinano dalla colonna laterale.
 * CONTO TERZI: clienti DTF dedicati con costo al metro, calendario mensile con un giorno
 *   per riga (metri + nomi dei file stampati), totale del mese. Salvataggio automatico.
 */

const DTF_SETTINGS_KEY = 'dtf_interno';        // { order: [id…], removed: [id…] } condiviso
const DTF_CLIENT_KEY   = 'tcf_dtf_client';     // cliente conto terzi selezionato (per browser)
const DTF_SIDE_KEY     = 'tcf_dtf_side_open';
const DTF_SAVE_DELAY   = 700;
const DTF_STAMPATI_DAYS = 30;                  // nella colonna "Stampati" gli ultimi 30 giorni

const DtfState = {
  clients: [],
  entries: {},          // 'YYYY-MM-DD' → { metri, dettaglio }
  clientId: null,
  month: null,          // Date al primo del mese visualizzato
  loaded: false,
  error: null,
  sideOpen: false,
  saveTimers: {},
  saving: 0,
  lastSaved: null,
  detailDate: null,
  channel: null,
  dragId: null,
};

const dtfLs = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ═══════════════════════════════════════════════
// INTERNO
// ═══════════════════════════════════════════════

function dtfSettings() {
  const v = TCFactory._settings[DTF_SETTINGS_KEY];
  return { order: Array.isArray(v?.order) ? v.order : [], removed: Array.isArray(v?.removed) ? v.removed : [] };
}

async function dtfSaveSettings(patch) {
  const next = { ...dtfSettings(), ...patch };
  TCFactory._settings[DTF_SETTINGS_KEY] = next;
  await TCFactory.setSetting(DTF_SETTINGS_KEY, next);
}

const dtfDone = (o) => !!o.stages?.dtfPronti?.done;

function dtfLists() {
  const { order, removed } = dtfSettings();
  const removedSet = new Set(removed);
  const internal = TCFactory.getOrders().filter(o => !o.deletedAt && !o.lavorazioneEsterna);
  const deadline = (o) => TCFactory.getEffectiveDeadline(o)?.date || '9999-12-31';

  // Da stampare: ordini attivi interni, DTF non ancora fatto, non rimossi
  const rank = (o) => { const i = order.indexOf(o.id); return i < 0 ? Infinity : i; };
  const todo = internal
    .filter(o => !o.archived && !dtfDone(o) && !removedSet.has(o.id))
    .sort((a, b) => rank(a) - rank(b) || deadline(a).localeCompare(deadline(b)));

  const limit = localISODate(new Date(Date.now() - DTF_STAMPATI_DAYS * 86400000));
  const printed = internal
    .filter(o => dtfDone(o) && (o.stages.dtfPronti.date || '') >= limit)
    .sort((a, b) => (b.stages.dtfPronti.date || '').localeCompare(a.stages.dtfPronti.date || ''));
  const removedList = internal.filter(o => removedSet.has(o.id) && !dtfDone(o));
  return { todo, printed, removedList };
}

function renderDtfInterno() {
  const root = document.getElementById('dtf-interno-root');
  if (!root) return;
  const { todo, printed, removedList } = dtfLists();
  const today = localISODate(new Date());
  const fmt = (d) => TCFactory.formatDate(d, { day: '2-digit', month: '2-digit' });

  const card = (o, i) => {
    const dl = TCFactory.getEffectiveDeadline(o);
    const client = TCFactory.getClient(o.clientId);
    const late = dl && dl.date < today;
    return `
      <li class="dtf-item ${isUrgentOrder(o) ? 'dtf-urgent' : ''}" draggable="true" data-id="${o.id}"
          ondragstart="dtfDragStart(event,'${o.id}')" ondragend="dtfDragEnd()" ondragover="dtfDragOver(event)" ondrop="dtfDrop(event)">
        <span class="dtf-pos" aria-hidden="true">${i + 1}</span>
        <div class="dtf-when ${late ? 'late' : ''}" title="${late ? 'Scadenza passata' : 'Scadenza'}">
          <strong>${dl ? fmt(dl.date) : '—'}</strong>
          <span>${dl ? new Date(dl.date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short' }) : ''}</span>
        </div>
        <button type="button" class="dtf-main" onclick="openOrderDetail('${o.id}')">
          <strong>${escapeHtml(o.nome)}</strong>
          <span>${[client ? escapeHtml(TCFactory.clientName(client)) : '', o.tags.map(escapeHtml).join(', ')].filter(Boolean).join(' · ')}</span>
        </button>
        <button type="button" class="btn btn-sm dtf-done-btn" onclick="dtfMarkPrinted('${o.id}')">${Icons.checkCircle('currentColor', 15)} Stampato</button>
        <button type="button" class="btn-icon dtf-remove" onclick="dtfRemove('${o.id}')" aria-label="Togli ${escapeHtml(o.nome)} dalla lista DTF" title="Non serve il DTF: togli dalla lista">${Icons.x(14)}</button>
      </li>`;
  };

  const sideRow = (o, action, label, meta) => `
    <li class="dtf-side-row">
      <div><strong>${escapeHtml(o.nome)}</strong><span>${meta}</span></div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="${action}('${o.id}')">${label}</button>
    </li>`;

  root.innerHTML = `
    <div class="dtf-box-head">
      <div><h2>Interno</h2><p>${todo.length} ${todo.length === 1 ? 'ordine' : 'ordini'} da stampare · per scadenza, trascina per riordinare</p></div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="dtfToggleSide()" aria-expanded="${DtfState.sideOpen}">
        ${DtfState.sideOpen ? 'Nascondi' : 'Stampati e rimossi'} · ${printed.length + removedList.length}
      </button>
    </div>
    <div class="dtf-interno ${DtfState.sideOpen ? 'side-open' : ''}">
      ${todo.length
        ? `<ol class="dtf-timeline" aria-label="Ordini da stampare">${todo.map(card).join('')}</ol>`
        : `<div class="empty-list">Nessun ordine interno da stampare. 🎉</div>`}
      ${DtfState.sideOpen ? `
        <aside class="dtf-side" aria-label="Stampati e rimossi">
          <h3>Stampati <small>ultimi ${DTF_STAMPATI_DAYS} giorni</small></h3>
          ${printed.length ? `<ul>${printed.map(o => sideRow(o, 'dtfRestorePrinted', 'Ripristina', `stampato ${fmt(o.stages.dtfPronti.date)}`)).join('')}</ul>` : '<p class="dtf-side-empty">Nessuno.</p>'}
          <h3>Rimossi</h3>
          ${removedList.length ? `<ul>${removedList.map(o => sideRow(o, 'dtfRestoreRemoved', 'Ripristina', 'tolto dalla lista')).join('')}</ul>` : '<p class="dtf-side-empty">Nessuno.</p>'}
        </aside>` : ''}
    </div>`;
}

function dtfToggleSide() {
  DtfState.sideOpen = !DtfState.sideOpen;
  dtfLs.set(DTF_SIDE_KEY, DtfState.sideOpen ? '1' : '0');
  renderDtfInterno();
}

async function dtfMarkPrinted(id) {
  const o = TCFactory.getOrderById(id);
  try {
    await TCFactory.setStage(id, 'dtfPronti', true);
    showToast(`"${o?.nome}": DTF stampato ✓`);
    renderDtfInterno(); renderOrderList();
  } catch { showToast('Impossibile segnare come stampato', 'error'); }
}

async function dtfRestorePrinted(id) {
  try {
    await TCFactory.setStage(id, 'dtfPronti', false);
    showToast('Riportato tra gli ordini da stampare');
    renderDtfInterno(); renderOrderList();
  } catch { showToast('Impossibile ripristinare', 'error'); }
}

async function dtfRemove(id) {
  const { removed } = dtfSettings();
  try {
    await dtfSaveSettings({ removed: [...new Set([...removed, id])] });
    showToast('Tolto dalla lista DTF (ripristinabile da "Rimossi")');
    renderDtfInterno();
  } catch { showToast('Impossibile togliere l\'ordine', 'error'); }
}

async function dtfRestoreRemoved(id) {
  const { removed } = dtfSettings();
  try {
    await dtfSaveSettings({ removed: removed.filter(x => x !== id) });
    renderDtfInterno();
  } catch { showToast('Impossibile ripristinare', 'error'); }
}

// ── Riordino a mano della timeline ──

function dtfDragStart(e, id) {
  DtfState.dragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  const el = e.currentTarget;
  requestAnimationFrame(() => el.classList.add('dragging'));
}

function dtfDragEnd() {
  DtfState.dragId = null;
  document.querySelectorAll('.dtf-item.dragging, .dtf-item.drop-before, .dtf-item.drop-after')
    .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
}

function dtfDragOver(e) {
  if (!DtfState.dragId) return;
  e.preventDefault();
  const item = e.currentTarget;
  document.querySelectorAll('.dtf-item.drop-before, .dtf-item.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (item.dataset.id === DtfState.dragId) return;
  const r = item.getBoundingClientRect();
  item.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
}

async function dtfDrop(e) {
  e.preventDefault();
  const id = DtfState.dragId, target = e.currentTarget;
  if (!id || target.dataset.id === id) { dtfDragEnd(); return; }
  const before = target.classList.contains('drop-before');
  dtfDragEnd();

  const ids = [...document.querySelectorAll('.dtf-timeline .dtf-item')].map(el => el.dataset.id).filter(x => x !== id);
  ids.splice(ids.indexOf(target.dataset.id) + (before ? 0 : 1), 0, id);
  try {
    await dtfSaveSettings({ order: ids });
    renderDtfInterno();
  } catch { showToast('Impossibile salvare l\'ordine', 'error'); }
}

// ═══════════════════════════════════════════════
// CONTO TERZI
// ═══════════════════════════════════════════════

const dtfMonthRange = () => {
  const m = DtfState.month;
  return [localISODate(m), localISODate(new Date(m.getFullYear(), m.getMonth() + 1, 0))];
};
const dtfClient = () => DtfState.clients.find(c => c.id === DtfState.clientId) || null;
const dtfNum = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : 0; };
const dtfMetri = (n) => (Number(n) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });

async function dtfLoadClients() {
  const { data, error } = await supabaseClient.from('dtf_clients').select('*').order('nome');
  if (error) throw error;
  DtfState.clients = data || [];
  if (!dtfClient()) DtfState.clientId = DtfState.clients[0]?.id || null;
}

async function dtfLoadEntries() {
  DtfState.entries = {};
  if (!DtfState.clientId) return;
  const [from, to] = dtfMonthRange();
  const { data, error } = await supabaseClient.from('dtf_entries').select('giorno, metri, dettaglio')
    .eq('client_id', DtfState.clientId).gte('giorno', from).lte('giorno', to);
  if (error) throw error;
  (data || []).forEach(r => { DtfState.entries[r.giorno] = { metri: Number(r.metri) || 0, dettaglio: r.dettaglio || '' }; });
}

function dtfSaveStatus() {
  if (DtfState.saving > 0) return '<span class="dtf-save saving">Salvataggio…</span>';
  if (DtfState.lastSaved) return `<span class="dtf-save saved">✓ Salvato alle ${DtfState.lastSaved}</span>`;
  return '<span class="dtf-save">Salvataggio automatico</span>';
}

function dtfUpdateSummary() {
  const el = document.getElementById('dtf-summary');
  if (el) el.innerHTML = dtfSummaryHtml();
  const st = document.getElementById('dtf-save-status');
  if (st) st.innerHTML = dtfSaveStatus();
}

function dtfSummaryHtml() {
  const c = dtfClient();
  const metri = Object.values(DtfState.entries).reduce((s, e) => s + (Number(e.metri) || 0), 0);
  const costo = Number(c?.costo_metro) || 0;
  return `
    <div class="dtf-kpi"><span>Metri del mese</span><strong>${dtfMetri(metri)} m</strong></div>
    <div class="dtf-kpi"><span>Costo al metro</span><strong>${euro(costo)}</strong></div>
    <div class="dtf-kpi dtf-kpi-total"><span>Totale</span><strong>${euro(metri * costo)}</strong></div>`;
}

function renderDtfTerzi() {
  const root = document.getElementById('dtf-terzi-root');
  if (!root) return;

  if (DtfState.error) {
    root.innerHTML = `<div class="dtf-box-head"><div><h2>Conto terzi</h2></div></div>
      <div class="empty-list">Impossibile caricare i dati DTF: ${escapeHtml(DtfState.error)}</div>`;
    return;
  }

  const c = dtfClient();
  const head = `
    <div class="dtf-box-head">
      <div><h2>Conto terzi</h2><p id="dtf-save-status">${dtfSaveStatus()}</p></div>
    </div>
    <div class="dtf-clients">
      <select class="form-select" aria-label="Cliente conto terzi" onchange="dtfSelectClient(this.value)" ${DtfState.clients.length ? '' : 'disabled'}>
        ${DtfState.clients.length
          ? DtfState.clients.map(x => `<option value="${x.id}" ${x.id === DtfState.clientId ? 'selected' : ''}>${escapeHtml(x.nome)} · ${euro(x.costo_metro)}/m</option>`).join('')
          : '<option>Nessun cliente</option>'}
      </select>
      ${c ? `<button type="button" class="btn-icon" onclick="dtfCopyLink('${c.id}')" aria-label="Copia il link per il cliente" title="Copia il link di sola lettura per il cliente">${Icons.link(16)}</button>
      <button type="button" class="btn-icon" onclick="dtfOpenClientForm('${c.id}')" aria-label="Modifica cliente" title="Modifica cliente">${Icons.edit(16)}</button>` : ''}
      <button type="button" class="btn btn-primary btn-icon dtf-add" onclick="dtfOpenClientForm()" aria-label="Aggiungi cliente" title="Aggiungi cliente">${Icons.plus(16)}</button>
    </div>`;

  if (!c) {
    root.innerHTML = head + `<div class="empty-list">Aggiungi un cliente con il pulsante <strong>+</strong> per iniziare.</div>`;
    return;
  }

  const m = DtfState.month;
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = localISODate(new Date());
  const rows = [];
  for (let d = 1; d <= last; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const iso = localISODate(date);
    const e = DtfState.entries[iso] || { metri: 0, dettaglio: '' };
    const files = e.dettaglio.split('\n').map(s => s.trim()).filter(Boolean);
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    rows.push(`
      <div class="dtf-day ${iso === today ? 'today' : ''} ${weekend ? 'weekend' : ''}" data-date="${iso}" ${iso === today ? 'id="dtf-today"' : ''}>
        <div class="dtf-day-date"><strong>${d}</strong><span>${date.toLocaleDateString('it-IT', { weekday: 'short' })}</span></div>
        <label class="dtf-metri">
          <input type="text" inputmode="decimal" class="form-input" value="${e.metri ? dtfMetri(e.metri) : ''}" placeholder="0"
            aria-label="Metri del ${d}" oninput="dtfOnMetri('${iso}', this.value)" onfocus="this.select()">
          <span>m</span>
        </label>
        <button type="button" class="dtf-detail-btn ${files.length ? 'has-files' : ''}" onclick="dtfOpenDetail('${iso}')">
          ${files.length ? `${Icons.paperclip(13)} ${files.length} ${files.length === 1 ? 'file' : 'file'} · <span>${escapeHtml(files[0])}${files.length > 1 ? '…' : ''}</span>` : 'Dettaglio'}
        </button>
      </div>`);
  }

  const monthLabel = m.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  root.innerHTML = head + `
    <div class="dtf-summary" id="dtf-summary">${dtfSummaryHtml()}</div>
    <div class="dtf-month-nav">
      <button class="btn-icon" onclick="dtfMonth(-1)" aria-label="Mese precedente">${Icons.chevronLeft()}</button>
      <strong>${monthLabel}</strong>
      <button class="btn-icon" onclick="dtfMonth(1)" aria-label="Mese successivo">${Icons.chevronRight()}</button>
      <button class="btn btn-secondary btn-sm" onclick="dtfMonth(0)">Oggi</button>
    </div>
    <div class="dtf-calendar" id="dtf-calendar">${rows.join('')}</div>`;
}

function dtfScrollToToday() {
  const cal = document.getElementById('dtf-calendar');
  const row = document.getElementById('dtf-today');
  if (cal && row) cal.scrollTop = row.offsetTop - cal.offsetTop - 8;
}

async function dtfReloadTerzi(scrollToday = false) {
  try {
    await dtfLoadEntries();
    DtfState.error = null;
  } catch (e) { DtfState.error = e.message || 'errore'; }
  renderDtfTerzi();
  if (scrollToday) dtfScrollToToday();
}

function dtfSelectClient(id) {
  DtfState.clientId = id;
  dtfLs.set(DTF_CLIENT_KEY, id);
  dtfReloadTerzi(true);
}

function dtfMonth(delta) {
  const m = DtfState.month;
  DtfState.month = delta === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(m.getFullYear(), m.getMonth() + delta, 1);
  dtfReloadTerzi(delta === 0 || localISODate(DtfState.month).slice(0, 7) === localISODate(new Date()).slice(0, 7));
}

// ── Salvataggio automatico (per giorno, con un breve ritardo mentre si scrive) ──

function dtfQueueSave(date) {
  clearTimeout(DtfState.saveTimers[date]);
  DtfState.saveTimers[date] = setTimeout(() => dtfSaveDay(date), DTF_SAVE_DELAY);
  const st = document.getElementById('dtf-save-status');
  if (st) st.innerHTML = '<span class="dtf-save saving">Modifiche in corso…</span>';
}

async function dtfSaveDay(date) {
  const clientId = DtfState.clientId;
  const e = DtfState.entries[date] || { metri: 0, dettaglio: '' };
  DtfState.saving++;
  dtfUpdateSummary();
  try {
    const { error } = await supabaseClient.from('dtf_entries')
      .upsert({ client_id: clientId, giorno: date, metri: e.metri, dettaglio: e.dettaglio }, { onConflict: 'client_id,giorno' });
    if (error) throw error;
    DtfState.lastSaved = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.error('[dtf]', err);
    showToast(`Salvataggio non riuscito per il ${TCFactory.formatDate(date, { day: 'numeric', month: 'long' })}: riprova`, 'error');
  } finally {
    DtfState.saving--;
    dtfUpdateSummary();
  }
}

function dtfOnMetri(date, value) {
  DtfState.entries[date] = { ...(DtfState.entries[date] || { dettaglio: '' }), metri: dtfNum(value) };
  dtfUpdateSummary();
  dtfQueueSave(date);
}

// Salva subito quello che è in attesa (cambio pagina, chiusura finestra)
function dtfFlushSaves() {
  Object.entries(DtfState.saveTimers).forEach(([date, t]) => { clearTimeout(t); dtfSaveDay(date); });
  DtfState.saveTimers = {};
}
window.addEventListener('beforeunload', dtfFlushSaves);

// ── Dettaglio: nomi dei file stampati, uno per riga ──

function dtfOpenDetail(date) {
  DtfState.detailDate = date;
  const e = DtfState.entries[date] || { metri: 0, dettaglio: '' };
  const modal = document.getElementById('dtf-detail-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="dtf-d-title">
      <div class="modal-header">
        <h2 id="dtf-d-title">${escapeHtml(dtfClient()?.nome || '')} · ${new Date(date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <button class="btn-icon" onclick="dtfCloseDetail()" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:12px;">
        <div class="dtf-drop" id="dtf-drop" tabindex="0"
          ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="dtfDropFiles(event)">
          ${Icons.paperclip(20)}
          <strong>Trascina qui i file stampati</strong>
          <span>Viene scritto solo il nome, uno per riga: i file non vengono caricati</span>
        </div>
        <div class="form-group">
          <label class="form-label" for="dtf-detail-text">File stampati (uno per riga)</label>
          <textarea id="dtf-detail-text" class="form-textarea" rows="10" oninput="dtfOnDetail(this.value)"
            placeholder="logo_fronte.png&#10;logo_retro.png">${escapeHtml(e.dettaglio)}</textarea>
        </div>
        <p class="settings-section-hint" style="margin:0;" id="dtf-detail-status">Le modifiche si salvano da sole.</p>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (ev) => { if (ev.target === modal) dtfCloseDetail(); };
  setTimeout(() => document.getElementById('dtf-detail-text')?.focus(), 50);
}

function dtfOnDetail(value) {
  const date = DtfState.detailDate;
  DtfState.entries[date] = { ...(DtfState.entries[date] || { metri: 0 }), dettaglio: value };
  dtfQueueSave(date);
}

function dtfDropFiles(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  const names = [...(e.dataTransfer?.files || [])].map(f => f.name).filter(Boolean);
  if (!names.length) return;
  const ta = document.getElementById('dtf-detail-text');
  const current = ta.value.replace(/\s+$/, '');
  ta.value = (current ? current + '\n' : '') + names.join('\n');
  dtfOnDetail(ta.value);
  showToast(`${names.length} ${names.length === 1 ? 'nome aggiunto' : 'nomi aggiunti'}`);
}

function dtfCloseDetail() {
  const date = DtfState.detailDate;
  if (date && DtfState.saveTimers[date]) { clearTimeout(DtfState.saveTimers[date]); delete DtfState.saveTimers[date]; dtfSaveDay(date); }
  closeModal('dtf-detail-modal');
  DtfState.detailDate = null;
  renderDtfTerzi();
}

// ── Clienti conto terzi ──

function dtfOpenClientForm(id = null) {
  const c = id ? DtfState.clients.find(x => x.id === id) : null;
  const modal = document.getElementById('dtf-client-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;" role="dialog" aria-modal="true" aria-labelledby="dtf-c-title">
      <div class="modal-header">
        <h2 id="dtf-c-title">${c ? 'Modifica cliente' : 'Nuovo cliente conto terzi'}</h2>
        <button class="btn-icon" onclick="closeModal('dtf-client-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body" style="gap:12px;" onsubmit="event.preventDefault();dtfSubmitClient(${c ? `'${c.id}'` : 'null'})">
        <div class="form-group"><label class="form-label" for="dtf-c-nome">Nome *</label>
          <input id="dtf-c-nome" class="form-input" maxlength="120" required value="${escapeHtml(c?.nome || '')}"></div>
        <div class="form-group"><label class="form-label" for="dtf-c-costo">Costo al metro (€) *</label>
          <input id="dtf-c-costo" class="form-input" inputmode="decimal" required value="${c ? String(c.costo_metro).replace('.', ',') : ''}" placeholder="es. 6,50"></div>
        <div class="form-group"><label class="form-label" for="dtf-c-note">Note</label>
          <textarea id="dtf-c-note" class="form-textarea" rows="3">${escapeHtml(c?.note || '')}</textarea></div>
        <div class="dtf-access">
          <div class="form-group"><label class="form-label" for="dtf-c-pwd">Password per il cliente</label>
            <input id="dtf-c-pwd" type="password" class="form-input" autocomplete="new-password" minlength="8"
              placeholder="${c ? 'Lascia vuoto per non cambiarla' : 'Almeno 8 caratteri (facoltativa)'}">
            <span class="settings-section-hint" style="margin:4px 0 0;" id="dtf-c-pwd-state">${c ? 'Verifica in corso…' : 'Con la password il cliente può vedere la sua tabella in sola lettura.'}</span>
          </div>
          ${c ? `<div class="dtf-link-box" id="dtf-c-link" hidden>
            <label class="form-label" for="dtf-c-link-input">Link di sola lettura</label>
            <div class="dtf-link-row">
              <input id="dtf-c-link-input" class="form-input" readonly onfocus="this.select()">
              <button type="button" class="btn btn-secondary btn-sm" onclick="dtfCopyLink('${c.id}')">${Icons.link(14)} Copia</button>
            </div>
            <button type="button" class="btn btn-ghost btn-sm" onclick="dtfRegenerateLink('${c.id}')">Genera un nuovo link (il vecchio smette di funzionare)</button>
          </div>` : ''}
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
          ${c ? `<button type="button" class="btn btn-ghost btn-sm" style="color:var(--priority-urgent);margin-right:auto;" onclick="dtfDeleteClient('${c.id}')">${Icons.trash(14)} Elimina</button>` : ''}
          <button type="button" class="btn btn-secondary" onclick="closeModal('dtf-client-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="dtf-c-save">${c ? 'Salva' : 'Aggiungi'}</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('dtf-client-modal'); };
  setTimeout(() => document.getElementById('dtf-c-nome')?.focus(), 50);
  if (c) dtfLoadAccess(c.id);
}

// ── Link di sola lettura per il cliente (portale) ──

function dtfPortalUrl(token) {
  return new URL('cliente-dtf.html', location.href.split('#')[0]).href + '#' + token;
}

async function dtfAccessRpc(fn, args) {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw new Error('Errore di connessione');
  if (!data?.success) throw new Error(data?.error || 'Errore');
  return data;
}

function dtfShowAccess(info) {
  const state = document.getElementById('dtf-c-pwd-state');
  if (state) state.textContent = info.has_password
    ? 'Password impostata: il cliente può accedere con il link qui sotto.'
    : 'Nessuna password: imposta una password per attivare il link del cliente.';
  const box = document.getElementById('dtf-c-link');
  if (box) { box.hidden = !info.has_password; document.getElementById('dtf-c-link-input').value = dtfPortalUrl(info.token); }
}

async function dtfLoadAccess(clientId) {
  try { dtfShowAccess(await dtfAccessRpc('dtf_access_info', { p_client_id: clientId })); }
  catch (e) { const s = document.getElementById('dtf-c-pwd-state'); if (s) s.textContent = e.message; }
}

async function dtfCopyLink(clientId) {
  try {
    const info = await dtfAccessRpc('dtf_access_info', { p_client_id: clientId });
    if (!info.has_password) { showToast('Prima imposta una password per questo cliente', 'error'); dtfOpenClientForm(clientId); return; }
    const url = dtfPortalUrl(info.token);
    try { await navigator.clipboard.writeText(url); showToast('Link copiato: invialo al cliente insieme alla password'); }
    catch { prompt('Copia il link per il cliente:', url); }
  } catch (e) { showToast(e.message, 'error'); }
}

async function dtfRegenerateLink(clientId) {
  if (!confirm('Generare un nuovo link?\n\nIl link attuale smetterà subito di funzionare: dovrai inviare al cliente quello nuovo.')) return;
  try {
    dtfShowAccess(await dtfAccessRpc('dtf_regenerate_link', { p_client_id: clientId }));
    showToast('Nuovo link generato');
  } catch (e) { showToast(e.message, 'error'); }
}

async function dtfSubmitClient(id) {
  const nome = document.getElementById('dtf-c-nome').value.trim();
  const costoRaw = document.getElementById('dtf-c-costo').value.trim();
  const note = document.getElementById('dtf-c-note').value.trim();
  const pwd = document.getElementById('dtf-c-pwd').value;
  const costo = parseFloat(costoRaw.replace(',', '.'));
  if (pwd && pwd.length < 8) { showToast('La password deve avere almeno 8 caratteri', 'error'); document.getElementById('dtf-c-pwd').focus(); return; }
  if (!nome) { showToast('Inserisci il nome', 'error'); return; }
  if (!Number.isFinite(costo) || costo < 0) { showToast('Costo al metro non valido', 'error'); document.getElementById('dtf-c-costo').focus(); return; }

  const btn = document.getElementById('dtf-c-save');
  btn.disabled = true;
  try {
    const payload = { nome, costo_metro: Math.round(costo * 100) / 100, note };
    const res = id
      ? await supabaseClient.from('dtf_clients').update(payload).eq('id', id).select().single()
      : await supabaseClient.from('dtf_clients').insert(payload).select().single();
    if (res.error) throw res.error;
    if (pwd) await dtfAccessRpc('dtf_set_password', { p_client_id: res.data.id, p_password: pwd });
    closeModal('dtf-client-modal');
    showToast(pwd
      ? `${id ? 'Cliente aggiornato' : `Cliente "${nome}" aggiunto`} · password ${id ? 'cambiata' : 'impostata'}: copia il link con 🔗`
      : (id ? 'Cliente aggiornato' : `Cliente "${nome}" aggiunto`));
    await dtfLoadClients();
    if (!id) { DtfState.clientId = res.data.id; dtfLs.set(DTF_CLIENT_KEY, res.data.id); }
    await dtfReloadTerzi(!id);
  } catch (e) {
    console.error('[dtf cliente]', e);
    showToast('Salvataggio non riuscito', 'error');
    btn.disabled = false;
  }
}

async function dtfDeleteClient(id) {
  const c = DtfState.clients.find(x => x.id === id);
  if (!confirm(`Eliminare "${c?.nome}"?\n\nVengono cancellati anche tutti i metri e i dettagli registrati per questo cliente.`)) return;
  try {
    const { error } = await supabaseClient.from('dtf_clients').delete().eq('id', id);
    if (error) throw error;
    closeModal('dtf-client-modal');
    showToast('Cliente eliminato');
    await dtfLoadClients();
    await dtfReloadTerzi(true);
  } catch { showToast('Eliminazione non riuscita', 'error'); }
}

// ═══════════════════════════════════════════════
// PAGINA
// ═══════════════════════════════════════════════

async function openDtfPage() {
  DtfState.sideOpen = dtfLs.get(DTF_SIDE_KEY) === '1';
  if (!DtfState.month) DtfState.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (!DtfState.clientId) DtfState.clientId = dtfLs.get(DTF_CLIENT_KEY);

  renderDtfInterno();
  if (!DtfState.loaded) document.getElementById('dtf-terzi-root').innerHTML =
    '<div class="dtf-box-head"><div><h2>Conto terzi</h2></div></div><div class="empty-list">Caricamento…</div>';

  try {
    await dtfLoadClients();
    await dtfLoadEntries();
    DtfState.loaded = true;
    DtfState.error = null;
  } catch (e) { DtfState.error = e.message || 'errore'; }
  renderDtfTerzi();
  dtfScrollToToday();
  dtfSubscribe();
}

// Aggiornamenti in diretta da altri PC (senza toccare il campo che si sta scrivendo)
function dtfSubscribe() {
  if (DtfState.channel) return;
  DtfState.channel = supabaseClient.channel('dtf-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dtf_clients' }, async () => {
      await dtfLoadClients(); if (Nav.current === 'dtf' && !dtfEditing()) renderDtfTerzi();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dtf_entries' }, async (p) => {
      const row = p.new?.client_id ? p.new : p.old;
      if (row?.client_id !== DtfState.clientId || dtfEditing() || Object.keys(DtfState.saveTimers).length) return;
      await dtfLoadEntries(); if (Nav.current === 'dtf') renderDtfTerzi();
    })
    .subscribe();
}

const dtfEditing = () => !!document.activeElement?.closest?.('#dtf-terzi-root, #dtf-detail-modal');
