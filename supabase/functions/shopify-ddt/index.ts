// T&C Factory — Dati del DDT di un ordine Shopify (Centro di controllo › Shopify › DDT)
//
// Il PDF dei DDT lo crea l'automazione del mattino sul Mac mini, che dal web non si raggiunge.
// Questa funzione legge da Shopify lo stesso ordine che usa mattino.py (indirizzi, articoli con
// miniatura e campi personalizzati, dati del negozio) e il gestionale disegna il DDT uguale.
//
// Chi la può chiamare: chi può leggere l'ordine in shopify_orders (il controllo lo fa la RLS).
// Va pubblicata con --no-verify-jwt: il controllo di chi chiama lo fa lei.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { API_VERSION, getToken, type Store } from '../_shared/shopify.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

// Stessa query di automazioni/shopify-mattino/mattino.py
const ORDINE = `query($id:ID!){order(id:$id){
  id name createdAt cancelledAt tags displayFulfillmentStatus displayFinancialStatus note
  shippingAddress{name company address1 address2 zip city provinceCode country countryCodeV2}
  billingAddress{name company address1 address2 zip city provinceCode country countryCodeV2}
  lineItems(first:100){nodes{title variantTitle quantity unfulfilledQuantity requiresShipping
    image{url(transform:{maxWidth:160})} customAttributes{key value}}}
}}`;
const NEGOZIO = '{shop{name contactEmail primaryDomain{host} billingAddress{address1 address2 zip city provinceCode country countryCodeV2}}}';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') || '';
  if (!/^Bearer\s+\S+/i.test(auth)) return fail('Accesso richiesto', 401);
  const utente = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: { ordine_id?: string } = {};
  try { body = await req.json(); } catch { /* corpo vuoto */ }
  if (!body.ordine_id) return fail('Ordine mancante');

  // La RLS decide se chi chiama può vedere l'ordine
  const { data: riga, error } = await utente.from('shopify_orders').select('store_id, shopify_id').eq('id', body.ordine_id).maybeSingle();
  if (error) return fail(error.message, 500);
  if (!riga) return fail('Ordine non trovato', 404);

  const { data: store } = await db.from('shopify_stores').select('id, nome, dominio, client_id').eq('id', riga.store_id).maybeSingle();
  if (!store) return fail('Negozio non trovato', 404);

  try {
    const token = await getToken(db, store as Store);
    const chiama = async (query: string, variables: Record<string, unknown> = {}) => {
      const r = await fetch(`https://${store.dominio}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
      if (!r.ok) throw new Error(`Shopify ha risposto ${r.status}`);
      const j = await r.json();
      if (j.errors?.length) throw new Error(j.errors[0].message || 'Errore Shopify');
      return j.data;
    };
    const [o, n] = await Promise.all([chiama(ORDINE, { id: riga.shopify_id }), chiama(NEGOZIO)]);
    if (!o?.order) return fail('Ordine non trovato su Shopify', 404);
    return reply({ success: true, ordine: o.order, negozio: n.shop });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 502);
  }
});
