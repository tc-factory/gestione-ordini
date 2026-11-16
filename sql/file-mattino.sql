-- ════════════════════════════════════════════════════════
-- T&C Factory — File del mattino
--
-- Lo script del mattino (automazioni/shopify-mattino) a fine giro carica DDT, file di stampa e fogli DTF
-- nel bucket privato file-mattino, in una cartella col giorno (AAAA-MM-GG/...). La scheda "File del mattino"
-- del gestionale li elenca e li fa scaricare con link firmati.
-- Lo script non ha accesso al database: chiede i link di caricamento alla funzione file-mattino
-- con la sua chiave (la stessa di tc_mattino_dati, segreto 'automazione_mattino_key').
--
-- Richiede automazione-mattino.sql e comunicazione-permessi.sql già eseguiti. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- Privato e senza limite proprio: vale il limite globale del progetto (i PDF di stampa superano 1 GB)
insert into storage.buckets (id, name, public, file_size_limit)
values ('file-mattino', 'file-mattino', false, null)
on conflict (id) do update set public = false, file_size_limit = null;

-- Leggere (elenco e link per scaricare): chi vede la scheda. Scrivere e cancellare: solo la funzione file-mattino
drop policy if exists "File del mattino si leggono" on storage.objects;
create policy "File del mattino si leggono" on storage.objects for select to authenticated
  using (bucket_id = 'file-mattino' and app_vede_scheda('file'));

-- La funzione file-mattino controlla qui la chiave dello script
create or replace function _tc_mattino_chiave_ok(p_chiave text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_chiave is not null and p_chiave = (select decrypted_secret from vault.decrypted_secrets where name = 'automazione_mattino_key');
$$;
revoke execute on function _tc_mattino_chiave_ok(text) from public, anon, authenticated;
grant  execute on function _tc_mattino_chiave_ok(text) to service_role;
