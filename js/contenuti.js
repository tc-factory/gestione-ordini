/**
 * T&C Factory — Content Studio
 *
 * Fase 1: Brand Kit. Una scheda per brand (tabella brand_kits, file nel bucket pubblico brand-kit)
 * con loghi, palette, font, tono di voce, target, prodotti, parole da usare ed evitare ed esempi
 * di post riusciti. È il contesto passato a ogni generazione (supabase/functions/_shared/brand-kit.ts).
 * Gli account Instagram e Facebook si leggono da social_account (tc_brand_kit_account), non si duplicano.
 *  #/contenuti            → il primo brand
 *  #/contenuti/<negozio>  → quel brand
 */

const CS_BRAND = [
  { id: 'ciucciamilcalzino', label: 'Ciucciami il Calzino', logo: 'img/loghi-negozi/ciucciamilcalzino.png' },
  { id: 'bienjugado',        label: 'Bienjugado',           logo: 'img/loghi-negozi/bienjugado.png' },
  { id: 'boxfactorylab',     label: 'Box Factory Lab',      logo: 'img/loghi-negozi/boxfactorylab.png' },
];

const Studio = {
  kits: {},          // negozio → riga brand_kits
  bozza: null,       // copia in modifica del brand aperto
  account: {},       // negozio → account collegati
  modificato: false,
  salvataggio: false,
  caricato: false,
  errore: null,
};

const studioUrl = (path) => path ? `${SUPABASE_URL}/storage/v1/object/public/brand-kit/${path.split('/').map(encodeURIComponent).join('/')}` : '';
const studioNegozio = () => CS_BRAND.find(b => b.id === Nav.param) || CS_BRAND[0];
const studioHex = (v) => /^#[0-9a-f]{6}$/i.test((v || '').trim());

async function openContenutiPage() {
  const root = document.getElementById('contenuti-root');
  if (!root) return;
  if (!Studio.caricato) {
    root.innerHTML = `<div class="glass-card empty-state"><p>Caricamento…</p></div>`;
    const { data, error } = await supabaseClient.from('brand_kits').select('*');
    if (error) Studio.errore = error.message;
    else (data || []).forEach(k => { Studio.kits[k.negozio] = k; });
    Studio.caricato = true;
  }
  const b = studioNegozio();
  if (!Studio.bozza || Studio.bozza.negozio !== b.id) studioApriBozza(b.id);
  if (!Studio.account[b.id]) {
    supabaseClient.rpc('tc_brand_kit_account', { p_negozio: b.id }).then(({ data }) => {
      Studio.account[b.id] = data || [];
      if (Nav.current === 'contenuti' && studioNegozio().id === b.id) renderStudioAccount();
    });
  }
  renderContenuti();
}

function studioApriBozza(negozio) {
  const k = Studio.kits[negozio];
  Studio.bozza = k ? structuredClone(k) : null;
  Studio.modificato = false;
}

async function studioScegli(id) {
  if (id === studioNegozio().id) return;
  if (Studio.modificato && !(await uiConfirm('Ci sono modifiche non salvate. Cambiare brand e perderle?', { ok: 'Cambia brand', danger: true }))) return;
  Studio.modificato = false;
  Nav.go('contenuti', id);
}

function renderContenuti() {
  const root = document.getElementById('contenuti-root');
  if (!root) return;
  const b = studioNegozio();
  const k = Studio.bozza;

  const brandBar = `
    <div class="com-negozi-bar cs-brand-bar" role="tablist" aria-label="Brand">
      ${CS_BRAND.map(x => `
        <button type="button" class="glass-card com-negozio-btn ${x.id === b.id ? 'is-on' : ''}" role="tab" aria-selected="${x.id === b.id}"
          aria-label="${escapeHtml(x.label)}" title="${escapeHtml(x.label)}" onclick="studioScegli('${x.id}')">
          <img src="${x.logo}" alt="">
        </button>`).join('')}
    </div>`;

  if (Studio.errore || !k) {
    root.innerHTML = `${brandBar}
      <div class="glass-card empty-state">
        <h2>Brand Kit da attivare</h2>
        <p>${Studio.errore ? escapeHtml(Studio.errore) : 'Esegui sql/content-studio-brand-kit.sql su Supabase, poi ricarica la pagina.'}</p>
      </div>`;
    return;
  }

  root.innerHTML = `${brandBar}
    <div class="glass-card page-card cs-kit">
      <div class="page-card-head cs-kit-head">
        <h2>Brand Kit · ${escapeHtml(k.nome)}</h2>
        <div class="cs-kit-azioni">
          <button type="button" class="btn btn-secondary" id="cs-annulla" onclick="studioAnnulla()" ${Studio.modificato ? '' : 'hidden'}>Annulla</button>
          <button type="button" class="btn btn-primary" id="cs-salva" onclick="studioSalva()" ${Studio.modificato && !Studio.salvataggio ? '' : 'disabled'}>${Studio.salvataggio ? 'Salvataggio…' : 'Salva'}</button>
        </div>
      </div>
      <div class="page-card-body cs-kit-body">
        ${studioSezione('Account collegati', `<div id="cs-account">${studioAccountHtml(b.id)}</div>`)}
        ${studioSezione('Loghi', `
          <div class="cs-loghi">
            ${studioLogoHtml('logo_chiaro', 'Su fondo chiaro', false)}
            ${studioLogoHtml('logo_scuro', 'Su fondo scuro', true)}
          </div>`)}
        ${studioSezione('Palette', `<div id="cs-palette">${studioPaletteHtml()}</div>`)}
        ${studioSezione('Font', `
          <div class="cs-font">
            ${studioFontHtml('titoli', 'Titoli')}
            ${studioFontHtml('testi', 'Testi')}
          </div>`)}
        ${studioSezione('Tono di voce', studioTesto('tono_voce', 'Come parla il brand: registro, espressioni, emoji, chiusure'))}
        ${studioSezione('Target', studioTesto('target', 'A chi si rivolge'))}
        ${studioSezione('Prodotti principali', studioTesto('prodotti', 'Prodotti, collezioni, prezzi, più venduti'))}
        ${studioSezione('Parole', `
          <div class="cs-parole">
            ${studioParoleHtml('parole_si', 'Da usare')}
            ${studioParoleHtml('parole_no', 'Da evitare')}
          </div>`)}
        ${studioSezione('Esempi di post riusciti', `<div id="cs-esempi">${studioEsempiHtml()}</div>`)}
      </div>
    </div>`;
}

const studioSezione = (titolo, corpo) => `<section class="cs-sez"><h3>${titolo}</h3>${corpo}</section>`;

function studioTesto(campo, ph) {
  return `<textarea class="form-textarea cs-area" rows="4" placeholder="${escapeHtml(ph)}" aria-label="${escapeHtml(ph)}"
    oninput="studioCampo('${campo}', this.value)">${escapeHtml(Studio.bozza[campo] || '')}</textarea>`;
}

// ── Account ──
function studioAccountHtml(negozio) {
  const lista = Studio.account[negozio];
  if (!lista) return `<p class="cs-muted">Caricamento…</p>`;
  if (!lista.length) return `<p class="cs-muted">Nessun account collegato: si collegano dal Centro di controllo → Collegamenti.</p>`;
  return `<div class="cs-account">${lista.map(a => `
    <span class="cs-account-chip">
      ${a.piattaforma === 'instagram' ? COM_LOGHI.instagram() : COM_LOGHI.facebook()}
      <span><strong>${escapeHtml(a.piattaforma === 'instagram' ? '@' + (a.username || a.nome) : (a.nome || a.username))}</strong>
      <small>${a.piattaforma === 'instagram' ? 'Instagram' : 'Pagina Facebook'}</small></span>
    </span>`).join('')}</div>`;
}
function renderStudioAccount() {
  const el = document.getElementById('cs-account');
  if (el) el.innerHTML = studioAccountHtml(studioNegozio().id);
}

// ── Loghi ──
function studioLogoHtml(campo, etichetta, scuro) {
  const path = Studio.bozza[campo];
  return `
    <div class="cs-logo">
      <div class="cs-logo-box ${scuro ? 'is-scuro' : ''}">
        ${path ? `<img src="${studioUrl(path)}" alt="${escapeHtml(etichetta)}">` : `<span class="cs-muted">Nessun logo</span>`}
      </div>
      <div class="cs-logo-piede">
        <span>${etichetta}</span>
        <label class="btn btn-secondary btn-sm">Cambia
          <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden onchange="studioCaricaLogo('${campo}', this)">
        </label>
      </div>
    </div>`;
}

async function studioCarica(file, cartella) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${Studio.bozza.negozio}/${cartella}/${Date.now()}.${ext}`;
  const { error } = await supabaseClient.storage.from('brand-kit').upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

async function studioCaricaLogo(campo, input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    Studio.bozza[campo] = await studioCarica(file, 'loghi');
    studioSegna();
    renderContenuti();
  } catch (e) { uiAlert('Caricamento non riuscito: ' + e.message); }
}

// ── Palette ──
function studioPaletteHtml() {
  const pal = Studio.bozza.palette || [];
  return `
    <div class="cs-palette">
      ${pal.map((c, i) => `
        <div class="cs-colore">
          <span class="cs-swatch" style="background:${studioHex(c.hex) ? c.hex : 'transparent'}" id="cs-sw-${i}"></span>
          <input class="form-input" value="${escapeHtml(c.nome || '')}" placeholder="Nome" aria-label="Nome del colore" oninput="studioColore(${i}, 'nome', this.value)">
          <input class="form-input cs-hex" value="${escapeHtml(c.hex || '')}" placeholder="#000000" aria-label="Codice esadecimale" maxlength="7" oninput="studioColore(${i}, 'hex', this.value)">
          <button type="button" class="btn-icon" aria-label="Togli ${escapeHtml(c.nome || 'colore')}" onclick="studioTogliColore(${i})">${Icons.x(14)}</button>
        </div>`).join('')}
    </div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="studioAggiungiColore()">${Icons.plus()} Colore</button>`;
}
function studioColore(i, chiave, v) {
  Studio.bozza.palette[i][chiave] = chiave === 'hex' ? v.trim().toUpperCase() : v;
  if (chiave === 'hex') {
    const sw = document.getElementById('cs-sw-' + i);
    if (sw) sw.style.background = studioHex(v) ? v.trim() : 'transparent';
  }
  studioSegna();
}
function studioAggiungiColore() {
  (Studio.bozza.palette ||= []).push({ nome: '', hex: '' });
  studioSegna(); studioRidisegna('cs-palette', studioPaletteHtml);
}
function studioTogliColore(i) {
  Studio.bozza.palette.splice(i, 1);
  studioSegna(); studioRidisegna('cs-palette', studioPaletteHtml);
}

// ── Font ──
function studioFontHtml(chiave, etichetta) {
  const f = (Studio.bozza.font || {})[chiave] || {};
  return `
    <div class="form-group">
      <label class="form-label" for="cs-font-${chiave}">${etichetta}</label>
      <input class="form-input" id="cs-font-${chiave}" value="${escapeHtml(f.nome || '')}" placeholder="Nome del font" oninput="studioFont('${chiave}', this.value)">
      <div class="cs-font-file">
        ${f.file ? `<a href="${studioUrl(f.file)}" target="_blank" rel="noopener">${Icons.download()} ${escapeHtml(f.file.split('/').pop())}</a>` : `<span class="cs-muted">Nessun file</span>`}
        <label class="btn btn-ghost btn-sm">${f.file ? 'Sostituisci' : 'Carica file'}
          <input type="file" accept=".ttf,.otf,.woff,.woff2" hidden onchange="studioCaricaFont('${chiave}', this)">
        </label>
      </div>
    </div>`;
}
function studioFont(chiave, v) {
  Studio.bozza.font ||= {};
  (Studio.bozza.font[chiave] ||= {}).nome = v;
  studioSegna();
}
async function studioCaricaFont(chiave, input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const path = await studioCarica(file, 'font');
    Studio.bozza.font ||= {};
    (Studio.bozza.font[chiave] ||= {}).file = path;
    studioSegna(); renderContenuti();
  } catch (e) { uiAlert('Caricamento non riuscito: ' + e.message); }
}

// ── Parole ──
function studioParoleHtml(campo, etichetta) {
  const lista = Studio.bozza[campo] || [];
  return `
    <div class="cs-parole-col" id="cs-${campo}">
      <span class="form-label">${etichetta}</span>
      <div class="cs-chips">
        ${lista.map((p, i) => `<span class="cs-chip ${campo === 'parole_no' ? 'is-no' : ''}">${escapeHtml(p)}
          <button type="button" aria-label="Togli ${escapeHtml(p)}" onclick="studioTogliParola('${campo}', ${i})">${Icons.x(11)}</button></span>`).join('')}
      </div>
      <input class="form-input" placeholder="Scrivi e premi Invio" aria-label="Aggiungi parola ${etichetta.toLowerCase()}"
        onkeydown="if(event.key==='Enter'){event.preventDefault();studioAggiungiParola('${campo}', this)}">
    </div>`;
}
function studioAggiungiParola(campo, input) {
  const v = input.value.trim();
  if (!v) return;
  const lista = (Studio.bozza[campo] ||= []);
  if (!lista.some(p => p.toLowerCase() === v.toLowerCase())) lista.push(v);
  studioSegna();
  studioRidisegna('cs-' + campo, () => studioParoleHtml(campo, campo === 'parole_si' ? 'Da usare' : 'Da evitare'), true);
  document.querySelector(`#cs-${campo} input`)?.focus();
}
function studioTogliParola(campo, i) {
  Studio.bozza[campo].splice(i, 1);
  studioSegna();
  studioRidisegna('cs-' + campo, () => studioParoleHtml(campo, campo === 'parole_si' ? 'Da usare' : 'Da evitare'), true);
}

// ── Esempi ──
function studioEsempiHtml() {
  const lista = Studio.bozza.esempi || [];
  return `
    <div class="cs-esempi">
      ${lista.map((e, i) => `
        <article class="cs-esempio">
          <div class="cs-esempio-img">
            ${e.immagine ? `<img src="${studioUrl(e.immagine)}" alt="" loading="lazy">` : `<span class="cs-muted">${Icons.image(22)}</span>`}
            <div class="cs-esempio-cambia"><label class="btn btn-secondary btn-sm">${e.immagine ? 'Cambia' : 'Immagine'}
              <input type="file" accept="image/*" hidden onchange="studioCaricaEsempio(${i}, this)">
            </label></div>
          </div>
          <input class="form-input" value="${escapeHtml(e.url || '')}" placeholder="Link al post" aria-label="Link al post" oninput="studioEsempio(${i}, 'url', this.value)">
          <textarea class="form-textarea" rows="3" placeholder="Perché funziona" aria-label="Perché funziona" oninput="studioEsempio(${i}, 'nota', this.value)">${escapeHtml(e.nota || '')}</textarea>
          <div class="cs-esempio-piede">
            ${e.url ? `<a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${Icons.link(13)} Apri il post</a>` : '<span></span>'}
            <button type="button" class="btn btn-ghost btn-sm" onclick="studioTogliEsempio(${i})">${Icons.trash(13)} Togli</button>
          </div>
        </article>`).join('')}
    </div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="studioAggiungiEsempio()">${Icons.plus()} Esempio</button>`;
}
function studioEsempio(i, chiave, v) { Studio.bozza.esempi[i][chiave] = v; studioSegna(); }
function studioAggiungiEsempio() {
  (Studio.bozza.esempi ||= []).push({ url: '', immagine: '', nota: '' });
  studioSegna(); studioRidisegna('cs-esempi', studioEsempiHtml);
}
async function studioTogliEsempio(i) {
  if (!(await uiConfirm('Togliere questo esempio?', { ok: 'Togli', danger: true }))) return;
  Studio.bozza.esempi.splice(i, 1);
  studioSegna(); studioRidisegna('cs-esempi', studioEsempiHtml);
}
async function studioCaricaEsempio(i, input) {
  const file = input.files?.[0];
  if (!file) return;
  try {
    Studio.bozza.esempi[i].immagine = await studioCarica(file, 'esempi');
    studioSegna(); studioRidisegna('cs-esempi', studioEsempiHtml);
  } catch (e) { uiAlert('Caricamento non riuscito: ' + e.message); }
}

// ── Modifiche e salvataggio ──
function studioRidisegna(id, html, esterno = false) {
  const el = document.getElementById(id);
  if (!el) return;
  if (esterno) el.outerHTML = html(); else el.innerHTML = html();
}
function studioCampo(campo, v) { Studio.bozza[campo] = v; studioSegna(); }
function studioSegna() {
  Studio.modificato = true;
  const salva = document.getElementById('cs-salva');
  if (salva && !Studio.salvataggio) salva.disabled = false;
  const annulla = document.getElementById('cs-annulla');
  if (annulla) annulla.hidden = false;
}

async function studioAnnulla() {
  if (!(await uiConfirm('Annullare le modifiche non salvate?', { ok: 'Annulla modifiche', danger: true }))) return;
  studioApriBozza(Studio.bozza.negozio);
  renderContenuti();
}

async function studioSalva() {
  const k = Studio.bozza;
  const errati = (k.palette || []).filter(c => !studioHex(c.hex));
  if (errati.length) return uiAlert(`Codice colore non valido${errati[0].nome ? ` per "${errati[0].nome}"` : ''}: usa il formato #RRGGBB.`);
  Studio.salvataggio = true;
  renderContenuti();
  const campi = {
    logo_chiaro: k.logo_chiaro || null, logo_scuro: k.logo_scuro || null,
    palette: (k.palette || []).map(c => ({ nome: (c.nome || '').trim(), hex: c.hex.trim().toUpperCase() })),
    font: k.font || {},
    tono_voce: k.tono_voce || '', target: k.target || '', prodotti: k.prodotti || '',
    parole_si: k.parole_si || [], parole_no: k.parole_no || [],
    esempi: (k.esempi || []).filter(e => e.url || e.immagine || e.nota),
  };
  const { data, error } = await supabaseClient.from('brand_kits').update(campi).eq('negozio', k.negozio).select().single();
  Studio.salvataggio = false;
  if (error) { renderContenuti(); return uiAlert('Salvataggio non riuscito: ' + error.message); }
  Studio.kits[k.negozio] = data;
  studioApriBozza(k.negozio);
  renderContenuti();
  showToast('Brand Kit salvato');
}

window.addEventListener('beforeunload', (e) => { if (Studio.modificato) e.preventDefault(); });
