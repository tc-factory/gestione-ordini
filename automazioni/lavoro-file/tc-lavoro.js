// T&C Factory — TC Lavoro: tempo passato sui file dei clienti (NAS e locale) → task nel gestionale.
//
// App "stay-open" (JavaScript for Automation) compilata da installa.zsh, senza icona nel Dock.
// Ogni 20 secondi: quale app è davanti, quale documento ha aperto, se la persona è attiva
// (mouse/tastiera usati negli ultimi 3 minuti). Il tempo attivo si somma al cliente del file.
// Ogni 5 minuti manda i totali del giorno a tc_registra_lavoro_file (sql/task-lavoro-file.sql).
// Niente schermate, niente tasti: solo app, percorso del file e minuti.

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

let ultimoCampione = 0, ultimoInvio = 0, ultimoCliente = null, stato = null;

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

  if (secondiInattivo() < INATTIVO_MAX) {
    const app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    const id = app.isNil() ? '' : ObjC.unwrap(app.bundleIdentifier) || '';
    if (id && !ESCLUSE.includes(id)) {
      const nomeApp = ObjC.unwrap(app.localizedName) || id;
      const percorso = documentoDavanti(app);
      let c = percorso ? clienteDi(percorso) : null;
      if (c) ultimoCliente = { ...c, at: ora };
      else if (!percorso && ADOBE[id] && ultimoCliente && ora - ultimoCliente.at < SENZA_FILE_MAX * 1000)
        c = { ...ultimoCliente, file: '(documento non salvato)' };
      if (c) aggiungi(c, nomeApp, trascorsi, ora);
    }
  }
  if (ora - ultimoInvio >= INVIO_OGNI * 1000) invia();
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

const fmtMin = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

function invia() {
  ultimoInvio = Date.now();
  const conf = leggiJson(CONFIG, null);
  if (!conf || !stato) return;
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
  const tmp = CARTELLA + '/invio.json';
  scriviFile(tmp, JSON.stringify(corpo));
  try {
    const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
    const codice = shell(`/usr/bin/curl -s -m 20 -o /dev/null -w '%{http_code}' -X POST ${q(conf.url + '/rest/v1/rpc/tc_registra_lavoro_file')} ` +
      `-H ${q('apikey: ' + conf.anon)} -H 'Content-Type: application/json' --data-binary @${q(tmp)}`);
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
  Object.keys(stato.giorni).forEach(g => { if (g < limite && !stato.giorni[g].da_inviare) delete stato.giorni[g] });
}

function run() { try { campiona() } catch (e) {} }
function idle() { try { campiona() } catch (e) {} return PASSO }
function quit() { try { invia() } catch (e) {} return true }
