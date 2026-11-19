-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF interno: cartella "1. Stampare" letta dal Mac mini
-- (automazioni/dtf-cartella). Il gestionale pubblica in app_settings:
--   dtf_lista             [{ id, nome, descr }…] ordini Da stampare, già in ordine
--   dtf_numera_richiesta  { at } bottone "Numera ora"
-- Lo script, con la chiave delle automazioni, legge lista e file degli ordini e
-- salva file/metri sugli ordini e il suo esito in app_settings 'dtf_cartella_stato'.
-- Sostituisce sql/dtf-cartelle.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

drop function if exists tc_dtf_cartelle_piano(text);

create or replace function tc_dtf_cartella_dati(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_lista jsonb;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  v_lista := coalesce((select value from app_settings where key = 'dtf_lista'), '[]'::jsonb);
  return jsonb_build_object('success', true,
    'lista', v_lista,
    'richiesta', (select value from app_settings where key = 'dtf_numera_richiesta'),
    'roll_cm', (select value from app_settings where key = 'dtf_roll_cm'),
    'margin_cm', (select value from app_settings where key = 'dtf_margin_cm'),
    'items', coalesce((select jsonb_object_agg(o.id, coalesce(o.dtf_items, '[]'::jsonb))
       from orders o where o.deleted_at is null
        and o.id in (select x->>'id' from jsonb_array_elements(v_lista) x)), '{}'::jsonb));
end;
$$;

-- p_ordini: [{ id, items }…] solo ordini della lista; p_stato: esito per la riga in DTF interno
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
  return jsonb_build_object('success', true, 'ordini', n);
end;
$$;

revoke execute on function tc_dtf_cartella_dati(text) from public;
revoke execute on function tc_dtf_cartella_salva(text, jsonb, jsonb) from public;
grant execute on function tc_dtf_cartella_dati(text) to anon, authenticated;
grant execute on function tc_dtf_cartella_salva(text, jsonb, jsonb) to anon, authenticated;
