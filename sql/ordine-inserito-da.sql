-- ════════════════════════════════════════════════════════
-- T&C Factory — Chi ha inserito l'ordine
-- Il database scrive in automatico l'utente collegato quando l'ordine
-- viene creato; il valore non si può impostare né cambiare dal browser.
-- Per gli ordini già presenti l'autore viene recuperato dal registro
-- modifiche ("Ordine creato"), dove disponibile.
-- Richiede sicurezza-1-prepara.sql. Non distruttivo, si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table orders add column if not exists created_by text;

create or replace function orders_set_created_by() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- Utente collegato; resta il valore fornito solo per inserimenti di servizio
    new.created_by := coalesce(app_nickname(), new.created_by);
  else
    new.created_by := old.created_by;   -- immutabile
  end if;
  return new;
end;
$$;

drop trigger if exists orders_created_by on orders;
create trigger orders_created_by
  before insert or update on orders
  for each row execute function orders_set_created_by();

-- Ordini già presenti: autore dalla voce "Ordine creato" del registro registrata
-- entro un minuto dalla creazione dell'ordine. Il solo codice non basta: alcuni
-- codici (es. ORD-0181) sono stati riusati dopo che l'ordine originale era
-- stato eliminato, e la prima voce col quel codice appartiene a un altro ordine.
alter table orders disable trigger orders_created_by;
update orders o
   set created_by = (
     select l.user_nickname
       from activity_log l
      where l.order_id = o.id
        and l.action = 'Ordine creato'
        and abs(extract(epoch from l.created_at - o.created_at)) <= 60
      order by abs(extract(epoch from l.created_at - o.created_at))
      limit 1
   )
 where true;
alter table orders enable trigger orders_created_by;
