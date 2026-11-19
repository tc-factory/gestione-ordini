-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF interno: numeri davanti alle cartelle di "1. Stampare"
-- Il gestionale (js/dtf-cartella.js) salva in app_settings 'dtf_cartelle_numeri'
-- { at, cartelle: { "cf pavia": "01 - cf pavia", … } } nell'ordine della lista Da stampare.
-- Lo script sul Mac che vede il NAS (automazioni/dtf-cartelle) lo legge con la chiave
-- delle automazioni e rinomina le cartelle: Chrome non può rinominare su un disco di rete.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function tc_dtf_cartelle_piano(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  return jsonb_build_object('success', true,
    'piano', coalesce((select value from app_settings where key = 'dtf_cartelle_numeri'), '{}'::jsonb));
end;
$$;

revoke execute on function tc_dtf_cartelle_piano(text) from public;
grant execute on function tc_dtf_cartelle_piano(text) to anon, authenticated;
