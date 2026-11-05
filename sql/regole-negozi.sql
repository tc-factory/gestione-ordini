-- ════════════════════════════════════════════════════════
-- T&C Factory — Regole dei negozi a campi (Centro di controllo → Cervello)
-- campi: { 'sezione.voce': valore, altre: [{ voce, valore }] }; testo è la versione letta dal cervello,
-- riscritta dalla pagina a ogni salvataggio. Valori iniziali presi dalle politiche dei siti.
-- Richiede cervello-2.sql già eseguito. Non sovrascrive campi già compilati.
-- ════════════════════════════════════════════════════════

alter table negozi_conoscenza add column if not exists campi jsonb not null default '{}';

update negozi_conoscenza set campi = $j${"spedizioni.corriere": "GLS", "spedizioni.preparazione": "Evasione entro 48/72 ore, festivi esclusi. Nessuna spedizione nel weekend e nei festivi", "spedizioni.consegna": "24/48 ore lavorative", "spedizioni.costi": "Indicati al checkout", "spedizioni.tracking": "Inviato via email alla spedizione", "resi.tempo": "14 giorni dalla ricezione", "resi.condizioni": "Articolo come ricevuto: non indossato né usato, con cartellini e imballaggio originale, con prova d'acquisto", "resi.esclusi": "Personalizzati (salvo difetti di fabbrica), articoli in promo, buoni regalo", "resi.come": "Scrivere a info@ciucciamilcalzino.it: se accettato inviamo etichetta e istruzioni. Senza richiesta il reso non viene accettato", "resi.indirizzo": "Via dei Calzolai, 92 - 55041 Camaiore (LU)", "cambi.possibile": "No", "cambi.come": "Si restituisce l'articolo e, accettato il reso, si acquista il nuovo a parte", "rimborsi.tempi": "Entro 10 giorni lavorativi dall'approvazione del reso. Oltre 15 il cliente ci ricontatta", "rimborsi.metodo": "Metodo di pagamento originale", "ordini.danni": "Il cliente ci contatta subito alla ricezione: valutiamo e risolviamo", "assistenza.firma": "Ciucciami il Calzino"}$j$::jsonb, testo = $t$SPEDIZIONI
- Corriere: GLS
- Tempi di preparazione: Evasione entro 48/72 ore, festivi esclusi. Nessuna spedizione nel weekend e nei festivi
- Tempi di consegna: 24/48 ore lavorative
- Costi di spedizione: Indicati al checkout
- Tracking: Inviato via email alla spedizione

RESI
- Tempo per chiedere il reso: 14 giorni dalla ricezione
- Condizioni: Articolo come ricevuto: non indossato né usato, con cartellini e imballaggio originale, con prova d'acquisto
- Articoli esclusi: Personalizzati (salvo difetti di fabbrica), articoli in promo, buoni regalo
- Come si chiede: Scrivere a info@ciucciamilcalzino.it: se accettato inviamo etichetta e istruzioni. Senza richiesta il reso non viene accettato
- Indirizzo per i resi: Via dei Calzolai, 92 - 55041 Camaiore (LU)

CAMBI
- Si può cambiare?: No
- Come funziona: Si restituisce l'articolo e, accettato il reso, si acquista il nuovo a parte

RIMBORSI
- Tempi: Entro 10 giorni lavorativi dall'approvazione del reso. Oltre 15 il cliente ci ricontatta
- Metodo: Metodo di pagamento originale

ORDINI
- Prodotto danneggiato o sbagliato: Il cliente ci contatta subito alla ricezione: valutiamo e risolviamo

ASSISTENZA
- Firma delle mail: Ciucciami il Calzino$t$, aggiornato_at = now() where store_id = 'ciucciamilcalzino' and campi = '{}'::jsonb;
update negozi_conoscenza set campi = $j${"spedizioni.preparazione": "Entro 1 giorno lavorativo. Ordini dopo mezzogiorno, nel weekend o nei festivi: dal giorno lavorativo successivo", "spedizioni.consegna": "Stimati al checkout, non garantiti", "spedizioni.costi": "Calcolati al checkout", "spedizioni.gratuita": "Possibile su alcuni ordini, indicata al checkout", "spedizioni.destinazioni": "Italia", "spedizioni.tracking": "Email con tracking alla spedizione", "resi.tempo": "30 giorni dalla ricezione (nell'UE sempre 14 giorni di ripensamento senza motivo)", "resi.condizioni": "Articolo come ricevuto: non indossato né usato, con cartellini e imballaggio originale, con prova d'acquisto", "resi.esclusi": "Personalizzati o su misura, articoli in promo, buoni regalo", "resi.come": "Scrivere a info@asteroidistore.it: se accettato inviamo etichetta e istruzioni. Senza richiesta il reso non viene accettato", "resi.indirizzo": "T&C Factory srl, Via dei Calzolai, 92 - 55041 Camaiore (LU)", "cambi.possibile": "No", "cambi.come": "Si restituisce l'articolo e, accettato il reso, si acquista il nuovo a parte", "rimborsi.tempi": "Entro 10 giorni lavorativi dall'approvazione del reso. Oltre 15 il cliente ci ricontatta", "rimborsi.metodo": "Metodo di pagamento originale", "ordini.modifiche": "Possibili prima della spedizione se il cliente scrive subito. Dopo la spedizione no", "ordini.danni": "Il cliente ci contatta: aiutiamo con il corriere e risolviamo", "assistenza.firma": "Asteroidi Store"}$j$::jsonb, testo = $t$SPEDIZIONI
- Tempi di preparazione: Entro 1 giorno lavorativo. Ordini dopo mezzogiorno, nel weekend o nei festivi: dal giorno lavorativo successivo
- Tempi di consegna: Stimati al checkout, non garantiti
- Costi di spedizione: Calcolati al checkout
- Spedizione gratuita: Possibile su alcuni ordini, indicata al checkout
- Dove spediamo: Italia
- Tracking: Email con tracking alla spedizione

RESI
- Tempo per chiedere il reso: 30 giorni dalla ricezione (nell'UE sempre 14 giorni di ripensamento senza motivo)
- Condizioni: Articolo come ricevuto: non indossato né usato, con cartellini e imballaggio originale, con prova d'acquisto
- Articoli esclusi: Personalizzati o su misura, articoli in promo, buoni regalo
- Come si chiede: Scrivere a info@asteroidistore.it: se accettato inviamo etichetta e istruzioni. Senza richiesta il reso non viene accettato
- Indirizzo per i resi: T&C Factory srl, Via dei Calzolai, 92 - 55041 Camaiore (LU)

CAMBI
- Si può cambiare?: No
- Come funziona: Si restituisce l'articolo e, accettato il reso, si acquista il nuovo a parte

RIMBORSI
- Tempi: Entro 10 giorni lavorativi dall'approvazione del reso. Oltre 15 il cliente ci ricontatta
- Metodo: Metodo di pagamento originale

ORDINI
- Modifiche e annullamenti: Possibili prima della spedizione se il cliente scrive subito. Dopo la spedizione no
- Prodotto danneggiato o sbagliato: Il cliente ci contatta: aiutiamo con il corriere e risolviamo

ASSISTENZA
- Firma delle mail: Asteroidi Store$t$, aggiornato_at = now() where store_id = 'asteroidi' and campi = '{}'::jsonb;
update negozi_conoscenza set campi = $j${"resi.tempo": "14 giorni lavorativi dalla ricezione", "resi.condizioni": "Non usati, indossati, lavati o danneggiati, nella confezione originale, in una sola spedizione, consegnati al corriere entro 14 giorni lavorativi", "resi.esclusi": "Personalizzati (con nome o con colore di stampa scelto)", "resi.come": "Email a info@bienjugado.it con numero d'ordine e codici articolo: il cliente riceve le istruzioni", "resi.indirizzo": "Via dei Calzolai, 92 - 55041 Camaiore (LU)", "resi.costi": "Il cliente, salvo danni di trasporto o errori nostri (in quel caso mandiamo noi il corriere e rimborsiamo la spedizione)", "cambi.possibile": "No, non effettuiamo il cambio merce", "cambi.come": "Prima dell'ordine consigliare le tabelle taglie o l'assistenza", "rimborsi.tempi": "Entro 30 giorni dal ricevimento del reso", "rimborsi.metodo": "Stesso metodo del pagamento. Contrassegno: PayPal o bonifico, a scelta del cliente", "rimborsi.trattenute": "5,90 € per il costo del servizio", "assistenza.orari": "Lunedì–venerdì", "assistenza.firma": "Bienjugado"}$j$::jsonb, testo = $t$RESI
- Tempo per chiedere il reso: 14 giorni lavorativi dalla ricezione
- Condizioni: Non usati, indossati, lavati o danneggiati, nella confezione originale, in una sola spedizione, consegnati al corriere entro 14 giorni lavorativi
- Articoli esclusi: Personalizzati (con nome o con colore di stampa scelto)
- Come si chiede: Email a info@bienjugado.it con numero d'ordine e codici articolo: il cliente riceve le istruzioni
- Indirizzo per i resi: Via dei Calzolai, 92 - 55041 Camaiore (LU)
- Chi paga la spedizione del reso: Il cliente, salvo danni di trasporto o errori nostri (in quel caso mandiamo noi il corriere e rimborsiamo la spedizione)

CAMBI
- Si può cambiare?: No, non effettuiamo il cambio merce
- Come funziona: Prima dell'ordine consigliare le tabelle taglie o l'assistenza

RIMBORSI
- Tempi: Entro 30 giorni dal ricevimento del reso
- Metodo: Stesso metodo del pagamento. Contrassegno: PayPal o bonifico, a scelta del cliente
- Trattenute: 5,90 € per il costo del servizio

ASSISTENZA
- Orari: Lunedì–venerdì
- Firma delle mail: Bienjugado$t$, aggiornato_at = now() where store_id = 'bienjugado' and campi = '{}'::jsonb;
update negozi_conoscenza set campi = $j${"resi.tempo": "7 giorni lavorativi dalla consegna, solo per articoli difettosi", "resi.esclusi": "Personalizzati per ripensamento (sì in caso di capo fallato o stampa difettosa)", "resi.come": "Email a info@boxfactorylab.it: risposta entro 24 ore", "resi.costi": "Il cliente", "cambi.possibile": "Sì, per articoli difettosi", "cambi.come": "Cambio con altri prodotti o rimborso", "rimborsi.tempi": "Appena riceviamo la merce", "rimborsi.metodo": "Stesso metodo del pagamento", "assistenza.firma": "Box Factory Lab"}$j$::jsonb, testo = $t$RESI
- Tempo per chiedere il reso: 7 giorni lavorativi dalla consegna, solo per articoli difettosi
- Articoli esclusi: Personalizzati per ripensamento (sì in caso di capo fallato o stampa difettosa)
- Come si chiede: Email a info@boxfactorylab.it: risposta entro 24 ore
- Chi paga la spedizione del reso: Il cliente

CAMBI
- Si può cambiare?: Sì, per articoli difettosi
- Come funziona: Cambio con altri prodotti o rimborso

RIMBORSI
- Tempi: Appena riceviamo la merce
- Metodo: Stesso metodo del pagamento

ASSISTENZA
- Firma delle mail: Box Factory Lab$t$, aggiornato_at = now() where store_id = 'boxfactorylab' and campi = '{}'::jsonb;
