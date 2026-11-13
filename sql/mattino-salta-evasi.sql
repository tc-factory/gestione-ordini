-- ════════════════════════════════════════════════════════
-- T&C Factory — Riepilogo del mattino: niente richieste su ordini già spediti
--
--   Il foglio elenca le cose da sistemare PRIMA di spedire. I task "Modifica ordine"
--   restano aperti finché qualcuno non li chiude, quindi un ordine già evaso
--   (o annullato) su Shopify ricompariva ogni mattina. Ora:
--     • gli ordini evasi o annullati in shopify_orders si tolgono dalla richiesta;
--     • se la richiesta aveva ordini e sono tutti evasi/annullati, non va nel foglio.
--   Il task resta aperto nel Centro di controllo (es. rimborso o cambio dopo la spedizione).
--
-- Sostituisce la versione in mail-bozze.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tc_mattino_dati(p_chiave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        'ordini', x.aperti))
      from tasks k
      join task_tipi p on p.id = k.tipo_id
      cross join lateral (
        select count(*) as tutti,
               coalesce(jsonb_agg(o->>'numero') filter (where not exists (
                 select 1 from shopify_orders so
                  where so.store_id = coalesce(o->>'negozio', k.macroarea)
                    and so.numero = o->>'numero'
                    and (so.stato_evasione = 'FULFILLED' or so.annullato_at is not null))), '[]'::jsonb) as aperti
          from jsonb_array_elements(case when jsonb_typeof(k.analisi->'ordini') = 'array' then k.analisi->'ordini' else '[]'::jsonb end) o
      ) x
      where p.nome = 'Modifica ordine' and k.stato not in ('completato', 'non_completato')
        and (x.tutti = 0 or jsonb_array_length(x.aperti) > 0)), '[]'::jsonb),
    'caselle', coalesce((select jsonb_agg(jsonb_build_object(
        'indirizzo', c.indirizzo, 'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore))
      from mail_caselle c where not c.interna), '[]'::jsonb));
end;
$function$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
