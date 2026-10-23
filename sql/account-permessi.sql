-- ════════════════════════════════════════════════════════
-- T&C Factory — Permessi degli account: schede visibili e ruoli
--
--   • app_roles: ruoli (preset) con le schede visibili e la gestione economica
--   • app_users.ruolo_id: ruolo assegnato all'account (null = personalizzato)
--   • app_users.schede:   schede visibili di un account personalizzato
--                         (null = tutte, come prima di questo script)
--   • tc_set_user_access: l'admin assegna ruolo / schede / gestione economica
--
-- Un account con ruolo segue sempre il ruolo: modificando il ruolo cambiano
-- tutti gli account che lo hanno. Gli admin vedono sempre tutto.
-- Richiede sicurezza-2-blocca.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Ruoli: lo staff li legge, solo l'admin li modifica
-- ─────────────────────────────────────────────

create table if not exists app_roles (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique check (length(trim(nome)) between 1 and 40),
  schede     jsonb not null default '[]',
  economia   boolean not null default false,
  created_at timestamptz not null default now()
);

alter table app_roles enable row level security;
drop policy if exists "Staff legge ruoli"   on app_roles;
drop policy if exists "Admin gestisce ruoli" on app_roles;
create policy "Staff legge ruoli"    on app_roles for select to authenticated using (app_is_staff());
create policy "Admin gestisce ruoli" on app_roles for all    to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on app_roles from anon;
grant select, insert, update, delete on app_roles to authenticated;

-- ─────────────────────────────────────────────
-- 2. Ruolo e schede dell'account
-- ─────────────────────────────────────────────

alter table app_users add column if not exists ruolo_id uuid references app_roles(id) on delete set null;
alter table app_users add column if not exists schede   jsonb;

-- Gestione economica: per gli account con ruolo decide il ruolo
create or replace function app_can_view_economics() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users u left join app_roles r on r.id = u.ruolo_id
    where u.auth_id = auth.uid() and (u.is_admin or coalesce(r.economia, u.can_view_economics))
  );
$$;

-- ─────────────────────────────────────────────
-- 3. Assegnazione (solo admin)
--    p_ruolo_id valorizzato → l'account segue il ruolo
--    p_ruolo_id null        → personalizzato con p_schede e p_economia
-- ─────────────────────────────────────────────

create or replace function tc_set_user_access(p_nickname text, p_ruolo_id uuid, p_schede jsonb, p_economia boolean)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_ruolo text;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono cambiare i permessi'); end if;
  if lower(trim(p_nickname)) = v_me then return jsonb_build_object('success', false, 'error', 'Non puoi cambiare i tuoi permessi'); end if;
  if p_ruolo_id is not null then
    select nome into v_ruolo from app_roles where id = p_ruolo_id;
    if v_ruolo is null then return jsonb_build_object('success', false, 'error', 'Ruolo non trovato'); end if;
  elsif p_schede is not null and jsonb_typeof(p_schede) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'Schede non valide');
  end if;

  update app_users
     set ruolo_id = p_ruolo_id,
         schede   = case when p_ruolo_id is null then p_schede else schede end,
         can_view_economics = case when p_ruolo_id is null then coalesce(p_economia, false) else can_view_economics end
   where nickname = lower(trim(p_nickname));
  if not found then return jsonb_build_object('success', false, 'error', 'Utente non trovato'); end if;

  insert into activity_log (user_nickname, action, details)
  values (v_me, 'Permessi account modificati', jsonb_build_object('utente', lower(trim(p_nickname)),
          'ruolo', v_ruolo, 'schede', case when p_ruolo_id is null then p_schede end));
  return jsonb_build_object('success', true);
end; $$;

revoke execute on function tc_set_user_access(text, uuid, jsonb, boolean) from public, anon;
grant  execute on function tc_set_user_access(text, uuid, jsonb, boolean) to authenticated;

