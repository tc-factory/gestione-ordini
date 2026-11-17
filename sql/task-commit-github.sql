-- ════════════════════════════════════════════════════════
-- T&C Factory — Lo sviluppo fatto con Claude Code diventa task completati
--
-- Ogni commit su main dei progetti T&C Factory (Creative System, Live Printing, Kamon)
-- diventa un task "Lavorazione con Claude Code" già completato, del primario di sviluppo:claude_code
-- (Riccardo), nel giorno del commit e completato all'ora del commit.
-- Titolo: la prima riga del commit. Tempo: minuti dal commit precedente dello stesso progetto
-- (calcolato dall'edge function github-sync, che chiama tc_registra_commit).
-- Un commit si registra una volta sola. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create unique index if not exists tasks_commit_github_idx on tasks ((fonte_rif->>'sha')) where fonte = 'github';

create or replace function tc_registra_commit(p jsonb)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  v_id   uuid;
  v_at   timestamptz := (p->>'at')::timestamptz;
  v_min  int := least(960, greatest(1, coalesce((p->>'minuti')::int, 15)));
  v_tipo uuid := (select id from task_tipi where nome = 'Lavorazione con Claude Code');
  v_chi  text := coalesce((select primario from competenze_responsabili where voce = 'sviluppo:claude_code'), 'riccardo');
begin
  if exists (select 1 from tasks where fonte = 'github' and fonte_rif->>'sha' = p->>'sha') then return false; end if;
  insert into tasks (tipo_id, titolo, descrizione, stato, assegnato_a, giorno, minuti_stimati, lavorato_sec,
                     fonte, fonte_rif, analisi, creato_da)
  values (v_tipo, left(p->>'titolo', 200), left(coalesce(p->>'descrizione', ''), 5000), 'completato', v_chi,
          (v_at at time zone 'Europe/Rome')::date, v_min, v_min * 60,
          'github', jsonb_build_object('sha', p->>'sha', 'repo', p->>'repo', 'url', p->>'url'),
          jsonb_build_object('cliente', jsonb_build_object('nome', p->>'progetto'), 'commit', true),
          'github')
  returning id into v_id;
  -- Il trigger mette l'ora dell'inserimento: vale l'ora del commit
  update tasks set completato_at = v_at where id = v_id;
  return true;
end;
$$;
revoke execute on function tc_registra_commit(jsonb) from public, anon, authenticated;

-- Ogni 10 minuti l'edge function legge i commit nuovi (chiave condivisa come per shopify-sync)
create or replace function _tc_github_sync_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/github-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
revoke execute on function _tc_github_sync_call() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'github-sync') then
    perform cron.unschedule('github-sync');
  end if;
  perform cron.schedule('github-sync', '3-59/10 * * * *', 'select _tc_github_sync_call()');
end $$;
