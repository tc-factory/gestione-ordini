-- ════════════════════════════════════════════════════════
-- T&C Factory — Collegamento con Kamon
-- Esegui in: Supabase → SQL Editor → New query. Si può rieseguire senza danni.
--
-- Kamon (la piattaforma dei cataloghi clienti) manda qui gli ordini che i clienti confermano
-- nell'app: diventano ordini normali del gestionale, con il modulo d'ordine compilato
-- (fornitore, codice, descrizione, colore, taglia, quantità, prezzo, per chi è il capo).
--
-- Kamon si presenta con una chiave segreta: qui ne è salvato solo l'hash (app_settings 'kamon_key_hash').
-- Le funzioni sono chiamabili senza login, ma senza la chiave giusta non fanno nulla.
-- Richiede clienti-setup.sql e sicurezza-1-prepara.sql.
-- ════════════════════════════════════════════════════════

create or replace function kamon_check_key(p_key text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare h text := (select value #>> '{}' from app_settings where key = 'kamon_key_hash');
begin
  if h is null or coalesce(p_key, '') = '' or h <> crypt(p_key, h) then
    perform pg_sleep(0.3);
    return false;
  end if;
  return true;
end $$;

-- Clienti del gestionale, per collegarli ai clienti di Kamon
create or replace function kamon_list_clients(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not kamon_check_key(p_key) then raise exception 'Chiave non valida' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id,
      'nome', coalesce(nullif(case when c.tipo = 'privato' then trim(c.nome || ' ' || c.cognome) else c.ragione_sociale end, ''), 'Senza nome'))
      order by lower(coalesce(nullif(c.ragione_sociale, ''), c.nome)))
    from clients c), '[]'::jsonb);
end $$;

-- Ordine da Kamon → ordine del gestionale. Reinviare lo stesso ordine non lo duplica.
-- p_ordine: { kamon_id, numero, nota, cliente_nome, cliente_rif, righe: [{ nome, descrizione, fornitore, codice, colore, taglia, qnt, prezzo, per }] }
create or replace function kamon_import_order(p_key text, p_ordine jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text; v_client uuid; v_rows jsonb; v_tot numeric; v_prio text; v_tags text[]; v_days int; v_tag text; v_nome text;
begin
  if not kamon_check_key(p_key) then raise exception 'Chiave non valida' using errcode = '42501'; end if;
  if coalesce(p_ordine->>'kamon_id', '') = '' then raise exception 'Ordine senza id'; end if;
  if jsonb_typeof(p_ordine->'righe') <> 'array' or jsonb_array_length(p_ordine->'righe') = 0 then raise exception 'Ordine vuoto'; end if;

  perform pg_advisory_xact_lock(hashtext('orders_id'));
  select id into v_id from orders where order_module->>'kamon_id' = p_ordine->>'kamon_id' limit 1;
  if v_id is not null then return v_id; end if;

  -- cliente: quello collegato in Kamon, altrimenti per nome
  if coalesce(p_ordine->>'cliente_rif', '') ~ '^[0-9a-f-]{36}$' then
    select id into v_client from clients where id = (p_ordine->>'cliente_rif')::uuid;
  end if;
  if v_client is null then
    select id into v_client from clients where lower(trim(ragione_sociale)) = lower(trim(p_ordine->>'cliente_nome')) limit 1;
  end if;
  v_nome := coalesce((select coalesce(nullif(case when tipo = 'privato' then trim(nome || ' ' || cognome) else ragione_sociale end, ''), 'Senza nome')
                        from clients where id = v_client), nullif(trim(p_ordine->>'cliente_nome'), ''), 'Kamon');

  select jsonb_agg(jsonb_build_object(
           'catalogo', coalesce(r->>'fornitore', ''), 'codice', coalesce(r->>'codice', ''),
           'descrizione', coalesce(nullif(r->>'descrizione', ''), r->>'nome', ''),
           'colore', coalesce(r->>'colore', ''), 'tg', coalesce(r->>'taglia', ''),
           'qnt', greatest(1, coalesce((r->>'qnt')::int, 1)), 'prezzo', coalesce((r->>'prezzo')::numeric, 0),
           'per', coalesce(r->>'per', ''),
           'productId', (select p.id from products p where p.codice <> '' and lower(p.codice) = lower(r->>'codice') limit 1),
           'ordinato', false, 'interna', '', 'esterna', '', 'lavEsterna', false, 'neutro', false) order by ord),
         sum(greatest(1, coalesce((r->>'qnt')::int, 1)) * coalesce((r->>'prezzo')::numeric, 0))
    into v_rows, v_tot
    from jsonb_array_elements(p_ordine->'righe') with ordinality as t(r, ord);

  -- stesse scelte del gestionale per un ordine nuovo
  select id into v_prio from priorities order by (id = 'normale') desc, sort_order limit 1;
  v_tag := (select value #>> '{}' from app_settings where key = 'kamon_tag');
  v_tags := case when v_tag is not null and exists (select 1 from tags where name = v_tag) then array[v_tag] else '{}' end;
  v_days := coalesce((select (value #>> '{}')::int from app_settings where key = 'auto_deadline_days'), 14);

  -- codice ordine a 5 cifre in sequenza, come TCFactory.generateId()
  select lpad((coalesce(max((regexp_match(id, '^(?:ORD-)?(\d+)$'))[1]::int), 0) + 1)::text, 5, '0') into v_id from orders;

  insert into orders (id, nome, data_ordine, deadline, notes, priority_id, tags, client_id, importo, created_by, stages, order_module)
  values (v_id, v_nome, current_date, current_date + v_days,
          left(trim('Kamon #' || coalesce(p_ordine->>'numero', '') || case when coalesce(p_ordine->>'nota', '') <> '' then ' — ' || (p_ordine->>'nota') else '' end), 2000),
          v_prio, v_tags, v_client, v_tot, 'Kamon',
          '{"merceCompleta":{"done":false},"dtfPronti":{"done":false},"ordineStampato":{"done":false},"speditoParzialmente":{"done":false},"spedito":{"done":false}}',
          jsonb_build_object('rows', v_rows, 'acconto', '', 'descrizione', 'Ordine Kamon #' || coalesce(p_ordine->>'numero', ''),
                             'origine', 'kamon', 'kamon_id', p_ordine->>'kamon_id'));

  insert into activity_log (user_nickname, action, order_id, order_name, details)
  values ('Kamon', 'Ordine creato', v_id, v_nome, jsonb_build_object('origine', 'kamon', 'kamon_numero', p_ordine->>'numero'));
  return v_id;
end $$;

revoke execute on function kamon_check_key(text) from public, anon, authenticated;
revoke execute on function kamon_list_clients(text), kamon_import_order(text, jsonb) from public;
grant  execute on function kamon_list_clients(text), kamon_import_order(text, jsonb) to anon, authenticated;

-- ════════════════════════════════════════════════════════
-- Chiave: la imposta chi configura il collegamento, con
--   insert into app_settings (key, value) values ('kamon_key_hash', to_jsonb(crypt('<chiave>', gen_salt('bf'))))
--   on conflict (key) do update set value = excluded.value;
-- e la stessa chiave va in Kamon → Impostazioni → Collegamento al gestionale.
-- ════════════════════════════════════════════════════════
