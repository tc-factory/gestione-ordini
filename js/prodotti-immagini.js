/**
 * T&C Factory — Immagini dei prodotti
 * Una o più immagini per colore, con vista fronte / retro / lato.
 * Si caricano più file o un'intera cartella (anche trascinandola): colore e vista
 * si riconoscono dal nome del file e delle cartelle, il resto si assegna a mano.
 */

// ─────────────────────────────────────────────
// RICONOSCIMENTO DAL NOME DEL FILE
// ─────────────────────────────────────────────

// "Regent_Rosa-Chiaro FRONT.jpg" → "regent rosa chiaro front jpg"
const imgNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Colori equivalenti (italiano / inglese / varianti di scrittura)
const IMG_COLOR_GROUPS = [
  ['nero', 'nera', 'black', 'noir'],
  ['bianco', 'bianca', 'white', 'blanc', 'blank white'],
  ['grigio', 'grey', 'gray'],
  ['grigio scuro', 'dark grey', 'dark gray', 'antracite', 'anthracite', 'charcoal'],
  ['grigio chiaro', 'light grey', 'light gray'],
  ['grigio melange', 'grey melange', 'gray melange', 'heather grey', 'sport grey', 'melange'],
  ['blu', 'blue'],
  ['navy', 'blu navy', 'navy blue', 'blu notte', 'light navy'],
  ['royal', 'blu royal', 'royal blue', 'blu reale'],
  ['azzurro', 'celeste', 'light blue', 'sky blue', 'sky'],
  ['rosso', 'rossa', 'red'],
  ['bordeaux', 'bordo', 'burgundy', 'maroon', 'wine'],
  ['verde', 'green'],
  ['verde militare', 'army', 'military green', 'army green'],
  ['oliva', 'olive', 'verde oliva'],
  ['verde bottiglia', 'bottle green', 'forest green'],
  ['giallo', 'gialla', 'yellow'],
  ['arancione', 'arancio', 'orange'],
  ['rosa', 'pink'],
  ['fucsia', 'fuchsia'],
  ['viola', 'purple'],
  ['lilla', 'lilac', 'liliac', 'lavanda', 'lavender'],
  ['marrone', 'brown', 'chocolate', 'cioccolato'],
  ['beige', 'sand', 'sabbia'],
  ['kaki', 'khaki'],
  ['panna', 'off white', 'ecru', 'natural', 'naturale', 'crema', 'cream'],
  ['turchese', 'turquoise'],
];

// Tutti i modi in cui un colore del prodotto può comparire nel nome del file
function imgColorNames(colore) {
  const n = imgNorm(colore);
  const names = new Set([n]);
  for (const g of IMG_COLOR_GROUPS) if (g.includes(n)) g.forEach(x => names.add(x));
  return [...names].filter(Boolean);
}

const IMG_VIEWS = {
  fronte: ['fronte', 'front', 'frontale', 'davanti', 'avanti', 'anteriore', 'fr'],
  retro:  ['retro', 'back', 'dietro', 'posteriore', 'rear', 'bk'],
  lato:   ['lato', 'side', 'laterale', 'fianco', 'profilo', 'left', 'right', 'sx', 'dx'],
};
const IMG_VIEW_LABEL = { fronte: 'Fronte', retro: 'Retro', lato: 'Lato', '': 'Altra' };

// Colore (tra quelli del prodotto) e vista dal percorso del file.
// Prima il nome del file, poi le cartelle (dalla più vicina); vince la corrispondenza più lunga.
function imgGuess(path, colori) {
  const parts = path.replace(/\.[a-z0-9]{2,5}$/i, '').split('/').reverse().map(p => ` ${imgNorm(p)} `);
  const find = (test) => { for (const t of parts) { const r = test(t); if (r) return r; } return ''; };
  const colore = find(text => {
    let hit = '', best = 0;
    for (const c of colori) for (const name of imgColorNames(c)) {
      if (name.length > best && text.includes(` ${name} `)) { hit = c; best = name.length; }
    }
    return hit;
  });
  const vista = find(text => Object.keys(IMG_VIEWS).find(v => IMG_VIEWS[v].some(w => text.includes(` ${w} `))));
  return { colore, vista };
}

// ─────────────────────────────────────────────
// ELABORAZIONE AL CARICAMENTO
// Immagine intera (niente scontorno né ritaglio) adattata in 900×1200 px,
// 150 dpi, file di massimo 1 MB. Lo spazio attorno prende il colore del bordo della foto.
// ─────────────────────────────────────────────

const IMG_OUT = { w: 900, h: 1200, dpi: 150, maxBytes: 1 * 1024 * 1024 };

// Colore del bordo della foto: mediana dei pixel sul contorno
function imgBorderColor(data, w, h) {
  const rs = [], gs = [], bs = [];
  const take = (x, y) => { const i = (y * w + x) * 4; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]); };
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return [med(rs), med(gs), med(bs)];
}

// PNG: aggiunge il blocco pHYs con la risoluzione (dpi → pixel per metro), subito dopo IHDR
const _crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const _crc32 = (bytes) => { let c = 0xFFFFFFFF; for (const b of bytes) c = _crcTable[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
async function pngWithDpi(blob, dpi) {
  const src = new Uint8Array(await blob.arrayBuffer());
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);           // "pHYs"
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;   // unità: metro
  dv.setUint32(17, _crc32(chunk.subarray(4, 17)));
  const at = 8 + 25;                                 // firma + IHDR
  const out = new Uint8Array(src.length + 21);
  out.set(src.subarray(0, at)); out.set(chunk, at); out.set(src.subarray(at), at + 21);
  return new Blob([out], { type: 'image/png' });
}

async function processProductImage(file) {
  const bmp = await createImageBitmap(file);
  const probe = new OffscreenCanvas(bmp.width, bmp.height);
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(bmp, 0, 0);
  const data = pctx.getImageData(0, 0, bmp.width, bmp.height).data;
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4 * 97) if (data[i] < 250) { hasAlpha = true; break; }

  // Foto intera adattata dentro 900×1200 e centrata
  const out = new OffscreenCanvas(IMG_OUT.w, IMG_OUT.h);
  const ctx = out.getContext('2d');
  if (!hasAlpha) { const [r, g, b] = imgBorderColor(data, bmp.width, bmp.height); ctx.fillStyle = `rgb(${r},${g},${b})`; ctx.fillRect(0, 0, IMG_OUT.w, IMG_OUT.h); }
  const scale = Math.min(IMG_OUT.w / bmp.width, IMG_OUT.h / bmp.height);
  const dw = Math.round(bmp.width * scale), dh = Math.round(bmp.height * scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, Math.round((IMG_OUT.w - dw) / 2), Math.round((IMG_OUT.h - dh) / 2), dw, dh);

  // PNG a 150 dpi; se supera 1 MB si passa a WebP (mantiene la trasparenza) abbassando la qualità
  let blob = await pngWithDpi(await out.convertToBlob({ type: 'image/png' }), IMG_OUT.dpi);
  let ext = 'png';
  for (let q = 0.92; blob.size > IMG_OUT.maxBytes && q >= 0.3; q -= 0.1) {
    blob = await out.convertToBlob({ type: 'image/webp', quality: q });
    ext = 'webp';
  }
  const name = file.name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + ext;
  return new File([blob], name, { type: blob.type });
}

// ─────────────────────────────────────────────
// FINESTRA IMMAGINI
// ─────────────────────────────────────────────

const ImgState = { productId: null, images: [], urls: {}, busy: '' };
const IMG_MAX_MB = 40;   // file originale: viene comunque ridotto a 900×1200 e max 1 MB

// Sezione Immagini dentro la scheda del prodotto (#pf-images)
async function openProductImages(productId) {
  if (!TCFactory.getProduct(productId)) return;
  Object.assign(ImgState, { productId, images: [], urls: {}, busy: 'Caricamento immagini…' });
  renderProductImages();
  await reloadProductImages();
}

// Dall'elenco: apre la scheda del prodotto e porta alle immagini
function showProductImages(productId) {
  openProductForm(productId);
  setTimeout(() => document.getElementById('pf-images')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
}

async function reloadProductImages() {
  try {
    ImgState.images = await TCFactory.getProductImages(ImgState.productId);
    ImgState.urls = ImgState.images.length ? await TCFactory.productImageUrls(ImgState.images.map(i => i.path)) : {};
    ImgState.busy = '';
  } catch (e) {
    console.error('[immagini]', e);
    ImgState.busy = 'Impossibile caricare le immagini';
  }
  renderProductImages();
}

function renderProductImages() {
  const p = TCFactory.getProduct(ImgState.productId);
  const box = document.getElementById('pf-images');
  if (!p || !box || box.dataset.product !== p.id) return;   // scheda chiusa o di un altro prodotto
  const colori = modSplitList(p.colori);
  const known = new Set(colori.map(c => c.toLowerCase()));
  const groups = [...colori, ''].map(c => ({
    colore: c,
    imgs: ImgState.images.filter(i => c ? i.colore.toLowerCase() === c.toLowerCase() : !known.has(i.colore.toLowerCase())),
  })).filter(g => g.colore || g.imgs.length);
  const order = { fronte: 0, retro: 1, lato: 2, '': 3 };

  const thumb = (img) => `
    <figure class="pimg">
      <a href="${escapeHtml(ImgState.urls[img.path] || '#')}" target="_blank" rel="noopener" title="${escapeHtml(img.nome_file)}">
        <img src="${escapeHtml(ImgState.urls[img.path] || '')}" alt="${escapeHtml(`${img.colore || 'Senza colore'} · ${IMG_VIEW_LABEL[img.vista]}`)}" loading="lazy">
      </a>
      <figcaption>
        <select class="form-select" aria-label="Colore" onchange="setProductImage('${img.id}', { colore: this.value })">
          <option value="">— Da assegnare —</option>
          ${colori.map(c => `<option value="${escapeHtml(c)}" ${c.toLowerCase() === img.colore.toLowerCase() ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
        <div class="pimg-row">
          <select class="form-select" aria-label="Vista" onchange="setProductImage('${img.id}', { vista: this.value })">
            ${Object.entries(IMG_VIEW_LABEL).map(([v, l]) => `<option value="${v}" ${v === img.vista ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="removeProductImage('${img.id}')" aria-label="Elimina immagine" title="Elimina">${Icons.trash(14)}</button>
        </div>
      </figcaption>
    </figure>`;

  box.innerHTML = `
      <h3 class="pf-section-title">${Icons.image(15)} Immagini</h3>
        <div class="pimg-drop" role="button" tabindex="0" aria-label="Aggiungi immagini: clicca per sceglierle o trascinale qui"
          onclick="document.getElementById('pimg-files').click()"
          onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('pimg-files').click()}"
          ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')" ondrop="productImagesDrop(event)">
          <span class="pimg-drop-icon" aria-hidden="true">${Icons.image(26)}</span>
          <strong>Trascina qui immagini o cartelle, oppure clicca per sceglierle</strong>
          <small>Colore e vista (fronte, retro, lato) si riconoscono dal nome del file o della cartella, es. <em>REGENT_NERO_FRONTE.jpg</em> o <em>NERO/back.png</em></small>
          <button type="button" class="pimg-folder-link" onclick="event.stopPropagation();document.getElementById('pimg-folder').click()">oppure scegli una cartella intera</button>
        </div>
        <div class="settings-section-hint" style="margin:0;">Le immagini vengono adattate a ${IMG_OUT.w}×${IMG_OUT.h} px, ${IMG_OUT.dpi} dpi, massimo 1 MB.</div>
        <!-- Fuori dal riquadro: il clic simulato non deve risalire e riaprire la scelta -->
        <input type="file" id="pimg-files" accept="image/*" multiple hidden onchange="addProductImages([...this.files].map(f => ({ file: f, path: f.name })));this.value=''">
        <input type="file" id="pimg-folder" webkitdirectory directory multiple hidden onchange="addProductImages([...this.files].map(f => ({ file: f, path: f.webkitRelativePath || f.name })));this.value=''">
        ${ImgState.busy ? `<div class="settings-section-hint" style="margin:0;" role="status">${escapeHtml(ImgState.busy)}</div>` : ''}
        ${!colori.length ? `<div class="import-note">Questo prodotto non ha colori: le immagini restano "da assegnare". Aggiungi i colori qui sopra e salva per abbinarle.</div>` : ''}
        ${groups.map(g => `
          <section class="pimg-group">
            <h3>${g.colore ? escapeHtml(g.colore) : 'Da assegnare'} <small>${g.imgs.length || 'nessuna immagine'}</small></h3>
            ${g.imgs.length ? `<div class="pimg-grid">${[...g.imgs].sort((a, b) => order[a.vista] - order[b.vista]).map(thumb).join('')}</div>` : ''}
          </section>`).join('')}`;
}

async function productImagesDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('over');
  // Le voci vanno prese subito: dopo il primo await il trascinamento non è più leggibile
  const entries = [...(e.dataTransfer?.items || [])].map(i => i.kind === 'file' && i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return addProductImages([...(e.dataTransfer?.files || [])].map(f => ({ file: f, path: f.name })));
  const out = [];
  for (const en of entries) await dtfReadEntry(en, out);   // legge anche le sottocartelle
  addProductImages(out);
}

async function addProductImages(items) {
  const p = TCFactory.getProduct(ImgState.productId);
  if (!p || !items.length) return;
  const colori = modSplitList(p.colori);
  const imgs = items.filter(x => /^image\//.test(x.file.type) || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(x.file.name));
  const ignorati = items.length - imgs.length;
  const grandi = imgs.filter(x => x.file.size > IMG_MAX_MB * 1024 * 1024);
  const ok = imgs.filter(x => x.file.size <= IMG_MAX_MB * 1024 * 1024);
  if (!ok.length) { showToast(grandi.length ? `Immagini troppo grandi (max ${IMG_MAX_MB} MB)` : 'Nessuna immagine trovata', 'error'); return; }

  let caricate = 0, abbinate = 0, errori = 0;
  for (const [n, x] of ok.entries()) {
    const g = imgGuess(x.path, colori);
    ImgState.busy = `Caricamento immagine ${n + 1} di ${ok.length}…`;
    renderProductImages();
    try {
      await TCFactory.uploadProductImage(p.id, await processProductImage(x.file), g.colore, g.vista);
      caricate++;
      if (g.colore) abbinate++;
    } catch (e) { console.error('[immagini]', x.path, e); errori++; }
  }
  await reloadProductImages();
  const extra = [
    caricate - abbinate ? `${caricate - abbinate} da assegnare` : '',
    errori ? `${errori} non caricate` : '',
    grandi.length ? `${grandi.length} troppo grandi` : '',
    ignorati ? `${ignorati} non immagini ignorate` : '',
  ].filter(Boolean).join(', ');
  showToast(`${caricate} ${caricate === 1 ? 'immagine caricata' : 'immagini caricate'}, ${abbinate} abbinate a un colore${extra ? ` · ${extra}` : ''}`, errori ? 'error' : 'success');
}

async function setProductImage(id, fields) {
  try {
    await TCFactory.updateProductImage(id, fields);
    const img = ImgState.images.find(i => i.id === id);
    if (img) Object.assign(img, fields);
    renderProductImages();
  } catch (e) { showToast('Errore — riprova', 'error'); }
}

async function removeProductImage(id) {
  const img = ImgState.images.find(i => i.id === id);
  if (!img || !confirm('Eliminare questa immagine?')) return;
  try {
    await TCFactory.deleteProductImage(img);
    ImgState.images = ImgState.images.filter(i => i.id !== id);
    renderProductImages();
  } catch (e) { showToast('Errore eliminazione immagine', 'error'); }
}
