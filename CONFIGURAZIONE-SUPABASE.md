# 📋 Configurazione Supabase — T&C Factory Gestionale v5.0

## Istruzioni passo passo

---

## ⚠️ Importante se hai già un progetto Supabase da una versione precedente

Lo script SQL di questa versione esegue `drop table if exists orders cascade;` — **cancella la tabella ordini esistente e la ricrea con la nuova struttura** (priorità, tag, allegati multipli, fasi). Se avevi già ordini salvati, andranno persi: è un nuovo modello di dati, non un aggiornamento incrementale.

Se vuoi conservare i vecchi ordini, fammelo sapere prima di eseguire lo script — possiamo esportarli prima.

---

## PASSO 1 — Progetto Supabase

Se non l'hai già fatto:

1. Vai su **[supabase.com](https://supabase.com)** → **Start your project** → **New Project**
2. Dai un nome al progetto, scegli una password per il database e una regione vicina
3. Attendi 1-2 minuti che il progetto sia pronto

Se hai già un progetto da prima, puoi riutilizzarlo direttamente.

---

## PASSO 2 — Esegui lo script di setup

1. Nel progetto Supabase, vai su **SQL Editor** → **New query**
2. Apri il file `sql/setup.sql` incluso nello ZIP, copia **tutto il contenuto**
3. Incollalo nell'editor e clicca **Run**
4. Dovresti vedere "Success" — create le tabelle `orders`, `priorities`, `tags`, con sicurezza e sync in tempo reale già attivi, e le priorità/tag di default già inseriti

---

## PASSO 3 — Crea il bucket per gli allegati (se non già fatto)

1. Vai su **Storage** → **New bucket**
2. Nome: `allegati`
3. Attiva **Public bucket**
4. **Create bucket**

Se il bucket esiste già da una versione precedente, va benissimo così, non serve ricrearlo.

---

## PASSO 4 — Credenziali nel codice

Se è la prima volta che configuri questo progetto:

1. Vai su **Project Settings** → **API Keys**
2. Copia **Project URL** e **Publishable key** (o **anon key** nella tab "Legacy" se preferisci)
3. Apri `js/supabase-config.js` e inserisci i due valori:
   ```js
   const SUPABASE_URL = 'https://TUO-PROGETTO.supabase.co';
   const SUPABASE_ANON_KEY = 'TUA-CHIAVE';
   ```

Se il file è già configurato da prima (stesso progetto Supabase), non serve toccarlo.

---

## PASSO 5 — Pubblica i file

Apri `index.html` direttamente nel browser, oppure pubblica la cartella su un web server (NAS Synology con Web Station, GitHub Pages, ecc.) — sono file statici, nessun server da installare.

---

## Cosa fa il nuovo schema database

| Tabella | Contenuto | Sincronizzata in tempo reale |
|---|---|---|
| `orders` | Ordini: nome, data, priorità, tag, allegati, fasi, archiviazione | ✅ |
| `priorities` | Priorità configurabili (id, etichetta, colore, ordine) | ✅ |
| `tags` | Tag configurabili (nome, colore) | ✅ |

Tutte le modifiche fatte da un PC (creare un ordine, cambiare un colore, riordinare una priorità) appaiono su tutti gli altri schermi connessi in meno di un secondo.

---

## Risoluzione problemi

| Problema | Soluzione |
|----------|-----------|
| "Impossibile contattare Supabase" / badge rosso | Controlla URL e chiave in `js/supabase-config.js` |
| Gli ordini non si sincronizzano tra PC | Verifica che lo script SQL sia stato eseguito senza errori, in particolare le righe `alter publication supabase_realtime add table ...` |
| L'allegato non si carica | Verifica che il bucket `allegati` esista e sia **Public** |
| Le priorità/tag di default non compaiono | Probabilmente lo script è stato eseguito due volte parzialmente — riesegui tutto lo script da capo |

---

*T&C Factory Creative Lab — Gestionale v5.0 (Supabase)*
