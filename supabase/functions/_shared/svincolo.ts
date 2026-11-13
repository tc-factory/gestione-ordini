// Dopo uno svincolo GLS ripete l'evento "giacenza" ogni giorno finché il deposito non lavora le
// istruzioni: il pacco è di nuovo fermo solo se dopo lo svincolo c'è stato altro (in consegna, tentativo…)
type Evento = { at: string; stato: string; codice?: string };

export function ripartitaDopo(eventi: Evento[] | null, svAt: Date) {
  return (eventi || []).some(e => new Date(e.at) > svAt && (e.codice ? String(e.codice) !== '66' : !/giacenza|storage|istruzioni|instructions/i.test(e.stato)));
}

// Svincolata e GLS non ha ancora fatto niente di nuovo: le istruzioni sono già date, non è più "da svincolare"
export function inAttesaDopoSvincolo(t: { svincolata_at?: string | null; eventi?: Evento[] | null }) {
  return !!t.svincolata_at && !ripartitaDopo(t.eventi || null, new Date(t.svincolata_at));
}
