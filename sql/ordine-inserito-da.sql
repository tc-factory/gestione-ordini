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

-- Ordini già presenti: autore dal registro modifiche (la voce più vecchia)
alter table orders disable trigger orders_created_by;
update orders o
   set created_by = l.user_nickname
  from (
    select distinct on (order_id) order_id, user_nickname
    from activity_log
    where action = 'Ordine creato' and order_id is not null
    order by order_id, created_at asc
  ) l
 where l.order_id = o.id and o.created_by is null;
alter table orders enable trigger orders_created_by;
