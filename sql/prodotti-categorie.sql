-- ════════════════════════════════════════════════════════
-- T&C Factory — Prodotti: nuovi campi + categorie
-- Esegui dopo prodotti-setup.sql. Si può rieseguire senza danni.
--
-- Campi del prodotto, in ordine: catalogo, codice, descrizione,
-- categoria, colori, taglie, costo, prezzo, attivo.
-- Le categorie si creano dalla pagina Prodotti.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Categorie dei prodotti
-- ─────────────────────────────────────────────

create table if not exists product_categories (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists product_categories_nome_idx on product_categories(lower(nome));

alter table product_categories enable row level security;
revoke all on product_categories from anon;
drop policy if exists "Staff legge product_categories"     on product_categories;
drop policy if exists "Staff inserisce product_categories" on product_categories;
drop policy if exists "Staff modifica product_categories"  on product_categories;
drop policy if exists "Staff elimina product_categories"   on product_categories;
create policy "Staff legge product_categories"     on product_categories for select to authenticated using (app_is_staff());
create policy "Staff inserisce product_categories" on product_categories for insert to authenticated with check (app_is_staff());
create policy "Staff modifica product_categories"  on product_categories for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina product_categories"   on product_categories for delete to authenticated using (app_is_staff());

-- ─────────────────────────────────────────────
-- 2. Prodotti: nuovi campi
--    Se una categoria viene eliminata, i prodotti restano senza categoria
-- ─────────────────────────────────────────────

alter table products add column if not exists catalogo     text not null default '';
alter table products add column if not exists descrizione  text not null default '';
alter table products add column if not exists categoria_id uuid references product_categories(id) on delete set null;
create index if not exists products_categoria_idx on products(categoria_id);

-- Campi non più usati (la tabella era ancora vuota)
alter table products drop column if exists nome;
alter table products drop column if exists categoria;
alter table products drop column if exists marca;
alter table products drop column if exists fornitore;
alter table products drop column if exists note;
drop index if exists products_nome_idx;

-- ─────────────────────────────────────────────
-- 3. Realtime
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'product_categories') then
    alter publication supabase_realtime add table product_categories;
  end if;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
