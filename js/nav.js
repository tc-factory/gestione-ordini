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

// Navbar ridotta a sole icone (solo computer); la scelta resta salvata nel browser
const SidebarCollapse = {
  KEY: 'tcf_sidebar_collapsed',
  get() { try { return localStorage.getItem(this.KEY) === '1'; } catch { return false; } },
  apply() { document.documentElement.classList.toggle('sidebar-collapsed', this.get()); },
  toggle() {
    try { localStorage.setItem(this.KEY, this.get() ? '0' : '1'); } catch {}
    this.apply();
    renderSidebar();
    document.querySelector('.sidebar-collapse-btn')?.focus();
  },
};
SidebarCollapse.apply();

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
    if (changed) { window.scrollTo({ top: 0 }); document.getElementById('main-content')?.scrollTo({ top: 0 }); }
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
    case 'supporto':     openSupportPage(); break;
  }
}

// ─────────────────────────────────────────────
// NAVBAR
// ─────────────────────────────────────────────

function navBadges() {
  return {
    ordini:  TCFactory.getActiveOrders().length,
    cestino: TCFactory.getTrashedOrders().length,
    supporto: TCAuth.isAdmin() ? Tickets.countOpen() : 0,   // ticket da fare
  };
}

function renderSidebar() {
  renderBottomNav();
  const root = document.getElementById('sidebar-root');
  if (!root) return;

  const badges = navBadges();

  const navLink = (item) => {
    const active = Nav.current === item.id;
    const badge  = badges[item.id];
    return `
      <a href="#/${item.id}" class="nav-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}
         ${collapsed ? `title="${item.label}${badge ? ` (${badge})` : ''}" aria-label="${item.label}"` : ''}
         onclick="event.preventDefault();Nav.go('${item.id}')">
        <span class="nav-item-icon">${item.icon()}</span>
        <span class="nav-item-label">${item.label}</span>
        ${badge ? `<span class="nav-item-badge" aria-label="${badge} elementi">${badge}</span>` : ''}
      </a>`;
  };

  const visible = NAV_ITEMS.filter(i => Nav.isAllowed(i.id));
  const collapsed = SidebarCollapse.get();

  root.innerHTML = `
    <div class="sidebar-brand">
      <div class="brand-logo" aria-hidden="true">${Icons.logoPlaceholder(26)}</div>
      <div class="brand-text">
        <strong>T&amp;C Factory</strong>
        <span>Gestione ordini</span>
      </div>
      <button class="btn-icon sidebar-close" onclick="Nav.closeDrawer()" aria-label="Chiudi menu">${Icons.x()}</button>
      <button class="btn-icon sidebar-theme-btn" onclick="Theme.toggle()"
        aria-label="${Theme.get() === 'dark' ? 'Passa al tema chiaro' : 'Passa al tema scuro'}"
        title="${Theme.get() === 'dark' ? 'Tema chiaro' : 'Tema scuro'}">${Theme.get() === 'dark' ? Icons.sun(18) : Icons.moon(18)}</button>
      <button class="btn-icon sidebar-collapse-btn" onclick="SidebarCollapse.toggle()"
        aria-label="${collapsed ? 'Espandi la navbar' : 'Riduci la navbar'}" aria-expanded="${!collapsed}"
        title="${collapsed ? 'Espandi' : 'Riduci'}">${collapsed ? Icons.panelOpen(18) : Icons.panelClose(18)}</button>
    </div>

    <nav class="sidebar-nav">
      ${visible.map(navLink).join('')}
    </nav>

    <div class="sidebar-footer">
      <div class="sidebar-profile-wrap">
        <button type="button" class="sidebar-profile" id="profile-btn" onclick="toggleProfileMenu(event)"
          aria-haspopup="menu" aria-expanded="false" ${collapsed ? `title="${escapeHtml(TCAuth.getNickname())}"` : ''}>
          <span class="user-avatar" aria-hidden="true">${escapeHtml(TCAuth.getNickname().charAt(0).toUpperCase())}</span>
          <span class="user-text"><strong>${escapeHtml(TCAuth.getNickname())}</strong><span>${TCAuth.isAdmin() ? 'Admin' : 'Staff'}</span></span>
          <svg class="profile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
      </div>
      <div class="sidebar-footer-pair">
        ${NAV_FOOTER_ITEMS.map(navLink).join('')}
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────
// SMARTPHONE: barra in basso + pannello "Altro"
// ─────────────────────────────────────────────

const BOTTOM_PRIMARY = ['planner', 'ordini', 'clienti', 'cassa'];

function renderBottomNav() {
  const root = document.getElementById('bottomnav-root');
  if (!root) return;
  if (!TCAuth.isLoggedIn()) { root.innerHTML = ''; return; }

  const badges  = navBadges();
  const primary = BOTTOM_PRIMARY.filter(id => Nav.isAllowed(id)).map(id => Nav._item(id));
  const moreIds = [...NAV_ITEMS, ...NAV_FOOTER_ITEMS].filter(i => !BOTTOM_PRIMARY.includes(i.id) && Nav.isAllowed(i.id)).map(i => i.id);
  const moreActive = moreIds.includes(Nav.current);
  const moreBadge  = moreIds.reduce((n, id) => n + (id === 'supporto' ? (badges[id] || 0) : 0), 0);

  const tab = (id, label, icon, active, badge, onclick) => `
    <a href="${id ? '#/' + id : '#'}" class="bn-item ${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}
       onclick="event.preventDefault();${onclick}">
      <span class="bn-icon">${icon}${badge ? `<span class="bn-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span>
      <span class="bn-label">${label}</span>
    </a>`;

  root.innerHTML =
    primary.map(i => tab(i.id, i.label, i.icon(), Nav.current === i.id, i.id === 'ordini' ? 0 : badges[i.id], `Nav.go('${i.id}')`)).join('') +
    tab('', 'Altro', Icons.menu(21), moreActive, moreBadge, 'openMoreSheet()');
}

function openMoreSheet() {
  const sheet = document.getElementById('more-sheet');
  const badges = navBadges();
  const items = [...NAV_ITEMS, ...NAV_FOOTER_ITEMS].filter(i => !BOTTOM_PRIMARY.includes(i.id) && Nav.isAllowed(i.id));
  const isDark = Theme.get() === 'dark';

  sheet.innerHTML = `
    <div class="modal more-sheet" role="dialog" aria-modal="true" aria-label="Altre sezioni">
      <div class="sheet-handle" aria-hidden="true"></div>
      <div class="sidebar-user more-user">
        <span class="user-avatar" aria-hidden="true">${escapeHtml(TCAuth.getNickname().charAt(0).toUpperCase())}</span>
        <div class="user-text"><strong>${escapeHtml(TCAuth.getNickname())}</strong><span>${TCAuth.isAdmin() ? 'Admin' : 'Staff'}</span></div>
        <button class="btn-icon" onclick="Theme.toggle();openMoreSheet()" aria-label="${isDark ? 'Passa al tema chiaro' : 'Passa al tema scuro'}">${isDark ? Icons.sun(18) : Icons.moon(18)}</button>
        <button class="btn-icon" onclick="closeModal('more-sheet');openPasswordDialog()" aria-label="Cambia password">${Icons.lock(18)}</button>
        <button class="btn-icon" onclick="closeModal('more-sheet');doLogout()" aria-label="Esci">${Icons.logOut(18)}</button>
      </div>
      <nav class="more-list">
        ${items.map(i => `
          <a href="#/${i.id}" class="more-item ${Nav.current === i.id ? 'active' : ''}" onclick="event.preventDefault();closeModal('more-sheet');Nav.go('${i.id}')">
            <span class="nav-item-icon">${i.icon()}</span>
            <span class="more-item-text"><strong>${i.label}</strong><small>${i.subtitle}</small></span>
            ${badges[i.id] ? `<span class="nav-item-badge">${badges[i.id]}</span>` : ''}
          </a>`).join('')}
      </nav>
    </div>`;
  sheet.classList.add('active');
  sheet.onclick = (e) => { if (e.target === sheet) closeModal('more-sheet'); };
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
    <div class="app-header-actions">
      ${actions}
    </div>
  `;
}

// Menu del profilo (in fondo alla navbar): cambio password ed esci
function toggleProfileMenu(e) {
  e?.stopPropagation();
  const wrap = document.querySelector('.sidebar-profile-wrap');
  const btn  = document.getElementById('profile-btn');
  const open = wrap.querySelector('.profile-menu');
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }

  const menu = document.createElement('div');
  menu.className = 'profile-menu popover glass';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = `
    <button type="button" role="menuitem" onclick="openPasswordDialog()">${Icons.lock(16)} Cambia password</button>
    <button type="button" role="menuitem" class="danger" onclick="doLogout()">${Icons.logOut(16)} Esci</button>`;
  wrap.appendChild(menu);
  // Posizione fissa: la navbar (che scorre) non lo taglia, anche quando è ridotta a icone
  const r = btn.getBoundingClientRect();
  const collapsed = SidebarCollapse.get() && window.innerWidth > 860;
  Object.assign(menu.style, {
    position: 'fixed',
    bottom: `${window.innerHeight - (collapsed ? r.bottom : r.top - 8)}px`,
    left: `${collapsed ? r.right + 10 : r.left}px`,
    width: collapsed ? '210px' : `${r.width}px`,
    right: 'auto', top: 'auto',
  });
  btn.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();

  const close = (ev) => {
    if (ev.type === 'keydown' && ev.key !== 'Escape') return;
    if (ev.type === 'click' && menu.contains(ev.target)) return;
    menu.remove(); btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', close); document.removeEventListener('keydown', close);
    if (ev.type === 'keydown') btn.focus();
  };
  setTimeout(() => { document.addEventListener('click', close); document.addEventListener('keydown', close); });
}

// Finestra "Cambia password"
function openPasswordDialog() {
  document.querySelector('.profile-menu')?.remove();
  const modal = document.getElementById('pwd-modal');
  modal.innerHTML = `
    <div class="modal" style="max-width:440px;" role="dialog" aria-modal="true" aria-labelledby="pm-title">
      <div class="modal-header">
        <h2 id="pm-title">Cambia password</h2>
        <button class="btn-icon" onclick="closeModal('pwd-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <form class="modal-body" style="gap:12px;" onsubmit="event.preventDefault();submitPasswordDialog()">
        <div class="form-group"><label class="form-label" for="pm-old">Password attuale</label>
          <input id="pm-old" type="password" class="form-input" autocomplete="current-password" required></div>
        <div class="form-group"><label class="form-label" for="pm-new1">Nuova password</label>
          <input id="pm-new1" type="password" class="form-input" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" required
            placeholder="Almeno ${MIN_PASSWORD_LENGTH} caratteri"></div>
        <div class="form-group"><label class="form-label" for="pm-new2">Ripeti nuova password</label>
          <input id="pm-new2" type="password" class="form-input" autocomplete="new-password" required></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px;">
          <button type="button" class="btn btn-secondary" onclick="closeModal('pwd-modal')">Annulla</button>
          <button type="submit" class="btn btn-primary" id="pm-save">Aggiorna password</button>
        </div>
      </form>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('pwd-modal'); };
  setTimeout(() => document.getElementById('pm-old')?.focus(), 50);
}

async function submitPasswordDialog() {
  const oldPwd = document.getElementById('pm-old').value;
  const newPwd = document.getElementById('pm-new1').value;
  const repPwd = document.getElementById('pm-new2').value;
  if (newPwd.length < MIN_PASSWORD_LENGTH) { showToast(`Minimo ${MIN_PASSWORD_LENGTH} caratteri`, 'error'); return; }
  if (newPwd !== repPwd) { showToast('Le nuove password non coincidono', 'error'); document.getElementById('pm-new2').focus(); return; }
  const btn = document.getElementById('pm-save');
  btn.disabled = true; btn.textContent = 'Aggiornamento…';
  try {
    await TCAuth.changePassword(oldPwd, newPwd);
    closeModal('pwd-modal');
    showToast('Password aggiornata ✓');
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false; btn.textContent = 'Aggiorna password';
  }
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
