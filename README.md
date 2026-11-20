# Creative System — T&C Factory

Gestionale interno di T&C Factory: ordini, lavorazioni, task, mail e brand.
Sito su **https://cs.pngs.it**, dati su Supabase, accesso con login dello staff.

---

## Come è fatto

- **Sito**: HTML, CSS e JS puri, senza build. Pagina unica `dashboard.html` con le schede
  (Centro di controllo, Task, Brand, Stampe del giorno, Content Studio, Ordini, Planner,
  Interne, Esterne, Prodotti, Clienti, Cassa, Impostazioni, Cestino). I cataloghi dei clienti stanno su Kamon.
  Le schede sono elencate in `NAV_ITEMS` di `js/nav.js`: da lì compaiono anche nei permessi degli account.
- **Pubblicazione**: servizio `sito` su Railway (Caddy, `sito/Dockerfile`), solo i file del sito.
  A ogni modifica di un file js/css va aumentato il suo `?v=` in `dashboard.html`.
- **Database**: Supabase. Le modifiche allo schema sono i file di `sql/`, eseguiti uno alla volta
  sul database di produzione. Vedi `CONFIGURAZIONE-SUPABASE.md`.
- **Funzioni**: `supabase/functions/` (cervello, mail, Shopify, GLS, social, file del mattino…),
  molte richiamate dai cron del database.
- **Automazioni**: `automazioni/` (script del mattino su Railway e Mac mini, cartella DTF,
  TC Lavoro per i Mac, sessioni di Claude Code, libreria DTF di Box Factory Lab).
- **Estensioni**: `estensioni/sendcloud-mittente` (Chrome, mittente giusto su Sendcloud).

## Pagine

| File | A cosa serve |
|---|---|
| `dashboard.html` | Il gestionale |
| `index.html` | Rimanda a `dashboard.html` |
| `cliente-dtf.html` | Portale dei clienti DTF conto terzi (link con token e password) |
| `privacy.html` | Informativa privacy (richiesta dalle app Meta) |

---

*T&C Factory Creative Lab — Since 2000*
