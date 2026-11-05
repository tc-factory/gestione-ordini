-- ════════════════════════════════════════════════════════
-- T&C Factory — Problemi dei collegamenti nel Centro di controllo
-- Gli errori non arrivano più come messaggi: si vedono in cima al Centro di controllo.
-- Richiede tracking-gls.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function tc_problemi_collegamenti()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'problemi', coalesce((select jsonb_agg(p.testo order by p.chiave) from _tc_problemi() p), '[]'::jsonb));
end;
$$;
revoke execute on function tc_problemi_collegamenti() from public, anon;
grant  execute on function tc_problemi_collegamenti() to authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'controllo-collegamenti') then perform cron.unschedule('controllo-collegamenti'); end if;
end $$;

-- Il briefing resta, senza la parte sugli errori
do $$
declare v text;
begin
  select pg_get_functiondef('_tc_briefing'::regproc) into v;
  if v like '%⚠️ Collegamenti%' then
    v := replace(v, E' || E''\\n\\n'' ||\n    coalesce(''⚠️ Collegamenti:'' || E''\\n'' || v_prob, ''Collegamenti: tutto a posto.'')', '');
    execute v;
  end if;
end $$;

delete from messages where testo like '⚠️ Problema ai collegamenti%';
