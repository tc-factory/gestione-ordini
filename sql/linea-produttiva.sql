-- ════════════════════════════════════════════════════════
-- T&C Factory — Task della linea produttiva e lotti Shopify (Centro di controllo)
--
-- Linea produttiva: un task per fase dell'ordine del gestionale. Il task nasce e si chiude
-- da solo guardando i pulsanti dell'ordine; solo "Ordinare la merce" si chiude a mano,
-- finché non c'è il collegamento ai fornitori. Vale per gli ordini creati da PROD_DAL in poi.
--
-- Shopify: niente task per ordine. Gli ordini si raggruppano in lotti per negozio e fase:
-- Stampa DDT → Preparare ordini → Lavorazione → Spedire. Chiuso un lotto, i suoi ordini
-- passano alla fase dopo. Se il lotto supera task_tipi.limite_lotto_min se ne apre un altro.
-- Richiede competenze.sql e ordini-fermi.sql già eseguiti. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_tipi add column if not exists limite_lotto_min int check (limite_lotto_min between 5 and 960);

insert into task_tipi (nome, minuti_standard, autonomia, competenza, descrizione) values
  ('Ordinare la merce',       15, 'solo_task', 'preparazione', 'Si chiude a mano finché non ci sono i fornitori collegati'),
  ('Preparazione merce',      20, 'solo_task', 'preparazione', 'Il corriere consegna: smistare la merce e creare l''ordine di lavorazione'),
  ('Preparazione DTF',        10, 'solo_task', 'preparazione', 'Caricare i file nella coda di stampa'),
  ('Stampa DTF',              30, 'solo_task', 'lavorazione',  'Dal pulsante STAMPA giallo al DTF verde'),
  ('Lavorazione UV',          30, 'solo_task', 'lavorazione',  ''),
  ('Lavorazione Laser',       30, 'solo_task', 'lavorazione',  ''),
  ('Lavorazione Plotter',     30, 'solo_task', 'lavorazione',  ''),
  ('Inviare a Ricamo',        15, 'solo_task', 'ext_ricamo',     ''),
  ('Inviare a Serigrafia',    15, 'solo_task', 'ext_serigrafia', ''),
  ('Inviare a Manifattura',   15, 'solo_task', 'ext_manifattura', ''),
  ('Inviare ad Arti grafiche',15, 'solo_task', 'ext_arti',       ''),
  ('Controllare Ricamo',       5, 'solo_task', 'ext_ricamo',     'Lavorazione esterna in corso da più di 5 giorni'),
  ('Controllare Serigrafia',   5, 'solo_task', 'ext_serigrafia', 'Lavorazione esterna in corso da più di 5 giorni'),
  ('Controllare Manifattura',  5, 'solo_task', 'ext_manifattura', 'Lavorazione esterna in corso da più di 5 giorni'),
  ('Controllare Arti grafiche',5, 'solo_task', 'ext_arti',       'Lavorazione esterna in corso da più di 5 giorni'),
  ('Controllo e confezionamento', 15, 'solo_task', 'spedizione', 'Tutte le lavorazioni finite'),
  ('Spedire o consegnare',    10, 'solo_task', 'spedizione',   ''),
  ('Stampa DDT',               2, 'solo_task', 'ddt',          'Lotto di ordini Shopify: minuti per ordine'),
  ('Preparare ordini',        10, 'solo_task', 'preparazione', 'Lotto di ordini Shopify: minuti per ordine'),
  ('Lavorazione ordini',      15, 'solo_task', 'lavorazione',  'Lotto di ordini Shopify: minuti per ordine'),
  ('Spedire ordini',           5, 'solo_task', 'spedizione',   'Lotto di ordini Shopify: minuti per ordine')
on conflict (nome) do nothing;
update task_tipi set limite_lotto_min = 60 where nome = 'Lavorazione ordini' and limite_lotto_min is null;

-- ─────────────────────────────────────────────
-- 1. Linea produttiva
-- ─────────────────────────────────────────────

create or replace function _tc_prod_apri(o orders, p_chiave text, p_tipo text, p_titolo text)
returns void security definer set search_path = public language sql as $$
  insert into tasks (tipo_id, titolo, descrizione, priorita, scadenza, fonte, fonte_rif, riferimento, creato_da)
  values ((select id from task_tipi where nome = p_tipo),
          left(p_titolo || ' · ' || coalesce(o.nome, o.id), 200), coalesce(o.notes, ''),
          case when o.deadline <= tc_oggi() + 1 then 'alta' else 'normale' end,
          case when o.deadline is not null then ((o.deadline + 1)::timestamp at time zone 'Europe/Rome') end,
          'gestionale', jsonb_build_object('evento_id', 'prod:' || o.id || ':' || p_chiave, 'ordine', o.id),
          jsonb_build_object('tipo', 'ordine', 'id', o.id, 'label', coalesce(o.nome, o.id)), 'cervello')
  on conflict do nothing;
$$;

create or replace function _tc_prod_chiudi(o orders, p_chiave text)
returns void security definer set search_path = public language sql as $$
  update tasks set stato = 'completato'
   where fonte_rif->>'evento_id' = 'prod:' || o.id || ':' || p_chiave and stato not in ('completato', 'non_completato');
$$;

create or replace function _tc_linea_produttiva()
returns void security definer set search_path = public language plpgsql as $$
declare
  o orders%rowtype; l record;
  v_dal constant timestamptz := '2026-11-05 00:00+01';   -- PROD_DAL: gli ordini già in corso non generano task
  v_merce boolean; v_interne text[]; v_esterne text[]; v_finite boolean; v_fatta boolean; v_mezzo jsonb;
  v_pulsanti jsonb := coalesce((select value from app_settings where key = 'pulsanti_ordine'), '[]'::jsonb);
begin
  for o in select * from orders where created_at >= v_dal and deleted_at is null and not coalesce((order_module->>'neutro')::boolean, false) loop
    -- Ordine finito: si chiude tutto quello che resta aperto
    if o.archived or coalesce((o.stages->'spedito'->>'done')::boolean, false) then
      update tasks set stato = 'completato'
       where fonte_rif->>'evento_id' like 'prod:' || o.id || ':%' and stato not in ('completato', 'non_completato');
      continue;
    end if;

    v_merce := coalesce((o.stages->'merceCompleta'->>'done')::boolean, false);
    select array_agg(distinct x) filter (where x is not null) into v_interne from (
      select jsonb_array_elements_text(case when coalesce((o.order_module->>'interna')::boolean, false) then coalesce(o.order_module->'lavInterne', '[]') else '[]' end) x
      union all select r->>'interna' from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r) q;
    select array_agg(distinct x) filter (where x is not null) into v_esterne from (
      select jsonb_array_elements_text(case when o.lavorazione_esterna then coalesce(o.order_module->'lavEsterne', '[]') else '[]' end) x
      union all select r->>'esterna' from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r) q;
    v_interne := coalesce(v_interne, '{}'); v_esterne := coalesce(v_esterne, '{}');
    v_finite := true;

    -- Merce: si ordina, poi si prepara quando arriva. C = merce arrivata e ordine pronto per la lavorazione
    if v_merce then
      perform _tc_prod_chiudi(o, 'ordinare'), _tc_prod_chiudi(o, 'merce');
    else
      perform _tc_prod_apri(o, 'ordinare', 'Ordinare la merce', 'Ordinare la merce');
      if exists (select 1 from tasks where fonte_rif->>'evento_id' = 'prod:' || o.id || ':ordinare' and stato = 'completato') then
        perform _tc_prod_apri(o, 'merce', 'Preparazione merce', 'Preparazione merce');
      end if;
    end if;

    -- DTF: file in coda, poi pulsante giallo STAMPA, poi verde
    if 'li-dtf' = any(v_interne) or jsonb_array_length(coalesce(nullif(o.dtf_items, 'null'::jsonb), '[]'::jsonb)) > 0 then
      v_fatta := coalesce((o.stages->'dtfPronti'->>'done')::boolean, false);
      if v_fatta then
        perform _tc_prod_chiudi(o, 'prep_dtf'), _tc_prod_chiudi(o, 'stampa_dtf');
      elsif o.stages ? 'mezzo:dtfPronti' then
        perform _tc_prod_chiudi(o, 'prep_dtf'), _tc_prod_apri(o, 'stampa_dtf', 'Stampa DTF', 'Stampa DTF');
        v_finite := false;
      else
        v_finite := false;
        if v_merce then perform _tc_prod_apri(o, 'prep_dtf', 'Preparazione DTF', 'Preparazione DTF'); end if;
      end if;
    end if;

    -- Lavorazioni interne
    for l in select * from (values ('li-uv', 'Lavorazione UV'), ('li-laser', 'Lavorazione Laser'), ('li-stampa', 'Lavorazione Plotter')) v(id, tipo) where id = any(v_interne) loop
      if o.order_module->'interneFatte' ? l.id then
        perform _tc_prod_chiudi(o, l.id);
      else
        v_finite := false;
        if v_merce then perform _tc_prod_apri(o, l.id, l.tipo, l.tipo); end if;
      end if;
    end loop;

    -- Lavorazioni esterne: invio, poi controllo se resta gialla più di 5 giorni
    for l in select * from (values ('le-mv0p0i6j', 'Ricamo', 'a Ricamo'), ('le-mv0p0mdm', 'Serigrafia', 'a Serigrafia'),
                                   ('le-mv0p1m01', 'Manifattura', 'a Manifattura'), ('le-mv0p2p9a', 'Arti grafiche', 'ad Arti grafiche')) v(id, nome, a)
              where id = any(v_esterne) loop
      select o.stages->('mezzo:' || (p->>'id')) into v_mezzo from jsonb_array_elements(v_pulsanti) p
       where p->>'collegamento' = 'esterne:' || l.id and o.stages ? ('mezzo:' || (p->>'id')) limit 1;
      if o.order_module->'esterneFatte' ? l.id then
        perform _tc_prod_chiudi(o, 'invio:' || l.id), _tc_prod_chiudi(o, 'controllo:' || l.id);
      else
        v_finite := false;
        if v_mezzo is not null then
          perform _tc_prod_chiudi(o, 'invio:' || l.id);
          if (v_mezzo->>'date')::date <= tc_oggi() - 5 then
            perform _tc_prod_apri(o, 'controllo:' || l.id, 'Controllare ' || l.nome, 'Controllare ' || l.nome);
          end if;
        elsif v_merce then
          perform _tc_prod_apri(o, 'invio:' || l.id, 'Inviare ' || l.a, 'Inviare ' || l.a);
        end if;
      end if;
      v_mezzo := null;
    end loop;

    -- Chiusura della lavorazione e spedizione
    if coalesce((o.stages->'ordineStampato'->>'done')::boolean, false) then
      perform _tc_prod_chiudi(o, 'controllo'), _tc_prod_apri(o, 'spedire', 'Spedire o consegnare', 'Spedire o consegnare');
    elsif v_merce and v_finite then
      perform _tc_prod_apri(o, 'controllo', 'Controllo e confezionamento', 'Controllo e confezionamento');
    end if;
  end loop;
end;
$$;
revoke execute on function _tc_linea_produttiva() from public, anon, authenticated;
revoke execute on function _tc_prod_apri(orders, text, text, text) from public, anon, authenticated;
revoke execute on function _tc_prod_chiudi(orders, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Lotti Shopify
-- ─────────────────────────────────────────────

create table if not exists task_lotti_ordini (
  task_id   uuid not null references tasks(id) on delete cascade,
  ordine_id uuid not null references shopify_orders(id) on delete cascade,
  primary key (task_id, ordine_id)
);
alter table task_lotti_ordini enable row level security;
revoke all on task_lotti_ordini from anon, authenticated;

create or replace function _tc_lotto_tipo(p_fase text) returns text language sql immutable as $$
  select case p_fase when 'ddt' then 'Stampa DDT' when 'prep' then 'Preparare ordini' when 'lav' then 'Lavorazione ordini' when 'spedire' then 'Spedire ordini' end;
$$;

-- Titolo, minuti ed elenco del lotto
create or replace function _tc_lotto_ricalcola(p_task uuid)
returns void security definer set search_path = public language plpgsql as $$
declare t tasks%rowtype; v_n int; v_min int; v_elenco text; v_store text;
begin
  select * into t from tasks where id = p_task;
  select count(*), string_agg(s.numero || coalesce(' · ' || s.cliente, '') || coalesce(': ' || (
           select string_agg((r->>'qnt') || '× ' || (r->>'titolo') || coalesce(' (' || (r->>'variante') || ')', ''), ', ') from jsonb_array_elements(s.righe) r), ''), E'\n' order by s.creato_at)
    into v_n, v_elenco from task_lotti_ordini l join shopify_orders s on s.id = l.ordine_id where l.task_id = p_task;
  if v_n = 0 then
    update tasks set stato = 'completato', descrizione = 'Tutti gli ordini del lotto risultano già evasi o annullati.' where id = p_task;
    return;
  end if;
  select minuti_standard into v_min from task_tipi where id = t.tipo_id;
  select nome into v_store from shopify_stores where id = t.macroarea;
  update tasks set titolo = left(_tc_lotto_tipo(t.fonte_rif->>'fase') || ' · ' || v_store || ' · ' || v_n || case when v_n = 1 then ' ordine' else ' ordini' end, 200),
                   minuti_stimati = least(960, greatest(1, v_n * coalesce(v_min, 5))), descrizione = left(v_elenco, 5000)
   where id = p_task;
end;
$$;

-- Aggiunge un ordine al lotto aperto della fase, o ne apre uno nuovo se è pieno o già iniziato
create or replace function _tc_lotto_aggiungi(p_ordine uuid, p_store text, p_fase text)
returns void security definer set search_path = public language plpgsql as $$
declare v_task uuid; p record;
begin
  select id, minuti_standard, coalesce(limite_lotto_min, 240) lim into p from task_tipi where nome = _tc_lotto_tipo(p_fase);
  select k.id into v_task from tasks k
   where k.fonte = 'shopify' and k.fonte_rif->>'fase' = p_fase and k.macroarea = p_store and k.stato = 'da_fare' and k.lavorato_sec = 0
     and coalesce(k.minuti_stimati, 0) + p.minuti_standard <= p.lim
   order by k.created_at limit 1;
  if v_task is null then
    insert into tasks (tipo_id, titolo, macroarea, fonte, fonte_rif, creato_da)
    values (p.id, _tc_lotto_tipo(p_fase), p_store, 'shopify', jsonb_build_object('fase', p_fase), 'cervello')
    returning id into v_task;
  end if;
  insert into task_lotti_ordini (task_id, ordine_id) values (v_task, p_ordine) on conflict do nothing;
  perform _tc_lotto_ricalcola(v_task);
end;
$$;

create or replace function _tc_lotti()
returns void security definer set search_path = public language plpgsql as $$
declare t record; v_next text; o record;
begin
  -- Fuori dai lotti aperti gli ordini evasi o annullati; un lotto rimasto vuoto si chiude da solo
  for t in select k.id, k.fonte_rif->>'fase' fase from tasks k
            where k.fonte = 'shopify' and k.fonte_rif ? 'fase' and k.stato not in ('completato', 'non_completato') loop
    delete from task_lotti_ordini l using shopify_orders s
     where l.task_id = t.id and s.id = l.ordine_id and (s.annullato_at is not null or s.stato_evasione = 'FULFILLED');
    if found then perform _tc_lotto_ricalcola(t.id); end if;
  end loop;

  -- Lotti chiusi: gli ordini passano alla fase dopo
  for t in select k.id, k.macroarea, k.fonte_rif->>'fase' fase from tasks k
            where k.fonte = 'shopify' and k.fonte_rif ? 'fase' and k.stato = 'completato' and not k.fonte_rif ? 'avanzato' loop
    v_next := case t.fase when 'ddt' then 'prep' when 'prep' then 'lav' when 'lav' then 'spedire' end;
    if v_next is not null then
      for o in select l.ordine_id from task_lotti_ordini l join shopify_orders s on s.id = l.ordine_id
                where l.task_id = t.id and s.annullato_at is null and s.stato_evasione is distinct from 'FULFILLED' loop
        perform _tc_lotto_aggiungi(o.ordine_id, t.macroarea, v_next);
      end loop;
    end if;
    update tasks set fonte_rif = fonte_rif || '{"avanzato": true}' where id = t.id;
  end loop;
end;
$$;
revoke execute on function _tc_lotti() from public, anon, authenticated;
revoke execute on function _tc_lotto_aggiungi(uuid, text, text) from public, anon, authenticated;
revoke execute on function _tc_lotto_ricalcola(uuid) from public, anon, authenticated;

-- Gli ordini Shopify nuovi entrano nel lotto DDT invece di creare un task ciascuno
do $$
declare v text; a int; b int;
begin
  select pg_get_functiondef('_tc_task_automatici'::regproc) into v;
  if v like '%_tc_lotto_aggiungi%' then return; end if;
  a := position('insert into tasks (tipo_id, titolo, descrizione, macroarea, fonte, fonte_rif, creato_da)' in v);
  b := position('update eventi set elaborato_at = now(), esito = ''Task creato''' in v);
  v := left(v, a - 1) || 'perform _tc_lotto_aggiungi(o.id, o.store_id, ''ddt'');' || E'\n      '
       || 'update eventi set elaborato_at = now(), esito = ''Nel lotto DDT'' where id = e.id;' || E'\n    '
       || substr(v, position('end if;' in substr(v, b)) + b - 1);
  execute v;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'linea-produttiva') then perform cron.unschedule('linea-produttiva'); end if;
  perform cron.schedule('linea-produttiva', '3-59/5 * * * *', 'select _tc_linea_produttiva(); select _tc_lotti();');
end $$;
