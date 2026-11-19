# Cartella DTF "1. Stampare" → gestionale

`dtf_cartella.py` gira ogni minuto sul **Mac mini** (utente `csauto`), così funziona per
tutti i PC, anche Windows, senza collegare niente nel browser.

- Il gestionale pubblica la lista **DTF interno → Da stampare** già in ordine
  (`app_settings.dtf_lista`, `js/dtf-cartella.js`).
- Lo script abbina ogni sottocartella a un ordine per nome (`cf` = crossfit, spazi e numero
  davanti ignorati, descrizione per i nomi doppi), legge misura e pezzi dei file nuovi e
  scrive file e metri sull'ordine (stesse regole di `js/dtf-misure.js`). Non toglie mai file.
- Quando arriva un DTF nuovo, o col bottone **Numera ora** (`dtf_numera_richiesta`), mette
  davanti alle cartelle il numero dell'ordine nella lista: `01 - cf pavia`, `02 - …`.
- Esclude le cartelle "Stampato"; i file sciolti si abbinano ma non si rinominano.
- Esito in `app_settings.dtf_cartella_stato` (riga in DTF interno), salvato quando cambia o
  ogni 10 minuti; nel registro del Centro di controllo solo quando aggiunge o rinomina.
- Database: `sql/dtf-cartella-server.sql` (`tc_dtf_cartella_dati`, `tc_dtf_cartella_salva`,
  chiave delle automazioni).

Prova senza scrivere né rinominare: `python3 dtf_cartella.py --prova`

## Installazione sul Mac mini

1. Sul Synology: utente NAS dedicato (es. `dtf-auto`) con lettura/scrittura solo su
   `DATI/DTF/1. Stampa`.
2. Come `csauto`: montare DATI con quell'utente e salvare la password nel portachiavi
   (la digita una persona), con riconnessione all'accesso.
3. `~/Library/Application Support/TC DTF/config.json`:
   `{"url": "...", "anon": "...", "chiave": "<chiave automazioni dal Vault>"}`
4. `zsh installa.zsh`. Registro: `~/Library/Application Support/TC DTF/dtf-cartella.log`.

## Conto terzi da Google Drive

Iter (deciso 2026-11-19):
1. Il cliente (es. K1) carica i DTF nella sua cartella Google Drive.
2. Nei suoi **giorni di stampa** (scheda cliente, di solito mar e gio; solo giorni lavorativi)
   **alle 5:00** lo script copia i file nuovi in `DTF/1. Stampa/1. Stampare/<cliente>` (es. `K1`).
   La cartella sta in cima alla coda DTF interno e prende il numero 01; niente task "senza ordine".
3. Subito dopo li conta nel calendario **DTF Conto terzi** di oggi (`tc_dtf_ct_copiati`,
   una volta sola per file) e su Drive li sposta nella sottocartella **STAMPATO** del loro mese.
4. Quello che arriva dopo le 5 segue lo stesso giro **ogni ora fino alle 14**; dopo le 14 aspetta il
   prossimo giorno di stampa. A fine stampa la cartella sul NAS si sposta in Stampato come le altre.

- Cartelle Drive divise per anni/mesi (`2026/11 - Novembre`): si leggono solo mese corrente e precedente,
  esclusa STAMPATO.
- Account robot `dtf-lettore@tc-dtf.iam.gserviceaccount.com` (progetto Google Cloud `tc-dtf`, solo Drive
  API), **Editor** della cartella del cliente (serve per spostare in STAMPATO). Chiave JSON in
  `~/Library/Application Support/TC DTF/google.json` (600), mai nel repository.
- Prova senza copiare/contare/spostare: `python3 dtf_cartella.py --prova --conto-terzi-ora`.
  `--conto-terzi-ora` da solo fa il giro subito anche fuori da giorni e orari.
- Database: `sql/dtf-ct-drive.sql`, `sql/dtf-ct-copia.sql`.
