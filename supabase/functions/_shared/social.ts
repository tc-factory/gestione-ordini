// T&C Factory — Messaggi Facebook (Messenger) e Instagram: salvataggio comune a meta-webhook,
// social-sync e social-invia. Una conversazione per account del negozio + cliente.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const GRAPH = 'https://graph.facebook.com/v24.0';

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export type Messaggio = {
  mid: string | null;
  direzione: 'in' | 'out';
  testo: string;
  allegati?: unknown[];
  at: string;                 // ISO
  inviato_da?: string | null;
  errore?: string | null;
};

export async function graph(path: string, params: Record<string, string>, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta ha risposto ${res.status}`);
  return json;
}

// Token dell'account (Pagina o profilo Instagram): solo service role
export async function tokenAccount(db: SupabaseClient, accountId: string) {
  const { data } = await db.from('social_token').select('token').eq('account', accountId).maybeSingle();
  return data?.token as string | undefined;
}

// Conversazione del cliente (la crea se manca) e messaggio; aggiorna l'anteprima se è il più recente.
// Ritorna true se il messaggio è nuovo.
export async function salvaMessaggio(db: SupabaseClient, account: string, utenteId: string, m: Messaggio,
  extra: { nome?: string | null; thread?: string | null } = {}) {
  const { data: conv, error } = await db.from('social_conversazioni')
    .upsert({ account, utente_id: utenteId, ...(extra.thread ? { thread_id: extra.thread } : {}), ...(extra.nome ? { utente_nome: extra.nome } : {}) },
      { onConflict: 'account,utente_id' })
    .select('id, ultimo_at').single();
  if (error) throw error;

  if (m.mid) {
    const { data: esiste } = await db.from('social_messaggi').select('id').eq('mid', m.mid).maybeSingle();
    if (esiste) return false;
  }
  const { error: e2 } = await db.from('social_messaggi').insert({
    conversazione: conv.id, mid: m.mid, direzione: m.direzione, testo: m.testo || '', allegati: m.allegati || [],
    at: m.at, inviato_da: m.inviato_da || null, errore: m.errore || null,
  });
  if (e2) { if (String(e2.code) === '23505') return false; throw e2; }

  if (!conv.ultimo_at || new Date(m.at) >= new Date(conv.ultimo_at)) {
    const anteprima = m.testo || ((m.allegati || []).length ? '📎 Allegato' : '');
    await db.from('social_conversazioni').update({
      ultimo_at: m.at, ultimo_testo: anteprima.slice(0, 300), ultimo_da: m.direzione === 'in' ? 'cliente' : 'noi',
      da_leggere: m.direzione === 'in',
    }).eq('id', conv.id);
  }
  return true;
}

// Messaggi d'errore di Meta resi comprensibili
export function erroreLeggibile(msg: string) {
  if (/disabled access to Instagram Direct|disabilitato l'accesso ai direct/i.test(msg)) {
    return 'Nell\'app Instagram del negozio va attivato: Impostazioni → Messaggi e risposte alle storie → Strumenti connessi → Consenti accesso ai messaggi';
  }
  if (/outside of allowed window|24 ore|24-hour/i.test(msg)) return 'Sono passate più di 24 ore dall\'ultimo messaggio del cliente: Meta non permette di rispondere da qui';
  return msg;
}
