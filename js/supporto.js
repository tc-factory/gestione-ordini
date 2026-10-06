/**
 * T&C Factory — Supporto
 * Utenti (non admin): aprono ticket e ne seguono lo stato.
 * Admin: vedono tutti i ticket e li segnano Da fare / In lavorazione / Risolto.
 * I ticket passano solo dalle funzioni tc_ticket_* (sql/supporto-setup.sql),
 * che verificano nickname e password: la tabella non è leggibile direttamente.
 */

const TICKET_STATI = [
  { id: 'da_fare',        label: 'Da fare',        color: '#ef4444' },
  { id: 'in_lavorazione', label: 'In lavorazione', color: '#f59e0b' },
  { id: 'risolto',        label: 'Risolto',        color: '#22c55e' },
];
const TICKET_CATEGORIE = [
  { id: 'problema',  label: 'Problema',  emoji: '🐞' },
  { id: 'richiesta', label: 'Richiesta', emoji: '💡' },
  { id: 'altro',     label: 'Altro',     emoji: '💬' },
];
const TICKETS_POLL_MS = 60000;

const Tickets = {
  _list: [],
  loaded: false,
  error: null,
  _timer: null,

  _creds() {
    const u = TCAuth.getUser();
    if (!u?._pwd) throw new Error('Sessione scaduta — effettua di nuovo il login');
    return { p_nick: u.nickname, p_pwd: u._pwd };
  },

  async _rpc(fn, args = {}) {
    const { data, error } = await supabaseClient.rpc(fn, { ...this._creds(), ...args });
    if (error) {
      // Funzione assente: lo script SQL non è ancora stato eseguito
      if (error.code === 'PGRST202' || /function .* does not exist|Could not find the function/i.test(error.message)) {
        throw Object.assign(new Error('Supporto non ancora attivato sul database'), { notInstalled: true });
      }
      throw new Error('Errore di connessione');
    }
    if (!data?.success) throw new Error(data?.error || 'Errore');
    return data;
  },

  async load() {
    try {
      const data = await this._rpc('tc_ticket_list');
      this._list = data.tickets || [];
      this.error = null;
    } catch (e) {
      this.error = e;
    }
    this.loaded = true;
    return this._list;
  },

  async create(oggetto, descrizione, categoria) {
    await this._rpc('tc_ticket_create', { p_oggetto: oggetto, p_descrizione: descrizione, p_categoria: categoria });
    await this.load();
  },

  async setStatus(id, stato) {
    await this._rpc('tc_ticket_set_status', { p_id: id, p_stato: stato });
    const t = this._list.find(x => x.id === id);
    if (t) Object.assign(t, { stato, updated_at: new Date().toISOString(), updated_by: TCAuth.getNickname() });
  },

  get(id)        { return this._list.find(t => t.id === id); },
  countOpen()    { return this._list.filter(t => t.stato === 'da_fare').length; },

  // L'admin riceve i nuovi ticket con un controllo periodico (la tabella non è in realtime)
  startPolling() {
    this.stopPolling();
    if (!TCAuth.isLoggedIn()) return;
    this.load().then(() => { renderSidebar(); if (Nav.current === 'supporto') renderSupportPage(); });
    if (!TCAuth.isAdmin()) return;
    this._timer = setInterval(async () => {
      const before = this.countOpen();
      await this.load();
      renderSidebar();
      if (Nav.current === 'supporto') renderSupportPage();
      const now = this.countOpen();
      if (now > before) showToast(now - before === 1 ? 'Nuovo ticket di supporto' : `${now - before} nuovi ticket di supporto`);
    }, TICKETS_POLL_MS);
  },
  stopPolling() { clearInterval(this._timer); this._timer = null; },
};

window.Tickets = Tickets;

const SupportState = {
  filter: 'da_fare',       // filtro admin: stato o 'tutti'
  categoria: 'problema',   // categoria scelta nel modulo nuovo ticket
};

const ticketStato = (id) => TICKET_STATI.find(s => s.id === id) || TICKET_STATI[0];
const ticketCat   = (id) => TICKET_CATEGORIE.find(c => c.id === id) || TICKET_CATEGORIE[2];
const fmtDateTime = (iso) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// ─────────────────────────────────────────────
// PAGINA
// ─────────────────────────────────────────────

async function openSupportPage() {
  renderSupportPage();
  await Tickets.load();
  renderSupportPage();
  renderSidebar();
}

function renderSupportPage() {
  const root = document.getElementById('supporto-root');
  if (!root) return;

  if (Tickets.error?.notInstalled) {
    root.innerHTML = `
      <div class="glass-card empty-state">
        <div class="empty-state-icon" aria-hidden="true">${Icons.lifeBuoy(28)}</div>
        <h2>Supporto da attivare</h2>
        <p>Esegui lo script <strong>sql/supporto-setup.sql</strong> su Supabase, poi ricarica la pagina.</p>
      </div>`;
    return;
  }
  root.innerHTML = TCAuth.isAdmin() ? renderAdminTickets() : renderUserSupport();
}

// ── Utente: nuovo ticket + i miei ticket ──

function renderUserSupport() {
  const mine = Tickets._list;
  return `
    <div class="support-grid">
      <div class="glass-card page-card">
        <div class="page-card-head">${Icons.lifeBuoy(16)} <h2>Apri un ticket</h2></div>
        <form class="page-card-body support-form" onsubmit="event.preventDefault();submitTicket()">
          <div class="form-group">
            <span class="form-label" id="tk-cat-label">Tipo</span>
            <div class="segmented" role="radiogroup" aria-labelledby="tk-cat-label">
              ${TICKET_CATEGORIE.map(c => `<button type="button" role="radio" aria-checked="${SupportState.categoria === c.id}"
                class="${SupportState.categoria === c.id ? 'active' : ''}" onclick="setTicketCategoria('${c.id}')">${c.emoji} ${c.label}</button>`).join('')}
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="tk-oggetto">Oggetto *</label>
            <input id="tk-oggetto" class="form-input" maxlength="200" placeholder="es. Non riesco a caricare un allegato" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="tk-descrizione">Descrizione</label>
            <textarea id="tk-descrizione" class="form-textarea" maxlength="5000" rows="6"
              placeholder="Cosa stavi facendo, cosa ti aspettavi e cosa è successo invece."></textarea>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="settings-section-hint" style="margin:0;">Il ticket lo vede solo l'amministratore.</span>
            <button type="submit" id="tk-send" class="btn btn-primary" style="margin-left:auto;">Invia ticket</button>
          </div>
        </form>
      </div>

      <div class="glass-card page-card">
        <div class="page-card-head">${Icons.clock(16)} <h2>I miei ticket</h2>
          <span class="table-count">${mine.length}</span></div>
        ${!Tickets.loaded ? `<div class="empty-list">Caricamento…</div>` :
          Tickets.error ? `<div class="empty-list">${escapeHtml(Tickets.error.message)}</div>` :
          mine.length === 0 ? `<div class="empty-list">Non hai ancora aperto ticket.</div>` :
          `<div class="ticket-list">${mine.map(t => renderTicketCard(t, false)).join('')}</div>`}
      </div>
    </div>`;
}

function setTicketCategoria(id) {
  SupportState.categoria = id;
  // Aggiorna solo il selettore, senza perdere il testo già scritto
  document.querySelectorAll('.support-form .segmented button').forEach((b, i) => {
    const on = TICKET_CATEGORIE[i].id === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
}

async function submitTicket() {
  const oggetto = document.getElementById('tk-oggetto')?.value.trim();
  const descrizione = document.getElementById('tk-descrizione')?.value.trim() || '';
  if (!oggetto) { document.getElementById('tk-oggetto')?.focus(); showToast('Inserisci un oggetto', 'error'); return; }

  const btn = document.getElementById('tk-send');
  if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }
  try {
    await Tickets.create(oggetto, descrizione, SupportState.categoria);
    showToast('Ticket inviato all\'amministratore');
    SupportState.categoria = 'problema';
    renderSupportPage();
  } catch (e) {
    showToast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Invia ticket'; }
  }
}

// ── Admin: ticket per stato ──

function renderAdminTickets() {
  const all = Tickets._list;
  const counts = Object.fromEntries(TICKET_STATI.map(s => [s.id, all.filter(t => t.stato === s.id).length]));
  const list = (SupportState.filter === 'tutti' ? all : all.filter(t => t.stato === SupportState.filter))
    // Da fare: prima i più vecchi; negli altri: prima i più recenti
    .slice().sort((a, b) => SupportState.filter === 'da_fare'
      ? a.created_at.localeCompare(b.created_at)
      : (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));

  const tabs = [...TICKET_STATI.map(s => [s.id, s.label, counts[s.id]]), ['tutti', 'Tutti', all.length]];
  return `
    <div class="glass-card page-card">
      <div class="table-toolbar">
        <div class="segmented" role="tablist" aria-label="Stato ticket">
          ${tabs.map(([id, label, n]) => `<button role="tab" aria-selected="${SupportState.filter === id}" class="${SupportState.filter === id ? 'active' : ''}"
            onclick="SupportState.filter='${id}';renderSupportPage()">${label} · ${n}</button>`).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto;" onclick="openSupportPage()">↻ Aggiorna</button>
      </div>
      ${!Tickets.loaded ? `<div class="empty-list">Caricamento…</div>` :
        Tickets.error ? `<div class="empty-list">${escapeHtml(Tickets.error.message)}</div>` :
        list.length === 0 ? `<div class="empty-list">${SupportState.filter === 'da_fare' ? 'Nessun ticket da fare. 🎉' : 'Nessun ticket.'}</div>` :
        `<div class="ticket-list ticket-list-admin">${list.map(t => renderTicketCard(t, true)).join('')}</div>`}
    </div>`;
}

function renderTicketCard(t, isAdmin) {
  const st  = ticketStato(t.stato);
  const cat = ticketCat(t.categoria);
  return `
    <article class="ticket-card" style="--st:${st.color};">
      <div class="ticket-head">
        <span class="ticket-cat">${cat.emoji} ${cat.label}</span>
        <h3>${escapeHtml(t.oggetto)}</h3>
        ${isAdmin ? '' : `<span class="ticket-status">${st.label}</span>`}
      </div>
      <div class="ticket-meta">
        ${isAdmin ? `<strong>${escapeHtml(t.created_by)}</strong> · ` : ''}aperto ${fmtDateTime(t.created_at)}
        ${t.stato !== 'da_fare' && t.updated_by ? ` · ${st.label.toLowerCase()} da ${escapeHtml(t.updated_by)}` : ''}
      </div>
      ${t.descrizione ? `<p class="ticket-desc">${escapeHtml(t.descrizione)}</p>` : ''}
      ${isAdmin ? `
        <div class="segmented ticket-actions" role="radiogroup" aria-label="Stato del ticket">
          ${TICKET_STATI.map(s => `<button type="button" role="radio" aria-checked="${t.stato === s.id}" class="${t.stato === s.id ? 'active' : ''}"
            style="--st:${s.color};" onclick="setTicketStatus('${t.id}','${s.id}')">${s.label}</button>`).join('')}
        </div>` : ''}
    </article>`;
}

async function setTicketStatus(id, stato) {
  const t = Tickets.get(id);
  if (!t || t.stato === stato) return;
  try {
    await Tickets.setStatus(id, stato);
    showToast(`Ticket segnato come "${ticketStato(stato).label}"`);
    renderSupportPage();
    renderSidebar();
  } catch (e) { showToast(e.message, 'error'); }
}
