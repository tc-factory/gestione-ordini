# Automazione del mattino

Ogni mattina crea la cartella del giorno, il PDF dei DDT con il riepilogo in prima pagina e il PDF dei file di stampa di Ciucciami, poi mette il tag sugli ordini salvati.

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python mattino.py --cartella "/Users/Shared/Creative System"            # prova: nessun tag
.venv/bin/python mattino.py --cartella "/Users/Shared/Creative System" --applica  # mette i tag
```

Regole:
- Entrano solo gli ordini non evasi, non annullati, pagati e senza i tag `stampato` e `auto-stampato`.
- Il tag `auto-stampato` si mette solo dopo aver riaperto e controllato i PDF.
- Sul DDT si nascondono solo i campi di servizio (`CAMPI_NASCOSTI`); nome, posizione e loghi restano visibili.
- Gli ordini da modificare hanno il DDT con la fascia rossa e restano fuori dal PDF di stampa.
- Se il file di Customily non è ancora pronto, l'ordine passa interamente al giorno dopo.
- Lo script non cancella e non sovrascrive mai nulla.
- Il font Noto Sans è distribuito con licenza SIL Open Font License.

La chiave serve solo per la funzione `tc_mattino_dati` (`sql/automazione-mattino.sql`). Per revocarla basta cambiare il segreto nel Vault.

## Sul Mac mini

- Gira come servizio di sistema (`it.tcfactory.mattino.plist`) con l'utente `csauto`, anche se nessuno è collegato. Registro: `~/shopify-mattino/mattino.log`.
- Con `CS_PROVA=1` nel file `.env` il giro non mette tag e non chiude lotti.
- A fine giro chiama `tc_mattino_esito`. Se alle 5:30 non è arrivato nulla, il controllo in `sql/automazione-mattino-esito.sql` passa i lotti al secondario e apre un task di verifica.
