-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF Conto terzi: copia da Google Drive al NAS nei giorni di stampa
-- Martedì e giovedì (giorni del cliente, solo lavorativi) alle 5 e poi ogni ora fino alle 14
-- il Mac mini copia i file nuovi della cartella Drive del cliente in DTF/1. Stampa/1. Stampare/<cliente>,
-- li conta nel calendario del conto terzi (tc_dtf_ct_copiati) e su Drive li sposta in STAMPATO.
-- Sul NAS la cartella del cliente è riconosciuta (ct_clienti) e sta in cima alla coda DTF interno.
-- Richiede sql/dtf-ct-drive.sql e sql/dtf-cartella-server.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table dtf_ct_files add column if not exists copiato_at timestamptz;

create or replace function tc_dtf_ct_dati(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  return jsonb_build_object('success', true,
    'lavorativo', tc_giorno_lavorativo(tc_oggi()),
    'clienti', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'drive_url', c.drive_url, 'giorni', c.giorni))
       from dtf_clients c where coalesce(c.drive_url, '') <> ''), '[]'::jsonb),
    'files', coalesce((select jsonb_object_agg(f.drive_id, jsonb_build_object('size', f.size, 'modificato', f.modificato,
       'contato', f.stampato_giorno is not null)) from dtf_ct_files f), '{}'::jsonb));
end;
$$;

-- File copiati sul NAS: si contano nel calendario di oggi (una volta sola per file e versione)
-- p_files: [{ drive_id, nome, percorso, size, modificato, item }]
create or replace function tc_dtf_ct_copiati(p_chiave text, p_client uuid, p_files jsonb)
returns jsonb security definer set search_path = public language plpgsql as $$
declare
  x jsonb; v_old dtf_ct_files; v_oggi date := tc_oggi();
  v_metri numeric := 0; v_nomi text[] := '{}'; v_items jsonb := '[]'; n int := 0;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  if not exists (select 1 from dtf_clients where id = p_client) then return jsonb_build_object('success', false, 'error', 'Cliente non trovato'); end if;
  for x in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    select * into v_old from dtf_ct_files where drive_id = x->>'drive_id';
    continue when found and v_old.stampato_giorno is not null and v_old.size is not distinct from (x->>'size')::bigint
                 and v_old.modificato is not distinct from (x->>'modificato')::timestamptz;
    insert into dtf_ct_files (client_id, drive_id, nome, percorso, size, modificato, item, metri, stampato_giorno, copiato_at)
    values (p_client, x->>'drive_id', x->>'nome', x->>'percorso', (x->>'size')::bigint, (x->>'modificato')::timestamptz,
            coalesce(x->'item', '{}'::jsonb), nullif(x->'item'->>'metri', '')::numeric, v_oggi, now())
    on conflict (drive_id) do update set nome = excluded.nome, percorso = excluded.percorso, size = excluded.size,
      modificato = excluded.modificato, item = excluded.item, metri = excluded.metri, stampato_giorno = v_oggi,
      copiato_at = now(), visto_at = now();
    v_metri := v_metri + coalesce(nullif(x->'item'->>'metri', '')::numeric, 0);
    v_nomi := v_nomi || (x->>'nome');
    v_items := v_items || jsonb_build_array(coalesce(x->'item', '{}'::jsonb));
    n := n + 1;
  end loop;
  if n > 0 then
    insert into dtf_entries (client_id, giorno, metri, dettaglio, files, updated_by, updated_at)
    values (p_client, v_oggi, round(v_metri, 2), array_to_string(v_nomi, E'\n'), v_items, 'automazione', now())
    on conflict (client_id, giorno) do update set
      metri = round(coalesce(dtf_entries.metri, 0) + excluded.metri, 2),
      dettaglio = concat_ws(E'\n', nullif(dtf_entries.dettaglio, ''), excluded.dettaglio),
      files = coalesce(dtf_entries.files, '[]'::jsonb) || excluded.files,
      updated_by = excluded.updated_by, updated_at = now();
  end if;
  return jsonb_build_object('success', true, 'contati', n, 'metri', round(v_metri, 2));
end;
$$;
revoke execute on function tc_dtf_ct_copiati(text, uuid, jsonb) from public;
grant execute on function tc_dtf_ct_copiati(text, uuid, jsonb) to anon, authenticated;

-- La cartella del cliente sul NAS si riconosce dal nome: lista dei clienti con la cartella Drive
create or replace function tc_dtf_cartella_dati(p_chiave text)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
declare v_lista jsonb;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  v_lista := coalesce((select value from app_settings where key = 'dtf_lista'), '[]'::jsonb);
  return jsonb_build_object('success', true,
    'lista', v_lista,
    'richiesta', (select value from app_settings where key = 'dtf_numera_richiesta'),
    'roll_cm', (select value from app_settings where key = 'dtf_roll_cm'),
    'margin_cm', (select value from app_settings where key = 'dtf_margin_cm'),
    'ct_clienti', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome))
       from dtf_clients c where coalesce(c.drive_url, '') <> ''), '[]'::jsonb),
    'items', coalesce((select jsonb_object_agg(o.id, coalesce(o.dtf_items, '[]'::jsonb))
       from orders o where o.deleted_at is null
        and o.id in (select x->>'id' from jsonb_array_elements(v_lista) x)), '{}'::jsonb));
end;
$$;
