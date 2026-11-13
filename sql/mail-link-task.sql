-- ════════════════════════════════════════════════════════
-- T&C Factory — Mail: la conversazione porta anche se il task riguarda una spedizione
-- (richiesta utente 2026-11-13: dalla mail di una spedizione, link diretto al task
-- aperto nel Centro di controllo)
--
--   • tracking: il pacco GLS del task (analisi.spedizione o analisi.svincolo)
--   • svincolo: la scelta del cliente per il pacco fermo (istruzioni a GLS da mandare)
--   • chiamare: pacco fermo di nuovo dopo uno svincolo, va chiamato il cliente (2026-11-13)
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
             'svincolo', nullif(nullif(t.analisi->'svincolo'->>'scelta', ''), 'nessuna')) order by t.created_at)
      from tasks t join mail_messaggi m on m.id = t.mail_id
     where m.casella_id = p_casella and m.filo = p_filo
  ), '[]'::jsonb));
end;
$$;
