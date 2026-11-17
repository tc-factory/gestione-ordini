# Agente di stampa (SC-F500)

Ponte tra la scheda **Stampe del giorno** del gestionale e le stampanti della sede. Dal gestionale si aprono i PDF dei calzini, si scelgono con la casella e "Stampa" chiede stampante, formato (23×43 cm, carta in rotolo, aggraffa dai margini), qualità, alta velocità, massimo dettaglio, pagine e copie; i lavori vanno nella coda `stampa_coda` (`sql/stampa-coda.sql`). Questo agente, su un Mac in sede che vede le stampanti, ogni 10 secondi prende il lavoro più vecchio, usa il PDF della cartella del mattino (o lo scarica dal gestionale se non c'è), lo manda alla stampante con `lp` e le impostazioni di `stampanti.json`, aspetta che la stampante l'abbia ricevuto e scrive l'esito. Nel gestionale si vede lo stato e se il Mac risponde.

## Sul Mac mini

- File in `/Users/csauto/stampa`: `agente_stampa.py`, `stampanti.json` (copiato da `stampanti.esempio.json`), registro `stampa.log`.
- Usa il Python e il file `.env` dello script del mattino (`/Users/csauto/shopify-mattino`).
- Servizio di sistema `it.tcfactory.stampa` (sempre acceso, riparte da solo). Si installa con un account amministratore:
  `sudo cp it.tcfactory.stampa.plist /Library/LaunchDaemons/ && sudo launchctl bootstrap system /Library/LaunchDaemons/it.tcfactory.stampa.plist`

## Impostazioni della stampante

`stampanti.json`: per ogni stampante la coda CUPS (`lpstat -p`), le opzioni del driver (`lpoptions -p Epson_2 -l`, i valori del preset "Calzini") e `pronta`. Finché `pronta` è `false` l'agente non stampa: il lavoro va in errore con il motivo. Va messa a `true` solo dopo la stampa di prova confrontata con quella da Illustrator.

## Stampanti e impostazioni dal gestionale

- Ogni voce di `stampanti.json` ha un `nome` (quello che si vede nel gestionale): l'agente manda l'elenco a ogni domanda e prende solo i lavori delle sue stampanti. Per la seconda SC-F500 si aggiunge una voce (es. `sc-f500-2`) con la sua coda CUPS.
- Le scelte del popup "Stampa" diventano opzioni del driver (`opzioni_driver` in `agente_stampa.py`, nomi del PPD della SC-F500): dimensione `PageSize=Custom.230x430mm`, carta in rotolo `EPIJ_FdSo=16`, aggraffa dai margini `EPIJ_JustSize=2`, qualità `EPIJ_Mode=3` + `EPIJ_Qual` 502/503/504 (Velocità/Qualità/Qualità massima), alta velocità `EPIJ_Bi_D`, massimo dettaglio `EPIJ_FDet`, pagine `page-ranges`, copie `lp -n`. Vincono sulle `opzioni` di base di `stampanti.json`.
