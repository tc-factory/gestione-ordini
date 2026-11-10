-- T&C Factory — Svincolo GLS eseguito da claude (2026-11-10)
-- tc_svincolo_claude(task): chiama gls-svincolo come automazione di claude, con le istruzioni
-- già nel task (analisi.svincolo) e la bozza come conferma al cliente. Solo per il database.

create or replace function tc_svincolo_claude(p_task uuid)
returns bigint security definer set search_path = public language plpgsql as $$
declare v_key text; v_t record; v_sv jsonb;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  select * into v_t from tasks where id = p_task;
  v_sv := v_t.analisi->'svincolo';
  if v_sv is null then raise exception 'Il task non ha istruzioni per GLS'; end if;
  return net.http_post(
    url := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/gls-svincolo',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body := jsonb_build_object('task_id', p_task, 'scelta', v_sv->>'scelta', 'telefono', v_sv->>'telefono',
      'note', v_sv->>'note', 'nome', v_sv->>'nome', 'via', v_sv->>'via', 'cap', v_sv->>'cap',
      'citta', v_sv->>'citta', 'provincia', v_sv->>'provincia', 'testo', coalesce(v_t.bozza_risposta, '')),
    timeout_milliseconds := 90000);
end $$;
revoke all on function tc_svincolo_claude(uuid) from public, anon, authenticated;
