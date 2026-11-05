-- ════════════════════════════════════════════════════════
-- T&C Factory — Giorni lavorativi
-- Tutti i conteggi di giorni del Centro di controllo escludono sabato, domenica e festivi italiani.
-- tc_testo_giorni scrive i giorni totali e, se diversi, anche i lavorativi: "11 giorni (7 lavorativi)".
-- Il patrono locale non è compreso: si aggiunge in tc_festivo se serve.
-- Richiede tracking-gls.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- Lunedì di Pasqua (algoritmo di Gauss per il calendario gregoriano)
create or replace function tc_pasquetta(p_anno int) returns date language plpgsql immutable as $$
declare a int := p_anno % 19; b int := p_anno / 100; c int := p_anno % 100; d int := b / 4; e int := b % 4;
  f int := (b + 8) / 25; g int := (b - f + 1) / 3; h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4; k int := c % 4; l int := (32 + 2 * e + 2 * i - h - k) % 7; m int := (a + 11 * h + 22 * l) / 451;
  n int := h + l - 7 * m + 114;
begin
  return make_date(p_anno, n / 31, n % 31 + 1) + 1;
end;
$$;

create or replace function tc_festivo(p date) returns boolean language sql immutable as $$
  select to_char(p, 'MM-DD') in ('01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26')
      or p = tc_pasquetta(extract(year from p)::int);
$$;

-- Giorni lavorativi dopo p_da fino a p_a compreso
create or replace function tc_giorni_lavorativi(p_da date, p_a date) returns int language sql immutable as $$
  select count(*)::int from generate_series(p_da + 1, p_a, interval '1 day') g
   where extract(isodow from g) < 6 and not tc_festivo(g::date);
$$;

create or replace function tc_testo_giorni(p_da date, p_a date) returns text language sql immutable as $$
  select (p_a - p_da) || case when p_a - p_da = 1 then ' giorno' else ' giorni' end
      || case when tc_giorni_lavorativi(p_da, p_a) <> p_a - p_da
              then ' (' || tc_giorni_lavorativi(p_da, p_a) || case when tc_giorni_lavorativi(p_da, p_a) = 1 then ' lavorativo)' else ' lavorativi)' end
              else '' end;
$$;

-- Ordini del gestionale in scadenza: entro 2 giorni lavorativi
do $$
declare v text;
begin
  select pg_get_functiondef('_tc_task_automatici'::regproc) into v;
  if v like '%deadline between tc_oggi() and tc_oggi() + 2%' then
    v := replace(v, 'deadline between tc_oggi() and tc_oggi() + 2', 'deadline >= tc_oggi() and tc_giorni_lavorativi(tc_oggi(), deadline) <= 2');
    execute v;
  end if;
end $$;

update task_tipi set descrizione = 'Lavorazione esterna in corso da più di 5 giorni lavorativi' where nome like 'Controllare %';
update task_tipi set descrizione = 'Ordine del gestionale che scade entro 2 giorni lavorativi' where nome = 'Ordine in scadenza';
