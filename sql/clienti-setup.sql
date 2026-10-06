-- ════════════════════════════════════════════════════════
-- T&C Factory — Clienti + impostazioni condivise
-- Esegui in: Supabase → SQL Editor → New query
--
-- Script NON distruttivo: crea solo tabelle/colonne nuove,
-- non tocca gli ordini esistenti. Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Anagrafica clienti
-- ─────────────────────────────────────────────

create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null default 'azienda' check (tipo in ('azienda', 'privato')),
  ragione_sociale text not null default '',
  nome            text not null default '',
  cognome         text not null default '',
  partita_iva     text not null default '',
  codice_fiscale  text not null default '',
  codice_sdi      text not null default '',
  pec             text not null default '',
  email           text not null default '',
  telefono        text not null default '',
  indirizzo       text not null default '',
  cap             text not null default '',
  citta           text not null default '',
  provincia       text not null default '',
  nazione         text not null default 'Italia',
  referente       text not null default '',
  note            text not null default '',
  created_by      text not null default 'sistema',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table clients enable row level security;
drop policy if exists "Public read clients"   on clients;
drop policy if exists "Public insert clients" on clients;
drop policy if exists "Public update clients" on clients;
drop policy if exists "Public delete clients" on clients;
create policy "Public read clients"   on clients for select to anon, authenticated using (true);
create policy "Public insert clients" on clients for insert to anon, authenticated with check (true);
create policy "Public update clients" on clients for update to anon, authenticated using (true);
create policy "Public delete clients" on clients for delete to anon, authenticated using (true);

-- ─────────────────────────────────────────────
-- 2. Collegamento ordine → cliente
--    Se un cliente viene eliminato, i suoi ordini restano (senza cliente)
-- ─────────────────────────────────────────────

alter table orders add column if not exists client_id uuid references clients(id) on delete set null;
create index if not exists orders_client_id_idx on orders(client_id);

-- ─────────────────────────────────────────────
-- 3. Impostazioni condivise tra tutti i PC
--    auto_deadline_days: giorni dopo la data ordine per la scadenza automatica
-- ─────────────────────────────────────────────

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;
drop policy if exists "Public read app_settings"   on app_settings;
drop policy if exists "Public insert app_settings" on app_settings;
drop policy if exists "Public update app_settings" on app_settings;
create policy "Public read app_settings"   on app_settings for select to anon, authenticated using (true);
create policy "Public insert app_settings" on app_settings for insert to anon, authenticated with check (true);
create policy "Public update app_settings" on app_settings for update to anon, authenticated using (true);

insert into app_settings (key, value) values ('auto_deadline_days', '14')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────
-- 4. Realtime — sync live tra tutti i PC
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'clients') then
    alter publication supabase_realtime add table clients;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'app_settings') then
    alter publication supabase_realtime add table app_settings;
  end if;
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
