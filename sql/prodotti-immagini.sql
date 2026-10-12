-- ════════════════════════════════════════════════════════
-- T&C Factory — Prodotti: immagini per colore
-- Ogni immagine appartiene a un prodotto, ha un colore (tra i colori
-- del prodotto, vuoto = da assegnare) e una vista: fronte, retro, lato
-- (vuoto = altra). I file stanno nel bucket privato "prodotti".
-- Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════

create table if not exists product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  colore      text not null default '',
  vista       text not null default '' check (vista in ('', 'fronte', 'retro', 'lato')),
  path        text not null,
  nome_file   text not null default '',
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now()
);
create index if not exists product_images_product_idx on product_images(product_id);

alter table product_images enable row level security;
revoke all on product_images from anon;
drop policy if exists "Staff legge product_images"     on product_images;
drop policy if exists "Staff inserisce product_images" on product_images;
drop policy if exists "Staff modifica product_images"  on product_images;
drop policy if exists "Staff elimina product_images"   on product_images;
create policy "Staff legge product_images"     on product_images for select to authenticated using (app_is_staff());
create policy "Staff inserisce product_images" on product_images for insert to authenticated with check (app_is_staff());
create policy "Staff modifica product_images"  on product_images for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina product_images"   on product_images for delete to authenticated using (app_is_staff());

-- ─────────────────────────────────────────────
-- Bucket privato per i file (si aprono con link temporanei)
-- ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('prodotti', 'prodotti', false, 15728640)
on conflict (id) do update set public = false;

drop policy if exists "Staff legge prodotti"    on storage.objects;
drop policy if exists "Staff carica prodotti"   on storage.objects;
drop policy if exists "Staff modifica prodotti" on storage.objects;
drop policy if exists "Staff elimina prodotti"  on storage.objects;
create policy "Staff legge prodotti"    on storage.objects for select to authenticated using (bucket_id = 'prodotti' and app_is_staff());
create policy "Staff carica prodotti"   on storage.objects for insert to authenticated with check (bucket_id = 'prodotti' and app_is_staff());
create policy "Staff modifica prodotti" on storage.objects for update to authenticated using (bucket_id = 'prodotti' and app_is_staff());
create policy "Staff elimina prodotti"  on storage.objects for delete to authenticated using (bucket_id = 'prodotti' and app_is_staff());

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
