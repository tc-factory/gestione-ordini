-- ════════════════════════════════════════════════════════
-- T&C Factory — Le modifiche fatte a mano sui negozi Shopify diventano task completati
--
-- L'edge function shopify-modifiche legge ogni 15 minuti lo storico eventi dei negozi
-- e salva qui le modifiche fatte da una persona nell'admin (non quelle delle app:
-- le modifiche fatte da Riccardo con Claude passano dall'app e non contano, gli ordini nemmeno).
-- Chi le ha fatte non si sa: valgono per il responsabile "<negozio>:siti" (Gianluca),
-- solo nei giorni in cui ha confermato la presenza.
-- Le modifiche vicine (pause sotto i 20 minuti) fanno una sessione = un task completato
-- "Modifiche al sito", tempo = dalla prima all'ultima modifica + 5 minuti.
-- Le sessioni si ricalcolano finché il giorno è aperto. Si può rieseguire.
-- A ritroso: select _tc_siti_sync_call('{"dal":"2026-09-01","al":"2026-09-15"}');
-- ════════════════════════════════════════════════════════

create table if not exists siti_modifiche (
  store_id    text not null,
  evento_id   text not null,
  at          timestamptz not null,
  oggetto     text not null default '',      -- PRODUCT, COLLECTION, PAGE, ...
  messaggio   text not null default '',
  primary key (store_id, evento_id)
);
alter table siti_modifiche add column if not exists soggetto text;   -- id del prodotto/pagina modificato
create index if not exists siti_modifiche_at_idx on siti_modifiche (store_id, at);
alter table siti_modifiche enable row level security;

insert into task_tipi (nome, descrizione, minuti_standard, competenza, area, autonomia)
values ('Modifiche al sito',
        'Modifiche fatte a mano nell''admin di Shopify (prodotti, collezioni, pagine, sconti, menu): registrate in automatico dallo storico del negozio.',
        30, 'siti', null, 'solo_task')
on conflict (nome) do update set descrizione = excluded.descrizione, competenza = excluded.competenza;

insert into competenze_responsabili (voce, primario)
select s.id || ':siti', 'gianluca' from shopify_stores s
on conflict (voce) do nothing;

create unique index if not exists tasks_sessione_siti_idx on tasks ((fonte_rif->>'sessione')) where fonte = 'shopify_admin';

-- Nomi degli oggetti nel titolo
create or replace function _tc_siti_oggetto(p text, n int)
returns text immutable language sql as $$
  select n || ' ' || case p
    when 'PRODUCT'         then case when n = 1 then 'prodotto' else 'prodotti' end
    when 'PRODUCT_VARIANT' then case when n = 1 then 'variante' else 'varianti' end
    when 'COLLECTION'      then case when n = 1 then 'collezione' else 'collezioni' end
    when 'PAGE'            then case when n = 1 then 'pagina' else 'pagine' end
    when 'ARTICLE'         then case when n = 1 then 'articolo' else 'articoli' end
    when 'BLOG'            then 'blog'
    when 'PRICE_RULE'      then case when n = 1 then 'sconto' else 'sconti' end
    when 'DISCOUNT'        then case when n = 1 then 'sconto' else 'sconti' end
    when 'THEME'           then case when n = 1 then 'modifica al tema' else 'modifiche al tema' end
    else case when n = 1 then 'altra modifica' else 'altre modifiche' end
  end;
$$;

-- Ricalcola le sessioni di un giorno: un task per sessione, solo se il responsabile era presente
create or replace function tc_registra_modifiche_siti(p_giorno date)
returns int security definer set search_path = public language plpgsql as $$
declare
  v_tipo uuid := (select id from task_tipi where nome = 'Modifiche al sito');
  v_n    int := 0;
  r      record;
  v_id   uuid;
  v_chi  text;
begin
  -- Sessioni: si spezza dopo 20 minuti senza modifiche
  create temp table if not exists _sessioni (chiave text, store_id text, inizio timestamptz, fine timestamptz,
                                             titolo text, descrizione text) on commit drop;
  truncate _sessioni;
  insert into _sessioni
  with m as (
    select *, (at at time zone 'Europe/Rome')::date as giorno,
           case when at - lag(at) over (partition by store_id order by at) <= interval '20 minutes' then 0 else 1 end as nuova
      from siti_modifiche
     where (at at time zone 'Europe/Rome')::date = p_giorno
  ), g as (
    select *, sum(nuova) over (partition by store_id order by at) as sess from m
  ), conteggi as (
    select store_id, sess, oggetto, count(distinct coalesce(soggetto, evento_id))::int as n from g group by 1, 2, 3
  )
  select g.store_id || ':' || p_giorno || ':' || min(g.evento_id) filter (where g.nuova = 1),
         g.store_id, min(g.at), max(g.at),
         (select s.nome from shopify_stores s where s.id = g.store_id) || ': ' ||
           (select string_agg(_tc_siti_oggetto(c.oggetto, c.n), ', ' order by c.n desc)
              from conteggi c where c.store_id = g.store_id and c.sess = g.sess),
         string_agg(to_char(g.at at time zone 'Europe/Rome', 'HH24:MI') || '  ' || g.messaggio, E'\n' order by g.at)
    from g group by g.store_id, g.sess;

  -- Sessioni che non esistono più (si sono unite a un'altra): via
  delete from tasks t
   where t.fonte = 'shopify_admin' and t.giorno = p_giorno
     and not exists (select 1 from _sessioni s where s.chiave = t.fonte_rif->>'sessione');

  for r in select * from _sessioni loop
    v_chi := coalesce((select primario from competenze_responsabili where voce = r.store_id || ':siti'), 'gianluca');
    -- Prima delle presenze (17/11/2026) vale il Planner: giorno lavorativo senza ferie o impegni
    if not (case when p_giorno < date '2026-11-17'
                 then tc_giorno_lavorativo(p_giorno) and not tc_assente(v_chi, p_giorno)
                 else exists (select 1 from presenze p where p.nickname = v_chi and p.giorno = p_giorno and p.stato = 'presente') end) then
      delete from tasks where fonte = 'shopify_admin' and fonte_rif->>'sessione' = r.chiave;
      continue;
    end if;
    select id into v_id from tasks where fonte = 'shopify_admin' and fonte_rif->>'sessione' = r.chiave;
    if v_id is null then
      insert into tasks (tipo_id, titolo, descrizione, stato, assegnato_a, giorno, minuti_stimati, lavorato_sec,
                         fonte, fonte_rif, macroarea, creato_da)
      values (v_tipo, left(r.titolo, 200), left(r.descrizione, 5000), 'completato', v_chi, p_giorno, 1, 60,
              'shopify_admin', jsonb_build_object('sessione', r.chiave, 'store', r.store_id), r.store_id, 'shopify_admin')
      returning id into v_id;
    end if;
    update tasks
       set titolo = left(r.titolo, 200), descrizione = left(r.descrizione, 5000), assegnato_a = v_chi,
           minuti_stimati = least(960, greatest(1, ceil(extract(epoch from r.fine - r.inizio) / 60)::int + 5)),
           lavorato_sec   = least(960, greatest(1, ceil(extract(epoch from r.fine - r.inizio) / 60)::int + 5)) * 60,
           completato_at  = r.fine
     where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function tc_registra_modifiche_siti(date) from public, anon, authenticated;

-- Salva le modifiche lette da Shopify e ricalcola i giorni toccati (chiamata dall'edge function)
create or replace function tc_salva_modifiche_siti(p jsonb)
returns int security definer set search_path = public language plpgsql as $$
declare v_g date; v_n int := 0;
begin
  insert into siti_modifiche (store_id, evento_id, at, oggetto, soggetto, messaggio)
  select e->>'store_id', e->>'id', (e->>'at')::timestamptz, coalesce(e->>'oggetto', ''), e->>'soggetto', left(coalesce(e->>'messaggio', ''), 500)
    from jsonb_array_elements(p) e
  on conflict (store_id, evento_id) do update set soggetto = excluded.soggetto;
  -- Oggi e ieri: anche la presenza confermata più tardi fa contare le modifiche del mattino
  for v_g in select distinct d from (
      select (now() at time zone 'Europe/Rome')::date d
      union select (now() at time zone 'Europe/Rome')::date - 1
      union select ((e->>'at')::timestamptz at time zone 'Europe/Rome')::date from jsonb_array_elements(p) e) x loop
    v_n := v_n + tc_registra_modifiche_siti(v_g);
  end loop;
  return v_n;
end;
$$;
revoke execute on function tc_salva_modifiche_siti(jsonb) from public, anon, authenticated;

-- Ogni 15 minuti
drop function if exists _tc_siti_sync_call();
create or replace function _tc_siti_sync_call(p_body jsonb default '{}')
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/shopify-modifiche',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := p_body,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_siti_sync_call(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'shopify-modifiche') then
    perform cron.unschedule('shopify-modifiche');
  end if;
  perform cron.schedule('shopify-modifiche', '7-59/15 * * * *', 'select _tc_siti_sync_call()');
end $$;
