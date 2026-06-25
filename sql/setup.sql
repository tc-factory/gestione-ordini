-- ════════════════════════════════════════════════════════
-- T&C Factory — Setup Database Supabase v5.0
-- Esegui questo script in: Supabase Dashboard → SQL Editor → New query
--
-- ATTENZIONE: se hai già eseguito una versione precedente di questo script,
-- questa nuova versione AGGIUNGE le tabelle priorities/tags e RICREA la
-- struttura della tabella orders (i vecchi ordini con i campi vecchi non
-- sono compatibili col nuovo modello — è uno schema nuovo, pensato per
-- ripartire da zero con gli ordini).
-- ════════════════════════════════════════════════════════

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

drop table if exists orders cascade;

create table orders (
  id           text primary key,
  nome         text not null,
  data_ordine  date not null,
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
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
