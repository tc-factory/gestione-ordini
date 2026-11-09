# Automazione del mattino

Ogni mattina crea la cartella del giorno, il PDF dei DDT con il riepilogo in prima pagina e un PDF dei file di stampa per ogni negozio con Customily (Ciucciami, Box Factory Lab; file 23x43), chiamato "Negozio - primo-ultimo ordine.pdf" (es. "Ciucciami - 6373-6425.pdf"), poi mette il tag sugli ordini salvati.

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/python mattino.py --cartella "/Users/Shared/Creative System"            # prova: nessun tag
.venv/bin/python mattino.py --cartella "/Users/Shared/Creative System" --applica  # mette i tag
```

Per Box Factory Lab crea anche la cartellina `Box Factory Lab - DTF`. Dentro ci sono i fogli TIF (CMYK + SPOT, al massimo 57x100 cm) con le grafiche delle t-shirt, i nomi e le bandiere, più un'anteprima JPG per ogni foglio. Le regole e la libreria sono descritte in `dtf.py` e in `../box-factory-dtf/README.md`.

Regole:
- Entrano solo gli ordini non evasi, non annullati, pagati e senza i tag `stampato` e `auto-stampato`.
- Il tag `auto-stampato` si mette solo dopo aver riaperto e controllato i PDF.
- Sul DDT si nascondono solo i campi di servizio (`CAMPI_NASCOSTI`); nome, posizione e loghi restano visibili.
- Gli ordini da modificare hanno il DDT con la fascia rossa e restano fuori dal PDF di stampa.
- Se il file di Customily non è ancora pronto, l'ordine passa interamente al giorno dopo.
- Il giro non cancella e non sovrascrive nulla.
- Weekend, festivi e chiusure del Planner (`tc_giorno_lavorativo`): il giro si ferma subito e al rientro fa tutto in un'unica sessione.
- Ogni esecuzione, con il suo output, si legge in Centro di controllo → Automazioni.
- La pulizia della domenica alle 23:59 (`--pulisci`) cancella le cartelle con il nome a data.
- Il font Noto Sans è distribuito con licenza SIL Open Font License.

La chiave serve solo per la funzione `tc_mattino_dati` (`sql/automazione-mattino.sql`). Per revocarla basta cambiare il segreto nel Vault.

## Sul Mac mini

- Gira come servizio di sistema (`it.tcfactory.mattino.plist`) con l'utente `csauto`, anche se nessuno è collegato. Registro: `~/shopify-mattino/mattino.log`.
- Con `CS_PROVA=1` nel file `.env` il giro non mette tag e non chiude lotti.
- A fine giro chiama `tc_mattino_esito`. Se alle 5:30 non è arrivato nulla, il controllo in `sql/automazione-mattino-esito.sql` passa i lotti al secondario e apre un task di verifica.
