/**
 * T&C Factory — DTF interno: cartella dei file da stampare sul NAS
 * (DATI/DTF/1. Stampa/1. Stampare).
 * Si collega una volta da Chrome: il browser ricorda la cartella e la rilegge
 * all'avvio del gestionale e ogni 5 minuti, su qualsiasi pagina.
 * Ogni sottocartella viene abbinata a un ordine da stampare per nome
 * ("cf pavia" → CROSSFIT PAVIA); i file nuovi entrano nei file DTF dell'ordine
 * con misure e metri (DtfMisure). Le cartelle "Stampato" sono escluse.
 * I file restano sul NAS: si leggono solo le intestazioni, niente viene caricato.
 * Numerazione: davanti alle cartelle il numero dell'ordine nella lista Da stampare
 * ("01 - cf pavia"), da sola quando arriva un DTF nuovo (serve il permesso di modifica)
 * o col bottone "Numera ora"; il numero non conta per l'abbinamento.
 */

const DTF_CARTELLA_IDB = 'tcf-dtf';
const DTF_CARTELLA_EVERY = 5 * 60 * 1000;
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
  scrivibile: false,      // permesso di rinominare le cartelle
  _visti: null,           // percorsi dei file all'ultima lettura (per riconoscere i DTF nuovi)
  numerate: null,         // { at, fatte, errori } ultima numerazione

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

  // All'avvio del gestionale: riprende la cartella e la controlla ogni 5 minuti, su qualsiasi pagina
  async avvia() {
    if (!this.supported()) { this.stato = 'unsupported'; return; }
    if (!this._avviata) {
      this._avviata = true;
      this.handle = await this._get();
      this.stato = this.handle ? 'prompt' : 'none';
      clearInterval(this.timer);
      this.timer = setInterval(() => this.leggi(), DTF_CARTELLA_EVERY);
    }
    if (this.handle && await this._permesso(false)) this.leggi();
    else this._ridisegna();
  },

  // Lettura (obbligatoria) e modifica (per numerare da soli); chiedi = dopo un clic
  async _permesso(chiedi) {
    try {
      let w = await this.handle.queryPermission({ mode: 'readwrite' });
      if (w !== 'granted' && chiedi) w = await this.handle.requestPermission({ mode: 'readwrite' });
      this.scrivibile = w === 'granted';
      if (this.scrivibile) return true;
      if (await this.handle.queryPermission({ mode: 'read' }) === 'granted') return true;
    } catch {}
    this.scrivibile = false;
    this.stato = 'prompt';
    return false;
  },

  async collega(poiNumera = false) {
    try {
      this.handle = await window.showDirectoryPicker({ id: 'dtf-stampare', mode: 'readwrite' });
    } catch (e) { if (e?.name !== 'AbortError') showToast('Cartella non collegata: riprova', 'error'); return; }
    await this._put(this.handle);
    this.esito = null;
    this._visti = null;
    this.scrivibile = true;
    if (poiNumera) await this.numera(); else this.leggi();
  },

  async riattiva(poiNumera = false) {
    if (!this.handle || !await this._permesso(true)) { this._ridisegna(); return; }
    if (poiNumera) await this.numera(); else this.leggi();
  },

  // Bottone "Numera ora": collega o riattiva la cartella se serve
  async numeraOra() {
    if (!this.handle) return this.collega(true);
    if (!this.scrivibile || this.stato === 'prompt') return this.riattiva(true);
    return this.numera();
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

  async leggi({ numera = true } = {}) {
    if (!this.handle || this.stato === 'scanning' || this.numerando) return;
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

      // DTF nuovi (o cartella appena collegata / gestionale appena aperto): numera da solo
      const percorsi = gruppi.flatMap(g => g.files.map(f => this._chiave(f.path)));
      const nuovi = !this._visti || percorsi.some(x => !this._visti.has(x));
      this._visti = new Set(percorsi);
      if (numera && nuovi && this.scrivibile) { this._ridisegna(); await this.numera({ auto: true }); return; }
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
  async numera({ auto = false } = {}) {
    if (!this.handle || this.numerando) return;
    if (!this.scrivibile) { if (!auto) showToast('Serve il permesso di modifica sulla cartella', 'error'); return; }
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
    this.numerate = { at: new Date(), fatte, errori };
    if (!auto) {
      if (errori) showToast(`${errori} ${errori === 1 ? 'cartella non rinominata' : 'cartelle non rinominate'}: un file potrebbe essere aperto`, 'error');
      else showToast(fatte ? `Cartelle numerate: ${fatte} rinominate` : 'Le cartelle erano già in ordine', 'success');
    }
    await this.leggi({ numera: false });
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

  // ── Riga della cartella in DTF interno: sempre visibile, col bottone Numera ora ──
  html() {
    if (this.stato === 'unsupported') return '<p class="dtf-note">Per leggere e numerare da solo la cartella dei file da stampare serve Chrome.</p>';
    const nome = escapeHtml(this.handle?.name || '1. Stampare');
    const ora = (d) => d ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const elenco = (arr) => arr.map(escapeHtml).join(', ');
    const btn = (fn, testo, title = '') => `<button type="button" class="btn btn-secondary btn-sm" onclick="DtfCartella.${fn}"${title ? ` title="${title}"` : ''}>${testo}</button>`;
    const e = this.esito || {}, n = this.numerate;
    let testo, azioni = [];
    switch (this.numerando ? 'scanning' : this.stato) {
      case 'none':
        testo = 'Cartella «1. Stampare» non collegata: collegala per segnare da soli file e metri e numerare le cartelle.';
        azioni = [btn('collega()', 'Collega la cartella')];
        break;
      case 'prompt':
        testo = `Cartella «${nome}» da riattivare. In Chrome scegli «Consenti a ogni visita» per non doverlo rifare.`;
        azioni = [btn('riattiva()', 'Riattiva la cartella')];
        break;
      case 'scanning':
        testo = this.numerando ? `Numero le cartelle di «${nome}»…` : `Leggo la cartella «${nome}»…`;
        break;
      case 'error':
        testo = `<span class="dtf-cartella-err">Cartella «${nome}» non letta: ${escapeHtml(this.errore)}</span>`;
        azioni = [btn('riattiva()', 'Riprova'), btn('collega()', 'Cambia cartella')];
        break;
      default:
        testo = `Cartella «${nome}» letta alle ${ora(e.at)} · ${e.abbinate || 0} ${e.abbinate === 1 ? 'ordine abbinato' : 'ordini abbinati'}${e.aggiunti ? ` · ${e.aggiunti} file nuovi` : ''}`
          + (this.scrivibile
            ? ` · numerazione automatica ai DTF nuovi${n ? ` (ultima alle ${ora(n.at)}${n.errori ? `, <span class="dtf-cartella-err">${n.errori} non rinominate</span>` : ''})` : ''}`
            : ' · numerazione automatica spenta: serve il permesso di modifica');
        azioni = [btn('leggi()', 'Aggiorna')];
    }
    if (this.stato !== 'scanning' && !this.numerando) azioni.push(btn('numeraOra()', 'Numera ora', 'Mette davanti a ogni cartella il numero dell\'ordine nella lista qui sotto'));
    return `<div class="dtf-cartella-bar">
        <span class="dtf-cartella-text">${Icons.paperclip(13)} ${testo}</span>
        ${azioni.length ? `<span class="dtf-cartella-actions">${azioni.join('')}</span>` : ''}
      </div>
      ${this.stato === 'ok' && e.senzaOrdine?.length ? `<p class="dtf-note">Senza ordine da stampare: ${elenco(e.senzaOrdine)}</p>` : ''}
      ${this.stato === 'ok' && e.ambigue?.length ? `<p class="dtf-note">Più ordini con lo stesso nome, file da aggiungere a mano: ${elenco(e.ambigue)}</p>` : ''}`;
  },
};

window.DtfCartella = DtfCartella;
