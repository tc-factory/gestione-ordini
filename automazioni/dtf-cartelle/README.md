# Numeri alle cartelle DTF

Mette davanti alle cartelle di `DATI/DTF/1. Stampa/1. Stampare` il numero dell'ordine
nella lista **DTF interno → Da stampare** (`01 - cf pavia`, `02 - …`).

- Il gestionale (`js/dtf-cartella.js`) legge la cartella da Chrome e, quando arriva un DTF
  nuovo o con **Numera ora**, salva i nomi in `app_settings.dtf_cartelle_numeri`.
- Chrome non può rinominare su un disco di rete: lo fa `dtf_cartelle.py`, ogni minuto,
  sul Mac che ha il NAS montato (legge i nomi con `tc_dtf_cartelle_piano`, `sql/dtf-cartelle.sql`).
- Non tocca le cartelle "Stampato" né i file sciolti. Scrive nel registro del Centro di
  controllo solo quando rinomina qualcosa.

Installazione: creare `~/Library/Application Support/TC DTF/config.json` con
`{"url": "...", "anon": "...", "chiave": "<chiave automazioni dal Vault>"}` e lanciare
`zsh installa.zsh`. Registro: `~/Library/Application Support/TC DTF/dtf-cartelle.log`.
