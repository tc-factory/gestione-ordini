-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF interno: la lista "Da stampare" calcolata dal database
-- Prima la scriveva il browser (app_settings 'dtf_lista'): una scheda rimasta aperta con dati vecchi
-- poteva toglierci gli ordini nuovi (19/11: FOURTEEN FITNESS, CLAUDE TEST, VALAX e MONZA nuovi
-- risultavano "cartelle senza ordine"). Ora la calcola _tc_dtf_lista() con le stesse regole di
-- dtfLists/dtfCoda in js/dtf.js:
--   • ordini non cancellati/archiviati/neutri, a lavorazione interna, con DTF (li-dtf) spuntato
--     o in una riga del modulo (non preventivo), DTF non fatto (dtfPronti) né giallo (mezzo:dtfPronti),
--     non tolti con la × (dtf_interno.removed);
--   • ordine: priorità data a mano (dtf_interno.order), poi scadenza (deadline o data ordine + giorni auto);
--   • cartelle senza ordine (ultimo esito del Mac mini) in cima o al loro posto; conto terzi per primo.
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
     where c->>'ordine' is null and c->>'ct' is null and coalesce((c->>'files')::int, 0) > 0
       and 'cartella:' || (c->>'nome') not in (select id from tolti where id is not null)
  ),
  ct as (
    select 'ct:' || (c->>'ct') id,
           jsonb_build_object('id', 'ct:' || (c->>'ct'), 'nome', c->>'nome', 'cartella', true, 'ct', true) riga,
           null::bigint r, true cartella, true ct, null::date scad, null::date data_ordine
      from stato, jsonb_array_elements(coalesce(stato.v->'cartelle', '[]'::jsonb)) c
     where c->>'ct' is not null and coalesce((c->>'files')::int, 0) > 0
  ),
  tutte as (select * from ordini union all select * from cartelle union all select * from ct)
  select coalesce(jsonb_agg(riga order by
           case when ct then -2 when r is not null then r when cartella then -1 else 9223372036854775000 end,
           ct desc, cartella desc, scad nulls last, data_ordine nulls last, id), '[]'::jsonb)
    from tutte;
$$;
revoke execute on function _tc_dtf_lista() from public, anon, authenticated;

-- Il Mac mini usa la lista del database
create or replace function tc_dtf_cartella_dati(p_chiave text)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
declare v_lista jsonb := _tc_dtf_lista();
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  return jsonb_build_object('success', true,
    'lista', v_lista,
    'richiesta', (select value from app_settings where key = 'dtf_numera_richiesta'),
    'roll_cm', (select value from app_settings where key = 'dtf_roll_cm'),
    'margin_cm', (select value from app_settings where key = 'dtf_margin_cm'),
    'ct_clienti', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome))
       from dtf_clients c where coalesce(c.drive_url, '') <> ''), '[]'::jsonb),
    'prepara_modo', coalesce((select value #>> '{}' from app_settings where key = 'dtf_prepara_modo'), 'prova'),
    'da_preparare', _tc_dtf_da_preparare(),
    'preparati', coalesce((select jsonb_object_agg(regexp_replace(p.cartella, '^.*/', ''), p.order_id)
       from dtf_preparati p where p.esito = 'copiato' and p.cartella is not null), '{}'::jsonb),
    'approvati', coalesce((select jsonb_agg(jsonb_build_object('id', p.order_id, 'nome', o.nome, 'files', p.approvati))
       from dtf_preparati p join orders o on o.id = p.order_id where p.esito = 'approvato' and o.deleted_at is null), '[]'::jsonb),
    'items', coalesce((select jsonb_object_agg(o.id, coalesce(o.dtf_items, '[]'::jsonb))
       from orders o where o.deleted_at is null
        and o.id in (select x->>'id' from jsonb_array_elements(v_lista) x)), '{}'::jsonb));
end;
$$;

-- Ordini da preparare: dalla lista del database
create or replace function _tc_dtf_da_preparare()
returns jsonb security definer set search_path = public language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'nome', o.nome, 'descr', coalesce(o.order_module->>'descrizione', ''),
    'cliente', nullif(trim(concat_ws(' ', nullif(c.ragione_sociale, ''), case when coalesce(c.ragione_sociale, '') = '' then concat_ws(' ', c.nome, c.cognome) end)), ''),
    'capi', (select coalesce(sum(case when (r->>'qnt') ~ '^\s*\d+\s*$' then (r->>'qnt')::int else 0 end), 0)
               from jsonb_array_elements(coalesce(o.order_module->'rows', '[]'::jsonb)) r
              where not coalesce((r->>'preventivo')::boolean, false))
  ) order by o.created_at), '[]'::jsonb)
  from orders o left join clients c on c.id = o.client_id
  where o.deleted_at is null
    and o.created_at >= coalesce((select (value #>> '{}')::timestamptz from app_settings where key = 'dtf_prepara_dal'), now())
    and o.id in (select x->>'id' from jsonb_array_elements(_tc_dtf_lista()) x)
    and not exists (select 1 from dtf_preparati p where p.order_id = o.id);
$$;
revoke execute on function _tc_dtf_da_preparare() from public, anon, authenticated;

-- Salvataggio file degli ordini: solo ordini della lista del database
create or replace function tc_dtf_cartella_salva(p_chiave text, p_ordini jsonb, p_stato jsonb)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_lista jsonb := _tc_dtf_lista(); x jsonb; n int := 0;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  for x in select * from jsonb_array_elements(coalesce(p_ordini, '[]'::jsonb)) loop
    if jsonb_typeof(x->'items') = 'array' and exists (select 1 from jsonb_array_elements(v_lista) l where l->>'id' = x->>'id') then
      update orders set dtf_items = x->'items', updated_at = now() where id = x->>'id' and deleted_at is null;
      n := n + 1;
    end if;
  end loop;
  insert into app_settings (key, value, updated_at) values ('dtf_cartella_stato', coalesce(p_stato, '{}'::jsonb), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform _tc_dtf_cartella_task(p_stato);
  return jsonb_build_object('success', true, 'ordini', n);
end;
$$;
