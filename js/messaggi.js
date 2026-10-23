/**
 * T&C Factory — Messaggi, notifiche e promemoria tra utenti
 * Pulsante chat accanto al profilo (navbar) e nel pannello "Altro" (smartphone).
 * Un messaggio può portarsi dietro un elemento della schermata, scelto con
 * "Seleziona dalla schermata": chi lo riceve lo apre con un clic.
 * Promemoria: un messaggio con ricorda_il arriva al destinatario solo da quell'ora.
 * Tabella messages (sql/messaggi.sql): ognuno legge solo i suoi messaggi.
 */

const MESSAGES_POLL_MS = 60000;   // controlla i promemoria in arrivo
const MESSAGES_LIMIT   = 300;

const Messages = {
  _list: [],
  loaded: false,
  error: null,
  _timer: null,
  _channel: null,
  _seen: new Set(),   // messaggi già notificati in questa sessione

  _me() { return TCAuth.getNickname(); },
  _arrivo(m) { return m.ricorda_il || m.created_at; },
  _arrivato(m) { return !m.ricorda_il || new Date(m.ricorda_il) <= new Date(); },

  received() {
    return this._list.filter(m => m.destinatario === this._me() && this._arrivato(m))
      .sort((a, b) => this._arrivo(b).localeCompare(this._arrivo(a)));
  },
  sent() {
    return this._list.filter(m => m.mittente === this._me())
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  unreadCount() { return this.received().filter(m => !m.letto_at).length; },

  async load() {
    const { data, error } = await supabaseClient.from('messages').select('*')
      .order('created_at', { ascending: false }).limit(MESSAGES_LIMIT);
    if (error) {
      // Tabella assente: lo script SQL non è ancora stato eseguito
      this.error = /relation .* does not exist|Could not find the table/i.test(error.message) || error.code === '42P01' || error.code === 'PGRST205'
        ? Object.assign(new Error('Messaggi non ancora attivati sul database'), { notInstalled: true })
        : new Error('Errore di connessione');
    } else {
      const first = !this.loaded;
      this._list = data || [];
      this.error = null;
      // Al primo caricamento non si notifica lo storico, solo quello che arriva dopo
      this.received().forEach(m => { if (first || this._seen.has(m.id)) this._seen.add(m.id); else this._notify(m); });
    }
    this.loaded = true;
    refreshMessagesUi();
    return this._list;
  },

  start() {
    this.load();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.load(), MESSAGES_POLL_MS);
    this._channel = supabaseClient.channel('messaggi')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `destinatario=eq.${this._me()}` }, (p) => {
        if (this._list.some(m => m.id === p.new.id)) return;
        this._list.unshift(p.new);
        if (this._arrivato(p.new)) this._notify(p.new);
        refreshMessagesUi();
      })
      .subscribe();
  },

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    if (this._channel) supabaseClient.removeChannel(this._channel);
    this._channel = null;
    Object.assign(this, { _list: [], loaded: false, error: null, _seen: new Set() });
  },

  // Un messaggio per ogni destinatario
  async send(destinatari, testo, riferimento, ricordaIl) {
    const rows = destinatari.map(d => ({
      mittente: this._me(), destinatario: d, testo: testo.trim(),
      riferimento: riferimento || null, ricorda_il: ricordaIl || null,
    }));
    const { data, error } = await supabaseClient.from('messages').insert(rows).select();
    if (error) throw new Error(this.error?.notInstalled ? this.error.message : 'Impossibile inviare il messaggio');
    // I messaggi a sé stessi arrivano anche dal canale: niente doppioni
    data.forEach(m => { if (!this._list.some(x => x.id === m.id)) this._list.unshift(m); });
    data.filter(m => m.destinatario === this._me() && this._arrivato(m)).forEach(m => this._seen.add(m.id));
    refreshMessagesUi();
  },

  async markRead(ids) {
    if (!ids.length) return;
    const now = new Date().toISOString();
    this._list.forEach(m => { if (ids.includes(m.id)) m.letto_at = now; });
    refreshMessagesUi();
    await supabaseClient.from('messages').update({ letto_at: now }).in('id', ids);
  },

  async remove(id) {
    const { error } = await supabaseClient.from('messages').delete().eq('id', id);
    if (error) throw new Error('Impossibile eliminare il messaggio');
    this._list = this._list.filter(m => m.id !== id);
    refreshMessagesUi();
  },

  // Avviso dentro il gestionale + notifica del computer se la scheda non è in primo piano
  _notify(m) {
    if (this._seen.has(m.id)) return;
    this._seen.add(m.id);
    const da = m.mittente === this._me() ? 'Promemoria' : m.mittente;
    showMessageToast(m, da);
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const n = new Notification(`${da} — T&C Factory`, { body: m.testo, tag: m.id });
        n.onclick = () => { window.focus(); openMessagesPanel(); n.close(); };
      } catch {}
    }
  },
};

window.Messages = Messages;

// ─────────────────────────────────────────────
// ELEMENTI ALLEGATI
// { tipo: 'ordine'|'cliente'|'prodotto'|'evento'|'pagina', id, label, hash }
// ─────────────────────────────────────────────

const MSG_REF_TIPI = {
  ordine:   { label: 'Ordine',   icon: () => Icons.package(13),      sezioni: ['ordini', 'dtf', 'esterne', 'planner', 'clienti', 'cassa', 'cestino'] },
  cliente:  { label: 'Cliente',  icon: () => Icons.users(13),        sezioni: ['clienti'] },
  prodotto: { label: 'Prodotto', icon: () => Icons.shirt(13),        sezioni: ['prodotti'] },
  evento:   { label: 'Evento',   icon: () => Icons.calendarDays(13), sezioni: ['planner'] },
  pagina:   { label: 'Pagina',   icon: () => Icons.link(13),         sezioni: [] },
};

// Gli elementi cliccabili si riconoscono da cosa aprono
const MSG_REF_PATTERNS = [
  [/openOrderDetail\('([^']+)'\)/,        'ordine'],
  [/Nav\.go\('clienti',\s*'([^']+)'\)/,   'cliente'],
  [/openProductForm\('([^']+)'\)/,        'prodotto'],
  [/openCalEventDialog\('([^']+)',/,      'evento'],
];

const MsgRef = {
  make(tipo, id) {
    const label =
      tipo === 'ordine'   ? (() => { const o = TCFactory.getOrderById(id); return o && `${TCFactory.orderCode(o)} · ${o.nome || ''}`.trim(); })() :
      tipo === 'cliente'  ? (() => { const c = TCFactory.getClient(id); return c && TCFactory.clientName(c); })() :
      tipo === 'prodotto' ? (() => { const p = TCFactory.getProduct(id); return p && TCFactory.productLabel(p); })() :
      tipo === 'evento'   ? TCFactory.getCalendarEvents().find(e => String(e.id) === String(id))?.title :
      null;
    return label ? { tipo, id: String(id), label } : null;
  },

  // Cosa c'è sotto il punto cliccato: un elemento riconosciuto, altrimenti la pagina
  fromElement(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const onclick = n.getAttribute?.('onclick') || '';
      for (const [re, tipo] of MSG_REF_PATTERNS) {
        const m = onclick.match(re);
        const ref = m && this.make(tipo, m[1]);
        if (ref) return { ref, node: n };
      }
      if (n.dataset?.product) { const ref = this.make('prodotto', n.dataset.product); if (ref) return { ref, node: n }; }
      if (n.id === 'order-detail-modal' && AppState.selectedOrder) {
        const ref = this.make('ordine', AppState.selectedOrder.id);
        if (ref) return { ref, node: n.querySelector('.modal') || n };
      }
    }
    if (Nav.current === 'clienti' && Nav.param) {
      const ref = this.make('cliente', Nav.param);
      if (ref) return { ref, node: document.querySelector('.view:not([hidden])') || el };
    }
    const node = el.closest('tr, li, button, a, .config-row, .glass-card, .modal') || el;
    const testo = (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const titolo = document.getElementById('toolbar-title')?.textContent?.trim() || 'Pagina';
    return { ref: { tipo: 'pagina', id: null, label: testo ? `${titolo} · ${testo}` : titolo, hash: location.hash || '#/' + Nav.current }, node };
  },

  sezione(ref) {
    return ref.tipo === 'pagina' ? (ref.hash || '').replace(/^#\/?/, '').split('/')[0] : null;
  },

  canOpen(ref) {
    const sezioni = ref.tipo === 'pagina' ? [this.sezione(ref)] : MSG_REF_TIPI[ref.tipo]?.sezioni || [];
    return sezioni.some(id => Nav.isAllowed(id));
  },

  open(ref) {
    if (!this.canOpen(ref)) { showToast('Non hai accesso a questa scheda', 'error'); return; }
    closeModal('msg-modal');
    if (ref.tipo === 'ordine') {
      if (!TCFactory.getOrderById(ref.id)) { showToast('Ordine non trovato', 'error'); return; }
      openOrderDetail(ref.id);
    } else if (ref.tipo === 'cliente') Nav.go('clienti', ref.id);
    else if (ref.tipo === 'prodotto') { Nav.go('prodotti'); if (TCFactory.getProduct(ref.id)) openProductForm(ref.id); else showToast('Prodotto non trovato', 'error'); }
    else if (ref.tipo === 'evento') { Nav.go('planner'); openCalEventDialog(ref.id, null); }
    else if (ref.hash) location.hash = ref.hash;
  },

  chip(ref, onclick) {
    const t = MSG_REF_TIPI[ref.tipo] || MSG_REF_TIPI.pagina;
    return `<button type="button" class="msg-ref" ${onclick ? `onclick="${onclick}"` : 'disabled'} title="${t.label}: ${escapeHtml(ref.label)}">
      ${t.icon()}<span><small>${t.label}</small> ${escapeHtml(ref.label)}</span></button>`;
  },
};

// ─────────────────────────────────────────────
// SELEZIONE DALLA SCHERMATA
// ─────────────────────────────────────────────

const MsgPicker = {
  active: false,
  _onPick: null,
  _onCancel: null,

  start(onPick, onCancel) {
    this.active = true;
    this._onPick = onPick;
    this._onCancel = onCancel;
    document.querySelector('.profile-menu')?.remove();
    Nav.closeDrawer();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="msg-pick-box" class="msg-pick-box" hidden><span></span></div>
      <div id="msg-pick-banner" class="msg-pick-banner" role="status">
        ${Icons.messageCircle(16)} <span>Tocca l'elemento da inviare</span>
        <button type="button" class="btn btn-secondary btn-sm" onclick="MsgPicker.cancel()">Annulla</button>
      </div>`);
    document.documentElement.classList.add('msg-picking');
    document.addEventListener('mousemove', this._move, true);
    document.addEventListener('mousedown', this._block, true);
    document.addEventListener('click', this._click, true);
    document.addEventListener('keydown', this._key, true);
  },

  _end() {
    this.active = false;
    document.documentElement.classList.remove('msg-picking');
    document.getElementById('msg-pick-box')?.remove();
    document.getElementById('msg-pick-banner')?.remove();
    document.removeEventListener('mousemove', this._move, true);
    document.removeEventListener('mousedown', this._block, true);
    document.removeEventListener('click', this._click, true);
    document.removeEventListener('keydown', this._key, true);
  },

  cancel() { this._end(); this._onCancel?.(); },

  _inBanner: (e) => !!e.target.closest?.('#msg-pick-banner'),

  _move(e) {
    if (MsgPicker._inBanner(e)) return;
    const box = document.getElementById('msg-pick-box');
    if (!box) return;
    const { ref, node } = MsgRef.fromElement(e.target);
    const r = node.getBoundingClientRect();
    Object.assign(box.style, { top: `${r.top - 3}px`, left: `${r.left - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    box.querySelector('span').textContent = `${MSG_REF_TIPI[ref.tipo].label}: ${ref.label}`;
    box.hidden = false;
  },

  _block(e) { if (!MsgPicker._inBanner(e)) e.preventDefault(); },

  _click(e) {
    if (MsgPicker._inBanner(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const { ref } = MsgRef.fromElement(e.target);
    const onPick = MsgPicker._onPick;
    MsgPicker._end();
    onPick?.(ref);
  },

  _key(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    MsgPicker.cancel();
  },
};

window.MsgPicker = MsgPicker;

// ─────────────────────────────────────────────
// PANNELLO MESSAGGI
// ─────────────────────────────────────────────

const MsgState = { tab: 'ricevuti' };

const msgWhen = (iso) => {
  const d = new Date(iso);
  const oggi = new Date().toDateString() === d.toDateString();
  return oggi ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// Contatore sul pulsante chat e pannello aperto sempre aggiornati
function refreshMessagesUi() {
  if (!TCAuth.isLoggedIn()) return;
  renderSidebar();
  if (document.getElementById('msg-modal')?.classList.contains('active')) renderMessagesPanel();
}

function messagesButton(cls = 'sidebar-msg-btn') {
  const n = Messages.unreadCount();
  return `<button type="button" class="${cls}" onclick="closeModal('more-sheet');openMessagesPanel()"
      aria-label="Messaggi${n ? ` (${n} da leggere)` : ''}" title="Messaggi e promemoria">
    ${Icons.messageCircle(18)}${n ? `<span class="msg-badge">${n > 99 ? '99+' : n}</span>` : ''}
  </button>`;
}

function openMessagesPanel(tab) {
  if (tab) MsgState.tab = tab;
  const modal = document.getElementById('msg-modal');
  renderMessagesPanel();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('msg-modal'); };
  if (!Messages.loaded) Messages.load();
}

function renderMessagesPanel() {
  const modal = document.getElementById('msg-modal');
  const me = TCAuth.getNickname();
  const ricevuti = MsgState.tab === 'ricevuti';
  const list = ricevuti ? Messages.received() : Messages.sent();
  const unreadIds = ricevuti ? list.filter(m => !m.letto_at).map(m => m.id) : [];
  const unread = Messages.unreadCount();
  const askNotify = 'Notification' in window && Notification.permission === 'default';

  const item = (m) => {
    const programmato = !Messages._arrivato(m);
    const toSelf = m.mittente === m.destinatario;
    const head = ricevuti
      ? (toSelf ? 'Promemoria' : escapeHtml(m.mittente))
      : (toSelf ? 'Promemoria per te' : `A ${escapeHtml(m.destinatario)}`);
    return `
      <li class="msg-item ${ricevuti && !m.letto_at ? 'unread' : ''}">
        <div class="msg-item-head">
          <strong>${head}</strong>
          <span>${programmato ? `${Icons.clock(12)} arriva ${msgWhen(m.ricorda_il)}` : msgWhen(Messages._arrivo(m))}${!ricevuti && !programmato && m.letto_at && !toSelf ? ' · letto' : ''}</span>
        </div>
        <div class="msg-item-text">${escapeHtml(m.testo)}</div>
        ${m.riferimento ? MsgRef.chip(m.riferimento, `MsgRef.open(Messages._list.find(x=>x.id==='${m.id}').riferimento)`) : ''}
        <div class="msg-item-actions">
          ${ricevuti && !toSelf ? `<button type="button" class="btn btn-ghost btn-sm" onclick="replyToMessage('${m.id}')">Rispondi</button>` : ''}
          ${m.mittente === me ? `<button type="button" class="btn btn-ghost btn-sm" onclick="deleteMessageConfirm('${m.id}')">${programmato ? 'Annulla promemoria' : 'Elimina'}</button>` : ''}
        </div>
      </li>`;
  };

  modal.innerHTML = `
    <div class="modal msg-panel" style="max-width:520px;" role="dialog" aria-modal="true" aria-labelledby="msg-title">
      <div class="modal-header">
        <h2 id="msg-title">Messaggi</h2>
        <button class="btn-icon" onclick="closeModal('msg-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body" style="gap:12px;">
        <div class="msg-actions">
          <button type="button" class="btn btn-primary" onclick="startMessagePick()">${Icons.magic(15)} Seleziona dalla schermata</button>
          <button type="button" class="btn btn-secondary" onclick="openMessageComposer()">${Icons.edit(15)} Scrivi</button>
        </div>
        ${askNotify ? `<button type="button" class="btn btn-ghost btn-sm" style="align-self:flex-start;" onclick="enableMessageNotifications()">${Icons.zap(13)} Avvisami anche con le notifiche del computer</button>` : ''}
        <div class="segmented" role="tablist" aria-label="Messaggi">
          <button type="button" role="tab" aria-selected="${ricevuti}" class="${ricevuti ? 'active' : ''}" onclick="MsgState.tab='ricevuti';renderMessagesPanel()">Ricevuti${unread ? ` (${unread})` : ''}</button>
          <button type="button" role="tab" aria-selected="${!ricevuti}" class="${!ricevuti ? 'active' : ''}" onclick="MsgState.tab='inviati';renderMessagesPanel()">Inviati</button>
        </div>
        ${Messages.error ? `<div class="settings-section-hint" style="margin:0;">${escapeHtml(Messages.error.message)}${Messages.error.notInstalled ? ' (esegui sql/messaggi.sql su Supabase)' : ''}</div>`
          : !Messages.loaded ? `<div class="settings-section-hint" style="margin:0;">Caricamento…</div>`
          : list.length ? `<ul class="msg-list">${list.map(item).join('')}</ul>`
          : `<div class="settings-section-hint" style="margin:0;">${ricevuti ? 'Nessun messaggio ricevuto.' : 'Non hai ancora mandato messaggi.'}</div>`}
      </div>
    </div>`;
  // Restano evidenziati finché il pannello è aperto, ma risultano letti
  if (unreadIds.length) setTimeout(() => Messages.markRead(unreadIds).catch(() => {}), 1500);
}

async function enableMessageNotifications() {
  try { await Notification.requestPermission(); } catch {}
  renderMessagesPanel();
}

async function deleteMessageConfirm(id) {
  const m = Messages._list.find(x => x.id === id);
  if (!m || !confirm(Messages._arrivato(m) ? 'Eliminare il messaggio anche per chi lo ha ricevuto?' : 'Annullare il promemoria?')) return;
  try { await Messages.remove(id); showToast(Messages._arrivato(m) ? 'Messaggio eliminato' : 'Promemoria annullato'); }
  catch (e) { showToast(e.message, 'error'); }
}

function replyToMessage(id) {
  const m = Messages._list.find(x => x.id === id);
  if (m) openMessageComposer({ destinatari: [m.mittente], riferimento: m.riferimento });
}

// Avviso cliccabile che resta qualche secondo in più di un toast normale
function showMessageToast(m, da) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('button');
  toast.type = 'button';
  toast.className = 'toast msg-toast';
  toast.innerHTML = `${Icons.messageCircle(16)}<span><strong>${escapeHtml(da)}</strong> ${escapeHtml(m.testo.length > 90 ? m.testo.slice(0, 90) + '…' : m.testo)}</span>`;
  toast.onclick = () => { toast.remove(); openMessagesPanel('ricevuti'); };
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastIn 0.25s ease reverse';
    setTimeout(() => toast.remove(), 250);
  }, 8000);
}

// ─────────────────────────────────────────────
// NUOVO MESSAGGIO
// ─────────────────────────────────────────────

let _msgDraft = null;   // { destinatari: Set, riferimento, testo, promemoria, ricordaIl }
let _msgUsers = [];

const msgLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function startMessagePick() {
  closeModal('msg-modal');
  MsgPicker.start((ref) => openMessageComposer({ riferimento: ref }));
}

async function openMessageComposer(prefill = {}) {
  closeModal('msg-modal');
  _msgDraft = {
    destinatari: new Set(prefill.destinatari || []),
    riferimento: prefill.riferimento || null,
    testo: '', promemoria: false,
    ricordaIl: msgLocalInput(new Date(Date.now() + 3600000)),
  };
  _msgUsers = (await TCAuth.listUsers().catch(() => [])).map(u => u.nickname);
  renderMessageComposer();
  setTimeout(() => document.getElementById('mc-testo')?.focus(), 50);
}

// Riprende la bozza dopo aver scelto un elemento dalla schermata
function pickForComposer() {
  closeModal('msg-compose-modal');
  MsgPicker.start((ref) => { _msgDraft.riferimento = ref; renderMessageComposer(); },
                  () => renderMessageComposer());
}

function renderMessageComposer() {
  const d = _msgDraft;
  const me = TCAuth.getNickname();
  const modal = document.getElementById('msg-compose-modal');
  const people = [me, ..._msgUsers.filter(u => u !== me)];
  modal.innerHTML = `
    <div class="modal" style="max-width:500px;" role="dialog" aria-modal="true" aria-labelledby="mc-title">
      <div class="modal-header">
        <h2 id="mc-title">Nuovo messaggio</h2>
        <button class="btn-icon" onclick="closeModal('msg-compose-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body" style="gap:14px;" onsubmit="event.preventDefault();submitMessageComposer()">
        <div class="form-group">
          <span class="form-label">A chi</span>
          <div class="chip-picker" role="group" aria-label="Destinatari">
            ${people.map(u => `
              <button type="button" class="chip chip-btn msg-to ${d.destinatari.has(u) ? 'active' : ''}" aria-pressed="${d.destinatari.has(u)}"
                onclick="toggleMessageTo('${escapeHtml(u)}')">${u === me ? 'Me stesso' : escapeHtml(u)}</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <span class="form-label">Elemento</span>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${d.riferimento ? `${MsgRef.chip(d.riferimento)}
              <button type="button" class="btn-icon" onclick="_msgDraft.riferimento=null;renderMessageComposer()" aria-label="Togli l'elemento">${Icons.x(14)}</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" onclick="pickForComposer()">${Icons.magic(13)} ${d.riferimento ? 'Cambia' : 'Seleziona dalla schermata'}</button>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="mc-testo">Messaggio</label>
          <textarea id="mc-testo" class="form-textarea" rows="4" maxlength="2000" required placeholder="Scrivi qualcosa…"
            oninput="_msgDraft.testo=this.value">${escapeHtml(d.testo)}</textarea>
        </div>
        <label class="switch-row" style="padding:0;">
          <span><strong>Promemoria</strong><small>Arriva solo al giorno e all'ora scelti</small></span>
          <input type="checkbox" class="switch" ${d.promemoria ? 'checked' : ''} onchange="_msgDraft.promemoria=this.checked;renderMessageComposer()">
        </label>
        ${d.promemoria ? `<input type="datetime-local" class="form-input" aria-label="Quando arriva" value="${d.ricordaIl}"
            min="${msgLocalInput(new Date())}" onchange="_msgDraft.ricordaIl=this.value">` : ''}
        <div style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal('msg-compose-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="mc-send">${d.promemoria ? 'Programma' : 'Invia'}</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('msg-compose-modal'); };
}

function toggleMessageTo(u) {
  if (_msgDraft.destinatari.has(u)) _msgDraft.destinatari.delete(u); else _msgDraft.destinatari.add(u);
  renderMessageComposer();
}

async function submitMessageComposer() {
  const d = _msgDraft;
  if (!d.destinatari.size) { showToast('Scegli almeno un destinatario', 'error'); return; }
  if (!d.testo.trim()) { showToast('Scrivi il messaggio', 'error'); return; }
  let ricordaIl = null;
  if (d.promemoria) {
    const t = new Date(d.ricordaIl);
    if (isNaN(t) || t <= new Date()) { showToast('Scegli un momento futuro per il promemoria', 'error'); return; }
    ricordaIl = t.toISOString();
  }
  const btn = document.getElementById('mc-send');
  btn.disabled = true;
  try {
    await Messages.send([...d.destinatari], d.testo, d.riferimento, ricordaIl);
    closeModal('msg-compose-modal');
    showToast(ricordaIl ? `Promemoria programmato per ${msgWhen(ricordaIl)}` : 'Messaggio inviato');
  } catch (e) { showToast(e.message, 'error'); btn.disabled = false; }
}
