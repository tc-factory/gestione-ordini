-- Supporto: l'admin può eliminare un ticket (anche risolto)
create or replace function tc_ticket_delete(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin possono eliminare i ticket'); end if;
  delete from support_tickets where id = p_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Ticket non trovato'); end if;
  return jsonb_build_object('success', true);
end; $$;

revoke execute on function tc_ticket_delete(uuid) from public, anon;
grant  execute on function tc_ticket_delete(uuid) to authenticated;
