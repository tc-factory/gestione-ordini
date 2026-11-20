-- ════════════════════════════════════════════════════════
-- T&C Factory — Via cataloghi clienti, store, immagini dei prodotti e supporto
--
-- Deciso da Riccardo il 2026-11-20: i cataloghi dei clienti si gestiscono da Kamon.
-- Tutte queste tabelle erano vuote (0 righe) e i bucket "prodotti" e "loghi" senza file.
-- Le funzioni kamon_* non usano niente di quello che si toglie qui.
-- Prima versione degli oggetti: sql/cataloghi-clienti.sql, sql/prodotti-immagini.sql,
-- sql/supporto-setup.sql (nella storia di git).
-- Ordine: policy dei file → funzioni sul tipo delle tabelle → tabelle → altre funzioni.
-- ════════════════════════════════════════════════════════

begin;

-- File: immagini dei prodotti (bucket prodotti) e loghi dei negozi dell'app clienti (bucket loghi)
drop policy if exists "Staff legge prodotti" on storage.objects;
drop policy if exists "Staff carica prodotti" on storage.objects;
drop policy if exists "Staff modifica prodotti" on storage.objects;
drop policy if exists "Staff elimina prodotti" on storage.objects;
drop policy if exists "App legge le immagini dei prodotti" on storage.objects;
drop policy if exists "Staff gestisce loghi" on storage.objects;
drop policy if exists "Cliente gestisce il proprio logo" on storage.objects;

-- Funzioni che usano il tipo delle tabelle da togliere
drop function if exists catalog_item_name(cc client_catalog, p products);
drop function if exists catalog_shop_brand(s catalog_shops, c clients);

-- Tabelle (le loro policy e i loro trigger se ne vanno con loro)
drop table if exists
  shop_order_items,
  shop_orders,
  client_cart_items,
  client_orders,
  client_stock,
  client_catalog,
  catalog_customers,
  catalog_shops,
  catalog_users,
  product_images,
  support_tickets;

-- Funzioni dell'app clienti, dello store e dei ticket
drop function if exists catalog_block_customer(p_auth_id uuid, p_bloccato boolean);
drop function if exists catalog_can_see_product(p_product text);
drop function if exists catalog_client_id();
drop function if exists catalog_client_name(c clients);
drop function if exists catalog_integrate(p_order uuid);
drop function if exists catalog_is_customer(p_client uuid);
drop function if exists catalog_list(s text);
drop function if exists catalog_me();
drop function if exists catalog_new_invite();
drop function if exists catalog_order_stato(o orders);
drop function if exists catalog_orders();
drop function if exists catalog_products();
drop function if exists catalog_set_logo(p_path text);
drop function if exists catalog_set_shop_order_stato(p_id uuid, p_stato text);
drop function if exists catalog_submit(p_nota text);
drop function if exists catalog_update_shop(p_nome text, p_attivo boolean, p_tema text, p_accento_1 text, p_accento_2 text);
drop function if exists catalog_variant_ok(p products, p_colore text, p_taglia text);
drop function if exists shop_cancel(p_id uuid);
drop function if exists shop_catalog(p_client uuid);
drop function if exists shop_info(p_invito text);
drop function if exists shop_join(p_invito text, p_nome text, p_telefono text);
drop function if exists shop_list();
drop function if exists shop_me(p_client uuid);
drop function if exists shop_place_order(p_client uuid, p_note text, p_items jsonb);
drop function if exists shop_restore_stock(p_order uuid);
drop function if exists shop_update_me(p_client uuid, p_nome text, p_telefono text);
drop function if exists tc_ticket_create(p_oggetto text, p_descrizione text, p_categoria text);
drop function if exists tc_ticket_delete(p_id uuid);
drop function if exists tc_ticket_list();
drop function if exists tc_ticket_reply(p_id uuid, p_testo text);
drop function if exists tc_ticket_set_priority(p_id uuid, p_priorita text);
drop function if exists tc_ticket_set_status(p_id uuid, p_stato text);
drop function if exists client_cart_guard();
drop function if exists client_catalog_guard();
drop function if exists client_stock_guard();

commit;

-- Bucket vuoti: se il database non lascia cancellarli da qui, si tolgono da Supabase → Storage
delete from storage.buckets b where b.id in ('prodotti', 'loghi') and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
