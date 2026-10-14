/**
 * T&C Factory — Pulsanti dell'ordine (Impostazioni → Pulsanti)
 * Tutti i pulsanti di avanzamento della lista ordini (Merce, DTF, Pronto, Parziale, Evaso,
 * le lavorazioni interne/esterne e quelli creati a mano) con le loro regole:
 *  - colonna:      'lavorazione' | 'spedizione'
 *  - ruolo:        cosa fa la spunta (vedi PULSANTI_RUOLI) → decide in che scheda sta l'ordine
 *  - collegamento: dove si salva la spunta ('' = fase propria; 'dtf' = DTF interno;
 *                  'interne:<id>' / 'esterne:<id>' = scheda Interne / tipo Esterne; 'esterne:*' = Esterna generica)
 *  - mostra:       quando compare sull'ordine (vedi PULSANTI_MOSTRA)
 *  - alt:          etichetta alternativa { nome, seNon: <id pulsante> }
 *  - attivo:       false = nascosto ovunque
 * Le lavorazioni interne/esterne delle Impostazioni hanno un pulsante automatico
 * (id "lav-<id>") finché non se ne modifica uno: da lì viene salvato con gli altri.
 */

const PULSANTI_KEY = 'pulsanti_ordine';

const PULSANTI_RUOLI = {
  nessuno:      { label: 'Solo spunta',                  hint: 'Segna la fase con la data, senza spostare l\'ordine' },
  obbligatorio: { label: 'Obbligatorio per l\'evasione', hint: 'Se manca, l\'ordine chiuso va in Parziali invece che in Evasione' },
  chiude:       { label: 'Chiude la lavorazione',        hint: 'Spuntato, l\'ordine esce da Attivi e va in Evasione (o in Parziali)' },
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

const PULSANTI_DEFAULT = () => [
  { id: 'merceCompleta',       nome: 'Merce',    colonna: 'lavorazione', ruolo: 'obbligatorio', collegamento: '',          mostra: 'sempre' },
  { id: 'dtfPronti',           nome: 'DTF',      colonna: 'lavorazione', ruolo: 'nessuno',      collegamento: 'dtf',       mostra: 'sempre' },
  { id: 'ordineStampato',      nome: 'Pronto',   colonna: 'lavorazione', ruolo: 'chiude',       collegamento: '',          mostra: 'sempre', alt: { nome: 'Parziale', seNon: 'merceCompleta' } },
  { id: 'lavorazioneEsterna',  nome: 'Esterna',  colonna: 'lavorazione', ruolo: 'nessuno',      collegamento: 'esterne:*', mostra: 'esterna-senza-tipo' },
  { id: 'speditoParzialmente', nome: 'Parziale', colonna: 'spedizione',  ruolo: 'parziale',     collegamento: '',          mostra: 'sempre' },
  { id: 'spedito',             nome: 'Evaso',    colonna: 'spedizione',  ruolo: 'evade',        collegamento: '',          mostra: 'sempre' },
];
const PULSANTI_FISSI = new Set(PULSANTI_DEFAULT().map(p => p.id));

const Pulsanti = {
  // ── Configurazione ──
  config() {
    const v = TCFactory._settings[PULSANTI_KEY];
    return Array.isArray(v) ? v.filter(p => p && p.id) : PULSANTI_DEFAULT();
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
  all() {
    const conf = this.config();
    const linked = new Set(conf.map(p => this.linkKey(p)).filter(Boolean));
    const dtf = this.dtfLavId();
    const auto = ['interne', 'esterne'].flatMap(kind => getLav(kind)
      .filter(l => !(kind === 'interne' && l.id === dtf) && !linked.has(`${kind}:${l.id}`))
      .map(l => ({ id: `lav-${l.id}`, nome: '', colonna: 'lavorazione', ruolo: 'nessuno', collegamento: `${kind}:${l.id}`, mostra: 'selezionata', auto: true })));
    return [...conf, ...auto];
  },
  get(id) { return this.all().find(p => p.id === id) || null; },
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
  visibili(o, colonna) { return this.all().filter(p => (!colonna || p.colonna === colonna) && this.visibile(o, p)); },
  // Fase dell'ordine dove si salva la spunta (null = collegato a una lavorazione)
  stageId(p) {
    if (!p.collegamento) return p.id;
    if (p.collegamento === 'dtf') return 'dtfPronti';
    if (p.collegamento === 'esterne:*') return 'lavorazioneEsterna';
    return null;
  },
  stato(o, p) {
    const sid = this.stageId(p);
    let v;
    if (sid) { const st = o.stages?.[sid]; v = st?.done ? (st.date || true) : null; }
    else { const l = this.link(p); v = lavTipoDone(o, l.kind, l.id); }
    return { done: !!v, date: typeof v === 'string' ? v : null };
  },
  etichetta(o, p) {
    const cond = p.alt?.nome && p.alt.seNon ? this.get(p.alt.seNon) : null;
    return cond && this.visibile(o, cond) && !this.stato(o, cond).done ? p.alt.nome : this.nome(p);
  },
  _ruolo(o, ruolo) { return this.visibili(o).filter(p => p.ruolo === ruolo); },
  // Lavorazione chiusa: tutti i pulsanti "chiude" spuntati
  chiusa(o) { const l = this._ruolo(o, 'chiude'); return l.length > 0 && l.every(p => this.stato(o, p).done); },
  obbligatoriOk(o) { return this._ruolo(o, 'obbligatorio').every(p => this.stato(o, p).done); },
  isEvaso(o) { const l = this._ruolo(o, 'evade'); return l.length > 0 && l.every(p => this.stato(o, p).done); },
  // Data con cui è stata chiusa la lavorazione (per la vista Evasione)
  dataChiusura(o) { return this._ruolo(o, 'chiude').map(p => this.stato(o, p).date).filter(Boolean).sort().pop() || null; },
  nomeChiusura() { const p = this.all().find(x => x.ruolo === 'chiude' && x.attivo !== false); return p ? this.nome(p) : 'Lavorazione'; },

  // Salva la spunta di un pulsante (senza effetti sulle schede)
  async set(orderId, p, done) {
    const sid = this.stageId(p);
    if (sid) return TCFactory.setStage(orderId, sid, done, this.nome(p));
    const l = this.link(p);
    return setLavTipo(orderId, l.kind, l.id, done);
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
    return `<div class="stage-cell">
      <button class="stage-pill ${colonna === 'spedizione' ? 'evasione' : ''} ${st.done ? 'done' : ''}"
        onclick="event.stopPropagation();pulsanteToggle('${o.id}','${escapeHtml(p.id)}',${!st.done})"
        title="${escapeHtml(Pulsanti.nome(p))}${st.done ? ' — fatto' : ''}">${escapeHtml(Pulsanti.etichetta(o, p))}</button>
      <span class="pill-date">${st.date ? TCFactory.formatDate(st.date, { day: '2-digit', month: '2-digit' }) : ''}</span>
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
    const removable = !PULSANTI_FISSI.has(p.id) && !p.auto && (p.id.startsWith('p-') || Pulsanti.orfano(p));
    const open = PulsantiOpen.has(p.id);
    const pid = escapeHtml(p.id);
    const sommario = [PULSANTI_RUOLI[p.ruolo || 'nessuno']?.label, p.collegamento ? 'collegato' : '', p.mostra && p.mostra !== 'sempre' ? 'condizionale' : '']
      .filter(Boolean).join(' · ');
    return `
    <div class="pulsante-cfg ${p.attivo === false ? 'off' : ''} ${open ? 'open' : ''}">
      <div class="pulsante-cfg-head">
        <div class="reorder-arrows">
          <button type="button" ${i === 0 ? 'disabled' : ''} onclick="pulsantiMove('${escapeHtml(p.id)}',-1)" aria-label="Sposta su">${Icons.arrowUp()}</button>
          <button type="button" ${i === list.length - 1 ? 'disabled' : ''} onclick="pulsantiMove('${escapeHtml(p.id)}',1)" aria-label="Sposta giù">${Icons.arrowDown()}</button>
        </div>
        <span class="stage-pill ${p.colonna === 'spedizione' ? 'evasione' : ''}" aria-hidden="true">${escapeHtml(Pulsanti.nome(p))}</span>
        <button type="button" class="pulsante-cfg-toggle" aria-expanded="${open}" aria-controls="pcfg-${pid}" onclick="pulsantiToggleOpen('${pid}')">
          <small>${escapeHtml(sommario)}</small>
          <svg class="settings-block-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <label class="check-inline" title="Mostra il pulsante"><input type="checkbox" ${p.attivo !== false ? 'checked' : ''} onchange="pulsantiSet('${escapeHtml(p.id)}','attivo',this.checked)"> Attivo</label>
        ${removable ? `<button type="button" class="btn-icon" style="color:var(--priority-urgent);" onclick="pulsantiDelete('${escapeHtml(p.id)}')" aria-label="Elimina pulsante">${Icons.trash(15)}</button>` : ''}
      </div>
      ${Pulsanti.orfano(p) ? `<div class="settings-section-hint" style="margin:0;color:var(--priority-urgent);">La lavorazione collegata è stata eliminata: il pulsante non compare.</div>` : ''}
      <div class="pulsante-cfg-grid" id="pcfg-${pid}" ${open ? '' : 'hidden'}>
        <label>Nome</label>
        <input class="form-input" value="${escapeHtml(p.nome || '')}" placeholder="${escapeHtml(Pulsanti.nome(p))}" maxlength="30" aria-label="Nome del pulsante"
          onchange="pulsantiSet('${pid}','nome',this.value)">
        <label>Colonna</label>${sel(p, 'colonna', opt({ lavorazione: 'Lavorazione', spedizione: 'Spedizione / Evasione' }, p.colonna))}
        <label>Cosa fa</label>${sel(p, 'ruolo', opt(PULSANTI_RUOLI, p.ruolo || 'nessuno'))}
        <small class="pulsante-cfg-hint">${escapeHtml(PULSANTI_RUOLI[p.ruolo || 'nessuno']?.hint || '')}</small>
        <label>Collegato a</label>${sel(p, 'collegamento', pulsantiCollegamentiOptions(p))}
        <small class="pulsante-cfg-hint">${p.collegamento ? 'La spunta è la stessa della scheda Interne / Esterne collegata' : 'La spunta vale solo per questo pulsante'}</small>
        <label>Quando compare</label>${sel(p, 'mostra', opt(PULSANTI_MOSTRA, p.mostra || 'sempre'))}
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
      </div>
    </div>`;
  };
  const group = (colonna, title) => {
    const list = all.filter(p => p.colonna === colonna);
    return `<div style="font-size:0.8rem;font-weight:700;margin-top:4px;">${title}</div>
      ${list.map((p, i) => card(p, i, list)).join('') || '<div class="settings-section-hint" style="margin:0;">Nessun pulsante.</div>'}`;
  };
  return `
    <div class="settings-section-hint" style="margin:0;">I pulsanti delle colonne Lavorazione e Spedizione della lista ordini. Le lavorazioni interne ed esterne hanno già il loro pulsante (compare quando sono scelte nell'ordine). Vale per tutti gli utenti.</div>
    ${warn.map(w => `<div class="settings-section-hint" style="margin:0;color:var(--priority-urgent);font-weight:600;">⚠ ${escapeHtml(w)}</div>`).join('')}
    ${group('lavorazione', 'Lavorazione')}
    ${group('spedizione', 'Spedizione / Evasione')}
    <form class="config-add-row" onsubmit="event.preventDefault();pulsantiAdd()">
      <input id="new-pulsante" class="form-input" placeholder="Nuovo pulsante (es. Controllo qualità)" maxlength="30">
      <select id="new-pulsante-col" class="form-select" aria-label="Colonna" style="max-width:150px;">
        <option value="lavorazione">Lavorazione</option><option value="spedizione">Spedizione</option>
      </select>
      <button type="submit" class="btn btn-secondary btn-icon" aria-label="Aggiungi pulsante">${Icons.plus()}</button>
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
async function pulsantiSave(list, msg) {
  const clean = list.map(({ auto, ...p }) => p);
  try { await TCFactory.setSetting(PULSANTI_KEY, clean); if (msg) showToast(msg); }
  catch { showToast('Salvataggio non riuscito', 'error'); }
  renderSettingsDialog();
  renderApp();
}
function pulsantiSet(id, field, value) {
  if (field === 'nome') value = String(value).trim();
  pulsantiSave(Pulsanti.all().map(p => p.id === id ? { ...p, [field]: value } : p));
}
function pulsantiSetAlt(id, field, value) {
  pulsantiSave(Pulsanti.all().map(p => {
    if (p.id !== id) return p;
    const alt = { ...(p.alt || {}), [field]: String(value).trim() };
    return { ...p, alt: alt.nome || alt.seNon ? alt : null };
  }));
}
function pulsantiMove(id, dir) {
  const list = Pulsanti.all();
  const i = list.findIndex(p => p.id === id);
  const col = list[i]?.colonna;
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].colonna !== col) j += dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  pulsantiSave(list);
}
function pulsantiAdd() {
  const nome = document.getElementById('new-pulsante')?.value.trim();
  if (!nome) return;
  const colonna = document.getElementById('new-pulsante-col')?.value || 'lavorazione';
  const id = 'p-' + Date.now().toString(36);
  PulsantiOpen.add(id);   // il pulsante appena creato si apre per sceglierne le regole
  pulsantiSave([...Pulsanti.all(), { id, nome, colonna, ruolo: 'nessuno', collegamento: '', mostra: 'sempre' }], `Aggiunto "${nome}"`);
}
function pulsantiDelete(id) {
  const p = Pulsanti.get(id);
  if (!p || !confirm(`Eliminare il pulsante "${Pulsanti.nome(p)}"?\n\nLe spunte già date restano salvate negli ordini.`)) return;
  pulsantiSave(Pulsanti.all().filter(x => x.id !== id).map(x => x.alt?.seNon === id ? { ...x, alt: null } : x), 'Pulsante eliminato');
}
function pulsantiReset() {
  if (!confirm('Ripristinare i pulsanti predefiniti (Merce, DTF, Pronto, Esterna, Parziale, Evaso)?\n\nI pulsanti creati a mano verranno tolti; le spunte negli ordini restano.')) return;
  pulsantiSave(PULSANTI_DEFAULT(), 'Pulsanti ripristinati');
}
