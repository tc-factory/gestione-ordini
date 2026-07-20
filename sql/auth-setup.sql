-- ════════════════════════════════════════════════════════
-- T&C Factory — Login + Registro modifiche
-- Esegui in: Supabase → SQL Editor → New query
-- ════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. Tabella utenti
-- ─────────────────────────────────────────────

create table if not exists app_users (
  nickname      text primary key,
  password_hash text not null,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table app_users enable row level security;
drop policy if exists "Public read app_users" on app_users;
create policy "Public read app_users"
  on app_users for select to anon, authenticated using (true);

-- ─────────────────────────────────────────────
-- 2. Funzione login
-- ─────────────────────────────────────────────

create or replace function tc_login(p_nickname text, p_password text)
returns jsonb
security definer
set search_path = public
language plpgsql as $$
declare v_user app_users%rowtype;
begin
  select * into v_user
  from app_users
  where nickname = lower(trim(p_nickname));

  if not found
  or v_user.password_hash != crypt(p_password, v_user.password_hash) then
    return jsonb_build_object('success', false, 'error', 'Credenziali non valide');
  end if;

  return jsonb_build_object(
    'success',   true,
    'nickname',  v_user.nickname,
    'is_admin',  v_user.is_admin
  );
end;
$$;

-- ─────────────────────────────────────────────
-- 3. Funzione gestione utenti (solo admin)
-- ─────────────────────────────────────────────

create or replace function tc_manage_user(
  p_admin_nick  text,
  p_admin_pwd   text,
  p_action      text,   -- 'create' | 'delete'
  p_target_nick text,
  p_target_pwd  text,
  p_is_admin    boolean
)
returns jsonb
security definer
set search_path = public
language plpgsql as $$
declare v_admin app_users%rowtype;
begin
  -- Verifica credenziali admin
  select * into v_admin
  from app_users
  where nickname = lower(trim(p_admin_nick)) and is_admin = true;

  if not found
  or v_admin.password_hash != crypt(p_admin_pwd, v_admin.password_hash) then
    return jsonb_build_object('success', false, 'error', 'Credenziali admin non valide');
  end if;

  if p_action = 'create' then
    insert into app_users (nickname, password_hash, is_admin)
    values (
      lower(trim(p_target_nick)),
      crypt(p_target_pwd, gen_salt('bf')),
      p_is_admin
    )
    on conflict (nickname) do update
      set password_hash = crypt(p_target_pwd, gen_salt('bf')),
          is_admin      = p_is_admin;
    return jsonb_build_object('success', true);

  elsif p_action = 'delete' then
    if lower(trim(p_target_nick)) = lower(trim(p_admin_nick)) then
      return jsonb_build_object('success', false, 'error', 'Non puoi eliminare te stesso');
    end if;
    delete from app_users where nickname = lower(trim(p_target_nick));
    return jsonb_build_object('success', true);
  end if;

  return jsonb_build_object('success', false, 'error', 'Azione non valida');
end;
$$;

grant execute on function tc_login       to anon, authenticated;
grant execute on function tc_manage_user to anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. Tabella registro modifiche
-- ─────────────────────────────────────────────

create table if not exists activity_log (
  id            bigserial primary key,
  user_nickname text not null default 'sistema',
  action        text not null,
  order_id      text,
  order_name    text,
  details       jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

alter table activity_log enable row level security;
drop policy if exists "Public read activity_log"   on activity_log;
drop policy if exists "Public insert activity_log" on activity_log;
create policy "Public read activity_log"
  on activity_log for select to anon, authenticated using (true);
create policy "Public insert activity_log"
  on activity_log for insert to anon, authenticated with check (true);

-- ─────────────────────────────────────────────
-- 5. Account admin iniziale
--    nickname: admin
--    password: tcfactory26$
--    (cambiala subito dalle Impostazioni)
-- ─────────────────────────────────────────────

insert into app_users (nickname, password_hash, is_admin)
values ('admin', crypt('tcfactory26$', gen_salt('bf')), true)
on conflict (nickname) do nothing;

-- ════════════════════════════════════════════════════════
-- FINE — Accedi con: admin / tcfactory26$
-- ════════════════════════════════════════════════════════
