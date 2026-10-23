-- ════════════════════════════════════════════════════════
-- T&C Factory — Cataloghi dei clienti (app clienti)
-- Esegui in: Supabase → SQL Editor → New query
--
-- Tre livelli, un solo database:
--   • staff (gestionale): prodotti, catalogo di ogni cliente con il suo prezzo d'acquisto, accessi all'app
--   • cliente (app): rinomina i prodotti, decide il prezzo di rivendita e cosa mettere in vendita,
--     tiene il magazzino per taglia e colore, ordina a T&C dal carrello e ci integra
--     gli ordini dei suoi clienti
--   • cliente finale (app): si registra dal link di invito del cliente e ordina dal suo catalogo;
--     il magazzino del cliente scende da solo (a scorta finita l'ordine passa lo stesso)
--
-- Il cliente e il cliente finale non vedono mai fornitore, codice e costo:
-- leggono i prodotti solo tramite le funzioni catalog_* e shop_* qui sotto.
--
-- Script NON distruttivo: aggiunge tabelle e funzioni nuove.
-- Non tocca ordini, clienti e prodotti esistenti né le loro policy. Si può rieseguire.
-- Richiede sicurezza-2-blocca.sql (app_is_staff), clienti-setup.sql, prodotti-setup.sql,
-- prodotti-categorie.sql, prodotti-immagini.sql, fornitori.sql.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Funzioni di servizio
-- ─────────────────────────────────────────────

-- "Bianco, Nero, Navy" → {Bianco,Nero,Navy}, nell'ordine scritto (come modSplitList del gestionale)
create or replace function catalog_list(s text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by n), '{}')
    from (select trim(v) as x, n from unnest(string_to_array(coalesce(s, ''), ',')) with ordinality as t(v, n)) t
   where x <> ''
$$;

-- Colore e taglia devono essere tra quelli del prodotto ('' se il prodotto non ne ha)
create or replace function catalog_variant_ok(p products, p_colore text, p_taglia text) returns boolean
language sql immutable as $$
  select (case when cardinality(catalog_list(p.colori)) = 0 then coalesce(p_colore, '') = '' else p_colore = any(catalog_list(p.colori)) end)
     and (case when cardinality(catalog_list(p.taglie)) = 0 then coalesce(p_taglia, '') = '' else p_taglia = any(catalog_list(p.taglie)) end)
$$;

-- Nome del cliente come lo mostra il gestionale (TCFactory.clientName)
create or replace function catalog_client_name(c clients) returns text
language sql immutable as $$
  select coalesce(nullif(case when c.tipo = 'privato' then trim(c.nome || ' ' || c.cognome) else c.ragione_sociale end, ''),
                  nullif(c.ragione_sociale, ''), nullif(trim(c.nome || ' ' || c.cognome), ''), 'Senza nome')
$$;

-- ─────────────────────────────────────────────
-- 2. Accessi all'app
-- ─────────────────────────────────────────────

-- Clienti: account creati dallo staff (funzione catalog-users). Non sono staff: non vedono il gestionale.
create table if not exists catalog_users (
  auth_id     uuid primary key references auth.users(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  email       text not null default '',
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now()
);
create index if not exists catalog_users_client_idx on catalog_users(client_id);

create or replace function catalog_client_id() returns uuid
language sql stable security definer set search_path = public as $$
  select client_id from catalog_users where auth_id = auth.uid()
$$;

-- Negozio del cliente: nome mostrato ai clienti finali e codice del link di invito
create table if not exists catalog_shops (
  client_id   uuid primary key references clients(id) on delete cascade,
  nome        text not null default '',            -- vuoto = nome del cliente
  invito      text not null unique default encode(extensions.gen_random_bytes(9), 'hex'),
  attivo      boolean not null default true,       -- spento: nessuna registrazione né ordine nuovo
  updated_at  timestamptz not null default now()
);

-- Clienti finali: si registrano da soli dal link di invito (una persona può comprare da più clienti)
create table if not exists catalog_customers (
  auth_id     uuid not null references auth.users(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  nome        text not null,
  telefono    text not null default '',
  email       text not null default '',
  bloccato    boolean not null default false,      -- deciso dal cliente
  created_at  timestamptz not null default now(),
  primary key (auth_id, client_id)
);
create index if not exists catalog_customers_client_idx on catalog_customers(client_id);

create or replace function catalog_is_customer(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from catalog_customers where auth_id = auth.uid() and client_id = p_client and not bloccato)
$$;

-- ─────────────────────────────────────────────
-- 3. Catalogo di ogni cliente
--    Lo staff sceglie prodotti, nome e prezzo d'acquisto; il cliente può rinominarli,
--    decide prezzo di rivendita, cosa mettere in vendita e se tenere il magazzino.
-- ─────────────────────────────────────────────

create table if not exists client_catalog (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references clients(id) on delete cascade,
  product_id        uuid not null references products(id) on delete restrict,
  prezzo            numeric(10,2) check (prezzo >= 0),            -- staff: prezzo al cliente (vuoto = prezzo del prodotto)
  attivo            boolean not null default true,                -- staff: spento = il cliente non lo vede
  nome              text not null default '',                     -- staff: nome nel catalogo (vuoto = descrizione del prodotto)
  nome_cliente      text not null default '',                     -- cliente: rinomina (vuoto = nome dello staff)
  prezzo_rivendita  numeric(10,2) check (prezzo_rivendita >= 0),  -- cliente
  in_vendita        boolean not null default false,               -- cliente: visibile ai clienti finali
  scorte_attive     boolean not null default false,               -- cliente: tiene il magazzino
  ordine            int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (client_id, product_id),
  constraint client_catalog_vendita_con_prezzo check (not in_vendita or prezzo_rivendita is not null)
);
create index if not exists client_catalog_product_idx on client_catalog(product_id);

-- Dalla prima versione: il nome stava nei prodotti e "nome" del catalogo era quello del cliente
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_catalog' and column_name = 'nome_cliente') then
    alter table client_catalog rename column nome to nome_cliente;
    alter table client_catalog add column nome text not null default '';
  end if;
end $$;
alter table products drop column if exists nome;

-- Nome mostrato al cliente e ai suoi clienti
create or replace function catalog_item_name(cc client_catalog, p products) returns text
language sql immutable as $$
  select coalesce(nullif(trim(cc.nome_cliente), ''), nullif(trim(cc.nome), ''), nullif(trim(p.descrizione), ''), 'Prodotto')
$$;

-- Il cliente modifica solo i propri campi
create or replace function client_catalog_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not app_is_staff() and (new.client_id is distinct from old.client_id or new.product_id is distinct from old.product_id
     or new.prezzo is distinct from old.prezzo or new.attivo is distinct from old.attivo or new.nome is distinct from old.nome
     or new.created_at is distinct from old.created_at) then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
  new.nome := left(trim(new.nome), 80);
  new.nome_cliente := left(trim(new.nome_cliente), 80);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists client_catalog_guard on client_catalog;
create trigger client_catalog_guard before update on client_catalog for each row execute function client_catalog_guard();

-- Magazzino del cliente, per colore e taglia
create table if not exists client_stock (
  catalog_id  uuid not null references client_catalog(id) on delete cascade,
  colore      text not null default '',
  taglia      text not null default '',
  qnt         int not null default 0 check (qnt between 0 and 99999),
  updated_at  timestamptz not null default now(),
  primary key (catalog_id, colore, taglia)
);

create or replace function client_stock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products;
begin
  select p2.* into p from client_catalog cc join products p2 on p2.id = cc.product_id where cc.id = new.catalog_id;
  if not catalog_variant_ok(p, new.colore, new.taglia) then raise exception 'Colore o taglia non validi'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists client_stock_guard on client_stock;
create trigger client_stock_guard before insert or update on client_stock for each row execute function client_stock_guard();

-- ─────────────────────────────────────────────
-- 4. Ordini dei clienti finali al cliente
-- ─────────────────────────────────────────────

create table if not exists shop_orders (
  id                uuid primary key default gen_random_uuid(),
  numero            int generated always as identity,
  client_id         uuid not null references clients(id) on delete cascade,
  customer_id       uuid references auth.users(id) on delete set null,
  cliente_nome      text not null,
  cliente_telefono  text not null default '',
  cliente_email     text not null default '',
  note              text not null default '',
  stato             text not null default 'nuovo' check (stato in ('nuovo', 'in_lavorazione', 'pronto', 'consegnato', 'annullato')),
  totale            numeric(10,2) not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists shop_orders_client_idx on shop_orders(client_id, created_at desc);
create index if not exists shop_orders_customer_idx on shop_orders(customer_id);

create table if not exists shop_order_items (
  id             uuid primary key default gen_random_uuid(),
  shop_order_id  uuid not null references shop_orders(id) on delete cascade,
  catalog_id     uuid references client_catalog(id) on delete set null,
  nome           text not null,                           -- come lo vedeva il cliente finale
  colore         text not null default '',
  taglia         text not null default '',
  qnt            int not null check (qnt between 1 and 999),
  prezzo         numeric(10,2) not null default 0,         -- prezzo di rivendita al momento dell'ordine
  da_scorta      int not null default 0 check (da_scorta >= 0),   -- pezzi presi dal magazzino del cliente
  order_id       text references orders(id) on delete set null    -- ordine a T&C con i pezzi mancanti
);
create index if not exists shop_order_items_order_idx on shop_order_items(shop_order_id);

-- ─────────────────────────────────────────────
-- 5. Carrello del cliente e ordini a T&C
-- ─────────────────────────────────────────────

create table if not exists client_cart_items (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete cascade,
  catalog_id    uuid not null references client_catalog(id) on delete cascade,
  colore        text not null default '',
  taglia        text not null default '',
  qnt           int not null check (qnt between 1 and 9999),
  shop_item_id  uuid references shop_order_items(id) on delete cascade,   -- riga di un cliente finale integrata
  created_at    timestamptz not null default now()
);
create index if not exists client_cart_items_client_idx on client_cart_items(client_id);
create unique index if not exists client_cart_items_shop_item_idx on client_cart_items(shop_item_id) where shop_item_id is not null;

-- Le funzioni qui sotto attivano catalog.trusted per la sola transazione; dall'API non si può impostare
create or replace function client_cart_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare p products;
begin
  select p2.* into p from client_catalog cc join products p2 on p2.id = cc.product_id
   where cc.id = new.catalog_id and cc.client_id = new.client_id and cc.attivo and p2.attivo;
  if not found then raise exception 'Prodotto non disponibile'; end if;
  if not catalog_variant_ok(p, new.colore, new.taglia) then raise exception 'Colore o taglia non validi'; end if;
  if new.shop_item_id is distinct from (case when tg_op = 'UPDATE' then old.shop_item_id end)
     and coalesce(current_setting('catalog.trusted', true), '') <> 'on' then
    raise exception 'Non autorizzato' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists client_cart_guard on client_cart_items;
create trigger client_cart_guard before insert or update on client_cart_items for each row execute function client_cart_guard();

-- Ordini del gestionale nati dall'app
create table if not exists client_orders (
  order_id    text primary key references orders(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  nota        text not null default '',
  inviato_da  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists client_orders_client_idx on client_orders(client_id);

-- ─────────────────────────────────────────────
-- 6. Accessi (RLS)
--    Staff: gestisce accessi, cataloghi e ordini (le scorte le vede solo il cliente).
--    Cliente: solo le righe del proprio cliente. Cliente finale: solo le proprie.
--    Le scritture delicate (ordini, stati, scorte che scendono) passano dalle funzioni.
-- ─────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['catalog_users','catalog_shops','catalog_customers','client_catalog','client_stock',
                           'shop_orders','shop_order_items','client_cart_items','client_orders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
  end loop;
  foreach t in array array['catalog_users','catalog_shops','client_catalog','client_orders'] loop
    execute format('drop policy if exists "Staff gestisce %1$s" on %1$I', t);
    execute format('create policy "Staff gestisce %1$s" on %1$I for all to authenticated using (app_is_staff()) with check (app_is_staff())', t);
  end loop;
end $$;

drop policy if exists "App legge il proprio accesso" on catalog_users;
create policy "App legge il proprio accesso" on catalog_users for select to authenticated using (auth_id = auth.uid());

drop policy if exists "Cliente legge il proprio negozio" on catalog_shops;
create policy "Cliente legge il proprio negozio" on catalog_shops for select to authenticated using (client_id = catalog_client_id());

drop policy if exists "Staff legge catalog_customers"           on catalog_customers;
drop policy if exists "Cliente legge i propri clienti"          on catalog_customers;
drop policy if exists "Cliente finale legge la propria scheda"  on catalog_customers;
create policy "Staff legge catalog_customers"          on catalog_customers for select to authenticated using (app_is_staff());
create policy "Cliente legge i propri clienti"         on catalog_customers for select to authenticated using (client_id = catalog_client_id());
create policy "Cliente finale legge la propria scheda" on catalog_customers for select to authenticated using (auth_id = auth.uid());

drop policy if exists "Cliente legge il proprio catalogo"    on client_catalog;
drop policy if exists "Cliente modifica il proprio catalogo" on client_catalog;
create policy "Cliente legge il proprio catalogo"    on client_catalog for select to authenticated using (client_id = catalog_client_id() and attivo);
create policy "Cliente modifica il proprio catalogo" on client_catalog for update to authenticated
  using (client_id = catalog_client_id() and attivo) with check (client_id = catalog_client_id());

drop policy if exists "Cliente gestisce il proprio magazzino" on client_stock;
create policy "Cliente gestisce il proprio magazzino" on client_stock for all to authenticated
  using (exists (select 1 from client_catalog cc where cc.id = catalog_id and cc.client_id = catalog_client_id()))
  with check (exists (select 1 from client_catalog cc where cc.id = catalog_id and cc.client_id = catalog_client_id() and cc.attivo));

drop policy if exists "Staff legge shop_orders"          on shop_orders;
drop policy if exists "Cliente legge gli ordini ricevuti" on shop_orders;
drop policy if exists "Cliente finale legge i suoi ordini" on shop_orders;
create policy "Staff legge shop_orders"            on shop_orders for select to authenticated using (app_is_staff());
create policy "Cliente legge gli ordini ricevuti"  on shop_orders for select to authenticated using (client_id = catalog_client_id());
create policy "Cliente finale legge i suoi ordini" on shop_orders for select to authenticated using (customer_id = auth.uid());

drop policy if exists "Staff legge shop_order_items"       on shop_order_items;
drop policy if exists "Legge le righe degli ordini visibili" on shop_order_items;
create policy "Staff legge shop_order_items" on shop_order_items for select to authenticated using (app_is_staff());
create policy "Legge le righe degli ordini visibili" on shop_order_items for select to authenticated
  using (exists (select 1 from shop_orders o where o.id = shop_order_id and (o.client_id = catalog_client_id() or o.customer_id = auth.uid())));

drop policy if exists "Cliente gestisce il proprio carrello" on client_cart_items;
create policy "Cliente gestisce il proprio carrello" on client_cart_items for all to authenticated
  using (client_id = catalog_client_id()) with check (client_id = catalog_client_id());

drop policy if exists "Cliente legge i propri ordini" on client_orders;
create policy "Cliente legge i propri ordini" on client_orders for select to authenticated using (client_id = catalog_client_id());

-- ─────────────────────────────────────────────
-- 7. Stato di un ordine del gestionale, dai pulsanti
--    (Impostazioni → Pulsanti: ruoli "Chiude la lavorazione" ed "Evade l'ordine")
-- ─────────────────────────────────────────────

create or replace function catalog_order_stato(o orders) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  cfg jsonb := (select value from app_settings where key = 'pulsanti_ordine');
  chiude text[]; evade text[];
  done_all boolean;
begin
  if o.deleted_at is not null then return 'annullato'; end if;
  if cfg is null or jsonb_typeof(cfg) <> 'array' then
    cfg := '[{"id":"ordineStampato","ruolo":"chiude"},{"id":"spedito","ruolo":"evade"}]';
  end if;
  select array_agg(p->>'id') filter (where p->>'ruolo' = 'chiude'),
         array_agg(p->>'id') filter (where p->>'ruolo' = 'evade')
    into chiude, evade
    from jsonb_array_elements(cfg) p
   where coalesce((p->>'attivo')::boolean, true) and not coalesce((p->>'eliminato')::boolean, false);

  if o.archived then return 'evaso'; end if;
  select bool_and(coalesce((o.stages->x->>'done')::boolean, false)) into done_all from unnest(evade) x;
  if coalesce(done_all, false) then return 'evaso'; end if;
  select bool_and(coalesce((o.stages->x->>'done')::boolean, false)) into done_all from unnest(chiude) x;
  if coalesce(done_all, false) then return 'pronto'; end if;
  if exists (select 1 from jsonb_each(o.stages) s
              where (jsonb_typeof(s.value) = 'object' and coalesce((s.value->>'done')::boolean, false))
                 or (s.key like 'mezzo:%' and s.value not in ('false'::jsonb, 'null'::jsonb))) then
    return 'lavorazione';
  end if;
  return 'ricevuto';
end $$;

-- ─────────────────────────────────────────────
-- 8. App: area del cliente
-- ─────────────────────────────────────────────

-- Chi sono e il mio negozio (lo crea al primo accesso)
create or replace function catalog_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client clients; v_shop catalog_shops;
begin
  select * into v_client from clients where id = catalog_client_id();
  if not found then return null; end if;
  insert into catalog_shops (client_id) values (v_client.id) on conflict (client_id) do nothing;
  select * into v_shop from catalog_shops where client_id = v_client.id;
  return jsonb_build_object('client_id', v_client.id, 'nome', catalog_client_name(v_client),
    'negozio', jsonb_build_object('nome', coalesce(nullif(v_shop.nome, ''), catalog_client_name(v_client)), 'nome_proprio', v_shop.nome,
                                  'invito', v_shop.invito, 'attivo', v_shop.attivo));
end $$;

create or replace function catalog_update_shop(p_nome text, p_attivo boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if catalog_client_id() is null then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform catalog_me();
  update catalog_shops set nome = left(trim(coalesce(p_nome, '')), 60), attivo = coalesce(p_attivo, true), updated_at = now()
   where client_id = catalog_client_id();
  return catalog_me();
end $$;

-- Nuovo link di invito: quello vecchio smette di funzionare (chi è già registrato resta)
create or replace function catalog_new_invite() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if catalog_client_id() is null then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform catalog_me();
  update catalog_shops set invito = encode(gen_random_bytes(9), 'hex'), updated_at = now() where client_id = catalog_client_id();
  return catalog_me();
end $$;

-- Prodotti del mio catalogo: niente fornitore, codice né costo
create or replace function catalog_products() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cc.id, 'nome', catalog_item_name(cc, p), 'nome_proprio', cc.nome_cliente,
    'nome_base', coalesce(nullif(trim(cc.nome), ''), p.descrizione), 'descrizione', p.descrizione,
    'categoria', coalesce(pc.nome, ''), 'colori', to_jsonb(catalog_list(p.colori)), 'taglie', to_jsonb(catalog_list(p.taglie)),
    'prezzo', coalesce(cc.prezzo, p.prezzo), 'prezzo_rivendita', cc.prezzo_rivendita,
    'in_vendita', cc.in_vendita, 'scorte_attive', cc.scorte_attive, 'ordine', cc.ordine,
    'immagini', coalesce((select jsonb_agg(jsonb_build_object('colore', i.colore, 'vista', i.vista, 'path', i.path) order by i.created_at)
                          from product_images i where i.product_id = p.id), '[]'::jsonb),
    'scorte', coalesce((select jsonb_agg(jsonb_build_object('colore', s.colore, 'taglia', s.taglia, 'qnt', s.qnt))
                        from client_stock s where s.catalog_id = cc.id), '[]'::jsonb)
  ) order by cc.ordine, catalog_item_name(cc, p)), '[]'::jsonb)
  from client_catalog cc
  join products p on p.id = cc.product_id and p.attivo
  left join product_categories pc on pc.id = p.categoria_id
  where cc.client_id = catalog_client_id() and cc.attivo
$$;

-- Clienti finali: blocca / sblocca
create or replace function catalog_block_customer(p_auth_id uuid, p_bloccato boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if catalog_client_id() is null then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  update catalog_customers set bloccato = coalesce(p_bloccato, false) where auth_id = p_auth_id and client_id = catalog_client_id();
end $$;

-- Scorte restituite quando un ordine viene annullato; le righe nel carrello si tolgono
create or replace function shop_restore_stock(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into client_stock (catalog_id, colore, taglia, qnt)
  select i.catalog_id, i.colore, i.taglia, sum(i.da_scorta)
    from shop_order_items i
   where i.shop_order_id = p_order and i.catalog_id is not null and i.da_scorta > 0
   group by i.catalog_id, i.colore, i.taglia
  on conflict (catalog_id, colore, taglia) do update set qnt = least(99999, client_stock.qnt + excluded.qnt);
  update shop_order_items set da_scorta = 0 where shop_order_id = p_order;
  delete from client_cart_items where shop_item_id in (select id from shop_order_items where shop_order_id = p_order);
end $$;
revoke execute on function shop_restore_stock(uuid) from public, anon, authenticated;

create or replace function catalog_set_shop_order_stato(p_id uuid, p_stato text) returns void
language plpgsql security definer set search_path = public as $$
declare v shop_orders;
begin
  select * into v from shop_orders where id = p_id and client_id = catalog_client_id() for update;
  if not found then raise exception 'Ordine non trovato'; end if;
  if p_stato not in ('nuovo', 'in_lavorazione', 'pronto', 'consegnato', 'annullato') then raise exception 'Stato non valido'; end if;
  if v.stato = 'annullato' and p_stato <> 'annullato' then raise exception 'Un ordine annullato non si può riaprire'; end if;
  if p_stato = 'annullato' and v.stato <> 'annullato' then perform shop_restore_stock(p_id); end if;
  update shop_orders set stato = p_stato, updated_at = now() where id = p_id;
end $$;

-- Porta nel carrello i pezzi che mancano in magazzino (p_order null = tutti gli ordini dei clienti finali)
create or replace function catalog_integrate(p_order uuid default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_client uuid := catalog_client_id(); n int;
begin
  if v_client is null then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  perform set_config('catalog.trusted', 'on', true);
  insert into client_cart_items (client_id, catalog_id, colore, taglia, qnt, shop_item_id)
  select v_client, i.catalog_id, i.colore, i.taglia, i.qnt - i.da_scorta, i.id
    from shop_order_items i
    join shop_orders o on o.id = i.shop_order_id
    join client_catalog cc on cc.id = i.catalog_id and cc.attivo
    join products p on p.id = cc.product_id and p.attivo
   where o.client_id = v_client and o.stato <> 'annullato' and (p_order is null or o.id = p_order)
     and i.qnt > i.da_scorta and i.order_id is null
     and catalog_variant_ok(p, i.colore, i.taglia)
     and not exists (select 1 from client_cart_items c where c.shop_item_id = i.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Conferma il carrello → ordine normale del gestionale con il modulo d'ordine compilato
create or replace function catalog_submit(p_nota text default '') returns text
language plpgsql security definer set search_path = public as $$
declare
  v_client clients;
  v_id text; v_rows jsonb; v_tot numeric; v_prio text; v_tags text[]; v_days int; v_tag text;
begin
  select * into v_client from clients where id = catalog_client_id();
  if not found then raise exception 'Non autorizzato' using errcode = '42501'; end if;

  select jsonb_agg(jsonb_build_object(
           'catalogo', coalesce((select s.nome from suppliers s where s.id = p.fornitore_id), ''),
           'codice', p.codice, 'descrizione', p.descrizione,
           'colore', ci.colore, 'tg', ci.taglia, 'qnt', ci.qnt, 'prezzo', coalesce(cc.prezzo, p.prezzo, 0),
           'productId', p.id, 'per', coalesce(so.cliente_nome, ''),
           'ordinato', false, 'interna', '', 'esterna', '', 'lavEsterna', false, 'neutro', false
         ) order by ci.created_at, ci.id),
         sum(ci.qnt * coalesce(cc.prezzo, p.prezzo, 0))
    into v_rows, v_tot
    from client_cart_items ci
    join client_catalog cc on cc.id = ci.catalog_id and cc.attivo
    join products p on p.id = cc.product_id and p.attivo
    left join shop_order_items si on si.id = ci.shop_item_id
    left join shop_orders so on so.id = si.shop_order_id
   where ci.client_id = v_client.id;

  if v_rows is null then raise exception 'Il carrello è vuoto'; end if;

  -- stesse scelte del gestionale per un ordine nuovo
  select id into v_prio from priorities order by (id = 'normale') desc, sort_order limit 1;
  v_tag := (select value #>> '{}' from app_settings where key = 'catalog_tag');
  v_tags := case when v_tag is not null and exists (select 1 from tags where name = v_tag) then array[v_tag] else '{}' end;
  v_days := coalesce((select (value #>> '{}')::int from app_settings where key = 'auto_deadline_days'), 14);

  -- codice ordine a 5 cifre in sequenza, come TCFactory.generateId()
  perform pg_advisory_xact_lock(hashtext('orders_id'));
  select lpad((coalesce(max((regexp_match(id, '^(?:ORD-)?(\d+)$'))[1]::int), 0) + 1)::text, 5, '0') into v_id from orders;

  insert into orders (id, nome, data_ordine, deadline, notes, priority_id, tags, client_id, importo, created_by, stages, order_module)
  values (v_id, catalog_client_name(v_client), current_date, current_date + v_days, left(coalesce(trim(p_nota), ''), 2000),
          v_prio, v_tags, v_client.id, v_tot, 'App clienti',
          '{"merceCompleta":{"done":false},"dtfPronti":{"done":false},"ordineStampato":{"done":false},"speditoParzialmente":{"done":false},"spedito":{"done":false}}',
          jsonb_build_object('rows', v_rows, 'acconto', '', 'descrizione', 'Ordine dall''app clienti', 'origine', 'app'));

  insert into client_orders (order_id, client_id, nota, inviato_da) values (v_id, v_client.id, left(coalesce(trim(p_nota), ''), 2000), auth.uid());
  update shop_order_items set order_id = v_id
   where id in (select shop_item_id from client_cart_items where client_id = v_client.id and shop_item_id is not null);
  delete from client_cart_items where client_id = v_client.id;
  insert into activity_log (user_nickname, action, order_id, order_name, details)
  values ('App clienti', 'Ordine creato', v_id, catalog_client_name(v_client),
          jsonb_build_object('origine', 'app', 'pezzi', (select sum((x->>'qnt')::int) from jsonb_array_elements(v_rows) x)));
  return v_id;
end $$;

-- I miei ordini a T&C, con lo stato letto dal gestionale (righe senza fornitore né codice)
create or replace function catalog_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'data', o.data_ordine, 'stato', catalog_order_stato(o), 'nota', co.nota, 'importo', o.importo,
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object(
        'nome', coalesce(case when cc.id is not null then catalog_item_name(cc, p) end, nullif(r->>'descrizione', ''), 'Articolo'),
        'colore', coalesce(r->>'colore', ''), 'taglia', coalesce(r->>'tg', ''), 'qnt', r->'qnt', 'prezzo', r->'prezzo', 'per', coalesce(r->>'per', '')))
        from jsonb_array_elements(o.order_module->'rows') r
        left join products p on p.id::text = r->>'productId'
        left join client_catalog cc on cc.product_id = p.id and cc.client_id = co.client_id), '[]'::jsonb)
  ) order by co.created_at desc), '[]'::jsonb)
  from client_orders co join orders o on o.id = co.order_id
  where co.client_id = catalog_client_id()
$$;

-- ─────────────────────────────────────────────
-- 9. App: area del cliente finale
-- ─────────────────────────────────────────────

-- Pagina di registrazione: solo il nome del negozio
create or replace function shop_info(p_invito text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nome', coalesce(nullif(s.nome, ''), catalog_client_name(c)))
    from catalog_shops s join clients c on c.id = s.client_id
   where s.invito = p_invito and s.attivo
$$;

-- Dopo la registrazione (o con un account già esistente): entra nel negozio del link
create or replace function shop_join(p_invito text, p_nome text, p_telefono text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_shop catalog_shops; v_email text;
begin
  if auth.uid() is null then raise exception 'Accesso richiesto' using errcode = '42501'; end if;
  select * into v_shop from catalog_shops where invito = p_invito and attivo;
  if not found then raise exception 'Link di invito non valido'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'Inserisci nome e cognome'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into catalog_customers (auth_id, client_id, nome, telefono, email)
  values (auth.uid(), v_shop.client_id, left(trim(p_nome), 120), left(trim(coalesce(p_telefono, '')), 40), coalesce(v_email, ''))
  on conflict (auth_id, client_id) do update set nome = excluded.nome, telefono = excluded.telefono;
  return v_shop.client_id;
end $$;

-- Negozi in cui posso ordinare
create or replace function shop_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('client_id', c.id, 'nome', coalesce(nullif(s.nome, ''), catalog_client_name(c)),
                                               'attivo', coalesce(s.attivo, false)) order by cu.created_at), '[]'::jsonb)
    from catalog_customers cu
    join clients c on c.id = cu.client_id
    left join catalog_shops s on s.client_id = cu.client_id
   where cu.auth_id = auth.uid() and not cu.bloccato
$$;

-- Catalogo del negozio: nome rinominato e prezzo di rivendita; niente scorte
create or replace function shop_catalog(p_client uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not catalog_is_customer(p_client) then null else jsonb_build_object(
    'negozio', (select jsonb_build_object('nome', coalesce(nullif(s.nome, ''), catalog_client_name(c)), 'attivo', coalesce(s.attivo, false))
                  from clients c left join catalog_shops s on s.client_id = c.id where c.id = p_client),
    'prodotti', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cc.id, 'nome', catalog_item_name(cc, p), 'descrizione', p.descrizione, 'categoria', coalesce(pc.nome, ''),
        'prezzo', cc.prezzo_rivendita, 'colori', to_jsonb(catalog_list(p.colori)), 'taglie', to_jsonb(catalog_list(p.taglie)),
        'immagini', coalesce((select jsonb_agg(jsonb_build_object('colore', i.colore, 'vista', i.vista, 'path', i.path) order by i.created_at)
                              from product_images i where i.product_id = p.id), '[]'::jsonb)
      ) order by cc.ordine, catalog_item_name(cc, p))
        from client_catalog cc
        join products p on p.id = cc.product_id and p.attivo
        left join product_categories pc on pc.id = p.categoria_id
       where cc.client_id = p_client and cc.attivo and cc.in_vendita), '[]'::jsonb)
  ) end
$$;

-- Ordine del cliente finale. p_items: [{id (riga del catalogo), colore, taglia, qnt}]
-- Il magazzino scende fin dove arriva; il resto risulta da ordinare a T&C.
create or replace function shop_place_order(p_client uuid, p_note text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cu catalog_customers; v_order shop_orders; it jsonb; cc client_catalog; p products;
  v_col text; v_tg text; v_qnt int; v_stock int; v_take int; v_tot numeric := 0;
begin
  select * into cu from catalog_customers where auth_id = auth.uid() and client_id = p_client and not bloccato;
  if not found then raise exception 'Non autorizzato' using errcode = '42501'; end if;
  if not exists (select 1 from catalog_shops where client_id = p_client and attivo) then raise exception 'Il negozio non accetta ordini'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Il carrello è vuoto'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Troppi articoli in un ordine'; end if;

  insert into shop_orders (client_id, customer_id, cliente_nome, cliente_telefono, cliente_email, note)
  values (p_client, auth.uid(), cu.nome, cu.telefono, cu.email, left(coalesce(trim(p_note), ''), 1000))
  returning * into v_order;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into cc from client_catalog
     where id = (it->>'id')::uuid and client_id = p_client and attivo and in_vendita for update;
    if not found then raise exception 'Un prodotto non è più disponibile'; end if;
    select * into p from products where id = cc.product_id and attivo;
    if not found then raise exception 'Un prodotto non è più disponibile'; end if;
    v_col := coalesce(it->>'colore', ''); v_tg := coalesce(it->>'taglia', '');
    if not catalog_variant_ok(p, v_col, v_tg) then raise exception 'Colore o taglia non validi per %', catalog_item_name(cc, p); end if;
    v_qnt := coalesce((it->>'qnt')::int, 0);
    if v_qnt < 1 or v_qnt > 999 then raise exception 'Quantità non valida per %', catalog_item_name(cc, p); end if;

    v_take := 0;
    if cc.scorte_attive then
      select qnt into v_stock from client_stock where catalog_id = cc.id and colore = v_col and taglia = v_tg for update;
      v_take := least(coalesce(v_stock, 0), v_qnt);
      if v_take > 0 then
        update client_stock set qnt = qnt - v_take where catalog_id = cc.id and colore = v_col and taglia = v_tg;
      end if;
    end if;

    insert into shop_order_items (shop_order_id, catalog_id, nome, colore, taglia, qnt, prezzo, da_scorta)
    values (v_order.id, cc.id, catalog_item_name(cc, p), v_col, v_tg, v_qnt, cc.prezzo_rivendita, v_take);
    v_tot := v_tot + v_qnt * cc.prezzo_rivendita;
  end loop;

  update shop_orders set totale = v_tot where id = v_order.id;
  return jsonb_build_object('id', v_order.id, 'numero', v_order.numero, 'totale', v_tot);
end $$;

-- Il cliente finale annulla un ordine finché è "nuovo"
create or replace function shop_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v shop_orders;
begin
  select * into v from shop_orders where id = p_id and customer_id = auth.uid() for update;
  if not found then raise exception 'Ordine non trovato'; end if;
  if v.stato <> 'nuovo' then raise exception 'L''ordine è già in lavorazione: contatta il negozio'; end if;
  perform shop_restore_stock(p_id);
  update shop_orders set stato = 'annullato', updated_at = now() where id = p_id;
end $$;

-- ─────────────────────────────────────────────
-- 10. Immagini dei prodotti (bucket privato "prodotti", cartella = id del prodotto)
--     Il cliente vede quelle del suo catalogo, il cliente finale quelle dei prodotti in vendita.
-- ─────────────────────────────────────────────

create or replace function catalog_can_see_product(p_product text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from client_catalog cc join products p on p.id = cc.product_id
     where cc.product_id::text = p_product and cc.attivo and p.attivo
       and (cc.client_id = catalog_client_id() or (cc.in_vendita and catalog_is_customer(cc.client_id))))
$$;

drop policy if exists "App legge le immagini dei prodotti" on storage.objects;
create policy "App legge le immagini dei prodotti" on storage.objects for select to authenticated
  using (bucket_id = 'prodotti' and catalog_can_see_product((storage.foldername(name))[1]));

-- ─────────────────────────────────────────────
-- 11. Permessi sulle funzioni
-- ─────────────────────────────────────────────

revoke execute on function catalog_client_id(), catalog_is_customer(uuid), catalog_order_stato(orders), catalog_can_see_product(text),
                           catalog_me(), catalog_update_shop(text, boolean), catalog_new_invite(), catalog_products(),
                           catalog_block_customer(uuid, boolean), catalog_set_shop_order_stato(uuid, text), catalog_integrate(uuid),
                           catalog_submit(text), catalog_orders(),
                           shop_info(text), shop_join(text, text, text), shop_list(), shop_catalog(uuid),
                           shop_place_order(uuid, text, jsonb), shop_cancel(uuid) from public;
grant execute on function catalog_client_id(), catalog_is_customer(uuid), catalog_order_stato(orders), catalog_can_see_product(text),
                          catalog_me(), catalog_update_shop(text, boolean), catalog_new_invite(), catalog_products(),
                          catalog_block_customer(uuid, boolean), catalog_set_shop_order_stato(uuid, text), catalog_integrate(uuid),
                          catalog_submit(text), catalog_orders(),
                          shop_join(text, text, text), shop_list(), shop_catalog(uuid),
                          shop_place_order(uuid, text, jsonb), shop_cancel(uuid) to authenticated;
grant execute on function shop_info(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 12. Realtime: il gestionale e l'app vedono subito le novità
-- ─────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['client_catalog', 'catalog_users', 'client_orders', 'shop_orders', 'client_cart_items'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
