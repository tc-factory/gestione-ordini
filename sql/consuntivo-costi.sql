-- ════════════════════════════════════════════════════════
-- T&C Factory — Consuntivo: cosa ha fatto ogni operatore e quanto è costato (2026-11-18)
--
-- • Costo orario: app_settings.costo_ora (medio, 1.900 € lordi di ottobre / 168 ore = 11,31 €/h),
--   oppure task_operatori.costo_ora per la singola persona.
-- • Tempo di un task fatto: quello misurato (lavorato_sec) se c'è, altrimenti la stima.
-- • tc_consuntivo(dal, al): per persona task fatti, minuti (di cui misurati) e costo;
--   per ordine il costo delle sue fasi. I lotti Shopify si dividono in parti uguali tra i loro ordini.
--   Claude non costa (le automazioni non hanno costo orario qui). Le sessioni di Claude Code e i commit
--   (sviluppo, minuti sommati anche se in parallelo) non sono lavoro di produzione: si contano a parte.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_operatori add column if not exists costo_ora numeric(7,2) check (costo_ora is null or costo_ora between 0 and 500);

insert into app_settings (key, value) values ('costo_ora', '{"valore": 11.31, "nota": "1.900 € lordi medi di ottobre / (8 h × 21 giorni)"}')
on conflict (key) do nothing;

create or replace function tc_consuntivo(p_dal date, p_al date)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_def numeric := coalesce((select (value->>'valore')::numeric from app_settings where key = 'costo_ora'), 11.31);
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  return (
    with fatti as (
      select k.id, k.assegnato_a chi, k.fonte, k.fonte_rif, k.riferimento, k.titolo,
             case when k.lavorato_sec > 0 then k.lavorato_sec / 60.0 else coalesce(k.minuti_stimati, 0) end minuti,
             k.lavorato_sec > 0 misurato,
             coalesce(o.costo_ora, v_def) costo_ora
        from tasks k left join task_operatori o on o.nickname = k.assegnato_a
       where k.stato = 'completato' and k.assegnato_a is not null and k.assegnato_a <> 'claude'
         and k.fonte not in ('claude_code', 'github')
         and k.completato_at >= (p_dal::timestamp at time zone 'Europe/Rome')
         and k.completato_at <  ((p_al + 1)::timestamp at time zone 'Europe/Rome')
    ),
    persone as (
      select chi, count(*) task, round(sum(minuti)) minuti, round(sum(minuti) filter (where misurato)) minuti_misurati,
             round(sum(minuti / 60 * costo_ora), 2) costo, max(costo_ora) costo_ora
        from fatti group by chi
    ),
    -- Ordini del gestionale: le fasi con l'ordine; lotti Shopify: costo diviso tra i loro ordini
    per_ordine as (
      select 'g:' || (f.fonte_rif->>'ordine') chiave, coalesce(f.riferimento->>'label', f.fonte_rif->>'ordine') nome, 'Gestionale' origine,
             f.minuti, f.minuti / 60 * f.costo_ora costo, f.titolo
        from fatti f where f.fonte = 'gestionale' and f.fonte_rif ? 'ordine'
      union all
      select 's:' || s.id, '#' || s.numero || coalesce(' · ' || s.cliente, ''), coalesce(st.nome, 'Shopify'),
             f.minuti / n.n, f.minuti / 60 * f.costo_ora / n.n, f.titolo
        from fatti f
        join task_lotti_ordini l on l.task_id = f.id
        join shopify_orders s on s.id = l.ordine_id
        left join shopify_stores st on st.id = s.store_id
        join lateral (select count(*) n from task_lotti_ordini x where x.task_id = f.id) n on true
       where f.fonte = 'shopify'
    ),
    ordini as (
      select nome, origine, count(*) fasi, round(sum(minuti)) minuti, round(sum(costo), 2) costo
        from per_ordine group by chiave, nome, origine
    )
    select jsonb_build_object('success', true, 'costo_ora', v_def,
      'persone', coalesce((select jsonb_agg(to_jsonb(p) order by p.costo desc) from persone p), '[]'::jsonb),
      'ordini',  coalesce((select jsonb_agg(to_jsonb(o) order by o.costo desc) from (select * from ordini order by costo desc limit 100) o), '[]'::jsonb),
      'sviluppo', (select jsonb_build_object('task', count(*), 'minuti', round(coalesce(sum(case when lavorato_sec > 0 then lavorato_sec / 60.0 else coalesce(minuti_stimati, 0) end), 0)))
                     from tasks where stato = 'completato' and fonte in ('claude_code', 'github')
                      and completato_at >= (p_dal::timestamp at time zone 'Europe/Rome')
                      and completato_at <  ((p_al + 1)::timestamp at time zone 'Europe/Rome')),
      'totale',  (select jsonb_build_object('task', count(*), 'minuti', round(sum(minuti)), 'costo', round(sum(minuti / 60 * costo_ora), 2)) from fatti))
  );
end;
$$;
revoke execute on function tc_consuntivo(date, date) from public, anon;
grant execute on function tc_consuntivo(date, date) to authenticated;

-- Il costo orario medio lo cambia solo l'admin
create or replace function tc_costo_ora_imposta(p_valore numeric)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  if p_valore is null or p_valore < 0 or p_valore > 500 then return jsonb_build_object('success', false, 'error', 'Valore non valido'); end if;
  insert into app_settings (key, value) values ('costo_ora', jsonb_build_object('valore', round(p_valore, 2)))
  on conflict (key) do update set value = app_settings.value || jsonb_build_object('valore', round(p_valore, 2));
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_costo_ora_imposta(numeric) from public, anon;
grant execute on function tc_costo_ora_imposta(numeric) to authenticated;
