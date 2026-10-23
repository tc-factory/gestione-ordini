/**
 * T&C Factory — Clienti
 * Anagrafica, scheda cliente con storico ordini, collegamento ordini esistenti.
 */

const ClientState = {
  search: '',
  tipo: 'tutti',          // 'tutti' | 'azienda' | 'privato'
  formTipo: 'azienda',
  linkSearch: '',
  linkSelected: [],
  catSearch: '',           // aggiungi prodotti al catalogo
  catCategoria: '',
  catSelected: [],
};

const euro = (n) => '€ ' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Stato leggibile di un ordine, dal più avanzato
function orderStatus(o) {
  if (o.archived)                    return { label: 'Archiviato',     color: '#22c55e' };
  if (Pulsanti.isEvaso(o))           return { label: 'Evaso',          color: '#0ea5e9' };
  if (Pulsanti.chiusa(o))            return { label: 'In evasione',   color: '#f97316' };
  return                                    { label: 'In lavorazione', color: 'var(--brand-gold)' };
}

function clientTotals(orders) {
  const tot       = orders.reduce((s, o) => s + (o.importo || 0), 0);
  const riscosso  = orders.filter(o => o.paymentDone).reduce((s, o) => s + (o.importo || 0), 0);
  return { tot, riscosso, daRiscuotere: tot - riscosso };
}

// Opzioni del menu Cliente nel form ordine
function renderClientOptions(selectedId) {
  return `<option value="">— Nessun cliente —</option>` +
    TCFactory.getClients().map(c =>
      `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(TCFactory.clientName(c))}</option>`
    ).join('');
}

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

function renderClientsPage() {
  const root = document.getElementById('clienti-root');
  if (!root) return;

  if (!TCFactory.isClientsAvailable()) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.users(28)}</div>
        <h2>Database clienti da attivare</h2>
        <p>Esegui lo script <strong>sql/clienti-setup.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }

  const client = Nav.param ? TCFactory.getClient(Nav.param) : null;
  if (Nav.param && !client) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <h2>Cliente non trovato</h2>
        <p>Potrebbe essere stato eliminato.</p>
        <button class="btn btn-secondary" onclick="Nav.go('clienti')">Torna ai clienti</button>
      </div>`;
    return;
  }
  root.innerHTML = client ? renderClientDetail(client) : renderClientList();
}

function setClientSearch(v) {
  ClientState.search = v;
  renderClientsPage();
  const el = document.getElementById('client-search');
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
}
function setClientTipo(t) { ClientState.tipo = t; renderClientsPage(); }

function renderClientList() {
  const q = ClientState.search.trim().toLowerCase();
  const all = TCFactory.getClients();
  const list = all.filter(c => {
    if (ClientState.tipo !== 'tutti' && c.tipo !== ClientState.tipo) return false;
    if (!q) return true;
    return [TCFactory.clientName(c), c.referente, c.email, c.telefono, c.citta, c.partita_iva, c.codice_fiscale]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  const rows = list.map(c => {
    const orders = TCFactory.getOrdersForClient(c.id);
    const { daRiscuotere } = clientTotals(orders);
    const last = orders.map(o => o.dataOrdine).filter(Boolean).sort().pop();
    return `
      <tr class="data-row" tabindex="0" onclick="Nav.go('clienti','${c.id}')" onkeydown="if(event.key==='Enter')Nav.go('clienti','${c.id}')">
        <td>
          <div class="client-cell">
            <span><strong>${escapeHtml(TCFactory.clientName(c))}</strong>
              <small>${c.tipo === 'privato' ? 'Privato' : 'Azienda'}${c.referente ? ' · ' + escapeHtml(c.referente) : ''}</small></span>
          </div>
        </td>
        <td class="hide-sm"><div class="cell-stack">${c.email ? `<span>${escapeHtml(c.email)}</span>` : ''}${c.telefono ? `<small>${escapeHtml(c.telefono)}</small>` : ''}</div></td>
        <td class="hide-sm">${escapeHtml([c.citta, c.provincia && `(${c.provincia})`].filter(Boolean).join(' '))}</td>
        <td class="num" data-label="Ordini">${orders.length}</td>
        <td class="num" data-label="Da riscuotere" style="${daRiscuotere > 0 ? 'color:#ef4444;font-weight:700;' : 'color:var(--text-muted);'}">${daRiscuotere > 0 ? euro(daRiscuotere) : '—'}</td>
        <td class="hide-sm">${last ? TCFactory.formatDate(last) : '—'}</td>
      </tr>`;
  }).join('');

  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <div class="search-box">
          ${Icons.search()}
          <input id="client-search" type="text" placeholder="Cerca nome, città, P.IVA, email…" value="${escapeHtml(ClientState.search)}" oninput="setClientSearch(this.value)">
        </div>
        <div class="segmented" role="tablist" aria-label="Tipo cliente">
          ${[['tutti','Tutti'],['azienda','Aziende'],['privato','Privati']].map(([id, l]) =>
            `<button role="tab" aria-selected="${ClientState.tipo===id}" class="${ClientState.tipo===id?'active':''}" onclick="setClientTipo('${id}')">${l}</button>`).join('')}
        </div>
        <span class="table-count">${list.length} di ${all.length}</span>
      </div>
      ${all.length === 0 ? `
        <div class="empty-list">
          Nessun cliente ancora.<br><br>
          <button class="btn btn-primary" onclick="openClientForm()">${Icons.plus()} Crea il primo cliente</button>
        </div>` : list.length === 0 ? `<div class="empty-list">Nessun risultato.</div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm">
          <thead><tr>
            <th>Cliente</th><th class="hide-sm">Contatti</th><th class="hide-sm">Città</th>
            <th class="num">Ordini</th><th class="num">Da riscuotere</th><th class="hide-sm">Ultimo ordine</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>`;
}

function renderClientDetail(c) {
  const orders = TCFactory.getOrdersForClient(c.id).sort((a, b) => (b.dataOrdine || '').localeCompare(a.dataOrdine || ''));
  const { tot, riscosso, daRiscuotere } = clientTotals(orders);

  const field = (label, value, href) => value
    ? `<div class="def-row"><dt>${label}</dt><dd>${href ? `<a href="${href}">${escapeHtml(value)}</a>` : escapeHtml(value)}</dd></div>` : '';
  const address = [c.indirizzo, [c.cap, c.citta, c.provincia && `(${c.provincia})`].filter(Boolean).join(' '), c.nazione !== 'Italia' ? c.nazione : '']
    .filter(Boolean).join(', ');

  return `
    <button class="btn btn-ghost btn-sm back-link" onclick="Nav.go('clienti')">${Icons.chevronLeft(14)} Tutti i clienti</button>

    <div class="glass-card client-hero">
      <div class="client-hero-text">
        <h2>${escapeHtml(TCFactory.clientName(c))}</h2>
        <p>${c.tipo === 'privato' ? 'Privato' : 'Azienda'}${c.partita_iva ? ' · P.IVA ' + escapeHtml(c.partita_iva) : ''}${c.codice_fiscale ? ' · CF ' + escapeHtml(c.codice_fiscale) : ''}</p>
      </div>
      <div class="client-hero-actions">
        <button class="btn btn-secondary btn-sm" onclick="openClientForm('${c.id}')">${Icons.edit(14)} Modifica</button>
        <button class="btn btn-primary btn-sm" onclick="openOrderForm(null, null, '${c.id}')">${Icons.plus(14)} Nuovo ordine</button>
        <button class="btn-icon" style="color:var(--priority-urgent);" onclick="deleteClientConfirm('${c.id}')" aria-label="Elimina cliente" title="Elimina cliente">${Icons.trash(16)}</button>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="glass-card kpi"><span>Ordini</span><strong>${orders.length}</strong></div>
      <div class="glass-card kpi"><span>Totale ordinato</span><strong>${euro(tot)}</strong></div>
      <div class="glass-card kpi"><span>Riscosso</span><strong style="color:#16a34a;">${euro(riscosso)}</strong></div>
      <div class="glass-card kpi"><span>Da riscuotere</span><strong style="color:${daRiscuotere > 0 ? '#ef4444' : 'inherit'};">${euro(daRiscuotere)}</strong></div>
    </div>

    <div class="client-grid">
      <div class="glass-card page-card">
        <div class="page-card-head">${Icons.idBadge(16)} <h2>Anagrafica</h2></div>
        <dl class="page-card-body def-list">
          ${c.tipo === 'azienda' ? field('Ragione sociale', c.ragione_sociale) : ''}
          ${field(c.tipo === 'azienda' ? 'Referente' : 'Nome', c.tipo === 'azienda' ? c.referente : `${c.nome} ${c.cognome}`.trim())}
          ${field('Partita IVA', c.partita_iva)}
          ${field('Codice fiscale', c.codice_fiscale)}
          ${field('Codice SDI', c.codice_sdi)}
          ${field('PEC', c.pec, c.pec && 'mailto:' + c.pec)}
          ${field('Email', c.email, c.email && 'mailto:' + c.email)}
          ${field('Telefono', c.telefono, c.telefono && 'tel:' + c.telefono.replace(/\s+/g, ''))}
          ${field('Indirizzo', address)}
          ${c.note ? `<div class="def-row def-row-block"><dt>Note</dt><dd style="white-space:pre-wrap;">${escapeHtml(c.note)}</dd></div>` : ''}
          <div class="def-row"><dt>Creato</dt><dd style="color:var(--text-muted);">${new Date(c.created_at).toLocaleDateString('it-IT')} da ${escapeHtml(c.created_by)}</dd></div>
        </dl>
      </div>

      <div class="glass-card page-card">
        <div class="page-card-head">
          ${Icons.package(16)} <h2>Storico ordini</h2>
          <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="openLinkOrders('${c.id}')">${Icons.paperclip(13)} Collega ordini esistenti</button>
        </div>
        ${orders.length === 0 ? `<div class="empty-list">Nessun ordine collegato a questo cliente.</div>` : `
        <div class="table-scroll">
          <table class="data-table cards-sm">
            <thead><tr><th>Data</th><th>Ordine</th><th>Stato</th><th class="num">Importo</th><th>Pagamento</th><th></th></tr></thead>
            <tbody>
              ${orders.map(o => {
                const st = orderStatus(o);
                return `<tr class="data-row" tabindex="0" onclick="openOrderDetail('${o.id}')" onkeydown="if(event.key==='Enter')openOrderDetail('${o.id}')">
                  <td class="cell-date">${TCFactory.formatDate(o.dataOrdine)}</td>
                  <td class="cell-main"><strong>${escapeHtml(o.nome)}</strong><small class="muted-id">${TCFactory.orderCode(o)}</small></td>
                  <td class="cell-status"><span class="status-dot" style="--st:${st.color};">${st.label}</span></td>
                  <td class="num cell-amount">${o.importo ? euro(o.importo) : '—'}</td>
                  <td class="cell-pay">${o.paymentDone
                    ? `<span class="pay-badge paid">Riscosso${o.paymentDate ? ' ' + TCFactory.formatDate(o.paymentDate, { day: '2-digit', month: '2-digit' }) : ''}</span>`
                    : `<span class="pay-badge due">Da riscuotere</span>`}</td>
                  <td class="cell-action"><button class="btn-icon" onclick="event.stopPropagation();unlinkOrderConfirm('${o.id}')" aria-label="Scollega ordine dal cliente" title="Scollega dal cliente">${Icons.x(13)}</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>

    ${renderClientCatalog(c)}`;
}

async function deleteClientConfirm(id) {
  const c = TCFactory.getClient(id);
  const n = TCFactory.getOrdersForClient(id).length;
  if (!confirm(`Eliminare "${TCFactory.clientName(c)}"?${n ? `\n\nI suoi ${n} ordini resteranno, ma senza cliente.` : ''}`)) return;
  try {
    await TCFactory.deleteClient(id);
    showToast('Cliente eliminato');
    Nav.go('clienti');
  } catch (e) { showToast('Errore eliminazione cliente', 'error'); }
}

async function unlinkOrderConfirm(orderId) {
  const o = TCFactory.getOrderById(orderId);
  if (!confirm(`Scollegare "${o?.nome}" da questo cliente?`)) return;
  try {
    await TCFactory.setOrderClient(orderId, null);
    showToast('Ordine scollegato');
  } catch (e) { showToast('Errore', 'error'); }
}

// ─────────────────────────────────────────────
// MODULO CLIENTE
// ─────────────────────────────────────────────

let _clientFormCallback = null;

function openClientForm(id = null, onSaved = null, prefill = '') {
  const c = id ? TCFactory.getClient(id) : null;
  _clientFormCallback = onSaved;
  ClientState.formTipo = c?.tipo || 'azienda';

  const v = (k) => escapeHtml(c?.[k] ?? (k === 'nazione' ? 'Italia' : ''));
  const input = (k, label, attrs = '') => `
    <div class="form-group">
      <label class="form-label" for="cf-${k}">${label}</label>
      <input id="cf-${k}" class="form-input" value="${v(k)}" ${attrs}>
    </div>`;

  const modal = document.getElementById('client-form-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:720px;" role="dialog" aria-modal="true" aria-labelledby="cf-title">
      <div class="modal-header">
        <h2 id="cf-title">${c ? 'Modifica cliente' : 'Nuovo cliente'}</h2>
        <button class="btn-icon" onclick="closeModal('client-form-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:18px;">
        <div class="segmented" role="tablist" aria-label="Tipo cliente" id="cf-tipo" style="align-self:flex-start;">
          <button role="tab" type="button" data-tipo="azienda" onclick="setClientFormTipo('azienda')">Azienda</button>
          <button role="tab" type="button" data-tipo="privato" onclick="setClientFormTipo('privato')">Privato</button>
        </div>

        <fieldset class="form-section">
          <legend>Dati principali</legend>
          <div class="form-row only-azienda">${input('ragione_sociale', 'Ragione sociale *', 'maxlength="160"')}${input('referente', 'Referente', 'maxlength="120"')}</div>
          <div class="form-row only-privato">${input('nome', 'Nome *', 'maxlength="80" autocomplete="off"')}${input('cognome', 'Cognome', 'maxlength="80" autocomplete="off"')}</div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Dati fiscali</legend>
          <div class="form-row">
            ${input('partita_iva', 'Partita IVA', 'maxlength="20" inputmode="numeric"')}
            ${input('codice_fiscale', 'Codice fiscale', 'maxlength="16" style="text-transform:uppercase;"')}
          </div>
          <div class="form-row">
            ${input('codice_sdi', 'Codice SDI', 'maxlength="7" style="text-transform:uppercase;"')}
            ${input('pec', 'PEC', 'type="email" maxlength="160"')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Contatti</legend>
          <div class="form-row">
            ${input('email', 'Email', 'type="email" maxlength="160"')}
            ${input('telefono', 'Telefono', 'type="tel" maxlength="40"')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Indirizzo</legend>
          ${input('indirizzo', 'Via e numero civico', 'maxlength="200"')}
          <div class="form-row addr-row">
            ${input('cap', 'CAP', 'maxlength="10" inputmode="numeric"')}
            ${input('citta', 'Città', 'maxlength="100"')}
            ${input('provincia', 'Prov.', 'maxlength="4" style="text-transform:uppercase;"')}
            ${input('nazione', 'Nazione', 'maxlength="60"')}
          </div>
        </fieldset>

        <div class="form-group">
          <label class="form-label" for="cf-note">Note</label>
          <textarea id="cf-note" class="form-textarea" maxlength="2000">${v('note')}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('client-form-modal')">Annulla</button>
        <button class="btn btn-primary" id="cf-save" onclick="submitClientForm(${c ? `'${c.id}'` : 'null'})">${c ? 'Salva modifiche' : 'Crea cliente'}</button>
      </div>
    </div>`;
  setClientFormTipo(ClientState.formTipo);
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('client-form-modal'); };
  if (!c && prefill) { const f = document.getElementById('cf-ragione_sociale'); if (f) f.value = prefill; }
  setTimeout(() => document.getElementById(ClientState.formTipo === 'azienda' ? 'cf-ragione_sociale' : 'cf-nome')?.focus(), 50);
}

function setClientFormTipo(tipo) {
  ClientState.formTipo = tipo;
  const modal = document.getElementById('client-form-modal');
  modal.querySelectorAll('#cf-tipo button').forEach(b => {
    const on = b.dataset.tipo === tipo;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  modal.querySelectorAll('.only-azienda').forEach(el => { el.hidden = tipo !== 'azienda'; });
  modal.querySelectorAll('.only-privato').forEach(el => { el.hidden = tipo !== 'privato'; });
}

async function submitClientForm(id) {
  const get = (k) => document.getElementById('cf-' + k)?.value?.trim() || '';
  const tipo = ClientState.formTipo;
  const fields = { tipo };
  TCFactory.CLIENT_FIELDS.filter(k => k !== 'tipo').forEach(k => { fields[k] = get(k); });
  ['codice_fiscale', 'codice_sdi', 'provincia'].forEach(k => { fields[k] = fields[k].toUpperCase(); });

  // Campi dell'altro tipo non vengono salvati
  if (tipo === 'azienda') { fields.nome = ''; fields.cognome = ''; }
  else { fields.ragione_sociale = ''; }

  const invalid = (k, msg) => {
    const el = document.getElementById('cf-' + k);
    el?.focus();
    el?.setAttribute('aria-invalid', 'true');
    el?.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
    showToast(msg, 'error');
  };
  if (tipo === 'azienda' && !fields.ragione_sociale) return invalid('ragione_sociale', 'Inserisci la ragione sociale');
  if (tipo === 'privato' && !fields.nome && !fields.cognome) return invalid('nome', 'Inserisci nome o cognome');
  const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  if (!emailOk(fields.email)) return invalid('email', 'Email non valida');
  if (!emailOk(fields.pec))   return invalid('pec', 'PEC non valida');

  const btn = document.getElementById('cf-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    const saved = await TCFactory.saveClient(id, fields);
    closeModal('client-form-modal');
    showToast(id ? 'Cliente aggiornato' : `Cliente "${TCFactory.clientName(saved)}" creato`);
    if (_clientFormCallback) _clientFormCallback(saved);
    else if (!id) Nav.go('clienti', saved.id);
  } catch (e) {
    console.error('[cliente]', e);
    showToast('Errore durante il salvataggio — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Salva modifiche' : 'Crea cliente'; }
  }
}

// ─────────────────────────────────────────────
// COLLEGA ORDINI ESISTENTI
// ─────────────────────────────────────────────

function openLinkOrders(clientId) {
  ClientState.linkSearch = '';
  ClientState.linkSelected = [];
  renderLinkOrders(clientId);
  const modal = document.getElementById('client-link-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('client-link-modal'); };
  setTimeout(() => document.getElementById('link-search')?.focus(), 50);
}

function renderLinkOrders(clientId) {
  const q = ClientState.linkSearch.trim().toLowerCase();
  const free = TCFactory.getOrders()
    .filter(o => !o.deletedAt && !o.clientId)
    .filter(o => !q || o.nome.toLowerCase().includes(q) || TCFactory.orderCode(o).includes(q))
    .sort((a, b) => (b.dataOrdine || '').localeCompare(a.dataOrdine || ''));
  const n = ClientState.linkSelected.length;

  document.getElementById('client-link-modal').innerHTML = `
    <div class="modal" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="lo-title">
      <div class="modal-header">
        <h2 id="lo-title">Collega ordini a ${escapeHtml(TCFactory.clientName(TCFactory.getClient(clientId)))}</h2>
        <button class="btn-icon" onclick="closeModal('client-link-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <div class="search-box" style="width:100%;">
          ${Icons.search()}
          <input id="link-search" type="text" style="width:100%;" placeholder="Cerca tra gli ordini senza cliente…" value="${escapeHtml(ClientState.linkSearch)}"
            oninput="ClientState.linkSearch=this.value;renderLinkOrders('${clientId}');const el=document.getElementById('link-search');el.focus();el.setSelectionRange(el.value.length,el.value.length);">
        </div>
        <div class="link-list">
          ${free.length === 0 ? `<div class="empty-list" style="padding:24px;">Nessun ordine senza cliente${q ? ' per questa ricerca' : ''}.</div>` :
            free.map(o => `
              <label class="link-row">
                <input type="checkbox" ${ClientState.linkSelected.includes(o.id) ? 'checked' : ''} onchange="toggleLinkOrder('${o.id}', this.checked, '${clientId}')">
                <span style="flex:1;min-width:0;"><strong>${escapeHtml(o.nome)}</strong><small>${TCFactory.orderCode(o)} · ${TCFactory.formatDate(o.dataOrdine)}</small></span>
                <span style="font-size:0.8rem;color:var(--text-secondary);">${o.importo ? euro(o.importo) : ''}</span>
              </label>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('client-link-modal')">Annulla</button>
        <button class="btn btn-primary" id="lo-save" ${n ? '' : 'disabled'} onclick="submitLinkOrders('${clientId}')">Collega ${n || ''} ${n === 1 ? 'ordine' : 'ordini'}</button>
      </div>
    </div>`;
}

function toggleLinkOrder(orderId, on, clientId) {
  ClientState.linkSelected = on
    ? [...ClientState.linkSelected, orderId]
    : ClientState.linkSelected.filter(id => id !== orderId);
  const btn = document.getElementById('lo-save');
  const n = ClientState.linkSelected.length;
  if (btn) { btn.disabled = !n; btn.textContent = `Collega ${n || ''} ${n === 1 ? 'ordine' : 'ordini'}`; }
}

async function submitLinkOrders(clientId) {
  const ids = [...ClientState.linkSelected];
  const btn = document.getElementById('lo-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Collegamento…'; }
  let ok = 0;
  for (const id of ids) {
    try { await TCFactory.updateOrder(id, { clientId }); ok++; } catch (e) { console.error('[collega]', id, e); }
  }
  closeModal('client-link-modal');
  TCFactory._notify();
  showToast(ok === ids.length ? `${ok} ${ok === 1 ? 'ordine collegato' : 'ordini collegati'}` : `Collegati ${ok} su ${ids.length}: riprova per gli altri`, ok === ids.length ? 'success' : 'error');
}

// ─────────────────────────────────────────────
// APP CLIENTI: accessi e catalogo del cliente
// Il cliente vede solo i prodotti del suo catalogo, al prezzo deciso qui;
// nome, prezzo di rivendita e scorte li gestisce lui dall'app.
// ─────────────────────────────────────────────

function renderClientCatalog(c) {
  if (!TCFactory.isProductsAvailable()) return '';
  if (!TCFactory.isCatalogAvailable()) return `
    <div class="glass-card page-card client-app-section">
      <div class="page-card-head">${Icons.shirt(16)} <h2>Catalogo nell'app clienti</h2></div>
      <div class="page-card-body settings-section-hint" style="margin:0;">Per attivarlo esegui lo script <strong>sql/cataloghi-clienti.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</div>
    </div>`;

  const users = TCFactory.getCatalogUsers(c.id);
  const items = TCFactory.getClientCatalog(c.id);
  const showCost = TCAuth.canViewEconomics();
  const money = (n) => n === null || n === undefined ? '<span class="muted">—</span>' : euro(n);

  return `
    <div class="client-app-section">
    <div class="glass-card page-card">
      <div class="page-card-head">
        ${Icons.lock(16)} <h2>Accesso all'app clienti</h2>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="openCatalogUserForm('${c.id}')">${Icons.plus(13)} Nuovo accesso</button>
      </div>
      ${users.length === 0 ? `<div class="empty-list">Nessun accesso: crea email e password con cui il cliente entra nell'app.</div>` : `
      <div class="catalog-users">
        ${users.map(u => `
          <div class="catalog-user">
            <strong>${escapeHtml(u.email)}</strong>
            <small class="muted">creato il ${new Date(u.created_at).toLocaleDateString('it-IT')} da ${escapeHtml(u.created_by)}</small>
            <span class="catalog-user-actions">
              <button class="btn btn-ghost btn-sm" onclick="resetCatalogUserPassword('${u.auth_id}')">Nuova password</button>
              <button class="btn-icon" style="color:var(--priority-urgent);" onclick="deleteCatalogUser('${u.auth_id}')" aria-label="Togli l'accesso a ${escapeHtml(u.email)}" title="Togli l'accesso">${Icons.trash(14)}</button>
            </span>
          </div>`).join('')}
      </div>`}
    </div>

    <div class="glass-card page-card">
      <div class="page-card-head">
        ${Icons.shirt(16)} <h2>Catalogo nell'app clienti</h2>
        <span class="table-count">${items.length} ${items.length === 1 ? 'prodotto' : 'prodotti'}</span>
        <button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="openCatalogAdd('${c.id}')">${Icons.plus(13)} Aggiungi prodotti</button>
      </div>
      ${items.length === 0 ? `<div class="empty-list">Nessun prodotto: aggiungi quelli che il cliente potrà ordinare e rivendere.</div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm catalog-table">
          <thead><tr>
            <th>Prodotto</th><th>Nome del cliente</th>
            ${showCost ? '<th class="num">Costo</th>' : ''}<th class="num">Listino</th><th class="num">Prezzo cliente</th><th class="num">Rivendita</th>
            <th>Attivo</th><th><span class="sr-only">Azioni</span></th>
          </tr></thead>
          <tbody>
            ${items.map(r => `
              <tr class="${r.attivo && r.product.attivo ? '' : 'row-muted'}">
                <td data-label="Prodotto"><strong>${escapeHtml(TCFactory.productPublicName(r.product))}</strong>
                  <small class="catalog-sub">${escapeHtml(TCFactory.productLabel(r.product))}${r.product.attivo ? '' : ' · prodotto disattivo'}</small></td>
                <td data-label="Nome del cliente">${r.nome ? escapeHtml(r.nome) : '<span class="muted">—</span>'}</td>
                ${showCost ? `<td class="num" data-label="Costo">${money(r.product.costo)}</td>` : ''}
                <td class="num" data-label="Listino">${money(r.product.prezzo)}</td>
                <td class="num" data-label="Prezzo cliente">
                  <span class="settings-field catalog-price"><input class="form-input" inputmode="decimal" aria-label="Prezzo al cliente"
                    placeholder="${r.product.prezzo !== null ? priceInput(r.product.prezzo) : '0,00'}" value="${priceInput(r.prezzo)}"
                    onchange="saveCatalogPrice('${r.id}', this)"><span>€</span></span>
                </td>
                <td class="num" data-label="Rivendita">${money(r.prezzo_rivendita)}${r.in_vendita ? '' : '<small class="catalog-sub">non in vendita</small>'}</td>
                <td class="cell-action" data-label="Attivo">
                  <input type="checkbox" class="switch" ${r.attivo ? 'checked' : ''} aria-label="Visibile al cliente" onchange="toggleCatalogItem('${r.id}', this.checked)">
                </td>
                <td class="cell-action">
                  <button class="btn-icon" onclick="removeCatalogItem('${r.id}')" aria-label="Togli dal catalogo" title="Togli dal catalogo">${Icons.x(13)}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="settings-section-hint" style="margin:10px 16px 14px;">Prezzo cliente vuoto = prezzo di listino. Spento = il cliente non lo vede più (scorte e nome restano).</div>`}
    </div>
    </div>`;
}

async function saveCatalogPrice(id, el) {
  const n = parsePrice(el.value);
  if (Number.isNaN(n)) { el.setAttribute('aria-invalid', 'true'); return showToast('Importo non valido', 'error'); }
  el.removeAttribute('aria-invalid');
  try { await TCFactory.saveCatalogItem(id, { prezzo: n }); showToast('Prezzo aggiornato'); }
  catch (e) { showToast('Errore — riprova', 'error'); renderClientsPage(); }
}

async function toggleCatalogItem(id, attivo) {
  try { await TCFactory.saveCatalogItem(id, { attivo }); }
  catch (e) { showToast('Errore — riprova', 'error'); renderClientsPage(); }
}

async function removeCatalogItem(id) {
  const r = TCFactory._clientCatalog.find(x => x.id === id);
  const p = r && TCFactory.getProduct(r.product_id);
  if (!confirm(`Togliere "${TCFactory.productPublicName(p)}" dal catalogo del cliente?\n\nSi perdono anche il nome, il prezzo di rivendita e le scorte che il cliente ha inserito. Per nasconderlo soltanto, spegni "Attivo".`)) return;
  try { await TCFactory.removeFromCatalog(id); showToast('Prodotto tolto dal catalogo'); }
  catch (e) { showToast('Errore — riprova', 'error'); }
}

// ── Aggiungi prodotti al catalogo ──

function openCatalogAdd(clientId) {
  Object.assign(ClientState, { catSearch: '', catCategoria: '', catSelected: [] });
  renderCatalogAdd(clientId);
  const modal = document.getElementById('catalog-add-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('catalog-add-modal'); };
  setTimeout(() => document.getElementById('cat-search')?.focus(), 50);
}

function renderCatalogAdd(clientId) {
  const q = ClientState.catSearch.trim().toLowerCase();
  const inCatalog = new Set(TCFactory.getClientCatalog(clientId).map(r => r.product_id));
  const cats = TCFactory.getProductCategories();
  const list = TCFactory.getProducts()
    .filter(p => p.attivo && !inCatalog.has(p.id))
    .filter(p => !ClientState.catCategoria || p.categoria_id === ClientState.catCategoria)
    .filter(p => !q || [TCFactory.productPublicName(p), TCFactory.productLabel(p), TCFactory.productCategoryName(p.categoria_id)].some(v => v.toLowerCase().includes(q)));
  const n = ClientState.catSelected.length;
  const allOn = list.length > 0 && list.every(p => ClientState.catSelected.includes(p.id));

  document.getElementById('catalog-add-modal').innerHTML = `
    <div class="modal" style="max-width:620px;" role="dialog" aria-modal="true" aria-labelledby="ca-title">
      <div class="modal-header">
        <h2 id="ca-title">Aggiungi al catalogo di ${escapeHtml(TCFactory.clientName(TCFactory.getClient(clientId)))}</h2>
        <button class="btn-icon" onclick="closeModal('catalog-add-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <div class="search-box" style="flex:1;min-width:200px;">
            ${Icons.search()}
            <input id="cat-search" type="text" style="width:100%;" placeholder="Cerca prodotto…" value="${escapeHtml(ClientState.catSearch)}"
              oninput="ClientState.catSearch=this.value;renderCatalogAdd('${clientId}');const el=document.getElementById('cat-search');el.focus();el.setSelectionRange(el.value.length,el.value.length);">
          </div>
          <select class="form-select" style="width:auto;" aria-label="Categoria" onchange="ClientState.catCategoria=this.value;renderCatalogAdd('${clientId}')">
            <option value="">Tutte le categorie</option>
            ${cats.map(c => `<option value="${c.id}" ${ClientState.catCategoria === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </div>
        ${list.length ? `<label class="link-row" style="border-bottom:1px solid var(--border);">
          <input type="checkbox" ${allOn ? 'checked' : ''} onchange="toggleCatalogAddAll('${clientId}', this.checked)">
          <span style="flex:1;"><strong>Seleziona tutti</strong><small>${list.length} ${list.length === 1 ? 'prodotto' : 'prodotti'} in elenco</small></span>
        </label>` : ''}
        <div class="link-list">
          ${list.length === 0 ? `<div class="empty-list" style="padding:24px;">Nessun prodotto da aggiungere${q || ClientState.catCategoria ? ' per questa ricerca' : ''}.</div>` :
            list.map(p => `
              <label class="link-row">
                <input type="checkbox" data-id="${p.id}" ${ClientState.catSelected.includes(p.id) ? 'checked' : ''} onchange="toggleCatalogAdd('${p.id}', this.checked)">
                <span style="flex:1;min-width:0;"><strong>${escapeHtml(TCFactory.productPublicName(p))}</strong><small>${escapeHtml(TCFactory.productLabel(p))}</small></span>
                <span style="font-size:0.8rem;color:var(--text-secondary);">${p.prezzo !== null ? euro(p.prezzo) : ''}</span>
              </label>`).join('')}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('catalog-add-modal')">Annulla</button>
        <button class="btn btn-primary" id="ca-save" ${n ? '' : 'disabled'} onclick="submitCatalogAdd('${clientId}')">${catalogAddLabel(n)}</button>
      </div>
    </div>`;
}

const catalogAddLabel = (n) => n ? `Aggiungi ${n} ${n === 1 ? 'prodotto' : 'prodotti'}` : 'Aggiungi';

function toggleCatalogAdd(productId, on) {
  ClientState.catSelected = on ? [...ClientState.catSelected, productId] : ClientState.catSelected.filter(id => id !== productId);
  const btn = document.getElementById('ca-save');
  if (btn) { btn.disabled = !ClientState.catSelected.length; btn.textContent = catalogAddLabel(ClientState.catSelected.length); }
}

function toggleCatalogAddAll(clientId, on) {
  const ids = [...document.querySelectorAll('#catalog-add-modal .link-list input[data-id]')].map(el => el.dataset.id);
  ClientState.catSelected = on ? [...new Set([...ClientState.catSelected, ...ids])] : ClientState.catSelected.filter(id => !ids.includes(id));
  renderCatalogAdd(clientId);
}

async function submitCatalogAdd(clientId) {
  const ids = [...ClientState.catSelected];
  const btn = document.getElementById('ca-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Aggiunta…'; }
  try {
    await TCFactory.addToCatalog(clientId, ids);
    closeModal('catalog-add-modal');
    showToast(`${ids.length} ${ids.length === 1 ? 'prodotto aggiunto' : 'prodotti aggiunti'} al catalogo`);
  } catch (e) {
    console.error('[catalogo]', e);
    showToast('Errore — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = catalogAddLabel(ids.length); }
  }
}

// ── Accessi all'app ──

function openCatalogUserForm(clientId) {
  const c = TCFactory.getClient(clientId);
  const modal = document.getElementById('catalog-user-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;" role="dialog" aria-modal="true" aria-labelledby="cu-title">
      <div class="modal-header">
        <h2 id="cu-title">Nuovo accesso all'app</h2>
        <button class="btn-icon" onclick="closeModal('catalog-user-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body" style="gap:12px;" onsubmit="event.preventDefault();submitCatalogUser('${clientId}')">
        <div class="form-group">
          <label class="form-label" for="cu-email">Email</label>
          <input id="cu-email" class="form-input" type="email" autocomplete="off" value="${escapeHtml(c?.email || '')}" required>
        </div>
        <div class="form-group">
          <label class="form-label" for="cu-password">Password <span>(almeno 8 caratteri)</span></label>
          <input id="cu-password" class="form-input" type="text" autocomplete="new-password" minlength="8" required>
        </div>
        <div class="settings-section-hint" style="margin:0;">Comunica email e password al cliente: con queste entra nell'app e vede solo il proprio catalogo.</div>
        <button type="submit" hidden></button>
      </form>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('catalog-user-modal')">Annulla</button>
        <button class="btn btn-primary" id="cu-save" onclick="submitCatalogUser('${clientId}')">Crea accesso</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('catalog-user-modal'); };
  setTimeout(() => document.getElementById(c?.email ? 'cu-password' : 'cu-email')?.focus(), 50);
}

async function submitCatalogUser(clientId) {
  const email = document.getElementById('cu-email')?.value.trim() || '';
  const password = document.getElementById('cu-password')?.value || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showToast('Email non valida', 'error');
  if (password.length < 8) return showToast('La password deve avere almeno 8 caratteri', 'error');
  const btn = document.getElementById('cu-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Creazione…'; }
  try {
    await TCFactory.catalogUsersAction('create', { client_id: clientId, email, password });
    closeModal('catalog-user-modal');
    showToast(`Accesso creato per ${email}`);
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Crea accesso'; }
  }
}

async function resetCatalogUserPassword(authId) {
  const u = TCFactory._catalogUsers.find(x => x.auth_id === authId);
  const password = prompt(`Nuova password per ${u?.email} (almeno 8 caratteri):`);
  if (password === null) return;
  if (password.length < 8) return showToast('La password deve avere almeno 8 caratteri', 'error');
  try { await TCFactory.catalogUsersAction('password', { auth_id: authId, password }); showToast('Password aggiornata'); }
  catch (e) { showToast(e.message, 'error'); }
}

async function deleteCatalogUser(authId) {
  const u = TCFactory._catalogUsers.find(x => x.auth_id === authId);
  if (!confirm(`Togliere l'accesso all'app a ${u?.email}?\n\nIl catalogo, le scorte e gli ordini del cliente restano.`)) return;
  try { await TCFactory.catalogUsersAction('delete', { auth_id: authId }); showToast('Accesso tolto'); }
  catch (e) { showToast(e.message, 'error'); }
}
