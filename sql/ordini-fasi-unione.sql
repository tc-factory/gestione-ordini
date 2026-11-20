-- ════════════════════════════════════════════════════════
-- T&C Factory — Fasi dell'ordine salvate una per una
--
-- Prima il gestionale riscriveva tutto `stages` dalla copia nel browser: se due persone
-- spuntavano fasi diverse dello stesso ordine nello stesso momento, vinceva l'ultima
-- e l'altra spunta spariva. Ora si mandano solo le fasi cambiate e il database le unisce
-- a quelle che ci sono in quel momento.
--
-- Gira con i permessi di chi chiama (security invoker): valgono le policy di orders.
-- ════════════════════════════════════════════════════════

create or replace function tc_ordine_fasi(p_id text, p_fasi jsonb, p_tolte text[] default '{}')
returns setof orders
language sql
security invoker
set search_path to 'public'
as $$
  update orders
     set stages = (coalesce(stages, '{}'::jsonb) - coalesce(p_tolte, '{}'::text[])) || coalesce(p_fasi, '{}'::jsonb)
   where id = p_id
  returning *;
$$;

revoke execute on function tc_ordine_fasi(text, jsonb, text[]) from public, anon;
grant  execute on function tc_ordine_fasi(text, jsonb, text[]) to authenticated;
