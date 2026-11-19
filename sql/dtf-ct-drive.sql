-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF Conto terzi da Google Drive
-- Ogni cliente conto terzi può avere una cartella Google Drive (drive_url) e i giorni
-- in cui si stampa la sua roba (giorni: 1 = lunedì … 7 = domenica, di solito mar e gio).
-- Il Mac mini (automazioni/dtf-cartella) legge la cartella con l'account robot
-- dtf-lettore@tc-dtf.iam.gserviceaccount.com e salva i file con misure e metri in dtf_ct_files.
-- Nel gestionale i file non stampati sono una riga "Conto terzi" nella coda DTF interno,
-- in cima nei giorni di stampa; "Stampato" li scrive nel calendario (dtf_entries) del giorno.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table dtf_clients add column if not exists drive_url text;
alter table dtf_clients add column if not exists giorni int[] not null default '{2,4}';

create table if not exists dtf_ct_files (
  id          bigserial primary key,
  client_id   uuid not null references dtf_clients(id) on delete cascade,
  drive_id    text not null unique,
  nome        text not null,
  percorso    text,
  size        bigint,
  modificato  timestamptz,
  item        jsonb not null default '{}',     -- come i file DTF: { name, pz, w_cm, h_cm, metri, … }
  metri       numeric,
  visto_at    timestamptz not null default now(),
  stampato_giorno date,
  created_at  timestamptz not null default now()
);
create index if not exists dtf_ct_files_da_stampare on dtf_ct_files (client_id) where stampato_giorno is null;

alter table dtf_ct_files enable row level security;
drop policy if exists "Staff legge dtf_ct_files" on dtf_ct_files;
create policy "Staff legge dtf_ct_files" on dtf_ct_files for select to authenticated using (app_is_staff());
drop policy if exists "Staff modifica dtf_ct_files" on dtf_ct_files;
create policy "Staff modifica dtf_ct_files" on dtf_ct_files for update to authenticated using (app_is_staff()) with check (app_is_staff());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dtf_ct_files') then
    alter publication supabase_realtime add table dtf_ct_files;
  end if;
end $$;

-- Mac mini: clienti con la cartella e file già conosciuti
create or replace function tc_dtf_ct_dati(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  return jsonb_build_object('success', true,
    'clienti', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'drive_url', c.drive_url))
       from dtf_clients c where coalesce(c.drive_url, '') <> ''), '[]'::jsonb),
    'files', coalesce((select jsonb_object_agg(f.drive_id, jsonb_build_object('size', f.size, 'modificato', f.modificato))
       from dtf_ct_files f), '{}'::jsonb));
end;
$$;

-- Mac mini: file nuovi o cambiati [{ client_id, drive_id, nome, percorso, size, modificato, item }]
create or replace function tc_dtf_ct_salva(p_chiave text, p_files jsonb)
returns jsonb security definer set search_path = public language plpgsql as $$
declare x jsonb; n int := 0;
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  for x in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    continue when not exists (select 1 from dtf_clients where id = (x->>'client_id')::uuid);
    insert into dtf_ct_files (client_id, drive_id, nome, percorso, size, modificato, item, metri)
    values ((x->>'client_id')::uuid, x->>'drive_id', x->>'nome', x->>'percorso', (x->>'size')::bigint,
            (x->>'modificato')::timestamptz, coalesce(x->'item', '{}'::jsonb), nullif(x->'item'->>'metri', '')::numeric)
    on conflict (drive_id) do update set nome = excluded.nome, percorso = excluded.percorso, size = excluded.size,
      modificato = excluded.modificato, item = excluded.item, metri = excluded.metri, visto_at = now(),
      -- file sostituito dopo la stampa: si ristampa
      stampato_giorno = case when dtf_ct_files.size is distinct from excluded.size
                               or dtf_ct_files.modificato is distinct from excluded.modificato then null
                             else dtf_ct_files.stampato_giorno end;
    n := n + 1;
  end loop;
  return jsonb_build_object('success', true, 'salvati', n);
end;
$$;

-- Gestionale: "Stampato" sulla riga Conto terzi → file segnati e metri nel calendario del giorno
create or replace function dtf_ct_segna_stampato(p_client uuid, p_ids bigint[], p_giorno date default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare
  v_giorno date := coalesce(p_giorno, tc_oggi());
  v_metri numeric; v_nomi text; v_items jsonb;
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  select coalesce(sum(coalesce(metri, 0)), 0), string_agg(nome, E'\n' order by percorso, nome),
         coalesce(jsonb_agg(item order by percorso, nome), '[]'::jsonb)
    into v_metri, v_nomi, v_items
    from dtf_ct_files where client_id = p_client and id = any(p_ids) and stampato_giorno is null;
  if v_nomi is null then return jsonb_build_object('success', false, 'error', 'Niente da segnare'); end if;

  update dtf_ct_files set stampato_giorno = v_giorno where client_id = p_client and id = any(p_ids) and stampato_giorno is null;
  insert into dtf_entries (client_id, giorno, metri, dettaglio, files, updated_by, updated_at)
  values (p_client, v_giorno, round(v_metri, 2), v_nomi, v_items, 'automazione', now())
  on conflict (client_id, giorno) do update set
    metri = round(coalesce(dtf_entries.metri, 0) + excluded.metri, 2),
    dettaglio = concat_ws(E'\n', nullif(dtf_entries.dettaglio, ''), excluded.dettaglio),
    files = coalesce(dtf_entries.files, '[]'::jsonb) || excluded.files,
    updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('success', true, 'metri', round(v_metri, 2), 'giorno', v_giorno);
end;
$$;

revoke execute on function tc_dtf_ct_dati(text) from public;
revoke execute on function tc_dtf_ct_salva(text, jsonb) from public;
revoke execute on function dtf_ct_segna_stampato(uuid, bigint[], date) from public, anon;
grant execute on function tc_dtf_ct_dati(text) to anon, authenticated;
grant execute on function tc_dtf_ct_salva(text, jsonb) to anon, authenticated;
grant execute on function dtf_ct_segna_stampato(uuid, bigint[], date) to authenticated;
