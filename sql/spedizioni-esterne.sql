-- ════════════════════════════════════════════════════════
-- T&C Factory — Tutte le spedizioni GLS, anche senza ordine Shopify; giacenze svincolate nascoste
--
-- 1. spedizioni_esterne: le spedizioni del conto GLS (labelservice ListSpedPeriod) che non sono
--    legate a nessun ordine Shopify (altri canali). tracking-check le segue come le altre.
-- 2. Una giacenza svincolata resta nascosta finché GLS non registra qualcosa di diverso da una
--    nuova "giacenza" (GLS ripete l'evento ogni giorno finché il deposito non lavora lo svincolo):
--    torna fuori solo se dopo lo svincolo il pacco riparte e si ferma di nuovo.
-- 3. tc_spedizione_svincolata: "Già svincolata su GLS" per gli svincoli fatti dal portale GLS.
-- 4. Controllo ogni 15 minuti, dalle 7 alle 20.
-- Richiede spedizioni-giacenze.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists spedizioni_esterne (
  numero         text primary key,            -- LU660890522
  cliente_gls    text,
  spedita_at     timestamptz,
  riferimento    text,                        -- riferimento del mittente (es. #6851)
  ddt            text,
  destinatario   text,
  indirizzo      text,
  citta          text,
  provincia      text,
  stato          text not null default 'in_viaggio'
                 check (stato in ('in_viaggio', 'consegnata', 'problema', 'ritardo', 'senza_dati')),
  problema       text,
  ultimo_evento  text,
  ultimo_at      timestamptz,
  eventi         jsonb not null default '[]',
  deposito       jsonb,
  consegnata_at  timestamptz,
  controllata_at timestamptz,
  svincolata_at  timestamptz,
  svincolo_tipo  text,
  visto_at       timestamptz not null default now()
);
create index if not exists spedizioni_esterne_controllo_idx on spedizioni_esterne (controllata_at) where consegnata_at is null;
alter table spedizioni_esterne enable row level security;
revoke all on spedizioni_esterne from anon, authenticated;

-- Quali numeri GLS sono già legati a un ordine Shopify
create or replace function _tc_numeri_noti(p_numeri text[])
returns setof text security definer set search_path = public language sql stable as $$
  select n from unnest(p_numeri) n
   where exists (select 1 from spedizioni_tracking k where k.numero = n)
      or exists (select 1 from shopify_orders o where o.creato_at > now() - interval '120 days'
                   and o.tracking @> jsonb_build_array(jsonb_build_object('numero', n)));
$$;
revoke execute on function _tc_numeri_noti(text[]) from public, anon, authenticated;
grant  execute on function _tc_numeri_noti(text[]) to service_role;

create or replace function _tc_esterne_da_controllare(p_n int)
returns table (numero text, cliente_gls text, spedita_at timestamptz, riferimento text, destinatario text, giorni_lav int, giorni_testo text)
security definer set search_path = public language sql stable as $$
  select e.numero, e.cliente_gls, e.spedita_at, e.riferimento, e.destinatario,
         tc_giorni_lavorativi((e.spedita_at at time zone 'Europe/Rome')::date, tc_oggi()),
         tc_testo_giorni((e.spedita_at at time zone 'Europe/Rome')::date, tc_oggi())
    from spedizioni_esterne e
   where e.consegnata_at is null and e.spedita_at > now() - interval '30 days'
   order by e.controllata_at nulls first
   limit p_n;
$$;
revoke execute on function _tc_esterne_da_controllare(int) from public, anon, authenticated;
grant  execute on function _tc_esterne_da_controllare(int) to service_role;

-- Svincolata: istruzioni mandate e, dopo, nessun evento diverso da una nuova giacenza
create or replace function _tc_svincolata(p_at timestamptz, p_eventi jsonb)
returns boolean language sql immutable as $$
  select p_at is not null and not exists (
    select 1 from jsonb_array_elements(coalesce(p_eventi, '[]')) e
     where (e->>'at')::timestamptz > p_at and coalesce(e->>'codice', '') <> '66');
$$;

create or replace function tc_spedizioni_problemi()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'spedizioni', coalesce((select jsonb_agg(r order by r->>'stato', r->>'spedito_at') from (
    select jsonb_build_object(
      'ordine_id', k.ordine_id, 'store_id', k.store_id, 'numero', k.numero, 'stato', k.stato, 'problema', k.problema,
      'ultimo_evento', k.ultimo_evento, 'ultimo_at', k.ultimo_at, 'spedito_at', k.spedito_at, 'controllata_at', k.controllata_at,
      'giorni_testo', case when k.spedito_at is not null then tc_testo_giorni((k.spedito_at at time zone 'Europe/Rome')::date, tc_oggi()) end,
      'ordine', o.numero, 'cliente', o.cliente, 'email', o.email, 'telefono', o.telefono, 'citta', o.indirizzo->>'citta',
      'indirizzo', o.indirizzo,
      'task_id', t.id, 'fare', t.descrizione,
      'svincolata', _tc_svincolata(k.svincolata_at, k.eventi),
      'di_nuovo_ferma', k.svincolata_at is not null and not _tc_svincolata(k.svincolata_at, k.eventi),
      'svincolata_at', k.svincolata_at, 'svincolo_tipo', k.svincolo_tipo,
      'deposito', k.deposito,
      'avviso_cliente_at', k.avviso_cliente_at, 'avviso_cliente_esito', k.avviso_cliente_esito,
      'contatto', ct.analisi->'contatto',
      'task_svincolo_id', sv.id,
      'ferma_dal', g.ferma_dal,
      'ferma_testo', case when g.ferma_dal is not null then tc_testo_giorni((g.ferma_dal at time zone 'Europe/Rome')::date, tc_oggi()) end,
      'prima_giacenza_at', g.prima_giacenza_at, 'tentativi', g.tentativi, 'giacenze_n', g.giacenze_n,
      'eventi', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(k.eventi) e limit 5) x), '[]'::jsonb)
    ) r
      from spedizioni_tracking k
      join shopify_orders o on o.id = k.ordine_id
      left join tasks t on t.fonte_rif->>'evento_id' = 'consegna:' || k.ordine_id and t.stato not in ('completato', 'non_completato')
      left join lateral (select x.analisi from tasks x where x.fonte_rif->>'evento_id' = 'consegna:' || k.ordine_id
                          order by x.created_at desc limit 1) ct on true
      left join lateral (select x.id from tasks x where x.analisi->'svincolo'->>'tracking' = k.numero
                            and x.analisi->'svincolo'->>'stato' <> 'inviato' and x.stato not in ('completato', 'non_completato')
                          order by x.created_at desc limit 1) sv on true
      cross join lateral _tc_giacenza_tempi(k.eventi) g
     where k.stato in ('problema', 'ritardo') and o.annullato_at is null
    union all
    -- Spedizioni GLS senza ordine Shopify: i dati del cliente sono quelli dell'etichetta
    select jsonb_build_object(
      'esterna', true, 'store_id', null, 'numero', e.numero, 'stato', e.stato, 'problema', e.problema,
      'ultimo_evento', e.ultimo_evento, 'ultimo_at', e.ultimo_at, 'spedito_at', e.spedita_at, 'controllata_at', e.controllata_at,
      'giorni_testo', tc_testo_giorni((e.spedita_at at time zone 'Europe/Rome')::date, tc_oggi()),
      'ordine', e.riferimento, 'cliente', e.destinatario, 'citta', e.citta,
      'indirizzo', jsonb_build_object('via', e.indirizzo, 'citta', e.citta, 'provincia', e.provincia),
      'svincolata', _tc_svincolata(e.svincolata_at, e.eventi),
      'di_nuovo_ferma', e.svincolata_at is not null and not _tc_svincolata(e.svincolata_at, e.eventi),
      'svincolata_at', e.svincolata_at, 'svincolo_tipo', e.svincolo_tipo,
      'deposito', e.deposito,
      'fare', 'Spedizione senza ordine Shopify: contatta il destinatario dal canale di vendita e dai istruzioni a GLS.',
      'ferma_dal', g.ferma_dal,
      'ferma_testo', case when g.ferma_dal is not null then tc_testo_giorni((g.ferma_dal at time zone 'Europe/Rome')::date, tc_oggi()) end,
      'prima_giacenza_at', g.prima_giacenza_at, 'tentativi', g.tentativi, 'giacenze_n', g.giacenze_n,
      'eventi', coalesce((select jsonb_agg(x) from (select x from jsonb_array_elements(e.eventi) x limit 5) y), '[]'::jsonb)
    )
      from spedizioni_esterne e
      cross join lateral _tc_giacenza_tempi(e.eventi) g
     where e.stato in ('problema', 'ritardo') and e.consegnata_at is null
  ) q), '[]'::jsonb));
end;
$$;

-- Da quando è ferma, prima giacenza, tentativi falliti, giorni di giacenza
create or replace function _tc_giacenza_tempi(p_eventi jsonb)
returns table (ferma_dal timestamptz, prima_giacenza_at timestamptz, tentativi int, giacenze_n int)
language sql immutable as $$
  with ev as (select e, (e->>'at')::timestamptz at, e->>'codice' cod from jsonb_array_elements(coalesce(p_eventi, '[]')) e),
       altro as (select max(at) m from ev where cod is not null and cod not in ('66', '68', '69', '3', '6'))
  select min(at) filter (where cod in ('66', '68', '69', '3', '6') and at >= coalesce((select m from altro), '-infinity')),
         min(at) filter (where cod in ('66', '68', '69', '3', '6')),
         (count(*) filter (where cod in ('1', '7')))::int,
         (count(distinct left(e->>'at', 10)) filter (where cod = '66'))::int
    from ev;
$$;
revoke execute on function tc_spedizioni_problemi() from public, anon;
grant  execute on function tc_spedizioni_problemi() to authenticated;

-- "Già svincolata su GLS": svincolo fatto dal portale GLS, la giacenza sparisce dal gestionale
create or replace function tc_spedizione_svincolata(p_numero text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_ordine uuid; v_n int := 0;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  update spedizioni_tracking set svincolata_at = now(), svincolo_tipo = 'Dal portale GLS' where numero = p_numero returning ordine_id into v_ordine;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    update spedizioni_esterne set svincolata_at = now(), svincolo_tipo = 'Dal portale GLS' where numero = p_numero;
    get diagnostics v_n = row_count;
  end if;
  if v_n = 0 then return jsonb_build_object('success', false, 'error', 'Spedizione non trovata'); end if;
  if v_ordine is not null then
    update tasks set stato = 'completato', motivo = 'Chiuso da solo: svincolata dal portale GLS, si aspetta che GLS riparta'
     where fonte_rif->>'evento_id' = 'consegna:' || v_ordine and stato not in ('completato', 'non_completato');
  end if;
  insert into automazione_esecuzioni (nome, stato, fine, riepilogo, output)
  values ('svincolo-gls', 'ok', now(), jsonb_build_object('tracking', p_numero, 'tipo', 'Dal portale GLS', 'da', app_nickname()),
          p_numero || ' · segnata svincolata dal portale GLS');
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_spedizione_svincolata(text) from public, anon;
grant  execute on function tc_spedizione_svincolata(text) to authenticated;

-- Controllo ogni 15 minuti, dalle 7 alle 20 ora italiana
create or replace function _tc_tracking_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  if extract(hour from now() at time zone 'Europe/Rome') not between 7 and 20 then return; end if;
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
select cron.alter_job((select jobid from cron.job where jobname = 'tracking-check'), schedule := '4,19,34,49 * * * *');
