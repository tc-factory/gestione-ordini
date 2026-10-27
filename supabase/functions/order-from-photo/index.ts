// T&C Factory — Legge un ordine scritto a mano dalle foto
//
// Riceve una o più foto del foglio d'ordine e con Claude ne ricava i campi del form ordine:
// cliente, data ordine, deadline, urgente, descrizione, note e le righe del modulo d'ordine
// (catalogo, codice, descrizione, colore, quantità, taglia, prezzo).
// Clienti e prodotti in anagrafica arrivano dal gestionale per correggere i nomi letti male.
// Chi chiama deve essere collegato e far parte dello staff (app_users).
//
// Segreto richiesto: supabase secrets set ANTHROPIC_API_KEY=... --project-ref <ref>
// Deploy: supabase functions deploy order-from-photo --project-ref <ref> --use-api --no-verify-jwt
// (il token viene verificato qui dentro con auth.getUser)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';

const MAX_IMAGES = 6;
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;   // base64 di una foto
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// ─────────────────────────────────────────────
// Cosa deve restituire Claude
// ─────────────────────────────────────────────

const str = { type: 'string' };
const num = { type: ['number', 'null'] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cliente', 'data_ordine', 'deadline', 'urgente', 'descrizione', 'note', 'righe', 'dubbi'],
  properties: {
    cliente: str,
    data_ordine: str,
    deadline: str,
    urgente: { type: 'boolean' },
    descrizione: str,
    note: str,
    righe: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['catalogo', 'codice', 'descrizione', 'colore', 'qnt', 'tg', 'prezzo'],
        properties: { catalogo: str, codice: str, descrizione: str, colore: str, qnt: num, tg: str, prezzo: num },
      },
    },
    dubbi: str,
  },
};

const SYSTEM = `Leggi ordini scritti a mano per T&C Factory, un laboratorio di abbigliamento personalizzato (stampa, ricamo, DTF).
Dalle foto del foglio d'ordine ricava i dati per il gestionale. Il foglio può essere disordinato, con abbreviazioni, frecce, righe cancellate o aggiunte a margine: leggi come farebbe un collega esperto.

Campi:
- cliente: nome del cliente o dell'azienda. Se corrisponde (anche con errori di scrittura) a un cliente in anagrafica, usa il nome esatto dell'anagrafica.
- data_ordine e deadline: formato AAAA-MM-GG; "" se non scritte. Le date senza anno sono dell'anno in corso, o del prossimo se quella data è già passata da più di due mesi. Deadline è la data di consegna o di scadenza ("per il", "entro", "consegna").
- urgente: true solo se il foglio lo dice (URGENTE, sottolineato, "prima possibile").
- descrizione: in poche parole cosa ordina (es. "Divise staff", "Felpe squadra"); "" se non chiaro.
- note: tutto il resto che serve a chi lavora l'ordine (posizione e colori di stampa o ricamo, loghi, nomi e numeri, indirizzo, acconti, telefono…), in frasi brevi. Non ripetere ciò che è già nelle righe.
- righe: una riga per ogni combinazione di articolo, colore e taglia, con la sua quantità. "10 M, 5 L" sono due righe. Se una riga ha solo il totale senza taglie, mettila con tg "". Se il codice corrisponde a un prodotto in anagrafica, usa codice e catalogo (fornitore) dell'anagrafica. prezzo è il prezzo unitario se scritto, altrimenti null; qnt null se non leggibile. Taglie in maiuscolo (XS, S, M, L, XL, XXL, 3XL…) o come scritte per i bambini (es. "6/8").
- dubbi: in italiano, brevemente, le cose che non sei riuscito a leggere con sicurezza; "" se è tutto chiaro.

Non inventare: se un dato non c'è lascialo vuoto.`;

const listText = (title: string, items: unknown, max: number) => {
  const list = Array.isArray(items) ? items.map(x => String(x ?? '').trim().slice(0, 160)).filter(Boolean).slice(0, max) : [];
  return list.length ? `${title}:\n${list.join('\n')}` : `${title}: nessuno`;
};

// ─────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller?.user) return fail('Accesso richiesto', 401);
  const { data: me } = await admin.from('app_users').select('nickname').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail('Accesso riservato allo staff', 403);

  if (!Deno.env.get('ANTHROPIC_API_KEY')) return fail('Lettura foto non configurata: manca la chiave ANTHROPIC_API_KEY su Supabase', 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }
  const images = Array.isArray(body.immagini) ? body.immagini as Record<string, unknown>[] : [];
  if (!images.length) return fail('Carica almeno una foto');
  if (images.length > MAX_IMAGES) return fail(`Al massimo ${MAX_IMAGES} foto per volta`);
  for (const img of images) {
    if (!IMAGE_TYPES.includes(String(img.media_type)) || typeof img.data !== 'string' || !img.data || img.data.length > MAX_IMAGE_CHARS) {
      return fail('Foto non valida o troppo grande');
    }
  }
  const oggi = /^\d{4}-\d{2}-\d{2}$/.test(String(body.oggi)) ? String(body.oggi) : new Date().toISOString().slice(0, 10);

  const content: Anthropic.Beta.BetaContentBlockParam[] = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type as 'image/jpeg', data: img.data as string },
  }));
  content.push({
    type: 'text',
    text: [
      `Oggi è ${oggi}.`,
      listText('Clienti in anagrafica', body.clienti, 3000),
      listText('Prodotti in anagrafica (codice · descrizione · fornitore)', body.prodotti, 3000),
      images.length > 1 ? `Le ${images.length} foto sono pagine dello stesso ordine.` : '',
      'Leggi l\'ordine nelle foto.',
    ].filter(Boolean).join('\n\n'),
  });

  try {
    const client = new Anthropic();
    const res = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (res.stop_reason === 'refusal') return fail('Non è stato possibile leggere queste foto', 422);
    if (res.stop_reason === 'max_tokens') return fail('L\'ordine è troppo lungo: prova con meno foto per volta', 422);
    const text = res.content.flatMap(b => b.type === 'text' ? [b.text] : []).join('');
    let ordine;
    try { ordine = JSON.parse(text); } catch { return fail('Risposta non leggibile, riprova', 502); }
    return reply({ success: true, ordine });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return fail('Troppe richieste: riprova tra poco', 429);
    if (e instanceof Anthropic.APIError) {
      console.error('Claude', e.status, e.message);
      return fail('Lettura non riuscita, riprova', 502);
    }
    console.error(e);
    return fail('Lettura non riuscita, riprova', 500);
  }
});
