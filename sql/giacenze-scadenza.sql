-- T&C Factory — Giacenze: quando GLS può rimandare il pacco indietro (2026-11-18)
-- Dai rientri visti a ottobre-novembre GLS rende il pacco anche dopo 4 giorni lavorativi da
-- quando si ferma: è il limite prudente entro cui dare le istruzioni. Si può rieseguire.

-- Giorno lavorativo n-esimo dopo p_da
create or replace function tc_piu_lavorativi(p_da date, p_n int)
returns date language sql stable security definer set search_path = public as $$
  select g::date from generate_series(p_da + 1, p_da + 60, interval '1 day') g
   where tc_giorno_lavorativo(g::date) order by g offset greatest(p_n, 1) - 1 limit 1;
$$;

-- Da quando GLS può rendere il pacco: 4 giorni lavorativi dall'inizio della giacenza in corso
create or replace function tc_rientro_giacenza(p_eventi jsonb)
returns date language sql stable security definer set search_path = public as $$
  select case when g.ferma_dal is not null then tc_piu_lavorativi((g.ferma_dal at time zone 'Europe/Rome')::date, 4) end
    from _tc_giacenza_tempi(p_eventi) g;
$$;
revoke execute on function tc_piu_lavorativi(date, int) from public, anon;
revoke execute on function tc_rientro_giacenza(jsonb) from public, anon;
grant execute on function tc_piu_lavorativi(date, int) to authenticated, service_role;
grant execute on function tc_rientro_giacenza(jsonb) to authenticated, service_role;
