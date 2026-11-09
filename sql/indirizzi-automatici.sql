-- ════════════════════════════════════════════════════════
-- T&C Factory — Cambio automatico dell'indirizzo di spedizione
--
-- autenticazione: l'intestazione Authentication-Results messa da Aruba. Serve a sapere
-- se il mittente è davvero chi dice di essere prima di toccare un ordine.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_messaggi add column if not exists autenticazione text;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
