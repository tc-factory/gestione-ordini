// T&C Factory — TC Lavoro: tempo passato sui file dei clienti (NAS e locale) → task nel gestionale.
//
// App "stay-open" (JavaScript for Automation) compilata da installa.zsh, senza icona nel Dock.
// Ogni 20 secondi: quale app è davanti, quale documento ha aperto, se la persona è attiva
// (mouse/tastiera usati negli ultimi 3 minuti). Il tempo attivo si somma al cliente del file.
// Ogni 5 minuti manda i totali del giorno a tc_registra_lavoro_file (sql/task-lavoro-file.sql).
// Niente schermate, niente tasti: solo app, percorso del file e minuti.
//
// Uso del Mac (solo se l'admin lo accende per questo Mac, sql/uso-mac.sql): minuti del giorno per
// categoria (lavoro, mail, messaggi, ricerche, video, social, notizie, acquisti, altri siti).
// Dei siti si tiene solo il dominio (youtube.com), mai l'indirizzo completo né cosa si cerca;
// i siti sotto i 5 minuti nel giorno partono come "Altri siti", senza nome.
//
// Presenza (sql/presenze-mac.sql): appena la persona usa il Mac, finché la presenza del giorno non c'è,
// chiede a tc_lavoro_presenza di segnarla; il server la segna solo se il Mac è sulla rete del lavoro.

ObjC.import('AppKit');
ObjC.import('Foundation');

const PASSO = 20;            // secondi tra un controllo e l'altro
const INATTIVO_MAX = 180;    // oltre 3 minuti senza mouse/tastiera il tempo non conta
const INVIO_OGNI = 300;      // secondi tra un invio e l'altro
const SENZA_FILE_MAX = 900;  // documento non ancora salvato: vale per l'ultimo cliente se visto da meno di 15 minuti
const ESCLUSE = ['com.apple.finder', 'com.apple.loginwindow', 'com.apple.ScreenSaver.Engine'];

const HOME = ObjC.unwrap($.NSHomeDirectory());
const CARTELLA = HOME + '/Library/Application Support/TC Lavoro';
const CONFIG = CARTELLA + '/config.json';
const STATO = CARTELLA + '/stato.json';

const PRESENZA_OGNI = 60;    // secondi tra un tentativo di presenza e l'altro (Mac fuori dalla rete del lavoro)

let ultimoCampione = 0, ultimoInvio = 0, ultimoCliente = null, stato = null, ultimaPresenza = 0;

function leggiFile(p) {
  const s = $.NSString.stringWithContentsOfFileEncodingError(p, $.NSUTF8StringEncoding, null);
  return s.isNil() ? null : ObjC.unwrap(s);
}
function scriviFile(p, testo) {
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(CARTELLA, true, $(), null);
  $(testo).writeToFileAtomicallyEncodingError(p, true, $.NSUTF8StringEncoding, null);
}
function leggiJson(p, vuoto) {
  try { return JSON.parse(leggiFile(p) || '') } catch (e) { return vuoto }
}
function shell(cmd) {
  const a = Application.currentApplication();
  a.includeStandardAdditions = true;
  return a.doShellScript(cmd);
}
function appleScript(src) {
  const err = Ref();
  const r = $.NSAppleScript.alloc.initWithSource(src).executeAndReturnError(err);
  if (r.isNil()) return null;
  const s = r.stringValue;
  return s.isNil() ? null : ObjC.unwrap(s);
}
function giornoDi(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Secondi da quando mouse e tastiera sono fermi
function secondiInattivo() {
  try { return Number(shell("/usr/sbin/ioreg -c IOHIDSystem | /usr/bin/awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'")) || 0 }
  catch (e) { return 0 }
}

// Percorso del documento davanti: prima chiedendolo alle app Adobe, poi con l'accessibilità (AXDocument)
const ADOBE = {
  'com.adobe.illustrator': 'POSIX path of (file path of current document as alias)',
  'com.adobe.Photoshop': 'POSIX path of (file path of current document as alias)',
  'com.adobe.InDesign': 'POSIX path of (full name of active document as alias)',
};
function documentoDavanti(app) {
  const id = ObjC.unwrap(app.bundleIdentifier) || '';
  const pid = app.processIdentifier;
  if (ADOBE[id]) {
    const p = appleScript(`with timeout of 4 seconds
      tell application id "${id}" to if (count documents) > 0 then return ${ADOBE[id]}
    end timeout`);
    if (p) return p;
  }
  const url = appleScript(`with timeout of 4 seconds
    tell application "System Events" to tell (first process whose unix id is ${pid}) to return value of attribute "AXDocument" of window 1
  end timeout`);
  if (url && url.startsWith('file://')) {
    const u = $.NSURL.URLWithString(url);
    if (!u.isNil() && !u.path.isNil()) return ObjC.unwrap(u.path);
  }
  return null;
}

// ── Uso del Mac: solo i tool di lavoro col loro nome, tutto il resto in "Altro" senza nome ──
// Le app desktop contano come lavoro (col nome dell'app), tranne quelle chiaramente personali (sotto).
// Nel browser conta come lavoro solo un sito di lavoro (lista sotto); ogni altro sito è "Altro", mai scritto.
const BROWSER = {
  'com.google.Chrome': 'URL of active tab of front window',
  'com.brave.Browser': 'URL of active tab of front window',
  'com.microsoft.edgemac': 'URL of active tab of front window',
  'company.thebrowser.Browser': 'URL of active tab of front window',
  'com.apple.Safari': 'URL of current tab of front window',
  'org.mozilla.firefox': null,   // Firefox non dice il sito: conta come "Altro"
};
// App desktop che NON sono lavoro: finiscono in "Altro" (musica, streaming, messaggistica personale).
const APP_NONLAVORO = {
  'com.spotify.client': 1, 'com.apple.Music': 1, 'com.apple.TV': 1, 'com.netflix.Netflix': 1,
  'net.whatsapp.WhatsApp': 1, 'desktop.WhatsApp': 1, 'ru.keepcoder.Telegram': 1, 'org.telegram.desktop': 1,
  'com.apple.MobileSMS': 1, 'com.facebook.archon': 1, 'com.apple.FaceTime': 1,
};
// Siti di lavoro (vale anche per i sottodomini): gestionale, negozi, fornitori, corrieri, mail e strumenti.
const LAVORO_SITI = [
  'pngs.it', 'shopify.com', 'myshopify.com', 'customily.com', 'supabase.com', 'github.com', 'canva.com', 'figma.com',
  'docs.google.com', 'drive.google.com', 'sheets.google.com', 'claude.ai', 'anthropic.com', 'adobe.com', 'freepik.com',
  'freepik.es', 'dafont.com', 'fonts.google.com', 'railway.app', 'railway.com', 'ciucciamilcalzino.it', 'bienjugado.com',
  'boxfactorylab.com', 'asteroidistore.com', 'liveprinting.it', 'stanleystella.com', 'actionwear.it', 'camac.it', 'mood.it',
  'gls-italy.com', 'brt.it', 'ups.com', 'dhl.com', 'poste.it', 'fattureincloud.it', 'agenziaentrate.gov.it', 'paypal.com',
  'stripe.com', 'business.facebook.com', 'meta.com', 'whatsapp.business',
  'webmail.aruba.it', 'webmail.pec.it', 'mail.google.com', 'outlook.office.com', 'outlook.office365.com', 'aruba.it',
];
function dominio(url) {
  const m = /^https?:\/\/([^\/:?#]+)/i.exec(url || '');
  return m ? m[1].toLowerCase().replace(/^www\./, '') : null;
}
function sitoLavoro(host) {
  return LAVORO_SITI.some(d => host === d || host.endsWith('.' + d));
}
// Il sito come si mostra: il dominio senza sottodomini (admin.shopify.com → shopify.com)
function sitoBreve(host) {
  const p = host.split('.');
  const n = p.length > 2 && /^(co|com|gov|org|net)$/.test(p[p.length - 2]) ? 3 : 2;
  return p.slice(-n).join('.');
}
// { categoria, voce } di quello che c'è davanti. 'lavoro' col nome del tool, oppure 'altro' sempre "Altro".
function usoDavanti(app, id, nomeApp) {
  if (id in BROWSER) {
    const src = BROWSER[id];
    const url = src ? appleScript(`with timeout of 3 seconds
      tell application id "${id}" to if (count windows) > 0 then return ${src}
    end timeout`) : null;
    const host = dominio(url);
    if (host && sitoLavoro(host)) return { categoria: 'lavoro', voce: sitoBreve(host) };
    return { categoria: 'altro', voce: 'Altro' };
  }
  if (APP_NONLAVORO[id]) return { categoria: 'altro', voce: 'Altro' };
  return { categoria: 'lavoro', voce: nomeApp };
}

// Cliente dal percorso: la cartella dopo "Clienti" (saltando la lettera), altrimenti brand o cartella del file
function clienteDi(percorso) {
  let base, parti, locale = false;
  if (percorso.startsWith('/Volumes/')) {
    parti = percorso.slice(9).split('/');
    base = parti.shift();
  } else if (percorso.startsWith(HOME + '/')) {
    parti = percorso.slice(HOME.length + 1).split('/');
    base = 'Mac';
    locale = true;
    if (['Library', 'Applications', '.Trash'].includes(parti[0])) return null;
  } else return null;
  const file = parti.pop();
  if (!file || file.startsWith('.')) return null;
  const i = parti.findIndex(s => /^(\d+\s+)?clienti$/i.test(s.trim()));
  if (i >= 0) {
    let j = i + 1;
    if (parti[j] && parti[j].trim().length === 1) j++;   // la lettera dell'archivio (A, B, C…)
    if (parti[j] && !parti[j].startsWith('-')) {
      const brand = i > 0 && !locale ? parti[0] : '';
      return { cliente: parti[j].trim(), brand, cartella: [base, ...parti.slice(0, j + 1)].join('/'), file, locale };
    }
  }
  if (locale) {
    const cart = parti[parti.length - 1];
    if (!cart || ['Desktop', 'Documents', 'Downloads', 'Documenti', 'Scrivania'].includes(cart) && parti.length === 1)
      return { cliente: 'File sulla scrivania', brand: '', cartella: [base, ...parti].join('/'), file, locale };
    return { cliente: cart.trim(), brand: '', cartella: [base, ...parti].join('/'), file, locale };
  }
  if (!parti.length) return { cliente: base, brand: '', cartella: base, file, locale };
  return { cliente: parti[0].trim(), brand: '', cartella: [base, parti[0]].join('/'), file, locale };
}

function campiona() {
  const ora = Date.now();
  const trascorsi = ultimoCampione ? Math.min(60, (ora - ultimoCampione) / 1000) : PASSO;
  ultimoCampione = ora;
  if (!stato) stato = leggiJson(STATO, { giorni: {} });

  const attivo = secondiInattivo() < INATTIVO_MAX;
  if (attivo) try { presenza(ora) } catch (e) {}
  if (attivo) try {
    const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    const id = app.isNil() ? '' : ObjC.unwrap(app.bundleIdentifier) || '';
    if (id && !ESCLUSE.includes(id)) {
      const nomeApp = ObjC.unwrap(app.localizedName) || id;
      if (stato.uso === true) aggiungiUso(usoDavanti(app, id, nomeApp), trascorsi, ora);
      const percorso = documentoDavanti(app);
      let c = percorso ? clienteDi(percorso) : null;
      if (c) ultimoCliente = { ...c, at: ora };
      else if (!percorso && ADOBE[id] && ultimoCliente && ora - ultimoCliente.at < SENZA_FILE_MAX * 1000)
        c = { ...ultimoCliente, file: '(documento non salvato)' };
      if (c) aggiungi(c, nomeApp, trascorsi, ora);
    }
  } catch (e) { /* un errore su un campione non ferma gli invii */ }
  if (ora - ultimoInvio >= INVIO_OGNI * 1000) invia();
}

// Entrata: la prima volta del giorno che il Mac è usato sulla rete del lavoro
function presenza(ora) {
  const oggi = giornoDi(new Date(ora));
  if (stato.presenza === oggi || ora - ultimaPresenza < PRESENZA_OGNI * 1000) return;
  ultimaPresenza = ora;
  const conf = leggiJson(CONFIG, null);
  if (!conf) return;
  const [codice, risposta] = rpc(conf, 'tc_lavoro_presenza', { p_chiave: conf.chiave }, 8);
  if (codice === '200' && JSON.parse(risposta).presente === true) {
    stato.presenza = oggi;
    scriviFile(STATO, JSON.stringify(stato));
  }
}

function aggiungi(c, nomeApp, sec, ora) {
  const g = giornoDi(new Date(ora));
  const giorno = stato.giorni[g] = stato.giorni[g] || { clienti: {} };
  const nome = c.brand ? `${c.cliente} (${c.brand})` : c.cliente;
  const cl = giorno.clienti[nome] = giorno.clienti[nome] || { cartella: c.cartella, sec: 0, file: {} };
  cl.sec += sec;
  cl.fine = new Date(ora).toISOString();
  cl.locale = c.locale;
  const f = cl.file[c.file] = cl.file[c.file] || { sec: 0, app: nomeApp };
  f.sec += sec;
  f.app = nomeApp;
  giorno.da_inviare = true;
  scriviFile(STATO, JSON.stringify(stato));
}

function aggiungiUso(u, sec, ora) {
  const g = giornoDi(new Date(ora));
  const giorno = stato.giorni[g] = stato.giorni[g] || { clienti: {} };
  giorno.uso = giorno.uso || {};
  const k = u.categoria + '\t' + u.voce;
  giorno.uso[k] = (giorno.uso[k] || 0) + sec;
  giorno.uso_da_inviare = true;
  scriviFile(STATO, JSON.stringify(stato));
}

// Le voci del giorno da mandare: lavoro per tool, tutto il resto in un'unica "Altro"
function vociUso(uso) {
  return Object.entries(uso || {}).map(([k, sec]) => {
    const [categoria, voce] = k.split('\t');
    return { categoria, voce, minuti: Math.round(sec / 60) };
  }).filter(v => v.minuti >= 1);
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// Chiama una funzione del database: [codice HTTP, risposta]
function rpc(conf, nome, corpo, secondi = 20) {
  const tmp = CARTELLA + '/invio.json';
  scriviFile(tmp, JSON.stringify(corpo));
  const out = shell(`/usr/bin/curl -s -m ${secondi} -w '|%{http_code}' -X POST ${q(conf.url + '/rest/v1/rpc/' + nome)} ` +
    `-H ${q('apikey: ' + conf.anon)} -H 'Content-Type: application/json' --data-binary @${q(tmp)}`);
  const i = out.lastIndexOf('|');
  return [out.slice(i + 1).trim(), out.slice(0, i).trim()];
}

// Manda l'uso dei giorni aperti; la risposta dice se su questo Mac è acceso (altrimenti non si raccoglie)
function inviaUso(conf) {
  const giorni = Object.keys(stato.giorni).filter(g => stato.giorni[g].uso_da_inviare);
  try {
    const [codice, risposta] = rpc(conf, 'tc_registra_uso_mac', {
      p_chiave: conf.chiave,
      p: { giorni: giorni.map(g => ({ giorno: g, voci: vociUso(stato.giorni[g].uso) })) },
    });
    if (codice !== '200') return;
    stato.uso = risposta === 'true';
    giorni.forEach(g => { stato.giorni[g].uso_da_inviare = false });
    if (!stato.uso) Object.values(stato.giorni).forEach(x => { delete x.uso });
    scriviFile(STATO, JSON.stringify(stato));
  } catch (e) { /* senza rete: si riprova al prossimo giro */ }
}

const fmtMin = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

function invia() {
  ultimoInvio = Date.now();
  const conf = leggiJson(CONFIG, null);
  if (!conf || !stato) return;
  inviaUso(conf);
  const giorni = Object.keys(stato.giorni).filter(g => stato.giorni[g].da_inviare);
  if (!giorni.length) return pulisci();
  const corpo = {
    p_chiave: conf.chiave,
    p: {
      giorni: giorni.map(g => ({
        giorno: g,
        clienti: Object.entries(stato.giorni[g].clienti).map(([nome, cl]) => ({
          cliente: nome,
          cartella: cl.cartella,
          minuti: Math.round(cl.sec / 60),
          fine: cl.fine,
          dettaglio: `${cl.locale ? 'In locale' : 'Sul NAS'}: ${cl.cartella}\n\n` + Object.entries(cl.file)
            .sort((a, b) => b[1].sec - a[1].sec).slice(0, 40)
            .map(([f, x]) => `• ${f} — ${fmtMin(x.sec)} in ${x.app}`).join('\n'),
        })),
      })),
    },
  };
  try {
    const [codice] = rpc(conf, 'tc_registra_lavoro_file', corpo);
    if (codice === '200') {
      giorni.forEach(g => { stato.giorni[g].da_inviare = false });
      scriviFile(STATO, JSON.stringify(stato));
    }
  } catch (e) { /* senza rete: si riprova al prossimo giro */ }
  pulisci();
}

// Tiene solo gli ultimi 7 giorni già inviati
function pulisci() {
  const limite = giornoDi(new Date(Date.now() - 7 * 86400000));
  Object.keys(stato.giorni).forEach(g => { if (g < limite && !stato.giorni[g].da_inviare && !stato.giorni[g].uso_da_inviare) delete stato.giorni[g] });
}

function run() { try { campiona() } catch (e) {} }
function idle() { try { campiona() } catch (e) {} return PASSO }
function quit() { try { invia() } catch (e) {} return true }
