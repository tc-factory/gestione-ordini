// Prezzi dei modelli Claude in dollari per milione di token: input, output, lettura cache, scrittura cache 5 minuti.
// Claude Haiku 5.5 ha due listini scelti dalla lunghezza del prompt (input + cache letta + cache scritta):
// fino a 100.000 token 0,10 / 0,50; oltre 0,50 / 2,50, e la cache segue (0,1× e 1,25× dell'input).
type Listino = [number, number, number, number];

const PREZZI: Record<string, Listino> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-sonnet-5-5': [2, 10, 0.1, 2.5],
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
};
const OLTRE_100K: Record<string, Listino> = {
  'claude-haiku-5-5': [0.5, 2.5, 0.05, 0.625],
};
const SOGLIA = 100_000;

// Modelli di cui si conosce il prezzo
export const haPrezzo = (modello: string) => modello in PREZZI;

// Token e costo di una chiamata (usage della risposta). Modello sconosciuto: prezzi di `predefinito`.
// deno-lint-ignore no-explicit-any
export function consumoChiamata(modello: string, u: any, predefinito = 'claude-opus-5-5') {
  const input = u?.input_tokens || 0, output = u?.output_tokens || 0;
  const letti = u?.cache_read_input_tokens || 0, scritti = u?.cache_creation_input_tokens || 0;
  const nome = PREZZI[modello] ? modello : predefinito;
  const p = (input + letti + scritti > SOGLIA && OLTRE_100K[nome]) || PREZZI[nome];
  return { modello, input, output, cache_letti: letti, cache_scritti: scritti,
    costo_usd: Number(((input * p[0] + output * p[1] + letti * p[2] + scritti * p[3]) / 1e6).toFixed(5)) };
}
