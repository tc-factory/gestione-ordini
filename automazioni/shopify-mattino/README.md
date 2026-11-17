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
- Entrano gli ordini non evasi, non annullati e senza i tag `stampato` e `auto-stampato`.
- Gli ordini non pagati hanno solo il DDT, con la fascia rossa "ORDINE NON PAGATO": niente file di stampa, fogli DTF né tag, così ripassano ogni mattina finché non vengono pagati.
- Il tag `auto-stampato` si mette solo dopo aver riaperto e controllato i PDF.
- Sul DDT si nascondono solo i campi di servizio (`CAMPI_NASCOSTI`); nome, posizione e loghi restano visibili.
- Gli ordini da modificare hanno il DDT con la fascia rossa e restano fuori dal PDF di stampa.
- Se il file di Customily non è ancora pronto, l'ordine passa interamente al giorno dopo.
- Il giro non cancella e non sovrascrive nulla.
- Weekend, festivi e chiusure del Planner (`tc_giorno_lavorativo`): il giro si ferma subito e al rientro fa tutto in un'unica sessione.
- Ogni esecuzione, con il suo output, si legge in Centro di controllo → Automazioni.
- A fine giro (dopo tag ed esito) la cartella del giorno, con la sottocartella DTF, viene copiata nella scheda **Stampe del giorno** del gestionale (bucket privato `file-mattino`, `sql/file-mattino.sql`), da cui si scaricano i file. I link di caricamento li dà la funzione `file-mattino` con la stessa chiave dello script. Se il caricamento non riesce, i file restano nella cartella condivisa e il registro lo segnala. La pulizia della domenica applica la stessa regola anche lì.
- `--rigenera AAAA-MM-GG --dal ISO --al ISO` rifà DDT e file di stampa di un giorno già fatto (es. cartella cancellata): prende gli ordini con `auto-stampato` creati in quella fascia, anche se evasi, e non mette tag né manda l'esito.
- La pulizia della domenica alle 23:59 (`--pulisci`) cancella le cartelle con il nome a data, tranne l'ultima generata (di solito quella del venerdì, che si stampa ancora il lunedì).
- Il font Noto Sans è distribuito con licenza SIL Open Font License.

La chiave serve solo per la funzione `tc_mattino_dati` (`sql/automazione-mattino.sql`). Per revocarla basta cambiare il segreto nel Vault.

## Sul Mac mini

- Gira come servizio di sistema (`it.tcfactory.mattino.plist`) con l'utente `csauto`, anche se nessuno è collegato. Registro: `~/shopify-mattino/mattino.log`.
- Con `CS_PROVA=1` nel file `.env` il giro non mette tag e non chiude lotti.
- A fine giro chiama `tc_mattino_esito`. Se alle 5:30 non è arrivato nulla, il controllo in `sql/automazione-mattino-esito.sql` passa i lotti al secondario e apre un task di verifica.

## Sul server (Railway)

Lo stesso script gira in un container sul progetto Railway `creative-system` dell'account T&C (servizio `mattino`, disco `mattino-dati` su /data, Amsterdam; configurazione in `.railway/railway.ts`, si applica con `npm install`, `railway config plan` e `railway config apply`; si pubblica con `railway up --service mattino`): programmazione `0 3,4 * * *` in UTC e `--solo-ora 5`, così parte alle 5 di Roma sia con l'ora solare sia con quella legale (l'altra esecuzione esce subito senza scrivere nulla).

- `--libreria-remota`: la libreria DTF (grafiche, bandiere, `mappa-prodotti.csv`, font Impact) arriva dal bucket privato `dtf-libreria` (`sql/dtf-libreria.sql`) tramite la funzione `file-mattino`, azione `libreria`; si scaricano solo i file nuovi o cambiati in `/data` (volume). Una grafica nuova va caricata anche lì.
- Variabili: `CS_SUPABASE_URL`, `CS_ANON_KEY`, `CS_AUTOMAZIONE_KEY`, `CS_CANCELLA_DOPO_CARICAMENTO=1` (la cartella del giorno si cancella solo se è tutta nel gestionale).
- Mattine di prova, affiancate al Mac in sede: `CS_PROVA=1` (niente tag né esito), `CS_PREFISSO_GESTIONALE=prova-server` (i file vanno in `prova-server/AAAA-MM-GG`, che la scheda non mostra), `CS_NOME_REGISTRO=mattino-server` (registro a parte). Per passare al server vero si tolgono queste tre e si fermano i servizi sul Mac.
- La pulizia della domenica del bucket la fa il Mac in sede (`--pulisci`, anche `prova-server/`); col server vero servirà un secondo servizio Railway con `--pulisci`.
