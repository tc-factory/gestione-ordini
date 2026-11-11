/**
 * T&C Factory — Mail
 * Le mail di tutte le caselle dei negozi (lette da mail-sync ogni 5 minuti), divise in conversazioni:
 * a sinistra l'elenco, a destra la conversazione aperta con la risposta.
 *
 *  • Cartelle: In arrivo, Archivio, Cestino. Spostare una conversazione la sposta anche sulla casella
 *    Aruba (edge function mail-azioni); in automatico lo spam va nel Cestino e le mail automatiche in Archivio.
 *  • Allegati: si scaricano al momento dalla casella (mail-azioni, azione 'allegato').
 *  • Firme: una per persona e per casella (mail_firme); senza firma salvata vale quella automatica.
 *  • Modelli: mail di richiesta pronte (mail_modelli), riempite con i dati dell'ordine.
 *
 * Dati: funzioni tc_mail_* (sql/mail-sezione.sql, sql/mail-archivio-firme-modelli.sql).
 * Invio: edge function mail-send (mail_id per le risposte, nuova per le mail nuove).
 * Lo stato "letta" è condiviso dal team: aprire una conversazione la segna letta per tutti.
 */

const MAIL_POLL_MS = 60000;
const MAIL_PAGINA = 50;
const MAIL_VISTE = [
  ['arrivo', 'In arrivo'],
  ['da_leggere', 'Da leggere'],
  ['inviate', 'Inviate'],
  ['archivio', 'Archivio'],
  ['cestino', 'Cestino'],
];

const MailBox = {
  caselle: [],
  fili: [],
  casella: null,          // null = tutte
  vista: 'arrivo',
  cerca: '',
  altre: false,           // ci sono altre conversazioni da caricare
  aperto: null,           // { casella_id, filo }
  conversazione: null,    // { messaggi, tasks }
  bozza: '',
  bozzaDi: null,          // chiave della conversazione a cui appartiene la bozza
  ordini: [],             // ordini del cliente della conversazione aperta (per i modelli)
  ordine: null,           // ordine scelto per riempire i modelli
  invio: false,
  caricamento: false,
  errore: null,
  badge: 0,
  _timer: null,
  _cercaTimer: null,
  _gen: 0,                // scarta le risposte arrivate dopo un cambio di filtro

  async _rpc(fn, args = {}) {
    const { data, error } = await supabaseClient.rpc(fn, args);
    if (error) {
      if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message)) {
        throw Object.assign(new Error('Sezione Mail da aggiornare: esegui gli script sql/mail-*.sql'), { notInstalled: true });
      }
      throw new Error('Errore di connessione');
    }
    if (data && data.success === false) throw new Error(data.error || 'Operazione non riuscita');
    return data;
  },

  chiave(f) { return f ? `${f.casella_id}|${f.filo}` : ''; },

  async loadCaselle() {
    const r = await this._rpc('tc_mail_caselle');
    this.caselle = r.caselle || [];
  },

  async loadLista({ altre = false } = {}) {
    const gen = ++this._gen;
    const prima = altre && this.fili.length ? this.fili[this.fili.length - 1].ultima_at : null;
    const r = await this._rpc('tc_mail_lista', {
      p_casella: this.casella, p_vista: this.vista, p_cerca: this.cerca || null, p_prima: prima, p_limite: MAIL_PAGINA,
    });
    if (gen !== this._gen) return false;
    const nuovi = r.fili || [];
    this.fili = altre ? [...this.fili, ...nuovi] : nuovi;
    this.altre = nuovi.length === MAIL_PAGINA;
    return true;
  },

  async load() {
    this.caricamento = true;
    try {
      await Promise.all([this.loadCaselle(), this.loadLista(), MailFirme.load(), MailModelli.load()]);
      this.errore = null;
    } catch (e) { this.errore = e; }
    this.caricamento = false;
  },

  async loadBadge() {
    if (!Nav.isAllowed('mail')) return;
    const { data, error } = await supabaseClient.rpc('tc_mail_badge');
    const n = error ? 0 : (data || 0);
    if (n !== this.badge) { this.badge = n; renderSidebar(); }
  },

  start() {
    MailFirme.load();   // le firme servono anche alle risposte del Centro di controllo
    if (!Nav.isAllowed('mail')) return;
    this.loadBadge();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.poll(), MAIL_POLL_MS);
  },

  stop() {
    clearInterval(this._timer);
    Object.assign(this, { caselle: [], fili: [], aperto: null, conversazione: null, bozza: '', bozzaDi: null, ordini: [], ordine: null, badge: 0, errore: null });
    Object.assign(MailFirme, { firme: {}, caricate: false });
  },

  // Ogni minuto: il numero nella navbar sempre, l'elenco solo con la pagina aperta (senza toccare la risposta in scrittura)
  async poll() {
    if (document.hidden) return;
    await this.loadBadge();
    if (Nav.current !== 'mail' || this.caricamento || this.invio) return;
    try {
      const prima = JSON.stringify(this.fili);
      await this.loadCaselle();
      if (await this.loadLista() && JSON.stringify(this.fili) !== prima) renderMailList();
      renderMailBoxes();
    } catch { /* riprova al giro dopo */ }
  },

  // Dopo uno spostamento: mail-azioni lo porta subito su Aruba (se non riesce, ci riprova il cron)
  spostaSuAruba(casellaId) {
    supabaseClient.functions.invoke('mail-azioni', { body: { azione: 'sposta', casella: casellaId } }).catch(() => {});
  },
};

window.MailBox = MailBox;

const mailCasella = (id) => MailBox.caselle.find(c => c.id === id) || MailFirme.caselle.find(c => c.id === id);
const mailColore = (id) => taskMacro(id)?.color || '#94a3b8';
const mailNomeCasella = (id) => taskMacro(id)?.label || mailCasella(id)?.nome || id;

// Data breve nell'elenco: ora se oggi, "ieri", altrimenti giorno e mese
function mailFmtData(iso) {
  const g = ctrlGiornoDi(iso), oggi = ctrlOggi();
  if (g === oggi) return ctrlFmtOra(iso);
  if (g === ctrlAddDays(oggi, -1)) return 'Ieri';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(g.slice(0, 4) !== oggi.slice(0, 4) ? { year: 'numeric' } : {}) });
}

const mailFmtSize = (b) => !b ? '' : b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace('.', ',')} MB`;

// ─────────────────────────────────────────────
// FIRME
// Una per persona e per casella. Senza firma salvata vale quella automatica: nome, negozio, sito.
// Nelle bozze del cervello (che finiscono col nome del negozio) la firma prende il posto di quella riga.
// ─────────────────────────────────────────────

const MailFirme = {
  firme: {},          // casella_id → testo salvato
  caselle: [],        // per le firme automatiche anche fuori dalla pagina Mail
  caricate: false,

  async load() {
    if (!TCAuth.isLoggedIn()) return;
    const [f, c] = await Promise.all([
      supabaseClient.from('mail_firme').select('casella_id, testo'),
      this.caselle.length ? null : supabaseClient.rpc('tc_mail_caselle'),
    ]);
    if (!f.error) this.firme = Object.fromEntries((f.data || []).map(r => [r.casella_id, r.testo]));
    if (c?.data?.caselle) this.caselle = c.data.caselle;
    this.caricate = true;
  },

  automatica(casellaId) {
    const c = this.caselle.find(x => x.id === casellaId) || MailBox.caselle.find(x => x.id === casellaId);
    const nick = TCAuth.getNickname();
    const nome = nick.charAt(0).toUpperCase() + nick.slice(1);
    const negozio = c?.nome || taskMacro(casellaId)?.label || '';
    const sito = c?.indirizzo ? `www.${c.indirizzo.split('@')[1]}` : '';
    return [nome, negozio, sito].filter(Boolean).join('\n');
  },

  di(casellaId) { return (this.firme[casellaId] ?? this.automatica(casellaId)).trim(); },

  // Testo con la firma in fondo: sostituisce il nome del negozio messo dal cervello, non la ripete se c'è già
  applica(testo, casellaId) {
    const firma = casellaId ? this.di(casellaId) : '';
    let t = (testo || '').replace(/\s+$/, '');
    if (!firma) return t;
    if (t.endsWith(firma)) return t;
    if (!t) return `\n\n${firma}`;
    const c = this.caselle.find(x => x.id === casellaId) || MailBox.caselle.find(x => x.id === casellaId);
    const negozi = [c?.nome, taskMacro(casellaId)?.label].filter(Boolean).map(s => s.toLowerCase());
    const righe = t.split('\n');
    if (negozi.includes(righe[righe.length - 1].trim().toLowerCase())) {
      righe[righe.length - 1] = firma;
      return righe.join('\n');
    }
    return t + (/[,:]$/.test(t) ? '\n' : '\n\n') + firma;
  },
};
window.MailFirme = MailFirme;

function openMailFirme() {
  const caselle = MailBox.caselle.length ? MailBox.caselle : MailFirme.caselle;
  const modal = document.getElementById('mail-modal');
  modal.innerHTML = `
    <div class="modal mail-dialog" role="dialog" aria-modal="true" aria-labelledby="mf-title">
      <div class="modal-header">
        <h2 id="mf-title">La mia firma</h2>
        <button class="btn-icon" onclick="closeModal('mail-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body mail-form" onsubmit="event.preventDefault();saveMailFirme()">
        <p class="mail-form-hint">Va in fondo a ogni mail che scrivi da quella casella, anche nelle risposte del Centro di controllo. Lasciata com'è, resta la firma automatica.</p>
        ${caselle.map(c => `
          <div class="form-group">
            <label class="form-label mail-firma-label" for="mf-${c.id}"><i class="ctrl-dot" style="--m:${mailColore(c.id)};" aria-hidden="true"></i>${escapeHtml(mailNomeCasella(c.id))} <span>${escapeHtml(c.indirizzo)}</span></label>
            <textarea id="mf-${c.id}" class="form-textarea" rows="3" maxlength="2000" data-casella="${c.id}">${escapeHtml(MailFirme.di(c.id))}</textarea>
          </div>`).join('')}
        <div class="mail-form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal('mail-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="mf-save">Salva firme</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('mail-modal'); };
}

async function saveMailFirme() {
  const btn = document.getElementById('mf-save');
  btn.disabled = true;
  const me = TCAuth.getNickname();
  const salva = [], togli = [];
  document.querySelectorAll('#mail-modal textarea[data-casella]').forEach(t => {
    const id = t.dataset.casella, testo = t.value.trim();
    // Uguale a quella automatica (o vuota): non si salva, così segue il nome se cambia
    if (!testo || testo === MailFirme.automatica(id)) togli.push(id);
    else salva.push({ nickname: me, casella_id: id, testo, aggiornato_at: new Date().toISOString() });
  });
  try {
    if (salva.length) { const { error } = await supabaseClient.from('mail_firme').upsert(salva); if (error) throw error; }
    if (togli.length) { const { error } = await supabaseClient.from('mail_firme').delete().eq('nickname', me).in('casella_id', togli); if (error) throw error; }
    await MailFirme.load();
    closeModal('mail-modal');
    showToast('Firme salvate');
  } catch {
    showToast('Firme non salvate: errore di connessione', 'error');
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────
// MODELLI
// Dati tra graffe; una riga con un dato che manca non si scrive, senza nome resta "Ciao,".
// ─────────────────────────────────────────────

const MAIL_DATI = {
  nome: 'Nome del cliente', ordine: 'Numero d\'ordine', data_ordine: 'Data dell\'ordine', prodotti: 'Prodotti dell\'ordine',
  indirizzo: 'Indirizzo di spedizione', telefono: 'Telefono', totale: 'Totale dell\'ordine', negozio: 'Nome del negozio',
};

const MailModelli = {
  lista: [],
  async load() {
    const { data, error } = await supabaseClient.from('mail_modelli').select('*').order('ordine').order('titolo');
    if (!error) this.lista = data || [];
  },
  attivi() { return this.lista.filter(m => m.attivo); },
  get(id) { return this.lista.find(m => m.id === id); },
};

// Dati dell'ordine (e del cliente) per i modelli
function mailDati(o, casellaId, nomeCliente) {
  const nomePieno = (o?.indirizzo?.nome || o?.cliente || nomeCliente || '').trim();
  const nome = nomePieno && !/@/.test(nomePieno) ? nomePieno.split(/\s+/)[0] : '';
  const ind = o?.indirizzo;
  const indirizzo = ind?.via ? `${ind.via}${ind.cap || ind.citta ? `, ${[ind.cap, ind.citta].filter(Boolean).join(' ')}` : ''}${ind.provincia ? ` (${ind.provincia})` : ''}` : '';
  const prodotti = (o?.righe || []).map(r => `${r.titolo}${r.variante ? ` (${r.variante})` : ''}${r.qnt > 1 ? ` × ${r.qnt}` : ''}`).join(', ');
  const totale = o?.totale != null ? Number(o.totale).toLocaleString('it-IT', { style: 'currency', currency: o.valuta || 'EUR' }) : '';
  return {
    nome: nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : '',
    ordine: o?.numero || '',
    data_ordine: o?.creato_at ? new Date(o.creato_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : '',
    prodotti, indirizzo, telefono: o?.telefono || '', totale,
    negozio: mailNomeCasella(casellaId),
  };
}

function mailRiempi(testo, dati) {
  const righe = (testo || '').split('\n').flatMap(riga => {
    const mancanti = [...riga.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => !dati[k]);
    if (mancanti.some(k => k !== 'nome')) return [];
    return [riga.replace(/ ?\{nome\}/g, (m) => dati.nome ? m.replace('{nome}', dati.nome) : '').replace(/\{([a-z_]+)\}/g, (_, k) => dati[k] || '')];
  });
  return righe.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function mailRiempiOggetto(oggetto, dati, riserva) {
  const pezzi = (oggetto || '').split(' – ').filter(p => [...p.matchAll(/\{([a-z_]+)\}/g)].every(m => dati[m[1]]));
  return pezzi.map(p => p.replace(/\{([a-z_]+)\}/g, (_, k) => dati[k])).join(' – ') || riserva || '';
}

function mailModelliChips(onclick) {
  const m = MailModelli.attivi();
  if (!m.length) return '';
  return `<div class="mail-modelli" role="group" aria-label="Modelli">
    <span>Modelli</span>
    ${m.map(x => `<button type="button" class="mail-chip" onclick="${onclick}('${x.id}')">${escapeHtml(x.titolo)}</button>`).join('')}
  </div>`;
}

// Elenco ordini da scegliere (risposta e mail nuova)
function mailOrdineOpzione(o, scelto, onclick) {
  const pag = o.stato_pagamento && o.stato_pagamento !== 'PAID' ? ` · ${o.stato_pagamento === 'PENDING' ? 'da pagare' : o.stato_pagamento.toLowerCase()}` : '';
  return `<button type="button" class="mail-ordine ${scelto ? 'is-on' : ''}" aria-pressed="${scelto}" onclick="${onclick}('${o.id}')">
    <strong>${escapeHtml(o.numero)}</strong>
    <span>${escapeHtml(o.cliente || o.email || '')} · ${new Date(o.creato_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${pag}</span>
  </button>`;
}

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

async function openMailPage() {
  renderMailPage();
  await MailBox.load();
  renderMailPage();
  renderHeader();
  MailBox.loadBadge();
}

function renderMailPage() {
  const root = document.getElementById('mail-root');
  if (!root) return;
  if (MailBox.errore?.notInstalled) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.mail(28)}</div>
        <h2>Sezione Mail da aggiornare</h2>
        <p>Esegui gli script <strong>sql/mail-sezione.sql</strong> e <strong>sql/mail-archivio-firme-modelli.sql</strong> su Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }
  if (!root.querySelector('.mail-page')) {
    root.innerHTML = `
      <div class="mail-page ${MailBox.aperto ? 'is-reading' : ''}">
        <div class="mail-boxes" id="mail-boxes"></div>
        <div class="mail-panes">
          <section class="glass-card mail-list-pane" aria-label="Conversazioni">
            <div class="mail-list-head">
              <div class="segmented" role="tablist" aria-label="Cartella">
                ${MAIL_VISTE.map(([id, label]) => `<button type="button" role="tab" data-vista="${id}" onclick="setMailVista('${id}')">${label}</button>`).join('')}
              </div>
              <div class="search-box mail-search">
                ${Icons.search()}
                <input type="search" id="mail-cerca" placeholder="Cerca mittente, oggetto o testo…" aria-label="Cerca nelle mail"
                  value="${escapeHtml(MailBox.cerca)}" oninput="setMailCerca(this.value)">
              </div>
            </div>
            <div class="mail-list" id="mail-list" aria-live="polite"></div>
          </section>
          <section class="glass-card mail-read-pane" id="mail-read" aria-label="Conversazione"></section>
        </div>
      </div>`;
  }
  renderMailBoxes();
  renderMailList();
  renderMailReader();
}

function renderMailBoxes() {
  const box = document.getElementById('mail-boxes');
  if (!box) return;
  const tot = MailBox.caselle.reduce((n, c) => n + (c.non_lette || 0), 0);
  const chip = (id, label, n, color) => {
    const on = MailBox.casella === id;
    return `<button type="button" class="ctrl-filter ${on ? 'is-on' : ''}" aria-pressed="${on}" style="--m:${color || 'var(--text-primary)'};"
      onclick="setMailCasella(${id ? `'${id}'` : 'null'})" ${n ? `title="${n} conversazioni da leggere"` : ''}>
      ${color ? '<i aria-hidden="true"></i>' : ''}<span>${escapeHtml(label)}</span>${n ? `<b>${n}</b>` : ''}</button>`;
  };
  const errori = MailBox.caselle.filter(c => c.ultimo_errore);
  box.innerHTML = `
    <div class="ctrl-macro-bar" role="group" aria-label="Casella">
      ${chip(null, 'Tutte le caselle', tot)}
      ${MailBox.caselle.map(c => chip(c.id, mailNomeCasella(c.id), c.non_lette, mailColore(c.id))).join('')}
    </div>
    ${errori.length ? `<div class="mail-warn" role="status">${errori.map(c => `${escapeHtml(c.indirizzo)}: ultima lettura non riuscita (${escapeHtml(c.ultimo_errore.slice(0, 120))})`).join('<br>')}</div>` : ''}`;
  document.querySelectorAll('.mail-list-head [data-vista]').forEach(b => {
    const on = b.dataset.vista === MailBox.vista;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
}

function renderMailList() {
  const list = document.getElementById('mail-list');
  if (!list) return;
  if (MailBox.caricamento && !MailBox.fili.length) { list.innerHTML = `<div class="empty-list">Caricamento…</div>`; return; }
  if (MailBox.errore) { list.innerHTML = `<div class="empty-list">${escapeHtml(MailBox.errore.message)}</div>`; return; }
  if (!MailBox.fili.length) {
    const vuoti = { da_leggere: 'Nessuna mail da leggere.', archivio: 'Archivio vuoto.', cestino: 'Cestino vuoto.', inviate: 'Nessuna mail inviata.' };
    list.innerHTML = `<div class="empty-list">${MailBox.cerca ? 'Nessuna mail trovata.' : vuoti[MailBox.vista] || 'Nessuna mail.'}</div>`;
    return;
  }
  const aperto = MailBox.chiave(MailBox.aperto);
  const tutte = !MailBox.casella;
  const nota = MailBox.vista === 'cestino' ? `<p class="mail-list-note">Lo spam riconosciuto arriva qui da solo. Le mail restano nel cestino della casella Aruba, da dove si possono recuperare.</p>`
    : MailBox.vista === 'archivio' ? `<p class="mail-list-note">Le mail automatiche (notifiche, newsletter, avvisi) arrivano qui da sole.</p>` : '';
  list.innerHTML = nota + MailBox.fili.map((f, i) => {
    const k = MailBox.chiave(f);
    return `
    <button type="button" class="mail-row ${f.non_lette && ['arrivo', 'da_leggere'].includes(MailBox.vista) ? 'is-unread' : ''} ${k === aperto ? 'is-open' : ''}"
      onclick="openMailThread(${i})" ${k === aperto ? 'aria-current="true"' : ''}>
      <span class="mail-row-top">
        ${tutte ? `<i class="ctrl-dot" style="--m:${mailColore(f.casella_id)};" title="${escapeHtml(mailNomeCasella(f.casella_id))}" aria-label="${escapeHtml(mailNomeCasella(f.casella_id))}"></i>` : ''}
        <strong class="mail-row-who">${escapeHtml(f.persona || f.email || 'Mittente sconosciuto')}</strong>
        ${f.messaggi > 1 ? `<span class="mail-row-count" aria-label="${f.messaggi} messaggi">${f.messaggi}</span>` : ''}
        <span class="mail-row-date">${mailFmtData(f.ultima_at)}</span>
      </span>
      <span class="mail-row-subj">${f.ultima_out ? `<span class="mail-row-replied" title="Ultimo messaggio: nostra mail">${Icons.reply(12)}</span>` : ''}${escapeHtml(f.oggetto || '(senza oggetto)')}${f.allegati ? ` <span class="mail-row-clip" aria-label="${f.allegati} allegati">${Icons.paperclip(11)}</span>` : ''}</span>
      ${f.anteprima ? `<span class="mail-row-prev">${escapeHtml(f.anteprima)}</span>` : ''}
    </button>`;
  }).join('') + (MailBox.altre ? `<div class="mail-more"><button type="button" class="btn btn-secondary btn-sm" onclick="loadMoreMail(this)">Carica le precedenti</button></div>` : '');
}

// ─────────────────────────────────────────────
// CONVERSAZIONE APERTA
// ─────────────────────────────────────────────

const MAIL_STATI_TASK = { da_fare: 'Da fare', in_corso: 'In corso', in_pausa: 'In pausa', rimandato: 'Rimandato', completato: 'Completato', non_completato: 'Non completato' };
const MAIL_CARTELLE = { inbox: 'In arrivo', archivio: 'Archivio', cestino: 'Cestino' };

// Cartella della conversazione: quella delle mail ricevute più recenti
function mailCartellaFilo(c) {
  const ricevute = (c?.messaggi || []).filter(m => m.direzione === 'in');
  return ricevute.length ? ricevute[ricevute.length - 1].cartella : null;
}

function renderMailReader() {
  const pane = document.getElementById('mail-read');
  if (!pane) return;
  document.querySelector('.mail-page')?.classList.toggle('is-reading', !!MailBox.aperto);
  if (!MailBox.aperto) {
    pane.innerHTML = `
      <div class="mail-read-empty">
        <span aria-hidden="true">${Icons.mail(30)}</span>
        <p>Scegli una conversazione per leggerla e rispondere.</p>
        <small>Le mail arrivano ogni 5 minuti dalle caselle Aruba, dal giorno in cui sono state collegate.</small>
      </div>`;
    return;
  }
  const f = MailBox.fili.find(x => MailBox.chiave(x) === MailBox.chiave(MailBox.aperto)) || MailBox.aperto;
  const c = MailBox.conversazione;
  const casella = mailCasella(f.casella_id);
  const cartella = mailCartellaFilo(c);
  const azione = (dest, label, icon, cls = 'btn-ghost') => `<button type="button" class="btn ${cls} btn-sm" onclick="moveMailThread('${dest}')">${icon} <span>${label}</span></button>`;
  const azioni = !c ? '' : !cartella ? '' : `
    ${cartella !== 'inbox' ? azione('inbox', 'Sposta in arrivo', Icons.archiveRestore(14)) : ''}
    ${cartella !== 'archivio' ? azione('archivio', 'Archivia', Icons.archive(14)) : ''}
    ${cartella !== 'cestino' ? azione('cestino', 'Elimina', Icons.trash(14)) : ''}
    ${cartella !== 'cestino' ? `<button type="button" class="btn btn-ghost btn-sm" onclick="markMailSpam()">È spam</button>` : ''}
    ${cartella === 'inbox' ? `<button type="button" class="btn btn-ghost btn-sm" onclick="markMailUnread()">Da leggere</button>` : ''}`;
  const head = `
    <div class="mail-read-head">
      <button type="button" class="btn-icon mail-back" onclick="closeMailThread()" aria-label="Torna all'elenco">${Icons.chevronLeft(18)}</button>
      <div class="mail-read-title">
        <h2>${escapeHtml(f.oggetto || '(senza oggetto)')}</h2>
        <span><i class="ctrl-dot" style="--m:${mailColore(f.casella_id)};" aria-hidden="true"></i>${escapeHtml(casella?.indirizzo || mailNomeCasella(f.casella_id))}${cartella && cartella !== 'inbox' ? ` · ${MAIL_CARTELLE[cartella]}` : ''}</span>
      </div>
      <div class="mail-read-actions">${azioni}</div>
    </div>`;
  if (!c) { pane.innerHTML = head + `<div class="empty-list">Caricamento…</div>`; return; }

  const errore = c.messaggi.find(m => m.sposta_errore)?.sposta_errore;
  const inCorso = c.messaggi.some(m => m.in_spostamento);
  const avviso = errore ? `<div class="mail-warn">${escapeHtml(errore)}${inCorso ? '. Il gestionale riprova da solo.' : ''}</div>`
    : inCorso ? `<div class="mail-info">Spostamento sulla casella Aruba in corso.</div>` : '';

  const daRispondere = [...c.messaggi].reverse().find(m => m.direzione === 'in' && m.da_email);
  const taskAperti = c.tasks.filter(t => !['completato', 'non_completato'].includes(t.stato));
  const tasks = c.tasks.length ? `
    <div class="mail-tasks">
      ${c.tasks.map(t => `
        <span class="mail-task">
          <span class="td-tag" style="--c:${['completato', 'non_completato'].includes(t.stato) ? '#16a34a' : '#f59e0b'};">${MAIL_STATI_TASK[t.stato] || t.stato}</span>
          <span>${escapeHtml(t.titolo || 'Task')}${t.assegnato_a ? ` · ${escapeHtml(t.assegnato_a)}` : ' · coda comune'}</span>
          ${Nav.isAllowed('controllo') && Ctrl.get?.(t.id) ? `<button type="button" class="ctrl-btn" onclick="Nav.go('controllo');setTimeout(()=>openTaskDetail('${t.id}'),300)">Apri task</button>` : ''}
        </span>`).join('')}
    </div>` : '';

  const bozzaCervello = taskAperti.find(t => t.bozza_risposta && !t.risposta_inviata_at)?.bozza_risposta;
  const ordini = MailBox.ordini.length ? `
    <div class="mail-ordini" role="group" aria-label="Ordine per i modelli">
      <span>Ordine per i modelli</span>
      ${MailBox.ordini.map(o => mailOrdineOpzione(o, MailBox.ordine?.id === o.id, 'pickReplyOrder')).join('')}
    </div>` : '';
  const risposta = daRispondere ? `
    <form class="mail-reply" onsubmit="event.preventDefault();sendMailReply()">
      <label for="mail-bozza">Rispondi a <strong>${escapeHtml(daRispondere.da_nome || daRispondere.da_email)}</strong>
        <span>${escapeHtml(daRispondere.da_email)}</span></label>
      ${mailModelliChips('useReplyTemplate')}
      ${ordini}
      ${bozzaCervello && MailBox.bozza === MailFirme.applica(bozzaCervello, f.casella_id) ? `<small class="mail-reply-note">Bozza preparata dal cervello: controllala prima di inviare.</small>` : ''}
      <textarea id="mail-bozza" class="form-textarea" maxlength="20000" rows="9" placeholder="Scrivi la risposta…"
        oninput="MailBox.bozza=this.value">${escapeHtml(MailBox.bozza)}</textarea>
      <div class="mail-reply-actions">
        ${taskAperti.length ? `<small>Inviando, ${taskAperti.length === 1 ? 'il task collegato viene completato' : 'i task collegati vengono completati'}.</small>` : '<small>Parte da ' + escapeHtml(casella?.indirizzo || 'la casella del negozio') + ', con copia nella cartella Inviata.</small>'}
        <button type="submit" class="btn btn-primary btn-sm" id="mail-send" ${MailBox.invio ? 'disabled' : ''}>${Icons.reply(14)} ${MailBox.invio ? 'Invio…' : 'Invia risposta'}</button>
      </div>
    </form>` : '';

  pane.innerHTML = head + `
    <div class="mail-thread">
      ${avviso}
      ${tasks}
      ${c.messaggi.map((m, i) => renderMailMessage(m, i === c.messaggi.length - 1)).join('')}
      ${risposta}
    </div>`;
}

function renderMailMessage(m, ultimo) {
  const out = m.direzione === 'out';
  const chi = out ? (m.da_nome || m.da_email) : (m.da_nome || m.da_email || 'Mittente sconosciuto');
  const testo = m.testo
    ? escapeHtml(m.testo)
    : `<em class="mail-msg-none">${out ? 'Mail inviata dal programma di posta: il testo è nella cartella Inviata della casella.' : m.automatica ? 'Mail automatica: il testo non viene salvato.' : 'Mail senza testo.'}</em>`;
  const citato = (m.testo_citato || '').trim();
  return `
    <article class="mail-msg ${out ? 'is-out' : ''}" ${ultimo ? 'id="mail-last"' : ''}>
      <header class="mail-msg-head">
        <span class="user-avatar mail-msg-avatar" aria-hidden="true">${escapeHtml((chi || '?').trim().charAt(0).toUpperCase())}</span>
        <div>
          <strong>${escapeHtml(chi || '')}</strong>
          <span>${out ? `a ${escapeHtml(m.a || '')}` : escapeHtml(m.da_email || '')}</span>
        </div>
        <time datetime="${m.ricevuto_at}">${ctrlFmtQuando(m.ricevuto_at)}</time>
      </header>
      <div class="mail-msg-body">${testo}</div>
      ${citato ? `<details class="mail-msg-quote"><summary>Messaggio precedente citato</summary><div>${escapeHtml(citato)}</div></details>` : ''}
      ${(m.allegati || []).length ? `
        <div class="mail-msg-att">
          ${m.allegati.map((a, i) => `
            <span class="mail-att">
              <button type="button" class="mail-att-open" onclick="openMailAttachment('${m.id}', ${i}, false, this)" title="Apri">
                ${Icons.paperclip(12)} <span>${escapeHtml(a.nome || 'allegato')}</span>${a.dimensione ? ` <small>${mailFmtSize(a.dimensione)}</small>` : ''}
              </button>
              <button type="button" class="mail-att-dl" onclick="openMailAttachment('${m.id}', ${i}, true, this)" aria-label="Scarica ${escapeHtml(a.nome || 'allegato')}" title="Scarica">${Icons.download(13)}</button>
            </span>`).join('')}
        </div>` : ''}
    </article>`;
}

async function openMailThread(i) {
  const f = MailBox.fili[i];
  if (!f) return;
  const k = MailBox.chiave(f);
  MailBox.aperto = { casella_id: f.casella_id, filo: f.filo, oggetto: f.oggetto };
  MailBox.conversazione = null;
  if (MailBox.bozzaDi !== k) { MailBox.bozza = ''; MailBox.bozzaDi = k; MailBox.ordini = []; MailBox.ordine = null; }
  renderMailList();
  renderMailReader();
  try {
    const r = await MailBox._rpc('tc_mail_filo', { p_casella: f.casella_id, p_filo: f.filo });
    if (MailBox.chiave(MailBox.aperto) !== k) return;
    MailBox.conversazione = { messaggi: r.messaggi || [], tasks: r.tasks || [] };
    // La risposta parte dalla bozza del cervello (se c'è un task aperto) oppure dalla sola firma
    if (!MailBox.bozza.trim()) {
      const bozza = MailBox.conversazione.tasks.find(t => !['completato', 'non_completato'].includes(t.stato) && t.bozza_risposta && !t.risposta_inviata_at)?.bozza_risposta;
      MailBox.bozza = MailFirme.applica(bozza || '', f.casella_id);
    }
    if (f.non_lette) {
      f.non_lette = 0;
      const box = MailBox.caselle.find(c => c.id === f.casella_id);
      if (box) box.non_lette = Math.max(0, (box.non_lette || 0) - 1);
      MailBox.badge = Math.max(0, MailBox.badge - 1);
      renderSidebar();
      renderMailBoxes();
      renderMailList();
    }
    renderMailReader();
    document.getElementById('mail-last')?.scrollIntoView({ block: 'nearest' });
    loadReplyOrders(k);
  } catch (e) {
    showToast(e.message, 'error');
    closeMailThread();
  }
}

// Ordini del cliente (per email) per riempire i modelli: si sceglie da solo il più recente
async function loadReplyOrders(k) {
  const c = MailBox.conversazione;
  const m = c && [...c.messaggi].reverse().find(x => x.direzione === 'in' && x.da_email);
  if (!m || MailBox.ordini.length) return;
  try {
    const r = await MailBox._rpc('tc_mail_ordini', { p_casella: MailBox.aperto.casella_id, p_cerca: m.da_email });
    if (MailBox.chiave(MailBox.aperto) !== k) return;
    MailBox.ordini = r.ordini || [];
    MailBox.ordine = MailBox.ordini[0] || null;
    if (MailBox.ordini.length) renderMailReaderKeepText();
  } catch { /* i modelli funzionano anche senza ordine */ }
}

// Ridisegna la conversazione senza perdere il punto in cui si sta scrivendo
function renderMailReaderKeepText() {
  const t = document.getElementById('mail-bozza');
  const sel = t && document.activeElement === t ? [t.selectionStart, t.selectionEnd] : null;
  const scroll = document.querySelector('.mail-thread')?.scrollTop;
  renderMailReader();
  const th = document.querySelector('.mail-thread');
  if (th && scroll != null) th.scrollTop = scroll;
  if (sel) { const n = document.getElementById('mail-bozza'); n.focus(); n.setSelectionRange(...sel); }
}

function pickReplyOrder(id) {
  MailBox.ordine = MailBox.ordini.find(o => o.id === id) || null;
  renderMailReaderKeepText();
}

async function useReplyTemplate(id) {
  const mod = MailModelli.get(id);
  const c = MailBox.conversazione;
  if (!mod || !c) return;
  const m = [...c.messaggi].reverse().find(x => x.direzione === 'in' && x.da_email);
  const vecchia = (MailBox.bozza || '').trim();
  if (vecchia && vecchia !== MailFirme.di(MailBox.aperto.casella_id) && !(await uiConfirm('Sostituire il testo già scritto con il modello?', { ok: 'Sostituisci' }))) return;
  const dati = mailDati(MailBox.ordine, MailBox.aperto.casella_id, m?.da_nome);
  MailBox.bozza = MailFirme.applica(mailRiempi(mod.testo, dati), MailBox.aperto.casella_id);
  renderMailReaderKeepText();
  const t = document.getElementById('mail-bozza');
  if (t) { t.focus(); t.setSelectionRange(0, 0); t.scrollTop = 0; }
}

function closeMailThread() {
  MailBox.aperto = null;
  MailBox.conversazione = null;
  renderMailList();
  renderMailReader();
}

async function markMailUnread() {
  const a = MailBox.aperto;
  if (!a) return;
  try {
    await MailBox._rpc('tc_mail_da_leggere', { p_casella: a.casella_id, p_filo: a.filo });
    closeMailThread();
    await MailBox.load();
    renderMailBoxes();
    renderMailList();
    MailBox.loadBadge();
  } catch (e) { showToast(e.message, 'error'); }
}

async function moveMailThread(dest) {
  const a = MailBox.aperto;
  if (!a) return;
  try {
    await MailBox._rpc('tc_mail_sposta', { p_casella: a.casella_id, p_filo: a.filo, p_dest: dest });
    MailBox.spostaSuAruba(a.casella_id);
    showToast(dest === 'inbox' ? 'Spostata in arrivo' : dest === 'archivio' ? 'Archiviata' : 'Spostata nel cestino');
    await afterMailMove();
  } catch (e) { showToast(e.message, 'error'); }
}

async function markMailSpam() {
  const a = MailBox.aperto;
  const m = MailBox.conversazione && [...MailBox.conversazione.messaggi].reverse().find(x => x.direzione === 'in' && x.da_email);
  if (!a) return;
  if (!(await uiConfirm(`Segnare come spam${m ? ` ${m.da_email}` : ''}? La conversazione va nel cestino, i task aperti spariscono e le prossime mail di questo mittente verranno scartate.`, { ok: 'Segna come spam' }))) return;
  try {
    await MailBox._rpc('tc_mail_spam', { p_casella: a.casella_id, p_filo: a.filo });
    MailBox.spostaSuAruba(a.casella_id);
    showToast('Segnata come spam');
    if (window.Ctrl?.loadBadge) Ctrl.loadBadge();
    await afterMailMove();
  } catch (e) { showToast(e.message, 'error'); }
}

async function afterMailMove() {
  closeMailThread();
  try { await Promise.all([MailBox.loadCaselle(), MailBox.loadLista()]); } catch { /* resta l'elenco di prima */ }
  renderMailBoxes();
  renderMailList();
  MailBox.loadBadge();
}

// Allegato scaricato al momento dalla casella: si apre in una scheda nuova (immagini, PDF, testo) o si salva
async function openMailAttachment(mailId, indice, scarica, btn) {
  const m = MailBox.conversazione?.messaggi.find(x => x.id === mailId);
  const a = m?.allegati?.[indice];
  if (!a) return;
  const apribile = /^(image\/|application\/pdf|text\/plain)/i.test(a.tipo || '');
  // La scheda si apre subito, prima dell'attesa: dopo, il browser la bloccherebbe come popup
  const scheda = !scarica && apribile ? window.open('', '_blank') : null;
  if (scheda) scheda.document.write(`<p style="font-family:sans-serif;padding:24px">Apertura di ${escapeHtml(a.nome || 'allegato')}…</p>`);
  const wrap = btn?.closest('.mail-att');
  wrap?.classList.add('is-loading');
  try {
    const { data, error } = await supabaseClient.functions.invoke('mail-azioni', { body: { azione: 'allegato', mail_id: mailId, indice, nome: a.nome || null } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || 'Allegato non disponibile');
    }
    const blob = new Blob([data], { type: a.tipo || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (scheda) scheda.location.href = url;
    else {
      const link = Object.assign(document.createElement('a'), { href: url, download: a.nome || 'allegato' });
      document.body.appendChild(link); link.click(); link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    scheda?.close();
    showToast(e.message, 'error');
  } finally {
    wrap?.classList.remove('is-loading');
  }
}

async function sendMailReply() {
  const testo = (MailBox.bozza || '').trim();
  const c = MailBox.conversazione;
  const m = c && [...c.messaggi].reverse().find(x => x.direzione === 'in' && x.da_email);
  if (!m) return;
  if (!testo || testo === MailFirme.di(MailBox.aperto.casella_id)) { showToast('Scrivi la risposta', 'error'); document.getElementById('mail-bozza')?.focus(); return; }
  const casella = mailCasella(MailBox.aperto.casella_id);
  if (!(await uiConfirm(`Inviare la risposta a ${m.da_email}${casella ? ` da ${casella.indirizzo}` : ''}?`, { ok: 'Invia' }))) return;

  const k = MailBox.chiave(MailBox.aperto);
  MailBox.invio = true;
  renderMailReaderKeepText();
  try {
    const { data, error } = await supabaseClient.functions.invoke('mail-send', { body: { mail_id: m.id, testo } });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'Invio non riuscito');
    }
    if (!data?.success) throw new Error(data?.error || 'Invio non riuscito');
    showToast(data.copia_in_inviata ? 'Risposta inviata' : 'Risposta inviata (copia in Inviata non riuscita)');
    MailBox.bozza = '';
    MailBox.invio = false;
    if (data.task_completati && window.Ctrl?.loadBadge) Ctrl.loadBadge();
    await MailBox.loadLista();
    renderMailList();
    // Riapre la stessa conversazione, ora con la risposta
    const i = MailBox.fili.findIndex(f => MailBox.chiave(f) === k);
    if (i >= 0) openMailThread(i); else closeMailThread();
  } catch (e) {
    MailBox.invio = false;
    renderMailReaderKeepText();
    showToast(e.message, 'error');
  }
}

// ─────────────────────────────────────────────
// MAIL NUOVA
// ─────────────────────────────────────────────

const MailNuova = { casella: null, ordini: [], ordine: null, cerca: '', modello: null, _timer: null };

function openMailCompose() {
  const caselle = MailBox.caselle;
  if (!caselle.length) { showToast('Caselle non ancora caricate', 'error'); return; }
  Object.assign(MailNuova, { casella: MailBox.casella || caselle[0].id, ordini: [], ordine: null, cerca: '', modello: null });
  const modal = document.getElementById('mail-modal');
  modal.innerHTML = `
    <div class="modal mail-dialog mail-compose" role="dialog" aria-modal="true" aria-labelledby="mc-title">
      <div class="modal-header">
        <h2 id="mc-title">Nuova mail</h2>
        <button class="btn-icon" onclick="closeModal('mail-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body mail-form" onsubmit="event.preventDefault();sendMailCompose()">
        <div class="form-group">
          <span class="form-label" id="mc-da-label">Da</span>
          <div class="ctrl-macro-bar" role="radiogroup" aria-labelledby="mc-da-label" id="mc-caselle"></div>
        </div>
        <div class="form-group">
          <label class="form-label" for="mc-ordine">Ordine <span class="mail-form-opt">facoltativo: riempie destinatario e modelli</span></label>
          <div class="search-box">${Icons.search()}<input type="search" id="mc-ordine" class="form-input" placeholder="Numero d'ordine, email o nome del cliente" oninput="searchComposeOrders(this.value)" autocomplete="off"></div>
          <div class="mail-ordini" id="mc-ordini" aria-live="polite"></div>
        </div>
        <div class="form-group">${mailModelliChips('useComposeTemplate')}</div>
        <div class="mail-form-row">
          <div class="form-group"><label class="form-label" for="mc-a">A</label>
            <input id="mc-a" type="email" class="form-input" required placeholder="cliente@esempio.it" autocomplete="off"></div>
          <div class="form-group"><label class="form-label" for="mc-a-nome">Nome <span class="mail-form-opt">facoltativo</span></label>
            <input id="mc-a-nome" type="text" class="form-input" maxlength="120" autocomplete="off"></div>
        </div>
        <div class="form-group"><label class="form-label" for="mc-oggetto">Oggetto</label>
          <input id="mc-oggetto" type="text" class="form-input" required maxlength="200"></div>
        <div class="form-group"><label class="form-label" for="mc-testo">Testo</label>
          <textarea id="mc-testo" class="form-textarea" rows="11" maxlength="20000" required></textarea></div>
        <div class="mail-form-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal('mail-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="mc-send">${Icons.reply(14)} Invia</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('mail-modal'); };
  renderComposeBoxes();
  document.getElementById('mc-testo').value = MailFirme.applica('', MailNuova.casella);
  setTimeout(() => document.getElementById('mc-ordine')?.focus(), 50);
}

function renderComposeBoxes() {
  const box = document.getElementById('mc-caselle');
  if (!box) return;
  box.innerHTML = MailBox.caselle.map(c => {
    const on = MailNuova.casella === c.id;
    return `<button type="button" role="radio" aria-checked="${on}" class="ctrl-filter ${on ? 'is-on' : ''}" style="--m:${mailColore(c.id)};" onclick="setComposeBox('${c.id}')" title="${escapeHtml(c.indirizzo)}">
      <i aria-hidden="true"></i><span>${escapeHtml(mailNomeCasella(c.id))}</span></button>`;
  }).join('');
}

function setComposeBox(id) {
  if (id === MailNuova.casella) return;
  const t = document.getElementById('mc-testo');
  const firmaVecchia = MailFirme.di(MailNuova.casella);
  // Cambia anche la firma; l'ordine apparteneva all'altro negozio
  if (t && t.value.trimEnd().endsWith(firmaVecchia)) t.value = MailFirme.applica(t.value.trimEnd().slice(0, -firmaVecchia.length), id);
  MailNuova.casella = id;
  MailNuova.ordini = []; MailNuova.ordine = null;
  renderComposeBoxes();
  renderComposeOrders();
  if (MailNuova.cerca) searchComposeOrders(MailNuova.cerca);
}

function searchComposeOrders(v) {
  MailNuova.cerca = v.trim();
  clearTimeout(MailNuova._timer);
  MailNuova._timer = setTimeout(async () => {
    const q = MailNuova.cerca;
    if (q.length < 2) { MailNuova.ordini = []; renderComposeOrders(); return; }
    try {
      const r = await MailBox._rpc('tc_mail_ordini', { p_casella: MailNuova.casella, p_cerca: q });
      if (q !== MailNuova.cerca) return;
      MailNuova.ordini = r.ordini || [];
      renderComposeOrders();
    } catch (e) { showToast(e.message, 'error'); }
  }, 300);
}

function renderComposeOrders() {
  const box = document.getElementById('mc-ordini');
  if (!box) return;
  const lista = MailNuova.ordine && !MailNuova.ordini.some(o => o.id === MailNuova.ordine.id) ? [MailNuova.ordine, ...MailNuova.ordini] : MailNuova.ordini;
  box.innerHTML = lista.length ? lista.map(o => mailOrdineOpzione(o, MailNuova.ordine?.id === o.id, 'pickComposeOrder')).join('')
    : MailNuova.cerca.length >= 2 ? `<small class="mail-form-opt">Nessun ordine di ${escapeHtml(mailNomeCasella(MailNuova.casella))} trovato.</small>` : '';
}

function pickComposeOrder(id) {
  const o = [MailNuova.ordine, ...MailNuova.ordini].find(x => x?.id === id);
  MailNuova.ordine = MailNuova.ordine?.id === id ? null : o;
  if (MailNuova.ordine) {
    const a = document.getElementById('mc-a'), n = document.getElementById('mc-a-nome');
    if (o.email) a.value = o.email;
    n.value = o.indirizzo?.nome || o.cliente || '';
  }
  renderComposeOrders();
  if (MailNuova.modello) useComposeTemplate(MailNuova.modello, true);
}

async function useComposeTemplate(id, giaScelto = false) {
  const mod = MailModelli.get(id);
  if (!mod) return;
  const t = document.getElementById('mc-testo'), ogg = document.getElementById('mc-oggetto');
  const scritto = t.value.trim();
  const firma = MailFirme.di(MailNuova.casella);
  if (!giaScelto && scritto && scritto !== firma && MailNuova.modello === null
    && !(await uiConfirm('Sostituire il testo già scritto con il modello?', { ok: 'Sostituisci' }))) return;
  MailNuova.modello = id;
  const dati = mailDati(MailNuova.ordine, MailNuova.casella, document.getElementById('mc-a-nome').value);
  t.value = MailFirme.applica(mailRiempi(mod.testo, dati), MailNuova.casella);
  ogg.value = mailRiempiOggetto(mod.oggetto, dati, mod.titolo);
  document.querySelectorAll('.mail-compose .mail-chip').forEach(b => b.classList.toggle('is-on', b.getAttribute('onclick').includes(`'${id}'`)));
}

async function sendMailCompose() {
  const a = document.getElementById('mc-a').value.trim();
  const aNome = document.getElementById('mc-a-nome').value.trim();
  const oggetto = document.getElementById('mc-oggetto').value.trim();
  const testo = document.getElementById('mc-testo').value.trim();
  const casella = mailCasella(MailNuova.casella);
  if (!testo || testo === MailFirme.di(MailNuova.casella)) { showToast('Scrivi il testo della mail', 'error'); return; }
  if (!(await uiConfirm(`Inviare la mail a ${a} da ${casella?.indirizzo || 'la casella del negozio'}?`, { ok: 'Invia' }))) return;
  const btn = document.getElementById('mc-send');
  btn.disabled = true; btn.lastChild.textContent = ' Invio…';
  try {
    const { data, error } = await supabaseClient.functions.invoke('mail-send', {
      body: { nuova: { casella: MailNuova.casella, a, a_nome: aNome, oggetto }, testo },
    });
    if (error) {
      const dett = await error.context?.json?.().catch(() => null);
      throw new Error(dett?.error || error.message || 'Invio non riuscito');
    }
    if (!data?.success) throw new Error(data?.error || 'Invio non riuscito');
    closeModal('mail-modal');
    showToast(data.copia_in_inviata ? 'Mail inviata' : 'Mail inviata (copia in Inviata non riuscita)');
    if (Nav.current === 'mail') { await MailBox.loadLista().catch(() => {}); renderMailList(); }
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false; btn.lastChild.textContent = ' Invia';
  }
}

// ─────────────────────────────────────────────
// MODELLI: gestione (admin)
// ─────────────────────────────────────────────

let _mailModelloAperto = null;

function openMailTemplates(id = null) {
  _mailModelloAperto = id;
  const lista = MailModelli.lista;
  const m = id === 'nuovo' ? { id: 'nuovo', titolo: '', oggetto: '', testo: 'Ciao {nome},\n\n\nGrazie,', attivo: true } : MailModelli.get(id);
  const modal = document.getElementById('mail-modal');
  modal.innerHTML = `
    <div class="modal mail-dialog mail-templates" role="dialog" aria-modal="true" aria-labelledby="mt-title">
      <div class="modal-header">
        <h2 id="mt-title">${m ? (id === 'nuovo' ? 'Nuovo modello' : 'Modifica modello') : 'Modelli di mail'}</h2>
        <button class="btn-icon" onclick="closeModal('mail-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      ${m ? `
      <form class="modal-body mail-form" onsubmit="event.preventDefault();saveMailTemplate()">
        <div class="form-group"><label class="form-label" for="mt-titolo">Nome del modello</label>
          <input id="mt-titolo" class="form-input" required maxlength="80" value="${escapeHtml(m.titolo)}"></div>
        <div class="form-group"><label class="form-label" for="mt-oggetto">Oggetto <span class="mail-form-opt">le parti separate da " – " con un dato mancante si tolgono</span></label>
          <input id="mt-oggetto" class="form-input" maxlength="200" value="${escapeHtml(m.oggetto)}"></div>
        <div class="form-group"><label class="form-label" for="mt-testo">Testo <span class="mail-form-opt">senza firma: la aggiunge il gestionale</span></label>
          <textarea id="mt-testo" class="form-textarea" rows="12" maxlength="10000" required>${escapeHtml(m.testo)}</textarea></div>
        <div class="mail-dati">
          <strong>Dati che si riempiono da soli</strong>
          ${Object.entries(MAIL_DATI).map(([k, l]) => `<button type="button" class="mail-chip" onclick="insertTemplateVar('${k}')" title="Inserisci nel testo">{${k}} <small>${l}</small></button>`).join('')}
          <small>Una riga con un dato che manca non viene scritta. Senza nome, "Ciao {nome}," diventa "Ciao,".</small>
        </div>
        <label class="mail-check"><input type="checkbox" id="mt-attivo" ${m.attivo ? 'checked' : ''}> Visibile tra i modelli</label>
        <div class="mail-form-actions">
          ${id !== 'nuovo' ? `<button type="button" class="btn btn-ghost mail-danger" onclick="deleteMailTemplate()">Elimina</button>` : ''}
          <button type="button" class="btn btn-secondary" onclick="openMailTemplates()">Indietro</button>
          <button type="submit" class="btn btn-primary" id="mt-save">Salva</button>
        </div>
      </form>` : `
      <div class="modal-body mail-form">
        <p class="mail-form-hint">Si usano da "Nuova mail" e nelle risposte: si riempiono con i dati dell'ordine scelto.</p>
        <div class="mail-tpl-list">
          ${lista.map(x => `
            <button type="button" class="mail-tpl-row" onclick="openMailTemplates('${x.id}')">
              <strong>${escapeHtml(x.titolo)}</strong>${x.attivo ? '' : ' <span class="td-tag" style="--c:#94a3b8;">nascosto</span>'}
              <span>${escapeHtml(x.oggetto || '')}</span>
            </button>`).join('') || '<div class="empty-list">Nessun modello.</div>'}
        </div>
        <div class="mail-form-actions">
          <button type="button" class="btn btn-primary" onclick="openMailTemplates('nuovo')">${Icons.plus()} Nuovo modello</button>
        </div>
      </div>`}
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('mail-modal'); };
}

function insertTemplateVar(k) {
  const t = document.getElementById('mt-testo');
  const [s, e] = [t.selectionStart, t.selectionEnd];
  t.setRangeText(`{${k}}`, s, e, 'end');
  t.focus();
}

async function saveMailTemplate() {
  const id = _mailModelloAperto;
  const riga = {
    titolo: document.getElementById('mt-titolo').value.trim(),
    oggetto: document.getElementById('mt-oggetto').value.trim(),
    testo: document.getElementById('mt-testo').value.trim(),
    attivo: document.getElementById('mt-attivo').checked,
    aggiornato_at: new Date().toISOString(),
    aggiornato_da: TCAuth.getNickname(),
  };
  const sconosciuti = [...`${riga.oggetto}\n${riga.testo}`.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]).filter(k => !MAIL_DATI[k]);
  if (sconosciuti.length) { showToast(`Dato sconosciuto: {${sconosciuti[0]}}`, 'error'); return; }
  document.getElementById('mt-save').disabled = true;
  const q = id === 'nuovo'
    ? supabaseClient.from('mail_modelli').insert({ ...riga, ordine: (Math.max(0, ...MailModelli.lista.map(x => x.ordine)) + 1) })
    : supabaseClient.from('mail_modelli').update(riga).eq('id', id);
  const { error } = await q;
  if (error) { showToast('Modello non salvato', 'error'); document.getElementById('mt-save').disabled = false; return; }
  await MailModelli.load();
  showToast('Modello salvato');
  openMailTemplates();
  if (MailBox.aperto) renderMailReaderKeepText();
}

async function deleteMailTemplate() {
  const m = MailModelli.get(_mailModelloAperto);
  if (!m || !(await uiConfirm(`Eliminare il modello "${m.titolo}"?`, { ok: 'Elimina', danger: true }))) return;
  const { error } = await supabaseClient.from('mail_modelli').delete().eq('id', m.id);
  if (error) { showToast('Modello non eliminato', 'error'); return; }
  await MailModelli.load();
  showToast('Modello eliminato');
  openMailTemplates();
}

// ─────────────────────────────────────────────
// FILTRI
// ─────────────────────────────────────────────

async function reloadMailList() {
  MailBox.caricamento = true;
  renderMailBoxes();
  renderMailList();
  try { await MailBox.loadLista(); MailBox.errore = null; } catch (e) { MailBox.errore = e; }
  MailBox.caricamento = false;
  renderMailList();
}

function setMailCasella(id) { MailBox.casella = id; closeMailThread(); reloadMailList(); }
function setMailVista(id) { MailBox.vista = id; closeMailThread(); reloadMailList(); }
function setMailCerca(v) {
  MailBox.cerca = v.trim();
  clearTimeout(MailBox._cercaTimer);
  MailBox._cercaTimer = setTimeout(reloadMailList, 300);
}

async function loadMoreMail(btn) {
  btn.disabled = true; btn.textContent = 'Caricamento…';
  try { await MailBox.loadLista({ altre: true }); } catch (e) { showToast(e.message, 'error'); }
  renderMailList();
}
