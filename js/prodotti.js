/**
 * T&C Factory — Prodotti
 * Anagrafica articoli: catalogo, codice, descrizione, categoria, colori, taglie, costo, prezzo, attivo.
 * Le categorie si creano e si gestiscono da qui (pulsante "Categorie").
 */

const ProductState = {
  search: '',
  categoria: '',          // '' = tutte, '-' = senza categoria, altrimenti id
  stato: 'attivi',        // 'attivi' | 'tutti' | 'disattivi'
};

// "3,50" / "3.50" → 3.5; vuoto → null
const parsePrice = (v) => {
  const s = String(v ?? '').trim().replace(/\s|€/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const priceInput = (n) => (n === null || n === undefined) ? '' : String(n).replace('.', ',');

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

function renderProductsPage() {
  const root = document.getElementById('prodotti-root');
  if (!root) return;

  if (!TCFactory.isProductsAvailable()) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.shirt(28)}</div>
        <h2>Database prodotti da attivare</h2>
        <p>Esegui gli script <strong>sql/prodotti-setup.sql</strong> e <strong>sql/prodotti-categorie.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }
  root.innerHTML = renderProductList();
}

function setProductSearch(v) {
  ProductState.search = v;
  renderProductsPage();
  const el = document.getElementById('product-search');
  if (el) { el.focus(); el.setSelectionRange(v.length, v.length); }
}
function setProductCategoria(c) { ProductState.categoria = c; renderProductsPage(); }
function setProductStato(s) { ProductState.stato = s; renderProductsPage(); }

function renderProductList() {
  const q = ProductState.search.trim().toLowerCase();
  const all = TCFactory.getProducts();
  const cats = TCFactory.getProductCategories();
  const showCost = TCAuth.canViewEconomics();
  if (ProductState.categoria && ProductState.categoria !== '-' && !cats.some(c => c.id === ProductState.categoria)) ProductState.categoria = '';

  const list = all.filter(p => {
    if (ProductState.stato === 'attivi' && !p.attivo) return false;
    if (ProductState.stato === 'disattivi' && p.attivo) return false;
    if (ProductState.categoria === '-' && p.categoria_id) return false;
    if (ProductState.categoria && ProductState.categoria !== '-' && p.categoria_id !== ProductState.categoria) return false;
    if (!q) return true;
    return [p.catalogo, p.codice, p.descrizione, TCFactory.productCategoryName(p.categoria_id), p.colori, p.taglie]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  const cell = (v) => v ? escapeHtml(v) : '<span class="muted">—</span>';
  const rows = list.map(p => `
    <tr class="data-row ${p.attivo ? '' : 'row-muted'}" tabindex="0" onclick="openProductForm('${p.id}')" onkeydown="if(event.key==='Enter')openProductForm('${p.id}')">
      <td data-label="Catalogo">${cell(p.catalogo)}</td>
      <td data-label="Codice"><strong>${cell(p.codice)}</strong></td>
      <td data-label="Descrizione">${cell(p.descrizione)}</td>
      <td class="hide-sm">${cell(TCFactory.productCategoryName(p.categoria_id))}</td>
      <td class="hide-sm">${cell(p.colori)}</td>
      <td class="hide-sm">${cell(p.taglie)}</td>
      ${showCost ? `<td class="num" data-label="Costo">${p.costo !== null ? euro(p.costo) : '—'}</td>` : ''}
      <td class="num" data-label="Prezzo">${p.prezzo !== null ? euro(p.prezzo) : '—'}</td>
      <td class="cell-action" data-label="Attivo" onclick="event.stopPropagation()">
        <input type="checkbox" class="switch" ${p.attivo ? 'checked' : ''} aria-label="Prodotto attivo" onchange="toggleProductActive('${p.id}', this.checked)">
      </td>
    </tr>`).join('');

  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <div class="search-box">
          ${Icons.search()}
          <input id="product-search" type="text" placeholder="Cerca catalogo, codice, descrizione…" value="${escapeHtml(ProductState.search)}" oninput="setProductSearch(this.value)">
        </div>
        <select class="form-select" style="width:auto;" aria-label="Categoria" onchange="setProductCategoria(this.value)">
          <option value="">Tutte le categorie</option>
          ${cats.map(c => `<option value="${c.id}" ${ProductState.categoria === c.id ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('')}
          <option value="-" ${ProductState.categoria === '-' ? 'selected' : ''}>Senza categoria</option>
        </select>
        <div class="segmented" role="tablist" aria-label="Stato prodotto">
          ${[['attivi','Attivi'],['disattivi','Disattivi'],['tutti','Tutti']].map(([id, l]) =>
            `<button role="tab" aria-selected="${ProductState.stato===id}" class="${ProductState.stato===id?'active':''}" onclick="setProductStato('${id}')">${l}</button>`).join('')}
        </div>
        <span class="table-count">${list.length} di ${all.length}</span>
      </div>
      ${all.length === 0 ? `
        <div class="empty-list">
          Nessun prodotto ancora.<br><br>
          <button class="btn btn-primary" onclick="openProductForm()">${Icons.plus()} Crea il primo prodotto</button>
        </div>` : list.length === 0 ? `<div class="empty-list">Nessun risultato.</div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm">
          <thead><tr>
            <th>Catalogo</th><th>Codice</th><th>Descrizione</th><th class="hide-sm">Categoria</th>
            <th class="hide-sm">Colori</th><th class="hide-sm">Taglie</th>
            ${showCost ? '<th class="num">Costo</th>' : ''}<th class="num">Prezzo</th><th>Attivo</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>`;
}

async function toggleProductActive(id, attivo) {
  try { await TCFactory.saveProduct(id, { attivo }); }
  catch (e) { showToast('Errore — riprova', 'error'); renderProductsPage(); }
}

// ─────────────────────────────────────────────
// MODULO PRODOTTO
// ─────────────────────────────────────────────

// prefill: campi già compilati per un prodotto nuovo (es. importato da un link)
function openProductForm(id = null, prefill = null) {
  const p = id ? TCFactory.getProduct(id) : prefill;
  const showCost = TCAuth.canViewEconomics();
  const v = (k) => escapeHtml(p?.[k] ?? '');
  const input = (k, label, attrs = '') => `
    <div class="form-group">
      <label class="form-label" for="pf-${k}">${label}</label>
      <input id="pf-${k}" class="form-input" value="${v(k)}" ${attrs}>
    </div>`;
  const price = (k, label) => `
    <div class="form-group">
      <label class="form-label" for="pf-${k}">${label}</label>
      <span class="settings-field"><input id="pf-${k}" class="form-input" inputmode="decimal" placeholder="0,00" value="${priceInput(p?.[k])}"><span>€</span></span>
    </div>`;

  const modal = document.getElementById('product-form-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:680px;" role="dialog" aria-modal="true" aria-labelledby="pf-title">
      <div class="modal-header">
        <h2 id="pf-title">${id ? 'Modifica prodotto' : prefill ? 'Nuovo prodotto da link' : 'Nuovo prodotto'}</h2>
        <button class="btn-icon" onclick="closeModal('product-form-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:14px;">
        ${prefill?._note ? `<div class="import-note">${prefill._note}</div>` : ''}
        <div class="form-row">${input('catalogo', 'Catalogo', 'maxlength="80"')}${input('codice', 'Codice', 'maxlength="60"')}</div>
        ${input('descrizione', 'Descrizione *', 'maxlength="200"')}
        <div class="form-group">
          <label class="form-label" for="pf-categoria">Categoria</label>
          <div style="display:flex;gap:8px;">
            <select id="pf-categoria" class="form-select" style="flex:1;">${productCategoryOptions(p?.categoria_id)}</select>
            <button type="button" class="btn btn-secondary btn-sm" onclick="newCategoryFromForm()">${Icons.plus(13)} Nuova</button>
          </div>
        </div>
        <div class="form-row">
          ${input('colori', 'Colori', 'maxlength="300" placeholder="es. Bianco, Nero, Navy"')}
          ${input('taglie', 'Taglie', 'maxlength="200" placeholder="es. XS–3XL"')}
        </div>
        <div class="form-row">${showCost ? price('costo', 'Costo') : ''}${price('prezzo', 'Prezzo')}</div>
        <label class="switch-row">
          <span><strong>Attivo</strong><small>I prodotti disattivi restano in archivio ma non compaiono nell'elenco principale</small></span>
          <input id="pf-attivo" type="checkbox" class="switch" ${p && !p.attivo ? '' : 'checked'}>
        </label>
      </div>
      <div class="modal-footer">
        ${id ? `<button class="btn btn-ghost" style="color:var(--priority-urgent);margin-right:auto;" onclick="deleteProductConfirm('${id}')">${Icons.trash(14)} Elimina</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('product-form-modal')">Annulla</button>
        <button class="btn btn-primary" id="pf-save" onclick="submitProductForm(${id ? `'${id}'` : 'null'})">${id ? 'Salva modifiche' : 'Crea prodotto'}</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-form-modal'); };
  setTimeout(() => document.getElementById('pf-catalogo')?.focus(), 50);
}

function productCategoryOptions(selectedId) {
  return `<option value="">— Nessuna —</option>` +
    TCFactory.getProductCategories().map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.nome)}</option>`).join('');
}

async function newCategoryFromForm() {
  const nome = prompt('Nome della nuova categoria:');
  if (!nome?.trim()) return;
  try {
    const c = await TCFactory.saveProductCategory(null, nome);
    const sel = document.getElementById('pf-categoria');
    if (sel) sel.innerHTML = productCategoryOptions(c.id);
    showToast(`Categoria "${c.nome}" creata`);
  } catch (e) { showToast(e.message === 'Esiste già' ? 'Categoria già esistente' : 'Errore — riprova', 'error'); }
}

async function submitProductForm(id) {
  const get = (k) => document.getElementById('pf-' + k)?.value?.trim() || '';
  const fields = {};
  TCFactory.PRODUCT_TEXT_FIELDS.forEach(k => { fields[k] = get(k); });
  fields.categoria_id = get('categoria') || null;
  fields.attivo = document.getElementById('pf-attivo')?.checked ?? true;

  const invalid = (k, msg) => {
    const el = document.getElementById('pf-' + k);
    el?.focus();
    el?.setAttribute('aria-invalid', 'true');
    el?.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
    showToast(msg, 'error');
  };
  if (!fields.descrizione) return invalid('descrizione', 'Inserisci la descrizione del prodotto');
  // Il costo si salva solo se è visibile a chi modifica
  for (const k of ['costo', 'prezzo']) {
    if (!document.getElementById('pf-' + k)) continue;
    const n = parsePrice(get(k));
    if (Number.isNaN(n)) return invalid(k, 'Importo non valido');
    fields[k] = n;
  }

  const btn = document.getElementById('pf-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    const saved = await TCFactory.saveProduct(id, fields);
    closeModal('product-form-modal');
    showToast(id ? 'Prodotto aggiornato' : `Prodotto "${TCFactory.productLabel(saved)}" creato`);
  } catch (e) {
    console.error('[prodotto]', e);
    showToast('Errore durante il salvataggio — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Salva modifiche' : 'Crea prodotto'; }
  }
}

async function deleteProductConfirm(id) {
  const p = TCFactory.getProduct(id);
  if (!confirm(`Eliminare "${TCFactory.productLabel(p)}"?\n\nSe vuoi solo nasconderlo, disattivalo.`)) return;
  try {
    await TCFactory.deleteProduct(id);
    closeModal('product-form-modal');
    showToast('Prodotto eliminato');
  } catch (e) { showToast('Errore eliminazione prodotto', 'error'); }
}

// ─────────────────────────────────────────────
// IMPORTA DA LINK (funzione product-import su Supabase)
// ─────────────────────────────────────────────

function openProductImport() {
  const modal = document.getElementById('product-cat-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="pi-title">
      <div class="modal-header">
        <h2 id="pi-title">Importa prodotto da link</h2>
        <button class="btn-icon" onclick="closeModal('product-cat-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body" style="gap:10px;" onsubmit="event.preventDefault();runProductImport()">
        <label class="form-label" for="pi-url">Link della pagina del prodotto</label>
        <input id="pi-url" class="form-input" type="url" required placeholder="https://…" autocomplete="off">
        <div class="settings-section-hint" style="margin:0;">Leggo dalla pagina catalogo, codice, descrizione, colori, taglie e prezzo: prima di salvare puoi controllare e correggere.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal('product-cat-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="pi-go">${Icons.link(14)} Importa</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-cat-modal'); };
  setTimeout(() => document.getElementById('pi-url')?.focus(), 50);
}

async function runProductImport() {
  const url = document.getElementById('pi-url')?.value.trim();
  const btn = document.getElementById('pi-go');
  if (!url) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Lettura della pagina…'; }
  try {
    const { data, error } = await supabaseClient.functions.invoke('product-import', { body: { url } });
    if (error || !data?.success) {
      let msg = data?.error;
      if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch {} }
      throw new Error(msg || 'Importazione non riuscita');
    }
    const d = data.prodotto;
    const trovati = ['catalogo', 'codice', 'descrizione', 'colori', 'taglie'].filter(k => d[k]).length + (d.prezzo ? 1 : 0);
    if (!trovati) throw new Error('Nessuna informazione trovata su questa pagina');

    // Il prezzo del sito (fornitore) va nel costo; se il costo non è visibile, nel prezzo
    const costVisible = TCAuth.canViewEconomics();
    const prezzoTxt = d.prezzo ? `${euro(d.prezzo)}${d.valuta && d.valuta !== 'EUR' ? ' (' + escapeHtml(d.valuta) + ')' : ''}` : '';
    const host = (() => { try { return new URL(data.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    closeModal('product-cat-modal');
    openProductForm(null, {
      catalogo: d.catalogo, codice: d.codice, descrizione: d.descrizione, colori: d.colori, taglie: d.taglie,
      costo: costVisible ? d.prezzo : null, prezzo: costVisible ? null : d.prezzo, attivo: true,
      _note: `Importato da <strong>${escapeHtml(host)}</strong>: ${trovati} ${trovati === 1 ? 'campo trovato' : 'campi trovati'}.`
        + (prezzoTxt ? ` Prezzo del sito ${prezzoTxt} inserito come ${costVisible ? 'costo' : 'prezzo'}.` : '')
        + ' Controlla prima di salvare.',
    });
  } catch (e) {
    showToast(e.message || 'Importazione non riuscita', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = `${Icons.link(14)} Importa`; }
  }
}

// ─────────────────────────────────────────────
// CATEGORIE
// ─────────────────────────────────────────────

function openProductCategories() {
  renderProductCategories();
  const modal = document.getElementById('product-cat-modal');
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-cat-modal'); };
  setTimeout(() => document.getElementById('new-product-cat')?.focus(), 50);
}

function renderProductCategories() {
  const cats = TCFactory.getProductCategories();
  const count = (id) => TCFactory._products.filter(p => p.categoria_id === id).length;
  document.getElementById('product-cat-modal').innerHTML = `
    <div class="modal" style="max-width:480px;" role="dialog" aria-modal="true" aria-labelledby="pc-title">
      <div class="modal-header">
        <h2 id="pc-title">Categorie prodotti</h2>
        <button class="btn-icon" onclick="closeModal('product-cat-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:6px;">
        ${cats.map(c => `
          <div class="config-row">
            <input class="form-input" value="${escapeHtml(c.nome)}" maxlength="60" aria-label="Nome categoria" onchange="renameProductCategory('${c.id}', this.value)">
            <span style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;">${count(c.id)} prod.</span>
            <button class="btn-icon" style="color:var(--priority-urgent);" onclick="deleteProductCategory('${c.id}')" aria-label="Elimina ${escapeHtml(c.nome)}">${Icons.trash(15)}</button>
          </div>`).join('') || '<div class="settings-section-hint" style="margin:0;">Nessuna categoria: aggiungine una.</div>'}
        <form class="config-add-row" onsubmit="event.preventDefault();addProductCategory()">
          <input id="new-product-cat" class="form-input" placeholder="Nuova categoria, es. T-shirt" maxlength="60">
          <button type="submit" class="btn btn-secondary btn-icon" aria-label="Aggiungi categoria">${Icons.plus()}</button>
        </form>
      </div>
    </div>`;
}

async function addProductCategory() {
  const nome = document.getElementById('new-product-cat')?.value || '';
  if (!nome.trim()) return;
  try {
    await TCFactory.saveProductCategory(null, nome);
    renderProductCategories();
    document.getElementById('new-product-cat')?.focus();
  } catch (e) { showToast(e.message === 'Esiste già' ? 'Categoria già esistente' : 'Errore — riprova', 'error'); }
}

async function renameProductCategory(id, nome) {
  try { await TCFactory.saveProductCategory(id, nome); }
  catch (e) { showToast(e.message === 'Esiste già' ? 'Categoria già esistente' : 'Nome non valido', 'error'); }
  renderProductCategories();
}

async function deleteProductCategory(id) {
  const n = TCFactory._products.filter(p => p.categoria_id === id).length;
  if (!confirm(`Eliminare la categoria "${TCFactory.productCategoryName(id)}"?${n ? `\n\n${n} prodotti resteranno senza categoria.` : ''}`)) return;
  try { await TCFactory.deleteProductCategory(id); renderProductCategories(); }
  catch (e) { showToast('Errore eliminazione categoria', 'error'); }
}
