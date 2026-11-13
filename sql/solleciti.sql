-- ════════════════════════════════════════════════════════
-- T&C Factory — Solleciti: chi non risponde alle nostre mail va contattato (richiesta utente 2026-11-13)
--
-- Una mail mandata da noi (da CS o dal programma di posta) che aspetta qualcosa dalla persona
-- e resta senza risposta per SOLLECITO_GIORNI giorni lavorativi diventa un task
-- "Contattare chi non risponde", con il testo pronto del messaggio (WhatsApp/SMS) e di cosa
-- dire al telefono. Lo decide e lo scrive l'edge function solleciti (Haiku):
-- una mail che non aspetta niente (avviso, ringraziamento) viene segnata e lasciata stare.
--
--   • mail_solleciti: una riga per ogni nostra mail già valutata (con l'esito)
--   • _tc_solleciti_da_fare: le nostre ultime mail senza risposta da valutare
--   • cron ogni 30 minuti nei giorni lavorativi, dalle 8 alle 19
--
-- Le spedizioni ferme (tracking-check) e i dati mancanti per spedire (ordini-dati) hanno già
-- il loro task per chiamare: lì la funzione aggiunge solo i testi.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists mail_solleciti (
  mail_id     uuid primary key references mail_messaggi(id) on delete cascade,
  casella_id  text not null,
  email       text not null,
  esito       text not null,            -- 'task', 'non_serve', 'altrove', 'errore'
  motivo      text,
  task_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists mail_solleciti_email_idx on mail_solleciti (email);

alter table mail_solleciti enable row level security;
drop policy if exists "Admin legge solleciti" on mail_solleciti;
create policy "Admin legge solleciti" on mail_solleciti for select to authenticated using (app_is_admin());
revoke all on mail_solleciti from anon, authenticated;
grant select on mail_solleciti to authenticated;

-- ── Tipo di task ──
insert into task_tipi (nome, minuti_standard, autonomia, competenza, descrizione) values
  ('Contattare chi non risponde', 5, 'solo_task', 'email', 'Gli abbiamo scritto e non ha risposto: messaggio o telefonata, col testo pronto')
on conflict (nome) do nothing;

-- ── Le nostre ultime mail senza risposta ──
-- Per ogni persona (una sola email nel destinatario) l'ultima mail che le abbiamo mandato negli
-- ultimi 30 giorni, se dopo non ci ha scritto da nessuna casella e sono passati p_giorni lavorativi.
create or replace function _tc_solleciti_da_fare(p_giorni int, p_n int)
returns table (mail_id uuid, casella_id text, email text, inviata_at timestamptz)
security definer set search_path = public language sql stable as $$
  with ultime as (
    select distinct on (m.casella_id, lower(trim(m.a)))
           m.id, m.casella_id, lower(trim(m.a)) as email, m.ricevuto_at
      from mail_messaggi m
     where m.direzione = 'out'
       and m.ricevuto_at > now() - interval '30 days'
       and m.a ~ '^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$'
       and lower(m.a) !~ '(no-?reply|mailer-daemon|postmaster|notifiche|notification)'
       and not exists (select 1 from mail_caselle c where lower(c.indirizzo) = lower(trim(m.a)))
     order by m.casella_id, lower(trim(m.a)), m.ricevuto_at desc
  )
  select u.id, u.casella_id, u.email, u.ricevuto_at
    from ultime u
   where not exists (select 1 from mail_solleciti s where s.mail_id = u.id)
     and not exists (select 1 from mail_messaggi r
                      where r.direzione = 'in' and lower(r.da_email) = u.email and r.ricevuto_at > u.ricevuto_at)
     and tc_giorni_lavorativi((u.ricevuto_at at time zone 'Europe/Rome')::date, (now() at time zone 'Europe/Rome')::date) >= p_giorni
   order by u.ricevuto_at
   limit p_n;
$$;
revoke execute on function _tc_solleciti_da_fare(int, int) from public, anon, authenticated;

-- ── Chiamata ogni 30 minuti, lun-ven dalle 8 alle 19 (ora di Roma ≈ UTC+1) ──
create or replace function _tc_solleciti_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  -- Festivi: niente task nuovi (il weekend lo esclude già il cron)
  if tc_festivo((now() at time zone 'Europe/Rome')::date) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/solleciti',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_solleciti_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'solleciti') then perform cron.unschedule('solleciti'); end if;
  perform cron.schedule('solleciti', '7,37 7-17 * * 1-5', 'select _tc_solleciti_call()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
