-- ════════════════════════════════════════════════════════
-- T&C Factory — Esito dell'automazione del mattino
--
-- Alla fine del giro lo script chiama tc_mattino_esito:
--   • gli ordini fatti, o già stampati a mano, escono dal lotto "Stampa DDT" e passano alla preparazione
--   • quelli rimasti (non pagati, file non pronto) restano nel lotto, che resta di oggi: non è un errore
--   • se un negozio ha avuto problemi, i suoi lotti vanno al secondario e nasce il task di verifica
-- Alle 5:30 ora italiana, se lo script non si è fatto vivo, succede lo stesso per tutti i negozi.
-- Sabato, domenica e festivi lo script non lavora: i lotti "Stampa DDT" aspettano il giro del rientro.
--
-- Richiede automazione-mattino.sql, automazioni-ripristino.sql e linea-produttiva.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists automazione_esecuzioni (
  id       bigint generated always as identity primary key,
  nome     text not null default 'mattino',
  giorno   date not null default tc_oggi(),
  at       timestamptz not null default now(),
  ok       boolean not null,
  dettagli jsonb
);
create index if not exists automazione_esecuzioni_idx on automazione_esecuzioni (nome, giorno);
alter table automazione_esecuzioni enable row level security;
revoke all on automazione_esecuzioni from anon, authenticated;

-- Lotti "Stampa DDT" di un negozio non ancora iniziati da nessuno
create or replace function _tc_lotti_ddt_aperti(p_negozio text)
returns setof tasks security definer set search_path = public language sql stable as $$
  select k.* from tasks k
   where k.fonte = 'shopify' and k.fonte_rif->>'fase' = 'ddt' and k.macroarea = p_negozio
     and k.stato = 'da_fare' and k.lavorato_sec = 0;
$$;

create or replace function tc_mattino_esito(p_chiave text, p_ok boolean, p_negozi jsonb, p_messaggio text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare
  v_key text; s record; t record; o record; v_err text; v_fatti text[]; v_rimasti int; n int := 0; v_oggi date := tc_oggi();
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'automazione_mattino_key';
  if v_key is null or p_chiave is distinct from v_key then
    return jsonb_build_object('success', false, 'error', 'Chiave non valida');
  end if;

  insert into automazione_esecuzioni (ok, dettagli)
  values (p_ok, jsonb_build_object('negozi', p_negozi, 'messaggio', left(p_messaggio, 1000)));

  for s in select id from shopify_stores where attivo loop
    v_err := coalesce(p_negozi->s.id->>'errore', case when p_negozi ? s.id then null else coalesce(p_messaggio, 'Negozio non elaborato') end);
    v_fatti := array(select jsonb_array_elements_text(coalesce(p_negozi->s.id->'fatti', '[]'::jsonb)));

    for t in select * from _tc_lotti_ddt_aperti(s.id) loop
      if v_err is not null then
        -- Un lotto già passato a una persona resta a lei
        if t.assegnato_a is null or t.assegnato_a = 'claude' then
          perform _tc_automazione_fallita(t.id, v_err, v_oggi);
        end if;
        continue;
      end if;

      for o in
        select l.ordine_id from task_lotti_ordini l join shopify_orders x on x.id = l.ordine_id
         where l.task_id = t.id
           and (x.numero = any(v_fatti) or exists (select 1 from unnest(x.tags) g where lower(g) in ('stampato', 'auto-stampato')))
      loop
        delete from task_lotti_ordini where task_id = t.id and ordine_id = o.ordine_id;
        perform _tc_lotto_aggiungi(o.ordine_id, s.id, 'prep');
        n := n + 1;
      end loop;

      select count(*) into v_rimasti from task_lotti_ordini where task_id = t.id;
      if v_rimasti = 0 then
        update tasks set stato = 'completato', descrizione = 'DDT salvati dall''automazione del mattino.' where id = t.id;
      else
        perform _tc_lotto_ricalcola(t.id);
        update tasks set giorno = v_oggi where id = t.id;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('success', true, 'ordini_avanzati', n);
end;
$$;
revoke execute on function tc_mattino_esito(text, boolean, jsonb, text) from public;
grant execute on function tc_mattino_esito(text, boolean, jsonb, text) to anon, authenticated;

-- Lo script non si è fatto vivo: lotti al secondario e un task di verifica anche se non ci sono lotti aperti
create or replace function _tc_mattino_controllo(p_oggi date default tc_oggi())
returns void security definer set search_path = public language plpgsql as $$
declare t record; v_id uuid; v_motivo text := 'Lo script del mattino non è partito o non ha risposto';
begin
  if extract(isodow from p_oggi) >= 6 or tc_festivo(p_oggi) then return; end if;
  if exists (select 1 from automazione_esecuzioni where nome = 'mattino' and giorno = p_oggi) then return; end if;

  for t in select k.id from shopify_stores s cross join lateral _tc_lotti_ddt_aperti(s.id) k
            where s.attivo and (k.assegnato_a is null or k.assegnato_a = 'claude') loop
    perform _tc_automazione_fallita(t.id, v_motivo, p_oggi);
  end loop;

  if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'voce' = 'automazioni:mattino'
                  and stato not in ('completato', 'non_completato')) then
    insert into tasks (tipo_id, titolo, descrizione, priorita, giorno, fonte, fonte_rif, creato_da)
    values ((select id from task_tipi where nome = 'Verificare automazione'),
            'Verificare automazione: script del mattino non partito',
            'Controllare che il Mac mini di Gianluca sia acceso e sbloccato: dopo un riavvio FileVault chiede la password. Registro: /Users/csauto/shopify-mattino/mattino.log',
            'urgente', p_oggi, 'automazione', jsonb_build_object('voce', 'automazioni:mattino'), 'cervello')
    returning id into v_id;
    perform _tc_task_assegna(v_id, p_oggi);
  end if;
end;
$$;

-- Il cron è in UTC: gira a entrambe le ore e agisce solo quando in Italia sono le 5
create or replace function _tc_mattino_controllo_cron()
returns void security definer set search_path = public language plpgsql as $$
begin
  if extract(hour from now() at time zone 'Europe/Rome') = 5 then perform _tc_mattino_controllo(); end if;
end;
$$;

-- Automazioni ferme: nei giorni non lavorativi i lotti "Stampa DDT" di claude non contano come non riusciti
create or replace function _tc_task_piano_del(p_oggi date)
returns int security definer set search_path = public language plpgsql as $$
declare
  t record; n int := 0;
  v_feriale boolean := extract(isodow from p_oggi) < 6 and not tc_festivo(p_oggi);
begin
  for t in
    select id from tasks
     where assegnato_a = 'claude' and giorno < p_oggi and stato not in ('completato', 'non_completato')
       and (v_feriale or fonte_rif->>'fase' is distinct from 'ddt')
  loop
    perform _tc_automazione_fallita(t.id, 'Non completato entro la giornata', p_oggi);
  end loop;

  -- Nei giorni lavorativi i task di chi è assente tornano in coda e seguono le regole qui sotto
  if v_feriale then
    update tasks set assegnato_a = null
     where assegnato_a is not null and assegnato_a <> 'claude'
       and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= p_oggi
       and tc_assente(assegnato_a, p_oggi);
  end if;

  for t in
    select k.id from tasks k
     where k.assegnato_a is null and k.stato in ('da_fare', 'rimandato', 'in_pausa') and k.giorno <= p_oggi
     order by array_position(array['urgente', 'alta', 'normale', 'bassa'], k.priorita), k.scadenza nulls last, k.created_at
  loop
    if _tc_task_assegna(t.id, p_oggi) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke execute on function _tc_task_piano_del(date) from public, anon, authenticated;

revoke execute on function _tc_lotti_ddt_aperti(text) from public, anon, authenticated;
revoke execute on function _tc_mattino_controllo(date) from public, anon, authenticated;
revoke execute on function _tc_mattino_controllo_cron() from public, anon, authenticated;

select cron.schedule('mattino-controllo', '30 3,4 * * *', 'select _tc_mattino_controllo_cron()');
