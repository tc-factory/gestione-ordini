-- ════════════════════════════════════════════════════════
-- T&C Factory — Presenze: senza una rete del lavoro registrata la regola non scatta (2026-11-17)
-- Senza reti nessuno può confermare: nessuno è "non confermato", niente popup, i task restano.
-- tc_presenze_stato dice anche se c'è almeno una rete (reti). Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_presenza_mancante(p_chi text, p_giorno date)
returns boolean stable language sql security definer set search_path = public as $$
  select p_giorno = tc_oggi()
     and exists (select 1 from presenze_reti)
     and exists (select 1 from task_operatori o where o.nickname = p_chi and o.ora_inizio is not null
                    and (now() at time zone 'Europe/Rome')::time > (o.ora_inizio + interval '30 minutes')::time)
     and not exists (select 1 from presenze p where p.nickname = p_chi and p.giorno = p_giorno);
$$;
revoke execute on function _tc_presenza_mancante(text, date) from public, anon, authenticated;

create or replace function tc_presenze_stato()
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_ora time := (now() at time zone 'Europe/Rome')::time; v_add boolean := _tc_addetto_presenze();
        v_reti boolean := exists (select 1 from presenze_reti);
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  return jsonb_build_object('success', true, 'in_rete', _tc_in_rete_lavoro(), 'reti', v_reti, 'addetto', v_add, 'ora', to_char(v_ora, 'HH24:MI'),
    'me', (select jsonb_build_object('ora_inizio', to_char(a.ora_inizio, 'HH24:MI'), 'scaduto', v_reti and v_ora > a.limite,
                                     'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da)
             from _tc_presenze_attese() a left join presenze p on p.nickname = a.nickname and p.giorno = tc_oggi()
            where a.nickname = v_me),
    'tutti', case when v_add and tc_giorno_lavorativo(tc_oggi()) then coalesce((
      select jsonb_agg(jsonb_build_object('nickname', o.nickname, 'ora_inizio', to_char(o.ora_inizio, 'HH24:MI'),
                                          'assente', tc_assente(o.nickname, tc_oggi()),
                                          'scaduto', v_reti and v_ora > (o.ora_inizio + interval '30 minutes')::time,
                                          'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da)
                       order by o.ora_inizio, o.nickname)
        from task_operatori o left join presenze p on p.nickname = o.nickname and p.giorno = tc_oggi()
       where o.ora_inizio is not null and o.nickname <> 'claude' and o.attivo), '[]'::jsonb) end);
end;
$$;
revoke execute on function tc_presenze_stato() from public, anon;
grant execute on function tc_presenze_stato() to authenticated;
