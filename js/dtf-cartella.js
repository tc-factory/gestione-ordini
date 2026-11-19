/**
 * T&C Factory — DTF interno: cartella dei file da stampare sul NAS
 * (DATI/DTF/1. Stampa/1. Stampare).
 * Si collega una volta da Chrome: il browser ricorda la cartella e la rilegge
 * aprendo DTF interno e ogni 2 minuti mentre la scheda è aperta.
 * Ogni sottocartella viene abbinata a un ordine da stampare per nome
 * ("cf pavia" → CROSSFIT PAVIA); i file nuovi entrano nei file DTF dell'ordine
 * con misure e metri (DtfMisure). Le cartelle "Stampato" sono escluse.
 * I file restano sul NAS: si leggono solo le intestazioni, niente viene caricato.
 * "Numera le cartelle" mette davanti alle cartelle il numero dell'ordine nella lista
 * Da stampare ("01 - cf pavia"); il numero non conta per l'abbinamento.
 */

const DTF_CARTELLA_IDB = 'tcf-dtf';
const DTF_CARTELLA_EVERY = 2 * 60 * 1000;
const DTF_CARTELLA_EXT = /\.(tiff?|pdf|png|jpe?g)$/i;
const DTF_CARTELLA_SKIP = /stampato/i;          // cartelle già stampate, a qualsiasi livello
const DTF_CARTELLA_NUM = /^\d{1,3}\s*-\s*/;      // numero davanti messo da "Numera le cartelle"

const DtfCartella = {
  handle: null,
  stato: 'init',          // init | unsupported | none | prompt | ok | scanning | error
  errore: '',
  esito: null,            // { at, abbinate, aggiunti, senzaOrdine: [nomi], ambigue: [nomi] }
  timer: null,
  _avviata: false,
  numerando: false,

  supported: () => typeof window.showDirectoryPicker === 'function',

  // ── Cartella ricordata dal browser (IndexedDB: un handle non si può mettere in localStorage) ──
  _db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DTF_CARTELLA_IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  },
  async _get() {
    try {
      const db = await this._db();
      return await new Promise((res) => { const q = db.transaction('handles').objectStore('handles').get('stampare'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
    } catch { return null; }
  },
  async _put(h) {
    try {
      const db = await this._db();
      await new Promise((res) => { const t = db.transaction('handles', 'readwrite'); t.objectStore('handles').put(h, 'stampare'); t.oncomplete = res; t.onerror = res; });
    } catch {}
  },

  // Aprendo DTF interno: riprende la cartella e la rilegge
  async avvia() {
    if (!this.supported()) { this.stato = 'unsupported'; return; }
    if (!this._avviata) {
      this._avviata = true;
      this.handle = await this._get();
      this.stato = this.handle ? 'prompt' : 'none';
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (this._visibile()) this.leggi(); }, DTF_CARTELLA_EVERY);
    }
    if (this.handle && await this._permesso(false)) this.leggi();
    else this._ridisegna();
  },

  _visibile() {
    return document.visibilityState === 'visible' && typeof Nav !== 'undefined' && Nav.current === 'dtf' &&
      !document.getElementById('dtf-interno-root')?.hidden;
  },

  async _permesso(chiedi) {
    try {
      let p = await this.handle.queryPermission({ mode: 'read' });
      if (p !== 'granted' && chiedi) p = await this.handle.requestPermission({ mode: 'read' });
      if (p !== 'granted') { this.stato = 'prompt'; return false; }
      return true;
    } catch { this.stato = 'prompt'; return false; }
  },

  async collega() {
    try {
      this.handle = await window.showDirectoryPicker({ id: 'dtf-stampare', mode: 'read' });
    } catch (e) { if (e?.name !== 'AbortError') showToast('Cartella non collegata: riprova', 'error'); return; }
    await this._put(this.handle);
    this.esito = null;
    this.leggi();
  },

  async riattiva() {
    if (this.handle && await this._permesso(true)) this.leggi();
    else this._ridisegna();
  },

  _ridisegna() { if (typeof renderDtfInterno === 'function') renderDtfInterno(); },

  // ── Lettura ──

  _salta: (name) => name.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(name),

  // File da stampare di una cartella (anche nelle sottocartelle, escluse le "Stampato")
  async _files(dir, path) {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (this._salta(name)) continue;
      if (h.kind === 'directory') { if (!DTF_CARTELLA_SKIP.test(name)) out.push(...await this._files(h, `${path}/${name}`)); }
      else if (DTF_CARTELLA_EXT.test(name)) out.push({ h, path: `${path}/${name}` });
    }
    return out;
  },

  // Senza il numero davanti: "03 - cf pavia" → "cf pavia"
  _base: (name) => String(name).replace(DTF_CARTELLA_NUM, ''),
  // Percorso di un file senza il numero della cartella (resta uguale dopo la numerazione)
  _chiave(path) { const [a, ...r] = String(path || '').split('/'); return [this._base(a), ...r].join('/'); },

  // Gruppi: una sottocartella = un ordine; i file sciolti si abbinano col loro nome
  async _gruppi(conFile = true) {
    const gruppi = [];
    for await (const [name, h] of this.handle.entries()) {
      if (this._salta(name)) continue;
      if (h.kind === 'directory') {
        if (!DTF_CARTELLA_SKIP.test(name)) gruppi.push({ nome: this._base(name), dir: name, h, files: conFile ? await this._files(h, name) : null });
      } else if (DTF_CARTELLA_EXT.test(name)) {
        gruppi.push({ nome: name.replace(/\.[a-z0-9]{2,5}$/i, ''), files: [{ h, path: name }], sciolto: true });
      }
    }
    return gruppi;
  },

  async leggi() {
    if (!this.handle || this.stato === 'scanning') return;
    if (!await this._permesso(false)) { this._ridisegna(); return; }
    this.stato = 'scanning';
    this._ridisegna();
    try {
      const gruppi = await this._gruppi();
      const { todo } = dtfLists();
      const perOrdine = new Map();   // id ordine → [file…]
      const senzaOrdine = [], ambigue = [];
      for (const g of gruppi) {
        if (!g.files.length) continue;
        const o = this.abbina(g.nome, todo);
        if (o === 'ambiguo') { ambigue.push(g.nome); continue; }
        if (!o) { senzaOrdine.push(g.nome); continue; }
        perOrdine.set(o.id, [...(perOrdine.get(o.id) || []), ...g.files]);
      }

      let aggiunti = 0;
      for (const [id, files] of perOrdine) aggiunti += await this._aggiorna(id, files);
      this.esito = { at: new Date(), abbinate: perOrdine.size, aggiunti, senzaOrdine, ambigue };
      this.stato = 'ok';
      this.errore = '';
    } catch (e) {
      console.error('[dtf cartella]', e);
      this.stato = e?.name === 'NotAllowedError' ? 'prompt' : 'error';
      this.errore = e?.name === 'NotFoundError' ? 'cartella non trovata: il NAS è collegato?' : (e?.message || 'errore');
    }
    this._ridisegna();
  },

  // Aggiunge all'ordine i file nuovi della cartella e rilegge quelli cambiati.
  // Non toglie nulla: i file spostati in "Stampato" restano nei metri dell'ordine.
  async _aggiorna(orderId, entries) {
    const o = TCFactory.getOrderById(orderId);
    if (!o || (DtfState.detail?.kind === 'order' && DtfState.detail.key === orderId)) return 0;   // finestra aperta: dopo
    const items = (Array.isArray(o.dtfItems) ? o.dtfItems : []).filter(f => f && f.name).map(f => ({ ...f }));
    let aggiunti = 0, cambiati = false;
    for (const { h, path } of entries) {
      const file = await h.getFile();
      const key = this._chiave(path);
      let i = items.findIndex(f => f.cartella && this._chiave(f.cartella) === key);
      if (i < 0) i = items.findIndex(f => !f.cartella && f.name === file.name);
      const it = items[i];
      if (it && (!it.cartella || (it.size === file.size && it.mtime === file.lastModified))) {
        if (it.cartella !== path) { Object.assign(it, { cartella: path, size: file.size, mtime: file.lastModified }); cambiati = true; }
        continue;   // già presente (anche se inserito a mano: le misure scritte restano)
      }
      const desc = { ...await DtfMisure.describe(file), cartella: path, size: file.size, mtime: file.lastModified };
      if (it) items[i] = desc; else { items.push(desc); aggiunti++; }
      cambiati = true;
    }
    if (!cambiati) return 0;
    const fresh = TCFactory.getOrderById(orderId);
    if (!fresh) return 0;
    fresh.dtfItems = items;
    try { await TCFactory.updateOrder(orderId, { dtfItems: items }); }
    catch (e) { console.error('[dtf cartella]', e); showToast(`File di "${fresh.nome}" non salvati: riprova`, 'error'); }
    return aggiunti;
  },

  // ── Numerazione: cartelle nell'ordine della lista Da stampare ──
  // Le cartelle senza ordine perdono il numero e finiscono in fondo nel Finder.
  async numera() {
    if (!this.handle || this.numerando) return;
    try {
      if (await this.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        showToast('Serve il permesso di modifica sulla cartella', 'error'); return;
      }
    } catch { showToast('Permesso non concesso', 'error'); return; }
    this.numerando = true;
    this._ridisegna();
    let fatte = 0, errori = 0;
    try {
      const { todo } = dtfLists();
      const pos = new Map(todo.map((o, i) => [o.id, i]));
      const dirs = (await this._gruppi(false)).filter(g => !g.sciolto).map(g => {
        const o = this.abbina(g.nome, todo);
        return { ...g, p: o && o !== 'ambiguo' ? pos.get(o.id) : null };
      });
      const numerate = dirs.filter(d => d.p != null)
        .sort((a, b) => a.p - b.p || a.nome.localeCompare(b.nome, 'it'));
      const cifre = Math.max(2, String(numerate.length).length);
      const nuovi = new Map([
        ...numerate.map((d, i) => [d, `${String(i + 1).padStart(cifre, '0')} - ${d.nome}`]),
        ...dirs.filter(d => d.p == null).map(d => [d, d.nome]),
      ]);
      for (const [d, nome] of nuovi) {
        if (d.dir === nome) continue;
        try { await d.h.move(nome); fatte++; }
        catch (e) { console.error('[dtf numera]', d.dir, '→', nome, e); errori++; }
      }
    } catch (e) { console.error('[dtf numera]', e); errori++; }
    this.numerando = false;
    if (errori) showToast(`${errori} ${errori === 1 ? 'cartella non rinominata' : 'cartelle non rinominate'}: un file potrebbe essere aperto`, 'error');
    else showToast(fatte ? `Cartelle numerate: ${fatte} rinominate` : 'Le cartelle erano già in ordine', 'success');
    await this.leggi();
  },

  // ── Abbinamento cartella → ordine ──

  _tokens(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
      .map(t => (t === 'cf' ? 'crossfit' : t));
  },
  _core(s) { return this._tokens(s).filter(t => t !== 'crossfit').join(''); },

  // L'ordine da stampare che corrisponde al nome; 'ambiguo' se più ordini valgono uguale
  abbina(nome, ordini) {
    const fc = this._core(nome), ft = new Set(this._tokens(nome));
    if (fc.length < 4) return null;
    let best = null, bestScore = 0, pari = false;
    for (const o of ordini) {
      const n = this._core(o.nome);
      if (n.length < 4 || !(fc.includes(n) || n.includes(fc))) continue;
      const bonus = this._tokens(orderDesc(o)).filter(t => t.length >= 4 && ft.has(t)).length;
      const score = (fc === n ? 20 : 10) + bonus;
      if (score > bestScore) { best = o; bestScore = score; pari = false; }
      else if (score === bestScore) pari = true;
    }
    return pari ? 'ambiguo' : best;
  },

  // ── Riga di stato in DTF interno ──
  html() {
    const nome = escapeHtml(this.handle?.name || '');
    const elenco = (arr) => arr.map(escapeHtml).join(', ');
    switch (this.stato) {
      case 'unsupported': return '<p class="dtf-note">Per leggere da solo la cartella dei file da stampare serve Chrome.</p>';
      case 'none': return `<p class="dtf-note dtf-cartella">${Icons.paperclip(13)} <button type="button" class="link-btn" onclick="DtfCartella.collega()">Collega la cartella «1. Stampare»</button> per segnare da soli file e metri degli ordini.</p>`;
      case 'prompt': return `<p class="dtf-note dtf-cartella">${Icons.paperclip(13)} <button type="button" class="link-btn" onclick="DtfCartella.riattiva()">Riattiva la cartella «${nome}»</button> per aggiornare file e metri. In Chrome scegli «Consenti a ogni visita» per non doverlo rifare.</p>`;
      case 'scanning': return `<p class="dtf-note dtf-cartella">${Icons.paperclip(13)} Leggo la cartella «${nome}»…</p>`;
      case 'error': return `<p class="dtf-note dtf-cartella dtf-cartella-err">Cartella «${nome}» non letta: ${escapeHtml(this.errore)} · <button type="button" class="link-btn" onclick="DtfCartella.riattiva()">Riprova</button> · <button type="button" class="link-btn" onclick="DtfCartella.collega()">Cambia cartella</button></p>`;
      case 'ok': {
        const e = this.esito || {};
        const ora = e.at ? e.at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
        return `<p class="dtf-note dtf-cartella">${Icons.paperclip(13)} Cartella «${nome}» letta alle ${ora} · ${e.abbinate || 0} ${e.abbinate === 1 ? 'ordine abbinato' : 'ordini abbinati'}${e.aggiunti ? ` · ${e.aggiunti} file nuovi` : ''} · <button type="button" class="link-btn" onclick="DtfCartella.leggi()">Aggiorna</button> · ${this.numerando ? 'Numero le cartelle…' : '<button type="button" class="link-btn" onclick="DtfCartella.numera()" title="Mette davanti a ogni cartella il numero dell\'ordine nella lista qui sotto">Numera le cartelle</button>'}</p>
          ${e.senzaOrdine?.length ? `<p class="dtf-note">Senza ordine da stampare: ${elenco(e.senzaOrdine)}</p>` : ''}
          ${e.ambigue?.length ? `<p class="dtf-note">Più ordini con lo stesso nome, file da aggiungere a mano: ${elenco(e.ambigue)}</p>` : ''}`;
      }
      default: return '';
    }
  },
};

window.DtfCartella = DtfCartella;
