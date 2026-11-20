-- ════════════════════════════════════════════════════════
-- T&C Factory — Via i ruoli degli account (deciso da Riccardo il 2026-11-20)
--
-- I ruoli (app_roles, preset di schede) non sono mai stati usati: 0 ruoli, nessun account con ruolo.
-- Ogni account ha le sue schede (app_users.schede, null = tutte) e la sua gestione economica.
-- Sostituisce le versioni di sql/account-permessi.sql.
-- ════════════════════════════════════════════════════════

begin;

create or replace function app_can_view_economics()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from app_users u
     where u.auth_id = auth.uid() and (u.is_admin or u.can_view_economics)
  );
$$;

create or replace function app_vede_scheda(p_scheda text)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from app_users u
     where u.auth_id = auth.uid()
       and (u.is_admin or u.schede is null or exists (
             select 1 from unnest(case when p_scheda = 'mail' then array['mail', 'comunicazione'] else array[p_scheda] end) s
              where u.schede ? s))
  );
$$;

drop function if exists tc_set_user_access(text, uuid, jsonb, boolean);

create or replace function tc_set_user_access(p_nickname text, p_schede jsonb, p_economia boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_me text := app_nickname();
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono cambiare i permessi'); end if;
  if lower(trim(p_nickname)) = v_me then return jsonb_build_object('success', false, 'error', 'Non puoi cambiare i tuoi permessi'); end if;
  if p_schede is not null and jsonb_typeof(p_schede) <> 'array' then
    return jsonb_build_object('success', false, 'error', 'Schede non valide');
  end if;

  update app_users
     set schede = p_schede,
         can_view_economics = coalesce(p_economia, false)
   where nickname = lower(trim(p_nickname));
  if not found then return jsonb_build_object('success', false, 'error', 'Utente non trovato'); end if;

  insert into activity_log (user_nickname, action, details)
  values (v_me, 'Permessi account modificati', jsonb_build_object('utente', lower(trim(p_nickname)), 'schede', p_schede));
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function tc_set_user_access(text, jsonb, boolean) from public, anon;
grant  execute on function tc_set_user_access(text, jsonb, boolean) to authenticated;

-- Il gestionale legge le schede dell'account al login: prima la lettura falliva (colonna senza permesso)
-- e il codice ripiegava in silenzio su "tutte le schede"; tolto il ripiego serve il permesso (aggiunto il 2026-11-20)
grant select (schede) on app_users to authenticated;

alter table app_users drop column if exists ruolo_id;
drop table if exists app_roles;

commit;
