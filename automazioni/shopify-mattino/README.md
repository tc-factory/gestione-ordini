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
- Entrano solo gli ordini non evasi, non annullati, pagati e senza tag.
- Il tag si mette solo dopo aver riaperto e controllato i PDF.
- Gli ordini da modificare hanno il DDT con la fascia rossa e restano fuori dal PDF di stampa.
- Se il file di Customily non è ancora pronto, l'ordine passa interamente al giorno dopo.
- Lo script non cancella e non sovrascrive mai nulla.
- Il font Noto Sans è distribuito con licenza SIL Open Font License.

La chiave serve solo per la funzione `tc_mattino_dati` (`sql/automazione-mattino.sql`). Per revocarla basta cambiare il segreto nel Vault.
