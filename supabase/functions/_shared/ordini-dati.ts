// T&C Factory — Dati che mancano a un ordine per essere spedito, e la mail che li chiede al cliente.
// Stesse regole di ordProblemi e ordineRichiediDati in js/controllo.js: se ne cambi una, cambia anche l'altra.

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const SHOP_DA_EVADERE = ['UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED'];
export const MANCA_INDIRIZZO = 'Manca l\'indirizzo';

// [campo, testo]: campo 'tel' o 'ind'
export function problemiOrdine(o: Row, telefonoNoto = false): [string, string][] {
  const out: [string, string][] = [];
  const a = o.indirizzo;
  const cifre = String(o.telefono || '').replace(/\D/g, '');
  if (!telefonoNoto) {
    if (!cifre) out.push(['tel', 'Manca il telefono']);
    else if (cifre.length < 8) out.push(['tel', 'Telefono incompleto']);
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

// Oggetto e testo, senza firma (la aggiunge chi invia)
export function testoRichiesta(o: Row, probs: [string, string][]) {
  const tel = probs.some(p => p[0] === 'tel');
  const ind = probs.filter(p => p[0] === 'ind').map(p => p[1]);
  const nome = String(o.indirizzo?.nome || o.cliente || '').trim().split(/\s+/)[0];
  const elenco = (v: string[]) => v.length > 1 ? `${v.slice(0, -1).join(', ')} e ${v[v.length - 1]}` : v[0];
  const righe = [`${nome ? `Ciao ${nome}` : 'Ciao'},`, '', `grazie per il tuo ordine ${o.numero}! Lo stiamo preparando, ma prima di spedirlo ci serve un aiuto.`, ''];
  if (ind.includes(MANCA_INDIRIZZO)) righe.push('Nell\'ordine non è arrivato l\'indirizzo di spedizione: ci scrivi via, numero civico, CAP, città e provincia?');
  else if (ind.length) {
    righe.push(`Nell'indirizzo di spedizione che ci hai lasciato manca ${elenco(ind.map(t => MANCA[t] || t.toLowerCase()))}:`, '', indirizzoTesto(o.indirizzo), '',
      'Ci rispondi con l\'indirizzo completo? Così il corriere riesce a consegnare senza intoppi.');
  }
  if (tel) {
    if (ind.length) righe.push('');
    righe.push(`${ind.length ? 'Ci serve anche' : 'Ci serve'} un numero di telefono: il corriere lo usa per avvisarti della consegna e per contattarti se non ti trova.`);
  }
  righe.push('', 'Appena ci rispondi spediamo. Grazie!');
  const cosa = ind.length && tel ? 'ci servono l\'indirizzo completo e il telefono' : ind.length ? 'ci serve l\'indirizzo completo' : 'ci serve il tuo numero di telefono';
  return { oggetto: `Ordine ${o.numero}: ${cosa} per spedire`, corpo: righe.join('\n') };
}
