-- ════════════════════════════════════════════════════════
-- T&C Factory — Chiusure del Planner, automazioni solo nei giorni lavorativi, registro delle esecuzioni
--
--   • calendar_events con event_type 'chiusura' = l'azienda è chiusa
--   • giorno lavorativo = da lunedì a venerdì, non festivo, non in chiusura
--   • nei giorni non lavorativi nessuno riceve task, claude compreso: si riprende al rientro
--   • automazione_esecuzioni: ogni automazione che parte, il suo esito e il suo output
--
-- Si esegue dopo automazione-mattino-esito.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function tc_chiuso(p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from calendar_events where event_type = 'chiusura' and p_giorno between date_from and date_to);
$$;

create or replace function tc_giorno_lavorativo(p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from p_giorno) < 6 and not tc_festivo(p_giorno) and not tc_chiuso(p_giorno);
$$;

-- Anche ritardi e ordini fermi non contano i giorni di chiusura
create or replace function tc_giorni_lavorativi(p_da date, p_a date)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_da + 1, p_a, interval '1 day') g where tc_giorno_lavorativo(g::date);
$$;
alter function tc_testo_giorni(date, date) stable;

create or replace function tc_disponibile(p_chi text, p_giorno date)
returns boolean language sql stable security definer set search_path = public as $$
  select p_chi is not null
     and coalesce((select attivo from task_operatori where nickname = p_chi), true)
     and tc_giorno_lavorativo(p_giorno)
     and (p_chi = 'claude' or not tc_assente(p_chi, p_giorno));
$$;

create or replace function _tc_task_assegna(p_id uuid, p_oggi date)
returns boolean security definer set search_path = public language plpgsql as $$
declare t record; v_primario text; v_chi text; v_ferma boolean;
begin
  if not tc_giorno_lavorativo(p_oggi) then return false; end if;

  select coalesce(k.minuti_stimati, 15) minuti, r.primario, r.secondario, k.automazione_errore errore, r.voce into t
    from tasks k
    left join task_tipi p on p.id = k.tipo_id
    left join competenze_responsabili r on r.voce = coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza
   where k.id = p_id;

  -- Automazione non riuscita su questo task, o in verifica: claude si salta
  v_ferma := t.primario = 'claude' and (t.errore is not null or exists (
    select 1 from tasks v where v.fonte = 'automazione' and v.fonte_rif->>'voce' = t.voce
       and v.stato not in ('completato', 'non_completato')));
  v_primario := case when v_ferma then null else t.primario end;

  v_chi := case when tc_disponibile(v_primario, p_oggi) then v_primario
                when tc_disponibile(t.secondario, p_oggi) then t.secondario end;
  if v_chi is null then return false; end if;

  -- claude non ha un limite di minuti; chi ha finito i minuti non passa il task al secondario
  if v_chi <> 'claude' and (
       select coalesce(sum(x.minuti_stimati), 0) from tasks x
        where x.assegnato_a = v_chi and x.giorno <= p_oggi
          and x.stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato')
     ) + t.minuti > coalesce((select minuti_giorno from task_operatori where nickname = v_chi), 420) then
    return false;
  end if;

  update tasks set assegnato_a = v_chi, giorno = p_oggi,
         automazione_errore = case when v_ferma then coalesce(t.errore, 'Automazione in verifica') else automazione_errore end
   where id = p_id;
  return true;
end;
$$;

create or replace function _tc_task_piano_del(p_oggi date)
returns int security definer set search_path = public language plpgsql as $$
declare t record; n int := 0;
begin
  -- Giorno non lavorativo: nessun controllo e nessuna assegnazione, si riprende al rientro
  if not tc_giorno_lavorativo(p_oggi) then return 0; end if;

  -- Automazioni ferme: quello che claude ha lasciato aperto dal giorno prima
  for t in
    select id from tasks
     where assegnato_a = 'claude' and giorno < p_oggi and stato not in ('completato', 'non_completato')
  loop
    perform _tc_automazione_fallita(t.id, 'Non completato entro la giornata', p_oggi);
  end loop;

  -- I task di chi è assente tornano in coda e seguono le regole qui sotto
  update tasks set assegnato_a = null
   where assegnato_a is not null and assegnato_a <> 'claude'
     and stato in ('da_fare', 'rimandato', 'in_pausa') and giorno <= p_oggi
     and tc_assente(assegnato_a, p_oggi);

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

-- Verifica chiusa anche in un giorno non lavorativo: i task tornano comunque a claude, che riparte al rientro
create or replace function _tc_automazione_ripristina() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from competenze_responsabili where voce = new.fonte_rif->>'voce' and primario = 'claude')
     or not coalesce((select attivo from task_operatori where nickname = 'claude'), true) then
    return null;
  end if;
  update tasks k
     set assegnato_a = 'claude', automazione_errore = null, giorno = greatest(k.giorno, tc_oggi())
    from task_tipi p
   where p.id = k.tipo_id
     and coalesce(p.area, k.macroarea, 'produzione') || ':' || p.competenza = new.fonte_rif->>'voce'
     and k.automazione_errore is not null
     and k.stato in ('da_fare', 'rimandato');
  return null;
end;
$$;

-- ── Registro delle esecuzioni ──

alter table automazione_esecuzioni add column if not exists stato text not null default 'in_corso'
  check (stato in ('in_corso', 'ok', 'errore', 'saltato', 'prova'));
alter table automazione_esecuzioni add column if not exists fine timestamptz;
alter table automazione_esecuzioni add column if not exists riepilogo jsonb;
alter table automazione_esecuzioni add column if not exists output text check (length(output) <= 50000);
alter table automazione_esecuzioni drop column if exists ok;
alter table automazione_esecuzioni drop column if exists dettagli;

drop policy if exists "Admin legge esecuzioni" on automazione_esecuzioni;
create policy "Admin legge esecuzioni" on automazione_esecuzioni for select to authenticated using (app_is_admin());
grant select on automazione_esecuzioni to authenticated;

create or replace function _tc_chiave_automazione_ok(p_chiave text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_chiave is not null and p_chiave = (select decrypted_secret from vault.decrypted_secrets where name = 'automazione_mattino_key');
$$;

create or replace function tc_automazione_inizio(p_chiave text, p_nome text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_id bigint;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  insert into automazione_esecuzioni (nome) values (left(p_nome, 50)) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function tc_automazione_fine(p_chiave text, p_id bigint, p_stato text, p_riepilogo jsonb, p_output text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  update automazione_esecuzioni set stato = p_stato, fine = now(), riepilogo = p_riepilogo, output = left(p_output, 50000) where id = p_id;
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function _tc_chiave_automazione_ok(text) from public, anon, authenticated;
revoke execute on function tc_automazione_inizio(text, text) from public;
revoke execute on function tc_automazione_fine(text, bigint, text, jsonb, text) from public;
grant execute on function tc_automazione_inizio(text, text) to anon, authenticated;
grant execute on function tc_automazione_fine(text, bigint, text, jsonb, text) to anon, authenticated;

create or replace function tc_mattino_dati(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_oggi date := tc_oggi();
begin
  if not _tc_chiave_automazione_ok(p_chiave) then
    return jsonb_build_object('success', false, 'error', 'Chiave non valida');
  end if;
  return jsonb_build_object(
    'success', true,
    'lavorativo', tc_giorno_lavorativo(v_oggi),
    'motivo', case when extract(isodow from v_oggi) >= 6 then 'Weekend'
                   when tc_festivo(v_oggi) then 'Festivo'
                   when tc_chiuso(v_oggi) then 'Chiusura: ' || (select string_agg(title, ', ') from calendar_events where event_type = 'chiusura' and v_oggi between date_from and date_to) end,
    'negozi', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', s.nome, 'dominio', s.dominio, 'token', t.access_token, 'token_scade', t.scade_at))
      from shopify_stores s left join shopify_tokens t on t.store_id = s.id where s.attivo), '[]'::jsonb),
    'modifiche', coalesce((select jsonb_agg(jsonb_build_object(
        'negozio', k.macroarea, 'titolo', k.titolo, 'descrizione', k.descrizione, 'creato', k.created_at,
        'ordini', coalesce((select jsonb_agg(o->>'numero') from jsonb_array_elements(
                     case when jsonb_typeof(k.analisi->'ordini') = 'array' then k.analisi->'ordini' else '[]'::jsonb end) o), '[]'::jsonb)))
      from tasks k join task_tipi p on p.id = k.tipo_id
      where p.nome = 'Modifica ordine' and k.stato not in ('completato', 'non_completato')), '[]'::jsonb),
    'caselle', coalesce((select jsonb_agg(jsonb_build_object(
        'indirizzo', c.indirizzo, 'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore))
      from mail_caselle c), '[]'::jsonb));
end;
$$;

create or replace function tc_mattino_esito(p_chiave text, p_ok boolean, p_negozi jsonb, p_messaggio text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare
  s record; t record; o record; v_err text; v_fatti text[]; v_rimasti int; n int := 0; v_oggi date := tc_oggi();
begin
  if not _tc_chiave_automazione_ok(p_chiave) then
    return jsonb_build_object('success', false, 'error', 'Chiave non valida');
  end if;

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

-- Lo script non si è fatto vivo. La riga del registro fa vedere il problema anche nella scheda Automazioni
create or replace function _tc_mattino_controllo(p_oggi date default tc_oggi())
returns void security definer set search_path = public language plpgsql as $$
declare t record; v_id uuid; v_motivo text := 'Lo script del mattino non è partito o non ha risposto';
begin
  if not tc_giorno_lavorativo(p_oggi) then return; end if;
  if exists (select 1 from automazione_esecuzioni where nome = 'mattino' and giorno = p_oggi
              and (stato in ('ok', 'errore') or (stato = 'in_corso' and at > now() - interval '45 minutes'))) then
    return;
  end if;

  insert into automazione_esecuzioni (nome, giorno, stato, fine, output)
  values ('mattino', p_oggi, 'errore', now(), v_motivo || '. Controllo automatico delle 5:30.');

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

revoke execute on function _tc_task_assegna(uuid, date) from public, anon, authenticated;
revoke execute on function _tc_task_piano_del(date) from public, anon, authenticated;
revoke execute on function _tc_mattino_controllo(date) from public, anon, authenticated;
revoke execute on function tc_chiuso(date) from public, anon;
revoke execute on function tc_giorno_lavorativo(date) from public, anon;
grant execute on function tc_chiuso(date) to authenticated;
grant execute on function tc_giorno_lavorativo(date) to authenticated;
