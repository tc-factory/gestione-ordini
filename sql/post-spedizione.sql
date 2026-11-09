-- ════════════════════════════════════════════════════════
-- T&C Factory — Competenza "Gestione post spedizione", separata da "Spedizione"
--
-- Spedizione = confezionare e spedire. Post spedizione = quello che succede dopo:
-- tracking mancante, problemi di consegna segnalati dal tracking GLS.
-- Al primo passaggio la nuova voce prende gli stessi primario e secondario della Spedizione
-- di ogni area, così i task non restano senza responsabile; poi si cambiano dalla scheda Competenze.
-- Richiede competenze-responsabili.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

update task_tipi set competenza = 'post_spedizione'
 where nome in ('Tracking mancante', 'Problema di consegna');

insert into competenze_responsabili (voce, primario, secondario)
  select replace(voce, ':spedizione', ':post_spedizione'), primario, secondario
    from competenze_responsabili
   where voce like '%:spedizione'
on conflict (voce) do nothing;
