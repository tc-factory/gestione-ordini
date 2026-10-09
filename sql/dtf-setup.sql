-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF conto terzi
-- Clienti DTF (separati dall'anagrafica clienti) con costo al metro,
-- e registro giornaliero di metri stampati + nomi dei file.
-- L'ordine e le rimozioni della timeline "Interno" stanno in
-- app_settings (chiave dtf_interno), non servono tabelle.
-- Accesso: solo staff collegato (come le altre tabelle).
-- Script NON distruttivo, si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists dtf_clients (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null check (length(trim(nome)) between 1 and 120),
  costo_metro  numeric(10, 2) not null default 0 check (costo_metro >= 0),
  note         text not null default '',
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists dtf_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references dtf_clients(id) on delete cascade,
  giorno      date not null,
  metri       numeric(10, 2) not null default 0 check (metri >= 0),
  dettaglio   text not null default '',          -- nomi dei file stampati, uno per riga
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (client_id, giorno)
);
create index if not exists dtf_entries_giorno_idx on dtf_entries (client_id, giorno);

-- Chi modifica: scritto dal database, non dal browser
create or replace function dtf_set_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'dtf_clients' and tg_op = 'INSERT' then
    new.created_by := coalesce(app_nickname(), new.created_by);
  end if;
  if tg_table_name = 'dtf_entries' then
    new.updated_by := coalesce(app_nickname(), new.updated_by);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dtf_clients_author on dtf_clients;
create trigger dtf_clients_author before insert or update on dtf_clients
  for each row execute function dtf_set_author();
drop trigger if exists dtf_entries_author on dtf_entries;
create trigger dtf_entries_author before insert or update on dtf_entries
  for each row execute function dtf_set_author();

-- Solo staff collegato
do $$
declare t text;
begin
  foreach t in array array['dtf_clients', 'dtf_entries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('drop policy if exists "Staff legge %1$s" on %1$I', t);
    execute format('drop policy if exists "Staff inserisce %1$s" on %1$I', t);
    execute format('drop policy if exists "Staff modifica %1$s" on %1$I', t);
    execute format('drop policy if exists "Staff elimina %1$s" on %1$I', t);
    execute format('create policy "Staff legge %1$s"     on %1$I for select to authenticated using (app_is_staff())', t);
    execute format('create policy "Staff inserisce %1$s" on %1$I for insert to authenticated with check (app_is_staff())', t);
    execute format('create policy "Staff modifica %1$s"  on %1$I for update to authenticated using (app_is_staff()) with check (app_is_staff())', t);
    execute format('create policy "Staff elimina %1$s"   on %1$I for delete to authenticated using (app_is_staff())', t);
  end loop;
end $$;

-- Realtime: aggiornamenti in diretta tra i PC
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dtf_clients') then
    alter publication supabase_realtime add table dtf_clients;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dtf_entries') then
    alter publication supabase_realtime add table dtf_entries;
  end if;
end $$;
