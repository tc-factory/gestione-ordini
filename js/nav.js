/**
 * T&C Factory — Navigazione laterale
 * Navbar, routing tra sezioni (via #hash) e pagine non ancora implementate.
 */

// ─────────────────────────────────────────────
// VOCI DELLA NAVBAR
// ─────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'planner',      label: 'Planner',       subtitle: 'Calendario aziendale',          icon: () => Icons.calendarDays(19) },
  { id: 'ordini',       label: 'Ordini',        subtitle: 'Lista e avanzamento ordini',    icon: () => Icons.package(19) },
  { id: 'clienti',      label: 'Clienti',       subtitle: 'Anagrafica clienti',            icon: () => Icons.users(19) },
  { id: 'cassa',        label: 'Cassa',         subtitle: 'Incassi e pagamenti',           icon: () => Icons.wallet(19), allowed: () => TCAuth.canViewEconomics() },
  { id: 'staff',        label: 'Staff',         subtitle: 'Account e registro modifiche',  icon: () => Icons.idBadge(19), allowed: () => TCAuth.isAdmin() },
  { id: 'impostazioni', label: 'Impostazioni',  subtitle: 'Priorità, tag e preferenze',    icon: () => Icons.settings(19) },
];

// Voci in fondo alla navbar, una a fianco all'altra
const NAV_FOOTER_ITEMS = [
  { id: 'cestino',  label: 'Cestino',  subtitle: 'Ordini eliminati negli ultimi 7 giorni', icon: () => Icons.trash(17) },
  { id: 'supporto', label: 'Supporto', subtitle: 'Segnalazioni e richieste di aiuto',      icon: () => Icons.lifeBuoy(17) },
];

const DEFAULT_VIEW = 'ordini';

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────

const Nav = {
  current: null,
  param: null,          // sotto-pagina, es. l'id del cliente in #/clienti/<id>
  _focusTitle: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;
    window.addEventListener('hashchange', () => this.show(this._fromHash(), this._paramFromHash()));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) this.closeDrawer();
    });
    this.show(this._fromHash(), this._paramFromHash());
  },

  _hashParts()     { return location.hash.replace(/^#\/?/, '').split('/'); },
  _fromHash()      { return this._hashParts()[0] || DEFAULT_VIEW; },
  _paramFromHash() { return this._hashParts().slice(1).join('/') || null; },

  _item(id) { return [...NAV_ITEMS, ...NAV_FOOTER_ITEMS].find(i => i.id === id); },

  isAllowed(id) {
    const item = this._item(id);
    return !!item && (!item.allowed || item.allowed());
  },

  go(id, param = null) {
    this._focusTitle = true;
    const hash = '#/' + id + (param ? '/' + param : '');
    if (location.hash === hash) this.show(id, param);
    else location.hash = hash;
  },

  show(id, param = null) {
    if (!this.isAllowed(id)) { id = DEFAULT_VIEW; param = null; }
    const changed = this.current !== id || this.param !== param;
    this.current = id;
    this.param = param;

    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== id; });
    renderSidebar();
    renderHeader();
    if (changed) renderCurrentView();
    this.closeDrawer();

    if (this._focusTitle) {
      this._focusTitle = false;
      document.getElementById('toolbar-title')?.focus({ preventScroll: true });
    }
    if (changed) window.scrollTo({ top: 0 });
  },

  // Navbar a scomparsa su schermi piccoli
  openDrawer() {
    document.body.classList.add('drawer-open');
    document.querySelector('.sidebar .nav-item[aria-current="page"]')?.focus();
  },
  closeDrawer() { document.body.classList.remove('drawer-open'); },
};

window.Nav = Nav;

// Rende le sezioni che caricano dati propri solo quando vengono aperte
function renderCurrentView() {
  switch (Nav.current) {
    case 'planner':      renderCalendarSection(); break;
    case 'clienti':      renderClientsPage(); break;
    case 'cassa':        renderCassaPage(); break;
    case 'staff':        renderStaffPage(); break;
    case 'impostazioni': renderSettingsDialog(); break;
    case 'cestino':      renderCestinoPage(); break;
    case 'supporto':     renderComingSoon('supporto-root', 'supporto'); break;
  }
}

// ─────────────────────────────────────────────
// NAVBAR
// ─────────────────────────────────────────────

function renderSidebar() {
  const root = document.getElementById('sidebar-root');
  if (!root) return;

  const badges = {
    ordini:  TCFactory.getActiveOrders().length,
    cestino: TCFactory.getTrashedOrders().length,
  };

  const navLink = (item) => {
    const active = Nav.current === item.id;
    const badge  = badges[item.id];
    return `
      <a href="#/${item.id}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}
         onclick="event.preventDefault();Nav.go('${item.id}')">
        <span class="nav-item-icon">${item.icon()}</span>
        <span class="nav-item-label">${item.label}</span>
        ${badge ? `<span class="nav-item-badge" aria-label="${badge} elementi">${badge}</span>` : ''}
      </a>`;
  };

  const visible = NAV_ITEMS.filter(i => Nav.isAllowed(i.id));
  const isDark  = Theme.get() === 'dark';
  const nick    = TCAuth.getNickname();
  const role    = TCAuth.isAdmin() ? 'Admin' : 'Staff';

  root.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-logo" aria-hidden="true">${Icons.logoPlaceholder(26)}</div>
      <div class="brand-text">
        <strong>T&amp;C Factory</strong>
        <span>Gestione ordini</span>
      </div>
      <button class="btn-icon sidebar-close" onclick="Nav.closeDrawer()" aria-label="Chiudi menu">${Icons.x()}</button>
    </div>

    <nav class="sidebar-nav">
      ${visible.map(navLink).join('')}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-user">
        <span class="user-avatar" aria-hidden="true">${escapeHtml(nick.charAt(0).toUpperCase())}</span>
        <div class="user-text">
          <strong>${escapeHtml(nick)}</strong>
          <span>${role}</span>
        </div>
        <button class="btn-icon" onclick="Theme.toggle()" aria-label="${isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'}" title="Cambia tema">${isDark ? Icons.sun(16) : Icons.moon(16)}</button>
        <button class="btn-icon" onclick="doLogout()" aria-label="Esci" title="Esci">${Icons.logOut(16)}</button>
      </div>
      <div class="sidebar-footer-pair">
        ${NAV_FOOTER_ITEMS.map(navLink).join('')}
      </div>
    </div>
  `;
}

// Barra in alto: titolo della sezione + azioni contestuali
function renderHeader() {
  const root = document.getElementById('header-root');
  if (!root) return;
  const item = Nav._item(Nav.current) || Nav._item(DEFAULT_VIEW);

  const actions = Nav.current === 'ordini'
    ? `<button class="btn btn-primary" onclick="openOrderForm()">${Icons.plus()} <span class="new-order-btn-text">Nuovo ordine</span></button>`
    : Nav.current === 'planner'
    ? `<button class="btn btn-primary" onclick="openCalEventDialog(null,null)">${Icons.plus()} <span class="new-order-btn-text">Nuovo evento</span></button>`
    : Nav.current === 'clienti' && !Nav.param && TCFactory.isClientsAvailable()
    ? `<button class="btn btn-primary" onclick="openClientForm()">${Icons.plus()} <span class="new-order-btn-text">Nuovo cliente</span></button>`
    : '';

  root.innerHTML = `
    <button class="btn-icon menu-toggle" onclick="Nav.openDrawer()" aria-label="Apri menu">${Icons.menu()}</button>
    <div class="toolbar-title">
      <h1 id="toolbar-title" tabindex="-1">${item.label}</h1>
      <p>${item.subtitle}</p>
    </div>
    <div class="app-header-actions">${actions}</div>
  `;
}

// ─────────────────────────────────────────────
// PAGINE
// ─────────────────────────────────────────────

function renderStaffPage() {
  const root = document.getElementById('staff-root');
  if (!root) return;
  root.innerHTML = `
    <div class="page-grid">
      <div class="glass-card page-card">
        <div class="page-card-head">${Icons.users(16)} <h2>Account</h2></div>
        <div id="users-section-body" class="page-card-body"></div>
      </div>
      <div class="glass-card page-card">
        <div class="page-card-head">${Icons.clock(16)} <h2>Registro modifiche</h2></div>
        <div id="log-section-body" class="page-card-body"></div>
      </div>
    </div>`;
  renderUsersSection(document.getElementById('users-section-body'));
  renderLogSection(document.getElementById('log-section-body'));
}

function renderCestinoPage() {
  const root = document.getElementById('cestino-root');
  if (!root) return;
  if (!document.getElementById('cestino-body')) {
    root.innerHTML = `
      <div class="glass-card page-card page-narrow">
        <div id="cestino-body" class="page-card-body"></div>
      </div>`;
  }
  renderCestinoSection(document.getElementById('cestino-body'));
}

const COMING_SOON = {
  supporto: {
    icon: () => Icons.lifeBuoy(28),
    title: 'Supporto',
    text: () => TCAuth.isAdmin()
      ? 'Qui vedrai i ticket di supporto aperti dallo staff.'
      : 'Qui potrai aprire un ticket per segnalare un problema o chiedere aiuto. Lo vedrà solo l\'amministratore.',
  },
};

function renderComingSoon(rootId, key) {
  const root = document.getElementById(rootId);
  const cfg  = COMING_SOON[key];
  if (!root || !cfg) return;
  const text = typeof cfg.text === 'function' ? cfg.text() : cfg.text;
  root.innerHTML = `
    <div class="glass-card empty-state">
      <div class="empty-state-icon" aria-hidden="true">${cfg.icon()}</div>
      <h2>${cfg.title}</h2>
      <p>${text}</p>
      <span class="chip" style="background:color-mix(in srgb, var(--brand-gold) 12%, transparent);color:var(--brand-gold);">In arrivo</span>
    </div>`;
}
