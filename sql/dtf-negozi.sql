-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF: lavorazioni per i negozi prima di tutto (2026-11-20)
-- File sciolti o cartelle in 1. Stampare col nome di un negozio ("ordine-bienjugado", "ordini-boxfactorylab",
-- "ordini-sito"…): il Mac mini li segna con 'negozio' (dtf_cartella.py, NEGOZI) e qui vanno in cima alla lista,
-- sopra anche il conto terzi; niente task "Cartella DTF senza ordine". Rifà _tc_dtf_lista di sql/dtf-lista.sql.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_dtf_lista()
returns jsonb security definer set search_path = public language sql stable as $$
  with s as (select coalesce((select value from app_settings where key = 'dtf_interno'), '{}'::jsonb) v),
  rk as (select x.id, x.n from s, jsonb_array_elements_text(coalesce(s.v->'order', '[]'::jsonb)) with ordinality x(id, n)),
  tolti as (select coalesce(r->>'id', r #>> '{}') id from s, jsonb_array_elements(coalesce(s.v->'removed', '[]'::jsonb)) r),
  giorni as (select coalesce((select (value #>> '{}')::int from app_settings where key = 'auto_deadline_days'), 14) n),
  stato as (select coalesce((select value from app_settings where key = 'dtf_cartella_stato'), '{}'::jsonb) v),
  ordini as (
    select o.id, jsonb_build_object('id', o.id, 'nome', o.nome, 'descr', coalesce(o.order_module->>'descrizione', '')) riga,
           (select n from rk where rk.id = o.id) r, false cartella, false ct,
           coalesce(o.deadline, o.data_ordine + (select n from giorni)) scad, o.data_ordine
      from orders o
     where o.deleted_at is null and not coalesce(o.archived, false)
       and not coalesce((o.order_module->>'neutro')::boolean, false)
       and case when jsonb_typeof(o.order_module->'interna') = 'boolean' then (o.order_module->>'interna')::boolean
                else not coalesce(o.lavorazione_esterna, false) end
       and (coalesce(o.order_module->'lavInterne', '[]'::jsonb) ? 'li-dtf'
            or exists (select 1 from jsonb_array_elements(coalesce(o.order_module->'rows', '[]'::jsonb)) w
                        where w->>'interna' = 'li-dtf' and not coalesce((w->>'preventivo')::boolean, false)))
       and not coalesce((o.stages->'dtfPronti'->>'done')::boolean, false)
       and coalesce(o.stages->'mezzo:dtfPronti', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb)
       and o.id not in (select id from tolti where id is not null)
  ),
  cartelle as (
    select 'cartella:' || (c->>'nome') id,
           jsonb_build_object('id', 'cartella:' || (c->>'nome'), 'nome', c->>'nome', 'cartella', true) riga,
           (select n from rk where rk.id = 'cartella:' || (c->>'nome')) r, true cartella, false ct, null::date scad, null::date data_ordine
      from stato, jsonb_array_elements(coalesce(stato.v->'cartelle', '[]'::jsonb)) c
     where c->>'ordine' is null and c->>'ct' is null and c->>'negozio' is null and coalesce((c->>'files')::int, 0) > 0
       and 'cartella:' || (c->>'nome') not in (select id from tolti where id is not null)
  ),
  ct as (
    select 'ct:' || (c->>'ct') id,
           jsonb_build_object('id', 'ct:' || (c->>'ct'), 'nome', c->>'nome', 'cartella', true, 'ct', true) riga,
           null::bigint r, true cartella, true ct, null::date scad, null::date data_ordine
      from stato, jsonb_array_elements(coalesce(stato.v->'cartelle', '[]'::jsonb)) c
     where c->>'ct' is not null and coalesce((c->>'files')::int, 0) > 0
  ),
  -- Lavorazioni per i negozi (file/cartelle "ordine-bienjugado", "ordini-sito"…): prima di tutto
  negozi as (
    select 'negozio:' || (c->>'nome') id,
           jsonb_build_object('id', 'negozio:' || (c->>'nome'), 'nome', c->>'nome', 'cartella', true, 'negozio', c->>'negozio') riga,
           null::bigint r, true cartella, false ct, null::date scad, null::date data_ordine
      from stato, jsonb_array_elements(coalesce(stato.v->'cartelle', '[]'::jsonb)) c
     where c->>'negozio' is not null and coalesce((c->>'files')::int, 0) > 0
  ),
  tutte as (select *, false neg from ordini union all select *, false from cartelle union all select *, false from ct
            union all select *, true from negozi)
  select coalesce(jsonb_agg(riga order by
           case when neg then -3 when ct then -2 when r is not null then r when cartella then -1 else 9223372036854775000 end,
           ct desc, cartella desc, scad nulls last, data_ordine nulls last, id), '[]'::jsonb)
    from tutte;
$$;
revoke execute on function _tc_dtf_lista() from public, anon, authenticated;
