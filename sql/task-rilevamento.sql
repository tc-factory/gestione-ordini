-- ════════════════════════════════════════════════════════
-- T&C Factory — Task liberi con la persona designata, presi da chi fa il lavoro (2026-11-18)
--
-- • Il piano non assegna più i task alle persone: scrive solo tasks.designato (primario della
--   competenza, il secondario se il primario non c'è). Il task resta libero finché qualcuno lo fa.
--   Le automazioni (claude) restano assegnate come prima.
-- • Chi fa l'azione si prende il task:
--     - "Fatto", "Inizia", risposta alla mail, svincolo GLS → già con tc_task_stato col login di chi agisce
--     - fasi degli ordini del gestionale: chi ha premuto il pulsante (activity_log); se il task era
--       in lavorazione il cronometro si ferma all'ora del clic, non a quella del controllo
--     - stampa del DDT e dei file di stampa (Stampe del giorno): alla prima stampa nasce un task fatto
-- • I task senza designato si prendono a mano.
-- • Prova dei tempi: oltre ai lotti di lavorazione, i risultati di tutte le fasi produttive.
--
-- Richiede presenze-coda.sql, presenze-ripristino.sql, claude-solo-automazioni.sql, linea-produttiva.sql,
-- file-mattino.sql e tempi-lavorazione.sql già eseguiti. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table tasks add column if not exists designato text;
create index if not exists tasks_designato_idx on tasks (designato, stato) where assegnato_a is null;

-- ─────────────────────────────────────────────
-- 1. Designato invece di assegnato
-- ─────────────────────────────────────────────

create or replace function _tc_task_assegna(p_id uuid, p_oggi date)
returns boolean security definer set search_path = public language plpgsql as $$
declare t record; v_primario text; v_ferma boolean; v_des text;
begin
  select coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario, k.automazione_errore errore, r.voce, p.automazione into t
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili r on r.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;

  -- Automazione non riuscita su questo task, o in verifica: claude si salta
  v_ferma := t.primario = 'claude' and t.automazione is not null and (t.errore is not null or exists (
    select 1 from tasks v where v.fonte = 'automazione' and v.fonte_rif->>'voce' = t.voce
       and v.stato not in ('completato', 'non_completato')));
  -- Tipo senza automazione: claude non lo saprebbe fare, va al secondario
  v_primario := case when t.primario = 'claude' and (t.automazione is null or v_ferma) then null else t.primario end;

  -- Automazioni: claude prende il task come prima
  if v_primario = 'claude' and tc_disponibile('claude', p_oggi) then
    update tasks set assegnato_a = 'claude', giorno = greatest(giorno, p_oggi) where id = p_id and assegnato_a is null;
    return true;
  end if;

  -- Persone: il task resta libero, con la persona designata. Chi c'è prima di chi non c'è;
  -- se non c'è nessuno resta designato il responsabile, che lo trova al rientro
  v_des := case when v_primario <> 'claude' and tc_disponibile(v_primario, p_oggi) then v_primario
                when t.secondario <> 'claude' and tc_disponibile(t.secondario, p_oggi) then t.secondario
                when v_primario <> 'claude' and coalesce((select attivo from task_operatori where nickname = v_primario), true) then v_primario
                when t.secondario <> 'claude' and coalesce((select attivo from task_operatori where nickname = t.secondario), true) then t.secondario end;
  update tasks set designato = v_des, suggerito = null,
         giorno = case when stato <> 'rimandato' then greatest(giorno, p_oggi) else giorno end,
         automazione_errore = case when v_ferma then coalesce(t.errore, 'Automazione in verifica') else automazione_errore end
   where id = p_id and assegnato_a is null;
  return false;
end;
$$;
revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;

-- Chi manca: il designato diventa l'altra persona della competenza (anche come suggerito, per le schermate vecchie)
create or replace function _tc_task_suggerisci(p_id uuid, p_escludi text default null)
returns text security definer set search_path = public language plpgsql as $$
declare r record; v text;
begin
  select c.primario, c.secondario into r
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili c on c.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;
  v := case when r.primario is distinct from p_escludi and r.primario <> 'claude' and tc_disponibile(r.primario, tc_oggi()) then r.primario
            when r.secondario is distinct from p_escludi and r.secondario <> 'claude' and tc_disponibile(r.secondario, tc_oggi()) then r.secondario end;
  update tasks set suggerito = v, designato = coalesce(v, designato) where id = p_id and assegnato_a is null;
  return v;
end;
$$;
revoke execute on function _tc_task_suggerisci(uuid, text) from public, anon, authenticated;

-- Ogni task nuovo con un tipo ha subito il suo designato (o va a claude se è un'automazione)
create or replace function _tc_task_assegna_subito() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _tc_task_assegna(new.id, tc_oggi());
  return null;
end;
$$;
revoke execute on function _tc_task_assegna_subito() from public, anon, authenticated;

-- Ogni 5 minuti: chi è assente o non ha confermato lascia i task presi (non iniziati) e quelli designati a lui
create or replace function _tc_presenze_controllo()
returns int security definer set search_path = public language plpgsql as $$
declare k record; n int := 0;
begin
  if not tc_giorno_lavorativo(tc_oggi()) then return 0; end if;
  for k in
    select id, assegnato_a from tasks
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= tc_oggi()
       and (tc_assente(assegnato_a, tc_oggi()) or _tc_presenza_mancante(assegnato_a, tc_oggi()))
  loop
    update tasks set assegnato_a = null where id = k.id;
    update tasks set tolto_a = k.assegnato_a where id = k.id;
    perform _tc_task_suggerisci(k.id, k.assegnato_a);
    n := n + 1;
  end loop;

  for k in
    select id from tasks
     where assegnato_a is null and designato is not null and designato <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= tc_oggi()
       and not tc_disponibile(designato, tc_oggi())
  loop
    perform _tc_task_assegna(k.id, tc_oggi());
  end loop;
  return n;
end;
$$;
revoke execute on function _tc_presenze_controllo() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Fasi degli ordini: chi ha premuto il pulsante si prende il task
-- ─────────────────────────────────────────────

-- Pulsanti che chiudono ogni fase. null = qualsiasi pulsante dell'ordine; vuoto = nessuno (fattura, incasso)
create or replace function _tc_prod_pulsanti(p_chiave text)
returns text[] immutable language sql as $$
  select case
    when p_chiave in ('ordinare', 'merce') then array['merceCompleta']
    when p_chiave in ('prep_dtf', 'stampa_dtf') then array['mezzo:dtfPronti', 'dtfPronti']
    when p_chiave = 'applica_dtf' then array['dtfPronti']
    when p_chiave = 'controllo' then array['ordineStampato']
    when p_chiave = 'spedire' then array['spedito']
    when p_chiave in ('fattura', 'incasso') then array[]::text[]
  end;
$$;

-- Ultimo clic di una persona su un pulsante dell'ordine (non l'account condiviso)
create or replace function _tc_ordine_clic(p_ordine text, p_pulsanti text[])
returns table (chi text, at timestamptz) stable security definer set search_path = public language sql as $$
  select l.user_nickname, l.created_at from activity_log l
   where l.order_id = p_ordine and l.action ~ '^[✓◐]'
     and l.created_at > now() - interval '2 days'
     and (p_pulsanti is null or l.details->>'stage' = any(p_pulsanti))
     and l.user_nickname not in ('tcfactory', 'claude', 'sistema')
     and exists (select 1 from app_users u where u.nickname = l.user_nickname)
   order by l.id desc limit 1;
$$;
revoke execute on function _tc_ordine_clic(text, text[]) from public, anon, authenticated;

create or replace function _tc_prod_chiudi(o orders, p_chiave text)
returns void security definer set search_path = public language plpgsql as $$
declare v_id uuid; c record;
begin
  select id into v_id from tasks
   where fonte_rif->>'evento_id' = 'prod:' || o.id || ':' || p_chiave and stato not in ('completato', 'non_completato');
  if v_id is null then return; end if;

  select * into c from _tc_ordine_clic(o.id, _tc_prod_pulsanti(p_chiave));
  -- Cronometro acceso: si ferma all'ora del clic (il controllo passa ogni 5 minuti)
  if c.at is not null then
    update tasks set lavoro_dal = least(lavoro_dal + (now() - c.at), now())
     where id = v_id and stato = 'in_lavorazione' and lavoro_dal is not null and lavoro_dal < c.at;
  end if;
  update tasks set stato = 'completato', assegnato_a = coalesce(assegnato_a, c.chi) where id = v_id;
end;
$$;
revoke execute on function _tc_prod_chiudi(orders, text) from public, anon, authenticated;

-- Linea produttiva (linea-produttiva.sql) con la spedizione attribuita a chi evade
CREATE OR REPLACE FUNCTION public._tc_linea_produttiva()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  o orders%rowtype; l record;
  v_merce boolean; v_interne text[]; v_esterne text[]; v_finite boolean; v_mezzo jsonb;
  v_pulsanti jsonb := coalesce((select value from app_settings where key = 'pulsanti_ordine'), '[]'::jsonb);
begin
  for o in select * from orders x where x.deleted_at is null and not coalesce((x.order_module->>'neutro')::boolean, false)
              and (not x.archived or exists (select 1 from tasks k where k.fonte_rif->>'evento_id' like 'prod:' || x.id || ':%' and k.stato not in ('completato', 'non_completato'))) loop
    -- Archiviato: si chiude tutto quello che resta aperto
    if o.archived then
      update tasks set stato = 'completato'
       where fonte_rif->>'evento_id' like 'prod:' || o.id || ':%' and stato not in ('completato', 'non_completato');
      continue;
    end if;

    -- Evaso: restano solo fattura e incasso
    if coalesce((o.stages->'spedito'->>'done')::boolean, false) then
      -- Spedizione a chi ha premuto EVASO; il resto si chiude senza attribuirlo a nessuno
      perform _tc_prod_chiudi(o, 'spedire');
      update tasks set stato = 'completato'
       where fonte_rif->>'evento_id' like 'prod:' || o.id || ':%' and stato not in ('completato', 'non_completato')
         and fonte_rif->>'evento_id' not in ('prod:' || o.id || ':fattura', 'prod:' || o.id || ':incasso');
      if o.invoice_confirmed then perform _tc_prod_chiudi(o, 'fattura');
      else perform _tc_prod_apri(o, 'fattura', 'Emettere fattura', 'Emettere fattura'); end if;
      if o.payment_done then perform _tc_prod_chiudi(o, 'incasso');
      else perform _tc_prod_apri(o, 'incasso', 'Incassare', 'Incassare'); end if;
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

    -- DTF: file in coda, stampa (pulsante giallo STAMPA = stampato), applicazione (verde)
    if 'li-dtf' = any(v_interne) or jsonb_array_length(coalesce(nullif(o.dtf_items, 'null'::jsonb), '[]'::jsonb)) > 0 then
      if coalesce((o.stages->'dtfPronti'->>'done')::boolean, false) then
        perform _tc_prod_chiudi(o, 'prep_dtf'), _tc_prod_chiudi(o, 'stampa_dtf'), _tc_prod_chiudi(o, 'applica_dtf');
      elsif o.stages ? 'mezzo:dtfPronti' then
        v_finite := false;
        perform _tc_prod_chiudi(o, 'prep_dtf'), _tc_prod_chiudi(o, 'stampa_dtf'), _tc_prod_apri(o, 'applica_dtf', 'Applicazione DTF', 'Applicazione DTF');
      else
        v_finite := false;
        if v_merce then
          perform _tc_prod_apri(o, 'prep_dtf', 'Preparazione DTF', 'Preparazione DTF');
          if exists (select 1 from tasks where fonte_rif->>'evento_id' = 'prod:' || o.id || ':prep_dtf' and stato = 'completato') then
            perform _tc_prod_apri(o, 'stampa_dtf', 'Stampa DTF', 'Stampa DTF');
          end if;
        end if;
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

    -- Lavorazioni esterne: invio, poi controllo se resta gialla 5 giorni lavorativi
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
          if tc_giorni_lavorativi((v_mezzo->>'date')::date, tc_oggi()) >= 5 then
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

-- ─────────────────────────────────────────────
-- 3. Stampe del giorno: la prima stampa di un file è un task fatto da chi stampa
-- ─────────────────────────────────────────────

insert into task_tipi (nome, minuti_standard, autonomia, descrizione) values
  ('Stampare DDT', 5, 'solo_task', 'Stampa del DDT del giorno dalle Stampe del giorno'),
  ('Stampare file di stampa', 5, 'solo_task', 'Stampa o scarico di un file di stampa dalle Stampe del giorno')
on conflict (nome) do nothing;

create or replace function tc_file_mattino_stampato(p_percorso text) returns public.file_mattino_stampe
language plpgsql security definer set search_path = public as $$
declare r public.file_mattino_stampe; v_chi text := app_nickname(); v_ddt boolean := p_percorso ~ '(^|/)DDT\.pdf$';
begin
  if not app_vede_scheda('file') then raise exception 'Non autorizzato'; end if;
  insert into file_mattino_stampe (percorso, stampato_at, stampato_da) values (p_percorso, now(), v_chi)
  on conflict (percorso) do update set stampato_at = excluded.stampato_at, stampato_da = excluded.stampato_da
  returning * into r;

  if v_chi is not null and v_chi not in ('tcfactory', 'claude') then
    insert into tasks (tipo_id, titolo, stato, assegnato_a, giorno, minuti_stimati, fonte, fonte_rif, creato_da)
    select p.id, left(case when v_ddt then 'Stampare DDT del ' || to_char(left(p_percorso, 10)::date, 'DD/MM')
                           else 'Stampare ' || regexp_replace(p_percorso, '^.*/', '') end, 200),
           'completato', v_chi, tc_oggi(), p.minuti_standard, 'stampe',
           jsonb_build_object('evento_id', 'stampa:' || p_percorso, 'percorso', p_percorso), v_chi
      from task_tipi p where p.nome = case when v_ddt then 'Stampare DDT' else 'Stampare file di stampa' end
    on conflict do nothing;
  end if;
  return r;
end;
$$;
revoke execute on function tc_file_mattino_stampato(text) from public, anon;
grant  execute on function tc_file_mattino_stampato(text) to authenticated;

-- ─────────────────────────────────────────────
-- 4. Prova dei tempi: anche le fasi degli ordini
-- ─────────────────────────────────────────────

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
    -- Fasi produttive misurate (ordini del gestionale e lotti Shopify di preparazione e spedizione)
    'fasi', coalesce((
      select jsonb_agg(x order by x.at desc) from (
        select k.id, p.nome tipo, k.assegnato_a chi, k.completato_at at, k.lavorato_sec reale_sec,
               coalesce(k.minuti_stimati, p.minuti_standard, 0) * 60 stima_sec,
               k.fonte_rif->>'ordine' ordine, coalesce(k.riferimento->>'label', k.titolo) ordine_nome
          from tasks k join task_tipi p on p.id = k.tipo_id
         where k.stato = 'completato' and k.lavorato_sec > 0
           and k.completato_at >= (v_dal::timestamp at time zone 'Europe/Rome')
           and ((k.fonte = 'gestionale' and k.fonte_rif->>'evento_id' like 'prod:%'
                 and k.fonte_rif->>'evento_id' !~ ':(ordinare|fattura|incasso|controllo:.*)$')
             or (k.fonte = 'shopify' and k.fonte_rif->>'fase' in ('prep', 'spedire')))
         limit 500) x), '[]'::jsonb),
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

-- ─────────────────────────────────────────────
-- 5. Passaggio: i task presi dal piano e non ancora iniziati tornano liberi, designati a chi li aveva
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from tasks where designato is not null) then
    update tasks set designato = assegnato_a, assegnato_a = null
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato') and lavorato_sec = 0 and delega is null;
    -- Gli altri task liberi ricevono il loro designato
    perform _tc_task_assegna(id, tc_oggi()) from tasks
     where assegnato_a is null and designato is null and tipo_id is not null
       and stato in ('da_fare', 'rimandato', 'in_pausa');
  end if;
end $$;
