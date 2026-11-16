// T&C Factory — Content Studio: il Brand Kit di un brand come contesto per ogni generazione
// (testi con Claude, grafiche e video con i provider). Tabella brand_kits, file nel bucket pubblico brand-kit.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type BrandKit = {
  negozio: string;
  nome: string;
  logo_chiaro: string | null;
  logo_scuro: string | null;
  palette: { nome: string; hex: string }[];
  font: { titoli?: { nome?: string; file?: string }; testi?: { nome?: string; file?: string } };
  tono_voce: string;
  target: string;
  prodotti: string;
  parole_si: string[];
  parole_no: string[];
  esempi: { url?: string; immagine?: string; nota?: string }[];
};

// Indirizzo pubblico di un file del bucket (loghi, font, esempi): serve ai servizi di grafica
export function urlBrandKit(path: string | null | undefined) {
  if (!path) return null;
  return `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/brand-kit/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export async function leggiBrandKit(db: SupabaseClient, negozio: string): Promise<BrandKit | null> {
  const { data, error } = await db.from('brand_kits').select('*').eq('negozio', negozio).maybeSingle();
  if (error) throw error;
  return data as BrandKit | null;
}

// Testo per il prompt di Claude: solo le parti compilate
export function contestoBrandKit(k: BrandKit) {
  const righe = [`BRAND: ${k.nome}`];
  const blocco = (titolo: string, testo?: string | null) => { if (testo?.trim()) righe.push(`\n${titolo}:\n${testo.trim()}`); };
  blocco('TONO DI VOCE', k.tono_voce);
  blocco('TARGET', k.target);
  blocco('PRODOTTI PRINCIPALI', k.prodotti);
  if (k.parole_si?.length) blocco('PAROLE ED ESPRESSIONI DA USARE', k.parole_si.join(', '));
  if (k.parole_no?.length) blocco('DA EVITARE', k.parole_no.join(', '));
  if (k.palette?.length) blocco('PALETTE', k.palette.map(c => `${c.nome}: ${c.hex}`).join(', '));
  const font = [k.font?.titoli?.nome && `titoli ${k.font.titoli.nome}`, k.font?.testi?.nome && `testi ${k.font.testi.nome}`].filter(Boolean);
  if (font.length) blocco('FONT', font.join('; '));
  const esempi = (k.esempi || []).filter(e => e.nota || e.url);
  if (esempi.length) blocco('ESEMPI DI POST RIUSCITI', esempi.map(e => `- ${e.nota || ''}${e.url ? ` (${e.url})` : ''}`).join('\n'));
  return righe.join('\n');
}
