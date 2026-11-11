-- ════════════════════════════════════════════════════════
-- T&C Factory — Consumi del cervello in diretta (2026-11-11)
--
--   cervello_consumi in Realtime: la scheda Automazioni mostra ogni chiamata a Claude appena succede.
--   Realtime rispetta l'RLS: le righe arrivano solo agli admin (policy "Admin legge consumi cervello").
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'cervello_consumi') then
    alter publication supabase_realtime add table cervello_consumi;
  end if;
end $$;
