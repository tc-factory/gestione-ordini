-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF: file col nome fuori regola in "1. Stampare" → task "Rinominare i file DTF" (2026-11-20)
-- La regola di tutti i file: parti separate da "-", pezzi in fondo come "-<numero>pz" (cliente-cuore-nero-12pz.tif).
-- Il Mac mini (dtf_cartella.py, nome_fuori_regola) mette nell'esito 'nomi' = [{nome, dir, files: [{file, motivi, proposto}]}];
-- un task per cartella, coda DTF-FILE, chiuso da solo quando i nomi sono giusti. Le cartelle conto terzi (K1) no.
-- Rifà _tc_dtf_cartella_task con tutte le parti (senza ordine, mancante, tif, nome). Richiede sql/dtf-tiff.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function _tc_dtf_cartella_task(p_stato jsonb)
returns void security definer set search_path = public language plpgsql as $$
declare
  v_tipo uuid := (select id from task_tipi where nome = 'Stampa DTF' limit 1);
  v_senza text[] := array(select jsonb_array_elements_text(coalesce(p_stato->'senzaOrdine', '[]'::jsonb)));
  v_manc text[]  := array(select jsonb_array_elements_text(coalesce(p_stato->'mancanti', '[]'::jsonb)));
  v_pdf text[]   := array(select x->>'nome' from jsonb_array_elements(coalesce(p_stato->'pdf', '[]'::jsonb)) x);
  v_nomi text[]  := array(select x->>'nome' from jsonb_array_elements(coalesce(p_stato->'nomi', '[]'::jsonb)) x);
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

  -- PDF da trasformare in TIF
  foreach v_nome in array v_pdf loop
    if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'dtf' = 'tif:' || v_nome
                    and stato not in ('completato', 'non_completato')) then
      select x into c from jsonb_array_elements(coalesce(p_stato->'pdf', '[]'::jsonb)) x where x->>'nome' = v_nome limit 1;
      insert into tasks (tipo_id, titolo, descrizione, priorita, fonte, fonte_rif, minuti_stimati, creato_da)
      values (v_tipo, left('Creare il file TIF: ' || v_nome, 200),
        'In DTF/1. Stampa/1. Stampare' || case when c->>'dir' is not null then ', cartella «' || (c->>'dir') || '»,' else '' end
          || ' ci sono PDF senza il loro TIF: '
          || coalesce((select string_agg(f, ', ') from jsonb_array_elements_text(c->'files') f), '') || '. '
          || 'Premi «Genera TIFF automatico» e scegli la riduzione dello SPOT (0-3 px), oppure crea i TIF a mano '
          || 'e sposta i PDF nella sottocartella «PDF originali». Il task si chiude da solo quando i TIF ci sono.',
        'urgente', 'automazione', jsonb_build_object('dtf', 'tif:' || v_nome), 5, 'automazione');
    end if;
  end loop;
  update tasks set stato = 'completato', completato_at = now()
   where fonte = 'automazione' and fonte_rif->>'dtf' like 'tif:%' and stato not in ('completato', 'non_completato')
     and not (substr(fonte_rif->>'dtf', 5) = any(v_pdf));

  -- File col nome fuori regola (parti separate da "-", pezzi in fondo come "-12pz")
  foreach v_nome in array v_nomi loop
    if not exists (select 1 from tasks where fonte = 'automazione' and fonte_rif->>'dtf' = 'nome:' || v_nome
                    and stato not in ('completato', 'non_completato')) then
      select x into c from jsonb_array_elements(coalesce(p_stato->'nomi', '[]'::jsonb)) x where x->>'nome' = v_nome limit 1;
      insert into tasks (tipo_id, titolo, descrizione, priorita, fonte, fonte_rif, minuti_stimati, creato_da)
      values (v_tipo, left('Rinominare i file DTF: ' || v_nome, 200),
        'In DTF/1. Stampa/1. Stampare' || case when c->>'dir' is not null then ', cartella «' || (c->>'dir') || '»,' else '' end
          || ' ci sono file col nome fuori regola. La regola: parti separate da un trattino e pezzi in fondo, '
          || 'es. cliente-posizione-colore-12pz.tif (pz, non pezzi o copie). Da rinominare: '
          || coalesce((select string_agg((f->>'file') || ' → ' || (f->>'proposto'), '; ') from jsonb_array_elements(c->'files') f), '')
          || '. Il task si chiude da solo quando i nomi sono a posto.',
        'normale', 'automazione', jsonb_build_object('dtf', 'nome:' || v_nome), 5, 'automazione');
    end if;
  end loop;
  update tasks set stato = 'completato', completato_at = now()
   where fonte = 'automazione' and fonte_rif->>'dtf' like 'nome:%' and stato not in ('completato', 'non_completato')
     and not (substr(fonte_rif->>'dtf', 6) = any(v_nomi));
end;
$$;
revoke execute on function _tc_dtf_cartella_task(jsonb) from public, anon, authenticated;
