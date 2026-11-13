-- ════════════════════════════════════════════════════════
-- Casella info@liveprinting.it (Aruba), letta come quelle dei negozi.
-- Password nel secret MAIL_PASSWORD_LIVEPRINTING (lo imposta l'utente).
-- Si legge solo da attiva_dal in poi. Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into mail_caselle (id, indirizzo, nome) values
  ('liveprinting', 'info@liveprinting.it', 'Live Printing')
on conflict (id) do update set indirizzo = excluded.indirizzo, nome = excluded.nome;

insert into mail_firme_negozio (casella_id, testo, aggiornato_da) values
  ('liveprinting', E'Live Printing\nwww.liveprinting.it', 'claude')
on conflict (casella_id) do nothing;
