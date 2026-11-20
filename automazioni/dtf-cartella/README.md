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
- **COLLA NERA** (dal 2026-11-20): i file nelle cartelle degli ordini con `colla nera`, `leggings`, `short`,
  `soft shell`, `kway` (anche `k-way`), `windstopper` o `nylon` (dal 2026-11-20) nel nome (o in una sottocartella, es. `ducale/colla nera/`) vanno **sciolti** nella cartella
  `COLLA NERA` di 1. Stampare (creata se manca), col nome dell'ordine davanti se non c'è già
  (`cf pavia/Leggings_5pz.tif` → `COLLA NERA/cf pavia - Leggings_5pz.tif`). Solo file fermi da 2 minuti; se lì
  c'è già lo stesso file identico non si sposta (niente doppioni); le cartelle conto terzi (K1) restano come sono.
  COLLA NERA resta una riga sua nella coda (si stampa tutta insieme); i file spostati restano anche sui loro
  ordini (stessa misura e data), che quindi non finiscono in "controllare se stampato". Nel totale
  "Metri da stampare" contano una volta sola: la riga COLLA NERA porta `metriOrdini` (metri per ordine) e il
  gestionale li toglie dal totale se l'ordine è in coda; la riga mostra comunque tutti i metri della cartella.
- **File sciolti raggruppati** (dal 2026-11-20): i file sciolti in 1. Stampare con le stesse prime parole
  (`House dietro 100 pezzi.pdf`, `House lato cuore 100 pezzi.pdf`) vanno in una cartella col nome comune (`House`);
  se la cartella c'è già (anche numerata) vanno lì, e lì va anche un file da solo che inizia col suo nome. Parole
  generiche (fronte, retro, logo, numeri…) non bastano. Solo file fermi da 2 minuti.
- **PDF → TIF** (dal 2026-11-20): una cartella (o un file sciolto) con PDF senza il loro TIF accanto finisce
  nell'esito (`pdf`) e il database apre il task URGENTE **Creare il file TIF: <nome>** (coda DTF-FILE,
  `sql/dtf-tiff.sql`). Il tasto **Genera TIFF automatico** chiede la riduzione dello SPOT (0-3 px) e scrive
  `app_settings.dtf_tiff_richieste`; al giro dopo lo script chiama `dtf_tiff.py` (venv a parte in
  `~/Library/Application Support/TC DTF/venv` con pymupdf, numpy, pillow, tifffile; profilo `fogra39.icc` preso
  dalla libreria di Box Factory Lab): TIF come i fogli BFL (CMYK FOGRA39 300 dpi, neri K100, canale SPOT stile
  Photoshop = forma di tutto ridotta di N px), misura della pagina, più pagine → `<nome> - pag N.tif`. Il PDF va in
  `PDF originali` (cartella esclusa dalla lettura) e sull'ordine resta solo il TIF. Il task si chiude da solo.
- **Nomi dei file** (dal 2026-11-20): regola = parti separate da `-`, pezzi in fondo `-<numero>pz`
  (`cliente-cuore-nero-12pz.tif`; spazi dentro una parte vanno bene). Fuori regola (spazi al posto dei trattini o in
  fondo, trattini doppi, `_`, «pezzi»/«copie» invece di pz, pz mancanti o non in fondo) → esito `nomi` con il nome giusto
  proposto e task **Rinominare i file DTF: <cartella>** (coda DTF-FILE, `sql/dtf-nomi.sql`), chiuso da solo quando i
  nomi sono a posto. Conto terzi (K1) escluso. Un file rinominato nella sua cartella (stessa misura e data) resta lo
  stesso file sull'ordine e si rileggono i pezzi: niente metri doppi.
- **Salvare sul NAS** (dal 2026-11-20): per le cartelle con PDF o nomi da sistemare lo script calcola dove salvare i
  file pronti (`cartella_archivio`, `archivio` nell'esito): la cartella da cui l'automazione ha preso i file
  dell'ordine; altrimenti `<cliente>/<anno>/[<lavorazione>]/dtf/tiff` del cliente trovato (cliente dell'ordine o nome);
  se il cliente non c'è `Clienti/<iniziale>/<cliente>` o `CrossFit/<box>` (da creare). COLLA NERA e conto terzi no.
  Elenco cartelle clienti riletto ogni 30 minuti. I task TIF e Rinominare mostrano il percorso (Copia percorso: Finder
  su Mac, Esplora file su Windows) e a lavoro fatto **non si chiudono**: passano a "salvali sul NAS" e si chiudono
  col Fatto (`sql/dtf-archivio.sql`). In DTF-FILE tre categorie: 1 Caricare file, 2 Creare TIF, 3 Rinominare file.
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
5. **URGENZE** (dal 2026-11-20): le cartelle `URGENZE` (nel mese, es. `2026/11 - Novembre/URGENZE`, o nella
   radice) fanno lo stesso giro **tutti i giorni lavorativi, lun–ven, dalle 5 alle 14**. Negli altri giorni si
   copia solo da lì; nei giorni di stampa tutto. Finiscono nella STAMPATO del loro mese.

- Cartelle Drive divise per anni/mesi (`2026/11 - Novembre`): si leggono solo mese corrente e precedente,
  esclusa STAMPATO.
- Account robot `dtf-lettore@tc-dtf.iam.gserviceaccount.com` (progetto Google Cloud `tc-dtf`, solo Drive
  API), **Editor** della cartella del cliente (serve per spostare in STAMPATO). Chiave JSON in
  `~/Library/Application Support/TC DTF/google.json` (600), mai nel repository.
- Prova senza copiare/contare/spostare: `python3 dtf_cartella.py --prova --conto-terzi-ora`.
  `--conto-terzi-ora` da solo fa il giro subito anche fuori da giorni e orari.
- Database: `sql/dtf-ct-drive.sql`, `sql/dtf-ct-copia.sql`.

## Ordini nuovi: file DTF preparati da soli

Schema delle cartelle cliente (deciso da Riccardo il 2026-11-19), in `DATI/Clienti/<iniziale>/` o `DATI/CrossFit/`:

```
<cliente>/<anno>/dtf/tiff/                     ordine senza descrizione
<cliente>/<anno>/<lavorazione>/dtf/tiff/       ordine con descrizione = <lavorazione> (es. "Torino Challenge")
```

- `<cliente>` = nome del cliente nel gestionale; anno corrente.
- In `tiff` solo file pronti da stampare (niente bozze, PDF, vecchie versioni), nomi chiari **senza quantità**:
  i pezzi proposti sono il totale capi dell'ordine, da correggere al riscontro se un file va su meno capi.
- Si prendono solo i file direttamente in `tiff`. Descrizione senza sottocartella corrispondente → `<anno>/dtf/tiff`.
- Copia in `1. Stampare/<NOME ORDINE>` con `-<pezzi>pz` nel nome; una volta per ordine (`dtf_preparati`).
- Cliente cercato per nome (uguale, o una sola cartella molto simile: il più corto copre almeno 2/3 del più lungo).

### Modalità prova (dal 2026-11-19)

`app_settings.dtf_prepara_modo` = `prova` (default) o `automatica`. **Si cambia solo a mano, quando lo
dice Riccardo** (niente passaggio automatico, neanche con precisione al 100%).
In prova lo script non copia: salva una **proposta** (cartella cliente, file, pezzi) in `dtf_preparati`.
In DTF interno l'ordine mostra "DTF proposto": la si approva (togliendo file o correggendo i pezzi) o la si
rifiuta (`dtf_prepara_riscontro`); lo script copia solo le approvate. Riscontro: giusto / corretto / sbagliato;
la pagina mostra la precisione sugli ultimi 10. Pezzi proposti: quelli scritti nel nome del file, altrimenti il
totale capi. Una sottocartella col numero d'ordine (es. `2026/dtf/00404 felpe`) ha la precedenza sul resto.
`sql/dtf-prepara-prova.sql`.
