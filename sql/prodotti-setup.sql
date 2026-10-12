-- ════════════════════════════════════════════════════════
-- T&C Factory — Database prodotti
-- Esegui in: Supabase → SQL Editor → New query
--
-- Script NON distruttivo: crea solo la tabella nuova,
-- non tocca ordini e clienti. Si può rieseguire senza danni.
-- Richiede sicurezza-2-blocca.sql già eseguito (app_is_staff).
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Anagrafica prodotti
-- ─────────────────────────────────────────────

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  codice      text not null default '',
  nome        text not null default '',
  categoria   text not null default '',
  marca       text not null default '',
  fornitore   text not null default '',
  colori      text not null default '',
  taglie      text not null default '',
  costo       numeric(10,2),
  prezzo      numeric(10,2),
  note        text not null default '',
  attivo      boolean not null default true,
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists products_nome_idx on products(lower(nome));

-- ─────────────────────────────────────────────
-- 2. Accesso: solo staff collegato
-- ─────────────────────────────────────────────

alter table products enable row level security;
revoke all on products from anon;
drop policy if exists "Staff legge products"     on products;
drop policy if exists "Staff inserisce products" on products;
drop policy if exists "Staff modifica products"  on products;
drop policy if exists "Staff elimina products"   on products;
create policy "Staff legge products"     on products for select to authenticated using (app_is_staff());
create policy "Staff inserisce products" on products for insert to authenticated with check (app_is_staff());
create policy "Staff modifica products"  on products for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina products"   on products for delete to authenticated using (app_is_staff());

-- ─────────────────────────────────────────────
-- 3. Realtime — sync live tra tutti i PC
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'products') then
    alter publication supabase_realtime add table products;
  end if;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
