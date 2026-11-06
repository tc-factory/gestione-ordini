-- ════════════════════════════════════════════════════════
-- T&C Factory — I tipi di task della linea produttiva seguono le competenze nuove
--
-- Valgono sempre per l'area Linea produttiva, anche se un task viene creato a mano con un negozio:
-- in quelle aree queste competenze non esistono e il task resterebbe senza responsabile.
-- I task già aperti seguono da soli, perché la competenza si legge dal tipo.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

update task_tipi t
   set competenza = v.competenza, area = 'produzione'
  from (values
    ('Controllare Ricamo',        'check_ricamo'),
    ('Controllare Serigrafia',    'check_serigrafia'),
    ('Controllare Manifattura',   'check_manifattura'),
    ('Controllare Arti grafiche', 'check_arti'),
    ('Lavorazione UV',            'stampa_uv'),
    ('Lavorazione Laser',         'incisione_laser'),
    ('Preparazione DTF',          'prep_file'),
    ('Ordinare la merce',         'ordine_fornitori'),
    ('Preparazione merce',        'creazione_pacchi'),
    ('Emettere fattura',          'fatturazione'),
    ('Incassare',                 'check_pagamento')
  ) v(nome, competenza)
 where t.nome = v.nome;

-- Voce tolta da Linea produttiva: la riga conterebbe ancora nelle competenze della persona
delete from competenze_responsabili where voce = 'produzione:amministrazione';
