-- ════════════════════════════════════════════════════════
-- T&C Factory — Box Factory Lab: i task degli ordini da stampare sono di Matteo (2026-11-17)
--
-- Stampa DDT, preparazione dei file di stampa e lavorazione degli ordini Box Factory Lab:
-- Matteo primario. Lo script del mattino continua a salvare i DDT e chiude da solo i lotti fatti
-- (lavora per negozio, non guarda a chi è assegnato il lotto).
-- I task aperti di queste competenze passano a Matteo. Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into competenze_responsabili (voce, primario, secondario)
values ('boxfactorylab:ddt', 'matteo', null),
       ('boxfactorylab:preparazione', 'matteo', null),
       ('boxfactorylab:lavorazione', 'matteo', 'jacopo')
on conflict (voce) do update set primario = excluded.primario, secondario = excluded.secondario;

update tasks k
   set assegnato_a = 'matteo'
  from task_tipi p
 where p.id = k.tipo_id
   and k.macroarea = 'boxfactorylab'
   and coalesce(p.area, 'boxfactorylab') = 'boxfactorylab'
   and p.competenza in ('ddt', 'preparazione', 'lavorazione')
   and k.stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato', 'bloccato')
   and k.assegnato_a is distinct from 'matteo';
