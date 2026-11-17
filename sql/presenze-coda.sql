-- ════════════════════════════════════════════════════════
-- T&C Factory — Chi non c'è o non conferma: task in coda comune col suggerimento (2026-11-17)
--
-- • Chi non ha confermato la presenza entro l'orario + 30 minuti non è disponibile per quel giorno.
-- • I task aperti di chi è assente (Planner) o non ha confermato tornano in coda comune
--   (controllo ogni 5 minuti) con tasks.suggerito = l'altra persona della competenza disponibile.
-- • Quando il primario non c'è, il task non va più da solo al secondario: resta in coda comune
--   col secondario suggerito. Resta automatico il passaggio al secondario quando il primario è claude
--   e l'automazione non c'è o è ferma.
-- Richiede sql/presenze.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table tasks add column if not exists suggerito text;

-- Assegnato a qualcuno: il suggerimento non serve più
create or replace function _tc_task_suggerito_pulisci()
returns trigger language plpgsql as $$
begin
  if new.assegnato_a is not null then new.suggerito := null; end if;
  return new;
end;
$$;
drop trigger if exists tasks_suggerito_pulisci on tasks;
create trigger tasks_suggerito_pulisci before insert or update of assegnato_a, suggerito on tasks
  for each row execute function _tc_task_suggerito_pulisci();

-- Non ha confermato la presenza e sono passati 30 minuti dall'orario di entrata
create or replace function _tc_presenza_mancante(p_chi text, p_giorno date)
returns boolean stable language sql security definer set search_path = public as $$
  select p_giorno = tc_oggi()
     and exists (select 1 from task_operatori o where o.nickname = p_chi and o.ora_inizio is not null
                    and (now() at time zone 'Europe/Rome')::time > (o.ora_inizio + interval '30 minutes')::time)
     and not exists (select 1 from presenze p where p.nickname = p_chi and p.giorno = p_giorno);
$$;

create or replace function tc_disponibile(p_chi text, p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_chi is not null
     and coalesce((select attivo from task_operatori where nickname = p_chi), true)
     and tc_giorno_lavorativo(p_giorno)
     and (p_chi = 'claude' or (not tc_assente(p_chi, p_giorno) and not _tc_presenza_mancante(p_chi, p_giorno)));
$$;

-- Chi deve confermare oggi (senza guardare la conferma, altrimenti chi manca sparirebbe dall'elenco)
create or replace function _tc_presenze_attese()
returns table (nickname text, ora_inizio time, limite time) stable language sql security definer set search_path = public as $$
  select o.nickname, o.ora_inizio, (o.ora_inizio + interval '30 minutes')::time
    from task_operatori o
   where o.ora_inizio is not null and o.nickname <> 'claude' and o.attivo
     and tc_giorno_lavorativo(tc_oggi()) and not tc_assente(o.nickname, tc_oggi());
$$;

-- Chi suggerire per un task: primario o secondario della competenza, disponibile, diverso da chi manca
create or replace function _tc_task_suggerisci(p_id uuid, p_escludi text default null)
returns text security definer set search_path = public language plpgsql as $$
declare r record; v text;
begin
  select c.primario, c.secondario into r
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili c on c.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;
  v := case when r.primario is distinct from p_escludi and r.primario <> 'claude' and tc_disponibile(r.primario, tc_oggi()) then r.primario
            when r.secondario is distinct from p_escludi and r.secondario <> 'claude' and tc_disponibile(r.secondario, tc_oggi()) then r.secondario end;
  update tasks set suggerito = v where id = p_id and assegnato_a is null;
  return v;
end;
$$;

create or replace function _tc_task_assegna(p_id uuid, p_oggi date)
returns boolean security definer set search_path = public language plpgsql as $$
declare t record; v_primario text; v_chi text; v_ferma boolean;
begin
  if not tc_giorno_lavorativo(p_oggi) then return false; end if;

  select coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario, k.automazione_errore errore, r.voce, p.automazione into t
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili r on r.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;

  -- Automazione non riuscita su questo task, o in verifica: claude si salta
  v_ferma := t.primario = 'claude' and t.automazione is not null and (t.errore is not null or exists (
    select 1 from tasks v where v.fonte = 'automazione' and v.fonte_rif->>'voce' = t.voce
       and v.stato not in ('completato', 'non_completato')));
  -- Tipo senza automazione: claude non lo saprebbe fare, va al secondario
  v_primario := case when t.primario = 'claude' and (t.automazione is null or v_ferma) then null else t.primario end;

  -- Il primario (una persona) non c'è: coda comune col secondario suggerito
  if v_primario is not null and v_primario <> 'claude' and not tc_disponibile(v_primario, p_oggi) then
    perform _tc_task_suggerisci(p_id, v_primario);
    return false;
  end if;

  v_chi := case when tc_disponibile(v_primario, p_oggi) then v_primario
                when v_primario is null and tc_disponibile(t.secondario, p_oggi) then t.secondario
                when tc_disponibile(t.secondario, p_oggi) and v_primario = 'claude' then t.secondario end;
  if v_chi is null then return false; end if;

  -- claude non ha un limite di minuti; chi ha finito i minuti non passa il task al secondario
  if v_chi <> 'claude' and (
       select coalesce(sum(x.minuti_stimati), 0) from tasks x
        where x.assegnato_a = v_chi and x.giorno <= p_oggi
          and x.stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato')
     ) + t.minuti > coalesce((select minuti_giorno from task_operatori where nickname = v_chi), 420) then
    return false;
  end if;

  update tasks set assegnato_a = v_chi, giorno = p_oggi,
         automazione_errore = case when v_ferma then coalesce(t.errore, 'Automazione in verifica') else automazione_errore end
   where id = p_id;
  return true;
end;
$$;

-- Ogni 5 minuti: i task di chi è assente o non ha confermato tornano in coda comune col suggerimento
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
    perform _tc_task_suggerisci(k.id, k.assegnato_a);
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function _tc_presenza_mancante(text, date) from public, anon, authenticated;
revoke execute on function _tc_task_suggerisci(uuid, text) from public, anon, authenticated;
revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;
revoke execute on function _tc_presenze_controllo() from public, anon, authenticated;
revoke execute on function _tc_presenze_attese() from public, anon, authenticated;
revoke execute on function tc_disponibile(text, date) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'presenze-controllo') then perform cron.unschedule('presenze-controllo'); end if;
  perform cron.schedule('presenze-controllo', '1-59/5 * * * *', 'select _tc_presenze_controllo()');
end $$;
