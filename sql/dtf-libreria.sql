-- ════════════════════════════════════════════════════════
-- T&C Factory — Libreria DTF di Box Factory Lab per il server del mattino
--
-- Il server (Railway) non ha la cartella del Mac in sede: legge da qui grafiche/ (TIF CMYK FOGRA39),
-- bandiere/, mappa-prodotti.csv e il font dei nomi (Impact). Bucket privato, nessun accesso dal
-- gestionale: lo legge solo la funzione file-mattino per lo script, con la sua chiave.
-- Gli originali restano sul NAS e sul Mac mini: qui va solo quello che serve per i fogli.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit)
values ('dtf-libreria', 'dtf-libreria', false, null)
on conflict (id) do update set public = false;
