// T&C Factory — Ritorno dal login Meta (app "CS Direct Connect", Instagram con login unificato)
//
// Il Centro di controllo crea uno state usa e getta (tc_meta_login_inizia) e apre il login Meta.
// Meta rimanda qui con ?code&state: si controlla lo state, si scambia il codice con il token
// dell'utente di sistema (non scade), si leggono i profili Instagram concessi (debug_token →
// granular_scopes) e si salvano in social_account / social_token. Poi si torna al gestionale.
//
// Secret: META_IG_APP_SECRET (chiave segreta dell'app), META_IG_APP_ID (facoltativo).
// Va pubblicata con --no-verify-jwt: arriva dal browser dopo il login Meta, senza sessione Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v24.0';
const APP_ID = Deno.env.get('META_IG_APP_ID') || '29503917439294554';
const APP_SECRET = Deno.env.get('META_IG_APP_SECRET') || '';
const REDIRECT = `${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-login`;
const RITORNO = 'https://cs.pngs.it/#/controllo/collegamenti/instagram:';

// Negozio indovinato dal nome del profilo; l'admin lo può cambiare
const NEGOZI: [RegExp, string][] = [
  [/ciucciami/i, 'ciucciamilcalzino'],
  [/box.?factory/i, 'boxfactorylab'],
  [/bien.?jugado/i, 'bienjugado'],
  [/live.?printing/i, 'liveprinting'],
];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const torna = (esito: string) => new Response(null, { status: 302, headers: { Location: RITORNO + encodeURIComponent(esito) } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Ogni tentativo resta in automazione_esecuzioni (nome meta-login), senza token: serve a capire i login falliti
async function registra(esito: string, riepilogo: Row) {
  await db.from('automazione_esecuzioni').insert({
    nome: 'meta-login', stato: esito.startsWith('ok') ? 'ok' : 'errore', fine: new Date().toISOString(),
    riepilogo, output: esito.slice(0, 2000),
  }).then(() => {}, () => {});
  return torna(esito);
}

async function graph(path: string, params: Record<string, string>) {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta ha risposto ${res.status}`);
  return json;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const rie: Row = { parametri: [...url.searchParams.keys()].filter(k => k !== 'code') };
  if (url.searchParams.get('error')) return registra('errore:' + (url.searchParams.get('error_description') || url.searchParams.get('error_reason') || 'Accesso annullato'), rie);
  if (!code || !state) return registra('errore:Risposta di Meta incompleta', rie);
  if (!APP_SECRET) return registra('errore:Manca il secret META_IG_APP_SECRET in Supabase', rie);

  // State usa e getta, valido 15 minuti
  const { data: st } = await db.from('meta_login_stati').delete().eq('state', state).select().maybeSingle();
  if (!st || Date.now() - new Date(st.creato_at).getTime() > 15 * 60_000) return registra('errore:Collegamento scaduto, riprova da Collegamenti', rie);

  try {
    const { access_token: token } = await graph('oauth/access_token', { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: REDIRECT, code });
    if (!token) throw new Error('Meta non ha dato il token');

    // Profili Instagram concessi in questo login
    const { data: info } = await graph('debug_token', { input_token: token, access_token: `${APP_ID}|${APP_SECRET}` });
    rie.scopes = (info?.granular_scopes || []).map((s: Row) => ({ scope: s.scope, target_ids: s.target_ids }));
    rie.tipo = info?.type;
    const ids = new Set<string>();
    for (const s of (info?.granular_scopes || []) as Row[]) {
      if (String(s.scope).startsWith('instagram_')) (s.target_ids || []).forEach((id: string) => ids.add(String(id)));
    }
    if (!ids.size) {
      // Token dell'utente di sistema: i permessi non dicono i profili, si chiedono a Meta in più modi
      // Il token di integrazione appartiene al portfolio del cliente: i profili si leggono da lì
      let biz = '';
      try { biz = (await graph('me', { fields: 'client_business_id', access_token: token })).client_business_id || ''; rie.client_business_id = biz; }
      catch (e) { rie.client_business_id = (e as Error).message; }
      const vie: [string, string][] = biz ? [
        [`${biz}/owned_instagram_assets`, 'id,username,name'],
        [`${biz}/instagram_business_accounts`, 'id,username,name'],
        [`${biz}/owned_instagram_accounts`, 'id,username'],
        [`${biz}/instagram_accounts`, 'id,username'],
        [`${biz}/client_instagram_assets`, 'id,username,name'],
      ] : [];
      vie.push(['me/accounts', 'instagram_business_account{id,username}']);
      const raccogli = (x: unknown): void => {
        if (Array.isArray(x)) { x.forEach(raccogli); return; }
        if (!x || typeof x !== 'object') return;
        const o = x as Row;
        if (o.id && o.username) ids.add(String(o.id));
        Object.values(o).forEach(raccogli);
      };
      for (const [via, fields] of vie) {
        try {
          const r = await graph(via, { fields, access_token: token }); rie[via] = r; raccogli(r);
          if (via.startsWith(biz + '/')) (r.data || []).forEach((x: Row) => x.id && ids.add(String(x.id)));
        }
        catch (e) { rie[via] = (e as Error).message; }
      }
    }
    if (!ids.size) {
      await db.from('meta_token_attesa').insert({ token, riepilogo: rie }).then(() => {}, () => {});
      throw new Error('Nessun profilo Instagram concesso: nel login va selezionato almeno un account Instagram');
    }

    let salvati = 0;
    const errori: string[] = [];
    for (const id of ids) {
      try {
        const p = await graph(id, { fields: 'id,username,name,profile_picture_url', access_token: token });
        const negozio = NEGOZI.find(([re]) => re.test(`${p.username} ${p.name}`))?.[1] || null;
        const { data: esistente } = await db.from('social_account').select('id, negozio').eq('piattaforma', 'instagram').eq('account_id', id).maybeSingle();
        const { data: acc, error } = await db.from('social_account').upsert({
          piattaforma: 'instagram', account_id: id, username: p.username || null, nome: p.name || null,
          foto: p.profile_picture_url || null, negozio: esistente?.negozio || negozio, attivo: true,
          collegato_at: new Date().toISOString(), collegato_da: st.utente, ultimo_errore: null,
        }, { onConflict: 'piattaforma,account_id' }).select('id').single();
        if (error) throw error;
        const { error: e2 } = await db.from('social_token').upsert({ account: acc.id, token, aggiornato_at: new Date().toISOString() });
        if (e2) throw e2;
        salvati++;
      } catch (e) {
        errori.push(`${id}: ${(e as Error).message}`);
      }
    }
    if (!salvati) throw new Error(errori.join(' · '));
    rie.errori = errori;
    return registra(`ok:${salvati}`, rie);
  } catch (e) {
    console.error('meta-login', e);
    return registra('errore:' + (e as Error).message, rie);
  }
});
