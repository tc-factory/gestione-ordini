-- ════════════════════════════════════════════════════════
-- T&C Factory — Presenze: si conferma anche l'assenza (2026-11-17)
-- presenze.stato: presente | assente. Un clic sul nome nel riquadro Presenze (Tasks):
-- grigio → presente (verde) → assente (rosso) → di nuovo da confermare (grigio).
-- Chi è segnato assente è subito non disponibile: i suoi task vanno in coda comune col suggerito.
-- Solo admin e addetti, dalla rete del posto di lavoro. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table presenze add column if not exists stato text not null default 'presente';
alter table presenze drop constraint if exists presenze_stato_check;
alter table presenze add constraint presenze_stato_check check (stato in ('presente', 'assente'));

create or replace function _tc_presenza_mancante(p_chi text, p_giorno date)
returns boolean stable language sql security definer set search_path = public as $$
  select p_giorno = tc_oggi() and (
    exists (select 1 from presenze p where p.nickname = p_chi and p.giorno = p_giorno and p.stato = 'assente')
    or (exists (select 1 from presenze_reti)
        and exists (select 1 from task_operatori o where o.nickname = p_chi and o.ora_inizio is not null
                       and (now() at time zone 'Europe/Rome')::time > (o.ora_inizio + interval '30 minutes')::time)
        and not exists (select 1 from presenze p where p.nickname = p_chi and p.giorno = p_giorno)));
$$;
revoke execute on function _tc_presenza_mancante(text, date) from public, anon, authenticated;

-- Imposta la presenza di oggi: 'presente', 'assente' o null (da confermare)
create or replace function tc_presenza_imposta(p_chi text, p_stato text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname();
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  if not _tc_addetto_presenze() then return jsonb_build_object('success', false, 'error', 'Solo gli addetti alle presenze'); end if;
  if not _tc_in_rete_lavoro() then
    return jsonb_build_object('success', false, 'error', 'La presenza si conferma solo da un dispositivo collegato alla rete del posto di lavoro');
  end if;
  if p_stato is null then
    delete from presenze where nickname = p_chi and giorno = tc_oggi();
  elsif p_stato in ('presente', 'assente') then
    insert into presenze (nickname, giorno, stato, confermato_da, ip) values (p_chi, tc_oggi(), p_stato, v_me, host(_tc_ip()))
    on conflict (nickname, giorno) do update set stato = excluded.stato, confermato_da = excluded.confermato_da,
                                                 confermato_at = now(), ip = excluded.ip;
  else
    return jsonb_build_object('success', false, 'error', 'Stato non valido');
  end if;
  if p_stato = 'assente' then perform _tc_presenze_controllo(); end if;
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_presenza_imposta(text, text) from public, anon;
grant execute on function tc_presenza_imposta(text, text) to authenticated;

create or replace function tc_presenze_stato()
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_ora time := (now() at time zone 'Europe/Rome')::time; v_add boolean := _tc_addetto_presenze();
        v_reti boolean := exists (select 1 from presenze_reti);
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  return jsonb_build_object('success', true, 'in_rete', _tc_in_rete_lavoro(), 'reti', v_reti, 'addetto', v_add, 'ora', to_char(v_ora, 'HH24:MI'),
    'me', (select jsonb_build_object('ora_inizio', to_char(a.ora_inizio, 'HH24:MI'), 'scaduto', v_reti and v_ora > a.limite,
                                     'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da, 'stato', p.stato)
             from _tc_presenze_attese() a left join presenze p on p.nickname = a.nickname and p.giorno = tc_oggi()
            where a.nickname = v_me),
    'tutti', case when v_add and tc_giorno_lavorativo(tc_oggi()) then coalesce((
      select jsonb_agg(jsonb_build_object('nickname', o.nickname, 'ora_inizio', to_char(o.ora_inizio, 'HH24:MI'),
                                          'assente', tc_assente(o.nickname, tc_oggi()),
                                          'scaduto', v_reti and v_ora > (o.ora_inizio + interval '30 minutes')::time,
                                          'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da, 'stato', p.stato)
                       order by o.nickname)
        from task_operatori o left join presenze p on p.nickname = o.nickname and p.giorno = tc_oggi()
       where o.ora_inizio is not null and o.nickname <> 'claude' and o.attivo), '[]'::jsonb) end);
end;
$$;
revoke execute on function tc_presenze_stato() from public, anon;
grant execute on function tc_presenze_stato() to authenticated;
