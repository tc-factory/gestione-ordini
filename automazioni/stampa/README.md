# Agente di stampa (SC-F500)

Ponte tra la scheda **File del mattino** del gestionale e le stampanti della sede. Dal gestionale si clicca "Invia alla SC-F500" su un PDF dei calzini; il lavoro va nella coda `stampa_coda` (`sql/stampa-coda.sql`). Questo agente, su un Mac in sede che vede le stampanti, ogni 10 secondi prende il lavoro più vecchio, usa il PDF della cartella del mattino (o lo scarica dal gestionale se non c'è), lo manda alla stampante con `lp` e le impostazioni di `stampanti.json`, aspetta che la stampante l'abbia ricevuto e scrive l'esito. Nel gestionale si vede lo stato e se il Mac risponde.

## Sul Mac mini

- File in `/Users/csauto/stampa`: `agente_stampa.py`, `stampanti.json` (copiato da `stampanti.esempio.json`), registro `stampa.log`.
- Usa il Python e il file `.env` dello script del mattino (`/Users/csauto/shopify-mattino`).
- Servizio di sistema `it.tcfactory.stampa` (sempre acceso, riparte da solo). Si installa con un account amministratore:
  `sudo cp it.tcfactory.stampa.plist /Library/LaunchDaemons/ && sudo launchctl bootstrap system /Library/LaunchDaemons/it.tcfactory.stampa.plist`

## Impostazioni della stampante

`stampanti.json`: per ogni stampante la coda CUPS (`lpstat -p`), le opzioni del driver (`lpoptions -p Epson_2 -l`, i valori del preset "Calzini") e `pronta`. Finché `pronta` è `false` l'agente non stampa: il lavoro va in errore con il motivo. Va messa a `true` solo dopo la stampa di prova confrontata con quella da Illustrator.
