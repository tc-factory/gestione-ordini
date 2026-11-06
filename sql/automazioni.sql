-- ════════════════════════════════════════════════════════
-- T&C Factory — Automazioni (Centro di controllo → Competenze)
--
-- Una competenza è un'automazione quando il suo primario è claude.
-- Se l'automazione non funziona (_tc_automazione_fallita):
--   • il task passa al secondario; se non c'è, resta in coda comune
--   • nasce un task "Verificare automazione" nell'area Automazioni, uno solo aperto per competenza:
--     le altre mancate riuscite si aggiungono alla sua descrizione
-- Un'automazione segnala il problema chiamando _tc_automazione_fallita. Se invece si ferma senza dire
-- nulla, ci pensa il piano del mattino: i task di claude rimasti aperti dal giorno prima contano come non riusciti.
--
-- Richiede competenze-responsabili.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table tasks add column if not exists automazione_errore text check (length(automazione_errore) <= 500);
alter table task_tipi add column if not exists area text;   -- area fissa del tipo; se vuota vale quella del task

insert into task_tipi (nome, minuti_standard, autonomia, competenza, area, descrizione)
values ('Verificare automazione', 30, 'solo_task', 'verifica', 'automazioni', 'Un''automazione non ha funzionato: capire perché e sistemarla')
on conflict (nome) do update set competenza = excluded.competenza, area = excluded.area;

-- claude solo come primario, e non verifica sé stesso
alter table competenze_responsabili drop constraint if exists responsabili_claude_check;
alter table competenze_responsabili add constraint responsabili_claude_check check (
  secondario is distinct from 'claude' and not (voce like 'automazioni:%' and primario is not distinct from 'claude'));

-- Sceglie chi riceve un task e glielo assegna; false se resta in coda comune
create or replace function _tc_task_assegna(p_id uuid, p_oggi date)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  t record; v_primario text; v_chi text;
  v_feriale boolean := extract(isodow from p_oggi) < 6 and not tc_festivo(p_oggi);
begin
  select coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario, k.automazione_errore errore into t
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili r on r.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;

  -- Un task che l'automazione non è riuscita a fare non torna a claude
  v_primario := case when t.errore is not null and t.primario = 'claude' then null else t.primario end;

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

  update tasks set assegnato_a = v_chi, giorno = p_oggi where id = p_id;
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
            left(v_riga, 5000), 'alta', p_oggi, 'automazione', jsonb_build_object('voce', t.voce), 'cervello')
    returning id into v_verifica;
    perform _tc_task_assegna(v_verifica, p_oggi);
  end if;
end;
$$;

create or replace function _tc_task_piano_del(p_oggi date)
returns int security definer set search_path = public language plpgsql as $$
declare
  t record; n int := 0;
  v_feriale boolean := extract(isodow from p_oggi) < 6 and not tc_festivo(p_oggi);
begin
  -- Automazioni ferme: quello che claude ha lasciato aperto dal giorno prima
  for t in
    select id from tasks
     where assegnato_a = 'claude' and giorno < p_oggi and stato not in ('completato', 'non_completato')
  loop
    perform _tc_automazione_fallita(t.id, 'Non completato entro la giornata', p_oggi);
  end loop;

  -- Nei giorni lavorativi i task di chi è assente tornano in coda e seguono le regole qui sotto
  if v_feriale then
    update tasks set assegnato_a = null
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= p_oggi
       and tc_assente(assegnato_a, p_oggi);
  end if;

  for t in
    select k.id from tasks k
     where k.assegnato_a is null and k.stato in ('da_fare', 'rimandato', 'in_pausa') and k.giorno <= p_oggi
     order by array_position(array['urgente', 'alta', 'normale', 'bassa'], k.priorita), k.scadenza nulls last, k.created_at
  loop
    if _tc_task_assegna(t.id, p_oggi) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;
revoke execute on function _tc_automazione_fallita(uuid, text, date) from public, anon, authenticated;
grant execute on function _tc_automazione_fallita(uuid, text, date) to service_role;   -- la chiamano le edge function
revoke execute on function _tc_task_piano_del(date) from public, anon, authenticated;
