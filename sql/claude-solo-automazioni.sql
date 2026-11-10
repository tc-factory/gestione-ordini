-- ════════════════════════════════════════════════════════
-- T&C Factory — A claude solo i task che un'automazione esegue davvero (2026-11-10)
--
--   • task_tipi.automazione: quale automazione esegue i task di quel tipo (null = nessuna).
--     Oggi solo "Stampa DDT" (script del mattino). Le risposte automatiche "Stato ordine"
--     si chiudono da sole: i task che restano aperti hanno un dubbio e servono a una persona.
--   • Claude primario delle competenze con un'automazione (DDT, mail, post spedizione) in tutti
--     i negozi: chi era primario diventa secondario, quindi il lavoro a mano resta alla stessa persona.
--   • Competenza con claude primario e tipo senza automazione: il task va subito al secondario.
--     Prima finiva a claude, restava fermo e il giorno dopo apriva una verifica falsa.
--   • I task nuovi di una competenza con claude primario si assegnano appena creati,
--     senza aspettare il piano delle 6:30 (es. i lotti DDT nati durante il giorno).
--   • Pulizia: via le "automazioni non riuscite" sui tipi senza automazione e chiuse le verifiche nate così.
--
-- Si esegue dopo automazioni-registro.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_tipi add column if not exists automazione text;
update task_tipi set automazione = 'Script del mattino: DDT, tag e file di stampa' where nome = 'Stampa DDT';

-- Competenze con un'automazione: claude primario, la persona di prima passa a secondario
update competenze_responsabili set secondario = primario, primario = 'claude'
 where voce in ('asteroidi:email', 'asteroidi:post_spedizione', 'bienjugado:post_spedizione', 'boxfactorylab:post_spedizione')
   and primario <> 'claude';

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
revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;

-- Verifica chiusa: tornano a claude solo i task che un'automazione esegue
create or replace function _tc_automazione_ripristina() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from competenze_responsabili where voce = new.fonte_rif->>'voce' and primario = 'claude')
     or not coalesce((select attivo from task_operatori where nickname = 'claude'), true) then
    return null;
  end if;
  update tasks k
     set assegnato_a = 'claude', automazione_errore = null, giorno = greatest(k.giorno, tc_oggi())
    from task_tipi p
   where p.id = k.tipo_id and p.automazione is not null
     and coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza = new.fonte_rif->>'voce'
     and k.automazione_errore is not null
     and k.stato in ('da_fare', 'rimandato');
  return null;
end;
$$;
revoke execute on function _tc_automazione_ripristina() from public, anon, authenticated;

-- Task nuovo senza assegnatario in una competenza di claude: si assegna subito
create or replace function _tc_task_assegna_subito() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from task_tipi p
               join competenze_responsabili r on r.voce = coalesce(p.area, new.macroarea, 'produzione') || ':' || p.competenza
              where p.id = new.tipo_id and r.primario = 'claude') then
    perform _tc_task_assegna(new.id, tc_oggi());
  end if;
  return null;
end;
$$;
revoke execute on function _tc_task_assegna_subito() from public, anon, authenticated;

drop trigger if exists tasks_assegna_subito on tasks;
create trigger tasks_assegna_subito after insert on tasks for each row
  when (new.assegnato_a is null and new.stato = 'da_fare' and new.tipo_id is not null)
  execute function _tc_task_assegna_subito();

-- ── Pulizia ──

-- Tipi senza automazione: non sono automazioni non riuscite
update tasks k set automazione_errore = null
  from task_tipi p
 where p.id = k.tipo_id and p.automazione is null
   and k.automazione_errore is not null and k.stato not in ('completato', 'non_completato');

-- Task aperti rimasti a claude senza automazione: alla persona giusta, o in coda
do $$
declare t record;
begin
  for t in select k.id from tasks k join task_tipi p on p.id = k.tipo_id
            where k.assegnato_a = 'claude' and p.automazione is null
              and k.stato in ('da_fare', 'rimandato', 'in_pausa') loop
    update tasks set assegnato_a = null where id = t.id;
    perform _tc_task_assegna(t.id, tc_oggi());
  end loop;
end $$;

-- Verifiche aperte su competenze in cui nessun task ha un'automazione: erano falsi allarmi
update tasks v set stato = 'completato',
       descrizione = left(v.descrizione || E'\n\nChiusa il 10/11: i task elencati non hanno un''automazione, ora vanno direttamente alle persone.', 5000)
 where v.fonte = 'automazione' and v.stato not in ('completato', 'non_completato')
   and v.fonte_rif->>'voce' <> 'automazioni:mattino'
   and not exists (select 1 from task_tipi p
                    where p.automazione is not null and p.competenza = split_part(v.fonte_rif->>'voce', ':', 2));

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
