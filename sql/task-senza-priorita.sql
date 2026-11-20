-- ════════════════════════════════════════════════════════
-- T&C Factory — Task senza priorità nell'assegnazione del mattino
--
-- Deciso da Riccardo il 2026-11-19: i task si ordinano solo per scadenza,
-- a parità per data di creazione. La priorità (urgente/alta/normale/bassa)
-- non decide più l'ordine in cui il piano del giorno assegna i task liberi.
-- Uguale alla versione di sql/automazione-mattino-esito.sql tranne l'ORDER BY.
-- ════════════════════════════════════════════════════════

create or replace function _tc_task_piano_del(p_oggi date)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare t record; n int := 0;
begin
  -- Giorno non lavorativo: nessun controllo e nessuna assegnazione, si riprende al rientro
  if not tc_giorno_lavorativo(p_oggi) then return 0; end if;

  -- Automazioni ferme: quello che claude ha lasciato aperto dal giorno prima
  for t in
    select id from tasks
     where assegnato_a = 'claude' and giorno < p_oggi and stato not in ('completato', 'non_completato')
  loop
    perform _tc_automazione_fallita(t.id, 'Non completato entro la giornata', p_oggi);
  end loop;

  -- I task di chi è assente tornano in coda e seguono le regole qui sotto
  update tasks set assegnato_a = null
   where assegnato_a is not null and assegnato_a <> 'claude'
     and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= p_oggi
     and tc_assente(assegnato_a, p_oggi);

  -- Prima la scadenza, a parità la data di creazione
  for t in
    select k.id from tasks k
     where k.assegnato_a is null and k.stato in ('da_fare', 'rimandato', 'in_pausa') and k.giorno <= p_oggi
     order by k.scadenza nulls last, k.created_at
  loop
    if _tc_task_assegna(t.id, p_oggi) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
