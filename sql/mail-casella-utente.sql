-- ════════════════════════════════════════════════════════
-- T&C Factory — Login della casella diverso dall'indirizzo (2026-11-11)
--   info@tcfactory.it si invia entrando con riccardo@tcfactory.it (la casella vera; info@ è il mittente).
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════
alter table mail_caselle add column if not exists utente text;   -- vuoto = l'indirizzo stesso
update mail_caselle set utente = 'riccardo@tcfactory.it' where id = 'tcfactory';
