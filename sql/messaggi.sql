-- ════════════════════════════════════════════════════════
-- T&C Factory — Messaggi, notifiche e promemoria tra utenti
--
--   • ogni riga è un messaggio da un utente a un altro (o a sé stesso)
--   • riferimento: l'elemento del gestionale allegato (ordine, cliente,
--     prodotto, evento o pagina) — { tipo, id, label, hash }
--   • ricorda_il: promemoria, il destinatario lo riceve solo da quell'ora
--   • ognuno vede solo i messaggi che ha mandato o ricevuto;
--     il destinatario può solo segnarli come letti, il mittente eliminarli
-- Richiede sicurezza-2-blocca.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  mittente     text not null references app_users(nickname) on delete cascade,
  destinatario text not null references app_users(nickname) on delete cascade,
  testo        text not null check (length(trim(testo)) between 1 and 2000),
  riferimento  jsonb,
  ricorda_il   timestamptz,
  letto_at     timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists messages_destinatario_idx on messages (destinatario, created_at desc);
create index if not exists messages_mittente_idx     on messages (mittente, created_at desc);

alter table messages enable row level security;
drop policy if exists "Utente legge i suoi messaggi"   on messages;
drop policy if exists "Utente manda messaggi"          on messages;
drop policy if exists "Destinatario segna letto"       on messages;
drop policy if exists "Mittente elimina messaggi"      on messages;

-- Un promemoria non è visibile al destinatario prima dell'ora scelta
create policy "Utente legge i suoi messaggi" on messages for select to authenticated
  using (mittente = app_nickname() or (destinatario = app_nickname() and (ricorda_il is null or ricorda_il <= now())));
create policy "Utente manda messaggi" on messages for insert to authenticated
  with check (app_is_staff() and mittente = app_nickname());
create policy "Destinatario segna letto" on messages for update to authenticated
  using (destinatario = app_nickname()) with check (destinatario = app_nickname());
create policy "Mittente elimina messaggi" on messages for delete to authenticated
  using (mittente = app_nickname());

revoke all on messages from anon, authenticated;
grant select, insert, delete on messages to authenticated;
grant update (letto_at) on messages to authenticated;

-- Notifica immediata quando arriva un messaggio
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
