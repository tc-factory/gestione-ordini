-- ════════════════════════════════════════════════════════
-- T&C Factory — Riscontro dei dati di ogni ordine appena arriva
--
-- La funzione ordini-dati (ogni 5 minuti) cerca la via di ogni ordine nuovo sulle mappe
-- (OpenStreetMap, servizio Photon): esiste in quel comune? È scritta giusta?
--   corretta     → manca solo "Via"/"Piazza" ("25 aprile 19" → "Via 25 Aprile 19"):
--                  in Automatica la corregge su Shopify (tag indirizzo-corretto)
--   simile       → quasi uguale a una via vera: la scheda Shop la mostra con il suggerimento
--   ambigua      → manca il tipo e in zona ci sono sia la via sia la piazza
--   non_trovata  → nel comune non c'è niente che le somigli
-- Modalità (scheda Automazioni): prova = segnala soltanto; automatica = segnala e corregge i casi sicuri.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists ordini_verifiche (
  ordine_id     uuid primary key references shopify_orders(id) on delete cascade,
  store_id      text not null,
  impronta      text not null,              -- via|cap|città verificati: se cambiano si riverifica
  esito         text not null,              -- ok, corretta, simile, ambigua, non_trovata, non_verificabile
  nota          text,
  suggerimento  text,                       -- simile/ambigua: com'è sulle mappe
  prima         text,                       -- corretta: la riga com'era
  dopo          text,                       -- corretta: la riga corretta
  corretta_at   timestamptz,                -- quando è stata scritta su Shopify (null = solo segnalata)
  verificata_at timestamptz not null default now()
);
create index if not exists ordini_verifiche_avvisi_idx on ordini_verifiche (esito) where esito in ('simile', 'ambigua', 'non_trovata', 'corretta');

alter table ordini_verifiche enable row level security;
drop policy if exists "Staff legge verifiche ordini" on ordini_verifiche;
create policy "Staff legge verifiche ordini" on ordini_verifiche for select to authenticated using (app_is_staff());
revoke all on ordini_verifiche from anon, authenticated;
grant select on ordini_verifiche to authenticated;

-- Parte in Automatica: corregge solo quando manca "Via"/"Piazza" e la via è unica in quel comune
insert into automazioni_impostazioni (nome, modo) values ('verifica-indirizzi', 'automatica') on conflict (nome) do nothing;
