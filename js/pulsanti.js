/**
 * T&C Factory — Pulsanti dell'ordine (Impostazioni → Pulsanti)
 * Tutti i pulsanti di avanzamento della lista ordini (Merce, DTF, Pronto, Parziale, Evaso,
 * le lavorazioni interne/esterne e quelli creati a mano) con le loro regole:
 *  - colonna:      id dell'etichetta sotto cui sta il pulsante (vedi Etichette qui sotto)
 *  - ruolo:        cosa fa la spunta (vedi PULSANTI_RUOLI) → decide in che scheda sta l'ordine
 *  - collegamento: dove si salva la spunta ('' = fase propria; 'dtf' = DTF interno;
 *                  'interne:<id>' / 'esterne:<id>' = scheda Interne / tipo Esterne; 'esterne:*' = Esterna generica)
 *  - mostra:       quando compare sull'ordine (vedi PULSANTI_MOSTRA)
 *  - alt:          etichetta alternativa { nome, seNon: <id pulsante> }
 *  - intermedio:   nome del passaggio intermedio (es. "Stampa"): il primo clic lo fa diventare giallo
 *                  con questo nome, il secondo verde (fatto), il terzo toglie la spunta.
 *                  Il passaggio si salva in o.stages["mezzo:<id pulsante>"]
 *                  Le lavorazioni esterne ('esterne:…') hanno sempre il passaggio giallo (anche senza nome):
 *                  primo clic giallo con la data, secondo verde con la data.
 *  - rigaGialla:   true = fatto ma con altre lavorazioni dell'ordine ancora da fare → riga gialla;
 *                  anche se fatto finché la lavorazione non è chiusa (l'ordine va in Evasione)
 *  - abilita:      cliccabile solo se { se: <condizione, vedi PULSANTI_ABILITA>, pulsante: <id> }
 *                  (vale solo per spuntare: togliere la spunta è sempre possibile)
 *  - attivo:       false = nascosto ovunque
 *  - eliminato:    true = tolto dalle Impostazioni (resta salvato solo per non far ricomparire
 *                  il pulsante automatico della sua lavorazione)
 * Etichette (app_settings.pulsanti_etichette): le colonne della lista ordini che raccolgono
 * i pulsanti, ognuna con le schede in cui compare (Attivi, Evasione…).
 * Le lavorazioni interne/esterne delle Impostazioni hanno un pulsante automatico
 * (id "lav-<id>") finché non se ne modifica uno: da lì viene salvato con gli altri.
 */

const PULSANTI_KEY = 'pulsanti_ordine';
const PULSANTI_ETICHETTE_KEY = 'pulsanti_etichette';

// Schede della lista ordini in cui può comparire un'etichetta
const PULSANTI_SCHEDE = {
  active: 'Attivi', evasione: 'Evasione', dariscuotere: 'Da riscuotere', archived: 'Archivio', search: 'Ricerca',
};
const PULSANTI_ETICHETTE_DEFAULT = () => [
  { id: 'lavorazione', nome: 'Lavorazione', schede: Object.keys(PULSANTI_SCHEDE) },
  { id: 'spedizione',  nome: 'Spedizione',  schede: Object.keys(PULSANTI_SCHEDE).filter(v => v !== 'active') },
];

const PULSANTI_RUOLI = {
  nessuno:      { label: 'Solo spunta',                  hint: 'Segna la fase con la data, senza spostare l\'ordine' },
  obbligatorio: { label: 'Obbligatorio per l\'evasione', hint: 'Se manca, l\'ordine resta in Attivi anche con la lavorazione chiusa' },
  chiude:       { label: 'Chiude la lavorazione',        hint: 'Spuntato (e con gli obbligatori fatti), l\'ordine esce da Attivi e va in Evasione' },
  parziale:     { label: 'Spedizione parziale',          hint: 'Togliendo la spunta si annulla anche l\'evasione' },
  evade:        { label: 'Evade l\'ordine',              hint: 'Con il pagamento l\'ordine va in Archivio, senza in Da riscuotere' },
};

const PULSANTI_MOSTRA = {
  sempre:               'Sempre',
  selezionata:          'Solo se la lavorazione collegata è scelta nell\'ordine',
  interna:              'Solo ordini con lavorazione interna',
  esterna:              'Solo ordini con lavorazione esterna',
  'esterna-senza-tipo': 'Ordini esterni senza tipo di lavorazione',
};

// "Cliccabile solo se": quelle con pulsante: true chiedono anche quale pulsante
const PULSANTI_ABILITA = {
  '':                   { label: 'Sempre' },
  spuntato:             { label: 'Un altro pulsante è spuntato', pulsante: true, testo: (n) => `${n} spuntato` },
  'non-spuntato':       { label: 'Un altro pulsante NON è spuntato', pulsante: true, testo: (n) => `${n} non spuntato` },
  'lavorazioni-fatte':  { label: 'Tutti gli altri pulsanti di Lavorazione sono spuntati', testo: () => 'tutte le lavorazioni fatte' },
  'lavorazione-chiusa': { label: 'La lavorazione è chiusa', testo: () => 'lavorazione chiusa' },
  'merce-ok':           { label: 'Tutti i pulsanti obbligatori sono spuntati', testo: () => 'obbligatori spuntati' },
  pagato:               { label: 'L\'ordine è pagato (€)', testo: () => 'ordine pagato' },
  'non-pagato':         { label: 'L\'ordine NON è pagato', testo: () => 'ordine non pagato' },
  fatturato:            { label: 'La fattura è confermata (🧾)', testo: () => 'fattura confermata' },
  importo:              { label: 'L\'ordine ha un importo', testo: () => 'importo inserito' },
  modulo:               { label: 'C\'è il modulo d\'ordine', testo: () => 'modulo d\'ordine compilato' },
  allegati:             { label: 'Ci sono file allegati', testo: () => 'file allegati' },
  cliente:              { label: 'L\'ordine ha un cliente collegato', testo: () => 'cliente collegato' },
  scadenza:             { label: 'L\'ordine ha una deadline', testo: () => 'deadline inserita' },
};

const PULSANTI_DEFAULT = () => [
  { id: 'merceCompleta',       nome: 'Merce',    colonna: 'lavorazione', ruolo: 'obbligatorio', collegamento: '',          mostra: 'sempre' },
  { id: 'dtfPronti',           nome: 'DTF',      colonna: 'lavorazione', ruolo: 'nessuno',      collegamento: 'dtf',       mostra: 'sempre', intermedio: 'Stampa', rigaGialla: true },
  { id: 'ordineStampato',      nome: 'Pronto',   colonna: 'lavorazione', ruolo: 'chiude',       collegamento: '',          mostra: 'sempre', alt: { nome: 'Parziale', seNon: 'merceCompleta' } },
  { id: 'lavorazioneEsterna',  nome: 'Esterna',  colonna: 'lavorazione', ruolo: 'nessuno',      collegamento: 'esterne:*', mostra: 'esterna-senza-tipo' },
  { id: 'speditoParzialmente', nome: 'Parziale', colonna: 'spedizione',  ruolo: 'parziale',     collegamento: '',          mostra: 'sempre' },
  { id: 'spedito',             nome: 'Evaso',    colonna: 'spedizione',  ruolo: 'evade',        collegamento: '',          mostra: 'sempre' },
];
const PULSANTI_FISSI = new Set(PULSANTI_DEFAULT().map(p => p.id));

const Pulsanti = {
  // ── Memoria dei calcoli ──
  // Elenco pulsanti, etichette e lavorazioni dell'ordine si ricalcolano solo quando cambiano le
  // impostazioni da cui dipendono (le impostazioni salvate sono sempre oggetti nuovi) o l'ordine
  // (ogni modifica sostituisce l'oggetto ordine). Prima si ricostruiva tutto per ogni ordine e pulsante.
  _memo: null,
  _deps() {
    const st = TCFactory._settings;
    return [st[PULSANTI_KEY], st[PULSANTI_ETICHETTE_KEY], st.lavorazioni_interne, st.lavorazioni_esterne];
  },
  _cache() {
    const deps = this._deps();
    if (!this._memo || this._memo.deps.some((d, i) => d !== deps[i])) this._memo = { deps, values: {}, orders: new WeakMap() };
    return this._memo;
  },
  _remember(key, fn) {
    const v = this._cache().values;
    return key in v ? v[key] : (v[key] = fn());
  },
  // Calcoli per singolo ordine (stessa memoria, legata all'oggetto ordine)
  _perOrdine(o, key, fn) {
    if (!o || typeof o !== 'object') return fn();
    const m = this._cache().orders;
    let c = m.get(o);
    if (!c) m.set(o, c = {});
    return key in c ? c[key] : (c[key] = fn());
  },

  // ── Configurazione ──
  config() { return this._remember('config', () => this._config()); },
  _config() {
    const v = TCFactory._settings[PULSANTI_KEY];
    if (!Array.isArray(v)) return PULSANTI_DEFAULT();
    // Id doppi (salvati dalla versione precedente): ogni pulsante deve avere il suo, altrimenti
    // modificarne uno cambia anche l'altro. Il secondo prende un id nuovo.
    const seen = new Set();
    return v.filter(p => p && p.id).map(p => {
      let id = p.id, n = 2;
      while (seen.has(id)) id = `${p.id}-${n++}`;
      seen.add(id);
      return id === p.id ? p : { ...p, id };
    });
  },
  // ── Etichette (colonne della lista ordini) ──
  gruppi() { return this._remember('gruppi', () => this._gruppi()); },
  _gruppi() {
    const v = TCFactory._settings[PULSANTI_ETICHETTE_KEY];
    const list = Array.isArray(v) ? v.filter(g => g && g.id) : [];
    return list.length ? list : PULSANTI_ETICHETTE_DEFAULT();
  },
  gruppoDi(p) {
    const ids = this._remember('gruppiIds', () => new Set(this.gruppi().map(g => g.id)));
    return ids.has(p.colonna) ? p.colonna : this.gruppi()[0].id;
  },
  // Raggruppare per un'etichetta serve solo se ha pulsanti che compaiono solo su alcuni ordini
  // (es. le lavorazioni di INTERNA / ESTERNA): se sono tutti "Sempre" (es. GENERALE) ogni gruppo
  // conterrebbe tutti gli ordini, quindi l'intestazione non è cliccabile.
  raggruppabile(id) {
    return this.all().some(p => this.gruppoDi(p) === id && p.attivo !== false && !this.orfano(p) && (p.mostra || 'sempre') !== 'sempre');
  },
  gruppiVista(view) { return this.gruppi().filter(g => (g.schede || Object.keys(PULSANTI_SCHEDE)).includes(view)); },
  // Colonne della riga: Nome 200px, Tipologia, Data, Scadenza, Ordine, una per etichetta, Pagamento
  // Le colonne delle etichette partono larghe quanto il loro contenuto; adattaColonne le allinea poi tra le righe
  gridStyle(view) {
    const n = this.gruppiVista(view).length;
    return `grid-template-columns: ${this._cols(n ? Array(n).fill('max-content') : [], 'max-content')};`;
  },
  _cols(gruppi, ordine = '62px') { return ['200px', '130px', '112px', '104px', ordine, ...gruppi, '90px'].join(' '); },
  // Colonna Ordine e colonne etichetta larghe quanto la cella più lunga (intestazione compresa), uguali in tutte le righe
  // Con la pagina Ordini nascosta (si è su un'altra pagina) le larghezze sarebbero 0: si rifà quando torna visibile (nav.js)
  adattaColonne(root) {
    if (!root || !root.getClientRects().length) return;
    const grids = [...root.querySelectorAll('.order-row-grid')];
    // Si misura con le colonne larghe quanto il contenuto, non con quelle fissate dalla volta prima
    grids.forEach(g => { g.style.gridTemplateColumns = this._cols(Array(g.querySelectorAll(':scope > .orc-gruppo').length).fill('max-content'), 'max-content'); });
    const widths = [];
    let ordine = 62;
    grids.forEach(g => {
      const f = g.querySelector(':scope > .orc-files');
      if (f) ordine = Math.max(ordine, Math.ceil(f.getBoundingClientRect().width));
      g.querySelectorAll(':scope > .orc-gruppo').forEach((c, i) => {
        widths[i] = Math.max(widths[i] || 0, Math.ceil(c.getBoundingClientRect().width));
      });
    });
    const cols = this._cols(widths.map(w => `${w}px`), `${ordine}px`);
    grids.forEach(g => { g.style.gridTemplateColumns = cols; });
  },
  dtfLavId() { return typeof interneLavId === 'function' ? interneLavId('interno') : 'li-dtf'; },
  // Collegamento → { kind, id } della lavorazione (null se non è collegato a una lavorazione)
  link(p) {
    const c = p.collegamento || '';
    if (c === 'dtf') return { kind: 'interne', id: this.dtfLavId() };
    const [kind, id] = c.split(':');
    return (kind === 'interne' || kind === 'esterne') && id ? { kind, id } : null;
  },
  linkKey(p) { const l = this.link(p); return l ? `${l.kind}:${l.id}` : ''; },
  // Collegato a una lavorazione che non esiste più
  orfano(p) {
    const l = this.link(p);
    return !!l && l.id !== '*' && p.collegamento !== 'dtf' && !getLav(l.kind).some(x => x.id === l.id);
  },
  // Tutti i pulsanti: quelli salvati + uno automatico per ogni lavorazione non ancora collegata
  all() { return this._remember('all', () => this._all()); },
  get(id) { return this._remember('byId', () => new Map(this.all().map(p => [p.id, p]))).get(id) || null; },
  _all() {
    const conf = this.config().filter(p => !p.eliminato);
    const linked = new Set(this.config().map(p => this.linkKey(p)).filter(Boolean));
    const dtf = this.dtfLavId();
    // Id del pulsante automatico: mai uguale a uno salvato (es. un pulsante "lav-…" ricollegato a un'altra lavorazione)
    const used = new Set(this.config().map(p => p.id));
    const freeId = (base) => { let id = base, n = 2; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id; };
    const auto = ['interne', 'esterne'].flatMap(kind => getLav(kind)
      .filter(l => !(kind === 'interne' && l.id === dtf) && !linked.has(`${kind}:${l.id}`))
      .map(l => ({ id: freeId(`lav-${l.id}`), nome: '', colonna: this.gruppi()[0].id, ruolo: 'nessuno', collegamento: `${kind}:${l.id}`, mostra: 'selezionata', auto: true })));
    return [...conf, ...auto];
  },
  // Elenco da salvare: i pulsanti + quelli eliminati (che restano come segnaposto)
  salvabili(list) {
    const ids = new Set(list.map(p => p.id));
    return [...list.map(({ auto, ...p }) => p), ...this.config().filter(p => p.eliminato && !ids.has(p.id))];
  },
  nome(p) {
    if (p.nome) return p.nome;
    const l = this.link(p);
    return (l && l.id !== '*' && lavName(l.kind, l.id)) || 'Pulsante';
  },

  // ── Su un ordine ──
  visibile(o, p) {
    if (p.attivo === false || this.orfano(p)) return false;
    const neutro = TCFactory.isNeutro(o);
    const esterna = !!o.lavorazioneEsterna && !neutro;
    switch (p.mostra) {
      case 'selezionata': {
        const l = this.link(p);
        if (!l) return true;
        if (l.id === '*') return esterna;
        return orderLavTipi(o).some(t => t.kind === l.kind && t.id === l.id);
      }
      case 'interna': return isLavInterna(o);
      case 'esterna': return esterna;
      case 'esterna-senza-tipo': return esterna && !orderLavTipi(o).some(t => t.kind === 'esterne');
      default: return true;
    }
  },
  visibili(o, colonna) {
    const tutti = this._perOrdine(o, 'visibili', () => this.all().filter(p => this.visibile(o, p)));
    return colonna ? tutti.filter(p => this.gruppoDi(p) === colonna) : tutti;
  },
  // Fase dell'ordine dove si salva la spunta (null = collegato a una lavorazione)
  stageId(p) {
    if (!p.collegamento) return p.id;
    if (p.collegamento === 'dtf') return 'dtfPronti';
    if (p.collegamento === 'esterne:*') return 'lavorazioneEsterna';
    return null;
  },
  stato(o, p) { return this._perOrdine(o, 'stato:' + p.id, () => this._stato(o, p)); },
  _stato(o, p) {
    const sid = this.stageId(p);
    let v;
    if (sid) { const st = o.stages?.[sid]; v = st?.done ? (st.date || true) : null; }
    else { const l = this.link(p); v = lavTipoDone(o, l.kind, l.id); }
    const m = !v && this.haMezzo(p) ? o.stages?.[this.mezzoKey(p)] : null;
    return { done: !!v, date: typeof v === 'string' ? v : null, mezzo: !!m, mezzoDate: m?.date || null };
  },
  // Pulsante con il passaggio intermedio giallo: se ha un nome, o se è una lavorazione esterna
  haMezzo(p) { return !!p.intermedio || this.link(p)?.kind === 'esterne'; },
  // Passaggio intermedio (giallo) del pulsante, salvato tra le fasi dell'ordine
  mezzoKey(p) { return `mezzo:${p.id}`; },
  etichetta(o, p) {
    if (p.intermedio) { const st = this.stato(o, p); if (st.mezzo || st.done) return p.intermedio; }
    const cond = p.alt?.nome && p.alt.seNon ? this.get(p.alt.seNon) : null;
    return cond && this.visibile(o, cond) && !this.stato(o, cond).done ? p.alt.nome : this.nome(p);
  },
  // "Cliccabile solo se": la condizione per poter spuntare il pulsante
  cliccabile(o, p) {
    const c = p.abilita?.se || '';
    const other = p.abilita?.pulsante ? this.get(p.abilita.pulsante) : null;
    switch (c) {
      case 'spuntato':           return !other || (this.visibile(o, other) && this.stato(o, other).done);
      case 'non-spuntato':       return !other || !this.visibile(o, other) || !this.stato(o, other).done;
      case 'lavorazioni-fatte':  return this.visibili(o, 'lavorazione').filter(x => x.id !== p.id).every(x => this.stato(o, x).done);
      case 'lavorazione-chiusa': return this.chiusa(o);
      case 'merce-ok':           return this.obbligatoriOk(o);
      case 'pagato':             return !!o.paymentDone;
      case 'non-pagato':         return !o.paymentDone;
      case 'fatturato':          return !!o.invoiceConfirmed;
      case 'importo':            return (parseFloat(o.importo) || 0) > 0;
      case 'modulo':             return (o.orderModule?.rows?.length || 0) > 0;
      case 'allegati':           return (o.files?.length || 0) > 0;
      case 'cliente':            return !!o.clientId;
      case 'scadenza':           return !!o.deadline;
      default:                   return true;
    }
  },
  motivo(p) {
    const def = PULSANTI_ABILITA[p.abilita?.se || ''];
    if (!def?.testo) return '';
    const other = p.abilita?.pulsante ? this.get(p.abilita.pulsante) : null;
    return `Cliccabile solo con ${def.testo(other ? this.nome(other) : '…')}`;
  },
  _ruolo(o, ruolo) { return this.visibili(o).filter(p => p.ruolo === ruolo); },
  // Lavorazione chiusa: tutti i pulsanti "chiude" spuntati
  chiusa(o) { const l = this._ruolo(o, 'chiude'); return l.length > 0 && l.every(p => this.stato(o, p).done); },
  obbligatoriOk(o) { return this._ruolo(o, 'obbligatorio').every(p => this.stato(o, p).done); },
  isEvaso(o) { const l = this._ruolo(o, 'evade'); return l.length > 0 && l.every(p => this.stato(o, p).done); },
  // Data con cui è stata chiusa la lavorazione (per la vista Evasione)
  dataChiusura(o) { return this._ruolo(o, 'chiude').map(p => this.stato(o, p).date).filter(Boolean).sort().pop() || null; },
  // Riga gialla: un pulsante "riga gialla" è fatto ma restano altre lavorazioni (pulsanti collegati) da fare
  // o la lavorazione non è ancora chiusa (pulsante "chiude", es. Pronto, che manda in Evasione)
  rigaGialla(o) {
    return this._perOrdine(o, 'rigaGialla', () => {
      const vis = this.visibili(o);
      return vis.some(p => {
        if (!p.rigaGialla) return false;
        if (!this.stato(o, p).done) return false;
        return !this.chiusa(o) || vis.some(x => x.id !== p.id && this.link(x) && !this.stato(o, x).done);
      });
    });
  },
  nomeChiusura() { const p = this.all().find(x => x.ruolo === 'chiude' && x.attivo !== false); return p ? this.nome(p) : 'Lavorazione'; },

  // Salva la spunta di un pulsante (senza effetti sulle schede)
  async set(orderId, p, done) {
    const sid = this.stageId(p);
    if (sid) await TCFactory.setStage(orderId, sid, done, this.nome(p));
    else { const l = this.link(p); await setLavTipo(orderId, l.kind, l.id, done); }
    await this.setMezzo(orderId, p, false);
  },
  // Segna / toglie il passaggio intermedio (giallo)
  async setMezzo(orderId, p, on) {
    const o = TCFactory.getOrderById(orderId);
    const key = this.mezzoKey(p);
    if (!o || !!o.stages?.[key] === on) return;
    const { [key]: _, ...stages } = o.stages || {};
    if (on) stages[key] = { date: localISODate(new Date()) };
    await TCFactory.updateOrder(orderId, { stages });
    if (on) TCFactory._log(`◐ ${p.intermedio || this.nome(p)}`, orderId, o.nome, { stage: key, done: false });
  },
  // Spunta tutti i pulsanti visibili con un certo ruolo (Sposta in… dal dettaglio ordine)
  async setRuolo(orderId, ruolo, done) {
    const o = TCFactory.getOrderById(orderId);
    if (!o) return;
    for (const p of this._ruolo(o, ruolo)) if (this.stato(TCFactory.getOrderById(orderId), p).done !== done) await this.set(orderId, p, done);
  },
  // Spunta + effetti del ruolo: evaso con pagamento → Archivio; evasione annullata → pagamento azzerato
  async toggle(orderId, pid, done) {
    const o = TCFactory.getOrderById(orderId);
    const p = this.get(pid);
    if (!o || !p) return;
    if (done && !this.cliccabile(o, p)) { showToast(this.motivo(p), 'error'); return; }
    // Con il passaggio intermedio il primo clic lo fa diventare giallo, il secondo verde
    if (done && this.haMezzo(p) && !this.stato(o, p).mezzo) { await this.setMezzo(orderId, p, true); return; }
    const wasPaid = !!o.paymentDone, wasEvaso = this.isEvaso(o);
    await this.set(orderId, p, done);
    if (p.ruolo === 'parziale' && !done && wasEvaso) {
      await this.setRuolo(orderId, 'evade', false);
      await TCFactory.setArchived(orderId, false);
      return;
    }
    const nowEvaso = this.isEvaso(TCFactory.getOrderById(orderId));
    if (!wasEvaso && nowEvaso && wasPaid) await TCFactory.setArchived(orderId, true);
    if (wasEvaso && !nowEvaso) {
      await TCFactory.updateOrder(orderId, { paymentDone: false, paymentDate: null });
      await TCFactory.setArchived(orderId, false);
    }
  },
  // Pulsante che usa una certa fase dell'ordine (per il vecchio toggleStageInline)
  byStage(stageId) { return this.all().find(p => this.stageId(p) === stageId) || null; },
};

// ── Lista ordini: pill dei pulsanti ──
function pulsantiPills(o, colonna, filtro = () => true) {
  return Pulsanti.visibili(o, colonna).filter(filtro).map(p => {
    const st = Pulsanti.stato(o, p);
    const locked = !st.done && !Pulsanti.cliccabile(o, p);
    return `<div class="stage-cell">
      <button class="stage-pill ${st.done ? 'done' : ''} ${st.mezzo ? 'mezzo' : ''} ${locked ? 'locked' : ''}"
        onclick="event.stopPropagation();${locked ? '' : `pulsanteToggle('${o.id}','${escapeHtml(p.id)}',${!st.done})`}" ${locked ? 'aria-disabled="true"' : ''}
        title="${escapeHtml(locked ? Pulsanti.motivo(p) : Pulsanti.nome(p) + (st.done ? ' — fatto' : st.mezzo ? ` — ${p.intermedio || 'in corso'}: clic per segnarlo fatto` : ''))}">${escapeHtml(Pulsanti.etichetta(o, p))}</button>
      <span class="pill-date">${(st.date || st.mezzoDate) ? TCFactory.formatDate(st.date || st.mezzoDate, { day: '2-digit', month: '2-digit' }) : ''}</span>
    </div>`;
  }).join('');
}

async function pulsanteToggle(orderId, pid, done) {
  try { await Pulsanti.toggle(orderId, pid, done); }
  catch (e) { showToast('Errore aggiornamento', 'error'); console.error(e); }
  if (AppState.selectedOrder?.id === orderId && document.getElementById('order-detail-modal')?.classList.contains('active')) {
    AppState.selectedOrder = TCFactory.getOrderById(orderId);
    renderOrderDetail();
  }
  renderApp();
}

// ═══════════════════════════════════════════════
// IMPOSTAZIONI → PULSANTI
// ═══════════════════════════════════════════════

function pulsantiCollegamentiOptions(p) {
  const opts = [['', 'Nessuno (fase propria)'], ['dtf', 'Interne: DTF interno']];
  const dtf = Pulsanti.dtfLavId();
  getLav('interne').filter(l => l.id !== dtf).forEach(l => opts.push([`interne:${l.id}`, `Interne: ${l.nome}`]));
  opts.push(['esterne:*', 'Esterne: lavorazione esterna generica']);
  getLav('esterne').forEach(l => opts.push([`esterne:${l.id}`, `Esterne: ${l.nome}`]));
  if (p.collegamento && !opts.some(([v]) => v === p.collegamento)) opts.push([p.collegamento, '(lavorazione eliminata)']);
  return opts.map(([v, l]) => `<option value="${escapeHtml(v)}" ${(p.collegamento || '') === v ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
}

function pulsantiSettingsHtml() {
  const all = Pulsanti.all();
  const attivi = all.filter(p => p.attivo !== false && !Pulsanti.orfano(p));
  const warn = [
    !attivi.some(p => p.ruolo === 'chiude') && 'Nessun pulsante "Chiude la lavorazione": gli ordini resteranno in Attivi.',
    !attivi.some(p => p.ruolo === 'evade')  && 'Nessun pulsante "Evade l\'ordine": gli ordini non arriveranno in Da riscuotere / Archivio.',
  ].filter(Boolean);
  const sel = (p, field, options) => `<select class="form-select" onchange="pulsantiSet('${escapeHtml(p.id)}','${field}',this.value)">${options}</select>`;
  const opt = (obj, cur) => Object.entries(obj).map(([v, x]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${escapeHtml(typeof x === 'string' ? x : x.label)}</option>`).join('');

  const card = (p, i, list) => {
    // Si eliminano quelli creati a mano o rimasti senza lavorazione; gli altri si disattivano
    const open = PulsantiOpen.has(p.id);
    const pid = escapeHtml(p.id);
    const sommario = [PULSANTI_RUOLI[p.ruolo || 'nessuno']?.label, p.collegamento ? 'collegato' : '', p.mostra && p.mostra !== 'sempre' ? 'condizionale' : '', p.abilita?.se ? 'con condizione' : '',
      p.intermedio ? `poi ${p.intermedio}` : '', p.rigaGialla ? 'riga gialla' : '']
      .filter(Boolean).join(' · ');
    return `
    <div class="pulsante-cfg ${p.attivo === false ? 'off' : ''} ${open ? 'open' : ''}" data-pid="${pid}" data-col="${escapeHtml(Pulsanti.gruppoDi(p))}"
      ondragover="pulsantiDragOver(event, this)" ondragleave="this.classList.remove('drop-before','drop-after')" ondrop="pulsantiDrop(event, this)">
      <div class="pulsante-cfg-head">
        <span class="pulsante-cfg-grip" draggable="true" ondragstart="pulsantiDragStart(event, '${pid}')" ondragend="pulsantiDragEnd()"
          title="Trascina per cambiare l'ordine" aria-hidden="true">⋮⋮</span>
        <span class="pulsante-cfg-pos">${i + 1}</span>
        <div class="reorder-arrows">
          <button type="button" ${i === 0 ? 'disabled' : ''} onclick="pulsantiMove('${escapeHtml(p.id)}',-1)" aria-label="Sposta su">${Icons.arrowUp()}</button>
          <button type="button" ${i === list.length - 1 ? 'disabled' : ''} onclick="pulsantiMove('${escapeHtml(p.id)}',1)" aria-label="Sposta giù">${Icons.arrowDown()}</button>
        </div>
        <span class="stage-pill" aria-hidden="true">${escapeHtml(Pulsanti.nome(p))}</span>
        <button type="button" class="pulsante-cfg-toggle" aria-expanded="${open}" aria-controls="pcfg-${pid}" onclick="pulsantiToggleOpen('${pid}')">
          <small>${escapeHtml(sommario)}</small>
          <svg class="settings-block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <label class="check-inline" title="Mostra il pulsante"><input type="checkbox" ${p.attivo !== false ? 'checked' : ''} onchange="pulsantiSet('${escapeHtml(p.id)}','attivo',this.checked)"> Attivo</label>
        <button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="pulsantiDelete('${escapeHtml(p.id)}')" aria-label="Elimina pulsante ${escapeHtml(Pulsanti.nome(p))}" title="Elimina pulsante">${Icons.trash(15)}</button>
      </div>
      ${Pulsanti.orfano(p) ? `<div class="settings-section-hint" style="margin:0;color:var(--priority-urgent);">La lavorazione collegata è stata eliminata: il pulsante non compare.</div>` : ''}
      <div class="pulsante-cfg-grid" id="pcfg-${pid}" ${open ? '' : 'hidden'}>
        <label>Nome</label>
        <input class="form-input" value="${escapeHtml(p.nome || '')}" placeholder="${escapeHtml(Pulsanti.nome(p))}" maxlength="30" aria-label="Nome del pulsante"
          onchange="pulsantiSet('${pid}','nome',this.value)">
        <label>Etichetta</label>${sel(p, 'colonna', Pulsanti.gruppi().map(g => `<option value="${escapeHtml(g.id)}" ${Pulsanti.gruppoDi(p) === g.id ? 'selected' : ''}>${escapeHtml(g.nome)}</option>`).join(''))}
        <label>Cosa fa</label>${sel(p, 'ruolo', opt(PULSANTI_RUOLI, p.ruolo || 'nessuno'))}
        <small class="pulsante-cfg-hint">${escapeHtml(PULSANTI_RUOLI[p.ruolo || 'nessuno']?.hint || '')}</small>
        <label>Collegato a</label>${sel(p, 'collegamento', pulsantiCollegamentiOptions(p))}
        <small class="pulsante-cfg-hint">${p.collegamento ? 'La spunta è la stessa della scheda Interne / Esterne collegata' : 'La spunta vale solo per questo pulsante'}</small>
        <label>Quando compare</label>${sel(p, 'mostra', opt(PULSANTI_MOSTRA, p.mostra || 'sempre'))}
        <label>Cliccabile solo se</label>
        <span class="pulsante-cfg-alt">
          <select class="form-select" aria-label="Cliccabile solo se" onchange="pulsantiSetAbilita('${pid}','se',this.value)">
            ${Object.entries(PULSANTI_ABILITA).map(([v, x]) => `<option value="${v}" ${(p.abilita?.se || '') === v ? 'selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}
          </select>
          ${PULSANTI_ABILITA[p.abilita?.se || '']?.pulsante ? `
          <select class="form-select" aria-label="Quale pulsante" onchange="pulsantiSetAbilita('${pid}','pulsante',this.value)">
            <option value="">— scegli il pulsante —</option>
            ${all.filter(x => x.id !== p.id).map(x => `<option value="${escapeHtml(x.id)}" ${p.abilita?.pulsante === x.id ? 'selected' : ''}>${escapeHtml(Pulsanti.nome(x))}</option>`).join('')}
          </select>` : ''}
        </span>
        <small class="pulsante-cfg-hint">Finché la condizione non c'è il pulsante resta grigio; togliere la spunta è sempre possibile</small>
        <label>Etichetta alternativa</label>
        <span class="pulsante-cfg-alt">
          <input class="form-input" value="${escapeHtml(p.alt?.nome || '')}" placeholder="es. Parziale" maxlength="30" aria-label="Etichetta alternativa"
            onchange="pulsantiSetAlt('${escapeHtml(p.id)}','nome',this.value)">
          <span>se non è spuntato</span>
          <select class="form-select" aria-label="Pulsante della condizione" onchange="pulsantiSetAlt('${escapeHtml(p.id)}','seNon',this.value)">
            <option value="">—</option>
            ${all.filter(x => x.id !== p.id).map(x => `<option value="${escapeHtml(x.id)}" ${p.alt?.seNon === x.id ? 'selected' : ''}>${escapeHtml(Pulsanti.nome(x))}</option>`).join('')}
          </select>
        </span>
        <label>Passaggio intermedio</label>
        <input class="form-input" value="${escapeHtml(p.intermedio || '')}" placeholder="es. Stampa (vuoto = nessuno)" maxlength="30" aria-label="Nome del passaggio intermedio"
          onchange="pulsantiSet('${pid}','intermedio',this.value)">
        <small class="pulsante-cfg-hint">Primo clic: diventa giallo con questo nome · secondo clic: verde (fatto) · terzo clic: toglie la spunta</small>
        <label>Riga gialla</label>
        <label class="check-inline"><input type="checkbox" ${p.rigaGialla ? 'checked' : ''} onchange="pulsantiSet('${pid}','rigaGialla',this.checked)"> Quando è fatto ma mancano altre lavorazioni dell'ordine, o finché l'ordine non va in Evasione</label>
      </div>
    </div>`;
  };
  const gruppi = Pulsanti.gruppi();
  const group = (g, gi) => {
    const colonna = g.id;
    const list = all.filter(p => Pulsanti.gruppoDi(p) === colonna);
    const gid = escapeHtml(g.id);
    const schede = g.schede || Object.keys(PULSANTI_SCHEDE);
    // Anteprima: i pulsanti attivi nell'ordine in cui compaiono nella lista ordini
    const preview = list.filter(p => p.attivo !== false && !Pulsanti.orfano(p)).map(p =>
      `<span class="stage-pill">${escapeHtml(Pulsanti.nome(p))}</span>`).join('');
    return `
    <section class="pulsanti-etichetta" data-col="${gid}" ondragover="pulsantiDragOverGruppo(event, this)" ondragleave="this.classList.remove('drop-into')" ondrop="pulsantiDropGruppo(event, this)">
      <div class="pulsanti-etichetta-head">
        <div class="reorder-arrows">
          <button type="button" ${gi === 0 ? 'disabled' : ''} onclick="etichetteMove('${gid}',-1)" aria-label="Sposta etichetta a sinistra">${Icons.arrowUp()}</button>
          <button type="button" ${gi === gruppi.length - 1 ? 'disabled' : ''} onclick="etichetteMove('${gid}',1)" aria-label="Sposta etichetta a destra">${Icons.arrowDown()}</button>
        </div>
        <input class="form-input" value="${escapeHtml(g.nome)}" maxlength="30" aria-label="Nome dell'etichetta" onchange="etichetteSet('${gid}','nome',this.value)">
        <button type="button" class="btn-icon" style="color:var(--priority-urgent);" ${gruppi.length <= 1 ? 'disabled' : ''} onclick="etichetteDelete('${gid}')" aria-label="Elimina etichetta ${escapeHtml(g.nome)}">${Icons.trash(15)}</button>
      </div>
      <div class="pulsanti-etichetta-schede" role="group" aria-label="Schede in cui compare">
        <small>Compare in:</small>
        ${Object.entries(PULSANTI_SCHEDE).map(([v, l]) => `<label class="check-inline"><input type="checkbox" ${schede.includes(v) ? 'checked' : ''} onchange="etichetteScheda('${gid}','${v}',this.checked)"> ${l}</label>`).join('')}
      </div>
      <form class="config-add-row" style="margin:0;" onsubmit="event.preventDefault();pulsantiAdd('${gid}')">
        <input id="new-pulsante-${gid}" class="form-input" placeholder="Nuovo pulsante in ${escapeHtml(g.nome)}…" maxlength="30" aria-label="Nuovo pulsante in ${escapeHtml(g.nome)}">
        <button type="submit" class="btn btn-secondary btn-icon" aria-label="Aggiungi pulsante in ${escapeHtml(g.nome)}">${Icons.plus()}</button>
      </form>
      ${preview ? `<div class="pulsanti-preview" aria-label="Ordine nella lista ordini"><small>Nella lista ordini:</small>${preview}</div>` : ''}
      ${list.map((p, i) => card(p, i, list)).join('') || '<div class="settings-section-hint pulsanti-etichetta-vuota">Nessun pulsante: trascinane uno qui o sceglila come Etichetta di un pulsante.</div>'}
    </section>`;
  };
  return `
    <div class="settings-section-hint" style="margin:0;">Ogni etichetta è una colonna della lista ordini con i suoi pulsanti, nell'ordine scritto qui. Le lavorazioni interne ed esterne hanno già il loro pulsante (compare quando sono scelte nell'ordine). Vale per tutti gli utenti.</div>
    ${warn.map(w => `<div class="settings-section-hint" style="margin:0;color:var(--priority-urgent);font-weight:600;">⚠ ${escapeHtml(w)}</div>`).join('')}
    ${gruppi.map(group).join('')}
    <form class="config-add-row" onsubmit="event.preventDefault();etichetteAdd()">
      <input id="new-etichetta" class="form-input" placeholder="Nuova etichetta (es. Grafica, Controllo)" maxlength="30">
      <button type="submit" class="btn btn-secondary btn-icon" aria-label="Aggiungi etichetta">${Icons.plus()}</button>
    </form>
    <button type="button" class="btn btn-ghost btn-sm" style="align-self:flex-start;" onclick="pulsantiReset()">Ripristina pulsanti predefiniti</button>`;
}

// Pulsanti aperti nelle Impostazioni (chiusi di default, restano aperti tra un salvataggio e l'altro)
const PulsantiOpen = new Set();
function pulsantiToggleOpen(id) {
  if (PulsantiOpen.has(id)) PulsantiOpen.delete(id); else PulsantiOpen.add(id);
  renderSettingsDialog();
}

// Salva l'elenco completo (i pulsanti automatici diventano normali alla prima modifica)
async function pulsantiSave(list, msg, { reset = false } = {}) {
  const clean = reset ? list : Pulsanti.salvabili(list);
  try { await TCFactory.setSetting(PULSANTI_KEY, clean); if (msg) showToast(msg); }
  catch { showToast('Salvataggio non riuscito', 'error'); }
  renderSettingsDialog();
  renderApp();
}
function pulsantiSet(id, field, value) {
  if (field === 'nome' || field === 'intermedio') value = String(value).trim();
  pulsantiSave(Pulsanti.all().map(p => p.id === id ? { ...p, [field]: value } : p));
}
function pulsantiSetAlt(id, field, value) {
  pulsantiSave(Pulsanti.all().map(p => {
    if (p.id !== id) return p;
    const alt = { ...(p.alt || {}), [field]: String(value).trim() };
    return { ...p, alt: alt.nome || alt.seNon ? alt : null };
  }));
}
function pulsantiSetAbilita(id, field, value) {
  pulsantiSave(Pulsanti.all().map(p => {
    if (p.id !== id) return p;
    const abilita = { ...(p.abilita || {}), [field]: value };
    if (field === 'se' && !PULSANTI_ABILITA[value]?.pulsante) delete abilita.pulsante;
    return { ...p, abilita: abilita.se ? abilita : null };
  }));
}
// Trascina e rilascia (nella stessa colonna): il pulsante va prima o dopo quello su cui si rilascia
let pulsantiDragId = null;
function pulsantiDragStart(e, id) {
  pulsantiDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  const card = e.target.closest('.pulsante-cfg');
  if (card) { e.dataTransfer.setDragImage(card, 20, 20); card.classList.add('dragging'); }
}
function pulsantiDragEnd() {
  pulsantiDragId = null;
  document.querySelectorAll('.pulsante-cfg').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after'));
}
function pulsantiDropAfter(e, el) { const r = el.getBoundingClientRect(); return e.clientY > r.top + r.height / 2; }
function pulsantiDragOver(e, el) {
  const from = pulsantiDragId && Pulsanti.get(pulsantiDragId);
  if (!from || el.dataset.pid === pulsantiDragId) return;
  e.preventDefault();
  e.stopPropagation();
  const after = pulsantiDropAfter(e, el);
  el.classList.toggle('drop-after', after);
  el.classList.toggle('drop-before', !after);
}
function pulsantiDrop(e, el) {
  e.preventDefault();
  e.stopPropagation();
  const id = pulsantiDragId, target = el.dataset.pid, after = pulsantiDropAfter(e, el);
  pulsantiDragEnd();
  if (!id || id === target) return;
  const list = Pulsanti.all();
  const moved = list.find(p => p.id === id);
  if (!moved) return;
  // Rilasciato su un pulsante di un'altra etichetta: passa sotto quell'etichetta
  const rest = list.filter(p => p.id !== id);
  rest.splice(rest.findIndex(p => p.id === target) + (after ? 1 : 0), 0, { ...moved, colonna: el.dataset.col });
  pulsantiSave(rest);
}
// Rilasciato nello spazio di un'etichetta (anche vuota): va in fondo a quell'etichetta
function pulsantiDragOverGruppo(e, el) {
  if (!pulsantiDragId) return;
  e.preventDefault();
  el.classList.add('drop-into');
}
function pulsantiDropGruppo(e, el) {
  e.preventDefault();
  const id = pulsantiDragId;
  pulsantiDragEnd();
  el.classList.remove('drop-into');
  if (!id) return;
  const list = Pulsanti.all();
  const moved = list.find(p => p.id === id);
  if (!moved) return;
  pulsantiSave([...list.filter(p => p.id !== id), { ...moved, colonna: el.dataset.col }]);
}

// ── Etichette ──
async function etichetteSave(list, msg) {
  try { await TCFactory.setSetting(PULSANTI_ETICHETTE_KEY, list); if (msg) showToast(msg); }
  catch { showToast('Salvataggio non riuscito', 'error'); }
  renderSettingsDialog();
  renderApp();
}
function etichetteSet(id, field, value) {
  value = String(value).trim();
  if (field === 'nome' && !value) { renderSettingsDialog(); return; }
  etichetteSave(Pulsanti.gruppi().map(g => g.id === id ? { ...g, [field]: value } : g));
}
function etichetteScheda(id, scheda, on) {
  etichetteSave(Pulsanti.gruppi().map(g => {
    if (g.id !== id) return g;
    const schede = new Set(g.schede || Object.keys(PULSANTI_SCHEDE));
    if (on) schede.add(scheda); else schede.delete(scheda);
    return { ...g, schede: Object.keys(PULSANTI_SCHEDE).filter(v => schede.has(v)) };
  }));
}
function etichetteMove(id, dir) {
  const list = Pulsanti.gruppi();
  const i = list.findIndex(g => g.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  etichetteSave(list);
}
function etichetteAdd() {
  const nome = document.getElementById('new-etichetta')?.value.trim();
  if (!nome) return;
  etichetteSave([...Pulsanti.gruppi(), { id: 'e-' + Date.now().toString(36), nome, schede: Object.keys(PULSANTI_SCHEDE) }], `Aggiunta etichetta "${nome}"`);
}
async function etichetteDelete(id) {
  const list = Pulsanti.gruppi();
  const g = list.find(x => x.id === id);
  if (!g || list.length <= 1) return;
  const rest = list.filter(x => x.id !== id);
  const n = Pulsanti.all().filter(p => Pulsanti.gruppoDi(p) === id).length;
  if (!confirm(`Eliminare l'etichetta "${g.nome}"?${n ? `\n\nI suoi ${n} pulsanti passano sotto "${rest[0].nome}".` : ''}`)) return;
  // I pulsanti dell'etichetta passano alla prima rimasta
  if (n) {
    try { await TCFactory.setSetting(PULSANTI_KEY, Pulsanti.salvabili(Pulsanti.all().map(p => Pulsanti.gruppoDi(p) === id ? { ...p, colonna: rest[0].id } : p))); }
    catch { showToast('Salvataggio non riuscito', 'error'); return; }
  }
  etichetteSave(rest, 'Etichetta eliminata');
}

function pulsantiMove(id, dir) {
  const list = Pulsanti.all();
  const i = list.findIndex(p => p.id === id);
  const col = list[i] && Pulsanti.gruppoDi(list[i]);
  let j = i + dir;
  while (j >= 0 && j < list.length && Pulsanti.gruppoDi(list[j]) !== col) j += dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  pulsantiSave(list);
}
// Nuovo pulsante dal campo in cima alla sua etichetta
function pulsantiAdd(colonna) {
  const nome = document.getElementById('new-pulsante-' + colonna)?.value.trim();
  if (!nome) return;
  const id = 'p-' + Date.now().toString(36);
  PulsantiOpen.add(id);   // il pulsante appena creato si apre per sceglierne le regole
  pulsantiSave([...Pulsanti.all(), { id, nome, colonna, ruolo: 'nessuno', collegamento: '', mostra: 'sempre' }], `Aggiunto "${nome}"`);
}
function pulsantiDelete(id) {
  const p = Pulsanti.get(id);
  if (!p) return;
  const ruolo = p.ruolo && p.ruolo !== 'nessuno' ? `\n\nAttenzione: fa "${PULSANTI_RUOLI[p.ruolo]?.label}", senza di lui cambiano le schede in cui finiscono gli ordini.` : '';
  if (!confirm(`Eliminare il pulsante "${Pulsanti.nome(p)}"?\n\nLe spunte già date restano salvate negli ordini; si può riavere con "Ripristina pulsanti predefiniti".${ruolo}`)) return;
  // Pulsanti di base e delle lavorazioni restano come "eliminati", così il pulsante automatico non ricompare
  const segnaposto = PULSANTI_FISSI.has(id) || Pulsanti.link(p) ? [{ ...p, eliminato: true }] : [];
  pulsantiSave([...Pulsanti.all().filter(x => x.id !== id).map(x => x.alt?.seNon === id || x.abilita?.pulsante === id ? { ...x, alt: x.alt?.seNon === id ? null : x.alt, abilita: x.abilita?.pulsante === id ? null : x.abilita } : x), ...segnaposto], 'Pulsante eliminato');
}
function pulsantiReset() {
  if (!confirm('Ripristinare i pulsanti predefiniti (Merce, DTF, Pronto, Esterna, Parziale, Evaso)?\n\nI pulsanti creati a mano verranno tolti e quelli eliminati torneranno; le spunte negli ordini restano.')) return;
  pulsantiSave(PULSANTI_DEFAULT(), 'Pulsanti ripristinati', { reset: true });
}
