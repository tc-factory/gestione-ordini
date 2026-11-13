/**
 * T&C Factory — Comunicazione: i canali di ogni negozio in un posto solo
 *
 *  #/comunicazione                    → i negozi (aree di lavoro) con logo e messaggi da leggere
 *  #/comunicazione/<negozio>          → i canali del negozio: Mail, Instagram, Facebook, WhatsApp
 *  #/comunicazione/<negozio>/<canale> → il canale aperto
 *
 * Mail riusa la sezione Mail (stesso #mail-root, spostato qui e filtrato sulla casella del negozio).
 * Instagram e Facebook riusano le conversazioni del Centro di controllo (renderCommsSocial).
 * WhatsApp: da configurare.
 */

const COM_NEGOZI = [
  { id: 'ciucciamilcalzino', label: 'Ciucciami il Calzino', logo: 'img/loghi-negozi/ciucciamilcalzino.png', casella: 'ciucciamilcalzino' },
  { id: 'bienjugado',        label: 'Bienjugado',           logo: 'img/loghi-negozi/bienjugado.png',        casella: 'bienjugado' },
  { id: 'boxfactorylab',     label: 'Box Factory Lab',      logo: 'img/loghi-negozi/boxfactorylab.png',     casella: 'boxfactorylab' },
  { id: 'liveprinting',      label: 'Live Printing',        logo: 'img/loghi-negozi/liveprinting.jpg',      casella: null },
];

const COM_LOGHI = {
  mail: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="3" fill="#3D66C7"/><path d="M3.5 6.5 12 13l8.5-6.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  instagram: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><defs><linearGradient id="com-ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FEDA75"/><stop offset=".35" stop-color="#FA7E1E"/><stop offset=".6" stop-color="#D62976"/><stop offset="1" stop-color="#4F5BD5"/></linearGradient></defs><rect x="2" y="2" width="20" height="20" rx="6" fill="url(#com-ig)"/><circle cx="12" cy="12" r="4.3" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="17.3" cy="6.7" r="1.2" fill="#fff"/></svg>`,
  facebook: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#1877F2"/><path d="M13.3 21.9v-7.1h2.4l.4-2.8h-2.8v-1.8c0-.8.3-1.4 1.4-1.4h1.5V6.3c-.3 0-1.2-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.7V12H8v2.8h2.4v7.1" fill="#fff"/></svg>`,
  whatsapp: () => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" fill="#25D366"/><path d="M8.6 7.2c.2-.4.4-.4.7-.4h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.4 0 .6l-.4.6c-.1.2-.2.3 0 .6.5.8 1.1 1.5 1.9 2 .8.5 1.1.6 1.4.4l.7-.8c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.4.4 0 .5-.2 1.2-.7 1.5-.5.4-1.5.7-2.9.2-1.6-.6-3.3-1.9-4.4-3.5-.9-1.3-1.2-2.4-.9-3.3.2-.7.6-1.2.8-1.5z" fill="#fff"/></svg>`,
};

const COM_CANALI = [
  { id: 'mail',      label: 'Mail' },
  { id: 'instagram', label: 'Instagram', piattaforma: 'instagram' },
  { id: 'facebook',  label: 'Facebook',  piattaforma: 'messenger' },
  { id: 'whatsapp',  label: 'WhatsApp' },
];

const Comun = {
  negozio: null,
  canale: null,
  account: null,      // social_account (senza token) con le conversazioni da leggere
  daLeggere: {},      // social_account.id → conversazioni da leggere
  caricato: false,
};

const comNegozio = (id) => COM_NEGOZI.find(n => n.id === id);

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
  if (Nav.isAllowed('mail') && !MailBox.caselle.length) await MailBox.loadCaselle().catch(() => {});
  Comun.caricato = true;
}

// Stato di un canale per un negozio: { testo, n, colore, attivo }
function comStato(negozio, canale) {
  if (canale.id === 'whatsapp') return { testo: 'Da configurare', attivo: false };
  if (canale.id === 'mail') {
    if (!negozio.casella) return { testo: 'Da configurare', attivo: false };
    const c = MailBox.caselle.find(x => x.id === negozio.casella);
    if (!c) return { testo: Nav.isAllowed('mail') ? 'Casella non trovata' : 'Serve l\'accesso alla Mail', attivo: false };
    return { testo: c.non_lette ? `${c.non_lette} da leggere` : c.indirizzo, n: c.non_lette || 0, attivo: true, errore: c.ultimo_errore };
  }
  const conti = (Comun.account || []).filter(a => a.piattaforma === canale.piattaforma && a.negozio === negozio.id);
  if (!conti.length) return { testo: 'Non collegato', attivo: false };
  const n = conti.reduce((s, a) => s + (Comun.daLeggere[a.id] || 0), 0);
  const errore = conti.find(a => a.ultimo_errore)?.ultimo_errore;
  return { testo: n ? `${n} da leggere` : conti.map(a => (canale.id === 'instagram' ? '@' : '') + a.username).join(', '), n, attivo: true, errore };
}

async function openComunicazionePage() {
  const [neg, can] = (Nav.param || '').split('/');
  Comun.negozio = comNegozio(neg) ? neg : null;
  Comun.canale = Comun.negozio && COM_CANALI.some(c => c.id === can) ? can : null;
  if (Comun.canale !== 'mail') comRestituisciMail();
  renderComunicazionePage();
  await comCaricaConteggi();
  renderComunicazionePage();
  renderHeader();
}

function renderComunicazionePage() {
  const root = document.getElementById('comunicazione-root');
  if (!root || Nav.current !== 'comunicazione') return;
  const negozio = comNegozio(Comun.negozio);

  // Elenco dei negozi: 4 box grandi con il logo
  if (!negozio) {
    root.innerHTML = `
      <div class="com-negozi">
        ${COM_NEGOZI.map(n => {
          const stati = COM_CANALI.map(c => [c, comStato(n, c)]);
          return `
            <a class="glass-card com-negozio" href="#/comunicazione/${n.id}" aria-label="${escapeHtml(n.label)}"
               onclick="event.preventDefault();Nav.go('comunicazione','${n.id}')">
              <span class="com-negozio-logo"><img src="${n.logo}" alt="${escapeHtml(n.label)}"></span>
              <span class="com-negozio-canali">${stati.map(([c, x]) => `<span class="com-mini-ch ${x.attivo ? '' : 'is-off'}" title="${escapeHtml(c.label)}: ${escapeHtml(x.testo)}">${COM_LOGHI[c.id]()}${x.n ? `<b>${x.n}</b>` : ''}</span>`).join('')}</span>
            </a>`;
        }).join('')}
      </div>`;
    return;
  }

  const testa = `
    <div class="com-head">
      <button class="btn btn-ghost btn-sm" onclick="Nav.go('comunicazione'${Comun.canale ? `,'${negozio.id}'` : ''})">${Icons.chevronLeft(14)} ${Comun.canale ? escapeHtml(negozio.label) : 'Tutti i negozi'}</button>
      <img class="com-logo is-small" src="${negozio.logo}" alt="">
      <strong>${escapeHtml(negozio.label)}</strong>
      ${Comun.canale ? `<span class="com-head-ch">${COM_LOGHI[Comun.canale]()} ${escapeHtml(COM_CANALI.find(c => c.id === Comun.canale).label)}</span>` : ''}
    </div>`;

  // Canali del negozio
  if (!Comun.canale) {
    root.innerHTML = `${testa}
      <div class="com-grid">
        ${COM_CANALI.map(c => {
          const x = comStato(negozio, c);
          return `
            <a class="glass-card com-card ${x.attivo ? '' : 'is-off'}" href="#/comunicazione/${negozio.id}/${c.id}"
               onclick="event.preventDefault();Nav.go('comunicazione','${negozio.id}/${c.id}')">
              <span class="com-ch-logo">${COM_LOGHI[c.id]()}</span>
              <span class="com-card-body">
                <strong>${c.label}</strong>
                <small class="${x.n ? 'com-n' : ''}">${!Comun.caricato ? 'Caricamento…' : escapeHtml(x.testo)}</small>
                ${x.errore ? `<small class="com-err">${escapeHtml(x.errore)}</small>` : ''}
              </span>
            </a>`;
        }).join('')}
      </div>`;
    return;
  }

  const canale = COM_CANALI.find(c => c.id === Comun.canale);
  const x = comStato(negozio, canale);
  const vuoto = (titolo, testo) => `
    <div class="glass-card empty-state">
      <div class="empty-state-icon" aria-hidden="true">${COM_LOGHI[canale.id]()}</div>
      <h2>${titolo}</h2><p>${testo}</p>
    </div>`;

  if (!Comun.caricato) { root.innerHTML = testa + `<div class="glass-card page-card"><div class="empty-list">Caricamento…</div></div>`; return; }
  if (canale.id === 'whatsapp') { root.innerHTML = testa + vuoto('WhatsApp da configurare', 'Il collegamento di WhatsApp non è ancora attivo.'); return; }

  if (canale.id === 'mail') {
    if (!x.attivo) { comRestituisciMail(); root.innerHTML = testa + vuoto('Mail da configurare', `${escapeHtml(negozio.label)} non ha ancora una casella collegata.`); return; }
    if (!root.querySelector('#com-mail')) {
      root.innerHTML = `${testa}<div id="com-mail"></div>`;
      const mail = document.getElementById('mail-root');
      if (mail) { mail.classList.add('com-embed'); document.getElementById('com-mail').appendChild(mail); }
      if (MailBox.casella !== negozio.casella) { MailBox.casella = negozio.casella; MailBox.aperto = null; }
      openMailPage();
    }
    return;
  }

  // Instagram / Facebook
  if (!x.attivo) { root.innerHTML = testa + vuoto(`${canale.label} non collegato`, `Collegalo da Centro di controllo → Collegamenti.`); return; }
  root.innerHTML = testa + renderCommsSocial({ negozio: negozio.id, piattaforma: canale.piattaforma });
}
