-- ════════════════════════════════════════════════════════
-- T&C Factory — Prodotti da inserire
-- Esegui dopo fornitori.sql. Si può rieseguire senza danni.
--
-- Articoli trovati negli ordini (moduli d'ordine e foto dei fogli)
-- che non sono ancora in anagrafica: si vedono in Prodotti →
-- Da inserire, e quando si crea il prodotto la riga sparisce.
-- ════════════════════════════════════════════════════════

create table if not exists products_pending (
  id          uuid primary key default gen_random_uuid(),
  fornitore   text not null default '',
  codice      text not null default '',
  descrizione text not null default '',
  colori      text not null default '',
  taglie      text not null default '',
  ordini      text[] not null default '{}',   -- id degli ordini dove compare
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now()
);
create unique index if not exists products_pending_codice_idx on products_pending(lower(codice));

alter table products_pending enable row level security;
revoke all on products_pending from anon;
drop policy if exists "Staff legge products_pending"     on products_pending;
drop policy if exists "Staff inserisce products_pending" on products_pending;
drop policy if exists "Staff modifica products_pending"  on products_pending;
drop policy if exists "Staff elimina products_pending"   on products_pending;
create policy "Staff legge products_pending"     on products_pending for select to authenticated using (app_is_staff());
create policy "Staff inserisce products_pending" on products_pending for insert to authenticated with check (app_is_staff());
create policy "Staff modifica products_pending"  on products_pending for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina products_pending"   on products_pending for delete to authenticated using (app_is_staff());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'products_pending') then
    alter publication supabase_realtime add table products_pending;
  end if;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
