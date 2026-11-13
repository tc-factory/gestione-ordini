// T&C Factory — Dati che mancano a un ordine per essere spedito, e la mail che li chiede al cliente.
// Stesse regole di ordProblemi e ordineRichiediDati in js/controllo.js: se ne cambi una, cambia anche l'altra.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const SHOP_DA_EVADERE = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED'];
export const MANCA_INDIRIZZO = 'Manca l\'indirizzo';

// Numero italiano che non può esistere: cellulare 3 + 8/9 cifre, fisso 0 + 5/10 cifre, tutte cifre uguali.
// I numeri esteri (+ e prefisso diverso da 39) non si controllano
export function telefonoNonValido(tel: string, paese?: string | null) {
  const raw = String(tel || '').trim();
  const c = raw.replace(/\D/g, '');
  if (c.length < 8) return false;
  let naz = c;
  if (/^(\+|00)/.test(raw)) {
    const n = raw.startsWith('00') ? c.slice(2) : c;
    if (n.startsWith('39')) naz = n.slice(2);
    else if (/^3\d{9}$/.test(n)) naz = n;          // "+3471234567": il + scritto per sbaglio
    else return false;
  } else if (paese && paese !== 'IT') return false;
  else if (c.length >= 11 && c.startsWith('39')) naz = c.slice(2);
  if (/^(\d)\1+$/.test(naz)) return true;
  return !(/^3\d{8,9}$/.test(naz) || /^0\d{5,10}$/.test(naz));
}

// ── Mail con il dominio scritto male: "iclou.com", "hotmaili.it", "gmail.con" ──
// Stesse regole di ordMailCorretta in js/controllo.js. Si corregge solo verso un dominio noto e solo se ce n'è uno:
//   • finale storpiato di .com/.it (hotmail.con → hotmail.com), se quel dominio è nell'elenco
//   • nome giusto e finale sbagliato (gmail.it → gmail.com), se quel nome ha un dominio solo nell'elenco
//   • nome sbagliato di una lettera o due invertite (due per i nomi lunghi) e finale uguale (gmial.com → gmail.com)
export const DOMINI_MAIL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.fr', 'hotmail.es', 'hotmail.de', 'hotmail.co.uk',
  'outlook.com', 'outlook.it', 'outlook.fr', 'outlook.es', 'live.com', 'live.it', 'live.fr', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'yahoo.it', 'yahoo.fr', 'yahoo.es', 'yahoo.de', 'yahoo.co.uk', 'libero.it', 'alice.it', 'virgilio.it', 'tiscali.it', 'tin.it',
  'email.it', 'fastwebnet.it', 'inwind.it', 'katamail.com', 'teletu.it', 'poste.it', 'iol.it', 'jumpy.it', 'pec.it', 'legalmail.it', 'postecert.it',
  'aruba.it', 'gmx.de', 'gmx.com', 'gmx.it', 'web.de', 't-online.de', 'orange.fr', 'free.fr', 'wanadoo.fr', 'aol.com', 'protonmail.com',
  'proton.me', 'bluewin.ch', 'hispeed.ch', 'sunrise.ch'];

// Lettere diverse, mancanti, in più o scambiate di posto ("gmial" = "gmail" a distanza 1)
function distanzaTesto(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i ? (j ? 0 : i) : j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
const FINE_COM = ['con', 'cmo', 'ocm', 'co', 'comm', 'vom', 'xom', 'cim', 'cpm', 'om', 'cm'];
const FINE_IT = ['itt', 'ti', 'ir', 'iy', 'ot', 'i', 'tt'];

export function mailCorretta(email: string | null | undefined): string | null {
  const e = String(email || '').trim().toLowerCase();
  const pezzi = e.split('@');
  if (pezzi.length !== 2 || !pezzi[0] || !pezzi[1].includes('.')) return null;
  const [utente, d] = pezzi;
  if (DOMINI_MAIL.includes(d) || d.length < 7) return null;
  const i = d.indexOf('.');
  const nome = d.slice(0, i), fine = d.slice(i + 1);
  if (FINE_COM.includes(fine) && DOMINI_MAIL.includes(`${nome}.com`)) return `${utente}@${nome}.com`;
  if (FINE_IT.includes(fine) && DOMINI_MAIL.includes(`${nome}.it`)) return `${utente}@${nome}.it`;
  const conNome = DOMINI_MAIL.filter(x => x.slice(0, x.indexOf('.')) === nome);
  if (conNome.length === 1 && distanzaTesto(fine, conNome[0].slice(conNome[0].indexOf('.') + 1)) <= 3) return `${utente}@${conNome[0]}`;
  // Il nome è già quello di un servizio noto: non lo si scambia con un altro (gmail.it non è email.it)
  if (conNome.length) return null;
  const vicini = DOMINI_MAIL.filter(x => {
    const xn = x.slice(0, x.indexOf('.'));
    if (x.slice(x.indexOf('.') + 1) !== fine || xn.length < 4) return false;
    const k = distanzaTesto(nome, xn);
    return k > 0 && k <= (xn.length >= 7 ? 2 : 1);
  });
  return vicini.length === 1 ? `${utente}@${vicini[0]}` : null;
}

// Ritiro in sede o in gara: il cliente il pacco lo prende di persona, indirizzo e telefono non servono
export const conRitiro = (o: Row) => /ritiro\s+in\s+(sede|gara)/i.test(String(o?.spedizione || ''));

// [campo, testo]: campo 'tel' o 'ind'
export function problemiOrdine(o: Row, telefonoNoto = false): [string, string][] {
  const out: [string, string][] = [];
  if (conRitiro(o)) return out;
  const a = o.indirizzo;
  const cifre = String(o.telefono || '').replace(/\D/g, '');
  if (!telefonoNoto) {
    if (!cifre) out.push(['tel', 'Manca il telefono']);
    else if (cifre.length < 8) out.push(['tel', 'Telefono incompleto']);
    else if (telefonoNonValido(o.telefono, a?.paese)) out.push(['tel', 'Telefono non valido']);
  }
  if (!a || !String(a.via || '').trim()) { out.push(['ind', MANCA_INDIRIZZO]); return out; }
  const via = String(a.via);
  // Il civico è un numero nella via; "snc" (senza numero civico) va bene
  if (!/\d/.test(via) && !/\bs\.?\s?n\.?\s?c\.?(\b|$)/i.test(via)) out.push(['ind', 'Manca il numero civico']);
  const italia = !a.paese || a.paese === 'IT';
  const cap = String(a.cap || '').trim();
  if (!cap) out.push(['ind', 'Manca il CAP']);
  else if (italia && !/^\d{5}$/.test(cap)) out.push(['ind', 'CAP non valido']);
  if (!String(a.citta || '').trim()) out.push(['ind', 'Manca la città']);
  if (italia && !String(a.provincia || '').trim()) out.push(['ind', 'Manca la provincia']);
  return out;
}

const indirizzoTesto = (a: Row) => !a?.via ? '' : `${a.via}, ${[a.cap, a.citta].filter(Boolean).join(' ')}${a.provincia ? ` (${a.provincia})` : ''}${a.paese && a.paese !== 'IT' ? `, ${a.paese}` : ''}`;

const MANCA: Record<string, string> = { 'Manca il numero civico': 'il numero civico', 'Manca il CAP': 'il CAP', 'CAP non valido': 'il CAP corretto',
  'Manca la città': 'la città', 'Manca la provincia': 'la provincia' };

// Dubbio sulla via dal riscontro sulle mappe (ordini_verifiche): va nella mail insieme ai dati che mancano
export function dubbioVia(v?: Row | null): string | null {
  if (!v) return null;
  if (v.esito === 'simile' && v.suggerimento) return `la via non la troviamo sulle mappe: intendevi ${v.suggerimento}?`;
  if (v.esito === 'ambigua' && v.suggerimento) return `non è chiaro se è ${String(v.suggerimento).split(' / ').join(' o ')}`;
  if (v.esito === 'non_trovata') return 'la via non la troviamo sulle mappe: puoi controllarla?';
  return null;
}

// Oggetto e testo, senza firma (la aggiunge chi invia). Corta: un punto per ogni cosa da sistemare
export function testoRichiesta(o: Row, probs: [string, string][], verifica?: Row | null) {
  const tel = probs.find(p => p[0] === 'tel')?.[1];
  const ind = probs.filter(p => p[0] === 'ind').map(p => p[1]);
  const senza = ind.includes(MANCA_INDIRIZZO);
  const dubbio = senza ? null : dubbioVia(verifica);
  const nome = String(o.indirizzo?.nome || o.cliente || '').trim().split(/\s+/)[0];
  const elenco = (v: string[]) => v.length > 1 ? `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}` : v[0];
  const punti: string[] = [];
  if (senza) punti.push('nell\'ordine non è arrivato l\'indirizzo di spedizione');
  else if (ind.length) punti.push(`nell'indirizzo manca ${elenco(ind.map(t => MANCA[t] || t.toLowerCase()))}`);
  if (dubbio) punti.push(dubbio);
  if (tel === 'Manca il telefono') punti.push('ci serve un numero di telefono per il corriere');
  else if (tel) punti.push(`il numero di telefono (${o.telefono}) ${tel === 'Telefono incompleto' ? 'è incompleto' : 'non sembra valido'}`);
  const chiedi = [senza ? 'via, numero civico, CAP e città' : ind.length ? 'l\'indirizzo completo' : dubbio ? 'l\'indirizzo giusto' : '',
    tel ? 'un numero di telefono' : ''].filter(Boolean);
  const righe = [`${nome ? `Ciao ${nome}` : 'Ciao'},`, '',
    punti.length > 1 ? `per spedire l'ordine ${o.numero} ci serve un aiuto:\n${punti.map(p => `- ${p}`).join('\n')}` : `per spedire l'ordine ${o.numero} ci serve un aiuto: ${punti[0]}.`];
  if (!senza && (ind.length || dubbio)) righe.push('', `Indirizzo che ci hai lasciato: ${indirizzoTesto(o.indirizzo)}`);
  righe.push('', `Ci scrivi ${elenco(chiedi)}? Appena ci rispondi spediamo. Grazie!`);
  return { oggetto: `Ordine ${o.numero}: ci servono dei dati per spedirlo`, corpo: righe.join('\n') };
}
