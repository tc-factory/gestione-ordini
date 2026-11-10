// T&C Factory — Telefoni dei clienti trovati nelle mail, esclusi i nostri
//
// Nelle risposte dei clienti c'è citata la nostra mail, con la firma e i nostri numeri: non vanno
// mai presi per il telefono del cliente. Sono nostri i numeri scritti nelle mail che mandiamo e
// quelli che compaiono nelle parti citate di almeno due clienti diversi (una firma).

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CELLULARE = /(?<![\d])(?:\+39[\s.]?|0039[\s.]?)?(3\d{2}[\s.]?\d{3}[\s.]?\d{3,4})(?!\d)/g;
const FISSO = /(?<![\d])(?:\+39[\s.]?|0039[\s.]?)?(0\d{1,3}[\s.\/]?\d{5,8})(?!\d)/g;
const cifre = (t: string) => t.replace(/\D/g, '');

export function numeriIn(testo: unknown): string[] {
  const t = String(testo || '');
  return [...t.matchAll(CELLULARE), ...t.matchAll(FISSO)].map(m => cifre(m[1]));
}

let cache: { at: number; numeri: Set<string> } | null = null;

export async function numeriNostri(db: SupabaseClient): Promise<Set<string>> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.numeri;
  const [{ data: nostre }, { data: citate }] = await Promise.all([
    db.from('mail_messaggi').select('testo').eq('direzione', 'out').not('testo', 'is', null).order('ricevuto_at', { ascending: false }).limit(200),
    db.from('mail_messaggi').select('da_email, testo_citato').eq('direzione', 'in').neq('testo_citato', '').order('ricevuto_at', { ascending: false }).limit(400),
  ]);
  const numeri = new Set<string>();
  for (const m of nostre || []) numeriIn(m.testo).forEach(n => numeri.add(n));
  const chi = new Map<string, Set<string>>();
  for (const m of citate || []) for (const n of numeriIn(m.testo_citato)) {
    if (!chi.has(n)) chi.set(n, new Set());
    chi.get(n)!.add(String(m.da_email || '').toLowerCase());
  }
  for (const [n, mittenti] of chi) if (mittenti.size >= 2) numeri.add(n);
  cache = { at: Date.now(), numeri };
  return numeri;
}

// Il primo cellulare del cliente nei testi, in ordine, saltando i nostri numeri
export function primoCellulare(testi: unknown[], nostri: Set<string>): string {
  for (const t of testi) for (const m of String(t || '').matchAll(CELLULARE)) {
    const n = cifre(m[1]);
    if (!nostri.has(n)) return n;
  }
  return '';
}
