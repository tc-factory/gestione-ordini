// T&C Factory — Accesso alle API Admin di Shopify per negozio.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const API_VERSION = '2026-10';

export type Store = { id: string; nome: string; dominio: string; client_id: string; sync_da?: string | null };

// Token con il "client credentials grant": dura 24 ore, salvato in shopify_tokens finché non sta per scadere
export async function getToken(db: SupabaseClient, store: Store): Promise<string> {
  const { data: saved } = await db.from('shopify_tokens').select('access_token, scade_at').eq('store_id', store.id).maybeSingle();
  if (saved && new Date(saved.scade_at).getTime() - Date.now() > 10 * 60_000) return saved.access_token;

  const secret = Deno.env.get(`SHOPIFY_SECRET_${store.id.toUpperCase()}`);
  if (!secret) throw new Error(`Manca il secret SHOPIFY_SECRET_${store.id.toUpperCase()}`);

  const res = await fetch(`https://${store.dominio}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: store.client_id, client_secret: secret }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Accesso negato da Shopify (${res.status}): ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('Shopify non ha restituito il token');

  const scade = new Date(Date.now() + (Number(json.expires_in) || 86_399) * 1000).toISOString();
  await db.from('shopify_tokens').upsert({ store_id: store.id, access_token: json.access_token, scade_at: scade });
  return json.access_token;
}
