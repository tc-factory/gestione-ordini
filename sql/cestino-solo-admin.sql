-- ════════════════════════════════════════════════════════
-- T&C Factory — Eliminazione definitiva degli ordini solo per admin
-- Lo staff può spostare nel cestino (deleted_at) e ripristinare;
-- eliminare la riga dal database è riservato agli admin.
-- Richiede sicurezza-2-blocca.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

drop policy if exists "Staff elimina orders" on orders;
drop policy if exists "Admin elimina orders" on orders;
create policy "Admin elimina orders" on orders for delete to authenticated using (app_is_admin());
