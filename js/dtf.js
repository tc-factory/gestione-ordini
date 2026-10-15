/**
 * T&C Factory — DTF
 * INTERNO: timeline degli ordini a lavorazione interna ancora senza DTF, in ordine di
 *   scadenza e riordinabile a mano. "Stampato" spunta la fase DTF dell'ordine; la × lo
 *   toglie dalla lista. Stampati e rimossi si ripristinano dalla colonna laterale.
 * CONTO TERZI: clienti DTF dedicati con costo al metro, calendario mensile con un giorno
 *   per riga (metri + nomi dei file stampati), totale del mese. Salvataggio automatico.
 */

const DTF_SETTINGS_KEY = 'dtf_interno';        // { order: [id…], removed: [{ id, at }…] } condiviso
const DTF_CLIENT_KEY   = 'tcf_dtf_client';     // cliente conto terzi selezionato (per browser)
const DTF_CLIENT_ORDER_KEY = 'dtf_clienti_ordine'; // [id…] ordine dei clienti conto terzi, condiviso
const DTF_TAG_KEY      = 'tcf_dtf_tag';        // filtro tipologia dell'Interno (per browser)
const DTF_SAVE_DELAY   = 700;
const DTF_STAMPATI_DAYS = 90;                  // in "Stampati" gli ultimi 90 giorni

const DtfState = {
  clients: [],
  entries: {},          // 'YYYY-MM-DD' → { metri, dettaglio }
  clientId: null,
  month: null,          // Date al primo del mese visualizzato
  loaded: false,
  error: null,
  saveTimers: {},
  orderTimers: {},      // salvataggio file degli ordini (interno)
  detail: null,         // finestra file: { kind: 'day'|'order', key, title }
  saving: 0,
  lastSaved: null,
  detailDate: null,
  channel: null,
  dragId: null,
  clientDragId: null,
  clientOrderSeen: '',  // ordine clienti già applicato (per gli aggiornamenti in diretta)
  tag: null,            // filtro tipologia dell'Interno
  qInterno: '',         // ricerca dell'Interno (ordine, cliente, tipologia, file)
  qTerzi: '',           // ricerca del Conto terzi (file e clienti, in tutti i mesi)
  terziResults: null,   // risultati della ricerca Conto terzi: null = nessuna ricerca
  terziTimer: null,
};

// Testo cercato in un campo: senza maiuscole/minuscole
const dtfHas = (text, q) => String(text || '').toLowerCase().includes(q);

// Campo cerca che resta attivo mentre la sezione si ridisegna
function dtfSearchBox(id, value, placeholder, oninput) {
  return `<div class="search-box dtf-search">
    ${Icons.search()}
    <input id="${id}" type="search" placeholder="${placeholder}" aria-label="${placeholder}" value="${escapeHtml(value)}" oninput="${oninput}">
  </div>`;
}
// Ricerca dell'Interno: nome/codice ordine, descrizione, cliente, tipologie, nomi dei file
function dtfMatchInterno(o, q) {
  return !q || [o.nome, TCFactory.orderCode(o), orderDesc(o), TCFactory.clientName(TCFactory.getClient(o.clientId)), ...o.tags,
    ...(Array.isArray(o.dtfItems) ? o.dtfItems.map(f => f?.name) : [])].some(t => dtfHas(t, q));
}
function dtfRefocus(id) {
  const el = document.getElementById(id);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

const dtfLs = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ═══════════════════════════════════════════════
// INTERNO
// ═══════════════════════════════════════════════

// { order: [id…], removed: [{ id, at }…] } condiviso tra tutti
function dtfSettings() {
  const v = TCFactory._settings[DTF_SETTINGS_KEY];
  const removed = (Array.isArray(v?.removed) ? v.removed : [])
    .map(r => (typeof r === 'string' ? { id: r, at: null } : r)).filter(r => r?.id);
  return { order: Array.isArray(v?.order) ? v.order : [], removed };
}

async function dtfSaveSettings(patch) {
  const next = { ...dtfSettings(), ...patch };
  TCFactory._settings[DTF_SETTINGS_KEY] = next;
  await TCFactory.setSetting(DTF_SETTINGS_KEY, next);
}

const dtfDone = (o) => !!o.stages?.dtfPronti?.done;

function dtfLists() {
  const { order, removed } = dtfSettings();
  const removedAt = new Map(removed.map(r => [r.id, r.at]));
  // Solo gli ordini interni con la lavorazione DTF (spuntata sotto INTERNA o in una riga del modulo)
  const dtfLav = interneLavId('interno');
  const internal = TCFactory.getOrders().filter(o => !o.deletedAt && isLavInterna(o) &&
    (orderLavInterne(o).includes(dtfLav) || interneRows(o).some(r => r.interna === dtfLav)));
  const deadline = (o) => TCFactory.getEffectiveDeadline(o)?.date || '9999-12-31';

  // Da stampare: ordini attivi a lavorazione interna, DTF non ancora fatto, non rimossi
  const rank = (o) => { const i = order.indexOf(o.id); return i < 0 ? Infinity : i; };
  const todo = internal
    .filter(o => !o.archived && !dtfDone(o) && !removedAt.has(o.id))
    .sort((a, b) => rank(a) - rank(b) || deadline(a).localeCompare(deadline(b)));

  const limit = localISODate(new Date(Date.now() - DTF_STAMPATI_DAYS * 86400000));
  const printed = internal
    .filter(o => dtfDone(o) && (o.stages.dtfPronti.date || '') >= limit)
    .sort((a, b) => (b.stages.dtfPronti.date || '').localeCompare(a.stages.dtfPronti.date || ''));
  const removedList = internal
    .filter(o => removedAt.has(o.id) && !dtfDone(o))
    .map(o => ({ o, at: removedAt.get(o.id) }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  return { todo, printed, removedList };
}

// Metri, tempo e costo di un ordine dai suoi file
function dtfOrderStats(o) {
  const files = (Array.isArray(o.dtfItems) ? o.dtfItems : []).filter(f => f && f.name);
  const metri = Math.round(files.reduce((s, f) => s + (f.metri > 0 ? f.metri : 0), 0) * 100) / 100;
  const speed = DtfMisure.speedMh(), costo = DtfMisure.costInterno();
  return {
    files: files.length,
    senzaMisura: files.filter(f => !(f.metri > 0)).length,
    metri,
    ore: speed > 0 ? metri / speed : null,
    costo: costo > 0 ? metri * costo : null,
  };
}

function dtfFmtTime(ore) {
  if (ore == null) return '—';
  const min = Math.round(ore * 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

function dtfSetTag(name) {
  DtfState.tag = DtfState.tag === name ? null : name;
  if (DtfState.tag) dtfLs.set(DTF_TAG_KEY, DtfState.tag); else try { localStorage.removeItem(DTF_TAG_KEY); } catch {}
  renderDtfInterno();
}

function renderDtfInterno() {
  const root = document.getElementById('dtf-interno-root');
  if (!root) return;
  const { todo: all, printed, removedList } = dtfLists();

  // Filtro tipologia: solo tra le tipologie presenti negli ordini da stampare
  if (DtfState.tag === null) DtfState.tag = dtfLs.get(DTF_TAG_KEY) || null;
  const tagsInList = TCFactory.getTags().filter(t => all.some(o => o.tags.includes(t.name)));
  if (DtfState.tag && !tagsInList.some(t => t.name === DtfState.tag)) DtfState.tag = null;
  const q = DtfState.qInterno.trim().toLowerCase();
  const matches = (o) => dtfMatchInterno(o, q);
  const todo = (DtfState.tag ? all.filter(o => o.tags.includes(DtfState.tag)) : all).filter(matches);
  // Con la ricerca: quanti ne trova anche tra stampati e rimossi
  const altrove = q ? printed.filter(matches).length + removedList.filter(x => matches(x.o)).length : 0;
  const today = localISODate(new Date());
  const fmt = (d) => TCFactory.formatDate(d, { day: '2-digit', month: '2-digit' });
  const stats = todo.map(dtfOrderStats);
  const tot = stats.reduce((t, x) => ({ metri: t.metri + x.metri, ore: t.ore + (x.ore || 0), costo: t.costo + (x.costo || 0) }), { metri: 0, ore: 0, costo: 0 });
  const senzaFile = stats.filter(x => !x.files).length;
  const costoAttivo = DtfMisure.costInterno() > 0;

  const card = (o, i) => {
    const dl = TCFactory.getEffectiveDeadline(o);
    const client = TCFactory.getClient(o.clientId);
    const st = stats[i];
    return `
      <li class="dtf-item ${isUrgentOrder(o) ? 'dtf-urgent' : ''}" draggable="true" data-id="${o.id}"
          ondragstart="dtfDragStart(event,'${o.id}')" ondragend="dtfDragEnd()" ondragover="dtfDragOver(event)" ondrop="dtfDrop(event)">
        <span class="dtf-pos" aria-hidden="true">${i + 1}</span>
        <div class="dtf-when ${dl && dl.date < today ? 'late' : ''}" title="Scadenza">
          <strong>${dl ? fmt(dl.date) : '—'}</strong>
          <span>${dl ? new Date(dl.date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short' }) : ''}</span>
        </div>
        <button type="button" class="dtf-main" onclick="openOrderDetail('${o.id}')">
          <strong>${escapeHtml(o.nome)}</strong>
          <span>${[orderDesc(o) ? escapeHtml(orderDesc(o)) : '', client && TCFactory.clientName(client) !== o.nome ? escapeHtml(TCFactory.clientName(client)) : '', o.tags.map(escapeHtml).join(', ')].filter(Boolean).join(' · ')}</span>
        </button>
        <div class="dtf-cols ${st.files ? '' : 'empty'}" role="group" aria-label="Lunghezza, tempo e costo">
          <span class="dtf-col"><strong>${st.files ? `${dtfMetri(st.metri)} m` : '—'}</strong><small>lunghezza</small></span>
          <span class="dtf-col"><strong>${st.files ? dtfFmtTime(st.ore) : '—'}</strong><small>tempo</small></span>
          ${costoAttivo ? `<span class="dtf-col"><strong>${st.files ? euro(st.costo) : '—'}</strong><small>costo</small></span>` : ''}
        </div>
        <button type="button" class="dtf-files-btn ${st.files ? '' : 'empty'}" onclick="dtfOpenOrderFiles('${o.id}')"
          title="${st.files ? 'Vedi e modifica i file' : 'Aggiungi i file da stampare'}">
          ${Icons.paperclip(14)}<span>${st.files ? `<strong>${st.files} file</strong>${st.senzaMisura ? `<small>${st.senzaMisura} senza misura</small>` : ''}` : '<strong>Aggiungi file</strong>'}</span>
        </button>
        <button type="button" class="btn btn-sm dtf-done-btn" onclick="dtfMarkPrinted('${o.id}')">${Icons.checkCircle('currentColor', 15)} Stampato</button>
        <button type="button" class="btn-icon dtf-remove" onclick="dtfRemove('${o.id}')" aria-label="Togli ${escapeHtml(o.nome)} dalla lista DTF" title="Non serve il DTF: togli dalla lista">${Icons.x(14)}</button>
      </li>`;
  };

  const tagBar = tagsInList.length > 1 || DtfState.tag ? `
    <div class="dtf-tags" role="group" aria-label="Filtra per tipologia">
      <span class="dtf-tags-label">Tipologia</span>
      ${tagsInList.map(t => {
        const on = DtfState.tag === t.name, n = all.filter(o => o.tags.includes(t.name)).length;
        return `<button type="button" class="chip chip-btn" aria-pressed="${on}" onclick="dtfSetTag('${escapeHtml(t.name).replace(/'/g, '&#39;')}')"
          style="background:${on ? t.color : `color-mix(in srgb, ${t.color} 12%, transparent)`};color:${on ? '#fff' : t.color};">
          <span class="chip-dot" style="background:${on ? '#fff' : t.color};"></span>${escapeHtml(t.name)} · ${n}</button>`;
      }).join('')}
      ${DtfState.tag ? `<button type="button" class="btn btn-ghost btn-sm" onclick="dtfSetTag(DtfState.tag)">× Tutte</button>` : ''}
    </div>` : '';

  root.innerHTML = `
    <div class="dtf-box-head">
      <div><h2>Da stampare</h2><p>${todo.length}${DtfState.tag || q ? ` di ${all.length}` : ''} ${todo.length === 1 ? 'ordine' : 'ordini'} · per scadenza, trascina per dare priorità</p></div>
      <div class="dtf-head-actions">
        ${dtfSearchBox('dtf-q-interno', DtfState.qInterno, 'Cerca ordine, cliente, file…', 'dtfSearchInterno(this.value)')}
        <button type="button" class="btn btn-secondary btn-sm" onclick="dtfOpenHistory()">Stampati e rimossi · ${printed.length + removedList.length}</button>
      </div>
    </div>
    ${altrove ? `<p class="dtf-note">Trovati anche ${altrove} tra <button type="button" class="link-btn" onclick="dtfOpenHistory()">Stampati e rimossi</button>.</p>` : ''}
    ${tagBar}
    <div class="dtf-summary dtf-summary-interno">
      <div class="dtf-kpi"><span>Metri da stampare</span><strong>${dtfMetri(tot.metri)} m</strong></div>
      <div class="dtf-kpi"><span>Tempo di stampa</span><strong>${dtfFmtTime(tot.ore)}</strong></div>
      ${costoAttivo
        ? `<div class="dtf-kpi dtf-kpi-total"><span>Costo</span><strong>${euro(tot.costo)}</strong></div>`
        : `<button type="button" class="dtf-kpi dtf-kpi-hint" onclick="Nav.go('impostazioni')"><span>Costo</span><strong>Imposta i costi</strong></button>`}
    </div>
    ${senzaFile ? `<p class="dtf-note">${senzaFile} ${senzaFile === 1 ? 'ordine non ha' : 'ordini non hanno'} ancora file: metri e tempo li contano solo quando ci sono.</p>` : ''}
    ${todo.length
      ? `<ol class="dtf-timeline" aria-label="Ordini da stampare">${todo.map(card).join('')}</ol>`
      : `<div class="empty-list">${q ? `Nessun ordine da stampare trovato per "${escapeHtml(DtfState.qInterno.trim())}".` : DtfState.tag ? `Nessun ordine "${escapeHtml(DtfState.tag)}" da stampare.` : 'Nessun ordine da stampare. 🎉'}</div>`}`;
}

function dtfSearchInterno(v) {
  DtfState.qInterno = v;
  renderDtfInterno();
  dtfRefocus('dtf-q-interno');
}

// ── Stampati e rimossi (finestra) ──

function dtfOpenHistory() {
  dtfRenderHistory();
  const modal = document.getElementById('dtf-history-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('dtf-history-modal'); };
}

function dtfRenderHistory() {
  // Con una ricerca attiva nell'Interno, anche qui si vedono solo gli ordini trovati
  const q = DtfState.qInterno.trim().toLowerCase();
  const lists = dtfLists();
  const printed = lists.printed.filter(o => dtfMatchInterno(o, q));
  const removedList = lists.removedList.filter(x => dtfMatchInterno(x.o, q));
  const fmt = (iso) => iso ? new Date(String(iso).length > 10 ? iso : iso + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : 'data non registrata';
  const row = (o, when, action) => `
    <li class="dtf-side-row">
      <div><strong>${escapeHtml(o.nome)}</strong><span>${when}</span></div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="${action}('${o.id}')">Ripristina</button>
    </li>`;
  document.getElementById('dtf-history-modal').innerHTML = `
    <div class="modal" style="max-width:860px;" role="dialog" aria-modal="true" aria-labelledby="dtf-h-title">
      <div class="modal-header">
        <h2 id="dtf-h-title">Stampati e rimossi</h2>
        <button class="btn-icon" onclick="closeModal('dtf-history-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body dtf-history">
        ${q ? `<p class="dtf-note" style="grid-column:1/-1;margin:0;">Solo gli ordini trovati per "${escapeHtml(DtfState.qInterno.trim())}" · <button type="button" class="link-btn" onclick="DtfState.qInterno='';renderDtfInterno();dtfRenderHistory()">mostra tutti</button></p>` : ''}
        <section>
          <h3>Stampati <small>ultimi ${DTF_STAMPATI_DAYS} giorni · ${printed.length}</small></h3>
          ${printed.length ? `<ul>${printed.map(o => row(o, `stampato il ${fmt(o.stages.dtfPronti.date)}`, 'dtfRestorePrinted')).join('')}</ul>` : '<p class="dtf-side-empty">Nessuno.</p>'}
        </section>
        <section>
          <h3>Rimossi <small>${removedList.length}</small></h3>
          ${removedList.length ? `<ul>${removedList.map(({ o, at }) => row(o, `tolto il ${fmt(at)}`, 'dtfRestoreRemoved')).join('')}</ul>` : '<p class="dtf-side-empty">Nessuno.</p>'}
        </section>
      </div>
    </div>`;
}

const dtfAfterHistoryChange = () => {
  renderDtfInterno();
  if (document.getElementById('dtf-history-modal')?.classList.contains('active')) dtfRenderHistory();
};

async function dtfMarkPrinted(id) {
  const o = TCFactory.getOrderById(id);
  try {
    dtfFlushOrderSave(id);
    await TCFactory.setStage(id, 'dtfPronti', true);
    showToast(`"${o?.nome}": DTF stampato ✓`);
    dtfAfterHistoryChange(); renderOrderList();
  } catch { showToast('Impossibile segnare come stampato', 'error'); }
}

async function dtfRestorePrinted(id) {
  try {
    await TCFactory.setStage(id, 'dtfPronti', false);
    showToast('Riportato tra gli ordini da stampare');
    dtfAfterHistoryChange(); renderOrderList();
  } catch { showToast('Impossibile ripristinare', 'error'); }
}

async function dtfRemove(id) {
  const { removed } = dtfSettings();
  try {
    await dtfSaveSettings({ removed: [...removed.filter(r => r.id !== id), { id, at: new Date().toISOString() }] });
    showToast('Tolto dalla lista DTF (ripristinabile da "Stampati e rimossi")');
    dtfAfterHistoryChange();
  } catch { showToast('Impossibile togliere l\'ordine', 'error'); }
}

async function dtfRestoreRemoved(id) {
  const { removed } = dtfSettings();
  try {
    await dtfSaveSettings({ removed: removed.filter(r => r.id !== id) });
    showToast('Riportato tra gli ordini da stampare');
    dtfAfterHistoryChange();
  } catch { showToast('Impossibile ripristinare', 'error'); }
}

// ── Priorità manuale: trascina per riordinare ──

function dtfDragStart(e, id) {
  if (e.target.closest?.('button') && e.target.closest('button') !== e.currentTarget) { /* trascina dal riquadro */ }
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

  // Si riordina l'elenco completo: con un filtro attivo gli ordini nascosti restano al loro posto
  const ids = dtfLists().todo.map(o => o.id).filter(x => x !== id);
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
  DtfState.clients = dtfSortClients(data || []);
  if (!dtfClient()) DtfState.clientId = DtfState.clients[0]?.id || null;
}

async function dtfLoadEntries() {
  DtfState.entries = {};
  if (!DtfState.clientId) return;
  const [from, to] = dtfMonthRange();
  const { data, error } = await supabaseClient.from('dtf_entries').select('giorno, metri, dettaglio, files')
    .eq('client_id', DtfState.clientId).gte('giorno', from).lte('giorno', to);
  if (error) throw error;
  (data || []).forEach(r => { DtfState.entries[r.giorno] = { metri: Number(r.metri) || 0, dettaglio: r.dettaglio || '', files: Array.isArray(r.files) ? r.files : [] }; });
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

// File con una tariffa diversa da quella del cliente (prezzo inserito e metri calcolati)
const dtfHasRate = (f) => !!f?.tariffa_diversa && Number.isFinite(f.tariffa) && f.metri > 0;

// Costo di un giorno: i file con tariffa diversa al loro prezzo, il resto dei metri al costo del cliente
function dtfDayCosto(e, costo) {
  const special = (Array.isArray(e?.files) ? e.files : []).filter(dtfHasRate);
  const metriSpeciali = special.reduce((s, f) => s + f.metri, 0);
  const standard = Math.max(0, (Number(e?.metri) || 0) - metriSpeciali);
  return { euro: standard * costo + special.reduce((s, f) => s + f.metri * f.tariffa, 0), metriSpeciali };
}

function dtfSummaryHtml() {
  const c = dtfClient();
  const days = Object.values(DtfState.entries);
  const metri = days.reduce((s, e) => s + (Number(e.metri) || 0), 0);
  const costo = Number(c?.costo_metro) || 0;
  const tot = days.map(e => dtfDayCosto(e, costo));
  const speciali = tot.reduce((s, x) => s + x.metriSpeciali, 0);
  return `
    <div class="dtf-kpi"><span>Metri del mese</span><strong>${dtfMetri(metri)} m</strong></div>
    <div class="dtf-kpi"><span>Costo al metro</span><strong>${euro(costo)}</strong></div>
    <div class="dtf-kpi dtf-kpi-total"><span>Totale</span><strong>${euro(tot.reduce((s, x) => s + x.euro, 0))}</strong>
      ${speciali ? `<small class="dtf-rate-note">di cui ${dtfMetri(speciali)} m a tariffa diversa</small>` : ''}</div>`;
}

// Ordine scelto a mano (trascinando i box); i clienti nuovi vanno in fondo, in ordine alfabetico
const dtfClientOrder = () => { const v = TCFactory._settings[DTF_CLIENT_ORDER_KEY]; return Array.isArray(v) ? v : []; };

function dtfSortClients(list) {
  const order = dtfClientOrder();
  DtfState.clientOrderSeen = JSON.stringify(order);
  const rank = (c) => { const i = order.indexOf(c.id); return i < 0 ? Infinity : i; };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.nome.localeCompare(b.nome, 'it'));
}

function dtfClientGridHtml() {
  return `
    <div class="dtf-client-grid" id="dtf-client-grid" role="tablist" aria-label="Clienti conto terzi">
      ${DtfState.clients.map(x => {
        const on = x.id === DtfState.clientId;
        return `<button type="button" role="tab" aria-selected="${on}" class="dtf-client-box ${on ? 'active' : ''}" onclick="dtfSelectClient('${x.id}')"
          draggable="true" data-id="${x.id}" title="Trascina per cambiare l'ordine"
          ondragstart="dtfClientDragStart(event,'${x.id}')" ondragend="dtfClientDragEnd()" ondragover="dtfClientDragOver(event)" ondrop="dtfClientDrop(event)">
          <strong>${escapeHtml(x.nome)}</strong><span>${euro(x.costo_metro)}/m</span>
        </button>`;
      }).join('')}
      <button type="button" class="dtf-client-box dtf-client-add" onclick="dtfOpenClientForm()">${Icons.plus(16)} <span>Nuovo cliente</span></button>
    </div>`;
}

function renderDtfTerzi() {
  const root = document.getElementById('dtf-terzi-root');
  if (!root) return;

  if (DtfState.error) {
    root.innerHTML = `<div class="dtf-box-head"><div><h2>DTF Conto terzi</h2></div></div>
      <div class="empty-list">Impossibile caricare i dati DTF: ${escapeHtml(DtfState.error)}</div>`;
    return;
  }

  const c = dtfClient();
  const searching = DtfState.qTerzi.trim().length > 0;
  const head = `
    <div class="dtf-box-head">
      <div><h2>DTF Conto terzi</h2><p id="dtf-save-status">${dtfSaveStatus()}</p></div>
      ${dtfSearchBox('dtf-q-terzi', DtfState.qTerzi, 'Cerca file o cliente, in tutti i mesi…', 'dtfSearchTerzi(this.value)')}
      ${c && !searching ? `<div class="dtf-client-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="dtfCopyLink('${c.id}')" title="Copia il link di sola lettura per il cliente">${Icons.link(14)} Link cliente</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="dtfOpenClientForm('${c.id}')">${Icons.edit(14)} Modifica</button>
      </div>` : ''}
    </div>
    ${dtfClientGridHtml()}`;

  if (searching) { root.innerHTML = head + dtfTerziResultsHtml(); return; }

  if (!c) {
    root.innerHTML = head + `<div class="empty-list">Aggiungi un cliente con il box <strong>Nuovo cliente</strong> per iniziare.</div>`;
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
    const special = (Array.isArray(e.files) ? e.files : []).some(f => f?.tariffa_diversa);
    rows.push(`
      <div class="dtf-day ${iso === today ? 'today' : ''} ${weekend ? 'weekend' : ''}" data-date="${iso}" ${iso === today ? 'id="dtf-today"' : ''}>
        <div class="dtf-day-date"><strong>${d}</strong><span>${date.toLocaleDateString('it-IT', { weekday: 'short' })}</span></div>
        <label class="dtf-metri">
          <input type="text" inputmode="decimal" class="form-input" value="${e.metri ? dtfMetri(e.metri) : ''}" placeholder="0"
            aria-label="Metri del ${d}" oninput="dtfOnMetri('${iso}', this.value)" onfocus="this.select()">
          <span>m</span>
        </label>
        <button type="button" class="dtf-detail-btn ${files.length ? 'has-files' : ''} ${special ? 'has-rate' : ''}" onclick="dtfOpenDetail('${iso}')"
          ${special ? 'title="Ci sono file con una tariffa diversa"' : ''}>
          ${special ? '<em class="dtf-rate-badge">€ diversa</em>' : ''}
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

// ── Ricerca Conto terzi: nomi dei file (tutti i clienti e i mesi) e nomi dei clienti ──
function dtfSearchTerzi(v) {
  DtfState.qTerzi = v;
  clearTimeout(DtfState.terziTimer);
  const q = v.trim();
  if (!q) { DtfState.terziResults = null; renderDtfTerzi(); dtfRefocus('dtf-q-terzi'); dtfScrollToToday(); return; }
  DtfState.terziResults = DtfState.terziResults || { loading: true, rows: [] };
  renderDtfTerzi();
  dtfRefocus('dtf-q-terzi');
  DtfState.terziTimer = setTimeout(() => dtfRunTerziSearch(q), 300);
}
async function dtfRunTerziSearch(q) {
  const like = '%' + q.replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  let rows = [], error = null;
  try {
    const res = await supabaseClient.from('dtf_entries').select('client_id, giorno, metri, dettaglio')
      .ilike('dettaglio', like).order('giorno', { ascending: false }).limit(200);
    if (res.error) throw res.error;
    rows = res.data || [];
  } catch (e) { error = e.message || 'errore'; }
  if (DtfState.qTerzi.trim() !== q) return;   // nel frattempo si è scritto altro
  DtfState.terziResults = { loading: false, rows, error };
  renderDtfTerzi();
  dtfRefocus('dtf-q-terzi');
}
function dtfTerziResultsHtml() {
  const q = DtfState.qTerzi.trim().toLowerCase();
  const r = DtfState.terziResults || { loading: true, rows: [] };
  const clienti = DtfState.clients.filter(x => dtfHas(x.nome, q));
  const nome = (id) => DtfState.clients.find(x => x.id === id)?.nome || 'Cliente eliminato';
  const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const righe = r.rows.map(e => {
    const files = String(e.dettaglio || '').split('\n').map(x => x.trim()).filter(Boolean);
    const hit = files.filter(f => dtfHas(f, q));
    return `<li>
      <button type="button" class="dtf-result" onclick="dtfOpenResult('${e.client_id}','${e.giorno}')">
        <span class="dtf-result-when"><strong>${fmt(e.giorno)}</strong><small>${escapeHtml(nome(e.client_id))}</small></span>
        <span class="dtf-result-files">${hit.slice(0, 3).map(f => `<span>${escapeHtml(f)}</span>`).join('')}${hit.length > 3 ? `<small>+${hit.length - 3} file</small>` : ''}</span>
        <span class="dtf-result-metri">${Number(e.metri) ? `${dtfMetri(Number(e.metri))} m` : ''}</span>
      </button>
    </li>`;
  }).join('');
  return `
    ${clienti.length ? `<p class="dtf-note">Clienti trovati: ${clienti.map(x => `<button type="button" class="link-btn" onclick="dtfSearchTerzi('');dtfSelectClient('${x.id}')">${escapeHtml(x.nome)}</button>`).join(', ')}</p>` : ''}
    <h3 class="dtf-results-title">File trovati ${r.loading ? '' : `· ${r.rows.length}${r.rows.length === 200 ? '+' : ''}`}</h3>
    ${r.error ? `<div class="empty-list">Ricerca non riuscita: ${escapeHtml(r.error)}</div>`
      : r.loading && !r.rows.length ? '<div class="empty-list">Ricerca in corso…</div>'
      : righe ? `<ol class="dtf-results">${righe}</ol>`
      : `<div class="empty-list">Nessun file trovato per "${escapeHtml(DtfState.qTerzi.trim())}".</div>`}`;
}
// Apre il giorno trovato: cliente, mese e dettaglio dei file
async function dtfOpenResult(clientId, giorno) {
  DtfState.qTerzi = '';
  DtfState.terziResults = null;
  DtfState.clientId = clientId;
  dtfLs.set(DTF_CLIENT_KEY, clientId);
  const d = new Date(giorno + 'T00:00:00');
  DtfState.month = new Date(d.getFullYear(), d.getMonth(), 1);
  await dtfReloadTerzi(false);
  document.querySelector(`.dtf-day[data-date="${giorno}"]`)?.scrollIntoView({ block: 'center' });
  dtfOpenDetail(giorno);
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

// ── Ordine dei clienti: trascina i box ──

function dtfClientDragStart(e, id) {
  DtfState.clientDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  const el = e.currentTarget;
  requestAnimationFrame(() => el.classList.add('dragging'));
}

function dtfClientDragEnd() {
  DtfState.clientDragId = null;
  document.querySelectorAll('.dtf-client-box.dragging, .dtf-client-box.drop-before, .dtf-client-box.drop-after')
    .forEach(el => el.classList.remove('dragging', 'drop-before', 'drop-after'));
}

function dtfClientDragOver(e) {
  if (!DtfState.clientDragId) return;
  e.preventDefault();
  const box = e.currentTarget;
  document.querySelectorAll('.dtf-client-box.drop-before, .dtf-client-box.drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
  if (box.dataset.id === DtfState.clientDragId) return;
  const r = box.getBoundingClientRect();
  box.classList.add(e.clientX < r.left + r.width / 2 ? 'drop-before' : 'drop-after');
}

async function dtfClientDrop(e) {
  e.preventDefault();
  const id = DtfState.clientDragId, target = e.currentTarget;
  if (!id || target.dataset.id === id) { dtfClientDragEnd(); return; }
  const before = target.classList.contains('drop-before');
  dtfClientDragEnd();

  const ids = DtfState.clients.map(c => c.id).filter(x => x !== id);
  ids.splice(ids.indexOf(target.dataset.id) + (before ? 0 : 1), 0, id);
  const prev = TCFactory._settings[DTF_CLIENT_ORDER_KEY];
  TCFactory._settings[DTF_CLIENT_ORDER_KEY] = ids;
  DtfState.clients = dtfSortClients(DtfState.clients);
  dtfRenderClientGrid();
  try {
    await TCFactory.setSetting(DTF_CLIENT_ORDER_KEY, ids);
  } catch {
    TCFactory._settings[DTF_CLIENT_ORDER_KEY] = prev;
    DtfState.clients = dtfSortClients(DtfState.clients);
    dtfRenderClientGrid();
    showToast('Impossibile salvare l\'ordine dei clienti', 'error');
  }
}

function dtfRenderClientGrid() {
  const grid = document.getElementById('dtf-client-grid');
  if (grid) grid.outerHTML = dtfClientGridHtml();
}

// Ordine cambiato da un altro PC: si ridisegnano solo i box
function dtfSyncClientOrder() {
  if (!DtfState.loaded || DtfState.clientDragId || JSON.stringify(dtfClientOrder()) === DtfState.clientOrderSeen) return;
  DtfState.clients = dtfSortClients(DtfState.clients);
  dtfRenderClientGrid();
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
      .upsert({ client_id: clientId, giorno: date, metri: e.metri, dettaglio: e.dettaglio, files: e.files || [] }, { onConflict: 'client_id,giorno' });
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
  Object.keys(DtfState.orderTimers).forEach(id => dtfFlushOrderSave(id));
  Object.entries(DtfState.saveTimers).forEach(([date, t]) => { clearTimeout(t); dtfSaveDay(date); });
  DtfState.saveTimers = {};
}
window.addEventListener('beforeunload', dtfFlushSaves);

// ── Dettaglio: nomi dei file stampati, uno per riga ──

// File del giorno: elenco con misure; i giorni salvati prima delle misure hanno solo i nomi
function dtfFilesOf(date) {
  const e = DtfState.entries[date];
  if (Array.isArray(e?.files) && e.files.length) return e.files.map(f => ({ ...f }));
  return (e?.dettaglio || '').split('\n').map(x => x.trim()).filter(Boolean).map(n => DtfMisure.fromName(n));
}

const dtfFmtCm = (v) => (v > 0 ? String(Math.round(v * 10) / 10).replace('.', ',') : '');

// Cosa stiamo modificando nella finestra dei file
const dtfDetail = () => DtfState.detail || {};

function dtfDetailFiles() {
  const d = dtfDetail();
  if (d.kind === 'order') {
    const o = TCFactory.getOrderById(d.key);
    return (Array.isArray(o?.dtfItems) ? o.dtfItems : []).filter(f => f && f.name).map(f => ({ ...f }));
  }
  return dtfFilesOf(d.key);
}

function dtfOpenOrderFiles(orderId) {
  const o = TCFactory.getOrderById(orderId);
  if (!o) return;
  dtfOpenDetail(null, { kind: 'order', key: orderId, title: o.nome });
}

function dtfOpenDetail(date, target = null) {
  DtfState.detail = target || { kind: 'day', key: date };
  DtfState.detailDate = DtfState.detail.kind === 'day' ? date : null;
  const modal = document.getElementById('dtf-detail-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:720px;" role="dialog" aria-modal="true" aria-labelledby="dtf-d-title">
      <div class="modal-header">
        <h2 id="dtf-d-title">${DtfState.detail.kind === 'order'
          ? `${escapeHtml(DtfState.detail.title)} · file DTF`
          : `${escapeHtml(dtfClient()?.nome || '')} · ${new Date(date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}`}</h2>
        <button class="btn-icon" onclick="dtfCloseDetail()" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:12px;">
        <label class="dtf-drop" id="dtf-drop" tabindex="0"
          ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="dtfDropFiles(event)"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('dtf-file-pick').click()}">
          ${Icons.paperclip(20)}
          <strong>Trascina qui i file o le cartelle stampate, oppure clicca per scegliere i file</strong>
          <span>Le cartelle si leggono con tutte le sottocartelle. Misura e metri si calcolano sul tuo computer: i file non vengono caricati. Pezzi dal nome, es. "logo_10pz.tif"</span>
          <input type="file" id="dtf-file-pick" multiple hidden onchange="dtfAddFiles([...this.files]);this.value=''">
        </label>
        <div class="dtf-folder-row">
          <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('dtf-folder-pick').click()">📁 Scegli una cartella</button>
          <span>anche con sottocartelle: si prendono i PDF, TIFF, PNG e JPG che contiene</span>
          <input type="file" id="dtf-folder-pick" webkitdirectory directory multiple hidden onchange="dtfAddFolderFiles([...this.files]);this.value=''">
        </div>
        <form class="dtf-add-name" onsubmit="event.preventDefault();dtfAddTyped()">
          <input id="dtf-add-name" class="form-input" placeholder="Oppure scrivi un nome e premi Invio" maxlength="240">
          <button type="submit" class="btn btn-secondary btn-sm">${Icons.plus(14)} Aggiungi</button>
        </form>
        <div id="dtf-file-list"></div>
        <p class="settings-section-hint" style="margin:0;">Rotolo ${dtfFmtCm(DtfMisure.rollCm())} cm · margine tra i pezzi ${dtfFmtCm(DtfMisure.marginCm()) || '0'} cm (si cambiano in Impostazioni). Le modifiche si salvano da sole.</p>
      </div>
    </div>`;
  dtfRenderFileList();
  modal.classList.add('active');
  modal.onclick = (ev) => { if (ev.target === modal) dtfCloseDetail(); };
}

function dtfRenderFileList(busy = 0) {
  const box = document.getElementById('dtf-file-list');
  if (!box) return;
  const files = dtfDetailFiles();
  const totale = files.reduce((s, f) => s + (f.metri || 0), 0);
  const senza = files.filter(f => !(f.metri > 0)).length;
  // Tariffa diversa per singolo file: solo nel conto terzi (non per gli ordini interni)
  const isDay = dtfDetail().kind !== 'order';
  const std = Number(dtfClient()?.costo_metro) || 0;
  const fmtEur = (v) => String(v).replace('.', ',');
  const rateRow = (f, i) => !isDay ? '' : `
    <div class="dtf-file-rate">
      <label class="dtf-rate-check"><input type="checkbox" ${f.tariffa_diversa ? 'checked' : ''} onchange="dtfToggleRate(${i}, this.checked)"> Tariffa diversa</label>
      ${f.tariffa_diversa ? `
        <input class="form-input dtf-rate-input" id="dtf-rate-${i}" inputmode="decimal" value="${Number.isFinite(f.tariffa) ? fmtEur(f.tariffa) : ''}"
          placeholder="${fmtEur(std)}" aria-label="Prezzo al metro per ${escapeHtml(f.name)}" onchange="dtfEditRate(${i}, this.value)">
        <span>€/m</span>
        ${!Number.isFinite(f.tariffa) ? '<span class="dtf-tag warn">inserisci il prezzo</span>'
          : f.metri > 0 ? `<strong>= ${euro(f.metri * f.tariffa)}</strong>` : ''}` : ''}
    </div>`;
  const dayCost = isDay ? dtfDayCosto(DtfState.entries[DtfState.detailDate], std).euro : 0;

  const note = (f) => {
    if (f.errore === 'misura mancante') return `<span class="dtf-tag warn">${f.fonte === 'formato' ? 'formato non leggibile: inserisci la misura' : 'inserisci la misura'}</span>`;
    if (f.errore) return `<span class="dtf-tag warn">${escapeHtml(f.errore)}</span>`;
    const tags = [];
    if (f.dpi_ipotizzato) tags.push(`<span class="dtf-tag" title="Il file non indica la risoluzione: usati ${f.dpi} DPI">DPI ${f.dpi} ipotizzato</span>`);
    if (!f.pz_trovati) tags.push('<span class="dtf-tag" title="Nel nome non c\'è &quot;pz&quot;: contato 1 pezzo">pz non nel nome</span>');
    if (f.per_riga > 1) tags.push(`<span class="dtf-tag soft">${f.per_riga} per riga${f.ruotato ? ', ruotato' : ''}</span>`);
    else if (f.ruotato) tags.push('<span class="dtf-tag soft">ruotato</span>');
    return tags.join('');
  };

  box.innerHTML = (files.length ? `
    <div class="dtf-files-head">
      <span>${files.length} ${files.length === 1 ? 'file stampato' : 'file stampati'}</span>
      <strong>${dtfMetri(totale)} m${isDay ? ` · ${euro(dayCost)}` : ''}${senza ? ` <small>(${senza} senza misura)</small>` : ''}</strong>
    </div>
    <ul class="dtf-files">
      ${files.map((f, i) => `
        <li class="dtf-file ${f.metri > 0 ? '' : 'missing'} ${isDay && f.tariffa_diversa ? 'custom-rate' : ''}">
          <div class="dtf-file-top">
            <span class="dtf-file-icon" aria-hidden="true">${Icons.paperclip(14)}</span>
            <span class="dtf-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span class="dtf-file-metri">${f.metri > 0 ? `${dtfMetri(f.metri)} m` : '—'}</span>
            <button type="button" class="btn-icon dtf-file-del" onclick="dtfRemoveFile(${i})" aria-label="Elimina ${escapeHtml(f.name)}" title="Elimina">${Icons.x(14)}</button>
          </div>
          <div class="dtf-file-size">
            <input class="form-input" inputmode="decimal" value="${dtfFmtCm(f.w_cm)}" placeholder="larg." aria-label="Larghezza in cm di ${escapeHtml(f.name)}" onchange="dtfEditFile(${i},'w_cm',this.value)">
            <span>×</span>
            <input class="form-input" inputmode="decimal" value="${dtfFmtCm(f.h_cm)}" placeholder="alt." aria-label="Altezza in cm di ${escapeHtml(f.name)}" onchange="dtfEditFile(${i},'h_cm',this.value)">
            <span>cm ·</span>
            <input class="form-input dtf-pz" inputmode="numeric" value="${f.pz || 1}" aria-label="Pezzi di ${escapeHtml(f.name)}" onchange="dtfEditFile(${i},'pz',this.value)">
            <span>pz</span>
            ${note(f)}
          </div>
          ${rateRow(f, i)}
        </li>`).join('')}
    </ul>` : '<p class="dtf-files-empty">Nessun file per questo giorno.</p>')
    + (busy ? `<p class="dtf-reading">Lettura misure di ${busy} ${busy === 1 ? 'file' : 'file'}…</p>` : '');
}

// Salva l'elenco e aggiorna i metri del giorno con la somma dei file misurati
function dtfSetFiles(files) {
  if (dtfDetail().kind === 'order') { dtfSetOrderFiles(dtfDetail().key, files); dtfRenderFileList(); return; }
  const date = DtfState.detailDate;
  const prev = DtfState.entries[date] || { metri: 0 };
  const misurati = files.filter(f => f.metri > 0);
  const metri = misurati.length ? Math.round(misurati.reduce((s, f) => s + f.metri, 0) * 100) / 100 : prev.metri;
  DtfState.entries[date] = { ...prev, files, dettaglio: files.map(f => f.name).join('\n'), metri };
  dtfQueueSave(date);
  dtfRenderFileList();
  dtfUpdateSummary();
}

// Aggiunge file (oggetti File da trascinamento/scelta) o nomi scritti; salta i doppioni
async function dtfAddFiles(items) {
  const current = dtfDetailFiles();
  const seen = new Set(current.map(f => f.name));
  const fresh = [];
  let dup = 0;
  for (const it of items) {
    const name = String(typeof it === 'string' ? it : it.name).trim();   // File o { file, name } da cartella
    if (!name) continue;
    if (seen.has(name)) { dup++; continue; }
    seen.add(name);
    fresh.push(it);
  }
  if (!fresh.length) { if (dup) showToast('Già presenti nell\'elenco', 'error'); return; }

  const files = fresh.filter(x => typeof x !== 'string');
  if (files.length) dtfRenderFileList(files.length);
  const described = await Promise.all(fresh.map(async x => {
    if (typeof x === 'string') return DtfMisure.fromName(x.trim());
    if (x.file) return { ...(await DtfMisure.describe(x.file)), name: x.name };   // pezzi dal nome del file, nome con il percorso
    return DtfMisure.describe(x);
  }));
  dtfSetFiles([...dtfDetailFiles(), ...described]);

  const daMisurare = described.filter(f => !(f.metri > 0)).length;
  showToast(`${described.length} ${described.length === 1 ? 'file aggiunto' : 'file aggiunti'}`
    + (dup ? ` · ${dup} già ${dup === 1 ? 'presente' : 'presenti'}` : '')
    + (daMisurare ? ` · ${daMisurare} da misurare a mano` : ''), daMisurare ? 'error' : 'success');
}

function dtfAddTyped() {
  const input = document.getElementById('dtf-add-name');
  dtfAddFiles([input.value]);
  input.value = '';
  input.focus();
}

function dtfEditFile(index, field, value) {
  const files = dtfDetailFiles();
  const f = files[index];
  if (!f) return;
  const n = parseFloat(String(value).replace(',', '.'));
  if (field === 'pz') { f.pz = Math.max(1, parseInt(value, 10) || 1); f.pz_trovati = true; }
  else { f[field] = n > 0 ? Math.round(n * 10) / 10 : null; f.dpi_ipotizzato = false; if (f.fonte !== 'manuale') f.fonte = 'corretto'; }
  files[index] = DtfMisure.recompute(f);
  dtfSetFiles(files);
}

function dtfToggleRate(index, on) {
  const files = dtfDetailFiles();
  const f = files[index];
  if (!f) return;
  f.tariffa_diversa = on;
  if (!on) delete f.tariffa;
  dtfSetFiles(files);
  if (on) document.getElementById(`dtf-rate-${index}`)?.focus();
}

function dtfEditRate(index, value) {
  const files = dtfDetailFiles();
  const f = files[index];
  if (!f) return;
  const n = parseFloat(String(value).replace(',', '.'));
  f.tariffa = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  dtfSetFiles(files);
}

function dtfRemoveFile(index) {
  const files = dtfDetailFiles();
  const [removed] = files.splice(index, 1);
  dtfSetFiles(files);
  showToast(`Eliminato "${removed.name}"`);
  const btns = document.querySelectorAll('.dtf-file-del');
  (btns[Math.min(index, btns.length - 1)] || document.getElementById('dtf-add-name'))?.focus();
}

// ── Cartelle (anche con sottocartelle) ──
const DTF_FILE_EXT = /\.(pdf|tiff?|png|jpe?g)$/i;
const dtfHidden = (path) => path.split('/').some(p => p.startsWith('.') || p === '__MACOSX' || p === 'Thumbs.db');

// Nome mostrato: percorso dentro la cartella scelta (senza la cartella stessa), così
// due "fronte.png" in sottocartelle diverse restano distinti
function dtfPathName(file, path) {
  const parts = String(path || file.name).split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0] || file.name;
}

async function dtfAddFolderFiles(list, ignored = 0) {
  const found = [];
  for (const x of list) {
    const file = x.file || x, path = x.path || file.webkitRelativePath || file.name;
    if (dtfHidden(path)) continue;
    if (!DTF_FILE_EXT.test(file.name)) { ignored++; continue; }
    found.push({ file, name: dtfPathName(file, path) });
  }
  if (!found.length) { showToast(ignored ? `Nessun file DTF nella cartella (${ignored} di altro tipo)` : 'La cartella è vuota', 'error'); return; }
  await dtfAddFiles(found);
  if (ignored) showToast(`${ignored} ${ignored === 1 ? 'file ignorato' : 'file ignorati'}: non sono PDF, TIFF, PNG o JPG`);
}

// Legge una cartella trascinata, con tutte le sottocartelle
async function dtfReadEntry(entry, out) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
    if (file) out.push({ file, path: entry.fullPath.replace(/^\//, '') });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {   // readEntries restituisce i file a blocchi: si legge finché non torna vuoto
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
      if (!batch.length) break;
      for (const child of batch) await dtfReadEntry(child, out);
    }
  }
}

async function dtfDropFiles(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  // Le voci vanno prese subito: dopo il primo await il trascinamento non è più leggibile
  const entries = [...(e.dataTransfer?.items || [])].map(i => i.kind === 'file' && i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.some(en => en.isDirectory)) { dtfAddFiles([...(e.dataTransfer?.files || [])]); return; }

  dtfRenderFileList(1);
  const loose = [], fromFolders = [];
  for (const en of entries) {
    if (en.isDirectory) await dtfReadEntry(en, fromFolders);
    else { const f = await new Promise(r => en.file(r, () => r(null))); if (f) loose.push(f); }
  }
  if (loose.length) await dtfAddFiles(loose);
  if (fromFolders.length || !loose.length) await dtfAddFolderFiles(fromFolders);
  else dtfRenderFileList();
}

function dtfCloseDetail() {
  const d = dtfDetail();
  if (d.kind === 'order') dtfFlushOrderSave(d.key);
  const date = DtfState.detailDate;
  if (date && DtfState.saveTimers[date]) { clearTimeout(DtfState.saveTimers[date]); delete DtfState.saveTimers[date]; dtfSaveDay(date); }
  closeModal('dtf-detail-modal');
  DtfState.detailDate = null;
  DtfState.detail = null;
  if (d.kind === 'order') renderDtfInterno(); else renderDtfTerzi();
}

// File dell'ordine: aggiornati subito in pagina, salvati sull'ordine poco dopo
function dtfSetOrderFiles(orderId, files) {
  const o = TCFactory.getOrderById(orderId);
  if (!o) return;
  o.dtfItems = files;
  clearTimeout(DtfState.orderTimers[orderId]);
  DtfState.orderTimers[orderId] = setTimeout(() => dtfSaveOrderFiles(orderId), DTF_SAVE_DELAY);
}

async function dtfSaveOrderFiles(orderId) {
  delete DtfState.orderTimers[orderId];
  const o = TCFactory.getOrderById(orderId);
  if (!o) return;
  try { await TCFactory.updateOrder(orderId, { dtfItems: o.dtfItems || [] }); }
  catch (e) { console.error('[dtf ordine]', e); showToast(`File di "${o.nome}" non salvati: riprova`, 'error'); }
}

function dtfFlushOrderSave(orderId) {
  if (!DtfState.orderTimers[orderId]) return;
  clearTimeout(DtfState.orderTimers[orderId]);
  dtfSaveOrderFiles(orderId);
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
          <div class="form-group"><label class="form-label" for="dtf-c-dal">Il link mostra i dati dal</label>
            <input id="dtf-c-dal" type="date" class="form-input">
            <span class="settings-section-hint" style="margin:4px 0 0;">Vuoto = il cliente vede tutto lo storico.</span>
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
  DtfState.accessDal = null;   // null finché non si conosce il valore salvato
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
  const dal = document.getElementById('dtf-c-dal');
  if (dal) { dal.value = info.visibile_dal || ''; DtfState.accessDal = dal.value; }
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
    const dal = document.getElementById('dtf-c-dal').value;
    if ((id ? DtfState.accessDal !== null : true) && dal !== (DtfState.accessDal || '')) {
      await dtfAccessRpc('dtf_set_visibile_dal', { p_client_id: res.data.id, p_dal: dal || null });
    }
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

// Pagina Interne: dashboard a blocchi oppure la scheda scelta
async function openDtfPage() {
  const section = dtfSection();
  document.getElementById('interne-dash-root').hidden = section !== null;
  document.getElementById('interne-lav-root').hidden = !section || ['interno', 'terzi'].includes(section);
  document.getElementById('dtf-interno-root').hidden = section !== 'interno';
  document.getElementById('dtf-terzi-root').hidden = section !== 'terzi';
  if (!section) { renderInterneDashboard(); return; }
  if (!['interno', 'terzi'].includes(section)) { renderInterneLav(section); return; }
  if (!DtfState.month) DtfState.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  if (!DtfState.clientId) DtfState.clientId = dtfLs.get(DTF_CLIENT_KEY);

  renderDtfInterno();
  if (!DtfState.loaded) document.getElementById('dtf-terzi-root').innerHTML =
    '<div class="dtf-box-head"><div><h2>DTF Conto terzi</h2></div></div><div class="empty-list">Caricamento…</div>';

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

// ─────────────────────────────────────────────
// DASHBOARD INTERNE
// ─────────────────────────────────────────────

function renderInterneDashboard() {
  const root = document.getElementById('interne-dash-root');
  if (!root) return;
  const daStampare = dtfLists().todo.length;
  const info = {
    interno: `${daStampare} ${daStampare === 1 ? 'ordine' : 'ordini'} da stampare`,
    terzi:   DtfState.loaded || DtfState._dashClients ? `${DtfState.clients.length} ${DtfState.clients.length === 1 ? 'cliente' : 'clienti'}` : '',
  };
  const sections = interneSections();
  sections.filter(s => !['interno', 'terzi'].includes(s.id)).map(s => s.id).forEach(id => {
    const n = interneOrders(id).filter(x => !interneDone(x.order, id)).length;
    info[id] = `${n} ${n === 1 ? 'ordine' : 'ordini'} da fare`;
  });
  root.innerHTML = sections.map(s => `
    <a href="#/dtf/${s.id}" class="glass-card interne-block ${s.ready ? '' : 'soon'}" onclick="event.preventDefault();Nav.go('dtf','${s.id}')">
      <span class="interne-block-icon" aria-hidden="true">${s.icon()}</span>
      <span class="interne-block-text">
        <strong>${s.label}</strong>
        <small>${s.subtitle}</small>
      </span>
      <span class="interne-block-info">${s.ready ? escapeHtml(info[s.id] || '') : '<span class="chip chip-muted">In preparazione</span>'}</span>
      <span class="interne-block-arrow" aria-hidden="true">${Icons.chevronRight(18)}</span>
    </a>`).join('');

  // Numero di clienti conto terzi: si carica in sottofondo una volta sola
  // (il flag va messo subito, altrimenti ogni ridisegno ripartirebbe il caricamento all'infinito)
  if (!DtfState.loaded && !DtfState._dashClients) {
    DtfState._dashClients = true;
    dtfLoadClients()
      .then(() => { if (Nav.current === 'dtf' && !dtfSection()) renderInterneDashboard(); })
      .catch(() => {});
  }
}

// ─────────────────────────────────────────────
// SCHEDE UV / LASER / STAMPA
// Ordini con righe del modulo segnate con quella lavorazione INTERNA.
// "Completata" si salva nel modulo d'ordine: orderModule.interneFatte[<id lavorazione>] = data
// ─────────────────────────────────────────────

const InterneLavState = { tab: 'todo' };

// Id della lavorazione interna di una scheda (per id, oppure per nome se rinominata/ricreata)
function interneLavId(section) {
  const lav = interneSections().find(s => s.id === section)?.lav;
  if (!lav) return null;
  const list = getLavInterne();
  return (list.find(l => l.id === lav.id) || list.find(l => l.nome.toLowerCase() === lav.nome.toLowerCase()))?.id || lav.id;
}
const interneRows = (o) => (o.orderModule?.rows || []).filter(r => r.interna);
const interneDone = (o, section) => !!o.orderModule?.interneFatte?.[interneLavId(section)];

function interneOrders(section) {
  const lavId = interneLavId(section);
  return TCFactory.getOrders()
    .filter(o => !o.deletedAt && !o.archived && !TCFactory.isNeutro(o))
    .map(o => ({ order: o, rows: interneRows(o).filter(r => r.interna === lavId), tipo: orderLavInterne(o).includes(lavId) }))
    .filter(x => x.rows.length || x.tipo);
}

function renderInterneLav(section) {
  const root = document.getElementById('interne-lav-root');
  const s = interneSections().find(x => x.id === section);
  if (!root || !s) return;
  const done = InterneLavState.tab === 'done';
  const today = localISODate(new Date());
  const fmt = (d) => TCFactory.formatDate(d, { day: '2-digit', month: '2-digit' });
  const all = interneOrders(section);
  const nTodo = all.filter(x => !interneDone(x.order, section)).length;
  const items = all.filter(x => interneDone(x.order, section) === done).sort((a, b) => {
    const da = TCFactory.getEffectiveDeadline(a.order)?.date || '9999', db = TCFactory.getEffectiveDeadline(b.order)?.date || '9999';
    return (isUrgentOrder(b.order) - isUrgentOrder(a.order)) || da.localeCompare(db);
  });
  const rowsText = (rows) => rows.map(r => [r.qnt ? `${r.qnt}×` : '', r.descrizione || r.codice || r.catalogo || '', r.colore || '', r.tg || '']
    .filter(Boolean).join(' ')).filter(Boolean);

  const item = ({ order: o, rows }) => {
    const dl = TCFactory.getEffectiveDeadline(o);
    const client = TCFactory.getClient(o.clientId);
    const fatta = o.orderModule?.interneFatte?.[interneLavId(section)];
    const lines = rowsText(rows);
    return `
      <li class="dtf-item est-item ${isUrgentOrder(o) ? 'dtf-urgent' : ''}">
        <div class="dtf-when ${!done && dl && dl.date < today ? 'late' : ''}" title="Scadenza">
          <strong>${dl ? fmt(dl.date) : '—'}</strong>
          <span>${dl ? new Date(dl.date + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short' }) : ''}</span>
        </div>
        <button type="button" class="dtf-main" onclick="openOrderDetail('${o.id}')">
          <strong>${escapeHtml(o.nome)}${isUrgentOrder(o) ? ' <em class="est-urgent">Urgente</em>' : ''}</strong>
          <span>${[orderDesc(o) ? escapeHtml(orderDesc(o)) : '', client && TCFactory.clientName(client) !== o.nome ? escapeHtml(TCFactory.clientName(client)) : '', o.tags.map(escapeHtml).join(', ')].filter(Boolean).join(' · ') || '&nbsp;'}</span>
        </button>
        <div class="est-rows" title="${escapeHtml(lines.join('\n'))}">
          ${lines.length ? lines.slice(0, 2).map(l => `<span>${escapeHtml(l)}</span>`).join('') + (lines.length > 2 ? `<small>+${lines.length - 2} righe</small>` : '') : `<small>${rows.length ? 'Righe senza dettagli' : 'Nessuna riga nel modulo'}</small>`}
        </div>
        ${done
          ? `<span class="est-done-date">${typeof fatta === 'string' ? 'Completata ' + fmt(fatta) : 'Completata'}</span>
             <button type="button" class="btn btn-ghost btn-sm" onclick="interneToggle('${o.id}', '${section}', false)">Riapri</button>`
          : `<button type="button" class="btn btn-sm dtf-done-btn" onclick="interneToggle('${o.id}', '${section}', true)">${Icons.checkCircle('currentColor', 15)} Completata</button>`}
      </li>`;
  };

  root.innerHTML = `
    <div class="glass-card page-card dtf-box">
      <div class="dtf-box-head">
        <div><h2>${s.label}</h2><p>Ordini con lavorazione interna <strong>${escapeHtml(getLavInterne().find(l => l.id === interneLavId(section))?.nome || s.lav.nome)}</strong>, spuntata nell'ordine o nella colonna INTERNA del modulo d'ordine</p></div>
      </div>
      <div class="est-bar">
        <div class="segmented" role="tablist" aria-label="Stato">
          <button role="tab" type="button" aria-selected="${!done}" class="${!done ? 'active' : ''}" onclick="InterneLavState.tab='todo';renderInterneLav('${section}')">Da fare · ${nTodo}</button>
          <button role="tab" type="button" aria-selected="${done}" class="${done ? 'active' : ''}" onclick="InterneLavState.tab='done';renderInterneLav('${section}')">Completate · ${all.length - nTodo}</button>
        </div>
      </div>
      ${items.length ? `<ol class="dtf-timeline">${items.map(item).join('')}</ol>`
        : `<div class="empty-list">${done ? 'Nessun ordine completato' : `Nessun ordine da fare. Gli ordini compaiono qui quando hanno la lavorazione interna ${escapeHtml(s.lav.nome)}.`}</div>`}
    </div>`;
}

async function interneToggle(orderId, section, done) {
  const o = TCFactory.getOrderById(orderId);
  if (!o) return;
  const lavId = interneLavId(section);
  const fatte = { ...(o.orderModule?.interneFatte || {}) };
  if (done) fatte[lavId] = localISODate(new Date()); else delete fatte[lavId];
  try {
    await TCFactory.updateOrder(orderId, { orderModule: { ...(o.orderModule || {}), interneFatte: fatte } });
    const label = interneSections().find(s => s.id === section)?.label;
    TCFactory._log(`${done ? '✓' : '☐'} ${label}`, orderId, o.nome, { interna: lavId, done });
    TCFactory._notify();
  } catch (e) { showToast('Errore — riprova', 'error'); }
  renderInterneLav(section);
}
