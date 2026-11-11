-- ════════════════════════════════════════════════════════
-- T&C Factory — Firme dei negozi con il logo (2026-11-11)
-- Loghi presi dai siti dei negozi (Asteroidi e Bienjugado in versione scura per lo sfondo bianco),
-- caricati in mail-firme/negozi/<casella>-logo.png. Nessun numero di telefono nelle firme.
-- Le persone senza un'immagine loro usano questo logo (_shared/mail.ts). Si può rieseguire.
-- ════════════════════════════════════════════════════════
insert into mail_firme_negozio (casella_id, testo, immagine, larghezza, aggiornato_da) values
  ('ciucciamilcalzino', E'Ciucciami il Calzino\nwww.ciucciamilcalzino.it', 'negozi/ciucciamilcalzino-logo.png', 160, 'claude'),
  ('bienjugado',        E'Bienjugado\nwww.bienjugado.it',               'negozi/bienjugado-logo.png',        160, 'claude'),
  ('boxfactorylab',     E'Box Factory Lab\nwww.boxfactorylab.it',       'negozi/boxfactorylab-logo.png',     120, 'claude'),
  ('asteroidi',         E'Asteroidi Store\nwww.asteroidistore.it',      'negozi/asteroidi-logo.png',         160, 'claude')
on conflict (casella_id) do update set testo = excluded.testo, immagine = excluded.immagine,
  larghezza = excluded.larghezza, aggiornato_da = excluded.aggiornato_da, aggiornato_at = now();
