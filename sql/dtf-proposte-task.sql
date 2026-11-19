-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF: ogni proposta degli ordini nuovi è anche un task (coda DTF del Centro di controllo)
-- "Approvare DTF proposto: <ordine>" nasce quando il Mac mini salva una proposta e si chiude da solo
-- quando la proposta viene approvata o rifiutata (in DTF interno o dal task). Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_dtf_proposta_task()
returns trigger security definer set search_path = public language plpgsql as $$
declare o record;
begin
  if new.esito = 'proposta' then
    if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'dtf' = 'proposta:' || new.order_id
                    and stato not in ('completato', 'non_completato')) then
      select id, nome into o from orders where id = new.order_id;
      insert into tasks (tipo_id, titolo, descrizione, priorita, fonte, fonte_rif, riferimento, minuti_stimati, creato_da)
      values ((select id from task_tipi where nome = 'Stampa DTF' limit 1),
        left('Approvare DTF proposto: ' || coalesce(o.nome, new.order_id), 200),
        'Il Mac mini ha trovato ' || new.files || ' file in DATI/' || coalesce(new.sorgente, '') || '. '
          || 'Controlla file e pezzi e approva (il Mac mini li copia in 1. Stampare) oppure rifiuta.',
        'alta', 'automazione', jsonb_build_object('dtf', 'proposta:' || new.order_id, 'ordine', new.order_id),
        jsonb_build_object('tipo', 'ordine', 'id', new.order_id, 'label', coalesce(o.nome, new.order_id)), 3, 'automazione');
    end if;
  else
    update tasks set stato = 'completato', completato_at = now()
     where fonte = 'automazione' and fonte_rif->>'dtf' = 'proposta:' || new.order_id and stato not in ('completato', 'non_completato');
  end if;
  return new;
end;
$$;

drop trigger if exists dtf_proposta_task on dtf_preparati;
create trigger dtf_proposta_task after insert or update of esito on dtf_preparati
  for each row execute function _tc_dtf_proposta_task();

-- Le proposte già in attesa
update dtf_preparati set esito = esito where esito = 'proposta';
