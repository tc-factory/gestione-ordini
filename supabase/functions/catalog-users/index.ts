// T&C Factory — Accessi dei clienti all'app clienti (staff)
//
// Crea / elimina gli account con cui i clienti entrano nell'app clienti e ne reimposta la password.
// Gira sui server Supabase con la chiave di servizio, che non arriva mai al browser.
// Chi chiama deve essere dello staff (in app_users). Si toccano SOLO account dell'app
// (in catalog_users): mai quelli dello staff.
//
// Deploy: supabase functions deploy catalog-users --project-ref <ref> --use-api --no-verify-jwt
// (il token viene verificato qui dentro con auth.getUser)

import { createClient } from 'npm:@supabase/supabase-js@2';

const STAFF_EMAIL_DOMAIN = 'tcfactory.local';
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const { data: me } = await admin.from('app_users').select('nickname').eq('auth_id', caller.user.id).maybeSingle();
  if (!me) return fail("Solo lo staff può gestire gli accessi all'app clienti", 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('Richiesta non valida'); }

  const action   = String(body.action || '');
  const email    = String(body.email || '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const authId   = String(body.auth_id || '');
  const clientId = String(body.client_id || '');

  const log = (azione: string, details: Record<string, unknown> = {}) =>
    admin.from('activity_log').insert({ user_nickname: me.nickname, action: azione, details });

  // Solo account dell'app: lo staff non si tocca da qui
  const appUser = async (id: string) => {
    const { data } = await admin.from('catalog_users').select('auth_id, email, client_id').eq('auth_id', id).maybeSingle();
    return data;
  };

  switch (action) {
    case 'create': {
      if (!EMAIL_RE.test(email)) return fail('Email non valida');
      if (email.endsWith('@' + STAFF_EMAIL_DOMAIN)) return fail('Questa email è riservata allo staff');
      if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)`);
      const { data: client } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle();
      if (!client) return fail('Cliente non trovato', 404);

      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !created.user) {
        return fail(/already|registered|exists/i.test(error?.message || '') ? 'Esiste già un account con questa email' : 'Impossibile creare l\'account');
      }
      const { error: linkErr } = await admin.from('catalog_users').insert({
        auth_id: created.user.id, client_id: clientId, email, created_by: me.nickname,
      });
      if (linkErr) {
        await admin.auth.admin.deleteUser(created.user.id);   // niente account a metà
        return fail('Impossibile collegare l\'account al cliente');
      }
      await log('Accesso app clienti creato', { email, clientId });
      return reply({ success: true });
    }

    case 'delete': {
      const u = await appUser(authId);
      if (!u) return fail('Accesso non trovato', 404);
      const { data: staff } = await admin.from('app_users').select('nickname').eq('auth_id', authId).maybeSingle();
      await admin.from('catalog_users').delete().eq('auth_id', authId);
      if (!staff) await admin.auth.admin.deleteUser(authId);
      await log('Accesso app clienti tolto', { email: u.email, clientId: u.client_id });
      return reply({ success: true });
    }

    case 'password': {
      if (password.length < MIN_PASSWORD_LENGTH) return fail(`Password troppo corta (min. ${MIN_PASSWORD_LENGTH} caratteri)`);
      const u = await appUser(authId);
      if (!u) return fail('Accesso non trovato', 404);
      const { data: staff } = await admin.from('app_users').select('nickname').eq('auth_id', authId).maybeSingle();
      if (staff) return fail('Questo account è dello staff: cambia la password da Impostazioni');
      const { error } = await admin.auth.admin.updateUserById(authId, { password });
      if (error) return fail('Impossibile aggiornare la password');
      await log('Password app clienti reimpostata', { email: u.email, clientId: u.client_id });
      return reply({ success: true });
    }

    default:
      return fail('Azione non valida');
  }
});
