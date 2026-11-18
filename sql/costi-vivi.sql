-- ════════════════════════════════════════════════════════
-- T&C Factory — Costi vivi e costo degli ordini (2026-11-18)
--
-- Centro di controllo → Costi vivi: tutti i costi diretti di produzione in un posto.
--   • Manodopera: app_settings.costo_ora, uguale per tutti
--   • DTF: materiali di Impostazioni → DTF (supporto, inchiostri, colla) → € al metro
--   • Lavorazioni interne ed esterne: € a pezzo (costi_vivi, voce "lav:<id>")
--   • Merce degli ordini del gestionale: products.costo dalla riga collegata al prodotto
-- Quello che ha un costo di produzione ma non ha ancora un valore si segnala come "da impostare".
--
-- Il tempo di lavoro è sempre la STIMA (tempi per categoria e minuti dei tipi di task):
-- il cronometro serve solo nella prova dei tempi, per controllare le stime.
--
-- Richiede consuntivo-costi.sql e tempi-lavorazione.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists costi_vivi (
  voce       text primary key,            -- "lav:li-uv", "lav:le-mv0p0i6j"
  valore     numeric(10,4) check (valore is null or valore >= 0),
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table costi_vivi enable row level security;
drop policy if exists "Admin gestisce costi vivi" on costi_vivi;
create policy "Admin gestisce costi vivi" on costi_vivi for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on costi_vivi from anon, authenticated;
grant select, insert, update, delete on costi_vivi to authenticated;

-- Ogni prodotto ha il suo costo: niente costo a capo per categoria
alter table tempi_categorie drop column if exists costo_capo;

-- € al metro del DTF interno dai materiali (come DtfMisure.costoAlMetro), altrimenti il vecchio €/metro fisso
create or replace function _tc_dtf_costo_m()
returns numeric stable language sql security definer set search_path = public as $$
  with s as (select key, nullif(trim(both '"' from value::text), '')::numeric v from app_settings
              where key in ('dtf_supporto_eur', 'dtf_supporto_m', 'dtf_ink_white_eur', 'dtf_ink_white_m',
                            'dtf_ink_cmyk_eur', 'dtf_ink_cmyk_m', 'dtf_colla_eur', 'dtf_colla_m', 'dtf_cost_m')
                and value::text ~ '^"?[0-9]+(\.[0-9]+)?"?$'),
       m as (
         select (select v from s where key = 'dtf_supporto_eur') se, coalesce((select v from s where key = 'dtf_supporto_m'), 100) sm,
                (select v from s where key = 'dtf_ink_white_eur') we, (select v from s where key = 'dtf_ink_white_m') wm,
                (select v from s where key = 'dtf_ink_cmyk_eur') ce, (select v from s where key = 'dtf_ink_cmyk_m') cm,
                (select v from s where key = 'dtf_colla_eur') ke, (select v from s where key = 'dtf_colla_m') km,
                (select v from s where key = 'dtf_cost_m') fisso)
  select coalesce(nullif(
           coalesce(case when sm > 0 then se / sm end, 0)
         + coalesce(case when wm > 0 then we / wm end, 0)
         + coalesce(case when cm > 0 then 4 * ce / cm end, 0)
         + coalesce(case when km > 0 then ke / km end, 0), 0), fisso)
    from m;
$$;
revoke execute on function _tc_dtf_costo_m() from public, anon;
grant execute on function _tc_dtf_costo_m() to authenticated;

-- Numero di una riga ("10", "10 pz", "") → 10, 0
create or replace function _tc_num(p text)
returns numeric immutable language sql as $$
  select coalesce(nullif(substring(replace(coalesce(p, ''), ',', '.') from '[0-9]+(?:\.[0-9]+)?'), ''), '0')::numeric;
$$;

-- Costo di un ordine del gestionale: manodopera stimata delle fasi fatte, DTF, lavorazioni, merce.
-- "mancano": cosa non si è potuto valorizzare
create or replace function _tc_ordine_costo(p_ordine text)
returns jsonb stable security definer set search_path = public language plpgsql as $$
declare
  o orders%rowtype; v_def numeric := coalesce((select (value->>'valore')::numeric from app_settings where key = 'costo_ora'), 11.31);
  v_man numeric; v_min numeric; v_dtf numeric := 0; v_metri numeric := 0; v_lav numeric := 0; v_merce numeric := 0;
  v_manca text[] := '{}'; v_tot_pz numeric; l record; v_righe_senza int; v_prod_senza int; v_dtf_m numeric := _tc_dtf_costo_m();
  v_lavs jsonb := coalesce((select value from app_settings where key = 'lavorazioni_interne'), '[]') || coalesce((select value from app_settings where key = 'lavorazioni_esterne'), '[]');
begin
  select * into o from orders where id = p_ordine;
  if not found then return null; end if;

  -- Manodopera: minuti stimati delle fasi fatte, al costo orario di chi le ha fatte
  select coalesce(sum(coalesce(k.minuti_stimati, 0)), 0), coalesce(sum(coalesce(k.minuti_stimati, 0)), 0) / 60.0 * v_def
    into v_min, v_man
    from tasks k
   where k.fonte = 'gestionale' and k.fonte_rif->>'evento_id' like 'prod:' || o.id || ':%' and k.stato = 'completato';

  -- DTF: metri di tutti i file × € al metro
  select coalesce(sum(_tc_num(x->>'metri')), 0), count(*) filter (where coalesce(_tc_num(x->>'metri'), 0) = 0)
    into v_metri, v_righe_senza
    from jsonb_array_elements(coalesce(nullif(o.dtf_items, 'null'::jsonb), '[]'::jsonb)) x;
  if v_metri > 0 then
    if coalesce(v_dtf_m, 0) = 0 then v_manca := v_manca || 'DTF: costo al metro'; else v_dtf := v_metri * v_dtf_m; end if;
  end if;
  if v_righe_senza > 0 then v_manca := v_manca || ('DTF: ' || v_righe_senza || ' file senza misura'); end if;

  -- Lavorazioni (DTF escluso, ha il suo costo): pezzi delle righe con quella lavorazione,
  -- o tutti i pezzi se la lavorazione è dell'intero ordine
  v_tot_pz := (select coalesce(sum(_tc_num(r->>'qnt')), 0) from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r where not coalesce((r->>'preventivo')::boolean, false));
  for l in
    select x->>'id' id, x->>'nome' nome,
           greatest(
             (select coalesce(sum(_tc_num(r->>'qnt')), 0) from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r
               where r->>'interna' = x->>'id' or r->>'esterna' = x->>'id'),
             case when (coalesce((o.order_module->>'interna')::boolean, false) and coalesce(o.order_module->'lavInterne', '[]') ? (x->>'id'))
                    or (o.lavorazione_esterna and coalesce(o.order_module->'lavEsterne', '[]') ? (x->>'id')) then v_tot_pz else 0 end) pezzi,
           (select c.valore from costi_vivi c where c.voce = 'lav:' || (x->>'id')) valore
      from jsonb_array_elements(v_lavs) x
     where x->>'id' <> 'li-dtf'
  loop
    continue when l.pezzi <= 0;
    if l.valore is null then v_manca := v_manca || ('Lavorazione ' || l.nome || ': costo a pezzo');
    else v_lav := v_lav + l.pezzi * l.valore; end if;
  end loop;

  -- Merce: righe collegate a un prodotto con il costo
  select coalesce(sum(_tc_num(r->>'qnt') * p.costo) filter (where coalesce(p.costo, 0) > 0), 0),
         count(*) filter (where coalesce(r->>'productId', '') = ''),
         count(*) filter (where coalesce(r->>'productId', '') <> '' and coalesce(p.costo, 0) = 0)
    into v_merce, v_righe_senza, v_prod_senza
    from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r
    left join products p on p.id::text = r->>'productId'
   where not coalesce((r->>'preventivo')::boolean, false) and _tc_num(r->>'qnt') > 0;
  if v_righe_senza > 0 then v_manca := v_manca || ('Merce: ' || v_righe_senza || case when v_righe_senza = 1 then ' riga senza prodotto' else ' righe senza prodotto' end); end if;
  if v_prod_senza > 0 then v_manca := v_manca || ('Merce: ' || v_prod_senza || case when v_prod_senza = 1 then ' prodotto senza costo' else ' prodotti senza costo' end); end if;

  return jsonb_build_object('minuti', round(v_min), 'manodopera', round(v_man, 2), 'dtf', round(v_dtf, 2), 'metri_dtf', v_metri,
    'lavorazioni', round(v_lav, 2), 'merce', round(v_merce, 2), 'totale', round(v_man + v_dtf + v_lav + v_merce, 2), 'mancano', to_jsonb(v_manca));
end;
$$;
revoke execute on function _tc_ordine_costo(text) from public, anon, authenticated;

-- Costo di un ordine Shopify: la sua parte dei lotti fatti (manodopera stimata).
-- La merce no: le righe Shopify non sono collegate ai prodotti dell'anagrafica (nessun codice)
create or replace function _tc_shopify_costo(p_ordine uuid)
returns jsonb stable security definer set search_path = public language plpgsql as $$
declare v_def numeric := coalesce((select (value->>'valore')::numeric from app_settings where key = 'costo_ora'), 11.31);
        v_man numeric; v_min numeric;
begin
  if not exists (select 1 from shopify_orders where id = p_ordine) then return null; end if;
  select coalesce(sum(coalesce(k.minuti_stimati, 0) / n.n), 0) into v_min
    from task_lotti_ordini l join tasks k on k.id = l.task_id
    join lateral (select count(*) n from task_lotti_ordini x where x.task_id = k.id) n on true
   where l.ordine_id = p_ordine and k.stato = 'completato' and k.assegnato_a is distinct from 'claude';
  v_man := v_min / 60.0 * v_def;
  return jsonb_build_object('minuti', round(v_min), 'manodopera', round(v_man, 2), 'dtf', 0, 'lavorazioni', 0, 'merce', 0,
    'totale', round(v_man, 2), 'mancano', jsonb_build_array('Merce: righe Shopify non collegate ai prodotti'));
end;
$$;
revoke execute on function _tc_shopify_costo(uuid) from public, anon, authenticated;

-- Consuntivo: tempo = stima; per ordine il costo completo degli ordini lavorati nel periodo
create or replace function tc_consuntivo(p_dal date, p_al date)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_def numeric := coalesce((select (value->>'valore')::numeric from app_settings where key = 'costo_ora'), 11.31);
        v_da timestamptz := p_dal::timestamp at time zone 'Europe/Rome';
        v_a  timestamptz := (p_al + 1)::timestamp at time zone 'Europe/Rome';
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  return (
    with fatti as (
      select k.id, k.assegnato_a chi, k.fonte, k.fonte_rif, coalesce(k.minuti_stimati, 0) minuti, v_def costo_ora
        from tasks k
       where k.stato = 'completato' and k.assegnato_a is not null and k.assegnato_a <> 'claude'
         and k.fonte not in ('claude_code', 'github')
         and k.completato_at >= v_da and k.completato_at < v_a
    ),
    persone as (
      select chi, count(*) task, round(sum(minuti)) minuti, round(sum(minuti / 60.0 * costo_ora), 2) costo
        from fatti group by chi
    ),
    ordini as (
      select coalesce(g.nome, g.id) nome, 'Gestionale' origine, _tc_ordine_costo(g.id) c
        from orders g where g.id in (select f.fonte_rif->>'ordine' from fatti f where f.fonte = 'gestionale' and f.fonte_rif ? 'ordine')
      union all
      select '#' || s.numero || coalesce(' · ' || s.cliente, ''), coalesce(st.nome, 'Shopify'), _tc_shopify_costo(s.id)
        from shopify_orders s left join shopify_stores st on st.id = s.store_id
       where s.id in (select l.ordine_id from fatti f join task_lotti_ordini l on l.task_id = f.id where f.fonte = 'shopify')
    )
    select jsonb_build_object('success', true, 'costo_ora', v_def, 'dtf_costo_m', round(_tc_dtf_costo_m(), 4),
      'persone', coalesce((select jsonb_agg(to_jsonb(p) order by p.costo desc) from persone p), '[]'::jsonb),
      'ordini',  coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'origine', origine) || c order by (c->>'totale')::numeric desc)
                             from (select * from ordini where c is not null order by (c->>'totale')::numeric desc limit 150) x), '[]'::jsonb),
      'sviluppo', (select jsonb_build_object('task', count(*)) from tasks
                    where stato = 'completato' and fonte in ('claude_code', 'github') and completato_at >= v_da and completato_at < v_a),
      'totale',  (select jsonb_build_object('task', count(*), 'minuti', round(coalesce(sum(minuti), 0)), 'costo', round(coalesce(sum(minuti / 60.0 * costo_ora), 0), 2)) from fatti))
  );
end;
$$;
revoke execute on function tc_consuntivo(date, date) from public, anon;
grant execute on function tc_consuntivo(date, date) to authenticated;

-- Pannello Costi vivi: tutte le voci, con quelle da impostare
create or replace function tc_costi_vivi()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  return jsonb_build_object('success', true,
    'costo_ora', (select value from app_settings where key = 'costo_ora'),
    'dtf_costo_m', round(_tc_dtf_costo_m(), 4),
    'lavorazioni', coalesce((
      select jsonb_agg(jsonb_build_object('voce', 'lav:' || (x->>'id'), 'id', x->>'id', 'nome', x->>'nome', 'tipo', q.tipo,
               'valore', (select c.valore from costi_vivi c where c.voce = 'lav:' || (x->>'id')),
               'ordini', (select count(*) from orders o where o.deleted_at is null and o.created_at > now() - interval '90 days'
                            and (exists (select 1 from jsonb_array_elements(coalesce(o.order_module->'rows', '[]')) r where r->>'interna' = x->>'id' or r->>'esterna' = x->>'id')
                              or coalesce(o.order_module->'lavInterne', '[]') ? (x->>'id') or coalesce(o.order_module->'lavEsterne', '[]') ? (x->>'id'))))
               order by q.tipo, x->>'nome')
        from (select 'interna' tipo, value v from app_settings where key = 'lavorazioni_interne'
              union all select 'esterna', value from app_settings where key = 'lavorazioni_esterne') q,
             jsonb_array_elements(q.v) x
       where x->>'id' <> 'li-dtf'), '[]'::jsonb),
    'prodotti_senza_costo', coalesce((
      select jsonb_agg(jsonb_build_object('nome', coalesce(nullif(p.descrizione, ''), p.codice), 'codice', p.codice)
                       order by coalesce(nullif(p.descrizione, ''), p.codice))
        from products p where coalesce(p.attivo, true) and coalesce(p.costo, 0) = 0), '[]'::jsonb));
end;
$$;
revoke execute on function tc_costi_vivi() from public, anon;
grant execute on function tc_costi_vivi() to authenticated;

-- Manodopera unica: niente costo orario per persona
update task_operatori set costo_ora = null where costo_ora is not null;
