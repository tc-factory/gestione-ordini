-- T&C Factory — Riscontro pagamento con bonifico (2026-11-10)
-- Le mail con la contabile di un bonifico, o in cui il cliente dice di aver pagato con bonifico,
-- diventano un task "Riscontro pagamento con bonifico" (competenza bonifico, una voce per negozio)
-- assegnato a Lisa: controlla l'accredito, l'importo e l'ordine, poi segna l'ordine pagato.

insert into task_tipi (nome, minuti_standard, autonomia, descrizione, competenza, chiude_con_risposta)
values ('Riscontro pagamento con bonifico', 10, 'bozza',
        'Contabile o pagamento con bonifico: verificare accredito e importo, abbinare l''ordine e segnarlo pagato',
        'bonifico', false)
on conflict (nome) do update set competenza = excluded.competenza, chiude_con_risposta = excluded.chiude_con_risposta;

insert into competenze_responsabili (voce, primario, secondario) values
  ('ciucciamilcalzino:bonifico', 'lisa', null),
  ('bienjugado:bonifico',        'lisa', null),
  ('boxfactorylab:bonifico',     'lisa', null),
  ('asteroidi:bonifico',         'lisa', null)
on conflict (voce) do update set primario = excluded.primario;
