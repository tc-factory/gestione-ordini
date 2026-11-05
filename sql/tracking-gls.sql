-- ════════════════════════════════════════════════════════
-- T&C Factory — Controllo delle spedizioni GLS (Centro di controllo)
--
-- Shopify dice solo "spedito" e spesso non riceve la consegna. Lo storico vero è nella pagina
-- pubblica di tracking GLS: l'edge function tracking-check la legge per gli ordini spediti e non
-- ancora consegnati, riconosce i problemi dall'ultimo stato e crea un task per ogni spedizione.
-- Il cervello usa gli stessi dati per rispondere ai clienti.
-- Richiede linea-produttiva.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists spedizioni_tracking (
  ordine_id      uuid primary key references shopify_orders(id) on delete cascade,
  store_id       text not null,
  numero         text not null,
  spedito_at     timestamptz,
  stato          text not null default 'in_viaggio'
                 check (stato in ('in_viaggio', 'consegnata', 'problema', 'ritardo', 'senza_dati')),
  problema       text,
  ultimo_evento  text,
  ultimo_at      timestamptz,
  eventi         jsonb not null default '[]',    -- [{ at, luogo, stato, nota }], dal più recente
  consegnata_at  timestamptz,
  controllata_at timestamptz not null default now()
);
create index if not exists spedizioni_stato_idx on spedizioni_tracking (stato, controllata_at);

alter table spedizioni_tracking enable row level security;
drop policy if exists "Admin legge spedizioni" on spedizioni_tracking;
create policy "Admin legge spedizioni" on spedizioni_tracking for select to authenticated using (app_is_admin());
revoke all on spedizioni_tracking from anon, authenticated;
grant select on spedizioni_tracking to authenticated;

insert into task_tipi (nome, minuti_standard, autonomia, competenza, descrizione) values
  ('Problema di consegna', 10, 'solo_task', 'spedizione', 'Riconosciuto dallo storico del tracking GLS')
on conflict (nome) do nothing;

-- Spedizioni da controllare: prima quelle controllate da più tempo
create or replace function _tc_spedizioni_da_controllare(p_n int)
returns table (ordine_id uuid, store_id text, nome text, numero_ordine text, cliente text, tracking text, spedito_at timestamptz)
security definer set search_path = public language sql stable as $$
  select s.id, s.store_id, st.nome, s.numero, s.cliente, x.numero, x.at
    from shopify_orders s
    join shopify_stores st on st.id = s.store_id
    cross join lateral (
      select t->>'numero' numero, (t->>'at')::timestamptz at, bool_or(t->>'stato' = 'DELIVERED') over () consegnata
        from jsonb_array_elements(s.tracking) t where t->>'numero' ~ '^[A-Z]{2}[0-9]+$' order by t->>'at' desc limit 1
    ) x
    left join spedizioni_tracking k on k.ordine_id = s.id
   where s.annullato_at is null and s.stato_evasione = 'FULFILLED' and not coalesce(x.consegnata, false)
     and x.at > now() - interval '45 days' and k.consegnata_at is null
   order by k.controllata_at nulls first
   limit p_n;
$$;
revoke execute on function _tc_spedizioni_da_controllare(int) from public, anon, authenticated;
grant  execute on function _tc_spedizioni_da_controllare(int) to service_role;

create or replace function _tc_tracking_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/tracking-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_tracking_call() from public, anon, authenticated;

-- L'avviso ai collegamenti: la pagina GLS non si legge più o il controllo è fermo
create or replace function _tc_problemi()
returns table (chiave text, testo text) security definer set search_path = public language sql stable as $$
  select 'shopify:' || id, 'Shopify ' || nome || ': ' || coalesce(ultimo_errore, 'nessun aggiornamento da più di 20 minuti')
    from shopify_stores where attivo and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'mail:' || id, 'Casella ' || indirizzo || ': ' || coalesce(ultimo_errore, 'nessun controllo da più di 20 minuti')
    from mail_caselle where attivo and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'cervello', 'Cervello: ' || count(*) || ' mail in attesa da più di 30 minuti'
    from eventi where fonte = 'mail' and elaborato_at is null and ricevuto_at < now() - interval '30 minutes'
  having count(*) > 0
  union all
  select 'tracking', 'Tracking GLS: nessun controllo da più di 2 ore'
   where exists (select 1 from spedizioni_tracking) and (select max(controllata_at) from spedizioni_tracking) < now() - interval '2 hours'
  union all
  select 'tracking-lettura', 'Tracking GLS: ' || count(*) || ' spedizioni senza dati, la pagina GLS potrebbe essere cambiata'
    from spedizioni_tracking where stato = 'senza_dati' and controllata_at > now() - interval '2 hours'
  having count(*) > 40;
$$;
revoke execute on function _tc_problemi() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'tracking-check') then perform cron.unschedule('tracking-check'); end if;
  perform cron.schedule('tracking-check', '4-59/15 * * * *', 'select _tc_tracking_call()');
end $$;
