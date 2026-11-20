-- ════════════════════════════════════════════════════════
-- T&C Factory — Calendario aziendale (Planner): ferie, impegni, chiusure
--
-- La tabella esisteva in produzione senza uno script in sql/: questo la descrive com'è
-- (ricavata dal database il 2026-11-20), per poterla ricreare. Non distruttivo, si può rieseguire.
--
-- event_type: 'impegno' | 'ferie' | 'chiusura' (chiusura = azienda chiusa, vedi tc_chiuso e i giorni lavorativi)
-- user_ids:   nickname delle persone coinvolte (ferie e impegni contano come assenze nel Centro di controllo)
-- ════════════════════════════════════════════════════════

create table if not exists calendar_events (
  id          bigserial primary key,
  title       text not null,
  date_from   date not null,
  date_to     date not null,
  event_type  text not null default 'impegno',
  user_ids    text[] not null default '{}',
  color       text not null default '#6366f1',
  notes       text not null default '',
  created_by  text not null default 'sistema',
  created_at  timestamptz not null default now()
);

alter table calendar_events enable row level security;

drop policy if exists "Staff legge calendar_events"     on calendar_events;
drop policy if exists "Staff inserisce calendar_events" on calendar_events;
drop policy if exists "Staff modifica calendar_events"  on calendar_events;
drop policy if exists "Staff elimina calendar_events"   on calendar_events;

create policy "Staff legge calendar_events"     on calendar_events for select to authenticated using (app_is_staff());
create policy "Staff inserisce calendar_events" on calendar_events for insert to authenticated with check (app_is_staff());
create policy "Staff modifica calendar_events"  on calendar_events for update to authenticated using (app_is_staff()) with check (app_is_staff());
create policy "Staff elimina calendar_events"   on calendar_events for delete to authenticated using (app_is_staff());

revoke all on calendar_events from anon;
