/**
 * T&C Factory — Mail
 * Le mail di tutte le caselle dei negozi (lette da mail-sync ogni 5 minuti), divise in conversazioni:
 * a sinistra l'elenco, a destra la conversazione aperta con la risposta.
 * Dati: funzioni tc_mail_* (sql/mail-sezione.sql); invio: edge function mail-send con mail_id.
 * Lo stato "letta" è condiviso dal team: aprire una conversazione la segna letta per tutti.
 */

const MAIL_POLL_MS = 60000;
const MAIL_PAGINA = 50;
const MAIL_VISTE = [
  ['arrivo', 'In arrivo'],
  ['da_leggere', 'Da leggere'],
  ['inviate', 'Risposte'],
  ['automatiche', 'Automatiche'],
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
        throw Object.assign(new Error('Sezione Mail da attivare: esegui sql/mail-sezione.sql'), { notInstalled: true });
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
      await Promise.all([this.loadCaselle(), this.loadLista()]);
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
    if (!Nav.isAllowed('mail')) return;
    this.loadBadge();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.poll(), MAIL_POLL_MS);
  },

  stop() {
    clearInterval(this._timer);
    Object.assign(this, { caselle: [], fili: [], aperto: null, conversazione: null, bozza: '', bozzaDi: null, badge: 0, errore: null });
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
};

window.MailBox = MailBox;

const mailCasella = (id) => MailBox.caselle.find(c => c.id === id);
const mailColore = (id) => taskMacro(id)?.color || '#94a3b8';
const mailNomeCasella = (id) => taskMacro(id)?.label || mailCasella(id)?.nome || id;

// Data breve nell'elenco: ora se oggi, "ieri", altrimenti giorno e mese
function mailFmtData(iso) {
  const g = ctrlGiornoDi(iso), oggi = ctrlOggi();
  if (g === oggi) return ctrlFmtOra(iso);
  if (g === ctrlAddDays(oggi, -1)) return 'Ieri';
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', ...(g.slice(0, 4) !== oggi.slice(0, 4) ? { year: 'numeric' } : {}) });
}

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

async function openMailPage() {
  renderMailPage();
  await MailBox.load();
  renderMailPage();
  MailBox.loadBadge();
}

function renderMailPage() {
  const root = document.getElementById('mail-root');
  if (!root) return;
  if (MailBox.errore?.notInstalled) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.mail(28)}</div>
        <h2>Sezione Mail da attivare</h2>
        <p>Esegui lo script <strong>sql/mail-sezione.sql</strong> su Supabase, poi ricarica la pagina.</p>
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
              <div class="segmented" role="tablist" aria-label="Quali conversazioni">
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
    const vuoto = MailBox.cerca ? 'Nessuna mail trovata.' : MailBox.vista === 'da_leggere' ? 'Nessuna mail da leggere.' : 'Nessuna mail.';
    list.innerHTML = `<div class="empty-list">${vuoto}</div>`;
    return;
  }
  const aperto = MailBox.chiave(MailBox.aperto);
  const tutte = !MailBox.casella;
  list.innerHTML = MailBox.fili.map((f, i) => {
    const k = MailBox.chiave(f);
    return `
    <button type="button" class="mail-row ${f.non_lette ? 'is-unread' : ''} ${k === aperto ? 'is-open' : ''}"
      onclick="openMailThread(${i})" ${k === aperto ? 'aria-current="true"' : ''}>
      <span class="mail-row-top">
        ${tutte ? `<i class="ctrl-dot" style="--m:${mailColore(f.casella_id)};" title="${escapeHtml(mailNomeCasella(f.casella_id))}" aria-label="${escapeHtml(mailNomeCasella(f.casella_id))}"></i>` : ''}
        <strong class="mail-row-who">${escapeHtml(f.persona || f.email || 'Mittente sconosciuto')}</strong>
        ${f.messaggi > 1 ? `<span class="mail-row-count" aria-label="${f.messaggi} messaggi">${f.messaggi}</span>` : ''}
        <span class="mail-row-date">${mailFmtData(f.ultima_at)}</span>
      </span>
      <span class="mail-row-subj">${f.ultima_out ? `<span class="mail-row-replied" title="Ultimo messaggio: nostra risposta">${Icons.reply(12)}</span>` : ''}${escapeHtml(f.oggetto || '(senza oggetto)')}${f.allegati ? ` <span class="mail-row-clip" aria-label="${f.allegati} allegati">${Icons.paperclip(11)}</span>` : ''}</span>
      ${f.anteprima ? `<span class="mail-row-prev">${escapeHtml(f.anteprima)}</span>` : ''}
    </button>`;
  }).join('') + (MailBox.altre ? `<div class="mail-more"><button type="button" class="btn btn-secondary btn-sm" onclick="loadMoreMail(this)">Carica le precedenti</button></div>` : '');
}

// ─────────────────────────────────────────────
// CONVERSAZIONE APERTA
// ─────────────────────────────────────────────

const MAIL_STATI_TASK = { da_fare: 'Da fare', in_corso: 'In corso', in_pausa: 'In pausa', rimandato: 'Rimandato', completato: 'Completato', non_completato: 'Non completato' };

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
  const head = `
    <div class="mail-read-head">
      <button type="button" class="btn-icon mail-back" onclick="closeMailThread()" aria-label="Torna all'elenco">${Icons.chevronLeft(18)}</button>
      <div class="mail-read-title">
        <h2>${escapeHtml(f.oggetto || '(senza oggetto)')}</h2>
        <span><i class="ctrl-dot" style="--m:${mailColore(f.casella_id)};" aria-hidden="true"></i>${escapeHtml(casella?.indirizzo || mailNomeCasella(f.casella_id))}</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="markMailUnread()" ${c ? '' : 'disabled'}>Segna da leggere</button>
    </div>`;
  if (!c) { pane.innerHTML = head + `<div class="empty-list">Caricamento…</div>`; return; }

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
  const risposta = daRispondere ? `
    <form class="mail-reply" onsubmit="event.preventDefault();sendMailReply()">
      <label for="mail-bozza">Rispondi a <strong>${escapeHtml(daRispondere.da_nome || daRispondere.da_email)}</strong>
        <span>${escapeHtml(daRispondere.da_email)}</span></label>
      ${bozzaCervello && MailBox.bozza === bozzaCervello ? `<small class="mail-reply-note">Bozza preparata dal cervello: controllala prima di inviare.</small>` : ''}
      <textarea id="mail-bozza" class="form-textarea" maxlength="20000" rows="7" placeholder="Scrivi la risposta…"
        oninput="MailBox.bozza=this.value">${escapeHtml(MailBox.bozza)}</textarea>
      <div class="mail-reply-actions">
        ${taskAperti.length ? `<small>Inviando, ${taskAperti.length === 1 ? 'il task collegato viene completato' : 'i task collegati vengono completati'}.</small>` : '<small>Parte da ' + escapeHtml(casella?.indirizzo || 'la casella del negozio') + ', con copia nella cartella Inviata.</small>'}
        <button type="submit" class="btn btn-primary btn-sm" id="mail-send" ${MailBox.invio ? 'disabled' : ''}>${Icons.reply(14)} ${MailBox.invio ? 'Invio…' : 'Invia risposta'}</button>
      </div>
    </form>` : '';

  pane.innerHTML = head + `
    <div class="mail-thread">
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
    : `<em class="mail-msg-none">${out ? 'Risposta data dal programma di posta: il testo è nella cartella Inviata della casella.' : m.automatica ? 'Mail automatica: il testo non viene salvato.' : 'Mail senza testo.'}</em>`;
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
        <div class="mail-msg-att" title="Gli allegati restano nella casella: qui si vedono solo i nomi">
          ${Icons.paperclip(12)} ${m.allegati.map(a => `<span>${escapeHtml(a.nome || 'allegato')}</span>`).join('')}
        </div>` : ''}
    </article>`;
}

async function openMailThread(i) {
  const f = MailBox.fili[i];
  if (!f) return;
  const k = MailBox.chiave(f);
  MailBox.aperto = { casella_id: f.casella_id, filo: f.filo, oggetto: f.oggetto };
  MailBox.conversazione = null;
  if (MailBox.bozzaDi !== k) { MailBox.bozza = ''; MailBox.bozzaDi = k; }
  renderMailList();
  renderMailReader();
  try {
    const r = await MailBox._rpc('tc_mail_filo', { p_casella: f.casella_id, p_filo: f.filo });
    if (MailBox.chiave(MailBox.aperto) !== k) return;
    MailBox.conversazione = { messaggi: r.messaggi || [], tasks: r.tasks || [] };
    // Se c'è una bozza del cervello per un task aperto, la risposta parte da lì
    const bozza = MailBox.conversazione.tasks.find(t => !['completato', 'non_completato'].includes(t.stato) && t.bozza_risposta && !t.risposta_inviata_at)?.bozza_risposta;
    if (!MailBox.bozza && bozza) MailBox.bozza = bozza;
    if (f.non_lette) {
      const prima = f.non_lette;
      f.non_lette = 0;
      const box = mailCasella(f.casella_id);
      if (box) box.non_lette = Math.max(0, (box.non_lette || 0) - 1);
      MailBox.badge = Math.max(0, MailBox.badge - (prima ? 1 : 0));
      renderSidebar();
      renderMailBoxes();
      renderMailList();
    }
    renderMailReader();
    document.getElementById('mail-last')?.scrollIntoView({ block: 'nearest' });
  } catch (e) {
    showToast(e.message, 'error');
    closeMailThread();
  }
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

async function sendMailReply() {
  const testo = (MailBox.bozza || '').trim();
  const c = MailBox.conversazione;
  const m = c && [...c.messaggi].reverse().find(x => x.direzione === 'in' && x.da_email);
  if (!m) return;
  if (!testo) { showToast('Scrivi la risposta', 'error'); document.getElementById('mail-bozza')?.focus(); return; }
  const casella = mailCasella(m.casella_id || MailBox.aperto.casella_id);
  if (!(await uiConfirm(`Inviare la risposta a ${m.da_email}${casella ? ` da ${casella.indirizzo}` : ''}?`, { ok: 'Invia' }))) return;

  const k = MailBox.chiave(MailBox.aperto);
  MailBox.invio = true;
  renderMailReader();
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
    if (i >= 0) openMailThread(i); else renderMailReader();
  } catch (e) {
    MailBox.invio = false;
    renderMailReader();
    showToast(e.message, 'error');
  }
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
