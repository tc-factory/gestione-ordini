-- ════════════════════════════════════════════════════════
-- T&C Factory — Tempi di invio delle mail
--
-- _shared/mail.ts salva qui quanto dura ogni passo dell'invio (preparazione, smtp, salvataggio,
-- copia_inviata, in millisecondi) e se la copia in Inviata è riuscita. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_messaggi add column if not exists invio jsonb;
