-- ════════════════════════════════════════════════════════
-- T&C Factory — Ticket di supporto
-- Esegui in: Supabase → SQL Editor → New query
--
-- La tabella NON è leggibile direttamente con la chiave pubblica:
-- si usa solo tramite le funzioni qui sotto, che verificano
-- nickname e password (come tc_manage_user).
--   • utenti (non admin): creano ticket e vedono solo i propri
--   • admin: vedono tutti i ticket e ne cambiano lo stato
-- Script NON distruttivo, si può rieseguire.
-- ════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────
-- 1. Tabella
-- ─────────────────────────────────────────────

create table if not exists support_tickets (
  id          uuid primary key default gen_random_uuid(),
  created_by  text not null,
  oggetto     text not null check (length(trim(oggetto)) between 1 and 200),
  descrizione text not null default '' check (length(descrizione) <= 5000),
  categoria   text not null default 'problema' check (categoria in ('problema', 'richiesta', 'altro')),
  stato       text not null default 'da_fare'  check (stato in ('da_fare', 'in_lavorazione', 'risolto')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text,
  resolved_at timestamptz
);

-- RLS attivo e nessuna policy: accesso diretto negato a anon/authenticated
alter table support_tickets enable row level security;
revoke all on support_tickets from anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Verifica credenziali (uso interno)
-- ─────────────────────────────────────────────

create or replace function _tc_check_user(p_nick text, p_pwd text)
returns app_users
security definer
set search_path = public, extensions
language plpgsql as $$
declare v app_users%rowtype;
begin
  select * into v from app_users where nickname = lower(trim(p_nick));
  if not found or p_pwd is null or v.password_hash != crypt(p_pwd, v.password_hash) then
    return null;
  end if;
  return v;
end;
$$;

revoke execute on function _tc_check_user(text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. Crea ticket (solo utenti non admin)
-- ─────────────────────────────────────────────

create or replace function tc_ticket_create(
  p_nick text, p_pwd text, p_oggetto text, p_descrizione text, p_categoria text
)
returns jsonb
security definer
set search_path = public, extensions
language plpgsql as $$
declare v app_users; v_id uuid;
begin
  v := _tc_check_user(p_nick, p_pwd);
  if v.nickname is null then
    return jsonb_build_object('success', false, 'error', 'Sessione non valida — effettua di nuovo il login');
  end if;
  if v.is_admin then
    return jsonb_build_object('success', false, 'error', 'Gli admin gestiscono i ticket, non li aprono');
  end if;
  if coalesce(trim(p_oggetto), '') = '' then
    return jsonb_build_object('success', false, 'error', 'Inserisci un oggetto');
  end if;

  insert into support_tickets (created_by, oggetto, descrizione, categoria)
  values (v.nickname, trim(p_oggetto), coalesce(p_descrizione, ''),
          case when p_categoria in ('problema', 'richiesta', 'altro') then p_categoria else 'altro' end)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

-- ─────────────────────────────────────────────
-- 4. Elenco ticket: admin → tutti, utente → solo i propri
-- ─────────────────────────────────────────────

create or replace function tc_ticket_list(p_nick text, p_pwd text)
returns jsonb
security definer
set search_path = public, extensions
language plpgsql as $$
declare v app_users;
begin
  v := _tc_check_user(p_nick, p_pwd);
  if v.nickname is null then
    return jsonb_build_object('success', false, 'error', 'Sessione non valida — effettua di nuovo il login');
  end if;

  return jsonb_build_object('success', true, 'tickets', coalesce((
    select jsonb_agg(to_jsonb(t) order by t.created_at desc)
    from support_tickets t
    where v.is_admin or t.created_by = v.nickname
  ), '[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────
-- 5. Cambio stato (solo admin)
-- ─────────────────────────────────────────────

create or replace function tc_ticket_set_status(p_nick text, p_pwd text, p_id uuid, p_stato text)
returns jsonb
security definer
set search_path = public, extensions
language plpgsql as $$
declare v app_users;
begin
  v := _tc_check_user(p_nick, p_pwd);
  if v.nickname is null or not v.is_admin then
    return jsonb_build_object('success', false, 'error', 'Solo gli admin possono cambiare lo stato');
  end if;
  if p_stato not in ('da_fare', 'in_lavorazione', 'risolto') then
    return jsonb_build_object('success', false, 'error', 'Stato non valido');
  end if;

  update support_tickets
     set stato = p_stato,
         updated_at = now(),
         updated_by = v.nickname,
         resolved_at = case when p_stato = 'risolto' then now() else null end
   where id = p_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Ticket non trovato');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

grant execute on function tc_ticket_create(text, text, text, text, text) to anon, authenticated;
grant execute on function tc_ticket_list(text, text)                     to anon, authenticated;
grant execute on function tc_ticket_set_status(text, text, uuid, text)   to anon, authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
