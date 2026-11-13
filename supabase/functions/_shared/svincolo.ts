// Svincoli GLS: regole comuni a tracking-check e cervello.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type Evento = { at: string; stato: string; codice?: string; nota?: string; luogo?: string };

// Dopo uno svincolo GLS ripete l'evento "giacenza" ogni giorno finché il deposito non lavora le
// istruzioni: il pacco è di nuovo fermo solo se dopo lo svincolo c'è stato altro (in consegna, tentativo…)
export function ripartitaDopo(eventi: Evento[] | null, svAt: Date) {
  return (eventi || []).some(e => new Date(e.at) > svAt && (e.codice ? String(e.codice) !== '66' : !/giacenza|storage|istruzioni|instructions/i.test(e.stato)));
}

// Svincolata e GLS non ha ancora fatto niente di nuovo: le istruzioni sono già date, non è più "da svincolare"
export function inAttesaDopoSvincolo(t: { svincolata_at?: string | null; eventi?: Evento[] | null }) {
  return !!t.svincolata_at && !ripartitaDopo(t.eventi || null, new Date(t.svincolata_at));
}

// Svincoli mandati a GLS per una spedizione (dal gestionale o segnati "dal portale"), dal più vecchio
export async function svincoliFatti(db: SupabaseClient, tracking: string) {
  const { data } = await db.from('automazione_esecuzioni').select('fine, riepilogo')
    .eq('nome', 'svincolo-gls').eq('stato', 'ok').eq('riepilogo->>tracking', tracking).order('fine');
  return (data || []).map(r => ({ at: r.fine as string, tipo: String(r.riepilogo?.tipo || 'Svincolo'), da: r.riepilogo?.da || null }));
}

const quando = (iso: string) => new Date(iso).toLocaleString('it-IT', {
  timeZone: 'Europe/Rome', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});

// GLS: da quando il pacco arriva nella sede di destinazione; prima è solo viaggio
const IN_SEDE = ['904', '905', '25'];

export type RigaStorico = { at: string; quando: string; tipo: 'gls' | 'problema' | 'svincolo' | 'mail_out' | 'mail_in'; testo: string };

// Storico preciso di una giacenza: eventi GLS dalla sede di destinazione, svincoli, mail col cliente.
// Dal più vecchio al più recente, per chi deve chiamare il cliente e ricostruire cosa è successo.
export async function storicoGiacenza(db: SupabaseClient, s: { numero: string; eventi?: Evento[] | null; email?: string | null }) {
  const eventi = [...(s.eventi || [])].sort((a, b) => a.at.localeCompare(b.at));
  const da = eventi.findIndex(e => IN_SEDE.includes(String(e.codice)));
  const svincoli = await svincoliFatti(db, s.numero);
  const righe: RigaStorico[] = [];
  for (const e of da >= 0 ? eventi.slice(da) : eventi) {
    const problema = ['1', '7', '8', '66', '68'].includes(String(e.codice));
    righe.push({ at: e.at, quando: quando(e.at), tipo: problema ? 'problema' : 'gls', testo: `GLS: ${e.stato}${e.nota ? ` (${e.nota})` : ''}` });
  }
  for (const v of svincoli) righe.push({ at: v.at, quando: quando(v.at), tipo: 'svincolo', testo: `Svincolo mandato: ${v.tipo}${v.da ? ` · ${v.da}` : ''}` });
  const email = String(s.email || '').toLowerCase();
  const dal = eventi[0]?.at;
  if (email && dal) {
    const [{ data: out }, { data: inn }] = await Promise.all([
      db.from('mail_messaggi').select('ricevuto_at, oggetto').eq('direzione', 'out').ilike('a', email).gte('ricevuto_at', dal),
      db.from('mail_messaggi').select('ricevuto_at, oggetto').eq('direzione', 'in').ilike('da_email', email).gte('ricevuto_at', dal),
    ]);
    for (const m of out || []) righe.push({ at: m.ricevuto_at, quando: quando(m.ricevuto_at), tipo: 'mail_out', testo: `Mail al cliente: ${m.oggetto || '(senza oggetto)'}` });
    for (const m of inn || []) righe.push({ at: m.ricevuto_at, quando: quando(m.ricevuto_at), tipo: 'mail_in', testo: `Mail dal cliente: ${m.oggetto || '(senza oggetto)'}` });
  }
  righe.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { svincoli, righe };
}

// Già svincolata e di nuovo ferma dopo l'ultimo svincolo: un altro svincolo alla cieca non serve,
// bisogna chiamare il cliente e capire cosa non va (regola dell'utente, 2026-11-13)
export function fermaDopoSvincolo(svincoli: { at: string }[], eventi: Evento[] | null) {
  const ultimo = svincoli[svincoli.length - 1];
  return !!ultimo && ripartitaDopo(eventi, new Date(ultimo.at));
}
