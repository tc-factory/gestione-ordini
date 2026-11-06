-- ════════════════════════════════════════════════════════
-- T&C Factory — Automazione del mattino (DDT e file di stampa)
--
-- Lo script gira su un Mac in sede (automazioni/shopify-mattino) e non ha accesso al database:
-- con una chiave propria, salvata nel Vault, può solo chiamare questa funzione.
-- Per revocarla basta cambiare il segreto 'automazione_mattino_key'.
--
-- Richiede shopify.sql, mail.sql e cervello.sql già eseguiti. Si può rieseguire.
-- ════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'automazione_mattino_key') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'automazione_mattino_key', 'Chiave dello script del mattino sul Mac in sede');
  end if;
end $$;

-- Negozi con il loro token, richieste di modifica aperte, stato delle caselle di posta
create or replace function tc_mattino_dati(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'automazione_mattino_key';
  if v_key is null or p_chiave is distinct from v_key then
    return jsonb_build_object('success', false, 'error', 'Chiave non valida');
  end if;
  return jsonb_build_object(
    'success', true,
    'lavorativo', extract(isodow from tc_oggi()) < 6 and not tc_festivo(tc_oggi()),
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
revoke execute on function tc_mattino_dati(text) from public;
grant execute on function tc_mattino_dati(text) to anon, authenticated;
