-- ════════════════════════════════════════════════════════
-- T&C Factory — Costi del cervello (2026-11-11)
--
--   • cervello_consumi: token e costo di ogni chiamata a Claude (prova = chiamate della prova modelli)
--   • cervello_prove: la stessa mail rianalizzata da un altro modello, per confrontare le bozze.
--     Non crea task e non scrive ai clienti.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists cervello_consumi (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  evento_id     uuid,
  mail_id       uuid,
  modello       text not null,
  input         int not null default 0,
  output        int not null default 0,
  cache_letti   int not null default 0,
  cache_scritti int not null default 0,
  costo_usd     numeric(10,5) not null default 0,
  prova         boolean not null default false
);
create index if not exists cervello_consumi_at_idx on cervello_consumi (at desc);
alter table cervello_consumi enable row level security;
drop policy if exists "Admin legge consumi cervello" on cervello_consumi;
create policy "Admin legge consumi cervello" on cervello_consumi for select to authenticated using (app_is_admin());
revoke all on cervello_consumi from anon, authenticated;
grant select on cervello_consumi to authenticated;

create table if not exists cervello_prove (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  mail_id       uuid not null,
  evento_id     uuid,
  modello       text not null,
  risultato     jsonb,
  errore        text,
  ms            int,
  input         int,
  output        int,
  cache_letti   int,
  cache_scritti int,
  costo_usd     numeric(10,5)
);
create index if not exists cervello_prove_mail_idx on cervello_prove (mail_id, modello);
alter table cervello_prove enable row level security;
revoke all on cervello_prove from anon, authenticated;   -- solo dal servizio
