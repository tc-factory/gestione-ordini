// T&C Factory — Gestione utenti (solo admin)
//
// Crea / elimina account, reimposta password e permesso "gestione economica".
// Gira sui server Supabase con la chiave di servizio, che non arriva mai al browser.
// Chi chiama deve essere collegato e avere is_admin in app_users.
//
// Deploy: supabase functions deploy admin-users --project-ref <ref> --use-api --no-verify-jwt
// (il token viene verificato qui dentro con auth.getUser)

import { createClient } from 'npm:@supabase/supabase-js@2';

const LOGIN_EMAIL_DOMAIN = 'tcfactory.local';
const MIN_PASSWORD_LENGTH = 8;
const NICK_RE = /^[a-z0-9._-]{2,30}$/;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => reply({ success: false, error }, status);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Metodo non consentito', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Chi sta chiamando? ──
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: caller } = await admin.auth.getUser(token);
  if (!caller?.user) return fail('Accesso richiesto', 401);

  const { data: me } = await admin.from('app_users').select('nickname, is_admin').eq('auth_id', caller.user.id).maybeSingle();
  if (!me?.is_admin) return fail('Solo gli admin possono gestire gli utenti', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }

  const action   = String(body.action || '');
  const nickname = String(body.nickname || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const log = (azione: string, details: Record<string, unknown> = {}) =>
    admin.from('activity_log').insert({ user_nickname: me.nickname, action: azione, details: { utente: nickname, ...details } });

  const target = async () => {
    const { data } = await admin.from('app_users').select('nickname, auth_id, is_admin').eq('nickname', nickname).maybeSingle();
    return data;
  };

  switch (action) {
    case 'create': {
      if (!NICK_RE.test(nickname)) return fail('Nickname non valido: 2-30 caratteri tra lettere minuscole, numeri, punto, trattino');
      if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)`);
      if (await target()) return fail('Esiste già un utente con questo nickname');

      const { data: created, error } = await admin.auth.admin.createUser({
        email: `${nickname}@${LOGIN_EMAIL_DOMAIN}`,
        password,
        email_confirm: true,
        user_metadata: { nickname },
      });
      if (error || !created.user) return fail('Impossibile creare l\'account');

      const { error: profErr } = await admin.from('app_users').insert({
        nickname, is_admin: !!body.isAdmin, can_view_economics: false, auth_id: created.user.id,
      });
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id);   // niente account a metà
        return fail('Impossibile creare il profilo');
      }
      await log('Utente creato', { admin: !!body.isAdmin });
      return reply({ success: true });
    }

    case 'delete': {
      if (nickname === me.nickname) return fail('Non puoi eliminare te stesso');
      const t = await target();
      if (!t) return fail('Utente non trovato', 404);
      await admin.from('app_users').delete().eq('nickname', nickname);
      if (t.auth_id) await admin.auth.admin.deleteUser(t.auth_id);
      await log('Utente eliminato');
      return reply({ success: true });
    }

    case 'reset_password': {
      if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)`);
      const t = await target();
      if (!t?.auth_id) return fail('Utente non trovato', 404);
      const { error } = await admin.auth.admin.updateUserById(t.auth_id, { password });
      if (error) return fail('Impossibile aggiornare la password');
      await log('Password reimpostata');
      return reply({ success: true });
    }

    case 'set_economics': {
      if (nickname === me.nickname) return fail('Non puoi cambiare i tuoi permessi');
      const { error, count } = await admin.from('app_users')
        .update({ can_view_economics: !!body.value }, { count: 'exact' }).eq('nickname', nickname);
      if (error || !count) return fail('Utente non trovato', 404);
      await log(body.value ? 'Gestione economica abilitata' : 'Gestione economica disabilitata');
      return reply({ success: true });
    }

    default:
      return fail('Azione non valida');
  }
});
