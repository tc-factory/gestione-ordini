-- ════════════════════════════════════════════════════════
-- T&C Factory — Collegamento Shopify (Centro di controllo, fase 1)
--
--   • shopify_stores: i negozi collegati, con il Client ID dell'app
--                     "Creative System" (il secret sta nei secret delle
--                     edge functions: SHOPIFY_SECRET_<ID IN MAIUSCOLO>)
--   • shopify_tokens: token di accesso giornalieri (solo il server li vede)
--   • shopify_orders: copia degli ordini dei negozi, aggiornata ogni 5 minuti
--                     dall'edge function shopify-sync
--   • i nuovi ordini finiscono anche in `eventi`, per il cervello
-- Richiede centro-controllo.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ─────────────────────────────────────────────
-- 1. Negozi
-- ─────────────────────────────────────────────

create table if not exists shopify_stores (
  id              text primary key check (id ~ '^[a-z0-9_]+$'),
  nome            text not null,
  dominio         text not null unique,
  client_id       text not null,
  attivo          boolean not null default true,
  sync_da         timestamptz,          -- updated_at dell'ultimo ordine letto (cursore)
  ultimo_sync_at  timestamptz,
  ultimo_errore   text,
  created_at      timestamptz not null default now()
);

insert into shopify_stores (id, nome, dominio, client_id) values
  ('ciucciamilcalzino', 'Ciucciami il Calzino', 'ciucciamilcalzino.myshopify.com', '413c9a4e3981d91d1eb1f2a0f54eb2d3'),
  ('boxfactorylab',     'Box Factory Lab',      'boxfactorylab2022.myshopify.com', '89c3bfaff46fc251c4507828bbd2fb5b'),
  ('asteroidi',         'Asteroidi Store',      'qzy0up-es.myshopify.com',         '1d8b5c068ccf46a43ae06f001cff63a9'),
  ('bienjugado',        'Bienjugado',           'bienjugado.myshopify.com',        'd7b2aeceec203bf0dac80df406bf3420')
on conflict (id) do update set nome = excluded.nome, dominio = excluded.dominio, client_id = excluded.client_id;

alter table shopify_stores enable row level security;
drop policy if exists "Admin legge negozi" on shopify_stores;
create policy "Admin legge negozi" on shopify_stores for select to authenticated using (app_is_admin());
revoke all on shopify_stores from anon, authenticated;
grant select on shopify_stores to authenticated;

-- ─────────────────────────────────────────────
-- 2. Token (solo service role)
-- ─────────────────────────────────────────────

create table if not exists shopify_tokens (
  store_id      text primary key references shopify_stores(id) on delete cascade,
  access_token  text not null,
  scade_at      timestamptz not null
);
alter table shopify_tokens enable row level security;
revoke all on shopify_tokens from anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. Ordini
-- ─────────────────────────────────────────────

create table if not exists shopify_orders (
  id               uuid primary key default gen_random_uuid(),
  store_id         text not null references shopify_stores(id) on delete cascade,
  shopify_id       text not null,          -- gid://shopify/Order/…
  numero           text not null,          -- #1043
  creato_at        timestamptz not null,
  aggiornato_at    timestamptz not null,
  annullato_at     timestamptz,
  cliente          text,
  email            text,
  telefono         text,
  telefono_cifre   text generated always as (nullif(right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 9), '')) stored,
  totale           numeric(12, 2),
  valuta           text,
  stato_pagamento  text,                   -- es. PAID, PENDING, REFUNDED
  stato_evasione   text,                   -- es. UNFULFILLED, FULFILLED, PARTIALLY_FULFILLED
  tracking         jsonb not null default '[]',   -- [{ corriere, numero, url, stato, at }]
  righe            jsonb not null default '[]',   -- [{ titolo, variante, sku, qnt }]
  indirizzo        jsonb,
  note             text,
  tags             text[] not null default '{}',
  importato_at     timestamptz not null default now(),
  unique (store_id, shopify_id)
);
create index if not exists shopify_orders_email_idx    on shopify_orders (lower(email));
create index if not exists shopify_orders_tel_idx      on shopify_orders (telefono_cifre);
create index if not exists shopify_orders_numero_idx   on shopify_orders (numero);
create index if not exists shopify_orders_creato_idx   on shopify_orders (creato_at desc);

alter table shopify_orders enable row level security;
drop policy if exists "Admin legge ordini shopify" on shopify_orders;
create policy "Admin legge ordini shopify" on shopify_orders for select to authenticated using (app_is_admin());
revoke all on shopify_orders from anon, authenticated;
grant select on shopify_orders to authenticated;

-- Riepilogo per la scheda Collegamenti
create or replace function tc_shopify_stato()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'negozi', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'nome', s.nome, 'dominio', s.dominio, 'attivo', s.attivo,
      'ultimo_sync_at', s.ultimo_sync_at, 'ultimo_errore', s.ultimo_errore, 'sync_da', s.sync_da,
      'da_evadere', (select count(*) from shopify_orders o where o.store_id = s.id and o.annullato_at is null
                       and o.stato_evasione in ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED')),
      -- Evasi e non ancora consegnati. Senza numero di tracking la consegna non si può sapere: non contano.
      -- "Consegnato" su Shopify non vale per chi ha un problema aperto: lo chiude solo GLS (come tracking-check).
      'in_consegna', (select count(*) from shopify_orders o
                        left join spedizioni_tracking k on k.ordine_id = o.id
                       where o.store_id = s.id and o.annullato_at is null and o.stato_evasione = 'FULFILLED'
                         and k.consegnata_at is null
                         and exists (select 1 from jsonb_array_elements(o.tracking) t where nullif(t->>'numero', '') is not null)
                         and (k.stato in ('problema', 'ritardo')
                              or not exists (select 1 from jsonb_array_elements(o.tracking) t where t->>'stato' = 'DELIVERED')))
    ) order by s.nome) from shopify_stores s
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_shopify_stato() from public, anon;
grant  execute on function tc_shopify_stato() to authenticated;

-- ─────────────────────────────────────────────
-- 4. Sincronizzazione automatica ogni 5 minuti
--    La chiave condivisa con l'edge function sta nel Vault ('shopify_sync_key')
--    e nei secret delle funzioni (SHOPIFY_SYNC_KEY).
-- ─────────────────────────────────────────────

create or replace function _tc_shopify_sync_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/shopify-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_shopify_sync_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'shopify-sync') then
    perform cron.unschedule('shopify-sync');
  end if;
  perform cron.schedule('shopify-sync', '*/5 * * * *', 'select _tc_shopify_sync_call()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
