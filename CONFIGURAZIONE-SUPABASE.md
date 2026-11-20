# Database Supabase — Creative System

Il database di produzione esiste già (progetto `gdtlpyowpbwetnovxget`, organizzazione tc-factory).
Indirizzo e chiave pubblica sono in `js/supabase-config.js`: la chiave è fatta per stare nel codice,
la sicurezza la danno le policy del database (solo utenti collegati dello staff).

---

## ⛔ Da non fare

- **Non eseguire `sql/setup.sql`**: è il primo impianto del 2026 (v5.0). Ricreava la tabella degli ordini
  e apriva i dati a chiunque. Ora si ferma da solo se il database esiste, ma non serve a niente.
- Non rieseguire alla cieca i vecchi file di `sql/`: alcuni sostituiscono funzioni che file più recenti
  hanno poi cambiato. Prima di rieseguirne uno, controllare che la versione in produzione non sia più nuova.

## Come si cambia il database

1. Ogni modifica è un file nuovo in `sql/` (non distruttivo, rieseguibile: `if not exists`, `create or replace`).
2. Si esegue sul database di produzione:
   ```
   supabase db query --linked -f sql/<file>.sql
   ```
   oppure da **Supabase → SQL Editor**.
3. Le funzioni si pubblicano con `supabase functions deploy <nome> --project-ref <ref> --use-api`
   (con `--no-verify-jwt` quando il commento in cima alla funzione lo dice).

---

## Collegamento con Kamon

Gli ordini che i clienti confermano su **Kamon** (la piattaforma dei cataloghi) arrivano qui come ordini normali, con il modulo compilato.

1. **SQL Editor** → incolla `sql/kamon-collegamento.sql` → **Run** (si può rieseguire)
2. Imposta la chiave segreta (la stessa che va in Kamon → Impostazioni → Collegamento al gestionale):
   `insert into app_settings (key, value) values ('kamon_key_hash', to_jsonb(extensions.crypt('<chiave>', extensions.gen_salt('bf')))) on conflict (key) do update set value = excluded.value;`
3. Facoltativo: `app_settings` → `kamon_tag` con il nome di un tag esistente, da mettere sugli ordini che arrivano da Kamon.
