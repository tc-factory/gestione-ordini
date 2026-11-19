-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF ordini nuovi: modalità PROVA con riscontro manuale (deciso 2026-11-19)
-- app_settings 'dtf_prepara_modo': 'prova' (default) | 'automatica'. Si cambia SOLO a mano,
-- quando l'utente lo dice: niente passaggio automatico, neanche con precisione al 100%.
-- In prova il Mac mini non copia: salva una proposta (cartella cliente, file, pezzi) in
-- dtf_preparati con esito 'proposta'. In DTF interno la si approva (anche correggendo file e
-- pezzi) o la si rifiuta; il Mac mini copia solo le approvate (esito 'approvato' → 'copiato').
-- riscontro: 'giusto' (approvata così com'era) | 'corretto' (approvata con modifiche) | 'sbagliato' (rifiutata).
-- Richiede sql/dtf-prepara-ordini.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table dtf_preparati add column if not exists proposta jsonb;        -- [{ src, nome, pz }] src relativo a DATI
alter table dtf_preparati add column if not exists approvati jsonb;       -- file approvati (uguali o corretti)
alter table dtf_preparati add column if not exists riscontro text;
alter table dtf_preparati add column if not exists riscontro_da text;
alter table dtf_preparati add column if not exists riscontro_at timestamptz;
alter table dtf_preparati add column if not exists nota text;

insert into app_settings (key, value) values ('dtf_prepara_modo', '"prova"') on conflict (key) do nothing;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dtf_preparati') then
    alter publication supabase_realtime add table dtf_preparati;
  end if;
end $$;

-- Mac mini: proposta, copia fatta, cartella già presente
create or replace function tc_dtf_preparato(p_chiave text, p_order text, p_esito text, p_cartella text, p_sorgente text, p_files int, p_proposta jsonb default null)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  insert into dtf_preparati (order_id, esito, cartella, sorgente, files, proposta)
  values (p_order, p_esito, p_cartella, p_sorgente, coalesce(p_files, 0), p_proposta)
  on conflict (order_id) do update set
    esito = excluded.esito, at = now(),
    cartella = coalesce(excluded.cartella, dtf_preparati.cartella),
    sorgente = coalesce(excluded.sorgente, dtf_preparati.sorgente),
    files = excluded.files,
    proposta = coalesce(dtf_preparati.proposta, excluded.proposta);
  return jsonb_build_object('success', true);
end;
$$;
drop function if exists tc_dtf_preparato(text, text, text, text, text, int);
revoke execute on function tc_dtf_preparato(text, text, text, text, text, int, jsonb) from public;
grant execute on function tc_dtf_preparato(text, text, text, text, text, int, jsonb) to anon, authenticated;

-- Gestionale: riscontro di una proposta. p_files null = rifiutata; altrimenti i file da copiare.
create or replace function dtf_prepara_riscontro(p_order text, p_files jsonb, p_nota text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare r dtf_preparati; v_chi text; v_norm jsonb; v_prop jsonb;
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  select * into r from dtf_preparati where order_id = p_order for update;
  if not found or r.esito <> 'proposta' then return jsonb_build_object('success', false, 'error', 'Nessuna proposta da controllare'); end if;
  select nickname into v_chi from app_users where auth_id = auth.uid();
  if p_files is null or jsonb_array_length(p_files) = 0 then
    update dtf_preparati set esito = 'rifiutato', riscontro = 'sbagliato', riscontro_da = v_chi, riscontro_at = now(), nota = p_nota where order_id = p_order;
    return jsonb_build_object('success', true, 'riscontro', 'sbagliato');
  end if;
  -- giusto se file e pezzi sono quelli proposti
  select coalesce(jsonb_agg(jsonb_build_object('src', x->>'src', 'pz', (x->>'pz')::int) order by x->>'src'), '[]') into v_norm from jsonb_array_elements(p_files) x;
  select coalesce(jsonb_agg(jsonb_build_object('src', x->>'src', 'pz', (x->>'pz')::int) order by x->>'src'), '[]') into v_prop from jsonb_array_elements(r.proposta) x;
  update dtf_preparati set esito = 'approvato', approvati = p_files,
    riscontro = case when v_norm = v_prop then 'giusto' else 'corretto' end,
    riscontro_da = v_chi, riscontro_at = now(), nota = p_nota
   where order_id = p_order;
  return jsonb_build_object('success', true, 'riscontro', case when v_norm = v_prop then 'giusto' else 'corretto' end);
end;
$$;
revoke execute on function dtf_prepara_riscontro(text, jsonb, text) from public, anon;
grant execute on function dtf_prepara_riscontro(text, jsonb, text) to authenticated;

-- Dati del Mac mini: modo, ordini senza proposta, proposte approvate da copiare
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
    'prepara_modo', coalesce((select value #>> '{}' from app_settings where key = 'dtf_prepara_modo'), 'prova'),
    'da_preparare', _tc_dtf_da_preparare(),
    'preparati', coalesce((select jsonb_object_agg(regexp_replace(p.cartella, '^.*/', ''), p.order_id)
       from dtf_preparati p where p.esito = 'copiato' and p.cartella is not null), '{}'::jsonb),
    'approvati', coalesce((select jsonb_agg(jsonb_build_object('id', p.order_id, 'nome', o.nome, 'files', p.approvati))
       from dtf_preparati p join orders o on o.id = p.order_id where p.esito = 'approvato' and o.deleted_at is null), '[]'::jsonb),
    'items', coalesce((select jsonb_object_agg(o.id, coalesce(o.dtf_items, '[]'::jsonb))
       from orders o where o.deleted_at is null
        and o.id in (select x->>'id' from jsonb_array_elements(v_lista) x)), '{}'::jsonb));
end;
$$;
