-- ════════════════════════════════════════════════════════
-- T&C Factory — Eventi social non più "in attesa per sempre"
--
-- Il cervello legge solo le mail: i messaggi e i commenti di Messenger/Instagram arrivati dal
-- webhook restavano con elaborato_at vuoto. Ora meta-webhook li segna subito come elaborati
-- (il messaggio è comunque salvato nelle conversazioni del Brand); questo allinea quelli già arrivati.
-- ════════════════════════════════════════════════════════

update eventi
   set elaborato_at = coalesce(elaborato_at, now()),
       esito = coalesce(esito, 'Solo conversazione: il cervello non legge ancora i messaggi social')
 where fonte in ('messenger', 'instagram') and elaborato_at is null;
