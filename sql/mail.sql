-- ════════════════════════════════════════════════════════
-- T&C Factory — Caselle email Aruba (Centro di controllo, fase 2)
--
--   • mail_caselle:  le caselle collegate; la password sta nei secret delle
--                    edge functions: MAIL_PASSWORD_<ID IN MAIUSCOLO>
--   • mail_messaggi: le mail ricevute (e, più avanti, le risposte inviate da CS)
--   • ogni mail nuova scritta da una persona finisce in `eventi` per il cervello;
--     le mail automatiche (newsletter, notifiche, risposte automatiche) no
--
-- Si leggono solo le mail arrivate da quando la casella è collegata (attiva_dal):
-- l'arretrato resta dov'è.
-- Richiede shopify.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists mail_caselle (
  id              text primary key check (id ~ '^[a-z0-9_]+$'),
  indirizzo       text not null unique,
  nome            text not null,
  store_id        text references shopify_stores(id) on delete set null,   -- negozio di riferimento
  imap_host       text not null default 'imaps.aruba.it',
  smtp_host       text not null default 'smtps.aruba.it',
  attivo          boolean not null default true,
  attiva_dal      timestamptz not null default now(),
  uidvalidity     bigint,
  ultimo_uid      bigint,
  ultimo_sync_at  timestamptz,
  ultimo_errore   text,
  created_at      timestamptz not null default now()
);

insert into mail_caselle (id, indirizzo, nome, store_id) values
  ('ciucciamilcalzino', 'info@ciucciamilcalzino.it', 'Ciucciami il Calzino', 'ciucciamilcalzino'),
  ('boxfactorylab',     'info@boxfactorylab.it',     'Box Factory Lab',      'boxfactorylab'),
  ('asteroidi',         'info@asteroidistore.it',    'Asteroidi Store',      'asteroidi'),
  ('bienjugado',        'info@bienjugado.it',        'Bienjugado',           'bienjugado')
on conflict (id) do update set indirizzo = excluded.indirizzo, nome = excluded.nome, store_id = excluded.store_id;

alter table mail_caselle enable row level security;
drop policy if exists "Admin legge caselle" on mail_caselle;
create policy "Admin legge caselle" on mail_caselle for select to authenticated using (app_is_admin());
revoke all on mail_caselle from anon, authenticated;
grant select on mail_caselle to authenticated;

create table if not exists mail_messaggi (
  id            uuid primary key default gen_random_uuid(),
  casella_id    text not null references mail_caselle(id) on delete cascade,
  direzione     text not null default 'in' check (direzione in ('in', 'out')),
  uid           bigint,                  -- UID IMAP (solo mail ricevute)
  message_id    text,
  in_reply_to   text,
  riferimenti   text,
  da_email      text,
  da_nome       text,
  a             text,
  oggetto       text,
  ricevuto_at   timestamptz not null,
  testo         text,                    -- testo semplice, senza la parte citata se riconoscibile
  allegati      jsonb not null default '[]',   -- [{ nome, tipo, dimensione }]
  automatica    boolean not null default false,
  importato_at  timestamptz not null default now(),
  unique (casella_id, uid)
);
create unique index if not exists mail_messaggi_msgid_idx on mail_messaggi (casella_id, message_id) where message_id is not null;
create index if not exists mail_messaggi_da_idx on mail_messaggi (lower(da_email), ricevuto_at desc);
create index if not exists mail_messaggi_data_idx on mail_messaggi (ricevuto_at desc);

alter table mail_messaggi enable row level security;
drop policy if exists "Admin legge mail" on mail_messaggi;
create policy "Admin legge mail" on mail_messaggi for select to authenticated using (app_is_admin());
revoke all on mail_messaggi from anon, authenticated;
grant select on mail_messaggi to authenticated;

-- Riepilogo per la scheda Collegamenti
create or replace function tc_mail_stato()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'caselle', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'indirizzo', c.indirizzo, 'nome', c.nome, 'attivo', c.attivo, 'attiva_dal', c.attiva_dal,
      'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore,
      'ricevute', (select count(*) from mail_messaggi m where m.casella_id = c.id and m.direzione = 'in'),
      'da_persone', (select count(*) from mail_messaggi m where m.casella_id = c.id and m.direzione = 'in' and not m.automatica)
    ) order by c.nome) from mail_caselle c
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_stato() from public, anon;
grant  execute on function tc_mail_stato() to authenticated;

-- Controllo delle caselle ogni 2 minuti (stessa chiave del collegamento Shopify)
create or replace function _tc_mail_sync_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/mail-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_mail_sync_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mail-sync') then
    perform cron.unschedule('mail-sync');
  end if;
  perform cron.schedule('mail-sync', '*/2 * * * *', 'select _tc_mail_sync_call()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
