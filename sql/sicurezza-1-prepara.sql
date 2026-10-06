-- ════════════════════════════════════════════════════════
-- T&C Factory — Sicurezza, fase 1 di 2: PREPARAZIONE
--
-- Passa al login di Supabase (Supabase Auth) SENZA rompere la versione
-- attualmente online: aggiunge soltanto, non chiude niente.
--   • crea un account di login per ogni utente di app_users,
--     con la STESSA password (si copia l'hash bcrypt, già compatibile)
--   • funzioni di controllo ruolo usate dalle policy della fase 2
--   • ticket di supporto basati sull'utente collegato + risposte admin
--
-- Email di login (mai usate per inviare posta): <nickname>@tcfactory.local
-- Script idempotente, si può rieseguire.
-- La fase 2 (sicurezza-2-blocca.sql) va eseguita insieme alla
-- pubblicazione del codice nuovo.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Collegamento profilo ↔ account di login
-- ─────────────────────────────────────────────

alter table app_users add column if not exists auth_id uuid unique references auth.users(id) on delete set null;
-- Gli utenti nuovi (creati dalla funzione admin-users) non hanno più un hash qui
alter table app_users alter column password_hash drop not null;

do $$
declare r record; v_id uuid; v_email text;
begin
  for r in select * from app_users where auth_id is null and password_hash is not null loop
    v_email := r.nickname || '@tcfactory.local';
    select id into v_id from auth.users where email = v_email;

    if v_id is null then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change,
        email_change_token_current, phone_change, phone_change_token, reauthentication_token,
        is_sso_user, is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, r.password_hash, now(),
        '{"provider":"email","providers":["email"]}', jsonb_build_object('nickname', r.nickname), now(), now(),
        '', '', '', '', '', '', '', '', false, false
      );
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (v_id::text, v_id,
              jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
              'email', null, now(), now());
    end if;

    update app_users set auth_id = v_id where nickname = r.nickname;
  end loop;
end $$;

grant select (auth_id) on app_users to authenticated;

-- ─────────────────────────────────────────────
-- 2. Ruoli dell'utente collegato (usati dalle policy)
-- ─────────────────────────────────────────────

create or replace function app_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where auth_id = auth.uid());
$$;

create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where auth_id = auth.uid() and is_admin);
$$;

create or replace function app_can_view_economics() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users where auth_id = auth.uid() and (is_admin or can_view_economics));
$$;

create or replace function app_nickname() returns text
language sql stable security definer set search_path = public as $$
  select nickname from app_users where auth_id = auth.uid();
$$;

revoke execute on function app_is_staff(), app_is_admin(), app_can_view_economics(), app_nickname() from public, anon;
grant  execute on function app_is_staff(), app_is_admin(), app_can_view_economics(), app_nickname() to authenticated;

-- ─────────────────────────────────────────────
-- 3. Ticket di supporto: utente collegato + risposte dell'admin
--    (sostituiscono le versioni con nickname/password)
-- ─────────────────────────────────────────────

alter table support_tickets add column if not exists risposte jsonb not null default '[]';

drop function if exists tc_ticket_create(text, text, text, text, text);
drop function if exists tc_ticket_list(text, text);
drop function if exists tc_ticket_set_status(text, text, uuid, text);
drop function if exists tc_ticket_set_priority(text, text, uuid, text);
drop function if exists _tc_check_user(text, text);

create or replace function tc_ticket_create(p_oggetto text, p_descrizione text, p_categoria text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_nick text := app_nickname(); v_id uuid;
begin
  if v_nick is null then return jsonb_build_object('success', false, 'error', 'Accesso richiesto'); end if;
  if app_is_admin() then return jsonb_build_object('success', false, 'error', 'Gli admin gestiscono i ticket, non li aprono'); end if;
  if coalesce(trim(p_oggetto), '') = '' then return jsonb_build_object('success', false, 'error', 'Inserisci un oggetto'); end if;

  insert into support_tickets (created_by, oggetto, descrizione, categoria)
  values (v_nick, trim(p_oggetto), left(coalesce(p_descrizione, ''), 5000),
          case when p_categoria in ('problema', 'richiesta', 'altro') then p_categoria else 'altro' end)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end; $$;

create or replace function tc_ticket_list()
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_nick text := app_nickname();
begin
  if v_nick is null then return jsonb_build_object('success', false, 'error', 'Accesso richiesto'); end if;
  return jsonb_build_object('success', true, 'tickets', coalesce((
    select jsonb_agg(to_jsonb(t) order by t.created_at desc)
    from support_tickets t
    where app_is_admin() or t.created_by = v_nick
  ), '[]'::jsonb));
end; $$;

create or replace function tc_ticket_set_status(p_id uuid, p_stato text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono cambiare lo stato'); end if;
  if p_stato not in ('da_fare', 'in_lavorazione', 'risolto') then return jsonb_build_object('success', false, 'error', 'Stato non valido'); end if;
  update support_tickets
     set stato = p_stato, updated_at = now(), updated_by = app_nickname(),
         resolved_at = case when p_stato = 'risolto' then now() else null end
   where id = p_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Ticket non trovato'); end if;
  return jsonb_build_object('success', true);
end; $$;

create or replace function tc_ticket_set_priority(p_id uuid, p_priorita text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono cambiare la priorità'); end if;
  if p_priorita not in ('urgente', 'alta', 'normale', 'bassa') then return jsonb_build_object('success', false, 'error', 'Priorità non valida'); end if;
  update support_tickets set priorita = p_priorita, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Ticket non trovato'); end if;
  return jsonb_build_object('success', true);
end; $$;

-- Risposta dell'admin, visibile a chi ha aperto il ticket
create or replace function tc_ticket_reply(p_id uuid, p_testo text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_msg jsonb;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono rispondere'); end if;
  if coalesce(trim(p_testo), '') = '' then return jsonb_build_object('success', false, 'error', 'Scrivi una risposta'); end if;
  v_msg := jsonb_build_object('id', gen_random_uuid(), 'da', app_nickname(), 'testo', left(trim(p_testo), 5000), 'at', now());
  update support_tickets set risposte = risposte || v_msg, updated_at = now() where id = p_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Ticket non trovato'); end if;
  return jsonb_build_object('success', true, 'risposta', v_msg);
end; $$;

revoke execute on function tc_ticket_create(text, text, text), tc_ticket_list(), tc_ticket_set_status(uuid, text),
                           tc_ticket_set_priority(uuid, text), tc_ticket_reply(uuid, text) from public, anon;
grant  execute on function tc_ticket_create(text, text, text), tc_ticket_list(), tc_ticket_set_status(uuid, text),
                           tc_ticket_set_priority(uuid, text), tc_ticket_reply(uuid, text) to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE FASE 1
-- ════════════════════════════════════════════════════════
