-- ════════════════════════════════════════════════════════
-- T&C Factory — Delega di un task
--
-- Chi ha il task in carico (o l'admin) può passarlo a un collega, anche i task della coda comune.
-- Non si delega a claude, a un admin o a chi oggi non c'è.
-- Un task in lavorazione va in pausa, così il cronometro non continua a nome di un altro.
-- Chi riceve vede da chi arriva e l'eventuale nota; il passaggio resta nell'attività del task.
--
-- Richiede competenze-responsabili.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table tasks add column if not exists delega jsonb;   -- ultima delega: { da, nota, at }

create or replace function tc_task_delega(p_id uuid, p_a text, p_nota text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare
  v_me text := app_nickname(); t tasks; v_nota text := left(nullif(trim(p_nota), ''), 300);
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  select * into t from tasks where id = p_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Task non trovato'); end if;
  if not app_is_admin() and t.assegnato_a is not null and t.assegnato_a <> v_me then
    return jsonb_build_object('success', false, 'error', 'Il task è assegnato a ' || t.assegnato_a);
  end if;
  if t.stato in ('completato', 'non_completato') then
    return jsonb_build_object('success', false, 'error', 'Il task è già chiuso');
  end if;
  if p_a is null or p_a is not distinct from t.assegnato_a or p_a = v_me then
    return jsonb_build_object('success', false, 'error', 'Scegli un collega');
  end if;
  if p_a = 'claude' or not exists (select 1 from app_users where nickname = p_a and not is_admin) then
    return jsonb_build_object('success', false, 'error', 'A questa persona non si può delegare');
  end if;
  if not tc_disponibile(p_a, tc_oggi()) then
    return jsonb_build_object('success', false, 'error', p_a || ' oggi non c''è');
  end if;

  update tasks
     set assegnato_a = p_a,
         stato = case when stato = 'in_lavorazione' then 'in_pausa' else stato end,
         delega = jsonb_build_object('da', v_me, 'nota', v_nota, 'at', now())
   where id = p_id
   returning * into t;

  -- Lo stato non cambia, quindi il passaggio va scritto qui: è l'unica riga con da_stato = a_stato
  insert into task_storico (task_id, da_stato, a_stato, utente, motivo)
  values (p_id, t.stato, t.stato, v_me, 'A ' || p_a || coalesce(': ' || v_nota, ''));

  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_task_delega(uuid, text, text) from public, anon;
grant execute on function tc_task_delega(uuid, text, text) to authenticated;
