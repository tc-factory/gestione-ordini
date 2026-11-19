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

## Installazione sul Mac mini (utente csauto, 2026-11-19)

- Credenziali NAS in `~/Library/Application Support/TC DTF/nas` (utente e password, 600): le ha salvate
  Riccardo dal Terminale, non passano dalla chat. Lo script collega `//192.168.1.200/DATI` in `~/NAS/DATI`
  (`/Volumes/DATI` è di tcfactory) e lo ricollega se cade.
- `config.json` (600): `env` = `~/shopify-mattino/.env` (stessa chiave dello script del mattino, non copiata),
  `cartella`, `nas`, `conto_terzi` (false = spento).
- Chiave Google in `google.json` (600), copiata dal MacBook.
- Avvio: crontab di csauto ogni minuto (`* * * * * cd "$HOME/Library/Application Support/TC DTF" &&
  /usr/bin/python3 -I dtf_cartella.py >> dtf-cartella.log 2>&1`). **Serve l'Accesso completo al disco per
  `/usr/sbin/cron`** (Impostazioni di Sistema → Privacy e sicurezza, da un amministratore): senza, macOS
  blocca la lettura dei volumi di rete ("Operation not permitted").
- Primo giro: registra le cartelle com'erano, senza rinominare niente; un giro alla volta (`giro.lock`).

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

## Ordini nuovi: file DTF preparati da soli

Per ogni ordine **creato da quando l'automazione è attiva** (`app_settings.dtf_prepara_dal`) e con la
lavorazione **DTF** (cioè nella lista Da stampare), lo script:
1. cerca la cartella del cliente sul NAS: `DATI/Clienti/<iniziale>/<cliente>` o `DATI/CrossFit/<box>`,
   per nome del cliente e poi dell'ordine (uguale, oppure una sola molto simile: il nome più corto deve
   coprire almeno 2/3 del più lungo, così "Padel" non diventa "Padel Hero");
2. prende i file della cartella **dtf dell'anno corrente** (es. `2026/01-dtf/tiff`); se la cartella non è
   divisa per anni, quelli nella cartella principale;
3. li copia in `1. Stampare/<NOME ORDINE>` aggiungendo il **totale capi** dell'ordine (`-10pz`).

Ogni ordine si prepara una volta (`dtf_preparati`, `sql/dtf-prepara-ordini.sql`). Se la cartella dell'ordine
c'è già in 1. Stampare non si tocca; se il cliente non si trova o non ha file si riprova ai giri dopo
(l'ordine resta rosso "Manca il DTF").

### Modalità prova (dal 2026-11-19)

`app_settings.dtf_prepara_modo` = `prova` (default) o `automatica`. **Si cambia solo a mano, quando lo
dice Riccardo** (niente passaggio automatico, neanche con precisione al 100%).
In prova lo script non copia: salva una **proposta** (cartella cliente, file, pezzi) in `dtf_preparati`.
In DTF interno l'ordine mostra "DTF proposto": la si approva (togliendo file o correggendo i pezzi) o la si
rifiuta (`dtf_prepara_riscontro`); lo script copia solo le approvate. Riscontro: giusto / corretto / sbagliato;
la pagina mostra la precisione sugli ultimi 10. Pezzi proposti: quelli scritti nel nome del file, altrimenti il
totale capi. Una sottocartella col numero d'ordine (es. `2026/dtf/00404 felpe`) ha la precedenza sul resto.
`sql/dtf-prepara-prova.sql`.
