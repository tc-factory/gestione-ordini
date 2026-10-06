-- ════════════════════════════════════════════════════════
-- T&C Factory — Sicurezza, fase 2 di 2: CHIUSURA
--
-- ⚠ Da eseguire SOLO quando il codice nuovo (login Supabase) è online:
--   da qui in poi la versione vecchia del sito smette di funzionare.
--
--   • dati leggibili e modificabili solo da utenti collegati dello staff
--   • registro modifiche leggibile solo dagli admin
--   • allegati privati (si aprono con link temporanei)
--   • eliminate le vecchie funzioni di login con password in chiaro
--     e la colonna password_hash (le password ora stanno solo in Supabase Auth)
-- Richiede sicurezza-1-prepara.sql già eseguito.
-- ════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────
-- 0. Ultimo allineamento password: fino a ora valeva il vecchio sistema
-- ─────────────────────────────────────────────

update auth.users u
   set encrypted_password = a.password_hash, updated_at = now()
  from app_users a
 where a.auth_id = u.id and a.password_hash is not null
   and u.encrypted_password is distinct from a.password_hash;

-- ─────────────────────────────────────────────
-- 1. Via tutte le policy pubbliche
-- ─────────────────────────────────────────────

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where (schemaname = 'public' and tablename in ('orders','priorities','tags','clients','calendar_events','app_settings','activity_log','app_users'))
       or (schemaname = 'storage' and tablename = 'objects' and policyname ilike '%allegati%')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Nessun accesso anonimo diretto alle tabelle
revoke all on orders, priorities, tags, clients, calendar_events, app_settings, activity_log, app_users, support_tickets from anon;

-- ─────────────────────────────────────────────
-- 2. Staff collegato: accesso completo ai dati di lavoro
-- ─────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array['orders','priorities','tags','clients','calendar_events','app_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "Staff legge %1$s"    on %1$I for select to authenticated using (app_is_staff())', t);
    execute format('create policy "Staff inserisce %1$s" on %1$I for insert to authenticated with check (app_is_staff())', t);
    execute format('create policy "Staff modifica %1$s"  on %1$I for update to authenticated using (app_is_staff()) with check (app_is_staff())', t);
    execute format('create policy "Staff elimina %1$s"   on %1$I for delete to authenticated using (app_is_staff())', t);
  end loop;
end $$;

-- Impostazioni condivise: niente eliminazione
drop policy "Staff elimina app_settings" on app_settings;

-- ─────────────────────────────────────────────
-- 3. Registro modifiche: scrive lo staff (a proprio nome), legge l'admin
-- ─────────────────────────────────────────────

alter table activity_log enable row level security;
create policy "Staff scrive registro" on activity_log for insert to authenticated
  with check (app_is_staff() and user_nickname = app_nickname());
create policy "Admin legge registro"  on activity_log for select to authenticated using (app_is_admin());

-- ─────────────────────────────────────────────
-- 4. Profili utente: lo staff vede nickname e ruoli, nessuno li modifica
--    direttamente (si passa dalla funzione admin-users)
-- ─────────────────────────────────────────────

alter table app_users enable row level security;
create policy "Staff legge utenti" on app_users for select to authenticated using (app_is_staff());
revoke insert, update, delete on app_users from authenticated;

-- ─────────────────────────────────────────────
-- 5. Allegati privati
-- ─────────────────────────────────────────────

update storage.buckets set public = false where id = 'allegati';
create policy "Staff legge allegati"     on storage.objects for select to authenticated using (bucket_id = 'allegati' and app_is_staff());
create policy "Staff carica allegati"    on storage.objects for insert to authenticated with check (bucket_id = 'allegati' and app_is_staff());
create policy "Staff modifica allegati"  on storage.objects for update to authenticated using (bucket_id = 'allegati' and app_is_staff());
create policy "Staff elimina allegati"   on storage.objects for delete to authenticated using (bucket_id = 'allegati' and app_is_staff());

-- ─────────────────────────────────────────────
-- 6. Via il vecchio login con password in chiaro
-- ─────────────────────────────────────────────

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('tc_login', 'tc_manage_user', 'tc_change_password', 'tc_admin_reset_password', 'tc_set_user_economics')
  loop
    execute format('drop function %s', f.sig);
  end loop;
end $$;
alter table app_users drop column if exists password_hash;

commit;

-- ════════════════════════════════════════════════════════
-- FINE FASE 2
-- ════════════════════════════════════════════════════════
