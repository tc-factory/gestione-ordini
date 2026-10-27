-- ════════════════════════════════════════════════════════
-- T&C Factory — Prodotti in comune con Kamon
-- Esegui in: Supabase → SQL Editor → New query. Si può rieseguire senza danni.
--
-- L'anagrafica prodotti è la stessa nei due gestionali: un prodotto creato o modificato in Kamon
-- arriva qui (kamon_upsert_product), e Kamon legge da qui quelli creati o modificati nel gestionale
-- (kamon_list_products). Niente foto: restano solo in Kamon.
-- Il prodotto si riconosce per id e, se non c'è, per codice (senza spazi, maiuscole/minuscole uguali).
-- Fornitore e categoria viaggiano per nome: se qui non ci sono vengono creati.
-- Richiede kamon-collegamento.sql (chiave segreta), fornitori.sql e prodotti-categorie.sql.
-- ════════════════════════════════════════════════════════

create or replace function kamon_codice(c text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(c, ''), '\s', '', 'g')) $$;

-- Prodotto da Kamon → qui. Restituisce l'id del prodotto nel gestionale.
-- p: { id, codice, descrizione, fornitore, categoria, colori, taglie, costo, prezzo, attivo }
-- costo e prezzo vuoti non cancellano quelli già presenti.
create or replace function kamon_upsert_product(p_key text, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_forn uuid; v_cat uuid;
  v_cod text := left(trim(coalesce(p->>'codice', '')), 60);
  v_forn_nome text := trim(coalesce(p->>'fornitore', ''));
  v_cat_nome text := trim(coalesce(p->>'categoria', ''));
begin
  if not kamon_check_key(p_key) then raise exception 'Chiave non valida' using errcode = '42501'; end if;
  if trim(coalesce(p->>'descrizione', '')) = '' then raise exception 'Prodotto senza descrizione'; end if;

  if v_forn_nome <> '' then
    select id into v_forn from suppliers where lower(nome) = lower(v_forn_nome);
    if v_forn is null then
      insert into suppliers (nome, created_by) values (v_forn_nome, 'Kamon') returning id into v_forn;
    end if;
  end if;
  if v_cat_nome <> '' then
    select id into v_cat from product_categories where lower(nome) = lower(v_cat_nome);
    if v_cat is null then
      insert into product_categories (nome) values (v_cat_nome) returning id into v_cat;
    end if;
  end if;

  if coalesce(p->>'id', '') ~ '^[0-9a-f-]{36}$' then
    select id into v_id from products where id = (p->>'id')::uuid;
  end if;
  if v_id is null and v_cod <> '' then
    select id into v_id from products where kamon_codice(codice) = kamon_codice(v_cod) limit 1;
  end if;

  if v_id is null then
    insert into products (id, codice, descrizione, fornitore_id, categoria_id, colori, taglie, costo, prezzo, attivo, created_by)
    values (coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), v_cod, left(trim(p->>'descrizione'), 200), v_forn, v_cat,
            left(coalesce(p->>'colori', ''), 2000), left(coalesce(p->>'taglie', ''), 300),
            nullif(p->>'costo', '')::numeric, nullif(p->>'prezzo', '')::numeric, coalesce((p->>'attivo')::boolean, true), 'Kamon')
    returning id into v_id;
  else
    update products set
      codice = v_cod, descrizione = left(trim(p->>'descrizione'), 200),
      fornitore_id = coalesce(v_forn, fornitore_id), categoria_id = coalesce(v_cat, categoria_id),
      colori = left(coalesce(p->>'colori', ''), 2000), taglie = left(coalesce(p->>'taglie', ''), 300),
      costo = coalesce(nullif(p->>'costo', '')::numeric, costo), prezzo = coalesce(nullif(p->>'prezzo', '')::numeric, prezzo),
      attivo = coalesce((p->>'attivo')::boolean, attivo), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

-- Prodotti creati o modificati qui dopo p_dal (null = tutti), per Kamon.
create or replace function kamon_list_products(p_key text, p_dal timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not kamon_check_key(p_key) then raise exception 'Chiave non valida' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'codice', pr.codice, 'descrizione', pr.descrizione, 'fornitore', coalesce(s.nome, ''), 'categoria', coalesce(c.nome, ''),
      'colori', pr.colori, 'taglie', pr.taglie, 'costo', pr.costo, 'prezzo', pr.prezzo, 'attivo', pr.attivo,
      'created_at', pr.created_at, 'updated_at', pr.updated_at) order by pr.updated_at)
    from products pr
    left join suppliers s on s.id = pr.fornitore_id
    left join product_categories c on c.id = pr.categoria_id
    where p_dal is null or pr.updated_at > p_dal), '[]'::jsonb);
end $$;

revoke all on function kamon_upsert_product(text, jsonb) from public;
revoke all on function kamon_list_products(text, timestamptz) from public;
grant execute on function kamon_upsert_product(text, jsonb) to anon, authenticated;
grant execute on function kamon_list_products(text, timestamptz) to anon, authenticated;
