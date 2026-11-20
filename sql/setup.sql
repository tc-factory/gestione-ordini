-- ════════════════════════════════════════════════════════
-- T&C Factory — Primo impianto del database (storico, v5.0)
--
-- ⛔ NON ESEGUIRE sul database in uso: è lo script con cui è nato il gestionale.
--    Il database di produzione esiste già ed è stato aggiornato dagli altri file di sql/.
--    Le policy "Public …" qui sotto erano aperte a chiunque (anon): le ha chiuse
--    sql/sicurezza-2-blocca.sql e rieseguire questo file le riaprirebbe.
--    Se la tabella orders esiste, lo script si ferma subito senza toccare niente.
-- ════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.orders') is not null then
    raise exception 'sql/setup.sql è il primo impianto: il database esiste già, non va rieseguito';
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 1. Tabella PRIORITÀ (configurabili, sincronizzate su tutti i PC)
-- ─────────────────────────────────────────────

create table if not exists priorities (
  id          text primary key,
  label       text not null,
  color       text not null,
  sort_order  int not null default 0
);

alter table priorities enable row level security;
drop policy if exists "Public read priorities"   on priorities;
drop policy if exists "Public insert priorities" on priorities;
drop policy if exists "Public update priorities" on priorities;
drop policy if exists "Public delete priorities" on priorities;

create policy "Public read priorities"   on priorities for select to anon, authenticated using (true);
create policy "Public insert priorities" on priorities for insert to anon, authenticated with check (true);
create policy "Public update priorities" on priorities for update to anon, authenticated using (true);
create policy "Public delete priorities" on priorities for delete to anon, authenticated using (true);

insert into priorities (id, label, color, sort_order) values
  ('urgente', 'Urgente', '#ef4444', 0),
  ('media',   'Media',   '#f59e0b', 1),
  ('normale', 'Normale', '#3b82f6', 2),
  ('bassa',   'Bassa',   '#94a3b8', 3)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────
-- 2. Tabella TAG (configurabili, sincronizzati su tutti i PC)
-- ─────────────────────────────────────────────

create table if not exists tags (
  name  text primary key,
  color text not null
);

alter table tags enable row level security;
drop policy if exists "Public read tags"   on tags;
drop policy if exists "Public insert tags" on tags;
drop policy if exists "Public update tags" on tags;
drop policy if exists "Public delete tags" on tags;

create policy "Public read tags"   on tags for select to anon, authenticated using (true);
create policy "Public insert tags" on tags for insert to anon, authenticated with check (true);
create policy "Public update tags" on tags for update to anon, authenticated using (true);
create policy "Public delete tags" on tags for delete to anon, authenticated using (true);

insert into tags (name, color) values
  ('T&C Factory',     '#8b5cf6'),
  ('Box Factory Lab', '#06b6d4'),
  ('Bienjugado',       '#10b981')
on conflict (name) do nothing;

-- ─────────────────────────────────────────────
-- 3. Tabella ORDINI (nuovo modello v5.0)
-- ─────────────────────────────────────────────

create table if not exists orders (
  id           text primary key,
  nome         text not null,
  data_ordine  date not null,
  deadline     date,
  notes        text not null default '',
  priority_id  text not null references priorities(id) on delete set null,
  tags         text[] not null default '{}',
  files        jsonb not null default '[]',
  stages       jsonb not null default '{"merceCompleta":{"done":false},"dtfPronti":{"done":false},"ordineStampato":{"done":false}}',
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_set_updated_at on orders;
create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

alter table orders enable row level security;
drop policy if exists "Public read orders"   on orders;
drop policy if exists "Public insert orders" on orders;
drop policy if exists "Public update orders" on orders;
drop policy if exists "Public delete orders" on orders;

create policy "Public read orders"   on orders for select to anon, authenticated using (true);
create policy "Public insert orders" on orders for insert to anon, authenticated with check (true);
create policy "Public update orders" on orders for update to anon, authenticated using (true);
create policy "Public delete orders" on orders for delete to anon, authenticated using (true);

-- ─────────────────────────────────────────────
-- 4. Realtime — sync live tra tutti i PC
-- ─────────────────────────────────────────────

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table priorities;
alter publication supabase_realtime add table tags;

-- ─────────────────────────────────────────────
-- 5. Storage — permessi per il bucket "allegati"
--    (da creare manualmente se non già fatto: Storage → New bucket → "allegati" → Public)
-- ─────────────────────────────────────────────

drop policy if exists "Public read allegati"   on storage.objects;
drop policy if exists "Public insert allegati" on storage.objects;
drop policy if exists "Public update allegati" on storage.objects;
drop policy if exists "Public delete allegati" on storage.objects;

create policy "Public read allegati"   on storage.objects for select to anon, authenticated using (bucket_id = 'allegati');
create policy "Public insert allegati" on storage.objects for insert to anon, authenticated with check (bucket_id = 'allegati');
create policy "Public update allegati" on storage.objects for update to anon, authenticated using (bucket_id = 'allegati');
create policy "Public delete allegati" on storage.objects for delete to anon, authenticated using (bucket_id = 'allegati');

-- ════════════════════════════════════════════════════════
-- MIGRAZIONI NON DISTRUTTIVE
-- (da eseguire se aggiorni da una versione precedente)
-- ════════════════════════════════════════════════════════

alter table orders add column if not exists deadline    date;
alter table orders add column if not exists notes       text not null default '';
alter table orders add column if not exists dtf_items   jsonb not null default '[]';

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
