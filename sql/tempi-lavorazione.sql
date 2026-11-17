-- ════════════════════════════════════════════════════════
-- T&C Factory — Tempi di lavorazione per categoria di prodotto (2026-11-17)
--
-- La stima dei lotti "Lavorazione ordini" non è più un tempo fisso a ordine:
-- per ogni riga dell'ordine si cerca la categoria dal titolo del prodotto (inizia con…)
-- e si somma quantità × stampe a capo × secondi a stampa (stampa, applicazione DTF o simile).
-- Le righe senza categoria non hanno tempo e si elencano nel task e nel Cervello.
--
-- Prova dei tempi (app_settings.tempi_test): quando è attiva, sui lotti di lavorazione
-- compaiono Inizia/Pausa; il tempo misurato (lavorato_sec) si confronta con la stima.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists tempi_categorie (
  id         bigint generated always as identity primary key,
  nome       text not null unique,
  inizia_con text[] not null default '{}',   -- il titolo del prodotto inizia con una di queste parole
  secondi    int not null check (secondi between 0 and 3600),   -- a stampa
  stampe     int not null default 1 check (stampe between 1 and 10),  -- stampe per capo (lati)
  ordine     int not null default 0
);
alter table tempi_categorie enable row level security;
drop policy if exists "Staff legge tempi categorie" on tempi_categorie;
drop policy if exists "Admin gestisce tempi categorie" on tempi_categorie;
create policy "Staff legge tempi categorie" on tempi_categorie for select to authenticated using (app_is_staff());
create policy "Admin gestisce tempi categorie" on tempi_categorie for all to authenticated using (app_is_admin()) with check (app_is_admin());

insert into tempi_categorie (nome, inizia_con, secondi, stampe, ordine) values
  ('Calzini',   '{calzin}',          60, 1, 1),
  ('T-shirt',   '{t-shirt,tshirt}',  20, 1, 2),
  ('Felpa',     '{felpa}',           30, 1, 3),
  ('Pantalone', '{pantalon}',        25, 1, 4)
on conflict (nome) do nothing;

insert into app_settings (key, value) values ('tempi_test', '{"attivo": false}')
on conflict (key) do nothing;

-- Categoria di un titolo prodotto (la prima in ordine che corrisponde)
create or replace function _tc_categoria_tempo(p_titolo text)
returns tempi_categorie stable language sql set search_path = public as $$
  select c.* from tempi_categorie c
   where exists (select 1 from unnest(c.inizia_con) p where trim(p) <> '' and lower(trim(coalesce(p_titolo, ''))) like lower(trim(p)) || '%')
   order by c.ordine, c.id limit 1;
$$;

-- Secondi di lavorazione delle righe di un ordine
create or replace function _tc_secondi_righe(p_righe jsonb)
returns int stable language sql set search_path = public as $$
  select coalesce(sum(greatest(1, coalesce((r->>'qnt')::int, 1)) * c.secondi * c.stampe), 0)::int
    from jsonb_array_elements(coalesce(nullif(p_righe, 'null'::jsonb), '[]'::jsonb)) r,
         lateral _tc_categoria_tempo(r->>'titolo') c
   where c.id is not null;
$$;

-- Titolo, minuti ed elenco del lotto. In lavorazione la stima viene dalle categorie.
create or replace function _tc_lotto_ricalcola(p_task uuid)
returns void security definer set search_path = public language plpgsql as $$
declare t tasks%rowtype; v_n int; v_min int; v_elenco text; v_store text; v_sec int; v_senza text; v_stima int;
begin
  select * into t from tasks where id = p_task;
  select count(*), string_agg(s.numero || coalesce(' · ' || s.cliente, '') || coalesce(': ' || (
           select string_agg((r->>'qnt') || '× ' || (r->>'titolo') || coalesce(' (' || (r->>'variante') || ')', ''), ', ') from jsonb_array_elements(s.righe) r), ''), E'\n' order by s.creato_at),
         sum(_tc_secondi_righe(s.righe))
    into v_n, v_elenco, v_sec from task_lotti_ordini l join shopify_orders s on s.id = l.ordine_id where l.task_id = p_task;
  if v_n = 0 then
    update tasks set stato = 'completato', descrizione = 'Tutti gli ordini del lotto risultano già evasi o annullati.' where id = p_task;
    return;
  end if;
  select minuti_standard into v_min from task_tipi where id = t.tipo_id;
  select nome into v_store from shopify_stores where id = t.macroarea;

  if t.fonte_rif->>'fase' = 'lav' then
    select string_agg(distinct r->>'titolo', ', ') into v_senza
      from task_lotti_ordini l join shopify_orders s on s.id = l.ordine_id, jsonb_array_elements(s.righe) r
     where l.task_id = p_task and _tc_categoria_tempo(r->>'titolo') is null;
    v_stima := least(960, greatest(1, ceil(coalesce(v_sec, 0) / 60.0)::int));
    if v_senza is not null then v_elenco := v_elenco || E'\n\nSenza tempo di lavorazione: ' || v_senza; end if;
  else
    v_stima := least(960, greatest(1, v_n * coalesce(v_min, 5)));
  end if;

  update tasks set titolo = left(_tc_lotto_tipo(t.fonte_rif->>'fase') || ' · ' || v_store || ' · ' || v_n || case when v_n = 1 then ' ordine' else ' ordini' end, 200),
                   minuti_stimati = v_stima, descrizione = left(v_elenco, 5000)
   where id = p_task;
end;
$$;

-- Aggiunge un ordine al lotto aperto della fase, o ne apre uno nuovo se è pieno o già iniziato
create or replace function _tc_lotto_aggiungi(p_ordine uuid, p_store text, p_fase text)
returns void security definer set search_path = public language plpgsql as $$
declare v_task uuid; p record; v_add int;
begin
  select id, minuti_standard, coalesce(limite_lotto_min, 240) lim into p from task_tipi where nome = _tc_lotto_tipo(p_fase);
  v_add := case when p_fase = 'lav'
                then (select greatest(1, ceil(_tc_secondi_righe(righe) / 60.0)::int) from shopify_orders where id = p_ordine)
                else p.minuti_standard end;
  select k.id into v_task from tasks k
   where k.fonte = 'shopify' and k.fonte_rif->>'fase' = p_fase and k.macroarea = p_store and k.stato = 'da_fare' and k.lavorato_sec = 0
     and coalesce(k.minuti_stimati, 0) + coalesce(v_add, 1) <= p.lim
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

-- Un lotto di lavorazione già iniziato tiene i suoi ordini anche se nel frattempo vengono evasi,
-- così il tempo misurato si confronta con la stima degli stessi ordini
create or replace function _tc_lotti()
returns void security definer set search_path = public language plpgsql as $$
declare t record; v_next text; o record;
begin
  -- Fuori dai lotti aperti gli ordini evasi o annullati; un lotto rimasto vuoto si chiude da solo
  for t in select k.id, k.fonte_rif->>'fase' fase from tasks k
            where k.fonte = 'shopify' and k.fonte_rif ? 'fase' and k.stato not in ('completato', 'non_completato')
              and not (k.fonte_rif->>'fase' = 'lav' and (k.lavorato_sec > 0 or k.stato = 'in_lavorazione')) loop
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

-- Cambiati i tempi: si ricalcolano i lotti di lavorazione aperti
create or replace function _tc_tempi_ricalcola()
returns trigger security definer set search_path = public language plpgsql as $$
declare k record;
begin
  for k in select id from tasks where fonte = 'shopify' and fonte_rif->>'fase' = 'lav' and stato not in ('completato', 'non_completato') loop
    perform _tc_lotto_ricalcola(k.id);
  end loop;
  return null;
end;
$$;
drop trigger if exists tempi_categorie_ricalcola on tempi_categorie;
create trigger tempi_categorie_ricalcola after insert or update or delete on tempi_categorie
  for each statement execute function _tc_tempi_ricalcola();

-- Risultati della prova: lotti misurati, stima con i tempi di adesso, prodotti senza categoria
create or replace function tc_tempi_test()
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_dal date := coalesce((select (value->>'dal')::date from app_settings where key = 'tempi_test'), tc_oggi());
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  return jsonb_build_object('success', true, 'dal', v_dal,
    'lotti', coalesce((
      select jsonb_agg(x order by x.at desc) from (
        select k.id, k.assegnato_a chi, k.macroarea negozio, k.completato_at at, k.lavorato_sec reale_sec,
               count(distinct l.ordine_id) ordini,
               coalesce(sum(_tc_secondi_righe(s.righe)), 0) stima_sec,
               (select jsonb_object_agg(cat, capi) from (
                  select coalesce(c.nome, 'Senza categoria') cat, sum(greatest(1, coalesce((r->>'qnt')::int, 1))) capi
                    from task_lotti_ordini l2 join shopify_orders s2 on s2.id = l2.ordine_id, jsonb_array_elements(s2.righe) r
                    left join lateral _tc_categoria_tempo(r->>'titolo') c on true
                   where l2.task_id = k.id group by 1) q) capi
          from tasks k join task_lotti_ordini l on l.task_id = k.id join shopify_orders s on s.id = l.ordine_id
         where k.fonte = 'shopify' and k.fonte_rif->>'fase' = 'lav' and k.stato = 'completato'
           and k.lavorato_sec > 0 and k.completato_at >= (v_dal::timestamp at time zone 'Europe/Rome')
         group by k.id) x), '[]'::jsonb),
    'senza_categoria', coalesce((
      select jsonb_agg(x order by x.capi desc) from (
        select r->>'titolo' titolo, sum(greatest(1, coalesce((r->>'qnt')::int, 1))) capi
          from shopify_orders s, jsonb_array_elements(s.righe) r
         where s.creato_at > now() - interval '60 days' and s.annullato_at is null
           and _tc_categoria_tempo(r->>'titolo') is null
         group by 1 order by 2 desc limit 60) x), '[]'::jsonb));
end;
$$;
revoke execute on function tc_tempi_test() from public, anon;
grant execute on function tc_tempi_test() to authenticated;

-- Ricalcolo dei lotti aperti con i tempi per categoria
do $$
declare k record;
begin
  for k in select id from tasks where fonte = 'shopify' and fonte_rif->>'fase' = 'lav' and stato not in ('completato', 'non_completato') loop
    perform _tc_lotto_ricalcola(k.id);
  end loop;
end $$;
