/**
 * T&C Factory — Assistente
 * Si scrive una richiesta in italiano e il gestionale la esegue.
 * Niente intelligenza artificiale né chiamate esterne: le frasi vengono riconosciute
 * qui nel browser e si lavora sui dati già caricati (ordini, clienti, messaggi).
 *
 *   • "ricordami di pagare l'F24 il 25 alle 15"   → promemoria (tabella messages, ricorda_il)
 *   • "ricorda a Gianluca domani alle 9 di …"      → promemoria per un collega
 *   • "dammi l'ordine di crossfit grosseto"        → apre l'ordine (o l'elenco, se sono più d'uno)
 *   • "i miei promemoria"                          → promemoria programmati, annullabili
 */

const AssistState = { log: [], users: null };

const ASSIST_ESEMPI = [
  'Ricordami di chiamare il fornitore domani alle 10',
  "Dammi l'ordine di Crossfit Grosseto",
  'I miei promemoria',
];

// Testo senza maiuscole né accenti, per i confronti
const assistNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────
// DATE E ORE
// ─────────────────────────────────────────────

const ASSIST_MESI = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
const ASSIST_GIORNI = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
const ASSIST_NUMERI = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, quindici: 15, venti: 20, trenta: 30 };

// Copia normalizzata lettera per lettera: stessa lunghezza dell'originale, così le parti
// riconosciute si tolgono e il resto si riprende dalla frase originale (maiuscole, accenti)
function assistAllinea(s) {
  return s.split('').map(ch => {
    if (/\s/.test(ch)) return ' ';
    if (ch === '’' || ch === '`') return "'";
    const n = ch.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return n.length === 1 ? n : ch.toLowerCase().length === 1 ? ch.toLowerCase() : '?';
  }).join('');
}

// Testo di lavoro: t (normalizzato) e o (originale), con le parti tolte segnate
function assistTesto(originale) {
  const o = ' ' + originale + ' ';
  return { o, t: assistAllinea(o), tolto: new Array(o.length).fill(false) };
}
function assistTogli(x, re) {
  const m = x.t.match(re);
  if (!m) return null;
  for (let i = m.index; i < m.index + m[0].length; i++) x.tolto[i] = true;
  x.t = x.t.slice(0, m.index) + ' '.repeat(m[0].length) + x.t.slice(m.index + m[0].length);
  return m;
}
function assistResto(x) {
  return x.o.split('').map((ch, i) => x.tolto[i] ? ' ' : ch).join('').replace(/\s+/g, ' ').trim();
}

/**
 * Cerca nel testo quando: { quando: Date|null, manca } e segna come tolte le parole usate.
 */
function assistParseQuando(x, ora = new Date()) {
  const togli = (re) => assistTogli(x, re);
  const num = (s) => /^\d+$/.test(s) ? parseInt(s, 10) : (ASSIST_NUMERI[s] ?? null);

  // Tra / fra X minuti, ore, giorni, settimane
  let rel = togli(/\s(?:tra|fra)\s+(?:mezz'?\s?ora|mezza ora)\s/);
  if (rel) return { quando: new Date(ora.getTime() + 30 * 60000) };
  rel = togli(/\s(?:tra|fra)\s+(\d+|un|uno|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|quindici|venti|trenta)\s*(minut[oi]|min|or[ae]|giorn[oi]|settiman[ae])\s/);
  if (rel) {
    const n = num(rel[1]);
    const unit = rel[2];
    const d = new Date(ora);
    if (unit.startsWith('min')) d.setMinutes(d.getMinutes() + n);
    else if (unit.startsWith('or')) d.setHours(d.getHours() + n);
    else {
      d.setDate(d.getDate() + n * (unit.startsWith('settiman') ? 7 : 1));
      const h = assistParseOra();
      if (h) d.setHours(h.h, h.m, 0, 0); else d.setHours(9, 0, 0, 0);
    }
    return { quando: d };
  }

  // Ora: "alle 15", "alle 15:30", "alle ore 9 e mezza", "a mezzogiorno"
  function assistParseOra() {
    let m = togli(/\s(?:a\s+)?(mezzogiorno|mezzanotte)\s/);
    if (m) return { h: m[1] === 'mezzogiorno' ? 12 : 0, m: 0, esplicita: true };
    m = togli(/\s(?:alle|all'|per le|verso le|entro le|ore|alle ore)\s*(?:ore\s*)?(\d{1,2})(?:[:.](\d{2}))?(?:\s+e\s+(mezza|mezzo|un quarto|quarto|tre quarti|\d{1,2}))?(?:\s+(di mattina|del mattino|di pomeriggio|del pomeriggio|di sera|della sera|di notte))?\s/);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    let min = m[2] ? parseInt(m[2], 10) : 0;
    if (m[3]) min = /mezz/.test(m[3]) ? 30 : m[3] === 'tre quarti' ? 45 : /quarto/.test(m[3]) ? 15 : parseInt(m[3], 10);
    const parte = m[4] || '';
    if (/pomeriggio|sera/.test(parte) && h < 12) h += 12;
    // "alle 3" in orario di lavoro è il pomeriggio
    else if (!/mattin|notte/.test(parte) && h >= 1 && h <= 7) h += 12;
    if (h > 23 || min > 59) return null;
    return { h, m: min, esplicita: true };
  }
  const parteGiorno = () => {
    const m = togli(/\s(?:in |di |nel |nella )?(mattinata|mattina|pomeriggio|serata|sera|stasera|stamattina|stanotte)\s/);
    if (!m) return null;
    const p = m[1];
    if (p === 'stasera') return { h: 19, m: 0, oggi: true };
    if (p === 'stamattina') return { h: 9, m: 0, oggi: true };
    if (p === 'stanotte') return { h: 22, m: 0, oggi: true };
    return { h: /mattin/.test(p) ? 9 : p === 'pomeriggio' ? 15 : 19, m: 0 };
  };

  const oraTrovata = assistParseOra();
  const parte = oraTrovata ? null : parteGiorno();

  // Giorno
  let giorno = null;
  const oggi0 = new Date(ora); oggi0.setHours(0, 0, 0, 0);
  const piuGiorni = (n) => { const d = new Date(oggi0); d.setDate(d.getDate() + n); return d; };
  let m;
  if ((m = togli(/\s(?:per\s+)?(dopodomani|domattina|domani|oggi)\s/))) {
    giorno = piuGiorni(m[1] === 'oggi' ? 0 : m[1] === 'dopodomani' ? 2 : 1);
    if (m[1] === 'domattina' && !oraTrovata) return assistComponi(giorno, { h: 9, m: 0 }, ora);
  } else if ((m = togli(/\s(?:il\s+|la\s+|di\s+|per\s+)?(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)(?:\s+(?:prossim[oa]|che viene))?\s/))) {
    const target = ASSIST_GIORNI.indexOf(m[1]);
    let diff = (target - ora.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    giorno = piuGiorni(diff);
  } else if ((m = togli(/\s(?:il\s+|giorno\s+|il giorno\s+|per il\s+|entro il\s+)?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\s/))) {
    giorno = assistData(parseInt(m[1], 10), parseInt(m[2], 10) - 1, m[3], ora);
  } else if ((m = togli(new RegExp(`\\s(?:il\\s+|giorno\\s+|il giorno\\s+|per il\\s+|entro il\\s+)?(\\d{1,2}|primo|1°)\\s+(?:di\\s+)?(${ASSIST_MESI.join('|')})(?:\\s+(\\d{4}))?\\s`)))) {
    const g = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
    giorno = assistData(g, ASSIST_MESI.indexOf(m[2]), m[3], ora);
  } else if ((m = togli(/\s(?:il giorno|il|giorno|per il|entro il)\s+(\d{1,2})\s/))) {
    // Solo il numero del giorno: questo mese, o il prossimo se è già passato
    const g = parseInt(m[1], 10);
    let d = new Date(ora.getFullYear(), ora.getMonth(), g);
    if (d < oggi0) d = new Date(ora.getFullYear(), ora.getMonth() + 1, g);
    giorno = g >= 1 && g <= 31 ? d : null;
  } else if ((m = togli(/\s(?:la\s+)?settimana prossima\s/))) {
    giorno = piuGiorni(((1 - ora.getDay() + 7) % 7) || 7);   // lunedì prossimo
  }

  const orario = oraTrovata || parte;
  if (!giorno && parte?.oggi) giorno = oggi0;
  if (!giorno && !orario) return { quando: null, manca: 'quando' };
  if (!giorno) {
    // Solo l'ora: oggi, o domani se a quell'ora siamo già passati
    const d = new Date(oggi0); d.setHours(orario.h, orario.m, 0, 0);
    if (d <= ora) d.setDate(d.getDate() + 1);
    return { quando: d };
  }
  if (!orario) {
    // Solo il giorno: alle 9, se oggi serve l'ora
    if (giorno.getTime() === oggi0.getTime()) return { quando: null, manca: 'ora' };
    return assistComponi(giorno, { h: 9, m: 0 }, ora);
  }
  return assistComponi(giorno, orario, ora);
}

function assistComponi(giorno, orario, ora) {
  const d = new Date(giorno); d.setHours(orario.h, orario.m, 0, 0);
  if (d <= ora) return { quando: null, manca: 'passato' };
  return { quando: d };
}

// Giorno e mese senza anno: quest'anno, o il prossimo se la data è già passata
function assistData(g, mese, anno, ora) {
  if (g < 1 || g > 31 || mese < 0 || mese > 11) return null;
  let y = anno ? parseInt(anno, 10) : ora.getFullYear();
  if (y < 100) y += 2000;
  let d = new Date(y, mese, g);
  const oggi0 = new Date(ora); oggi0.setHours(0, 0, 0, 0);
  if (!anno && d < oggi0) d = new Date(y + 1, mese, g);
  return d;
}

const assistQuandoLabel = (d) => {
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const g = new Date(d); g.setHours(0, 0, 0, 0);
  const diff = Math.round((g - oggi) / 86400000);
  const ore = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const giorno = diff === 0 ? 'oggi' : diff === 1 ? 'domani'
    : d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== oggi.getFullYear() ? { year: 'numeric' } : {}) });
  return `${giorno} alle ${ore}`;
};

// ─────────────────────────────────────────────
// RICHIESTE
// ─────────────────────────────────────────────

async function assistUsers() {
  if (!AssistState.users) AssistState.users = (await TCAuth.listUsers().catch(() => [])).map(u => u.nickname);
  return AssistState.users;
}

// Risposta: { html } da mostrare nel pannello
async function assistRispondi(domanda) {
  const n = assistNorm(domanda);
  if (!n) return null;

  if (/promemoria/.test(n) && /\b(miei|mie|quali|elenco|lista|programmat\w*|attiv\w*|vedi|mostra\w*|fammi vedere|dammi)\b/.test(n) && !/^(ricorda|avvisa|segna|metti|crea|imposta)/.test(n))
    return assistElencoPromemoria();

  if (ASSIST_RE_PROMEMORIA.test(n)) return assistPromemoria(domanda.trim());

  if (/\bordin[ei]\b/.test(n)) return assistOrdini(n);

  // Nient'altro riconosciuto: si prova come ricerca di un ordine o di un cliente
  const trovati = assistCercaOrdini(n);
  if (trovati.length) return assistOrdini(n);
  return { html: `<p>Non ho capito. Prova con:</p>${assistEsempiHtml()}` };
}

// ── Promemoria ──
const ASSIST_RE_PROMEMORIA = /^(?:per favore\s+)?(?:(?:mi\s+)?(?:ricordi|ricordami|ricorda|ricordare|avvisami|avvisa|segnami|(?:segna|metti|crea|imposta|aggiungi)(?:mi)?\s+(?:un\s+)?promemoria|promemoria)\b)/;

async function assistPromemoria(frase) {
  const me = TCAuth.getNickname();
  let destinatario = me;
  const x = assistTesto(frase);
  assistTogli(x, /^\s*(?:per favore\s+)?(?:(?:mi\s+)?(?:ricordi|ricordami|ricorda|ricordare|avvisami|avvisa|segnami|(?:segna|metti|crea|imposta|aggiungi)(?:mi)?\s+(?:un\s+)?promemoria|promemoria)\b)(?:\s*:)?/);

  // "ricorda a Gianluca …" / "avvisa Marco …"
  const chi = x.t.match(/^\s*(?:a\s+|ad\s+)?([a-z0-9._-]+)\s/);
  if (chi && !['me', 'mi', 'di', 'che', 'domani', 'oggi'].includes(chi[1])) {
    const utenti = await assistUsers();
    const u = utenti.find(n => assistNorm(n) === chi[1]);
    if (u) { destinatario = u; assistTogli(x, /^\s*(?:a\s+|ad\s+)?[a-z0-9._-]+\s/); }
  }
  assistTogli(x, /^\s*a\s+me\s/);

  const q = assistParseQuando(x);
  let testo = assistResto(x)
    .replace(/^(?:per favore|per piacere)\s+/i, '')
    .replace(/^(?:di|che|de)\s+|^d[''’]\s*/i, '')
    .replace(/[\s,]+(?:per favore|grazie)$/i, '')
    .replace(/[\s,.;:!]+$/, '').trim();

  if (!testo) return { html: `<p>Di cosa ti devo ricordare? Ad esempio: <em>ricordami di chiamare il fornitore domani alle 10</em>.</p>`, keep: true };
  if (!q.quando) {
    const msg = q.manca === 'passato' ? "Quell'orario è già passato: dimmi un giorno o un'ora più avanti."
      : q.manca === 'ora' ? 'A che ora? Ad esempio: <em>oggi alle 16</em>.'
      : 'Quando te lo devo ricordare? Ad esempio: <em>domani alle 10</em>, <em>venerdì alle 15</em>, <em>il 25 alle 9</em>, <em>tra 2 ore</em>.';
    return { html: `<p>${msg}</p>`, keep: true };
  }

  testo = testo.charAt(0).toUpperCase() + testo.slice(1);
  const ref = assistRiferimento(testo);
  await Messages.send([destinatario], testo, ref, q.quando.toISOString());
  const perChi = destinatario === me ? 'Ti ricorderò' : `Lo ricorderò a <strong>${escapeHtml(destinatario)}</strong>`;
  return { html: `<p>${perChi} <strong>${escapeHtml(assistQuandoLabel(q.quando))}</strong>:</p>
    <div class="assist-card"><span>${escapeHtml(testo)}</span>${ref ? MsgRef.chip(ref) : ''}</div>` };
}

// Se il promemoria nomina un ordine o un cliente con un solo risultato, lo si allega
function assistRiferimento(testo) {
  const n = assistNorm(testo);
  const codice = n.match(/\b(?:ordine\s+(?:n\.?\s*)?)(\d{1,5})\b/);
  if (codice) {
    const o = TCFactory.getOrders().find(x => !x.deletedAt && TCFactory.orderNumber(x.id) === parseInt(codice[1], 10));
    if (o) return MsgRef.make('ordine', o.id);
  }
  const clienti = TCFactory.getClients().filter(c => {
    const nome = assistNorm(TCFactory.clientName(c));
    return nome.length >= 4 && n.includes(nome);
  });
  return clienti.length === 1 ? MsgRef.make('cliente', clienti[0].id) : null;
}

function assistElencoPromemoria() {
  const me = TCAuth.getNickname();
  const ora = new Date();
  const list = Messages.sent().filter(m => m.ricorda_il && new Date(m.ricorda_il) > ora)
    .sort((a, b) => a.ricorda_il.localeCompare(b.ricorda_il));
  if (!list.length) return { html: '<p>Non hai promemoria programmati.</p>' };
  return { html: `<p>${list.length === 1 ? 'Hai un promemoria programmato' : `Hai ${list.length} promemoria programmati`}:</p>
    <ul class="assist-list">${list.map(m => `
      <li class="assist-row" id="assist-p-${m.id}">
        <span class="assist-row-main"><strong>${escapeHtml(m.testo)}</strong>
          <small>${escapeHtml(assistQuandoLabel(new Date(m.ricorda_il)))}${m.destinatario !== me ? ' · per ' + escapeHtml(m.destinatario) : ''}</small></span>
        <button type="button" class="btn btn-ghost btn-sm" onclick="assistAnnulla('${m.id}')">Annulla</button>
      </li>`).join('')}</ul>` };
}

async function assistAnnulla(id) {
  try {
    await Messages.remove(id);
    document.getElementById('assist-p-' + id)?.remove();
    showToast('Promemoria annullato');
  } catch (e) { showToast(e.message, 'error'); }
}

// ── Ordini ──
const ASSIST_PAROLE_VUOTE = new Set(('dammi dai mostrami mostra fammi fai vedere vedi apri aprimi cerca cercami trova trovami ' +
  "voglio vorrei puoi potresti mi me il lo la le gli i l' un una uno di del della dello dei degli delle da dal dalla per " +
  'ordine ordini ordinе ultimo ultimi tutti tutte che cliente su sul sulla e ed a al alla con quello quelli').split(' '));

function assistTokens(n) {
  return n.replace(/\bl'/g, ' ').replace(/[^a-z0-9' ]/g, ' ').split(' ')
    .filter(w => w && !ASSIST_PAROLE_VUOTE.has(w));
}

// Distanza tra due parole (errori di battitura)
function assistDist(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function assistCercaOrdini(n) {
  const tokens = assistTokens(n);
  if (!tokens.length) return [];
  const codice = tokens.length === 1 && /^\d{1,5}$/.test(tokens[0]) ? parseInt(tokens[0], 10) : null;
  return TCFactory.getOrders().filter(o => !o.deletedAt).filter(o => {
    if (codice != null) return TCFactory.orderNumber(o.id) === codice;
    const cliente = TCFactory.getClient(o.clientId);
    const parole = assistNorm(`${o.nome} ${cliente ? TCFactory.clientName(cliente) : ''} ${TCFactory.orderCode(o)}`)
      .replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(Boolean);
    return tokens.every(t => parole.some(p => p.startsWith(t) || (t.length >= 5 && assistDist(t, p.slice(0, t.length + 1)) <= 1) || (t.length >= 5 && assistDist(t, p) <= 1)));
  }).sort((a, b) => (a.archived - b.archived) || String(b.dataOrdine || '').localeCompare(String(a.dataOrdine || '')));
}

function assistOrdini(n) {
  const trovati = assistCercaOrdini(n);
  if (!assistTokens(n).length) return { html: "<p>Di quale cliente o ordine? Ad esempio: <em>dammi l'ordine di Crossfit Grosseto</em>.</p>", keep: true };
  if (!trovati.length) return { html: '<p>Nessun ordine trovato con questo nome.</p>', keep: true };

  // "l'ultimo ordine di …" o un solo risultato: si apre subito
  const soloUno = trovati.length === 1 || /\bultimo\b/.test(n);
  if (soloUno) {
    const o = trovati[0];
    closeModal('assist-modal');
    openOrderDetail(o.id);
    return { html: `<p>Ho aperto l'ordine:</p><ul class="assist-list">${assistRigaOrdine(o)}</ul>` };
  }
  const aperti = trovati.filter(o => !o.archived).length;
  return { html: `<p>Ho trovato ${trovati.length} ordini${aperti && aperti < trovati.length ? ` (${aperti} non ${aperti === 1 ? 'archiviato' : 'archiviati'})` : ''}:</p>
    <ul class="assist-list">${trovati.slice(0, 12).map(assistRigaOrdine).join('')}</ul>
    ${trovati.length > 12 ? `<p class="assist-muted">E altri ${trovati.length - 12}: scrivi un nome più preciso.</p>` : ''}` };
}

function assistRigaOrdine(o) {
  const cliente = TCFactory.getClient(o.clientId);
  const stato = orderStatus(o);
  const data = o.dataOrdine ? new Date(o.dataOrdine + 'T12:00').toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  return `<li><button type="button" class="assist-row assist-row-btn" onclick="closeModal('assist-modal');openOrderDetail('${o.id}')">
    <span class="assist-row-main"><strong>${escapeHtml(TCFactory.orderCode(o))} · ${escapeHtml(o.nome || '')}</strong>
      <small>${[cliente ? TCFactory.clientName(cliente) : '', data].filter(Boolean).map(escapeHtml).join(' · ')}</small></span>
    <span class="assist-stato" style="--st:${stato.color}">${stato.label}</span>
  </button></li>`;
}

// ─────────────────────────────────────────────
// PANNELLO
// ─────────────────────────────────────────────

function assistantButton(cls = 'sidebar-msg-btn sidebar-assist-btn') {
  return `<button type="button" class="${cls}" onclick="closeModal('more-sheet');openAssistant()"
      aria-label="Assistente" title="Assistente (Ctrl+K)">${Icons.magic(18)}</button>`;
}

const assistEsempiHtml = () => `<div class="assist-esempi">${ASSIST_ESEMPI.map(e =>
  `<button type="button" class="chip chip-btn" onclick="assistUsaEsempio(this.textContent)">${escapeHtml(e)}</button>`).join('')}</div>`;

function openAssistant() {
  const modal = document.getElementById('assist-modal');
  if (!modal) return;
  renderAssistant();
  modal.classList.add('active');
  modal.onclick = (e) => { if (e.target === modal) closeModal('assist-modal'); };
  setTimeout(() => document.getElementById('assist-input')?.focus(), 50);
}

function renderAssistant(valore = '') {
  const modal = document.getElementById('assist-modal');
  modal.innerHTML = `
    <div class="modal assist-modal" role="dialog" aria-modal="true" aria-labelledby="assist-title">
      <div class="modal-header">
        <h2 id="assist-title">Assistente</h2>
        <button class="btn-icon" onclick="closeModal('assist-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body assist-body">
        <div class="assist-log" id="assist-log" aria-live="polite">
          ${AssistState.log.length ? AssistState.log.map(r => `
            <div class="assist-q">${escapeHtml(r.q)}</div>
            <div class="assist-a">${r.a}</div>`).join('')
          : `<p class="assist-muted">Chiedi qualcosa, ad esempio:</p>${assistEsempiHtml()}`}
        </div>
        <form class="assist-form" onsubmit="event.preventDefault();assistInvia()">
          <input id="assist-input" class="form-input" autocomplete="off" maxlength="300" placeholder="Ricordami… · Dammi l'ordine di…"
            value="${escapeHtml(valore)}" aria-label="Richiesta">
          ${ASSIST_SR ? `<button type="button" class="btn btn-secondary assist-mic ${AssistState.ascolto ? 'ascolto' : ''}" onclick="assistMic()"
            aria-pressed="${!!AssistState.ascolto}" aria-label="${AssistState.ascolto ? 'Smetti di ascoltare' : 'Parla'}" title="Parla">${ASSIST_ICONA_MIC}</button>` : ''}
          <button type="submit" class="btn btn-primary">Invia</button>
        </form>
      </div>
    </div>`;
  const log = document.getElementById('assist-log');
  log.scrollTop = log.scrollHeight;
}

function assistUsaEsempio(testo) {
  const input = document.getElementById('assist-input');
  input.value = testo;
  input.focus();
}

async function assistInvia(aVoce = false) {
  const input = document.getElementById('assist-input');
  const q = input.value.trim();
  if (!q) return;
  input.disabled = true;
  let r;
  try { r = await assistRispondi(q); }
  catch (e) { r = { html: `<p>${escapeHtml(e.message || 'Qualcosa è andato storto')}</p>`, keep: true }; }
  if (!r) { input.disabled = false; return; }
  if (aVoce) assistParla(r.html);
  AssistState.log.push({ q, a: r.html });
  AssistState.log = AssistState.log.slice(-20);
  if (!document.getElementById('assist-modal').classList.contains('active')) return;   // è stato aperto un ordine
  renderAssistant(r.keep ? q : '');
  document.getElementById('assist-input')?.focus();
}

// ─────────────────────────────────────────────
// VOCE
// Riconoscimento e lettura sono quelli del browser (Chrome, Edge, Safari):
// nessuna chiamata API nostra. Su Firefox il microfono non compare.
// ─────────────────────────────────────────────

const ASSIST_SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const ASSIST_ICONA_MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/></svg>`;

// Numeri detti a parole dopo "alle", "il", "tra"… diventano cifre
const ASSIST_PAROLE_NUMERI = ['zero','uno','due','tre','quattro','cinque','sei','sette','otto','nove','dieci','undici','dodici','tredici',
  'quattordici','quindici','sedici','diciassette','diciotto','diciannove','venti','ventuno','ventidue','ventitre','ventiquattro',
  'venticinque','ventisei','ventisette','ventotto','ventinove','trenta','trentuno'];
function assistNumeriParlati(testo) {
  return testo.replace(/\b(alle|all'|le|ore|il|giorno|tra|fra|per le|verso le)\s+(un'|una|[a-zé]+)\b/gi, (m, pre, parola) => {
    const p = parola.toLowerCase().replace('é', 'e');
    const n = p === "un'" || p === 'una' ? 1 : p === 'ventitré' ? 23 : ASSIST_PAROLE_NUMERI.indexOf(p);
    return n > 0 ? `${pre} ${n}` : m;
  }).replace(/\b(\d{1,2})\s+e\s+(cinque|dieci|quindici|venti|venticinque|trenta|trentacinque|quaranta|quarantacinque|cinquanta|cinquantacinque)\b/gi,
    (m, h, min) => `${h}:${{ cinque: '05', dieci: 10, quindici: 15, venti: 20, venticinque: 25, trenta: 30, trentacinque: 35, quaranta: 40,
      quarantacinque: 45, cinquanta: 50, cinquantacinque: 55 }[min.toLowerCase()]}`)
    .replace(/\b(\d{1,2})\s+e\s+(\d{2})\b/g, '$1:$2');
}

function assistMic() {
  if (AssistState.ascolto) { AssistState.ascolto.stop(); return; }
  window.speechSynthesis?.cancel();
  const rec = new ASSIST_SR();
  rec.lang = 'it-IT';
  rec.interimResults = true;
  rec.continuous = false;
  let finale = '';
  rec.onresult = (e) => {
    const testo = [...e.results].map(r => r[0].transcript).join('');
    finale = [...e.results].every(r => r.isFinal) ? testo : finale;
    const input = document.getElementById('assist-input');
    if (input) input.value = testo;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') showToast('Il browser non ha il permesso di usare il microfono', 'error');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') showToast('Non sono riuscito ad ascoltare', 'error');
  };
  rec.onend = () => {
    AssistState.ascolto = null;
    const input = document.getElementById('assist-input');
    const testo = (finale || input?.value || '').trim();
    renderAssistant(testo);
    if (finale.trim()) {
      document.getElementById('assist-input').value = assistNumeriParlati(finale.trim());
      assistInvia(true);
    }
  };
  AssistState.ascolto = rec;
  renderAssistant('');
  try { rec.start(); } catch { AssistState.ascolto = null; renderAssistant(''); }
}

// Legge la risposta: le frasi, non gli elenchi completi
function assistParla(html) {
  if (!window.speechSynthesis) return;
  const box = document.createElement('div');
  box.innerHTML = html;
  const frasi = [...box.querySelectorAll('p, .assist-card > span')].map(n => n.textContent.trim()).filter(Boolean);
  if (!frasi.length) return;
  const u = new SpeechSynthesisUtterance(frasi.join(' ').replace(/:\s*$/, '.'));
  u.lang = 'it-IT';
  const voce = speechSynthesis.getVoices().find(v => v.lang?.startsWith('it'));
  if (voce) u.voice = voce;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// Ctrl+K / Cmd+K apre l'assistente da qualsiasi pagina
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && TCAuth.isLoggedIn()) {
    e.preventDefault();
    const modal = document.getElementById('assist-modal');
    if (modal?.classList.contains('active')) closeModal('assist-modal'); else openAssistant();
  }
});
