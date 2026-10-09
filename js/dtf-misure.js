/**
 * T&C Factory — DTF: misure dei file e metri sul rotolo
 * Tutto avviene nel browser: il file viene letto sul computer di chi lo trascina,
 * non viene caricato da nessuna parte.
 *
 * • Pezzi: dal nome del file, "10pz", "10 pz" o "pz10" (se manca: 1).
 * • Misura di stampa in cm: PDF dalla pagina (punti tipografici), TIFF, PNG e JPG
 *   da pixel e DPI scritti nel file. Se il DPI manca si usa 300 e lo si segnala.
 * • Metri: pezzi affiancati sulla larghezza del rotolo, provando anche il file
 *   ruotato di 90°, con un margine tra i pezzi; vince il verso che consuma meno.
 */

const DTF_DEFAULT_DPI = 300;
const CM_PER_INCH = 2.54;
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const DtfMisure = {
  rollCm()   { const v = parseFloat(TCFactory._settings.dtf_roll_cm);   return v > 0 ? v : 57; },
  marginCm() { const v = parseFloat(TCFactory._settings.dtf_margin_cm); return v >= 0 ? v : 0.5; },
  // Interno: velocità della stampante (m/ora) e costo al metro (0 = non impostato)
  speedMh()     { const v = parseFloat(TCFactory._settings.dtf_speed_mh); return v > 0 ? v : 8; },
  costInterno() { const v = parseFloat(TCFactory._settings.dtf_cost_m);   return v > 0 ? v : 0; },

  // "logo_10pz.png", "logo 10 pz.pdf", "pz10_logo.png" → 10
  parsePz(name) {
    const base = String(name).replace(/\.[a-z0-9]{2,5}$/i, '');
    const m = base.match(/(\d+)\s*pz\b/i) || base.match(/\bpz\s*(\d+)/i) || base.match(/(\d+)\s*pz/i);
    const n = m ? parseInt(m[1], 10) : NaN;
    return n > 0 ? { pz: n, trovati: true } : { pz: 1, trovati: false };
  },

  // Metri di rotolo per `pz` pezzi da w×h cm
  layout(w, h, pz) {
    const roll = this.rollCm(), gap = this.marginCm();
    w = Number(w); h = Number(h); pz = Math.max(1, parseInt(pz, 10) || 1);
    if (!(w > 0) || !(h > 0)) return { error: 'misura mancante' };

    const tryOrientation = (across, along, rotated) => {
      const perRow = Math.floor((roll + gap) / (across + gap));
      if (perRow < 1) return null;
      const rows = Math.ceil(pz / perRow);
      return { cm: rows * along + (rows - 1) * gap, perRow, rows, rotated };
    };
    const options = [tryOrientation(w, h, false), tryOrientation(h, w, true)].filter(Boolean);
    if (!options.length) return { error: `più largo del rotolo (${roll} cm)` };
    const best = options.reduce((a, b) => (b.cm < a.cm ? b : a));
    return { metri: Math.round(best.cm) / 100, perRow: best.perRow, rows: best.rows, rotated: best.rotated };
  },

  // ── Lettura della misura di stampa ──

  async readSize(file) {
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith('.pdf') || file.type === 'application/pdf') return await this._pdf(file);
      if (/\.tiff?$/.test(name) || file.type === 'image/tiff') return await this._tif(file);
      if (name.endsWith('.png') || file.type === 'image/png') return await this._png(file);
      if (/\.(jpe?g)$/.test(name) || file.type === 'image/jpeg') return await this._jpg(file);
    } catch (e) {
      console.warn('[dtf misure]', file.name, e);
      return { fonte: 'illeggibile' };
    }
    return { fonte: 'formato' };   // formato non leggibile: misura da inserire a mano
  },

  _fromPixels(wPx, hPx, dpi, fonte) {
    const ipotizzato = !(dpi > 0);
    const d = ipotizzato ? DTF_DEFAULT_DPI : dpi;
    const cm = (px) => Math.round(px / d * CM_PER_INCH * 10) / 10;
    return { w_cm: cm(wPx), h_cm: cm(hPx), fonte, dpi: Math.round(d), dpi_ipotizzato: ipotizzato };
  },

  // TIFF: legge solo intestazione e directory (anche se il file è molto grande)
  async _tif(file) {
    const read = async (from, len) => new DataView(await file.slice(from, from + len).arrayBuffer());
    const head = await read(0, 16);
    const le = head.getUint16(0) === 0x4949;                       // "II" little endian, "MM" big endian
    if (!le && head.getUint16(0) !== 0x4d4d) throw new Error('TIFF non valido');
    const u16 = (dv, o) => dv.getUint16(o, le), u32 = (dv, o) => dv.getUint32(o, le);
    const u64 = (dv, o) => Number(dv.getBigUint64(o, le));
    const big = u16(head, 2) === 43;                               // BigTIFF (file oltre 4 GB)
    if (!big && u16(head, 2) !== 42) throw new Error('TIFF non valido');

    const ifd = big ? u64(head, 8) : u32(head, 4);
    const countDv = await read(ifd, big ? 8 : 2);
    const n = big ? u64(countDv, 0) : u16(countDv, 0);
    const size = big ? 20 : 12;
    const dir = await read(ifd + (big ? 8 : 2), n * size);

    const tags = {};
    for (let i = 0; i < n; i++) {
      const o = i * size, tag = u16(dir, o), type = u16(dir, o + 2), val = o + (big ? 12 : 8);
      if (![256, 257, 282, 283, 296].includes(tag)) continue;
      if (type === 3) tags[tag] = u16(dir, val);                                   // SHORT
      else if (type === 4) tags[tag] = u32(dir, val);                              // LONG
      else if (type === 16) tags[tag] = u64(dir, val);                             // LONG8
      else if (type === 5) {                                                       // RATIONAL (fuori riga)
        const r = await read(big ? u64(dir, val) : u32(dir, val), 8);
        tags[tag] = u32(r, 4) ? u32(r, 0) / u32(r, 4) : 0;
      }
    }
    const w = tags[256], h = tags[257];
    if (!w || !h) throw new Error('dimensioni TIFF non trovate');
    const unit = tags[296] ?? 2;                                   // 2 = pollici, 3 = centimetri, 1 = nessuna
    let dpi = tags[282] || 0;
    if (unit === 3) dpi *= CM_PER_INCH; else if (unit === 1) dpi = 0;
    return this._fromPixels(w, h, dpi, 'tif');
  },

  async _png(file) {
    const buf = new DataView(await file.slice(0, 4 * 1024 * 1024).arrayBuffer());
    if (buf.getUint32(0) !== 0x89504e47) throw new Error('PNG non valido');
    let off = 8, w = 0, h = 0, dpi = 0;
    while (off + 8 <= buf.byteLength) {
      const len = buf.getUint32(off);
      const type = String.fromCharCode(buf.getUint8(off + 4), buf.getUint8(off + 5), buf.getUint8(off + 6), buf.getUint8(off + 7));
      if (type === 'IHDR') { w = buf.getUint32(off + 8); h = buf.getUint32(off + 12); }
      if (type === 'pHYs' && buf.getUint8(off + 16) === 1) dpi = buf.getUint32(off + 8) * 0.0254;   // pixel per metro → DPI
      if (type === 'IDAT' || type === 'IEND') break;
      off += 12 + len;
    }
    if (!w || !h) throw new Error('dimensioni PNG non trovate');
    return this._fromPixels(w, h, dpi, 'png');
  },

  async _jpg(file) {
    const buf = new DataView(await file.slice(0, 1024 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) throw new Error('JPG non valido');
    let off = 2, w = 0, h = 0, dpi = 0;
    while (off + 4 <= buf.byteLength) {
      if (buf.getUint8(off) !== 0xff) { off++; continue; }
      const marker = buf.getUint8(off + 1);
      const len = buf.getUint16(off + 2);
      if (marker === 0xe0 && buf.getUint32(off + 4) === 0x4a464946) {          // APP0 "JFIF"
        const unit = buf.getUint8(off + 11), dens = buf.getUint16(off + 12);
        if (unit === 1) dpi = dens; else if (unit === 2) dpi = dens * CM_PER_INCH;
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {   // SOFn
        h = buf.getUint16(off + 5); w = buf.getUint16(off + 7);
        break;
      }
      off += 2 + len;
    }
    if (!w || !h) throw new Error('dimensioni JPG non trovate');
    return this._fromPixels(w, h, dpi, 'jpg');
  },

  _pdfjs: null,
  async _loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    this._pdfjs = this._pdfjs || new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); };
      s.onerror = () => reject(new Error('lettore PDF non disponibile'));
      document.head.appendChild(s);
    });
    return this._pdfjs;
  },

  async _pdf(file) {
    const lib = await this._loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });                          // punti tipografici (1/72")
    const cm = (pt) => Math.round(pt / 72 * CM_PER_INCH * 10) / 10;
    const res = { w_cm: cm(vp.width), h_cm: cm(vp.height), fonte: 'pdf', pagine: doc.numPages };
    doc.destroy();
    return res;
  },

  // File completo pronto da salvare
  async describe(file) {
    const { pz, trovati } = this.parsePz(file.name);
    const size = await this.readSize(file);
    return this.recompute({ name: file.name, pz, pz_trovati: trovati, ...size });
  },

  fromName(name) {
    const { pz, trovati } = this.parsePz(name);
    return this.recompute({ name, pz, pz_trovati: trovati, fonte: 'manuale' });
  },

  recompute(f) {
    const r = this.layout(f.w_cm, f.h_cm, f.pz);
    return { ...f, metri: r.error ? null : r.metri, errore: r.error || null, per_riga: r.perRow || null, ruotato: !!r.rotated };
  },
};

window.DtfMisure = DtfMisure;
