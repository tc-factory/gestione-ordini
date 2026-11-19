-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF interno: task automatici dalla cartella "1. Stampare"
-- Ogni volta che il Mac mini salva l'esito (tc_dtf_cartella_salva):
--   • cartella senza ordine → task URGENTE "Cartella DTF senza ordine: <nome>" (tipo Stampa DTF)
--   • ordine che aveva la cartella e ora non ce l'ha (e non è segnato stampato)
--     → task "Controllare se stampato: <ordine>" in DTF
-- I task si chiudono da soli quando la situazione si risolve.
-- Richiede sql/dtf-cartella-server.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_dtf_cartella_task(p_stato jsonb)
returns void security definer set search_path = public language plpgsql as $$
declare
  v_tipo uuid := (select id from task_tipi where nome = 'Stampa DTF' limit 1);
  v_senza text[] := array(select jsonb_array_elements_text(coalesce(p_stato->'senzaOrdine', '[]'::jsonb)));
  v_manc text[]  := array(select jsonb_array_elements_text(coalesce(p_stato->'mancanti', '[]'::jsonb)));
  v_nome text; v_id text; c jsonb; o record;
begin
  -- Cartelle senza ordine
  foreach v_nome in array v_senza loop
    if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'dtf' = 'senza:' || v_nome
                    and stato not in ('completato', 'non_completato')) then
      select x into c from jsonb_array_elements(coalesce(p_stato->'cartelle', '[]'::jsonb)) x where x->>'nome' = v_nome limit 1;
      insert into tasks (tipo_id, titolo, descrizione, priorita, fonte, fonte_rif, minuti_stimati, creato_da)
      values (v_tipo, left('Cartella DTF senza ordine: ' || v_nome, 200),
        'In DTF/1. Stampa/1. Stampare c''è «' || v_nome || '»'
          || coalesce(' (' || (c->>'files') || ' file, ' || replace(c->>'metri', '.', ',') || ' m)', '')
          || ' ma nessun ordine da stampare con questo nome. Crea l''ordine o rinomina la cartella col nome dell''ordine; '
          || 'se l''ordine è già stampato sposta la cartella in 00 - Stampato. Intanto è in DTF interno, dove puoi darle una priorità.',
        'urgente', 'automazione', jsonb_build_object('dtf', 'senza:' || v_nome), 5, 'automazione');
    end if;
  end loop;
  update tasks set stato = 'completato', completato_at = now()
   where fonte = 'automazione' and fonte_rif->>'dtf' like 'senza:%' and stato not in ('completato', 'non_completato')
     and not (substr(fonte_rif->>'dtf', 7) = any(v_senza));

  -- Ordini la cui cartella non c'è più
  foreach v_id in array v_manc loop
    select id, nome into o from orders where id = v_id;
    continue when not found;
    if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'dtf' = 'mancante:' || v_id
                    and stato not in ('completato', 'non_completato')) then
      insert into tasks (tipo_id, titolo, descrizione, priorita, fonte, fonte_rif, riferimento, minuti_stimati, creato_da)
      values (v_tipo, left('Controllare se stampato: ' || coalesce(o.nome, v_id), 200),
        'La cartella di questo ordine non è più in DTF/1. Stampa/1. Stampare, ma in DTF interno l''ordine non è segnato stampato. '
          || 'Se è stampato premi Stampato in DTF interno; se la cartella è stata spostata per sbaglio, rimettila.',
        'normale', 'automazione', jsonb_build_object('dtf', 'mancante:' || v_id, 'ordine', v_id),
        jsonb_build_object('tipo', 'ordine', 'id', v_id, 'label', coalesce(o.nome, v_id)), 5, 'automazione');
    end if;
  end loop;
  update tasks set stato = 'completato', completato_at = now()
   where fonte = 'automazione' and fonte_rif->>'dtf' like 'mancante:%' and stato not in ('completato', 'non_completato')
     and not (substr(fonte_rif->>'dtf', 10) = any(v_manc));
end;
$$;
revoke execute on function _tc_dtf_cartella_task(jsonb) from public, anon, authenticated;

create or replace function tc_dtf_cartella_salva(p_chiave text, p_ordini jsonb, p_stato jsonb)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_lista jsonb; x jsonb; n int := 0;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  v_lista := coalesce((select value from app_settings where key = 'dtf_lista'), '[]'::jsonb);
  for x in select * from jsonb_array_elements(coalesce(p_ordini, '[]'::jsonb)) loop
    if jsonb_typeof(x->'items') = 'array' and exists (select 1 from jsonb_array_elements(v_lista) l where l->>'id' = x->>'id') then
      update orders set dtf_items = x->'items', updated_at = now() where id = x->>'id' and deleted_at is null;
      n := n + 1;
    end if;
  end loop;
  insert into app_settings (key, value, updated_at) values ('dtf_cartella_stato', coalesce(p_stato, '{}'::jsonb), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform _tc_dtf_cartella_task(p_stato);
  return jsonb_build_object('success', true, 'ordini', n);
end;
$$;
