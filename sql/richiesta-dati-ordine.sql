-- ════════════════════════════════════════════════════════
-- T&C Factory — Richiesta al cliente dei dati che mancano per spedire
--
-- Ordini da evadere con l'indirizzo incompleto (civico, CAP, città, provincia) o senza telefono:
-- la funzione ordini-dati scrive al cliente una volta sola per ordine, dalla casella del negozio.
-- Dopo un giorno lavorativo senza risposta nasce un task; quando i dati arrivano nell'ordine
-- la richiesta si chiude da sola, e con lei il task.
--
-- Modalità (automazioni_impostazioni, cambiabile dalla scheda Automazioni):
--   prova      → la mail non parte da sola: la manda una persona col clic sull'etichetta rossa
--   automatica → la manda la funzione
-- Le richieste mandate a mano si registrano qui (mail-send) e seguono le stesse regole.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- ── Impostazioni delle automazioni ──
create table if not exists automazioni_impostazioni (
  nome          text primary key,
  modo          text not null default 'prova' check (modo in ('spenta', 'prova', 'automatica')),
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text
);
alter table automazioni_impostazioni enable row level security;
drop policy if exists "Staff legge impostazioni automazioni" on automazioni_impostazioni;
create policy "Staff legge impostazioni automazioni" on automazioni_impostazioni for select to authenticated using (app_is_staff());
drop policy if exists "Admin cambia impostazioni automazioni" on automazioni_impostazioni;
create policy "Admin cambia impostazioni automazioni" on automazioni_impostazioni for update to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on automazioni_impostazioni from anon, authenticated;
grant select, update (modo, aggiornato_at, aggiornato_da) on automazioni_impostazioni to authenticated;

insert into automazioni_impostazioni (nome, modo) values ('richiesta-dati', 'prova') on conflict (nome) do nothing;

-- ── Richieste ──
create table if not exists ordini_richieste_dati (
  ordine_id   uuid primary key references shopify_orders(id) on delete cascade,
  store_id    text not null,
  mancanti    jsonb not null default '[]',      -- es. ["Manca il numero civico", "Manca il telefono"]
  inviata_at  timestamptz,
  inviata_da  text,                              -- 'automatica' o il nickname di chi l'ha mandata
  esito       text,                              -- 'in invio', 'inviata', 'errore: …'
  task_id     uuid,
  risolta_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists ordini_richieste_aperte_idx on ordini_richieste_dati (risolta_at) where risolta_at is null;

alter table ordini_richieste_dati enable row level security;
drop policy if exists "Staff legge richieste dati" on ordini_richieste_dati;
create policy "Staff legge richieste dati" on ordini_richieste_dati for select to authenticated using (app_is_staff());
revoke all on ordini_richieste_dati from anon, authenticated;
grant select on ordini_richieste_dati to authenticated;

-- ── Tipo di task ──
insert into task_tipi (nome, minuti_standard, autonomia, competenza, descrizione) values
  ('Dati mancanti per spedire', 5, 'solo_task', 'spedizione', 'Il cliente non ha risposto alla richiesta di indirizzo completo o telefono')
on conflict (nome) do nothing;

-- ── Chiamata ogni 5 minuti ──
create or replace function _tc_ordini_dati_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/ordini-dati',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function _tc_ordini_dati_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ordini-dati') then perform cron.unschedule('ordini-dati'); end if;
  -- Due minuti dopo shopify-sync, così legge gli ordini appena arrivati
  perform cron.schedule('ordini-dati', '2-59/5 * * * *', 'select _tc_ordini_dati_call()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
