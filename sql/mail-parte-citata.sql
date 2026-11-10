-- T&C Factory — Parte citata delle mail (2026-11-10)
-- mail-sync salva a parte le mail precedenti riportate sotto una risposta: il cervello legge solo
-- il testo nuovo, ma i dati già dati dal cliente (es. il telefono) si cercano anche qui.
-- null = non ancora letta (mail-sync la riempie poche alla volta), '' = nessuna parte citata.
alter table mail_messaggi add column if not exists testo_citato text;
