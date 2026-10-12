-- ════════════════════════════════════════════════════════
-- T&C Factory — Fornitori dei prodotti
-- Esegui dopo prodotti-categorie.sql. Si può rieseguire senza danni.
--
-- Anagrafica fornitori (gestita da Prodotti → Fornitori) e
-- collegamento prodotto → fornitore al posto del testo "catalogo".
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Anagrafica fornitori
-- ─────────────────────────────────────────────

create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  referente   text not null default '',
  email       text not null default '',
  telefono    text not null default '',
  sito        text not null default '',
  note        text not null default '',
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists suppliers_nome_idx on suppliers(lower(nome));

alter table suppliers enable row level security;
revoke all on suppliers from anon;
drop policy if exists "Staff legge suppliers"     on suppliers;
drop policy if exists "Staff inserisce suppliers" on suppliers;
drop policy if exists "Staff modifica suppliers"  on suppliers;
drop policy if exists "Staff elimina suppliers"   on suppliers;
create policy "Staff legge suppliers"     on suppliers for select to authenticated using (app_is_staff());
create policy "Staff inserisce suppliers" on suppliers for insert to authenticated with check (app_is_staff());
create policy "Staff modifica suppliers"  on suppliers for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina suppliers"   on suppliers for delete to authenticated using (app_is_staff());

-- ─────────────────────────────────────────────
-- 2. Prodotto → fornitore
--    Se un fornitore viene eliminato, i prodotti restano senza fornitore
-- ─────────────────────────────────────────────

alter table products add column if not exists fornitore_id uuid references suppliers(id) on delete set null;
create index if not exists products_fornitore_idx on products(fornitore_id);

-- Dal vecchio testo "catalogo": un fornitore per ogni nome, poi il collegamento
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'products' and column_name = 'catalogo') then
    insert into suppliers (nome, created_by)
      select distinct on (lower(catalogo)) catalogo, 'migrazione' from products where catalogo <> ''
      on conflict do nothing;
    update products p set fornitore_id = s.id
      from suppliers s where lower(s.nome) = lower(p.catalogo) and p.fornitore_id is null;
    alter table products drop column catalogo;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 3. Realtime
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'suppliers') then
    alter publication supabase_realtime add table suppliers;
  end if;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
