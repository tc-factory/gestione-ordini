/**
 * T&C Factory — "Compila da file" nel form ordine (funzione order-from-photo su Supabase)
 *
 * Il file dell'ordine va a Claude, che restituisce i campi del form e le righe del modulo;
 * i prodotti riconosciuti si completano dall'anagrafica. I file restano negli allegati.
 *
 * Immagini e PDF arrivano a Claude così come sono (i PDF anche se scansionati o scritti a mano).
 * Excel, Word, PowerPoint, OpenDocument, mail e testi diventano testo qui nel browser.
 */

const OF_FILE_MAX = 6;
const OF_PDF_MAX_BYTES = 15 * 1024 * 1024;   // per PDF
const OF_PDF_TOTAL_BYTES = 20 * 1024 * 1024; // la richiesta a Claude ha un limite di 32 MB in base64
const OF_TEXT_MAX = 400000;                  // caratteri per file

const OF_LIB_URLS = {
  JSZip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  heic2any: 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js',
};

const OF_FORMATS = {
  immagine: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'heic', 'heif'],
  pdf:      ['pdf'],
  foglio:   ['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'numbers'],
  office:   ['docx', 'docm', 'odt', 'pptx', 'odp'],
  testo:    ['txt', 'md', 'csv', 'tsv', 'rtf', 'eml', 'html', 'htm', 'xml', 'json'],
};
const OF_FILE_ACCEPT = ['image/*', ...Object.values(OF_FORMATS).flat().map(e => '.' + e)].join(',');

const ofFileExt = (file) => (file.name.split('.').pop() || '').toLowerCase();

function ofFileKind(file) {
  const ext = ofFileExt(file);
  const kind = Object.keys(OF_FORMATS).find(k => OF_FORMATS[k].includes(ext));
  if (kind) return kind;
  if (file.type.startsWith('image/')) return 'immagine';
  if (file.type.startsWith('text/')) return 'testo';
  return null;
}

const _ofLibs = {};
function ofLoadLib(name) {
  if (window[name]) return Promise.resolve(window[name]);
  _ofLibs[name] = _ofLibs[name] || new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = OF_LIB_URLS[name];
    sc.onload = () => resolve(window[name]);
    sc.onerror = () => { delete _ofLibs[name]; reject(new Error('Lettore del file non disponibile: controlla la connessione')); };
    document.head.appendChild(sc);
  });
  return _ofLibs[name];
}

// ── Immagini ──

// Foto ridotta a 1600px in JPEG: basta per leggere la scrittura e resta leggera
function ofImageBase64(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * s);
      canvas.height = Math.round(img.naturalHeight * s);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';   // i PNG trasparenti in JPEG diventerebbero neri
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`${file.name}: questo browser non apre l'immagine, salvala come JPG o PDF`));
    };
    img.src = url;
  });
}

// Le foto iPhone (HEIC) si aprono solo in Safari: negli altri browser diventano JPEG
async function ofHeicToJpeg(file) {
  const heic2any = await ofLoadLib('heic2any');
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
  return new File([Array.isArray(blob) ? blob[0] : blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
}

// ── PDF ──

function ofFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error(`${file.name}: file non leggibile`));
    reader.readAsDataURL(file);
  });
}

// ── Testi ──

// UTF-8 se valido, altrimenti la codifica dei file salvati da Excel e Blocco note su Windows
function ofDecodeText(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}

// Nelle mail i blocchi base64 sono il testo (si decodifica) o gli allegati (si tolgono)
function ofMailText(raw) {
  return raw.replace(/^(?:[A-Za-z0-9+/=]{40,}\r?\n){2,}[A-Za-z0-9+/=]*\r?\n?/gm, (block) => {
    try {
      const bytes = Uint8Array.from(atob(block.replace(/\s/g, '')), c => c.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes) + '\n';
    } catch { return '[allegato non incluso]\n'; }
  });
}

// ── Excel e fogli di calcolo ──

async function ofSheetText(file) {
  const X = await loadXlsx();
  const wb = X.read(await file.arrayBuffer(), { type: 'array' });
  return wb.SheetNames.map(name => {
    const csv = X.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false }).trim();
    return csv && `Foglio "${name}":\n${csv}`;
  }).filter(Boolean).join('\n\n');
}

// ── Word, PowerPoint e OpenDocument: sono archivi zip di XML ──

const OF_XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function ofXmlText(xml) {
  return xml
    .replace(/<w:instrText[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<\/(?:w:p|text:p|a:p)>\s*<\/(?:w:tc|table:table-cell|a:tc)>/g, '\t')
    .replace(/<\/(?:w:tc|table:table-cell|a:tc)>/g, '\t')
    .replace(/<\/(?:w:p|text:p|text:h|a:p|w:tr|table:table-row|a:tr)>/g, '\n')
    .replace(/<(?:w:tab|text:tab|w:br|text:line-break|a:br)\b[^>]*\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
      dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : OF_XML_ENTITIES[name] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function ofOfficeText(file) {
  const JSZip = await ofLoadLib('JSZip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const parts = zip.file(/^(word\/(document|header\d*|footer\d*)\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const texts = await Promise.all(parts.map(async p => ofXmlText(await p.async('string'))));
  return texts.filter(Boolean).join('\n\n');
}

// ── Da file a ciò che riceve la funzione ──

async function ofTextPart(file, kind) {
  let testo;
  try {
    if (kind === 'foglio') testo = await ofSheetText(file);
    else if (kind === 'office') testo = await ofOfficeText(file);
    else testo = ofDecodeText(await file.arrayBuffer());
  } catch (e) {
    if (/connessione/.test(e.message || '')) throw e;
    throw new Error(`${file.name}: file danneggiato o protetto da password`);
  }
  if (ofFileExt(file) === 'eml') testo = ofMailText(testo);
  if (!testo.trim()) throw new Error(`${file.name}: non contiene testo, salvalo come PDF`);
  if (testo.length > OF_TEXT_MAX) throw new Error(`${file.name}: troppo lungo, tieni solo la parte dell'ordine`);
  return { nome: file.name, testo };
}

async function ofPrepareFile(file) {
  const kind = ofFileKind(file);
  if (!kind) throw new Error(`${file.name}: formato non supportato, salvalo come PDF`);
  if (kind === 'pdf') {
    if (file.size > OF_PDF_MAX_BYTES) throw new Error(`${file.name}: supera 15 MB`);
    return { documento: { nome: file.name, data: await ofFileBase64(file) }, allegato: file };
  }
  if (kind === 'immagine') {
    try {
      return { immagine: { media_type: 'image/jpeg', data: await ofImageBase64(file) }, allegato: file };
    } catch (e) {
      if (!['heic', 'heif'].includes(ofFileExt(file))) throw e;
      const jpg = await ofHeicToJpeg(file);
      return { immagine: { media_type: 'image/jpeg', data: await ofImageBase64(jpg) }, allegato: jpg };
    }
  }
  return { testo: await ofTextPart(file, kind), allegato: file };
}

async function ofReadFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;
  if (files.length > OF_FILE_MAX) { showToast(`Al massimo ${OF_FILE_MAX} file per volta`, 'error'); return; }
  const btn = document.getElementById('of-photo-btn');
  const msg = document.getElementById('of-photo-msg');
  const box = document.getElementById('of-photo');
  if (btn) { btn.disabled = true; btn.textContent = 'Lettura in corso…'; }
  if (msg) msg.textContent = `Leggo ${files.length === 1 ? 'il file' : `${files.length} file`}: ci vuole qualche secondo…`;
  box?.classList.remove('done', 'warn');
  try {
    if (files.filter(f => ofFileKind(f) === 'pdf').reduce((s, f) => s + f.size, 0) > OF_PDF_TOTAL_BYTES) {
      throw new Error('I PDF insieme superano 20 MB: caricane meno per volta');
    }
    const parti = await Promise.all(files.map(ofPrepareFile));
    const clienti = TCFactory.getClients().map(c => TCFactory.clientName(c)).filter(Boolean);
    const prodotti = TCFactory.getProducts().filter(p => p.attivo && p.codice)
      .map(p => [p.codice, p.descrizione, TCFactory.supplierName(p.fornitore_id)].filter(Boolean).join(' · '));
    const { data, error } = await supabaseClient.functions.invoke('order-from-photo', {
      body: {
        immagini: parti.flatMap(p => p.immagine || []),
        documenti: parti.flatMap(p => p.documento || []),
        testi: parti.flatMap(p => p.testo || []),
        clienti, prodotti, oggi: TCFactory.getDefaultDate(),
      },
    });
    if (error || !data?.success) {
      let m = data?.error;
      if (!m && error?.context?.json) { try { m = (await error.context.json()).error; } catch {} }
      throw new Error(m || 'Lettura non riuscita');
    }
    const n = ofApplyFileOrder(data.ordine || {});
    const dubbi = String(data.ordine?.dubbi || '').trim();
    if (msg) msg.textContent = `Compilato dal file: ${n} ${n === 1 ? 'riga' : 'righe'} nel modulo. Controlla prima di salvare.` + (dubbi ? ` Da verificare: ${dubbi}` : '');
    box?.classList.add(dubbi ? 'warn' : 'done');
    ofAttachFiles(parti.map(p => p.allegato));
  } catch (e) {
    if (msg) msg.textContent = e.message || 'Lettura non riuscita';
    box?.classList.add('warn');
    showToast(e.message || 'Lettura non riuscita', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Compila da file'; }
  }
}

// I file dell'ordine restano tra gli allegati
async function ofAttachFiles(files) {
  for (const f of files) {
    try {
      const file = await compressImageIfNeeded(f);
      if (file.size > TCFactory.MAX_FILE_BYTES) { showToast(`${f.name} letto, ma non allegato: supera 2MB`, 'error'); continue; }
      const uploaded = await TCFactory.uploadFile(file);
      AppState.formFiles.push({ ...uploaded, name: f.name });
    } catch { showToast(`Non sono riuscito ad allegare ${f.name}`, 'error'); }
  }
  renderFormFilesList();
}
