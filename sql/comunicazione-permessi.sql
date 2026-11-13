-- La Mail non è più una voce della navbar: sta dentro Comunicazione.
-- Chi vede Comunicazione può usare le caselle (le funzioni tc_mail_* controllano app_vede_scheda('mail')).
-- Chi aveva la scheda Mail riceve anche Comunicazione.

create or replace function app_vede_scheda(p_scheda text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users u left join app_roles r on r.id = u.ruolo_id
     where u.auth_id = auth.uid()
       and (u.is_admin or exists (
             select 1 from unnest(case when p_scheda = 'mail' then array['mail', 'comunicazione'] else array[p_scheda] end) s
              where case when u.ruolo_id is not null then coalesce(r.schede, '[]'::jsonb) ? s
                         else u.schede is null or u.schede ? s end))
  );
$$;
revoke execute on function app_vede_scheda(text) from public, anon;
grant  execute on function app_vede_scheda(text) to authenticated;

update app_users set schede = schede || '["comunicazione"]'::jsonb
 where schede ? 'mail' and not schede ? 'comunicazione';
update app_roles set schede = schede || '["comunicazione"]'::jsonb
 where schede ? 'mail' and not schede ? 'comunicazione';
