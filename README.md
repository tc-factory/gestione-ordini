# gestione-ordini — T&C Factory

Gestionale ordini per **T&C Factory Creative Lab** — pagina unica, dati su Supabase con sync in tempo reale.

**v5.0** — Riprogettato per intero: calendario + lista ordini in un'unica pagina, priorità e tag completamente personalizzabili (colori, riordino), avanzamento a 3 fasi per ordine, archiviazione, tema chiaro/scuro.

---

## 🚀 Come iniziare

1. Segui `CONFIGURAZIONE-SUPABASE.md` per il setup del database (uno script SQL unico)
2. Inserisci URL e chiave in `js/supabase-config.js` (se non già fatto)
3. Apri `index.html` in un browser, oppure pubblica la cartella su un web server (NAS / GitHub Pages)

⚠️ **Importante**: lo script SQL di questa versione ricrea la tabella `orders` da zero (schema diverso dalle versioni precedenti). Se avevi già ordini salvati con la versione precedente, andranno persi — è un nuovo modello di dati, non un aggiornamento incrementale.

---

## 📁 Struttura file

```
gestione-ordini/
├── index.html                 → Redirect a dashboard.html
├── dashboard.html              → L'app: header, statistiche, calendario, lista ordini
│
├── css/
│   ├── variables.css           → Colori, font, componenti base (bottoni, form, modal)
│   └── app.css                 → Layout pagina unica, calendario, lista, dialoghi, chip
│
├── js/
│   ├── supabase-config.js      → URL e chiave del progetto
│   ├── data.js                 → CRUD ordini/priorità/tag, realtime, upload allegati
│   └── app.js                  → Tutta l'interfaccia: render, dialoghi, calendario, lista
│
├── sql/
│   └── setup.sql                → Script completo da eseguire su Supabase
│
└── CONFIGURAZIONE-SUPABASE.md   → Guida passo-passo
```

---

## ⚙️ Funzionalità

### Pagina unica
Header (logo, contatori, tema chiaro/scuro, impostazioni, nuovo ordine) → 3 card statistiche (Attivi / In corso / Completati) → Calendario mensile → Lista ordini.

### Ordine
- **Nome**, **Data ordine**, **Priorità** (chip, configurabile), **Tag** multipli (chip colorati, configurabili), **Allegati** multipli (max 2MB cad., caricati su Supabase Storage)
- **Avanzamento a 3 fasi**: Merce completa → DTF pronti → Ordine stampato, ognuna con data automatica alla spunta
- **Archiviazione**: quando tutte le fasi sono completate, appare il pulsante "Archivia"; gli ordini archiviati si vedono nella tab "Archivio" e sono ripristinabili

### Calendario
Vista mensile, click su giorno vuoto → nuovo ordine con quella data; click su giorno con ordini → elenco ordini del giorno.

### Lista ordini
Ricerca per nome/tag, ordinamento (nome / data / priorità / data completamento), tab Attivi/Archiviati con contatori.

### Impostazioni (finestra)
- **Priorità**: colore, etichetta, riordino (su/giù), aggiungi/elimina (minimo 1 deve restare)
- **Tag**: colore, aggiungi/elimina (l'eliminazione rimuove il tag anche da tutti gli ordini)

Priorità e tag sono **sincronizzati su Supabase in tempo reale** come gli ordini.

### Tema chiaro/scuro
Pulsante in header, preferenza salvata nel browser.

---

## 💡 Note tecniche

- Nessuna build necessaria — HTML/CSS/JS puri, libreria Supabase da CDN
- Richiede connessione internet (dati su cloud Supabase)
- Nessun login: chiunque abbia il link può vedere e modificare gli ordini

---

*T&C Factory Creative Lab — Since 2000*
