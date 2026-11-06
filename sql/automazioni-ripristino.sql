-- ════════════════════════════════════════════════════════
-- T&C Factory — Ritorno a claude quando l'automazione torna operativa
--
-- Il segnale è la chiusura del task "Verificare automazione" con Fatto:
--   • i task di quella competenza non ancora iniziati tornano a claude, anche quelli in coda comune
--   • quelli che una persona ha già iniziato restano a lei
-- Finché la verifica è aperta i task nuovi di quella competenza saltano claude:
-- vanno al secondario o restano in coda, e al ripristino tornano anche loro.
--
-- Richiede automazioni.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_task_assegna(p_id uuid, p_oggi date)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  t record; v_primario text; v_chi text; v_ferma boolean;
  v_feriale boolean := extract(isodow from p_oggi) < 6 and not tc_festivo(p_oggi);
begin
  select coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario, k.automazione_errore errore, r.voce into t
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili r on r.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;

  -- Automazione non riuscita su questo task, o in verifica: claude si salta
  v_ferma := t.primario = 'claude' and (t.errore is not null or exists (
    select 1 from tasks v where v.fonte = 'automazione' and v.fonte_rif->>'voce' = t.voce
       and v.stato not in ('completato', 'non_completato')));
  v_primario := case when v_ferma then null else t.primario end;

  -- Giorno non lavorativo: si muovono solo i task affidati a claude
  if not v_feriale and v_primario is distinct from 'claude' then return false; end if;

  v_chi := case when tc_disponibile(v_primario, p_oggi) then v_primario
                when tc_disponibile(t.secondario, p_oggi) then t.secondario end;
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

create or replace function _tc_automazione_fallita(p_id uuid, p_motivo text, p_oggi date default tc_oggi())
returns void security definer set search_path = public language plpgsql as $$
declare
  t record; v_riga text; v_verifica uuid; v_motivo text := left(coalesce(nullif(trim(p_motivo), ''), 'Motivo non indicato'), 500);
begin
  select k.id, k.titolo, k.macroarea, p.nome tipo, coalesce(p.area, k.macroarea, 'produzione') || ':' || coalesce(p.competenza, '') voce into t
    from tasks k left join task_tipi p on p.id = k.tipo_id
   where k.id = p_id and k.stato not in ('completato', 'non_completato');
  if not found then return; end if;

  update tasks set automazione_errore = v_motivo, assegnato_a = null, stato = 'da_fare' where id = p_id;
  perform _tc_task_assegna(p_id, p_oggi);

  v_riga := t.titolo || ': ' || v_motivo;
  select id into v_verifica from tasks
   where fonte = 'automazione' and fonte_rif->>'voce' = t.voce and stato not in ('completato', 'non_completato')
   limit 1;
  if v_verifica is not null then
    update tasks set descrizione = left(descrizione || E'\n' || v_riga, 5000) where id = v_verifica;
  else
    insert into tasks (tipo_id, titolo, descrizione, priorita, giorno, fonte, fonte_rif, creato_da)
    values ((select id from task_tipi where nome = 'Verificare automazione'),
            left('Verificare automazione: ' || coalesce((select nome from shopify_stores where id = t.macroarea), 'Linea produttiva')
                 || ' · ' || coalesce(t.tipo, 'senza tipo'), 200),
            left('Segna Fatto solo quando l''automazione funziona di nuovo: i task torneranno da soli a Claude.' || E'\n\n' || v_riga, 5000),
            'alta', p_oggi, 'automazione', jsonb_build_object('voce', t.voce), 'cervello')
    returning id into v_verifica;
    perform _tc_task_assegna(v_verifica, p_oggi);
  end if;
end;
$$;

-- Verifica chiusa: i task non ancora iniziati tornano a claude, se la competenza è ancora sua
create or replace function _tc_automazione_ripristina() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_oggi date := tc_oggi();
begin
  if not exists (select 1 from competenze_responsabili where voce = new.fonte_rif->>'voce' and primario = 'claude')
     or not tc_disponibile('claude', v_oggi) then
    return null;
  end if;
  update tasks k
     set assegnato_a = 'claude', automazione_errore = null, giorno = greatest(k.giorno, v_oggi)
    from task_tipi p
   where p.id = k.tipo_id
     and coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza = new.fonte_rif->>'voce'
     and k.automazione_errore is not null
     and k.stato in ('da_fare', 'rimandato');
  return null;
end;
$$;
revoke execute on function _tc_automazione_ripristina() from public, anon, authenticated;

drop trigger if exists tasks_automazione_ripristino on tasks;
create trigger tasks_automazione_ripristino after update of stato on tasks for each row
  when (new.fonte = 'automazione' and new.stato = 'completato' and old.stato is distinct from 'completato')
  execute function _tc_automazione_ripristina();

revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;
revoke execute on function _tc_automazione_fallita(uuid, text, date) from public, anon, authenticated;
grant execute on function _tc_automazione_fallita(uuid, text, date) to service_role;
