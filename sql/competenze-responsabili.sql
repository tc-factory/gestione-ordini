-- ════════════════════════════════════════════════════════
-- T&C Factory — Primario e secondario di ogni competenza (Centro di controllo → Competenze)
--
-- Ogni voce "area:competenza" ha un primario e un secondario. Il piano del giorno:
--   • dà il task al primario; se non c'è, al secondario; se manca anche lui, resta in coda comune
--   • "non c'è" = fuori dal piano, oppure in ferie o a un evento nel calendario (calendar_events)
--   • claude lavora tutti i giorni, gli altri solo lun-ven esclusi i festivi
--   • nei giorni non lavorativi passano solo i task che hanno claude come primario
--   • se qualcuno è assente, i suoi task non iniziati o in pausa tornano in coda e vengono ridistribuiti
--     (quelli in lavorazione restano a lui: hanno il cronometro acceso)
--   • chi è presente ma ha finito i minuti non passa i task al secondario: restano in coda comune
--
-- Sostituisce task_operatori.competenze, che non viene più usata.
-- Richiede competenze.sql e giorni-lavorativi.sql già eseguiti. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists competenze_responsabili (
  voce       text primary key,   -- "area:competenza", es. "bienjugado:email"
  primario   text references app_users(nickname) on delete set null on update cascade,
  secondario text references app_users(nickname) on delete set null on update cascade,
  check (primario is distinct from secondario or primario is null)
);
alter table competenze_responsabili enable row level security;
drop policy if exists "Admin gestisce responsabili" on competenze_responsabili;
create policy "Admin gestisce responsabili" on competenze_responsabili for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on competenze_responsabili from anon, authenticated;
grant select, insert, update, delete on competenze_responsabili to authenticated;

-- Tutti nel piano del giorno, salvo chi viene tolto a mano in seguito
alter table task_operatori alter column attivo set default true;
do $$
begin
  if not exists (select 1 from competenze_responsabili) then   -- solo al primo passaggio: non annulla scelte fatte dopo
    insert into task_operatori (nickname, attivo)
      select nickname, true from app_users where not is_admin
      on conflict (nickname) do update set attivo = true;
  end if;
end $$;

-- Assente nel calendario: ferie o evento (le scadenze non sono assenze)
create or replace function tc_assente(p_chi text, p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from calendar_events e
                  where e.event_type in ('ferie', 'impegno')
                    and p_giorno between e.date_from and e.date_to
                    and p_chi = any(e.user_ids));
$$;

-- Può ricevere task in quel giorno. Senza riga in task_operatori si è nel piano (utente nuovo)
create or replace function tc_disponibile(p_chi text, p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_chi is not null
     and coalesce((select attivo from task_operatori where nickname = p_chi), true)
     and (p_chi = 'claude'
          or (extract(isodow from p_giorno) < 6 and not tc_festivo(p_giorno) and not tc_assente(p_chi, p_giorno)));
$$;

create or replace function _tc_task_piano_del(p_oggi date)
returns int security definer set search_path = public language plpgsql as $$
declare
  t record; v_chi text; n int := 0;
  v_feriale boolean := extract(isodow from p_oggi) < 6 and not tc_festivo(p_oggi);
begin
  -- Nei giorni lavorativi i task di chi è assente tornano in coda e seguono le regole qui sotto
  if v_feriale then
    update tasks set assegnato_a = null
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= p_oggi
       and tc_assente(assegnato_a, p_oggi);
  end if;

  for t in
    select k.id, coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario
      from tasks k
      left join task_tipi p on p.id = k.tipo_id
      left join competenze_responsabili r on r.voce = coalesce(k.macroarea, 'produzione') || ':' || p.competenza
     where k.assegnato_a is null and k.stato in ('da_fare', 'rimandato', 'in_pausa') and k.giorno <= p_oggi
     order by array_position(array['urgente', 'alta', 'normale', 'bassa'], k.priorita), k.scadenza nulls last, k.created_at
  loop
    -- Giorno non lavorativo: si muovono solo i task affidati a claude
    continue when not v_feriale and t.primario is distinct from 'claude';

    v_chi := case when tc_disponibile(t.primario, p_oggi) then t.primario
                  when tc_disponibile(t.secondario, p_oggi) then t.secondario end;
    continue when v_chi is null;

    -- claude non ha un limite di minuti
    continue when v_chi <> 'claude' and (
      select coalesce(sum(x.minuti_stimati), 0) from tasks x
       where x.assegnato_a = v_chi and x.giorno <= p_oggi
         and x.stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato')
    ) + t.minuti > coalesce((select minuti_giorno from task_operatori where nickname = v_chi), 420);

    update tasks set assegnato_a = v_chi, giorno = p_oggi where id = t.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function _tc_task_piano()
returns int security definer set search_path = public language sql as $$
  select _tc_task_piano_del(tc_oggi());
$$;

revoke execute on function tc_assente(text, date) from public, anon, authenticated;
revoke execute on function tc_disponibile(text, date) from public, anon, authenticated;
revoke execute on function _tc_task_piano_del(date) from public, anon, authenticated;
revoke execute on function _tc_task_piano() from public, anon, authenticated;

-- Il piano gira ogni mattina, anche sabato, domenica e festivi per i task di claude
select cron.schedule('task-piano', '30 6 * * *', 'select _tc_task_piano()');
