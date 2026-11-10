-- T&C Factory — Risposte automatiche alle mail (2026-11-10)
--
--   • spedizioni_tracking.cliente_gls: il codice cliente GLS che trova la spedizione nel webservice
--     XML (2067 T&C Factory, 5456 Bien Jugado). Lo usa gls-svincolo per scegliere le credenziali.
--   • "Stato ordine" passa ad Automatico: il cervello risponde da solo se non ha dubbi, l'ordine è
--     del mittente e la spedizione non ha problemi (controlli in cervello/index.ts).
--   • Info prodotto e preventivi restano task dell'operatore con bozza.

alter table spedizioni_tracking add column if not exists cliente_gls text;

update task_tipi set autonomia = 'automatico' where nome = 'Stato ordine';
update task_tipi set autonomia = 'bozza' where nome in ('Informazioni prodotto', 'Preventivo');
