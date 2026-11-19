-- Protezione del modulo d'ordine (2026-11-19).
-- Un browser con la cache senza modulo (realtime che non manda le colonne grandi invariate) riscriveva
-- l'ordine col modulo vuoto. Se un aggiornamento porta il modulo da righe presenti a nessuna riga,
-- si tiene quello che c'era.
create or replace function orders_tieni_modulo() returns trigger language plpgsql as $$
begin
  if jsonb_array_length(coalesce(old.order_module->'rows', '[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(new.order_module->'rows', '[]'::jsonb)) = 0 then
    new.order_module := old.order_module;
  end if;
  return new;
end $$;
drop trigger if exists orders_tieni_modulo on orders;
create trigger orders_tieni_modulo before update of order_module on orders
  for each row execute function orders_tieni_modulo();
