/**
 * T&C Factory — Cataloghi (app clienti)
 * Ogni cliente può avere un catalogo nell'app clienti: lo staff sceglie i prodotti,
 * il nome con cui li vede e il prezzo a cui li compra, e gli crea l'accesso.
 * Il cliente può rinominarli, decide il prezzo di rivendita e tiene le scorte dall'app.
 * Pagina: #/cataloghi (elenco) e #/cataloghi/<id cliente> (catalogo del cliente).
 */

const CatalogState = {
  search: '',            // elenco dei cataloghi
  addSearch: '',         // aggiungi prodotti
  addCategoria: '',
  addSelected: [],
};

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

function renderCatalogsPage() {
  const root = document.getElementById('cataloghi-root');
  if (!root) return;

  if (!TCFactory.isCatalogAvailable() || !TCFactory.isClientsAvailable() || !TCFactory.isProductsAvailable()) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.book(28)}</div>
        <h2>Cataloghi da attivare</h2>
        <p>Esegui lo script <strong>sql/cataloghi-clienti.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }

  const client = Nav.param ? TCFactory.getClient(Nav.param) : null;
  if (Nav.param && !client) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <h2>Cliente non trovato</h2>
        <p><button class="btn btn-secondary" onclick="Nav.go('cataloghi')">Torna ai cataloghi</button></p>
      </div>`;
    return;
  }
  root.innerHTML = client ? renderCatalogDetail(client) : renderCatalogList();
}

function setCatalogSearch(v) {
  CatalogState.search = v;
  renderCatalogsPage();
  const el = document.getElementById('catalog-search');
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
}

function renderCatalogList() {
  const q = CatalogState.search.trim().toLowerCase();
  const all = TCFactory.getCatalogClients();
  const list = all.filter(c => !q || TCFactory.clientName(c).toLowerCase().includes(q));

  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <div class="search-box">
          ${Icons.search()}
          <input id="catalog-search" type="text" placeholder="Cerca cliente…" value="${escapeHtml(CatalogState.search)}" oninput="setCatalogSearch(this.value)">
        </div>
        <span class="table-count">${list.length} di ${all.length}</span>
      </div>
      ${all.length === 0 ? `
        <div class="empty-list">
          Nessun catalogo ancora.<br><br>
          <button class="btn btn-primary" onclick="openNewCatalog()">${Icons.plus()} Crea il primo catalogo</button>
        </div>` : list.length === 0 ? `<div class="empty-list">Nessun risultato.</div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm">
          <thead><tr><th>Cliente</th><th class="num">Prodotti</th><th class="num">In vendita</th><th>Accesso all'app</th></tr></thead>
          <tbody>
            ${list.map(c => {
              const items = TCFactory.getClientCatalog(c.id);
              const attivi = items.filter(r => r.attivo && r.product.attivo);
              const users = TCFactory.getCatalogUsers(c.id);
              return `<tr class="data-row" tabindex="0" onclick="Nav.go('cataloghi','${c.id}')" onkeydown="if(event.key==='Enter')Nav.go('cataloghi','${c.id}')">
                <td class="cell-main"><strong>${escapeHtml(TCFactory.clientName(c))}</strong></td>
                <td class="num" data-label="Prodotti">${attivi.length}${attivi.length !== items.length ? ` <small class="muted">di ${items.length}</small>` : ''}</td>
                <td class="num" data-label="In vendita">${attivi.filter(r => r.in_vendita).length}</td>
                <td data-label="Accesso">${users.length ? escapeHtml(users.map(u => u.email).join(', ')) : '<span class="muted">nessuno</span>'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`}
    </div>`;
}

// Nuovo catalogo: si sceglie il cliente (tra quelli che non ne hanno uno)
function openNewCatalog() {
  const used = new Set(TCFactory.getCatalogClients().map(c => c.id));
  const free = TCFactory.getClients().filter(c => !used.has(c.id));
  const modal = document.getElementById('catalog-user-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;" role="dialog" aria-modal="true" aria-labelledby="nc-title">
      <div class="modal-header">
        <h2 id="nc-title">Nuovo catalogo</h2>
        <button class="btn-icon" onclick="closeModal('catalog-user-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:12px;">
        ${free.length ? `
        <div class="form-group">
          <label class="form-label" for="nc-client">Cliente</label>
          <select id="nc-client" class="form-select">
            ${free.map(c => `<option value="${c.id}">${escapeHtml(TCFactory.clientName(c))}</option>`).join('')}
          </select>
        </div>
        <div class="settings-section-hint" style="margin:0;">Poi aggiungi i prodotti e crea l'accesso con cui il cliente entra nell'app.</div>`
        : `<div class="settings-section-hint" style="margin:0;">Tutti i clienti hanno già un catalogo. Per uno nuovo, crealo prima in Clienti.</div>`}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('catalog-user-modal')">Annulla</button>
        ${free.length ? `<button class="btn btn-primary" onclick="closeModal('catalog-user-modal');Nav.go('cataloghi', document.getElementById('nc-client').value)">Continua</button>` : ''}
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('catalog-user-modal'); };
}

// Nella scheda cliente: rimando al catalogo
function renderClientCatalogLink(c) {
  if (!TCFactory.isCatalogAvailable() || !TCAuth.canSeeSection('cataloghi')) return '';
  const n = TCFactory.getClientCatalog(c.id).length;
  const users = TCFactory.getCatalogUsers(c.id).length;
  return `
    <div class="glass-card page-card client-app-section">
      <div class="page-card-head">
        ${Icons.book(16)} <h2>App clienti</h2>
        <span class="table-count">${n ? `${n} ${n === 1 ? 'prodotto' : 'prodotti'} · ${users ? `${users} ${users === 1 ? 'accesso' : 'accessi'}` : 'nessun accesso'}` : 'nessun catalogo'}</span>
        <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="Nav.go('cataloghi','${c.id}')">${n || users ? 'Apri il catalogo' : 'Crea il catalogo'} ${Icons.chevronRight(13)}</button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────
// CATALOGO DI UN CLIENTE
// ─────────────────────────────────────────────

function renderCatalogDetail(c) {
  const users = TCFactory.getCatalogUsers(c.id);
  const items = TCFactory.getClientCatalog(c.id);
  const showCost = TCAuth.canViewEconomics();
  const money = (n) => n === null || n === undefined ? '<span class="muted">—</span>' : euro(n);

  return `
    <button class="btn btn-ghost btn-sm back-link" onclick="Nav.go('cataloghi')">${Icons.chevronLeft(14)} Tutti i cataloghi</button>

    <div class="glass-card client-hero">
      <div class="client-hero-text">
        <h2>${escapeHtml(TCFactory.clientName(c))}</h2>
        <p>Catalogo nell'app clienti</p>
      </div>
      <div class="client-hero-actions">
        <button class="btn btn-secondary btn-sm" onclick="Nav.go('clienti','${c.id}')">${Icons.users(14)} Scheda cliente</button>
      </div>
    </div>

    <div class="client-app-section">
    <div class="glass-card page-card">
      <div class="page-card-head">
        ${Icons.lock(16)} <h2>Accesso all'app</h2>
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
        ${Icons.shirt(16)} <h2>Prodotti</h2>
        <span class="table-count">${items.length}</span>
        <button class="btn btn-primary btn-sm" style="margin-left:auto;" onclick="openCatalogAdd('${c.id}')">${Icons.plus(13)} Aggiungi prodotti</button>
      </div>
      ${items.length === 0 ? `<div class="empty-list">Nessun prodotto: aggiungi quelli che il cliente potrà ordinare e rivendere.</div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm catalog-table">
          <thead><tr>
            <th>Nome</th><th>Prodotto</th><th>Nome del cliente</th>
            ${showCost ? '<th class="num">Costo</th>' : ''}<th class="num">Listino</th><th class="num">Prezzo cliente</th><th class="num">Rivendita</th>
            <th>Attivo</th><th><span class="sr-only">Azioni</span></th>
          </tr></thead>
          <tbody>
            ${items.map(r => `
              <tr class="${r.attivo && r.product.attivo ? '' : 'row-muted'}">
                <td class="catalog-name-cell">
                  <input class="form-input catalog-name" maxlength="80" aria-label="Nome nel catalogo" value="${escapeHtml(r.nome || '')}"
                    placeholder="${escapeHtml(r.product.descrizione || 'Nome')}" onchange="saveCatalogName('${r.id}', this.value)">
                </td>
                <td data-label="Prodotto"><span class="catalog-sub" style="margin:0;">${escapeHtml(TCFactory.productLabel(r.product))}${r.product.attivo ? '' : ' · prodotto disattivo'}</span></td>
                <td data-label="Nome del cliente">${r.nome_cliente ? escapeHtml(r.nome_cliente) : '<span class="muted">—</span>'}</td>
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
      <div class="settings-section-hint" style="margin:10px 16px 14px;">Nome vuoto = descrizione del prodotto; il cliente può rinominarlo nell'app. Prezzo cliente vuoto = listino. Spento = il cliente non lo vede più (scorte e nome restano).</div>`}
    </div>
    </div>`;
}

async function saveCatalogName(id, value) {
  try { await TCFactory.saveCatalogItem(id, { nome: value }); showToast('Nome aggiornato'); }
  catch (e) { showToast('Errore — riprova', 'error'); renderCatalogsPage(); }
}

async function saveCatalogPrice(id, el) {
  const n = parsePrice(el.value);
  if (Number.isNaN(n)) { el.setAttribute('aria-invalid', 'true'); return showToast('Importo non valido', 'error'); }
  el.removeAttribute('aria-invalid');
  try { await TCFactory.saveCatalogItem(id, { prezzo: n }); showToast('Prezzo aggiornato'); }
  catch (e) { showToast('Errore — riprova', 'error'); renderCatalogsPage(); }
}

async function toggleCatalogItem(id, attivo) {
  try { await TCFactory.saveCatalogItem(id, { attivo }); }
  catch (e) { showToast('Errore — riprova', 'error'); renderCatalogsPage(); }
}

async function removeCatalogItem(id) {
  const r = TCFactory._clientCatalog.find(x => x.id === id);
  if (!confirm(`Togliere "${TCFactory.catalogItemName(r)}" dal catalogo?\n\nSi perdono anche il nome, il prezzo di rivendita e le scorte che il cliente ha inserito. Per nasconderlo soltanto, spegni "Attivo".`)) return;
  try { await TCFactory.removeFromCatalog(id); showToast('Prodotto tolto dal catalogo'); }
  catch (e) { showToast('Errore — riprova', 'error'); }
}

// ── Aggiungi prodotti al catalogo ──

function openCatalogAdd(clientId) {
  Object.assign(CatalogState, { addSearch: '', addCategoria: '', addSelected: [] });
  renderCatalogAdd(clientId);
  const modal = document.getElementById('catalog-add-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('catalog-add-modal'); };
  setTimeout(() => document.getElementById('cat-search')?.focus(), 50);
}

function renderCatalogAdd(clientId) {
  const q = CatalogState.addSearch.trim().toLowerCase();
  const inCatalog = new Set(TCFactory.getClientCatalog(clientId).map(r => r.product_id));
  const cats = TCFactory.getProductCategories();
  const list = TCFactory.getProducts()
    .filter(p => p.attivo && !inCatalog.has(p.id))
    .filter(p => !CatalogState.addCategoria || p.categoria_id === CatalogState.addCategoria)
    .filter(p => !q || [TCFactory.productLabel(p), TCFactory.productCategoryName(p.categoria_id)].some(v => v.toLowerCase().includes(q)));
  const n = CatalogState.addSelected.length;
  const allOn = list.length > 0 && list.every(p => CatalogState.addSelected.includes(p.id));

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
            <input id="cat-search" type="text" style="width:100%;" placeholder="Cerca prodotto…" value="${escapeHtml(CatalogState.addSearch)}"
              oninput="CatalogState.addSearch=this.value;renderCatalogAdd('${clientId}');const el=document.getElementById('cat-search');el.focus();el.setSelectionRange(el.value.length,el.value.length);">
          </div>
          <select class="form-select" style="width:auto;" aria-label="Categoria" onchange="CatalogState.addCategoria=this.value;renderCatalogAdd('${clientId}')">
            <option value="">Tutte le categorie</option>
            ${cats.map(c => `<option value="${c.id}" ${CatalogState.addCategoria === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
          </select>
        </div>
        ${list.length ? `<label class="link-row" style="border-bottom:1px solid var(--border);">
          <input type="checkbox" ${allOn ? 'checked' : ''} onchange="toggleCatalogAddAll('${clientId}', this.checked)">
          <span style="flex:1;"><strong>Seleziona tutti</strong><small>${list.length} ${list.length === 1 ? 'prodotto' : 'prodotti'} in elenco</small></span>
        </label>` : ''}
        <div class="link-list">
          ${list.length === 0 ? `<div class="empty-list" style="padding:24px;">Nessun prodotto da aggiungere${q || CatalogState.addCategoria ? ' per questa ricerca' : ''}.</div>` :
            list.map(p => `
              <label class="link-row">
                <input type="checkbox" data-id="${p.id}" ${CatalogState.addSelected.includes(p.id) ? 'checked' : ''} onchange="toggleCatalogAdd('${p.id}', this.checked)">
                <span style="flex:1;min-width:0;"><strong>${escapeHtml(p.descrizione || 'Senza descrizione')}</strong><small>${escapeHtml([TCFactory.supplierName(p.fornitore_id), p.codice, TCFactory.productCategoryName(p.categoria_id)].filter(Boolean).join(' · '))}</small></span>
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
  CatalogState.addSelected = on ? [...CatalogState.addSelected, productId] : CatalogState.addSelected.filter(id => id !== productId);
  const btn = document.getElementById('ca-save');
  if (btn) { btn.disabled = !CatalogState.addSelected.length; btn.textContent = catalogAddLabel(CatalogState.addSelected.length); }
}

function toggleCatalogAddAll(clientId, on) {
  const ids = [...document.querySelectorAll('#catalog-add-modal .link-list input[data-id]')].map(el => el.dataset.id);
  CatalogState.addSelected = on ? [...new Set([...CatalogState.addSelected, ...ids])] : CatalogState.addSelected.filter(id => !ids.includes(id));
  renderCatalogAdd(clientId);
}

async function submitCatalogAdd(clientId) {
  const ids = [...CatalogState.addSelected];
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
