-- ════════════════════════════════════════════════════════
-- T&C Factory — Costi del gestionale (Centro di controllo → Costi)
--
-- Solo i servizi che costano davvero. Claude (API) non sta qui: il costo arriva
-- da cervello_consumi. Importi in dollari, come li fatturano i servizi.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists costi_gestionale (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  importo     numeric(10,2) not null default 0 check (importo >= 0),
  periodo     text not null default 'mese' check (periodo in ('mese', 'anno')),
  nota        text not null default '',
  ordine      int not null default 0,
  created_at  timestamptz not null default now()
);
alter table costi_gestionale enable row level security;
drop policy if exists "Admin gestisce costi" on costi_gestionale;
create policy "Admin gestisce costi" on costi_gestionale for all to authenticated using (app_is_admin()) with check (app_is_admin());

insert into costi_gestionale (nome, importo, periodo, nota, ordine) values
  ('Supabase', 25, 'mese', 'Piano Pro: database, funzioni e file. Il server del gestionale rientra nei 10 $ di crediti compresi', 1),
  ('Railway', 5, 'mese', 'Piano Hobby: server del mattino e sito cs.pngs.it. Consumo compreso fino a 5 $', 2)
on conflict (nome) do nothing;

-- Mese per mese: da quando si paga ogni servizio (primo giorno del mese)
alter table costi_gestionale add column if not exists dal date not null default date_trunc('month', now())::date;
update costi_gestionale set dal = '2026-10-01' where nome = 'Supabase' and dal = '2026-11-01';

-- Spesa di Claude per giorno (ora di Roma), senza le prove dei modelli
create or replace view cervello_costo_giorni with (security_invoker = true) as
  select (at at time zone 'Europe/Rome')::date as giorno, sum(costo_usd) as usd, count(*) as chiamate
  from cervello_consumi where not prova group by 1;
