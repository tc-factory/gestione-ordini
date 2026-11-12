-- ════════════════════════════════════════════════════════
-- T&C Factory — Deposito GLS delle spedizioni
--
-- tracking-check salva qui la sede GLS di destinazione (indirizzo, telefono) e il luogo
-- dell'ultimo evento: servono per dire al cliente dove ritirare un pacco in giacenza.
-- { sede, indirizzo, cap, provincia, telefono, luogo_eventi, coincide }
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table spedizioni_tracking add column if not exists deposito jsonb;
