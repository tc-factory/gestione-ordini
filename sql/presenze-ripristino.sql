-- ════════════════════════════════════════════════════════
-- T&C Factory — Presenze: chi torna presente riprende i suoi task (2026-11-17)
--
-- Quando i task di chi è assente o non ha confermato vanno in coda comune, in tasks.tolto_a
-- resta a chi erano. Se la persona viene poi segnata presente (o torna "da confermare"),
-- i task ancora in coda tornano a lei. Ordine del team in Tasks: app_settings.team_ordine.
-- Richiede sql/presenze*.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table tasks add column if not exists tolto_a text;

-- Assegnato a qualcuno: suggerimento e "tolto a" non servono più
create or replace function _tc_task_suggerito_pulisci()
returns trigger language plpgsql as $$
begin
  if new.assegnato_a is not null then new.suggerito := null; new.tolto_a := null; end if;
  return new;
end;
$$;
drop trigger if exists tasks_suggerito_pulisci on tasks;
create trigger tasks_suggerito_pulisci before insert or update of assegnato_a, suggerito, tolto_a on tasks
  for each row execute function _tc_task_suggerito_pulisci();

create or replace function _tc_presenze_controllo()
returns int security definer set search_path = public language plpgsql as $$
declare k record; n int := 0;
begin
  if not tc_giorno_lavorativo(tc_oggi()) then return 0; end if;
  for k in
    select id, assegnato_a from tasks
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= tc_oggi()
       and (tc_assente(assegnato_a, tc_oggi()) or _tc_presenza_mancante(assegnato_a, tc_oggi()))
  loop
    update tasks set assegnato_a = null where id = k.id;
    update tasks set tolto_a = k.assegnato_a where id = k.id;
    perform _tc_task_suggerisci(k.id, k.assegnato_a);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function _tc_presenze_controllo() from public, anon, authenticated;

-- I task tolti a una persona e ancora in coda tornano a lei
create or replace function _tc_presenze_restituisci(p_chi text)
returns int security definer set search_path = public language plpgsql as $$
declare n int;
begin
  update tasks set assegnato_a = p_chi
   where tolto_a = p_chi and assegnato_a is null and stato not in ('completato', 'non_completato');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function _tc_presenze_restituisci(text) from public, anon, authenticated;

create or replace function tc_presenza_conferma(p_chi text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_chi text := coalesce(nullif(trim(p_chi), ''), app_nickname());
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  if v_chi <> v_me and not _tc_addetto_presenze() then
    return jsonb_build_object('success', false, 'error', 'Solo gli addetti confermano la presenza degli altri');
  end if;
  if not _tc_in_rete_lavoro() then
    return jsonb_build_object('success', false, 'error', 'La presenza si conferma solo da un dispositivo collegato alla rete del posto di lavoro');
  end if;
  if not exists (select 1 from app_users where nickname = v_chi) then
    return jsonb_build_object('success', false, 'error', 'Persona non trovata');
  end if;
  insert into presenze (nickname, giorno, confermato_da, ip) values (v_chi, tc_oggi(), v_me, host(_tc_ip()))
  on conflict (nickname, giorno) do nothing;
  return jsonb_build_object('success', true, 'restituiti', _tc_presenze_restituisci(v_chi));
end;
$$;

create or replace function tc_presenza_imposta(p_chi text, p_stato text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_n int := 0;
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
  if p_stato = 'assente' then perform _tc_presenze_controllo();
  elsif not _tc_presenza_mancante(p_chi, tc_oggi()) then v_n := _tc_presenze_restituisci(p_chi);
  end if;
  return jsonb_build_object('success', true, 'restituiti', v_n);
end;
$$;
revoke execute on function tc_presenza_conferma(text) from public, anon;
revoke execute on function tc_presenza_imposta(text, text) from public, anon;
grant execute on function tc_presenza_conferma(text) to authenticated;
grant execute on function tc_presenza_imposta(text, text) to authenticated;

insert into app_settings (key, value) values ('team_ordine', '[]') on conflict (key) do nothing;
