// Testo per la telefonata al cliente di un pacco fermo: cosa dire, cosa chiedere, alternative.
// Costruito dai dati veri (eventi GLS, svincoli, indirizzo, sede): niente da inventare al telefono.
// Richiesta utente 2026-11-13. Tono del negozio (tu), mai il nome T&C Factory.

type Evento = { at: string; stato: string; codice?: string; nota?: string; luogo?: string };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Consegne non riuscite secondo GLS (giacenza e indirizzo errato compresi)
const FALLITA = ['1', '3', '7', '8', '66', '68', '77'];

const giorno = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'numeric' });
const gg = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit' });
const minuscola = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);
const maiuscola = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const elenco = (xs: string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
const telefonoLeggibile = (t: string) => {
  const d = String(t || '').replace(/\D/g, '').replace(/^39(?=3\d{8,9}$)/, '');
  return /^3\d{8,9}$/.test(d) ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}` : String(t || '');
};

// Causa del problema, dalla nota GLS (la più recente) o dal tipo di evento
function causa(falliti: Evento[]) {
  const nota = falliti.map(e => e.nota || '').find(n => /[a-z]{3}/i.test(n) && !/^\d/.test(n)) || '';
  const codici = new Set(falliti.map(e => String(e.codice)));
  if (/nominativo|scon|citofono/i.test(nota)) return {
    gls: nota,
    detto: 'non ha trovato il tuo nome sul citofono o sulla cassetta delle lettere',
    domande: ['Che nome c\'è sul citofono? E sulla cassetta delle lettere?', 'Il pacco va consegnato a un altro nome (familiare, coinquilino, ditta)? Dimmi quale, lo segnaliamo a GLS.'],
  };
  if (/civico/i.test(nota)) return {
    gls: nota,
    detto: 'non ha trovato il numero civico',
    domande: ['Mi confermi il numero civico?', 'Ci sono anche scala, interno, palazzina o una frazione da indicare?'],
  };
  if (/tel/i.test(nota)) return {
    gls: nota,
    detto: 'ha provato a chiamarti ma il numero non era raggiungibile',
    domande: ['Qual è il numero giusto a cui il corriere può chiamarti?'],
  };
  if (codici.has('68') || codici.has('3')) return {
    gls: nota || 'indirizzo errato',
    detto: 'ha trovato l\'indirizzo sbagliato o incompleto',
    domande: ['Mi confermi l\'indirizzo completo, con civico, interno e frazione se c\'è?', 'Che nome c\'è sul citofono?'],
  };
  if (codici.has('8')) return {
    gls: 'destinatario chiuso',
    detto: 'ha trovato chiuso',
    domande: ['In che giorni e a che ora c\'è qualcuno per ricevere il pacco?'],
  };
  if (codici.has('1') || codici.has('7') || codici.has('77')) return {
    gls: nota || 'destinatario assente',
    detto: 'non ha trovato nessuno',
    domande: ['In che giorni e a che ora c\'è qualcuno per ricevere il pacco?'],
  };
  return { gls: nota || 'non indicata', detto: 'non è riuscito a consegnarlo', domande: [] as string[] };
}

export type DatiTelefonata = {
  negozio: string;
  ordine: string;
  cliente?: string | null;
  telefono?: string | null;
  indirizzo?: Row | null;          // via, cap, citta, provincia (ordine Shopify)
  eventi?: Evento[] | null;        // GLS, in qualsiasi ordine
  svincoli?: { at: string; tipo: string }[];
  deposito?: Row | null;           // sede, indirizzo, cap, provincia, telefono, coincide
  motivo: 'dopo_svincolo' | 'senza_risposta' | 'senza_email' | 'altro';
  ultima_mail_at?: string | null;
};

export function testoTelefonata(d: DatiTelefonata) {
  const eventi = [...(d.eventi || [])].sort((a, b) => a.at.localeCompare(b.at));
  const falliti = eventi.filter(e => FALLITA.includes(String(e.codice)));
  // Tentativi veri: GLS ripete "giacenza" ogni giorno anche se il corriere non passa, quindi una
  // giacenza conta solo se arriva subito dopo un evento normale (es. "in consegna")
  const veri = falliti.filter(e => {
    if (String(e.codice) !== '66') return true;
    const prima = eventi[eventi.indexOf(e) - 1];
    return !prima || !FALLITA.includes(String(prima.codice));
  });
  // Un tentativo per giorno, con la sua causa (note GLS di quel giorno, la più recente)
  const giorniGiacenza = [...new Set(veri.map(e => e.at.slice(0, 10)))];
  const perGiorno = giorniGiacenza.map(g => ({ g, c: causa(falliti.filter(e => e.at.slice(0, 10) === g).reverse()) }));
  // Tentativi di fila con la stessa causa si dicono insieme
  const gruppi: { giorni: string[]; c: ReturnType<typeof causa> }[] = [];
  for (const x of perGiorno) {
    const ult = gruppi[gruppi.length - 1];
    if (ult && ult.c.detto === x.c.detto) ult.giorni.push(x.g); else gruppi.push({ giorni: [x.g], c: x.c });
  }
  const c = gruppi.length ? gruppi[gruppi.length - 1].c : causa([...falliti].reverse());
  // Domande: prima quelle della causa più recente, poi le altre senza ripetere
  const domande = [...new Set([...gruppi].reverse().flatMap(x => x.c.domande))];
  const conGiorno = (g: string) => giorno(g + 'T12:00:00Z');
  const nome = String(d.cliente || '').trim().split(/\s+/)[0] || '';
  const ind = d.indirizzo || {};
  const indirizzo = [ind.via, [ind.cap, ind.citta].filter(Boolean).join(' ') + (ind.provincia ? ` (${ind.provincia})` : '')].filter(x => x && x.trim()).join(', ');
  const tel = telefonoLeggibile(d.telefono || '');
  // Svincoli seguiti da un nuovo fermo, e quelli dati dopo l'ultimo fermo (GLS non ci ha ancora lavorato)
  const ultimoFermo = veri.length ? new Date(veri[veri.length - 1].at) : null;
  const tutti = d.svincoli || [];
  const svincoli = ultimoFermo ? tutti.filter(v => new Date(v.at) < ultimoFermo) : tutti;
  const inAttesa = ultimoFermo ? tutti.filter(v => new Date(v.at) >= ultimoFermo) : [];
  const ultimoSv = svincoli[svincoli.length - 1];
  const dopoSv = ultimoSv ? veri.filter(e => new Date(e.at) > new Date(ultimoSv.at)) : [];
  const dep = d.deposito;

  const r: string[] = [];
  r.push('PRIMA DI CHIAMARE');
  r.push(`Ordine ${d.ordine}${d.cliente ? ` · ${d.cliente}` : ''}${tel ? ` · ${tel}` : ' · telefono non presente'}`);
  if (indirizzo) r.push(`Indirizzo nell'ordine: ${indirizzo}`);
  for (const x of perGiorno) r.push(`Consegna non riuscita ${gg(x.g + 'T12:00:00Z')} · GLS: ${x.c.gls.toLowerCase()}`);
  if (svincoli.length) r.push(`Istruzioni già date a GLS: ${svincoli.map(v => `${gg(v.at)} ${minuscola(v.tipo)}`).join('; ')}`);
  if (inAttesa.length) r.push(`Istruzioni date di nuovo il ${inAttesa.map(v => `${gg(v.at)} (${minuscola(v.tipo)})`).join(', ')}: GLS non ha ancora rimesso in consegna il pacco. Controlla sul portale GLS cosa risulta prima di chiamare.`);
  r.push('');

  r.push('COSA DIRE');
  r.push(`«Ciao${nome ? `, parlo con ${nome}` : ''}? Ti chiamo da ${d.negozio} per il tuo ordine ${d.ordine}.»`);
  if (gruppi.length) {
    const parti = gruppi.map(x => `${elenco(x.giorni.map(conGiorno))} ${x.c.detto}`);
    r.push(`«Il corriere GLS ha provato a consegnarlo ${giorniGiacenza.length === 1 ? 'una volta' : `${giorniGiacenza.length} volte`}, ma non ci è riuscito: ${parti.join('; ')}. Ora il pacco è fermo nel loro deposito.»`);
  } else {
    r.push(`«Il corriere GLS non è riuscito a consegnarlo (${c.gls.toLowerCase()}). Ora il pacco è fermo nel loro deposito.»`);
  }
  if (d.motivo === 'dopo_svincolo' && ultimoSv) {
    r.push(`«${svincoli.length > 1 ? `Abbiamo già dato a GLS nuove istruzioni ${svincoli.length} volte` : `${maiuscola(giorno(ultimoSv.at))} avevamo dato a GLS nuove istruzioni (${ultimoSminuscola(v.tipo)})`}, ma il pacco si è fermato di nuovo${dopoSv.length ? ` ${giorno(dopoSv[dopoSv.length - 1].at)}` : ''}. Prima di riprovare vorrei capire con te cosa non va, così la prossima volta arriva.»`);
  } else if (d.motivo === 'senza_risposta' && d.ultima_mail_at) {
    r.push(`«Ti abbiamo scritto una mail il ${giorno(d.ultima_mail_at)} ma non ci è arrivata risposta, per questo ti chiamo: GLS tiene il pacco solo pochi giorni.»`);
  }
  r.push('');

  r.push('COSA CHIEDERE');
  if (indirizzo) r.push(`• «L'indirizzo che abbiamo è ${indirizzo}. È giusto?»`);
  for (const q of domande) r.push(`• «${q}»`);
  r.push(tel ? `• «Il ${tel} è il numero giusto per il corriere?»` : '• «A che numero può chiamarti il corriere?»');
  if (d.motivo === 'dopo_svincolo') r.push('• «Di giorno c\'è qualcuno in casa? Se no, preferisci farlo consegnare dove c\'è sempre qualcuno (lavoro, un parente, un vicino)?»');
  r.push('');

  if (dep?.sede) {
    const di = [dep.indirizzo, [dep.cap, dep.sede].filter(Boolean).join(' ') + (dep.provincia ? ` (${dep.provincia})` : '')].filter(Boolean).join(', ');
    r.push('SE PREFERISCE RITIRARLO');
    r.push(`«Puoi ritirarlo tu alla sede GLS di ${dep.sede}${di ? `, ${di}` : ''}${dep.telefono ? `, telefono ${dep.telefono}` : ''}. Ti consiglio di chiamarli prima per orari e conferma.»`);
    if (dep.coincide === false) r.push(`(Attenzione: gli eventi sono a ${dep.luogo_eventi}, il pacco potrebbe essere in un punto GLS più vicino: verifica con GLS prima di dare l'indirizzo.)`);
    r.push('');
  }

  r.push('PER CHIUDERE');
  r.push('«Perfetto, do subito le istruzioni a GLS e ti mando una mail di conferma. Grazie e scusa per il disagio.»');
  r.push('');
  r.push('DOPO LA TELEFONATA');
  r.push('Dai le istruzioni dal portale GLS con quello che ti ha detto (nome sul citofono, civico, orari nelle note), premi «Già svincolata su GLS» e scrivi l\'esito nelle note del task.');
  return r.join('\n');
}
