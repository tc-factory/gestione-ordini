-- ════════════════════════════════════════════════════════
-- T&C Factory — Lavorazioni con Claude Code: tutte a Riccardo
--
-- Il lavoro tecnico fatto con Claude Code su tutta la linea T&C Factory
-- (Creative System, Live Printing, Kamon: sviluppo, deploy, integrazioni e API con i fornitori)
-- ha un tipo di task suo, nell'area "Sviluppo", con Riccardo primario.
-- Il cervello lo usa per le mail di questo genere (categoria "sviluppo") e le assegna subito al primario.
-- I task già aperti di questo genere passano a Riccardo con il tipo nuovo.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into task_tipi (nome, descrizione, minuti_standard, competenza, area, autonomia)
values ('Lavorazione con Claude Code',
        'Lavoro tecnico fatto con Claude Code su Creative System, Live Printing o Kamon: sviluppo, errori e deploy, integrazioni e API con i fornitori.',
        60, 'claude_code', 'sviluppo', 'solo_task')
on conflict (nome) do update
   set descrizione = excluded.descrizione, competenza = excluded.competenza, area = excluded.area;

insert into competenze_responsabili (voce, primario)
values ('sviluppo:claude_code', 'riccardo')
on conflict (voce) do update set primario = excluded.primario;

-- Task aperti di sviluppo: deploy di Kamon, API e import ordini dei fornitori, negozio di prova Kamon
update tasks
   set assegnato_a = 'riccardo',
       tipo_id = (select id from task_tipi where nome = 'Lavorazione con Claude Code')
 where stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato', 'bloccato')
   and (titolo ~* '(deploy|railway|negozio test kamon)'
        or titolo ~* '(\mapi\M|\medi\M|import ordini)');
