-- ════════════════════════════════════════════════════════
-- T&C Factory — Ordini fermi (Centro di controllo)
--
-- Ogni negozio ha i suoi giorni massimi (shopify_stores.giorni_evasione). Superati:
--   • ordine pagato non evaso    → il suo task diventa priorità alta, o ne nasce uno
--   • pagamento in sospeso       → task "Pagamento in sospeso"
-- In più, ordine evaso da più di un giorno senza numero di tracking → task.
-- I task si chiudono da soli quando il problema si risolve.
-- Richiede cervello-2.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table shopify_stores add column if not exists giorni_evasione int not null default 5 check (giorni_evasione between 1 and 60);
update shopify_stores set giorni_evasione = 3 where id = 'ciucciamilcalzino';
update shopify_stores set giorni_evasione = 5 where id in ('bienjugado', 'asteroidi', 'boxfactorylab');

insert into task_tipi (nome, minuti_standard, autonomia, descrizione) values
  ('Ordine fermo',         10, 'solo_task', 'Ordine pagato non evaso oltre i giorni del negozio'),
  ('Pagamento in sospeso',  5, 'solo_task', 'Pagamento non arrivato oltre i giorni del negozio'),
  ('Tracking mancante',     5, 'solo_task', 'Ordine evaso senza numero di tracking')
on conflict (nome) do nothing;

create or replace function _tc_ordini_fermi()
returns void security definer set search_path = public language plpgsql as $$
declare o record; v_aperto uuid;
begin
  for o in
    select s.*, st.giorni_evasione lim, extract(day from now() - s.creato_at)::int eta
      from shopify_orders s join shopify_stores st on st.id = s.store_id
     where s.annullato_at is null and s.creato_at > now() - interval '60 days'
  loop
    -- Pagato, non evaso
    if o.eta >= o.lim and o.stato_pagamento in ('PAID', 'PARTIALLY_PAID', 'PARTIALLY_REFUNDED')
       and o.stato_evasione in ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'ON_HOLD', 'IN_PROGRESS', 'SCHEDULED') then
      select id into v_aperto from tasks
       where fonte = 'shopify' and fonte_rif->>'ordine' = o.id::text and fonte_rif->>'motivo' is null
         and stato not in ('completato', 'non_completato');
      if v_aperto is not null then
        update tasks set priorita = 'alta',
               titolo = left('FERMO da ' || o.eta || ' giorni · ' || regexp_replace(titolo, '^FERMO da \d+ giorni · ', ''), 200)
         where id = v_aperto and priorita not in ('urgente');
      else
        insert into tasks (tipo_id, titolo, descrizione, priorita, macroarea, fonte, fonte_rif, creato_da)
        values ((select id from task_tipi where nome = 'Ordine fermo'),
                left('FERMO da ' || o.eta || ' giorni · ordine ' || o.numero || coalesce(' · ' || o.cliente, ''), 200),
                coalesce((select string_agg((r->>'qnt') || '× ' || (r->>'titolo') || coalesce(' (' || (r->>'variante') || ')', ''), E'\n') from jsonb_array_elements(o.righe) r), ''),
                'alta', o.store_id, 'shopify', jsonb_build_object('evento_id', 'fermo:' || o.id, 'ordine', o.id), 'cervello')
        on conflict do nothing;
      end if;
    end if;

    -- Pagamento in sospeso
    if o.eta >= o.lim and o.stato_pagamento in ('PENDING', 'AUTHORIZED') then
      insert into tasks (tipo_id, titolo, descrizione, macroarea, fonte, fonte_rif, creato_da)
      values ((select id from task_tipi where nome = 'Pagamento in sospeso'),
              left('Pagamento in sospeso da ' || o.eta || ' giorni · ordine ' || o.numero || coalesce(' · ' || o.cliente, ''), 200),
              'Sollecitare il cliente o annullare l''ordine.',
              o.store_id, 'shopify', jsonb_build_object('evento_id', 'pagamento:' || o.id, 'ordine', o.id, 'motivo', 'pagamento'), 'cervello')
      on conflict do nothing;
    end if;

    -- Evaso senza tracking (solo ordini recenti)
    if o.stato_evasione = 'FULFILLED' and o.eta between 1 and 14
       and not exists (select 1 from jsonb_array_elements(o.tracking) t where coalesce(t->>'numero', t->>'url') is not null) then
      insert into tasks (tipo_id, titolo, descrizione, macroarea, fonte, fonte_rif, creato_da)
      values ((select id from task_tipi where nome = 'Tracking mancante'),
              left('Tracking mancante · ordine ' || o.numero || coalesce(' · ' || o.cliente, ''), 200),
              'L''ordine risulta evaso ma su Shopify non c''è un numero di tracking.',
              o.store_id, 'shopify', jsonb_build_object('evento_id', 'tracking:' || o.id, 'ordine', o.id, 'motivo', 'tracking'), 'cervello')
      on conflict do nothing;
    end if;
  end loop;

  -- Chiusura automatica
  update tasks t set stato = 'completato' from shopify_orders s
   where t.fonte = 'shopify' and t.fonte_rif->>'motivo' = 'pagamento' and t.stato not in ('completato', 'non_completato')
     and s.id = (t.fonte_rif->>'ordine')::uuid
     and (s.annullato_at is not null or s.stato_pagamento not in ('PENDING', 'AUTHORIZED'));
  update tasks t set stato = 'completato' from shopify_orders s
   where t.fonte = 'shopify' and t.fonte_rif->>'motivo' = 'tracking' and t.stato not in ('completato', 'non_completato')
     and s.id = (t.fonte_rif->>'ordine')::uuid
     and exists (select 1 from jsonb_array_elements(s.tracking) x where coalesce(x->>'numero', x->>'url') is not null);
end;
$$;
revoke execute on function _tc_ordini_fermi() from public, anon, authenticated;

-- La chiusura "ordine evaso" vale solo per i task di preparazione, non per quelli di pagamento e tracking
do $$
declare v text;
begin
  select pg_get_functiondef('_tc_task_automatici'::regproc) into v;
  if v not like '%t.fonte_rif->>''motivo'' is null%' then
    v := replace(v, 'where t.fonte = ''shopify'' and t.stato not in', 'where t.fonte = ''shopify'' and t.fonte_rif->>''motivo'' is null and t.stato not in');
    execute v;
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ordini-fermi') then perform cron.unschedule('ordini-fermi'); end if;
  perform cron.schedule('ordini-fermi', '7 * * * *', 'select _tc_ordini_fermi()');
end $$;
