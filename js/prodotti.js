/**
 * T&C Factory — Prodotti
 * Anagrafica articoli: fornitore, codice, descrizione, categoria, colori, taglie, costo, prezzo, attivo.
 * Le categorie si creano e si gestiscono da qui (pulsante "Categorie"),
 * i fornitori nella sottopagina #/prodotti/fornitori.
 */

const ProductState = {
  search: '',
  fornitore: '',          // '' = tutti, '-' = senza fornitore, altrimenti id
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
  if (Nav.param === 'fornitori' && TCFactory.isProductsAvailable()) { root.innerHTML = renderSuppliersPage(); return; }

  if (!TCFactory.isProductsAvailable()) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.shirt(28)}</div>
        <h2>Database prodotti da attivare</h2>
        <p>Esegui gli script <strong>sql/prodotti-setup.sql</strong>, <strong>sql/prodotti-categorie.sql</strong> e <strong>sql/fornitori.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</p>
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
function setProductFornitore(f) { ProductState.fornitore = f; renderProductsPage(); }
function setProductCategoria(c) { ProductState.categoria = c; renderProductsPage(); }
function setProductStato(s) { ProductState.stato = s; renderProductsPage(); }

function renderProductList() {
  const q = ProductState.search.trim().toLowerCase();
  const all = TCFactory.getProducts();
  const cats = TCFactory.getProductCategories();
  const showCost = TCAuth.canViewEconomics();
  if (ProductState.categoria && ProductState.categoria !== '-' && !cats.some(c => c.id === ProductState.categoria)) ProductState.categoria = '';
  const fornitori = TCFactory.getSuppliers();
  if (ProductState.fornitore && ProductState.fornitore !== '-' && !fornitori.some(f => f.id === ProductState.fornitore)) ProductState.fornitore = '';

  const list = all.filter(p => {
    if (ProductState.stato === 'attivi' && !p.attivo) return false;
    if (ProductState.stato === 'disattivi' && p.attivo) return false;
    if (ProductState.fornitore === '-' && p.fornitore_id) return false;
    if (ProductState.fornitore && ProductState.fornitore !== '-' && p.fornitore_id !== ProductState.fornitore) return false;
    if (ProductState.categoria === '-' && p.categoria_id) return false;
    if (ProductState.categoria && ProductState.categoria !== '-' && p.categoria_id !== ProductState.categoria) return false;
    if (!q) return true;
    return [TCFactory.supplierName(p.fornitore_id), p.codice, p.descrizione, TCFactory.productCategoryName(p.categoria_id), p.colori, p.taglie]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  const cell = (v) => v ? escapeHtml(v) : '<span class="muted">—</span>';
  const rows = list.map(p => `
    <tr class="data-row ${p.attivo ? '' : 'row-muted'}" tabindex="0" onclick="openProductForm('${p.id}')" onkeydown="if(event.key==='Enter')openProductForm('${p.id}')">
      <td data-label="Fornitore">${cell(TCFactory.supplierName(p.fornitore_id))}</td>
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
      <td class="cell-action" onclick="event.stopPropagation()">
        <button type="button" class="btn-icon" onclick="showProductImages('${p.id}')" aria-label="Immagini di ${escapeHtml(TCFactory.productLabel(p))}" title="Immagini">${Icons.image(15)}</button>
        <button type="button" class="btn-icon" onclick="duplicateProduct('${p.id}')" aria-label="Duplica ${escapeHtml(TCFactory.productLabel(p))}" title="Duplica">${Icons.copy(15)}</button>
      </td>
    </tr>`).join('');

  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <div class="search-box">
          ${Icons.search()}
          <input id="product-search" type="text" placeholder="Cerca fornitore, codice, descrizione…" value="${escapeHtml(ProductState.search)}" oninput="setProductSearch(this.value)">
        </div>
        <select class="form-select" style="width:auto;" aria-label="Fornitore" onchange="setProductFornitore(this.value)">
          <option value="">Tutti i fornitori</option>
          ${fornitori.map(f => `<option value="${f.id}" ${ProductState.fornitore === f.id ? 'selected' : ''}>${escapeHtml(f.nome)}</option>`).join('')}
          <option value="-" ${ProductState.fornitore === '-' ? 'selected' : ''}>Senza fornitore</option>
        </select>
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
            <th>Fornitore</th><th>Codice</th><th>Descrizione</th><th class="hide-sm">Categoria</th>
            <th class="hide-sm">Colori</th><th class="hide-sm">Taglie</th>
            ${showCost ? '<th class="num">Costo</th>' : ''}<th class="num">Prezzo</th><th>Attivo</th><th><span class="sr-only">Azioni</span></th>
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

let _pfNewSupplier = '';   // fornitore da creare al salvataggio (import da link)

// prefill: campi già compilati per un prodotto nuovo (es. importato da un link)
function openProductForm(id = null, prefill = null) {
  const p = id ? TCFactory.getProduct(id) : prefill;
  _pfNewSupplier = (!id && prefill?._fornitoreNuovo) || '';
  const showCost = TCAuth.canViewEconomics();
  const v = (k) => escapeHtml(ofUpper(p?.[k] ?? ''));
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
    <div class="modal" style="max-width:${id ? 860 : 680}px;" role="dialog" aria-modal="true" aria-labelledby="pf-title">
      <div class="modal-header">
        <h2 id="pf-title">${id ? 'Modifica prodotto' : prefill ? (prefill._titolo || 'Nuovo prodotto da link') : 'Nuovo prodotto'}</h2>
        <button class="btn-icon" onclick="closeModal('product-form-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:14px;">
        ${prefill?._note ? `<div class="import-note">${prefill._note}</div>` : ''}
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="pf-fornitore">Fornitore</label>
            <div style="display:flex;gap:8px;">
              <select id="pf-fornitore" class="form-select" style="flex:1;min-width:0;">${productSupplierOptions(p?.fornitore_id, prefill?._fornitoreNuovo)}</select>
              <button type="button" class="btn btn-secondary btn-sm" onclick="newSupplierFromForm()" title="Nuovo fornitore">${Icons.plus(13)}</button>
            </div>
          </div>
          ${input('codice', 'Codice', 'maxlength="60"')}
        </div>
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
        ${id ? `<section id="pf-images" class="pf-images" data-product="${id}"></section>`
             : `<section class="pf-images"><h3 class="pf-section-title">${Icons.image(15)} Immagini</h3>
                  <div class="settings-section-hint" style="margin:0;">Salva il prodotto: poi, riaprendolo, qui potrai aggiungere le immagini per ogni colore.</div></section>`}
      </div>
      <div class="modal-footer">
        ${id ? `<button class="btn btn-ghost" style="color:var(--priority-urgent);margin-right:auto;" onclick="deleteProductConfirm('${id}')">${Icons.trash(14)} Elimina</button>
        <button class="btn btn-secondary" onclick="duplicateProduct('${id}')">${Icons.copy(14)} Duplica</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('product-form-modal')">Annulla</button>
        <button class="btn btn-primary" id="pf-save" onclick="submitProductForm(${id ? `'${id}'` : 'null'})">${id ? 'Salva modifiche' : 'Crea prodotto'}</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-form-modal'); };
  setTimeout(() => document.getElementById('pf-codice')?.focus(), 50);
  if (id) openProductImages(id);
}

// nuovoNome: fornitore letto da un link e non ancora in anagrafica (si crea al salvataggio)
function productSupplierOptions(selectedId, nuovoNome = '') {
  return `<option value="">— Nessuno —</option>` +
    (nuovoNome ? `<option value="__new" selected>+ Nuovo: ${escapeHtml(ofUpper(nuovoNome))}</option>` : '') +
    TCFactory.getSuppliers().map(s => `<option value="${s.id}" ${!nuovoNome && s.id === selectedId ? 'selected' : ''}>${escapeHtml(s.nome)}</option>`).join('');
}

async function newSupplierFromForm() {
  const nome = prompt('Nome del nuovo fornitore:');
  if (!nome?.trim()) return;
  try {
    const f = await TCFactory.saveSupplier(null, { nome });
    const sel = document.getElementById('pf-fornitore');
    if (sel) sel.innerHTML = productSupplierOptions(f.id);
    _pfNewSupplier = '';
    showToast(`Fornitore "${f.nome}" creato`);
  } catch (e) { showToast(e.message === 'Esiste già' ? 'Fornitore già esistente' : 'Errore — riprova', 'error'); }
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

// Duplica: apre la scheda di un nuovo prodotto con gli stessi dati, da modificare prima di salvare
function duplicateProduct(id) {
  const p = TCFactory.getProduct(id);
  if (!p) return;
  const { id: _id, created_at, updated_at, created_by, ...copy } = p;
  openProductForm(null, {
    ...copy,
    _titolo: 'Duplica prodotto',
    _note: `Copia di <strong>${escapeHtml(TCFactory.productLabel(p))}</strong>: modifica quello che serve (ad esempio il codice) e salva.`,
  });
}

async function submitProductForm(id) {
  const get = (k) => document.getElementById('pf-' + k)?.value?.trim() || '';
  const fields = {};
  TCFactory.PRODUCT_TEXT_FIELDS.forEach(k => { fields[k] = get(k); });
  fields.categoria_id = get('categoria') || null;
  fields.fornitore_id = get('fornitore') || null;
  fields.attivo = document.getElementById('pf-attivo')?.checked ?? true;

  const invalid = (k, msg) => {
    const el = document.getElementById('pf-' + k);
    el?.focus();
    el?.setAttribute('aria-invalid', 'true');
    el?.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
    showToast(msg, 'error');
  };
  if (!fields.descrizione) return invalid('descrizione', 'Inserisci la descrizione del prodotto');
  // Il codice è unico: niente due prodotti con lo stesso codice
  const doppio = fields.codice && TCFactory._products.find(x => x.id !== id && (x.codice || '').trim().toLowerCase() === fields.codice.toLowerCase());
  if (doppio) return invalid('codice', `Il codice ${fields.codice} è già usato da "${doppio.descrizione}"`);
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
    if (fields.fornitore_id === '__new') {
      fields.fornitore_id = (TCFactory.findSupplierByName(_pfNewSupplier) || await TCFactory.saveSupplier(null, { nome: _pfNewSupplier })).id;
    }
    const saved = await TCFactory.saveProduct(id, fields);
    closeModal('product-form-modal');
    showToast(id ? 'Prodotto aggiornato' : `Prodotto "${TCFactory.productLabel(saved)}" creato`);
  } catch (e) {
    console.error('[prodotto]', e);
    showToast(e?.code === '23505' ? 'Esiste già un prodotto con questo codice' : 'Errore durante il salvataggio — riprova', 'error');
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
        <div class="settings-section-hint" style="margin:0;">Leggo dalla pagina fornitore (marca), codice, descrizione, colori, taglie e prezzo: prima di salvare puoi controllare e correggere.</div>
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
      fornitore_id: TCFactory.findSupplierByName(d.catalogo)?.id || null,
      _fornitoreNuovo: d.catalogo && !TCFactory.findSupplierByName(d.catalogo) ? d.catalogo : '',
      codice: d.codice, descrizione: d.descrizione, colori: d.colori, taglie: d.taglie,
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
// EXCEL: esporta, modello vuoto, importa
// ─────────────────────────────────────────────

const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let _xlsxLib = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  _xlsxLib = _xlsxLib || new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = XLSX_URL;
    sc.onload = () => resolve(window.XLSX);
    sc.onerror = () => { _xlsxLib = null; reject(new Error('Lettore Excel non disponibile: controlla la connessione')); };
    document.head.appendChild(sc);
  });
  return _xlsxLib;
}

// Colonne del file, nell'ordine dei prodotti. "alias": intestazioni accettate in import.
const PRODUCT_XL_COLS = [
  { key: 'fornitore',   head: 'Fornitore',   w: 22, alias: ['fornitore', 'catalogo', 'marca', 'brand'] },
  { key: 'codice',      head: 'Codice',      w: 14, alias: ['codice', 'cod', 'sku', 'codice articolo'] },
  { key: 'descrizione', head: 'Descrizione', w: 32, alias: ['descrizione', 'nome', 'prodotto', 'articolo'] },
  { key: 'categoria',   head: 'Categoria',   w: 18, alias: ['categoria'] },
  { key: 'colori',      head: 'Colori',      w: 40, alias: ['colori', 'colore', 'colors'] },
  { key: 'taglie',      head: 'Taglie',      w: 30, alias: ['taglie', 'taglia', 'tg', 'taglie/misure', 'misure'] },
  { key: 'costo',       head: 'Costo',       w: 10, alias: ['costo', 'costo acquisto'], cost: true },
  { key: 'prezzo',      head: 'Prezzo',      w: 10, alias: ['prezzo', 'prezzo vendita'] },
  { key: 'attivo',      head: 'Attivo',      w: 8,  alias: ['attivo'] },
];
const productXlCols = () => PRODUCT_XL_COLS.filter(c => !c.cost || TCAuth.canViewEconomics());
const xlDate = () => localISODate(new Date());

function openProductExcel() {
  const n = TCFactory._products.length;
  const modal = document.getElementById('product-cat-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;" role="dialog" aria-modal="true" aria-labelledby="px-title">
      <div class="modal-header">
        <h2 id="px-title">Esporta e importa prodotti</h2>
        <button class="btn-icon" onclick="closeModal('product-cat-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <button type="button" class="xl-option" onclick="exportProducts(false)" ${n ? '' : 'disabled'}>
          <strong>Esporta tutti i prodotti</strong><small>${n} prodotti in un file Excel</small>
        </button>
        <button type="button" class="xl-option" onclick="exportProducts(true)">
          <strong>Scarica modello vuoto</strong><small>Solo le intestazioni delle colonne, da compilare</small>
        </button>
        <label class="xl-option">
          <strong>Importa da file</strong><small>Excel (.xlsx) o CSV. I prodotti con un codice già esistente vengono aggiornati, gli altri creati.</small>
          <input type="file" accept=".xlsx,.xls,.csv" class="sr-only" onchange="importProductsFile(this.files[0])">
        </label>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-cat-modal'); };
}

async function exportProducts(vuoto) {
  try {
    const X = await loadXlsx();
    const cols = productXlCols();
    const rows = vuoto ? [] : TCFactory.getProducts().map(p => cols.map(c => ({
      fornitore: TCFactory.supplierName(p.fornitore_id), codice: p.codice, descrizione: p.descrizione,
      categoria: TCFactory.productCategoryName(p.categoria_id), colori: p.colori, taglie: p.taglie,
      costo: p.costo ?? '', prezzo: p.prezzo ?? '', attivo: p.attivo ? 'SI' : 'NO',
    })[c.key] ?? ''));
    const ws = X.utils.aoa_to_sheet([cols.map(c => c.head), ...rows]);
    ws['!cols'] = cols.map(c => ({ wch: c.w }));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Prodotti');
    if (vuoto) {
      const help = X.utils.aoa_to_sheet([
        ['Come compilare'],
        ['Una riga per prodotto. Obbligatoria solo la Descrizione.'],
        ['Codice: unico. Se esiste già un prodotto con lo stesso codice, viene aggiornato con le celle compilate.'],
        ['Fornitore e Categoria: se non esistono vengono creati.'],
        ['Colori e Taglie: separati da virgola, es. BIANCO, NERO, NAVY  -  XS, S, M, L, XL'],
        ['Costo e Prezzo: numeri, es. 4,50'],
        ['Attivo: SI o NO (vuoto = SI per i nuovi prodotti)'],
      ]);
      help['!cols'] = [{ wch: 100 }];
      X.utils.book_append_sheet(wb, help, 'Istruzioni');
    }
    X.writeFile(wb, vuoto ? 'modello-prodotti.xlsx' : `prodotti-${xlDate()}.xlsx`);
    closeModal('product-cat-modal');
  } catch (e) { showToast(e.message || 'Esportazione non riuscita', 'error'); }
}

let _productImport = null;   // anteprima in attesa di conferma

async function importProductsFile(file) {
  if (!file) return;
  try {
    const X = await loadXlsx();
    const wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
    const grid = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
    const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const headIdx = grid.findIndex(r => r.some(h => ['codice', 'descrizione'].includes(norm(h))));
    if (headIdx < 0) throw new Error('Non trovo le intestazioni: serve almeno la colonna Codice o Descrizione');
    const colOf = {};
    grid[headIdx].forEach((h, i) => {
      const c = productXlCols().find(c => c.alias.includes(norm(h)));
      if (c && colOf[c.key] === undefined) colOf[c.key] = i;
    });

    const text = (v) => ofUpper(String(v ?? '').replace(/\s+/g, ' ').trim());
    const bool = (v) => { const t = norm(v); return !t ? undefined : !['no', 'n', '0', 'false', 'falso', 'disattivo'].includes(t); };
    const byCode = new Map(TCFactory._products.filter(p => p.codice).map(p => [p.codice.trim().toLowerCase(), p]));
    const seen = new Set();
    const nuovi = [], aggiornati = [], errori = [];
    const fornitoriNuovi = new Set(), categorieNuove = new Set();

    grid.slice(headIdx + 1).forEach((row, k) => {
      const riga = headIdx + k + 2;
      const cell = (key) => colOf[key] === undefined ? '' : row[colOf[key]];
      if (!row.some(v => String(v ?? '').trim())) return;
      const r = {
        fornitore: text(cell('fornitore')), codice: text(cell('codice')), descrizione: text(cell('descrizione')),
        categoria: text(cell('categoria')), colori: text(cell('colori')), taglie: text(cell('taglie')),
      };
      const codeKey = r.codice.toLowerCase();
      if (codeKey && seen.has(codeKey)) { errori.push(`Riga ${riga}: codice ${r.codice} ripetuto nel file`); return; }
      if (codeKey) seen.add(codeKey);
      const esistente = codeKey ? byCode.get(codeKey) : null;
      if (!esistente && !r.descrizione) { errori.push(`Riga ${riga}: manca la descrizione`); return; }

      const prezzi = {};
      for (const k of ['costo', 'prezzo']) {
        if (colOf[k] === undefined || String(cell(k)).trim() === '') continue;
        const n = typeof cell(k) === 'number' ? Math.round(cell(k) * 100) / 100 : parsePrice(cell(k));
        if (Number.isNaN(n) || n === null) { errori.push(`Riga ${riga}: ${k} non valido (${cell(k)})`); return; }
        prezzi[k] = n;
      }
      if (r.fornitore && !TCFactory.findSupplierByName(r.fornitore)) fornitoriNuovi.add(r.fornitore);
      if (r.categoria && !TCFactory.getProductCategories().some(c => c.nome.toLowerCase() === r.categoria.toLowerCase())) categorieNuove.add(r.categoria);

      // Per i prodotti esistenti si aggiornano solo le celle compilate
      const out = { ...prezzi, _fornitore: r.fornitore, _categoria: r.categoria };
      ['codice', 'descrizione', 'colori', 'taglie'].forEach(k => { if (r[k] || !esistente) out[k] = r[k]; });
      const att = bool(cell('attivo'));
      if (att !== undefined) out.attivo = att; else if (!esistente) out.attivo = true;
      if (esistente) aggiornati.push({ id: esistente.id, ...out }); else nuovi.push(out);
    });

    _productImport = { nuovi, aggiornati, fornitoriNuovi: [...fornitoriNuovi], categorieNuove: [...categorieNuove], file: file.name };
    renderProductImportPreview(errori);
  } catch (e) { showToast(e.message || 'File non leggibile', 'error'); }
}

function renderProductImportPreview(errori) {
  const d = _productImport;
  const li = (arr) => arr.map(x => `<li>${escapeHtml(x)}</li>`).join('');
  document.getElementById('product-cat-modal').innerHTML = `
    <div class="modal" style="max-width:560px;" role="dialog" aria-modal="true" aria-labelledby="pp-title">
      <div class="modal-header">
        <h2 id="pp-title">Importa ${escapeHtml(d.file)}</h2>
        <button class="btn-icon" onclick="closeModal('product-cat-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:10px;font-size:0.88rem;">
        <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin:0;">
          <div class="glass-card kpi"><span>Nuovi</span><strong>${d.nuovi.length}</strong></div>
          <div class="glass-card kpi"><span>Da aggiornare</span><strong>${d.aggiornati.length}</strong></div>
          <div class="glass-card kpi"><span>Righe scartate</span><strong style="color:${errori.length ? '#ef4444' : 'inherit'};">${errori.length}</strong></div>
        </div>
        ${d.fornitoriNuovi.length ? `<div><strong>Fornitori da creare:</strong> ${escapeHtml(d.fornitoriNuovi.join(', '))}</div>` : ''}
        ${d.categorieNuove.length ? `<div><strong>Categorie da creare:</strong> ${escapeHtml(d.categorieNuove.join(', '))}</div>` : ''}
        ${errori.length ? `<details><summary style="cursor:pointer;color:#ef4444;">Righe scartate</summary><ul style="margin:6px 0 0 18px;">${li(errori.slice(0, 50))}${errori.length > 50 ? `<li>… e altre ${errori.length - 50}</li>` : ''}</ul></details>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('product-cat-modal')">Annulla</button>
        <button class="btn btn-primary" id="pp-go" ${d.nuovi.length + d.aggiornati.length ? '' : 'disabled'} onclick="confirmProductImport()">Importa ${d.nuovi.length + d.aggiornati.length} prodotti</button>
      </div>
    </div>`;
  const modal = document.getElementById('product-cat-modal');
  modal.classList.add('active');
}

async function confirmProductImport() {
  const d = _productImport;
  if (!d) return;
  const btn = document.getElementById('pp-go');
  if (btn) { btn.disabled = true; btn.textContent = 'Importazione…'; }
  try {
    for (const nome of d.fornitoriNuovi) if (!TCFactory.findSupplierByName(nome)) await TCFactory.saveSupplier(null, { nome });
    for (const nome of d.categorieNuove) {
      if (!TCFactory.getProductCategories().some(c => c.nome.toLowerCase() === nome.toLowerCase())) await TCFactory.saveProductCategory(null, nome);
    }
    const catId = (nome) => TCFactory.getProductCategories().find(c => c.nome.toLowerCase() === nome.toLowerCase())?.id || null;
    const finale = (r) => {
      const { _fornitore, _categoria, ...rest } = r;
      if (_fornitore) rest.fornitore_id = TCFactory.findSupplierByName(_fornitore)?.id || null;
      if (_categoria) rest.categoria_id = catId(_categoria);
      return rest;
    };
    await TCFactory.importProducts(d.nuovi.map(finale), d.aggiornati.map(finale));
    closeModal('product-cat-modal');
    showToast(`Importati ${d.nuovi.length} nuovi prodotti, aggiornati ${d.aggiornati.length}`);
    _productImport = null;
  } catch (e) {
    console.error('[import prodotti]', e);
    showToast(e?.code === '23505' ? 'Importazione annullata: un codice è già usato da un altro prodotto' : 'Importazione non riuscita — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Riprova'; }
  }
}

// ─────────────────────────────────────────────
// FORNITORI (#/prodotti/fornitori)
// ─────────────────────────────────────────────

function renderSuppliersPage() {
  const list = TCFactory.getSuppliers();
  const count = (id) => TCFactory._products.filter(p => p.fornitore_id === id).length;
  const rows = list.map(f => `
    <tr class="data-row" tabindex="0" onclick="openSupplierForm('${f.id}')" onkeydown="if(event.key==='Enter')openSupplierForm('${f.id}')">
      <td data-label="Fornitore"><strong>${escapeHtml(f.nome)}</strong>${f.referente ? `<small>${escapeHtml(f.referente)}</small>` : ''}</td>
      <td class="hide-sm"><div class="cell-stack">${f.email ? `<span>${escapeHtml(f.email)}</span>` : ''}${f.telefono ? `<small>${escapeHtml(f.telefono)}</small>` : ''}${!f.email && !f.telefono ? '<span class="muted">—</span>' : ''}</div></td>
      <td class="hide-sm">${f.sito ? `<a href="${escapeHtml(/^https?:\/\//i.test(f.sito) ? f.sito : 'https://' + f.sito)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(f.sito.replace(/^https?:\/\//i, ''))}</a>` : '<span class="muted">—</span>'}</td>
      <td class="num" data-label="Prodotti">
        <button type="button" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showSupplierProducts('${f.id}')" title="Vedi i prodotti">${count(f.id)}</button>
      </td>
    </tr>`).join('');
  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <span class="table-count">${list.length} ${list.length === 1 ? 'fornitore' : 'fornitori'}</span>
      </div>
      ${list.length === 0 ? `
        <div class="empty-list">
          Nessun fornitore ancora.<br><br>
          <button class="btn btn-primary" onclick="openSupplierForm()">${Icons.plus()} Crea il primo fornitore</button>
        </div>` : `
      <div class="table-scroll">
        <table class="data-table cards-sm">
          <thead><tr><th>Fornitore</th><th class="hide-sm">Contatti</th><th class="hide-sm">Sito</th><th class="num">Prodotti</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>`;
}

function showSupplierProducts(id) {
  ProductState.fornitore = id;
  ProductState.stato = 'tutti';
  Nav.go('prodotti');
}

function openSupplierForm(id = null) {
  const f = id ? TCFactory.getSupplier(id) : null;
  const v = (k) => escapeHtml(f?.[k] ?? '');
  const input = (k, label, attrs = '') => `
    <div class="form-group">
      <label class="form-label" for="sf-${k}">${label}</label>
      <input id="sf-${k}" class="form-input" value="${v(k)}" ${attrs}>
    </div>`;
  const n = id ? TCFactory._products.filter(p => p.fornitore_id === id).length : 0;
  const modal = document.getElementById('supplier-form-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:600px;" role="dialog" aria-modal="true" aria-labelledby="sf-title">
      <div class="modal-header">
        <h2 id="sf-title">${f ? 'Modifica fornitore' : 'Nuovo fornitore'}</h2>
        <button class="btn-icon" onclick="closeModal('supplier-form-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:14px;">
        <div class="form-row">${input('nome', 'Nome *', 'maxlength="120"')}${input('referente', 'Referente', 'maxlength="120"')}</div>
        <div class="form-row">${input('email', 'Email', 'type="email" maxlength="160"')}${input('telefono', 'Telefono', 'type="tel" maxlength="40"')}</div>
        ${input('sito', 'Sito web', 'type="url" maxlength="300" placeholder="es. www.fornitore.it"')}
        <div class="form-group">
          <label class="form-label" for="sf-note">Note</label>
          <textarea id="sf-note" class="form-textarea" maxlength="2000">${v('note')}</textarea>
        </div>
        ${f ? `<div class="settings-section-hint" style="margin:0;">${n} ${n === 1 ? 'prodotto collegato' : 'prodotti collegati'}.</div>` : ''}
      </div>
      <div class="modal-footer">
        ${f ? `<button class="btn btn-ghost" style="color:var(--priority-urgent);margin-right:auto;" onclick="deleteSupplierConfirm('${f.id}')">${Icons.trash(14)} Elimina</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('supplier-form-modal')">Annulla</button>
        <button class="btn btn-primary" id="sf-save" onclick="submitSupplierForm(${f ? `'${f.id}'` : 'null'})">${f ? 'Salva modifiche' : 'Crea fornitore'}</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('supplier-form-modal'); };
  setTimeout(() => document.getElementById('sf-nome')?.focus(), 50);
}

async function submitSupplierForm(id) {
  const get = (k) => document.getElementById('sf-' + k)?.value?.trim() || '';
  const fields = Object.fromEntries(TCFactory.SUPPLIER_FIELDS.map(k => [k, get(k)]));
  if (!fields.nome) { document.getElementById('sf-nome')?.focus(); showToast('Inserisci il nome del fornitore', 'error'); return; }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) { document.getElementById('sf-email')?.focus(); showToast('Email non valida', 'error'); return; }
  const btn = document.getElementById('sf-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…'; }
  try {
    const saved = await TCFactory.saveSupplier(id, fields);
    closeModal('supplier-form-modal');
    showToast(id ? 'Fornitore aggiornato' : `Fornitore "${saved.nome}" creato`);
  } catch (e) {
    showToast(e.message === 'Esiste già' ? 'Esiste già un fornitore con questo nome' : 'Errore durante il salvataggio — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Salva modifiche' : 'Crea fornitore'; }
  }
}

async function deleteSupplierConfirm(id) {
  const n = TCFactory._products.filter(p => p.fornitore_id === id).length;
  if (!confirm(`Eliminare il fornitore "${TCFactory.supplierName(id)}"?${n ? `\n\n${n} prodotti resteranno senza fornitore.` : ''}`)) return;
  try {
    await TCFactory.deleteSupplier(id);
    closeModal('supplier-form-modal');
    showToast('Fornitore eliminato');
  } catch (e) { showToast('Errore eliminazione fornitore', 'error'); }
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
