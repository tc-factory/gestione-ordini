/**
 * T&C Factory — Prodotti
 * Anagrafica articoli: codice, categoria, marca, fornitore, colori, taglie e prezzi.
 */

const ProductState = {
  search: '',
  categoria: '',          // '' = tutte
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
        <p>Esegui lo script <strong>sql/prodotti-setup.sql</strong> nell'SQL Editor di Supabase, poi ricarica la pagina.</p>
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
  if (ProductState.categoria && !cats.includes(ProductState.categoria)) ProductState.categoria = '';

  const list = all.filter(p => {
    if (ProductState.stato === 'attivi' && !p.attivo) return false;
    if (ProductState.stato === 'disattivi' && p.attivo) return false;
    if (ProductState.categoria && p.categoria !== ProductState.categoria) return false;
    if (!q) return true;
    return [p.nome, p.codice, p.categoria, p.marca, p.fornitore, p.colori, p.taglie]
      .some(v => (v || '').toLowerCase().includes(q));
  });

  const rows = list.map(p => `
    <tr class="data-row ${p.attivo ? '' : 'row-muted'}" tabindex="0" onclick="openProductForm('${p.id}')" onkeydown="if(event.key==='Enter')openProductForm('${p.id}')">
      <td>
        <div class="cell-stack">
          <strong>${escapeHtml(p.nome || 'Senza nome')}${p.attivo ? '' : ' <span class="chip chip-muted">disattivo</span>'}</strong>
          <small>${[p.codice, p.categoria].filter(Boolean).map(escapeHtml).join(' · ') || '—'}</small>
        </div>
      </td>
      <td class="hide-sm"><div class="cell-stack"><span>${escapeHtml(p.marca) || '—'}</span>${p.fornitore ? `<small>${escapeHtml(p.fornitore)}</small>` : ''}</div></td>
      <td class="hide-sm"><div class="cell-stack"><span>${escapeHtml(p.colori) || '—'}</span>${p.taglie ? `<small>${escapeHtml(p.taglie)}</small>` : ''}</div></td>
      ${showCost ? `<td class="num" data-label="Costo">${p.costo !== null ? euro(p.costo) : '—'}</td>` : ''}
      <td class="num" data-label="Prezzo">${p.prezzo !== null ? euro(p.prezzo) : '—'}</td>
    </tr>`).join('');

  return `
    <div class="glass-card page-card list-shell">
      <div class="table-toolbar">
        <div class="search-box">
          ${Icons.search()}
          <input id="product-search" type="text" placeholder="Cerca nome, codice, marca, fornitore…" value="${escapeHtml(ProductState.search)}" oninput="setProductSearch(this.value)">
        </div>
        ${cats.length ? `
        <select class="form-select" style="width:auto;" aria-label="Categoria" onchange="setProductCategoria(this.value)">
          <option value="">Tutte le categorie</option>
          ${cats.map(c => `<option value="${escapeHtml(c)}" ${ProductState.categoria === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>` : ''}
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
            <th>Prodotto</th><th class="hide-sm">Marca / fornitore</th><th class="hide-sm">Colori / taglie</th>
            ${showCost ? '<th class="num">Costo</th>' : ''}<th class="num">Prezzo</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>`;
}

// ─────────────────────────────────────────────
// MODULO PRODOTTO
// ─────────────────────────────────────────────

function openProductForm(id = null) {
  const p = id ? TCFactory.getProduct(id) : null;
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
        <h2 id="pf-title">${p ? 'Modifica prodotto' : 'Nuovo prodotto'}</h2>
        <button class="btn-icon" onclick="closeModal('product-form-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:18px;">
        <fieldset class="form-section">
          <legend>Dati principali</legend>
          <div class="form-row">${input('nome', 'Nome *', 'maxlength="160"')}${input('codice', 'Codice', 'maxlength="60"')}</div>
          <div class="form-row">
            ${input('categoria', 'Categoria', 'maxlength="60" list="pf-cat-list" placeholder="es. T-shirt, Felpe…"')}
            ${input('marca', 'Marca', 'maxlength="80"')}
          </div>
          <datalist id="pf-cat-list">${TCFactory.getProductCategories().map(c => `<option value="${escapeHtml(c)}">`).join('')}</datalist>
          ${input('fornitore', 'Fornitore', 'maxlength="120"')}
        </fieldset>

        <fieldset class="form-section">
          <legend>Varianti</legend>
          <div class="form-row">
            ${input('colori', 'Colori', 'maxlength="300" placeholder="es. Bianco, Nero, Navy"')}
            ${input('taglie', 'Taglie', 'maxlength="200" placeholder="es. XS–3XL"')}
          </div>
        </fieldset>

        <fieldset class="form-section">
          <legend>Prezzi</legend>
          <div class="form-row">${showCost ? price('costo', 'Costo di acquisto') : ''}${price('prezzo', 'Prezzo di vendita')}</div>
        </fieldset>

        <div class="form-group">
          <label class="form-label" for="pf-note">Note</label>
          <textarea id="pf-note" class="form-textarea" maxlength="2000">${v('note')}</textarea>
        </div>

        <label class="switch-row">
          <span><strong>Prodotto attivo</strong><small>I prodotti disattivi restano in archivio ma non compaiono nell'elenco principale</small></span>
          <input id="pf-attivo" type="checkbox" class="switch" ${p && !p.attivo ? '' : 'checked'}>
        </label>
      </div>
      <div class="modal-footer">
        ${p ? `<button class="btn btn-ghost" style="color:var(--priority-urgent);margin-right:auto;" onclick="deleteProductConfirm('${p.id}')">${Icons.trash(14)} Elimina</button>` : ''}
        <button class="btn btn-secondary" onclick="closeModal('product-form-modal')">Annulla</button>
        <button class="btn btn-primary" id="pf-save" onclick="submitProductForm(${p ? `'${p.id}'` : 'null'})">${p ? 'Salva modifiche' : 'Crea prodotto'}</button>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('product-form-modal'); };
  setTimeout(() => document.getElementById('pf-nome')?.focus(), 50);
}

async function submitProductForm(id) {
  const get = (k) => document.getElementById('pf-' + k)?.value?.trim() || '';
  const fields = {};
  TCFactory.PRODUCT_TEXT_FIELDS.forEach(k => { fields[k] = get(k); });
  fields.attivo = document.getElementById('pf-attivo')?.checked ?? true;

  const invalid = (k, msg) => {
    const el = document.getElementById('pf-' + k);
    el?.focus();
    el?.setAttribute('aria-invalid', 'true');
    el?.addEventListener('input', () => el.removeAttribute('aria-invalid'), { once: true });
    showToast(msg, 'error');
  };
  if (!fields.nome) return invalid('nome', 'Inserisci il nome del prodotto');
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
    showToast(id ? 'Prodotto aggiornato' : `Prodotto "${saved.nome}" creato`);
  } catch (e) {
    console.error('[prodotto]', e);
    showToast('Errore durante il salvataggio — riprova', 'error');
    if (btn) { btn.disabled = false; btn.textContent = id ? 'Salva modifiche' : 'Crea prodotto'; }
  }
}

async function deleteProductConfirm(id) {
  const p = TCFactory.getProduct(id);
  if (!confirm(`Eliminare "${p?.nome}"?\n\nSe vuoi solo nasconderlo, disattivalo.`)) return;
  try {
    await TCFactory.deleteProduct(id);
    closeModal('product-form-modal');
    showToast('Prodotto eliminato');
  } catch (e) { showToast('Errore eliminazione prodotto', 'error'); }
}
