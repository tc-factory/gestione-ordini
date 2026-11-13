// T&C Factory — Ritorno dal login Meta (Facebook Login for Business, token dell'utente di sistema)
//
// Due app, scelte dalla piattaforma salvata nello state (tc_meta_login_inizia):
//  - instagram → "CS Direct Connect": profili da me/assigned_instagram_accounts
//  - messenger → "CS Chat Connect": Pagine da me/assigned_pages, con il token della Pagina,
//    e iscrizione della Pagina ai messaggi (subscribed_apps) così arrivano al webhook meta-webhook
// Meta lavora un portfolio per volta: un login per portfolio. Si salva in social_account / social_token.
// Se non trova niente il token resta in meta_token_attesa, per controllarlo senza rifare il login.
// Ogni tentativo finisce in automazione_esecuzioni (nome meta-login), senza token.
//
// Secret: META_IG_APP_SECRET, META_FB_APP_SECRET.
// Va pubblicata con --no-verify-jwt: arriva dal browser dopo il login Meta, senza sessione Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';

const GRAPH = 'https://graph.facebook.com/v24.0';
const REDIRECT = `${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-login`;
const APP: Record<string, { id: string; secret: string; segreto: string }> = {
  instagram: { id: '29503917439294554', secret: Deno.env.get('META_IG_APP_SECRET') || '', segreto: 'META_IG_APP_SECRET' },
  messenger: { id: '1778695599875719', secret: Deno.env.get('META_FB_APP_SECRET') || '', segreto: 'META_FB_APP_SECRET' },
};

// Negozio indovinato dal nome; l'admin lo può cambiare
const NEGOZI: [RegExp, string][] = [
  [/ciucciami/i, 'ciucciamilcalzino'],
  [/box.?factory/i, 'boxfactorylab'],
  [/bien.?jugado/i, 'bienjugado'],
  [/live.?printing/i, 'liveprinting'],
];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

async function registra(piattaforma: string, esito: string, riepilogo: Row) {
  await db.from('automazione_esecuzioni').insert({
    nome: 'meta-login', stato: esito.startsWith('ok') ? 'ok' : 'errore', fine: new Date().toISOString(),
    riepilogo: { piattaforma, ...riepilogo }, output: esito.slice(0, 2000),
  }).then(() => {}, () => {});
  return new Response(null, { status: 302, headers: { Location: `https://cs.pngs.it/#/controllo/collegamenti/${piattaforma}:${encodeURIComponent(esito)}` } });
}

async function graph(path: string, params: Record<string, string>, method = 'GET') {
  const res = await fetch(`${GRAPH}/${path}?${new URLSearchParams(params)}`, { method });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Meta ha risposto ${res.status}`);
  return json;
}

// Un account trovato nel login: id, dati e token da salvare
type Trovato = { id: string; username?: string; nome?: string; foto?: string; token: string; nota?: string };

async function profiliInstagram(token: string, rie: Row): Promise<Trovato[]> {
  const r = await graph('me/assigned_instagram_accounts', { fields: 'id,username', access_token: token });
  rie.assegnati = (r.data || []).map((x: Row) => x.username || x.id);
  const out: Trovato[] = [];
  for (const x of r.data || []) {
    const p = await graph(String(x.id), { fields: 'id,username,name,profile_picture_url', access_token: token }).catch(() => x);
    out.push({ id: String(x.id), username: p.username, nome: p.name, foto: p.profile_picture_url, token });
  }
  return out;
}

async function pagineFacebook(token: string, rie: Row): Promise<Trovato[]> {
  const r = await graph('me/assigned_pages', { fields: 'id,name,access_token,picture{url}', access_token: token });
  rie.assegnati = (r.data || []).map((x: Row) => x.name || x.id);
  const out: Trovato[] = [];
  for (const p of r.data || []) {
    const tokenPagina = p.access_token || token;
    // La Pagina manda i suoi messaggi alla nostra app (webhook meta-webhook)
    let nota: string | undefined;
    try { await graph(`${p.id}/subscribed_apps`, { subscribed_fields: 'messages,messaging_postbacks', access_token: tokenPagina }, 'POST'); }
    catch (e) { nota = 'Iscrizione ai messaggi non riuscita: ' + (e as Error).message; }
    out.push({ id: String(p.id), username: p.name, nome: p.name, foto: p.picture?.data?.url, token: tokenPagina, nota });
  }
  return out;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const rie: Row = { parametri: [...url.searchParams.keys()].filter(k => k !== 'code') };

  // State usa e getta, valido 24 ore (la finestra di Meta può restare aperta a lungo)
  const { data: st } = state ? await db.from('meta_login_stati').delete().eq('state', state).select().maybeSingle() : { data: null };
  const piattaforma = st?.piattaforma === 'messenger' ? 'messenger' : 'instagram';
  const app = APP[piattaforma];
  if (url.searchParams.get('error')) return registra(piattaforma, 'errore:' + (url.searchParams.get('error_description') || url.searchParams.get('error_reason') || 'Accesso annullato'), rie);
  if (!code || !state) return registra(piattaforma, 'errore:Risposta di Meta incompleta', rie);
  if (!st || Date.now() - new Date(st.creato_at).getTime() > 24 * 3600_000) return registra(piattaforma, 'errore:Collegamento scaduto, riprova da Collegamenti', rie);
  if (!app.secret) return registra(piattaforma, `errore:Manca il secret ${app.segreto} in Supabase`, rie);

  try {
    const { access_token: token } = await graph('oauth/access_token', { client_id: app.id, client_secret: app.secret, redirect_uri: REDIRECT, code });
    if (!token) throw new Error('Meta non ha dato il token');
    try { rie.client_business_id = (await graph('me', { fields: 'client_business_id', access_token: token })).client_business_id; } catch { /* solo per il registro */ }

    let trovati: Trovato[] = [];
    try { trovati = piattaforma === 'messenger' ? await pagineFacebook(token, rie) : await profiliInstagram(token, rie); }
    catch (e) { rie.lettura = (e as Error).message; }
    if (!trovati.length) {
      await db.from('meta_token_attesa').insert({ token, riepilogo: { piattaforma, ...rie } }).then(() => {}, () => {});
      throw new Error(piattaforma === 'messenger'
        ? 'Nessuna Pagina Facebook concessa: nel login va selezionata almeno una Pagina'
        : 'Nessun profilo Instagram concesso: nel login va selezionato almeno un account Instagram');
    }

    let salvati = 0;
    const errori: string[] = [];
    for (const t of trovati) {
      try {
        const negozio = NEGOZI.find(([re]) => re.test(`${t.username} ${t.nome}`))?.[1] || null;
        const { data: esistente } = await db.from('social_account').select('negozio').eq('piattaforma', piattaforma).eq('account_id', t.id).maybeSingle();
        const { data: acc, error } = await db.from('social_account').upsert({
          piattaforma, account_id: t.id, username: t.username || null, nome: t.nome || null, foto: t.foto || null,
          negozio: esistente?.negozio || negozio, attivo: true, collegato_at: new Date().toISOString(),
          collegato_da: st.utente, ultimo_errore: t.nota || null,
        }, { onConflict: 'piattaforma,account_id' }).select('id').single();
        if (error) throw error;
        const { error: e2 } = await db.from('social_token').upsert({ account: acc.id, token: t.token, aggiornato_at: new Date().toISOString() });
        if (e2) throw e2;
        salvati++;
      } catch (e) {
        errori.push(`${t.username || t.id}: ${(e as Error).message}`);
      }
    }
    if (!salvati) throw new Error(errori.join(' · '));
    rie.errori = errori;
    return registra(piattaforma, `ok:${salvati}`, rie);
  } catch (e) {
    console.error('meta-login', e);
    return registra(piattaforma, 'errore:' + (e as Error).message, rie);
  }
});
