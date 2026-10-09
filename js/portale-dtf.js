/**
 * T&C Factory — Portale DTF per i clienti conto terzi (sola lettura)
 * Link personale (#codice) + password → la propria tabella del mese:
 * metri per giorno e nomi dei file stampati. Nessuna modifica possibile.
 * I dati arrivano solo dalla funzione dtf_portal_get (sql/dtf-portale.sql),
 * che verifica link e password a ogni richiesta.
 * La password resta solo in memoria: ricaricando la pagina va reinserita.
 */

const Portal = {
  token: decodeURIComponent(location.hash.replace(/^#/, '').trim()),
  password: null,
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  cliente: null,
  entries: {},
};

// Tema come il sistema del cliente
const darkMq = window.matchMedia?.('(prefers-color-scheme: dark)');
const applyTheme = () => document.documentElement.classList.toggle('dark', !!darkMq?.matches);
applyTheme();
darkMq?.addEventListener?.('change', applyTheme);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const euro = (n) => '€ ' + (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const metri = (n) => (Number(n) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const root = () => document.getElementById('portal-root');

const brand = `
  <div class="portal-brand">
    <span class="brand-logo" aria-hidden="true"><span class="brand-logo-mark">T&amp;C</span></span>
    <div><strong>T&amp;C Factory</strong><span>Stampe DTF</span></div>
  </div>`;

// ── Accesso ──

function renderLogin(error = '') {
  if (!Portal.token) {
    root().innerHTML = `${brand}<div class="portal-card"><h1>Link non valido</h1>
      <p class="portal-muted">Usa il link completo che ti è stato inviato da T&amp;C Factory.</p></div>`;
    return;
  }
  root().innerHTML = `${brand}
    <form class="portal-card portal-login" onsubmit="event.preventDefault();doPortalLogin()">
      <h1>Le tue stampe DTF</h1>
      <p class="portal-muted">Inserisci la password che ti è stata comunicata.</p>
      <label class="form-label" for="portal-pwd">Password</label>
      <div class="pw-wrap">
        <input id="portal-pwd" type="password" class="form-input" autocomplete="current-password" required autofocus>
        <button type="button" class="pw-toggle" aria-label="Mostra password" aria-pressed="false" onclick="togglePortalPwd(this)">👁</button>
      </div>
      <p class="portal-error" role="alert">${esc(error)}</p>
      <button type="submit" class="btn btn-primary" id="portal-login-btn">Accedi</button>
    </form>`;
  setTimeout(() => document.getElementById('portal-pwd')?.focus(), 50);
}

function togglePortalPwd(btn) {
  const input = document.getElementById('portal-pwd');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', show);
  btn.setAttribute('aria-label', show ? 'Nascondi password' : 'Mostra password');
  input.focus();
}

async function fetchMonth(password) {
  const from = iso(Portal.month);
  const to = iso(new Date(Portal.month.getFullYear(), Portal.month.getMonth() + 1, 0));
  const { data, error } = await supabaseClient.rpc('dtf_portal_get', { p_token: Portal.token, p_password: password, p_from: from, p_to: to });
  if (error) throw new Error('Impossibile contattare il server, riprova');
  if (!data?.success) throw new Error(data?.error || 'Accesso non riuscito');
  return data;
}

async function doPortalLogin() {
  const pwd = document.getElementById('portal-pwd').value;
  const btn = document.getElementById('portal-login-btn');
  btn.disabled = true; btn.textContent = 'Accesso…';
  try {
    const data = await fetchMonth(pwd);
    Portal.password = pwd;
    applyData(data);
    renderTable(true);
  } catch (e) {
    renderLogin(e.message);
  }
}

function applyData(data) {
  Portal.cliente = data.cliente;
  Portal.entries = {};
  (data.entries || []).forEach(e => { Portal.entries[e.giorno] = { metri: Number(e.metri) || 0, dettaglio: e.dettaglio || '', files: Array.isArray(e.files) ? e.files : [] }; });
}

async function changeMonth(delta) {
  Portal.month = delta === 0
    ? new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    : new Date(Portal.month.getFullYear(), Portal.month.getMonth() + delta, 1);
  root().querySelector('.portal-days')?.classList.add('loading');
  try {
    applyData(await fetchMonth(Portal.password));
    renderTable(delta === 0);
  } catch (e) {
    Portal.password = null;
    renderLogin(e.message);
  }
}

function logout() {
  Portal.password = null;
  Portal.entries = {};
  renderLogin();
}

// ── Tabella in sola lettura ──

function renderTable(scrollToday = false) {
  const m = Portal.month;
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const today = iso(new Date());
  const totMetri = Object.values(Portal.entries).reduce((s, e) => s + e.metri, 0);
  const costo = Number(Portal.cliente.costo_metro) || 0;

  const rows = [];
  for (let d = 1; d <= last; d++) {
    const date = new Date(m.getFullYear(), m.getMonth(), d);
    const key = iso(date);
    const e = Portal.entries[key];
    const files = (e?.dettaglio || '').split('\n').map(s => s.trim()).filter(Boolean);
    const has = e && (e.metri > 0 || files.length);
    rows.push(`
      <li class="portal-day ${key === today ? 'today' : ''} ${has ? 'has-data' : ''}" ${key === today ? 'id="portal-today"' : ''}>
        <div class="portal-day-date"><strong>${d}</strong><span>${date.toLocaleDateString('it-IT', { weekday: 'short' })}</span></div>
        <div class="portal-day-metri">${e?.metri ? `${metri(e.metri)} m` : '<span>—</span>'}</div>
        ${files.length
          ? `<button type="button" class="portal-day-files" onclick="showDetail('${key}')">${files.length} ${files.length === 1 ? 'file' : 'file'} · <span>${esc(files[0])}${files.length > 1 ? '…' : ''}</span></button>`
          : '<div class="portal-day-files empty">Nessun file</div>'}
      </li>`);
  }

  root().innerHTML = `
    <header class="portal-head">
      ${brand}
      <button type="button" class="btn btn-secondary btn-sm" onclick="logout()">Esci</button>
    </header>
    <section class="portal-card">
      <div class="portal-title">
        <h1>${esc(Portal.cliente.nome)}</h1>
        <span class="portal-badge">Sola lettura</span>
      </div>
      <div class="dtf-summary">
        <div class="dtf-kpi"><span>Metri del mese</span><strong>${metri(totMetri)} m</strong></div>
        <div class="dtf-kpi"><span>Costo al metro</span><strong>${euro(costo)}</strong></div>
        <div class="dtf-kpi dtf-kpi-total"><span>Totale del mese</span><strong>${euro(totMetri * costo)}</strong></div>
      </div>
      <div class="dtf-month-nav">
        <button class="btn-icon" onclick="changeMonth(-1)" aria-label="Mese precedente">‹</button>
        <strong>${m.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}</strong>
        <button class="btn-icon" onclick="changeMonth(1)" aria-label="Mese successivo">›</button>
        <button class="btn btn-secondary btn-sm" onclick="changeMonth(0)">Oggi</button>
      </div>
      <ol class="portal-days">${rows.join('')}</ol>
    </section>`;

  if (scrollToday) {
    const list = root().querySelector('.portal-days'), row = document.getElementById('portal-today');
    if (list && row) list.scrollTop = row.offsetTop - list.offsetTop - list.clientHeight / 2 + row.clientHeight / 2;
  }
}

function showDetail(key) {
  const e = Portal.entries[key];
  const files = (e?.dettaglio || '').split('\n').map(s => s.trim()).filter(Boolean);
  const modal = document.getElementById('portal-detail');
  modal.innerHTML = `
    <div class="modal" style="max-width:480px;" role="dialog" aria-modal="true" aria-labelledby="pd-title">
      <div class="modal-header">
        <h2 id="pd-title">${new Date(key + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <button class="btn-icon" onclick="closeDetail()" aria-label="Chiudi">✕</button>
      </div>
      <div class="modal-body" style="gap:10px;">
        <div class="dtf-kpi"><span>Metri stampati</span><strong>${metri(e?.metri)} m</strong></div>
        <h3 class="portal-files-title">File stampati (${files.length})</h3>
        <ul class="portal-files">${(e?.files?.length ? e.files : files.map(name => ({ name }))).map(f => `
          <li><span>${esc(f.name)}</span>${f.metri > 0
            ? `<small>${String(f.w_cm).replace('.', ',')} × ${String(f.h_cm).replace('.', ',')} cm · ${f.pz} pz · <strong>${metri(f.metri)} m</strong></small>` : ''}</li>`).join('')}</ul>
      </div>
    </div>`;
  modal.classList.add('active');
  modal.onclick = (ev) => { if (ev.target === modal) closeDetail(); };
}

function closeDetail() { document.getElementById('portal-detail').classList.remove('active'); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

// Il codice nell'indirizzo (#…) non viene mandato ai server né ad altri siti
renderLogin();
