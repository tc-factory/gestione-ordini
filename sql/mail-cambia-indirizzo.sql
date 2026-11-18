-- ════════════════════════════════════════════════════════
-- T&C Factory — Mail: pulsante "Cambia indirizzo" sulla conversazione
-- (richiesta utente 2026-11-18: il cliente manda il civico mancante, dalla mail
-- si deve poter cambiare l'indirizzo o andare al task)
--
--   • indirizzo: per i task con modifica "indirizzo" non ancora applicata, l'ordine
--     (id, numero, indirizzo attuale) e l'indirizzo dato dal cliente
--
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function tc_mail_filo(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_messaggi jsonb;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;

  select jsonb_agg(jsonb_build_object(
           'id', m.id, 'direzione', m.direzione, 'da_email', m.da_email, 'da_nome', m.da_nome, 'a', m.a,
           'oggetto', m.oggetto, 'ricevuto_at', m.ricevuto_at, 'testo', m.testo, 'testo_citato', m.testo_citato,
           'allegati', m.allegati, 'automatica', m.automatica, 'message_id', m.message_id,
           'letta_at', m.letta_at, 'letta_da', m.letta_da,
           'cartella', coalesce(m.cartella_voluta, m.cartella), 'in_spostamento', m.cartella_voluta is not null,
           'sposta_errore', m.sposta_errore) order by m.ricevuto_at)
    into v_messaggi
    from mail_messaggi m where m.casella_id = p_casella and m.filo = p_filo;
  if v_messaggi is null then return jsonb_build_object('success', false, 'error', 'Conversazione non trovata'); end if;

  update mail_messaggi set letta_at = now(), letta_da = app_nickname()
   where casella_id = p_casella and filo = p_filo and letta_at is null;

  return jsonb_build_object('success', true, 'messaggi', v_messaggi, 'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'titolo', t.titolo, 'stato', t.stato, 'assegnato_a', t.assegnato_a, 'mail_id', t.mail_id,
             'bozza_risposta', t.bozza_risposta, 'risposta_inviata_at', t.risposta_inviata_at,
             'tracking', nullif(coalesce(t.analisi->'svincolo'->>'tracking', t.analisi->'spedizione'->>'tracking', t.analisi->'chiamare_cliente'->0->>'tracking'), ''),
             'chiamare', t.analisi ? 'chiamare_cliente',
             'svincolo', nullif(nullif(t.analisi->'svincolo'->>'scelta', ''), 'nessuna'),
             'indirizzo', (
               select jsonb_build_object('ordine_id', o.id, 'numero', o.numero, 'attuale', o.indirizzo,
                        'proposto', coalesce(t.analisi->'indirizzo_proposto', t.analisi->'indirizzo_nuovo', t.analisi->'memoria'->'indirizzo'))
                 from shopify_orders o
                where t.analisi->>'modifica' = 'indirizzo'
                  and coalesce(t.analisi->>'indirizzo_stato', '') <> 'applicato'
                  and o.annullato_at is null and o.stato_evasione = 'UNFULFILLED'
                  and o.store_id = coalesce(t.analisi->'indirizzo_ordine'->>'negozio', t.analisi->'ordini'->0->>'negozio')
                  and o.numero = coalesce(t.analisi->'indirizzo_ordine'->>'numero', t.analisi->'ordini'->0->>'numero')
                limit 1)) order by t.created_at)
      from tasks t join mail_messaggi m on m.id = t.mail_id
     where m.casella_id = p_casella and m.filo = p_filo
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_filo(text, text) from public, anon;
grant  execute on function tc_mail_filo(text, text) to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
