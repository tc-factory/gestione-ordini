-- ════════════════════════════════════════════════════════
-- T&C Factory — Ordine eliminato → i suoi task automatici si chiudono subito (2026-11-20)
-- Prima restavano aperti fino al giro successivo delle automazioni (Mac mini, rilevamento):
-- es. "Controllare se stampato: …" ancora in DTF stampa dopo aver eliminato l'ordine.
-- Solo i task creati dalle automazioni; quelli scritti a mano restano. Ripristinando l'ordine
-- le automazioni li ricreano se servono. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function orders_chiudi_task_eliminato() returns trigger
security definer set search_path = public language plpgsql as $$
begin
  update tasks set stato = 'completato', completato_at = now()
   where fonte = 'automazione' and stato not in ('completato', 'non_completato')
     and (fonte_rif->>'ordine' = new.id
          or (riferimento->>'tipo' = 'ordine' and riferimento->>'id' = new.id));
  return null;
end;
$$;

drop trigger if exists orders_chiudi_task_eliminato on orders;
create trigger orders_chiudi_task_eliminato after update of deleted_at on orders
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function orders_chiudi_task_eliminato();
