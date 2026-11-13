/**
 * T&C Factory — Negozi: i canali di ogni negozio in un posto solo
 *
 *  In alto i bottoni dei negozi, solo logo, trascinabili per scegliere l'ordine (salvato nel browser);
 *  sotto i canali del negozio scelto: Mail, Instagram, Facebook, WhatsApp, Shopify, Spedizioni.
 *  (L'id della sezione resta 'comunicazione', così i permessi già dati restano validi.)
 *  #/comunicazione                    → il primo negozio dell'ordine, sulla Mail
 *  #/comunicazione/<negozio>/<canale> → quel negozio e quel canale
 *
 * Mail riusa la sezione Mail (stesso #mail-root, spostato qui e filtrato sulla casella del negozio).
 * Instagram e Facebook riusano le conversazioni del Centro di controllo (renderCommsSocial).
 * Shopify e Spedizioni (solo admin) riusano le schede Shop e Spedizioni che erano nel Centro di controllo,
 * filtrate sul negozio (renderControlOrders / renderControlGls).
 * WhatsApp: da configurare.
 */

const COM_NEGOZI = [
  { id: 'ciucciamilcalzino', label: 'Ciucciami il Calzino', logo: 'img/loghi-negozi/ciucciamilcalzino.png', casella: 'ciucciamilcalzino' },
  { id: 'bienjugado',        label: 'Bienjugado',           logo: 'img/loghi-negozi/bienjugado.png',        casella: 'bienjugado' },
  { id: 'boxfactorylab',     label: 'Box Factory Lab',      logo: 'img/loghi-negozi/boxfactorylab.png',     casella: 'boxfactorylab' },
  { id: 'asteroidi',         label: 'Asteroidi Store',      logo: 'img/loghi-negozi/asteroidi.png',         casella: 'asteroidi' },
  { id: 'liveprinting',      label: 'Live Printing',        logo: 'img/loghi-negozi/liveprinting.jpg',      casella: null },
];

const COM_LOGHI = {
  mail: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="#3D66C7"/><path d="M3.5 6.5 12 13l8.5-6.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  instagram: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><defs><linearGradient id="com-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#com-ig)"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="#fff"/></svg>`,
  facebook: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#1877F2"/><path d="M13.3 21.9v-7.1h2.4l.4-2.8h-2.8v-1.8c0-.8.3-1.4 1.4-1.4h1.5V6.3c-.3 0-1.2-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.7V12H8v2.8h2.4v7.1" fill="#fff"/></svg>`,
  whatsapp: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366"/><path d="M8.6 7.2c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.1.2-.2.3 0 .6.5.8 1.1 1.5 1.9 2 .8.5 1.1.6 1.4.4l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.4.4 0 .5-.2 1.2-.7 1.5-.5.4-1.5.7-2.9.2-1.6-.6-3.3-1.9-4.4-3.5-.9-1.3-1.2-2.4-.9-3.3.2-.7.6-1.2.8-1.5z" fill="#fff"/></svg>`,
  shopify: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M15.6 4.3 14.9 2.4c-.2-.4-.6-.5-.9-.4L12.6 2.5C12 1.6 11.2 1.2 10.4 1.3 8.5 1.4 7.4 3.8 7 5.3L4.6 6c-.6.2-.7.3-.7.9L2 20.6 15.9 23l5.9-1.3L19.3 5.6l-3.7-1.3z" fill="#95BF47"/><path d="M15.6 4.3 15.9 23l5.9-1.3L19.3 5.6c-.1-.6-.6-.7-1-.7l-2.7-.6z" fill="#5E8E3E"/><path d="M12.4 8.6 11.8 10.5s-.7-.4-1.5-.3c-1.2.1-1.2.8-1.2 1 .1 1 2.8 1.3 3 3.7.1 1.9-1 3.1-2.6 3.2-2 .1-3-1.1-3-1.1l.4-1.8s1.1.8 2 .8c.6 0 .8-.5.8-.8-.1-1.3-2.3-1.3-2.4-3.5-.1-1.8 1.1-3.7 3.7-3.8 1-.1 1.4.2 1.4.2z" fill="#fff"/></svg>`,
  spedizioni: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="1" y="3" width="22" height="18" rx="5" fill="#F59E0B"/><path d="M5 8.5h8v7H5zM13 10.5h3l2.5 2.5v2.5H13z" fill="#fff"/><circle cx="8" cy="16.2" r="1.6" fill="#F59E0B" stroke="#fff" stroke-width="1.2"/><circle cx="16" cy="16.2" r="1.6" fill="#F59E0B" stroke="#fff" stroke-width="1.2"/></svg>`,
};

const COM_CANALI = [
  { id: 'mail',      label: 'Mail' },
  { id: 'instagram', label: 'Instagram', piattaforma: 'instagram' },
  { id: 'facebook',  label: 'Facebook',  piattaforma: 'messenger' },
  { id: 'whatsapp',  label: 'WhatsApp' },
  { id: 'shopify',    label: 'Shopify',    admin: true },
  { id: 'spedizioni', label: 'Spedizioni', admin: true },
];
// Canali che vede chi è collegato (Shopify e Spedizioni solo gli admin, come prima nel Centro di controllo)
const comCanali = () => COM_CANALI.filter(c => !c.admin || TCAuth.isAdmin());
const comCanaleShop = (id) => id === 'shopify' || id === 'spedizioni';

const Comun = {
  negozio: null,
  canale: null,
  account: null,      // social_account (senza token) con le conversazioni da leggere
  daLeggere: {},      // social_account.id → conversazioni da leggere
  badge: 0,           // numero nella navbar
  caricato: false,
};

const comNegozio = (id) => COM_NEGOZI.find(n => n.id === id);

// Numero nella navbar: mail da leggere delle caselle dei negozi + conversazioni Instagram/Facebook da leggere.
// Si aggiorna con il giro di un minuto della Mail (MailBox.poll → loadBadge) e quando si legge qualcosa.
async function comLoadBadge() {
  if (!Nav.isAllowed('comunicazione')) return;
  const [c, s] = await Promise.all([
    supabaseClient.rpc('tc_mail_caselle'),
    supabaseClient.from('social_conversazioni').select('account, social_account!inner(negozio)').eq('da_leggere', true),
  ]);
  const caselle = COM_NEGOZI.map(n => n.casella).filter(Boolean);
  const negozi = COM_NEGOZI.map(n => n.id);
  const mail = (c.data?.caselle || []).filter(x => caselle.includes(x.id)).reduce((t, x) => t + (x.non_lette || 0), 0);
  const social = (s.data || []).filter(r => negozi.includes(r.social_account?.negozio)).length;
  const n = (c.error ? 0 : mail) + (s.error ? 0 : social);
  if (n !== Comun.badge) { Comun.badge = n; renderSidebar(); }
}

// La Mail è aperta qui dentro: serve alla sezione Mail per aggiornarsi da sola
function mailVisibile() {
  return Nav.current === 'mail' || (Nav.current === 'comunicazione' && Comun.canale === 'mail');
}

// #mail-root torna nella sua sezione (o viene spostato qui quando si apre la Mail di un negozio)
function comRestituisciMail() {
  const root = document.getElementById('mail-root');
  const casa = document.getElementById('view-mail');
  if (root && casa && root.parentElement !== casa) casa.appendChild(root);
  root?.classList.remove('com-embed');
}

async function comCaricaConteggi() {
  const [acc, conv] = await Promise.all([
    supabaseClient.from('social_account').select('id, piattaforma, username, negozio, ultimo_errore').eq('attivo', true),
    supabaseClient.from('social_conversazioni').select('account').eq('da_leggere', true),
  ]);
  Comun.account = acc.error ? [] : (acc.data || []);
  Comun.daLeggere = {};
  for (const c of conv.data || []) Comun.daLeggere[c.account] = (Comun.daLeggere[c.account] || 0) + 1;
  if (Nav.isAllowed('comunicazione') && !MailBox.caselle.length) await MailBox.loadCaselle().catch(() => {});
  Comun.caricato = true;
  comLoadBadge();
}

// Stato di un canale per un negozio: { testo, n, colore, attivo }
function comStato(negozio, canale) {
  if (comCanaleShop(canale.id)) return taskMacro(negozio.id) ? { testo: canale.label, attivo: true } : { testo: 'Non è un negozio Shopify', attivo: false };
  if (canale.id === 'whatsapp') return { testo: 'Da configurare', attivo: false };
  if (canale.id === 'mail') {
    if (!negozio.casella) return { testo: 'Da configurare', attivo: false };
    const c = MailBox.caselle.find(x => x.id === negozio.casella);
    if (!c) return { testo: Nav.isAllowed('comunicazione') ? 'Casella non trovata' : 'Serve l\'accesso alla Mail', attivo: false };
    return { testo: c.non_lette ? `${c.non_lette} da leggere` : c.indirizzo, n: c.non_lette || 0, attivo: true, errore: c.ultimo_errore };
  }
  const conti = (Comun.account || []).filter(a => a.piattaforma === canale.piattaforma && a.negozio === negozio.id);
  if (!conti.length) return { testo: 'Non collegato', attivo: false };
  const n = conti.reduce((s, a) => s + (Comun.daLeggere[a.id] || 0), 0);
  const errore = conti.find(a => a.ultimo_errore)?.ultimo_errore;
  return { testo: n ? `${n} da leggere` : conti.map(a => (canale.id === 'instagram' ? '@' : '') + a.username).join(', '), n, attivo: true, errore };
}

// ── Ordine dei negozi: scelto trascinando i bottoni, resta nel browser ──
const COM_ORDINE_KEY = 'tcf_com_ordine';
function comOrdine() {
  let salvato = [];
  try { salvato = JSON.parse(localStorage.getItem(COM_ORDINE_KEY) || '[]'); } catch { /* ordine di default */ }
  const ids = COM_NEGOZI.map(n => n.id);
  return [...salvato.filter(id => ids.includes(id)), ...ids.filter(id => !salvato.includes(id))].map(comNegozio);
}
function comSalvaOrdine(ids) {
  try { localStorage.setItem(COM_ORDINE_KEY, JSON.stringify(ids)); } catch { /* resta l'ordine di questa visita */ }
}

async function openComunicazionePage() {
  const [neg, can] = (Nav.param || '').split('/');
  Comun.negozio = comNegozio(neg) ? neg : comOrdine()[0].id;
  Comun.canale = comCanali().some(c => c.id === can) ? can : 'mail';
  if (Comun.canale !== 'mail') comRestituisciMail();
  renderComunicazionePage();
  if (comCanaleShop(Comun.canale)) comCaricaShop();
  await comCaricaConteggi();
  renderComunicazionePage();
  renderHeader();
}

// Ordini Shopify e spedizioni GLS: stessi dati del Centro di controllo; i task servono ai bottoni delle giacenze
async function comCaricaShop() {
  if (!Ctrl.loaded) Ctrl.load().then(() => renderComunicazionePage());
  await loadShopifyLinks();
  renderComunicazionePage();
}

function comScegli(negozio, canale) {
  if (Comun.trascina?.mosso) return;
  Nav.go('comunicazione', `${negozio}/${canale}`);
}

function renderComunicazionePage() {
  const root = document.getElementById('comunicazione-root');
  if (!root || Nav.current !== 'comunicazione') return;
  if (!root.querySelector('.com-page')) {
    root.innerHTML = `<div class="com-page"><div class="com-negozi-bar" id="com-negozi" role="tablist" aria-label="Negozio"></div>
      <div class="com-canali" id="com-canali" role="tablist" aria-label="Canale"></div><div class="com-body" id="com-body"></div></div>`;
  }
  if (!Comun.trascina) renderComNegozi();
  renderComCanali();
  renderComBody();
}

function renderComNegozi() {
  const bar = document.getElementById('com-negozi');
  if (!bar) return;
  bar.innerHTML = comOrdine().map(n => {
    // Notifiche del negozio: mail e conversazioni da leggere di tutti i canali
    const tot = Comun.caricato ? comCanali().reduce((s, c) => s + (comStato(n, c).n || 0), 0) : 0;
    const nome = `${n.label}${tot ? `, ${tot} da leggere` : ''}`;
    return `
    <button type="button" class="glass-card com-negozio-btn ${n.id === Comun.negozio ? 'is-on' : ''}" role="tab" data-id="${n.id}"
      aria-selected="${n.id === Comun.negozio}" aria-label="${escapeHtml(nome)}" title="${escapeHtml(nome)} · trascina per spostarlo"
      onpointerdown="comTrascinaInizio(event)" onclick="comScegli('${n.id}', '${Comun.canale}')" onkeydown="comTastiNegozio(event)">
      <img src="${n.logo}" alt="" draggable="false">
      ${tot ? `<span class="com-badge" aria-hidden="true">${tot > 99 ? '99+' : tot}</span>` : ''}
    </button>`;
  }).join('');
}

function renderComCanali() {
  const bar = document.getElementById('com-canali');
  if (!bar) return;
  const negozio = comNegozio(Comun.negozio);
  bar.innerHTML = comCanali().map(c => {
    const x = Comun.caricato ? comStato(negozio, c) : { attivo: true };
    const on = c.id === Comun.canale;
    return `
      <button type="button" class="com-canale ${on ? 'is-on' : ''} ${x.attivo ? '' : 'is-off'}" role="tab" aria-selected="${on}"
        onclick="comScegli('${negozio.id}', '${c.id}')" ${x.attivo ? '' : `title="${escapeHtml(x.testo)}"`}>
        ${COM_LOGHI[c.id]()}<span>${c.label}</span>${x.n ? `<b>${x.n}</b>` : ''}
      </button>`;
  }).join('');
}

function renderComBody() {
  const body = document.getElementById('com-body');
  if (!body) return;
  const negozio = comNegozio(Comun.negozio);
  const canale = COM_CANALI.find(c => c.id === Comun.canale);
  const vuoto = (titolo, testo) => `
    <div class="glass-card empty-state">
      <div class="empty-state-icon" aria-hidden="true">${COM_LOGHI[canale.id]()}</div>
      <h2>${titolo}</h2><p>${testo}</p>
    </div>`;
  const metti = (html) => { comRestituisciMail(); body.innerHTML = html; };

  if (!Comun.caricato) { if (canale.id !== 'mail' || !body.querySelector('#mail-root')) metti(`<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`); return; }
  const x = comStato(negozio, canale);

  if (comCanaleShop(canale.id)) {
    if (!x.attivo) return metti(vuoto(`${canale.label}: niente da mostrare`, `${escapeHtml(negozio.label)} non è un negozio Shopify.`));
    ShopLinks.negozio = negozio.id;
    ShopLinks.negozioGls = negozio.id;
    return metti(canale.id === 'shopify' ? renderControlOrders() : renderControlGls());
  }

  if (canale.id === 'whatsapp') return metti(vuoto('WhatsApp da configurare', 'Il collegamento di WhatsApp non è ancora attivo.'));

  if (canale.id === 'mail') {
    if (!x.attivo) return metti(vuoto('Mail da configurare', `${escapeHtml(negozio.label)} non ha ancora una casella collegata.`));
    const mail = document.getElementById('mail-root');
    if (!mail) return;
    if (mail.parentElement !== body) {
      body.innerHTML = '';
      mail.classList.add('com-embed');
      body.appendChild(mail);
      MailBox.casella = negozio.casella;
      MailBox.aperto = null;
      openMailPage();
    } else if (MailBox.casella !== negozio.casella) {
      setMailCasella(negozio.casella);
    }
    return;
  }

  if (!x.attivo) return metti(vuoto(`${canale.label} non collegato`, 'Si collega da Centro di controllo → Collegamenti.'));
  metti(renderCommsSocial({ negozio: negozio.id, piattaforma: canale.piattaforma }));
}

// ── Trascinamento dei bottoni (mouse e dito): il bottone segue il puntatore, gli altri si spostano ──
function comTrascinaInizio(ev) {
  if (ev.button !== 0) return;
  const btn = ev.currentTarget;
  const r = btn.getBoundingClientRect();
  // Punto in cui si è preso il bottone: resta sotto il puntatore per tutto il trascinamento
  Comun.trascina = { btn, x0: ev.clientX, y0: ev.clientY, presaX: ev.clientX - r.left, presaY: ev.clientY - r.top, mosso: false };
  try { btn.setPointerCapture(ev.pointerId); } catch { /* evento senza puntatore reale */ }
  btn.addEventListener('pointermove', comTrascinaMuovi);
  btn.addEventListener('pointerup', comTrascinaFine);
  btn.addEventListener('pointercancel', comTrascinaFine);
}

function comTrascinaMuovi(ev) {
  const t = Comun.trascina;
  if (!t) return;
  if (!t.mosso && Math.hypot(ev.clientX - t.x0, ev.clientY - t.y0) < 6) return;
  if (!t.mosso) { t.mosso = true; t.btn.classList.add('is-drag'); document.body.classList.add('com-dragging'); }
  const bar = t.btn.parentElement;
  const altri = [...bar.children].filter(b => b !== t.btn);
  // Va prima del primo bottone che sta dopo il puntatore: su una riga più in basso, o sulla stessa riga più a destra
  const prima = altri.find(b => {
    const r = b.getBoundingClientRect();
    return ev.clientY < r.top || (ev.clientY <= r.bottom && ev.clientX < r.left + r.width / 2);
  }) || null;
  if (t.btn.nextElementSibling !== prima) {
    // FLIP: gli altri bottoni scivolano nella nuova posizione
    const pos = new Map(altri.map(b => [b, b.getBoundingClientRect()]));
    bar.insertBefore(t.btn, prima);
    for (const b of altri) {
      const r0 = pos.get(b), r1 = b.getBoundingClientRect();
      if (r0.left !== r1.left || r0.top !== r1.top) {
        b.animate([{ transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px)` }, { transform: 'none' }], { duration: 180, easing: 'ease-out' });
      }
    }
  }
  // Il bottone segue il puntatore, partendo dal posto che occupa ora nella fila
  t.btn.style.transform = '';
  const base = t.btn.getBoundingClientRect();
  t.btn.style.transform = `translate(${ev.clientX - t.presaX - base.left}px, ${ev.clientY - t.presaY - base.top}px)`;
}

function comTrascinaFine() {
  const t = Comun.trascina;
  if (!t) return;
  t.btn.removeEventListener('pointermove', comTrascinaMuovi);
  t.btn.removeEventListener('pointerup', comTrascinaFine);
  t.btn.removeEventListener('pointercancel', comTrascinaFine);
  document.body.classList.remove('com-dragging');
  if (t.mosso) {
    const da = t.btn.getBoundingClientRect();
    t.btn.style.transform = '';
    const a = t.btn.getBoundingClientRect();
    t.btn.animate([{ transform: `translate(${da.left - a.left}px, ${da.top - a.top}px)` }, { transform: 'none' }], { duration: 160, easing: 'ease-out' });
    t.btn.classList.remove('is-drag');
    comSalvaOrdine([...t.btn.parentElement.children].map(b => b.dataset.id));
  }
  // Il clic che segue il rilascio non deve aprire il negozio se lo si è trascinato
  if (t.mosso) setTimeout(() => { Comun.trascina = null; }, 0);
  else Comun.trascina = null;
}

// Da tastiera: frecce per scegliere, Alt + frecce per spostare il negozio
function comTastiNegozio(ev) {
  const ordine = comOrdine().map(n => n.id);
  const i = ordine.indexOf(ev.currentTarget.dataset.id);
  const passo = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
  if (!passo) return;
  ev.preventDefault();
  const j = Math.max(0, Math.min(ordine.length - 1, i + passo));
  if (ev.altKey) {
    [ordine[i], ordine[j]] = [ordine[j], ordine[i]];
    comSalvaOrdine(ordine);
    renderComNegozi();
    document.querySelector(`.com-negozio-btn[data-id="${ordine[j]}"]`)?.focus();
  } else {
    document.querySelector(`.com-negozio-btn[data-id="${ordine[j]}"]`)?.focus();
  }
}
