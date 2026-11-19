/**
 * T&C Factory — DTF interno: cartella dei file da stampare sul NAS
 * (DATI/DTF/1. Stampa/1. Stampare).
 *
 * Di regola la legge il Mac mini (automazioni/dtf-cartella, ogni minuto), per tutti i PC:
 * il gestionale pubblica la lista Da stampare in ordine (app_settings 'dtf_lista'),
 * il Mac mini abbina le cartelle, scrive file e metri sugli ordini, numera le cartelle
 * ("01 - cf pavia") ai DTF nuovi o col bottone "Numera ora" ('dtf_numera_richiesta')
 * e lascia il suo esito in 'dtf_cartella_stato'.
 *
 * Finché il Mac mini non è attivo, la cartella si può collegare da Chrome (sola lettura):
 * il browser la ricorda e la rilegge all'avvio e ogni 5 minuti, con le stesse regole.
 * Ogni sottocartella viene abbinata a un ordine per nome ("cf pavia" → CROSSFIT PAVIA);
 * le cartelle "Stampato" sono escluse; il numero davanti non conta.
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
    if (!this._avviata && typeof TCFactory !== 'undefined') {
      TCFactory.onUpdate(() => this.pubblicaLista());
      this.pubblicaLista();
    }
    if (!this.supported()) { this._avviata = true; this.stato = 'unsupported'; return; }
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

  async _permesso(chiedi) {
    try {
      let p = await this.handle.queryPermission({ mode: 'read' });
      if (p !== 'granted' && chiedi) p = await this.handle.requestPermission({ mode: 'read' });
      if (p === 'granted') return true;
    } catch {}
    this.stato = 'prompt';
    return false;
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
    if (!this.handle || !await this._permesso(true)) { this._ridisegna(); return; }
    this.leggi();
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
  async _gruppi() {
    const gruppi = [];
    for await (const [name, h] of this.handle.entries()) {
      if (this._salta(name)) continue;
      if (h.kind === 'directory') {
        if (!DTF_CARTELLA_SKIP.test(name)) gruppi.push({ nome: this._base(name), dir: name, files: await this._files(h, name) });
      } else if (DTF_CARTELLA_EXT.test(name)) {
        gruppi.push({ nome: name.replace(/\.[a-z0-9]{2,5}$/i, ''), files: [{ h, path: name }], sciolto: true });
      }
    }
    return gruppi;
  },

  async leggi() {
    if (this.server()) { this._ridisegna(); return; }   // la legge il Mac mini
    if (!this.handle || this.stato === 'scanning') return;
    if (!await this._permesso(false)) { this._ridisegna(); return; }
    this.stato = 'scanning';
    this._ridisegna();
    try {
      const gruppi = await this._gruppi();
      const { todo } = dtfLists();
      const perOrdine = new Map();   // id ordine → [file…]
      const senzaOrdine = [], ambigue = [], cartelle = [];
      for (const g of gruppi) {
        const o = this.abbina(g.nome, todo);
        const ordine = o && o !== 'ambiguo' ? o.id : null;
        if (g.files.length || g.dir) cartelle.push({ nome: g.nome, dir: g.dir || null, ordine, files: g.files.length,
          ...(ordine ? {} : { metri: await this._metri(g.files) }) });
        if (!g.files.length) continue;
        if (o === 'ambiguo') { ambigue.push(g.nome); continue; }
        if (!o) { senzaOrdine.push(g.nome); continue; }
        perOrdine.set(o.id, [...(perOrdine.get(o.id) || []), ...g.files]);
      }

      let aggiunti = 0;
      for (const [id, files] of perOrdine) aggiunti += await this._aggiorna(id, files);
      // Ordini che avevano la cartella e ora non ce l'hanno più: controllare se stampati
      const mancanti = todo.filter(o => !perOrdine.has(o.id) && (o.dtfItems || []).some(f => f?.cartella)).map(o => o.id);
      this.esito = { at: new Date(), abbinate: perOrdine.size, aggiunti, senzaOrdine, ambigue, cartelle, mancanti };
      this.stato = 'ok';
      this.errore = '';

    } catch (e) {
      console.error('[dtf cartella]', e);
      this.stato = e?.name === 'NotAllowedError' ? 'prompt' : 'error';
      this.errore = e?.name === 'NotFoundError' ? 'cartella non trovata: il NAS è collegato?' : (e?.message || 'errore');
    }
    this._ridisegna();
  },

  // Metri dei file di una cartella senza ordine (misure ricordate finché il file non cambia)
  _misure: new Map(),
  async _metri(entries) {
    let tot = 0;
    for (const { h, path } of entries) {
      const file = await h.getFile(), k = this._chiave(path), m = this._misure.get(k);
      const metri = m && m.size === file.size && m.mtime === file.lastModified ? m.metri : (await DtfMisure.describe(file)).metri;
      this._misure.set(k, { size: file.size, mtime: file.lastModified, metri });
      tot += metri || 0;
    }
    return Math.round(tot * 100) / 100;
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

  // ── Mac mini ──

  // Esito del Mac mini se ha lavorato negli ultimi 15 minuti (salva almeno ogni 10)
  server() {
    const s = TCFactory._settings.dtf_cartella_stato;
    return s?.at && Date.now() - new Date(s.at).getTime() < 15 * 60 * 1000 ? s : null;
  },

  // Ultima lettura della cartella: dal Mac mini, altrimenti da questo Chrome
  info() { return this.server() || (this.stato === 'ok' || this.stato === 'scanning' ? this.esito : null); },

  // Coda Da stampare (ordini e cartelle senza ordine) in ordine, per il Mac mini
  _lista() {
    return dtfCoda().map(x => x.kind === 'order' ? { id: x.id, nome: x.o.nome, descr: orderDesc(x.o) } : { id: x.id, nome: x.c.nome, cartella: true });
  },
  async _salvaLista() {
    const lista = this._lista();
    if (JSON.stringify(lista) !== JSON.stringify(TCFactory._settings.dtf_lista || [])) await TCFactory.setSetting('dtf_lista', lista);
  },
  _listaTimer: null,
  pubblicaLista() {
    clearTimeout(this._listaTimer);
    this._listaTimer = setTimeout(() => this._salvaLista().catch(e => console.warn('[dtf lista]', e)), 3000);
  },

  // Cartelle col nome diverso da quello giusto: senza numero, numero vecchio (priorità cambiata)
  // o rinominate a mano. Stesse regole del Mac mini (numera in dtf_cartella.py).
  attesa() {
    const dirs = (this.info()?.cartelle || []).filter(c => c.dir);
    if (!dirs.length) return 0;
    const pos = new Map(this._lista().map((x, i) => [x.id, i]));
    const p = (c) => c.ordine ? pos.get(c.ordine) : pos.get(`cartella:${c.nome}`);
    const numerate = dirs.filter(c => p(c) != null).sort((a, b) => p(a) - p(b) || a.nome.toLowerCase().localeCompare(b.nome.toLowerCase()));
    const cifre = Math.max(2, String(numerate.length).length);
    const giusto = new Map(numerate.map((c, i) => [c, `${String(i + 1).padStart(cifre, '0')} - ${c.nome}`]));
    return dirs.filter(c => (giusto.get(c) || c.nome) !== c.dir).length;
  },

  // "Numera le cartelle": richiesta al Mac mini, da qualsiasi PC
  async numeraOra() {
    if (!this.attesa()) return;
    try {
      clearTimeout(this._listaTimer);
      await this._salvaLista();
      await TCFactory.setSetting('dtf_numera_richiesta', { at: new Date().toISOString() });
      showToast(this.server() ? 'Il Mac mini numera le cartelle entro un minuto' : 'Richiesta salvata: la numerazione parte quando il Mac mini è attivo', this.server() ? 'success' : 'error');
    } catch (e) { console.error('[dtf numera]', e); showToast('Richiesta non salvata: riprova', 'error'); }
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
    const ora = (d) => d ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';
    const elenco = (arr) => arr.map(escapeHtml).join(', ');
    const btn = (fn, testo, title = '') => `<button type="button" class="btn btn-secondary btn-sm" onclick="DtfCartella.${fn}"${title ? ` title="${title}"` : ''}>${testo}</button>`;
    const da = this.attesa();
    const numBtn = `<button type="button" class="btn btn-primary btn-sm dtf-numera-btn" onclick="DtfCartella.numeraOra()" ${da ? '' : 'disabled'}
      title="${da ? `Mette davanti a ${da === 1 ? 'una cartella' : `${da} cartelle`} il numero della lista qui sotto` : 'Le cartelle sono già numerate nell\'ordine della lista'}">Numera le cartelle${da ? ` · ${da}` : ''}</button>`;
    const bar = (testo, azioni) => `<div class="dtf-cartella-bar">
        <span class="dtf-cartella-text">${Icons.paperclip(13)} ${testo}</span>
        ${azioni.length ? `<span class="dtf-cartella-actions">${azioni.join('')}</span>` : ''}
      </div>`;
    const extra = (e) => `${e.senzaOrdine?.length ? `<p class="dtf-note dtf-missing-note">${e.senzaOrdine.length === 1 ? 'Una cartella senza ordine' : `${e.senzaOrdine.length} cartelle senza ordine`} (${elenco(e.senzaOrdine)}): sono nella lista qui sotto, da trascinare alla loro priorità, e nei task urgenti.</p>` : ''}
      ${e.ambigue?.length ? `<p class="dtf-note">Più ordini con lo stesso nome, file da aggiungere a mano: ${elenco(e.ambigue)}</p>` : ''}`;

    const sv = this.server();
    if (sv) {
      const testo = `Cartella «1. Stampare» letta dal Mac mini alle ${ora(sv.at)} · ${sv.abbinate || 0} ${sv.abbinate === 1 ? 'ordine abbinato' : 'ordini abbinati'}`
        + (da ? ` · ${da} ${da === 1 ? 'cartella da numerare' : 'cartelle da numerare'}` : ' · cartelle numerate')
        + (sv.errori?.length ? ` · <span class="dtf-cartella-err">${sv.errori.length} non rinominate (file aperto?)</span>` : '');
      return bar(testo, [numBtn]) + extra(sv);
    }

    if (this.stato === 'unsupported') return bar('Cartella «1. Stampare»: la leggerà il Mac mini (non ancora attivo).', [numBtn]);
    const nome = escapeHtml(this.handle?.name || '1. Stampare');
    const e = this.esito || {};
    let testo, azioni = [];
    switch (this.stato) {
      case 'none':
        testo = 'Cartella «1. Stampare» non letta: il Mac mini non è ancora attivo. Intanto puoi collegarla da Chrome per segnare file e metri.';
        azioni = [btn('collega()', 'Collega la cartella')];
        break;
      case 'prompt':
        testo = `Cartella «${nome}» da riattivare. In Chrome scegli «Consenti a ogni visita» per non doverlo rifare.`;
        azioni = [btn('riattiva()', 'Riattiva la cartella')];
        break;
      case 'scanning':
        testo = `Leggo la cartella «${nome}»…`;
        break;
      case 'error':
        testo = `<span class="dtf-cartella-err">Cartella «${nome}» non letta: ${escapeHtml(this.errore)}</span>`;
        azioni = [btn('riattiva()', 'Riprova'), btn('collega()', 'Cambia cartella')];
        break;
      default:
        testo = `Cartella «${nome}» letta da questo PC alle ${ora(e.at)} · ${e.abbinate || 0} ${e.abbinate === 1 ? 'ordine abbinato' : 'ordini abbinati'}${e.aggiunti ? ` · ${e.aggiunti} file nuovi` : ''} · numeri alle cartelle quando il Mac mini sarà attivo`;
        azioni = [btn('leggi()', 'Aggiorna')];
    }
    if (this.stato !== 'scanning') azioni.push(numBtn);
    return bar(testo, azioni) + (this.stato === 'ok' ? extra(e) : '');
  },
};

window.DtfCartella = DtfCartella;
