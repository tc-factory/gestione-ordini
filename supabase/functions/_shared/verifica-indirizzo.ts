// T&C Factory — Riscontro dell'indirizzo di un ordine sulle mappe (OpenStreetMap, via Photon di komoot)
//
// 1. trova il comune (o la frazione) scritto nell'ordine e i suoi confini
// 2. cerca la via solo lì dentro
// 3. confronta il nome: "25 aprile" = "Via XXV Aprile" = "Via Venticinque Aprile"
//
// Esiti:
//   ok               la via esiste in quel comune
//   corretta         la via esiste ma manca "Via"/"Piazza"…: `nuova` è la riga corretta, sicura da scrivere su Shopify
//   simile           non esiste così, ma ce n'è una molto simile (`suggerimento`): la sceglie una persona,
//                    tranne gli errori di battitura sicuri (`nuova` valorizzata: si corregge da sola, vedi sicuraDaSola)
//   ambigua          manca "Via"/"Piazza" e in quel comune ci sono sia la via sia la piazza con quel nome
//   non_trovata      nel comune non c'è niente che le somigli
//   non_verificabile comune non trovato, estero o servizio che non risponde: nessun avviso
//
// A Photon arrivano solo via, CAP e città: mai nome, mail o telefono del cliente.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type EsitoIndirizzo = {
  esito: 'ok' | 'corretta' | 'simile' | 'ambigua' | 'non_trovata' | 'non_verificabile';
  nota: string;
  nuova?: string;          // corretta, o simile sicura: address1 da scrivere
  suggerimento?: string;   // simile / ambigua: il nome com'è sulle mappe
  trovata?: string;        // ok / corretta: la via trovata
};

const PHOTON = 'https://photon.komoot.io/api/';
const UA = 'CreativeSystem/1.0 (verifica indirizzi)';
const PAUSA_MS = 1100;     // regola d'uso di Photon: niente raffiche

// Tipi di strada, con le abbreviazioni più usate → forma piena
const TIPI: Record<string, string> = {
  via: 'via', v: 'via', viale: 'viale', vle: 'viale', 'v.le': 'viale', piazza: 'piazza', p: 'piazza', pza: 'piazza', pzza: 'piazza', 'p.za': 'piazza', 'p.zza': 'piazza',
  piazzale: 'piazzale', ple: 'piazzale', 'p.le': 'piazzale', piazzetta: 'piazzetta', corso: 'corso', cso: 'corso', 'c.so': 'corso', largo: 'largo', lgo: 'largo',
  vicolo: 'vicolo', vic: 'vicolo', vico: 'vico', strada: 'strada', str: 'strada', stradella: 'stradella', stradone: 'stradone', localita: 'localita', loc: 'localita',
  frazione: 'frazione', fraz: 'frazione', fr: 'frazione', contrada: 'contrada', cda: 'contrada', 'c.da': 'contrada', borgo: 'borgo', salita: 'salita', discesa: 'discesa',
  lungomare: 'lungomare', lungarno: 'lungarno', lungotevere: 'lungotevere', galleria: 'galleria', traversa: 'traversa', rampa: 'rampa', calata: 'calata',
  circonvallazione: 'circonvallazione', passeggiata: 'passeggiata', rione: 'rione', parco: 'parco', villaggio: 'villaggio', regione: 'regione', podere: 'podere',
  vialetto: 'vialetto', sentiero: 'sentiero', scalinata: 'scalinata', calle: 'calle', campo: 'campo', fondamenta: 'fondamenta', salizada: 'salizada', ruga: 'ruga',
  baglio: 'baglio', cortile: 'cortile', corte: 'corte', piano: 'piano', supportico: 'supportico', vicoletto: 'vicoletto', viottolo: 'viottolo', molo: 'molo',
};
const RURALI = new Set(['localita', 'frazione', 'contrada', 'borgo', 'podere', 'regione', 'villaggio', 'rione', 'piano']);
const TIPO_SCRITTO: Record<string, string> = { localita: 'Località' };
const scriviTipo = (t: string) => TIPO_SCRITTO[t] || t[0].toUpperCase() + t.slice(1);

// Parole che vengono dopo il nome della via: civico, interno, scala…
const DOPO = new Set(['n', 'nr', 'num', 'numero', 'civ', 'civico', 'int', 'interno', 'sc', 'scala', 'pal', 'palazzina', 'piano', 'p', 'snc', 'sn', 'bis', 'ter', 'km']);

const NUMERI = ['', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici',
  'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove', 'venti', 'ventuno', 'ventidue', 'ventitre', 'ventiquattro', 'venticinque', 'ventisei',
  'ventisette', 'ventotto', 'ventinove', 'trenta', 'trentuno'];
const PAROLA_NUMERO = new Map(NUMERI.map((p, i) => [p, String(i)]).filter(([p]) => p));
PAROLA_NUMERO.set('primo', '1');

function romano(t: string): string | null {
  if (!/^[ivx]+$/.test(t)) return null;
  const v: Record<string, number> = { i: 1, v: 5, x: 10 };
  let n = 0;
  for (let i = 0; i < t.length; i++) { const a = v[t[i]], b = v[t[i + 1]] || 0; n += a < b ? -a : a; }
  // Solo numeri scritti bene (es. "xxv"), non sequenze qualsiasi
  const scrivi = (k: number) => 'x'.repeat(Math.floor(k / 10)) + ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix'][k % 10];
  return n >= 1 && n <= 39 && scrivi(n) === t ? String(n) : null;
}

// Minuscolo, senza accenti e punteggiatura, numeri romani e in lettere → cifre
export function parole(s: string): string[] {
  const t = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(v\.le|p\.zza|p\.za|p\.le|c\.so|c\.da)/g, (m) => TIPI[m] || m)
    .replace(/(\d)([a-z])\b/g, '$1 $2')
    .replace(/[^a-z0-9/]+/g, ' ').trim();
  return t ? t.split(/\s+/).map(w => PAROLA_NUMERO.get(w) || romano(w) || w) : [];
}

const numero = (w: string) => /^\d+(\/\w*)?$/.test(w);

// Una parte d'indirizzo ("Via XXV Aprile 12/b") → tipo e nome ("via", "25 aprile")
export function nomeVia(s: string): { tipo: string | null; nome: string } {
  const w = parole(s);
  let tipo: string | null = null;
  if (w.length > 1 && TIPI[w[0]]) tipo = TIPI[w.shift()!];
  // Toglie dalla fine civico, interno, lettere singole…
  while (w.length > 1 && (numero(w[w.length - 1]) || DOPO.has(w[w.length - 1]) || w[w.length - 1].length === 1)) w.pop();
  return { tipo, nome: w.join(' ') };
}

function distanza(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prec = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prec + (a[i - 1] === b[j - 1] ? 0 : 1));
      prec = t;
    }
  }
  return d[b.length];
}
const somiglianza = (a: string, b: string) => 1 - distanza(a, b) / Math.max(a.length, b.length, 1);

// Stesso nome: uguale, o uno è l'altro con qualcosa in più ("garibaldi" = "giuseppe garibaldi", "25 aprile" = "25 aprile 1945")
function stessoNome(a: string, b: string) {
  if (a === b) return true;
  const [corto, lungo] = a.length <= b.length ? [a, b] : [b, a];
  if (corto.replace(/[\d\s]/g, '').length < 4) return false;
  return lungo.startsWith(corto + ' ') || lungo.endsWith(' ' + corto);
}

// Quanto somiglia: confronta anche con le code del nome (spesso si omette il nome di battesimo:
// "prova a di leyni" ≈ "provana di leyni" di "andrea provana di leyni")
function quantoSimile(scritto: string, mappa: string) {
  const m = mappa.split(' ');
  let best = somiglianza(scritto, mappa);
  for (let i = 1; i < m.length; i++) {
    const coda = m.slice(i).join(' ');
    if (coda.replace(/[\d\s]/g, '').length >= 4) best = Math.max(best, somiglianza(scritto, coda));
  }
  return best;
}

// Il testo da cercare: com'è scritto, senza civico e interno (le mappe capiscono "XX Settembre", non "20 settembre")
function testoDaCercare(s: string) {
  const w = s.trim().split(/\s+/);
  while (w.length > 1 && /^(\d+\w?(\/\w*)?|n\.?|nr\.?|civ\.?|int\.?|interno|scala|sc\.?|piano|snc|s\.n\.c\.?|[a-z]\.?)$/i.test(w[w.length - 1])) w.pop();
  return w.join(' ');
}

// La riga 1 con la via giusta al posto di quella scritta, tenendo civico e il resto:
// "Via valter tobagi,1" + "Via Walter Tobagi" → "Via Walter Tobagi, 1". Stessa regola di ordRigaConVia in js/controllo.js
export function rigaConVia(riga1: string, via: string): string | null {
  const parti = String(riga1 || '').split(',').map(p => p.trim());
  const i = parti.findIndex(p => /[a-z]{3}/i.test(p));
  if (i < 0 || !String(via || '').trim()) return null;
  const w = parti[i].split(/\s+/);
  const coda: string[] = [];
  while (w.length > 1 && /^(\d+\w?(\/\w*)?|n\.?|nr\.?|civ\.?|int\.?|interno|scala|sc\.?|piano|snc|s\.n\.c\.?)$/i.test(w[w.length - 1])) coda.unshift(w.pop()!);
  parti[i] = [via.trim(), ...coda].join(' ');
  const nuova = parti.filter(Boolean).join(', ');
  return nuova === riga1.trim() ? null : nuova;
}

async function photon(params: Record<string, string | string[]>, fetchFn: typeof fetch): Promise<Row[]> {
  const u = new URL(PHOTON);
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) u.searchParams.append(k, x);
  const res = await fetchFn(u, { headers: { 'User-Agent': UA } });
  await new Promise(r => setTimeout(r, PAUSA_MS));
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  return (await res.json()).features || [];
}

// Confini del comune o della frazione: [ovest, nord, est, sud]
async function zona(citta: string, cap: string, fetchFn: typeof fetch): Promise<number[] | null> {
  // "Mortegliano MORTEGLIANO" → "mortegliano"
  let w = parole(citta);
  if (w.length % 2 === 0 && w.slice(0, w.length / 2).join(' ') === w.slice(w.length / 2).join(' ')) {
    citta = citta.trim().split(/\s+/).slice(0, w.length / 2).join(' ');
    w = w.slice(0, w.length / 2);
  }
  let nome = w.join(' ');
  if (!nome) return null;
  // Comuni; se non c'è, frazioni e località ("Marlia" di Capannori)
  const cerca = async (layer: string[]) => (await photon({ q: citta, layer, limit: '8', lang: 'default' }, fetchFn))
    .filter(f => f.properties?.countrycode === 'IT' && parole(f.properties.name).join(' ') === nome);
  let trovati = await cerca(['city']);
  if (!trovati.length) trovati = await cerca(['district', 'locality']);
  // Nome non riconosciuto ("Imponzo di Tolmezzo"): il comune del CAP
  if (!trovati.length && /^\d{5}$/.test(cap)) {
    const delCap = (await photon({ q: cap, limit: '5', lang: 'default' }, fetchFn))
      .find(f => f.properties?.countrycode === 'IT' && f.properties?.osm_value === 'postcode' && f.properties?.city);
    if (delCap) {
      citta = delCap.properties.city;
      nome = parole(citta).join(' ');
      trovati = await cerca(['city']);
    }
  }
  if (!trovati.length) return null;
  // Più comuni con lo stesso nome: quello col CAP giusto, altrimenti il più grande
  const conCap = trovati.find(f => cap && String(f.properties.postcode || '').split(/[;,\s]+/).includes(cap));
  const ampiezza = (f: Row) => f.properties.extent ? Math.abs((f.properties.extent[2] - f.properties.extent[0]) * (f.properties.extent[1] - f.properties.extent[3])) : 0;
  const f = conCap || trovati.sort((a, b) => ampiezza(b) - ampiezza(a))[0];
  const [lon, lat] = f.geometry.coordinates;
  const e = f.properties.extent;
  // Un po' di margine: le vie al confine e le frazioni senza confini propri
  return e ? [e[0] - 0.01, e[1] + 0.01, e[2] + 0.01, e[3] - 0.01] : [lon - 0.04, lat + 0.03, lon + 0.04, lat - 0.03];
}

// Via simile che si può correggere senza una persona (scelta utente 2026-11-11, dopo le prove col clic).
// Solo errori di battitura: c'è il civico, i numeri del nome sono gli stessi ("XXVI Aprile" ≠ "XXV Aprile"),
// le parole sono le stesse a parte "di/del…" e al massimo una scritta male ("valter" → "walter"): 1 lettera, 2 sui nomi lunghi.
const LEGAME = new Set(['di', 'd', 'de', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'e']);
export function sicuraDaSola(scritto: string, mappa: string, riga1: string): boolean {
  if (!/\d/.test(riga1)) return false;   // senza civico la riga è da sistemare comunque col cliente
  const a = scritto.split(' ').filter(w => w && !LEGAME.has(w));
  const b = mappa.split(' ').filter(w => w && !LEGAME.has(w));
  const cifre = (w: string[]) => w.filter(x => /^\d+$/.test(x)).join(' ');
  if (!a.length || cifre(a) !== cifre(b)) return false;
  // Il nome sulle mappe può avere il nome di battesimo in più davanti ("tobagi" = "walter tobagi"): si confronta la coda
  const coda = b.slice(Math.max(0, b.length - a.length));
  if (coda.length !== a.length) return false;
  const diverse = a.map((w, i) => [w, coda[i]]).filter(([x, y]) => x !== y);
  if (diverse.length > 1) return false;
  if (!diverse.length) return true;
  const [x, y] = diverse[0];
  // Parole corte: una lettera sola e almeno 5 lettere ("roma" ≠ "rosa"); due lettere solo sui nomi lunghi ("marconi" ≠ "mancini")
  const d = distanza(x, y), corta = Math.min(x.length, y.length);
  return !/\d/.test(x + y) && ((d === 1 && corta >= 5) || (d === 2 && corta >= 8));
}

export async function verificaIndirizzo(a: { address1?: string | null; address2?: string | null; citta?: string | null; cap?: string | null; paese?: string | null },
  fetchFn: typeof fetch = fetch): Promise<EsitoIndirizzo> {
  if (a.paese && a.paese !== 'IT') return { esito: 'non_verificabile', nota: 'Indirizzo estero' };
  const riga1 = String(a.address1 || '').trim();
  if (!riga1 || !String(a.citta || '').trim()) return { esito: 'non_verificabile', nota: 'Via o città mancanti' };
  try {
    const box = await zona(String(a.citta), String(a.cap || '').trim(), fetchFn);
    if (!box) return { esito: 'non_verificabile', nota: `Comune "${a.citta}" non trovato sulle mappe` };

    // Parti da confrontare: la riga 1 divisa alle virgole, poi la riga 2 (a volte la via è lì)
    const parti = [...riga1.split(','), ...String(a.address2 || '').split(',')].map(p => p.trim()).filter(p => /[a-z]{3}/i.test(p));
    const cercate = parti.map(p => ({ testo: p, ...nomeVia(p) })).filter(p => p.nome.replace(/[\d\s]/g, '').length >= 2);
    if (!cercate.length) return { esito: 'non_verificabile', nota: 'Nella via non c\'è un nome da cercare' };

    let migliore: { simile: number; nome: string; sicura: boolean } | null = null;
    for (const [i, p] of cercate.slice(0, 2).entries()) {
      // Com'è scritta; se non si trova e la prima parola è corta e sconosciuta ("vua fillungo"), anche senza
      const testo = testoDaCercare(p.testo);
      const varianti = [testo];
      const prima = testo.split(/\s+/)[0];
      if (!p.tipo && prima.length <= 4 && testo.split(/\s+/).length > 1 && !/\d/.test(prima)) varianti.push(testo.slice(prima.length).trim());
      for (const [k, q] of varianti.entries()) {
        const nomeCercato = k === 0 ? p.nome : nomeVia(q).nome;
        const vie = await photon({ q, layer: ['street', 'locality'], bbox: box.join(','), limit: '15', lang: 'default' }, fetchFn);
        // Anche le località ("Località Micchio"); un tratto di via può avere più nomi ("Via A; Via B")
        const nomi = [...new Set(vie.flatMap(f => String(f.properties?.name || '').split(';').map((n: string) => n.trim()).filter(Boolean)))];
        const uguali = nomi.filter(n => stessoNome(nomeCercato, nomeVia(n).nome));
        if (uguali.length && k === 0) {
          if (p.tipo) {
            const stessoTipo = uguali.find(n => nomeVia(n).tipo === p.tipo) || uguali[0];
            return { esito: 'ok', nota: `Trovata: ${stessoTipo}`, trovata: stessoTipo };
          }
          const tipi = [...new Set(uguali.map(n => nomeVia(n).tipo).filter(Boolean))] as string[];
          if (tipi.length > 1) return { esito: 'ambigua', nota: `Manca il tipo: in zona ci sono ${uguali.join(' e ')}`, suggerimento: uguali.join(' / ') };
          // Si corregge da soli solo se il nome è identico, è la riga 1 e la via è all'inizio della riga
          const identica = uguali.find(n => nomeVia(n).nome === p.nome);
          if (tipi.length === 1 && identica && i === 0 && riga1.startsWith(p.testo) && parti[0] === p.testo) {
            return { esito: 'corretta', nota: `Mancava "${scriviTipo(tipi[0])}": la via è ${identica}`, nuova: `${scriviTipo(tipi[0])} ${riga1}`, trovata: identica };
          }
          return { esito: 'ok', nota: `Trovata: ${uguali[0]}`, trovata: uguali[0] };
        }
        // Trovata solo togliendo una parola: è un errore di battitura, la sceglie una persona
        // Sicura da sola solo se la parola tolta è un "via" scritto male ("vua fillungo") e la via è all'inizio della riga 1
        const allInizio = i === 0 && parti[0] === p.testo && riga1.startsWith(p.testo);
        if (uguali.length) {
          migliore = { simile: 0.99, nome: uguali[0], sicura: allInizio && distanza(prima.toLowerCase(), 'via') <= 1 && /\d/.test(riga1) };
          break;
        }
        for (const n of nomi) {
          const s = quantoSimile(nomeCercato, nomeVia(n).nome);
          if (s >= 0.8 && (!migliore || s > migliore.simile)) {
            migliore = { simile: s, nome: n, sicura: allInizio && !!p.tipo && sicuraDaSola(nomeCercato, nomeVia(n).nome, riga1) };
          }
        }
        if (migliore) break;
      }
      if (migliore) break;
    }
    // Località, frazioni, contrade: spesso non sono sulle mappe, non è un errore
    if (!migliore && cercate.some(p => p.tipo && RURALI.has(p.tipo))) return { esito: 'non_verificabile', nota: 'Località non presente sulle mappe' };
    if (migliore) {
      const nuova = migliore.sicura ? rigaConVia(riga1, migliore.nome) : null;
      return { esito: 'simile', nota: `Via non trovata così: forse ${migliore.nome}`, suggerimento: migliore.nome, ...(nuova ? { nuova } : {}) };
    }
    return { esito: 'non_trovata', nota: `Nessuna via simile a "${cercate[0].testo}" a ${a.citta}` };
  } catch (e) {
    return { esito: 'non_verificabile', nota: `Mappe non raggiungibili: ${e instanceof Error ? e.message : e}` };
  }
}
