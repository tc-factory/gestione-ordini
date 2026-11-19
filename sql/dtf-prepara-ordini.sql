-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF interno: file DTF preparati da soli per gli ordini nuovi
-- Per ogni ordine creato da quando l'automazione è attiva (app_settings 'dtf_prepara_dal'),
-- con la lavorazione DTF (è nella lista Da stampare), il Mac mini cerca la cartella del cliente
-- sul NAS (DATI/Clienti/<iniziale>/<cliente>, DATI/CrossFit/<box>), prende i file della cartella
-- "dtf" dell'anno (o la cartella principale se non è divisa per anni) e li copia in
-- DTF/1. Stampa/1. Stampare/<NOME ORDINE> col totale capi nel nome ("-10pz").
-- Ogni ordine si prepara una volta sola (dtf_preparati), anche se poi la cartella viene spostata.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists dtf_preparati (
  order_id  text primary key,
  at        timestamptz not null default now(),
  esito     text not null,             -- copiato | cliente_non_trovato | nessun_file | gia_presente
  cartella  text,
  sorgente  text,
  files     int not null default 0
);
alter table dtf_preparati enable row level security;
drop policy if exists "Staff legge dtf_preparati" on dtf_preparati;
create policy "Staff legge dtf_preparati" on dtf_preparati for select to authenticated using (app_is_staff());

insert into app_settings (key, value) values ('dtf_prepara_dal', to_jsonb(now())) on conflict (key) do nothing;

-- Ordini della lista Da stampare creati dopo l'attivazione e non ancora preparati
create or replace function _tc_dtf_da_preparare()
returns jsonb security definer set search_path = public language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'nome', o.nome, 'descr', coalesce(o.order_module->>'descrizione', ''),
    'cliente', nullif(trim(concat_ws(' ', nullif(c.ragione_sociale, ''), case when coalesce(c.ragione_sociale, '') = '' then concat_ws(' ', c.nome, c.cognome) end)), ''),
    'capi', (select coalesce(sum(case when (r->>'qnt') ~ '^\s*\d+\s*$' then (r->>'qnt')::int else 0 end), 0)
               from jsonb_array_elements(coalesce(o.order_module->'rows', '[]'::jsonb)) r
              where not coalesce((r->>'preventivo')::boolean, false))
  ) order by o.created_at), '[]'::jsonb)
  from orders o left join clients c on c.id = o.client_id
  where o.deleted_at is null
    and o.created_at >= coalesce((select (value #>> '{}')::timestamptz from app_settings where key = 'dtf_prepara_dal'), now())
    and o.id in (select x->>'id' from jsonb_array_elements(coalesce((select value from app_settings where key = 'dtf_lista'), '[]'::jsonb)) x)
    and not exists (select 1 from dtf_preparati p where p.order_id = o.id);
$$;
revoke execute on function _tc_dtf_da_preparare() from public, anon, authenticated;

create or replace function tc_dtf_preparato(p_chiave text, p_order text, p_esito text, p_cartella text, p_sorgente text, p_files int)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not _tc_chiave_automazione_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  insert into dtf_preparati (order_id, esito, cartella, sorgente, files) values (p_order, p_esito, p_cartella, p_sorgente, coalesce(p_files, 0))
  on conflict (order_id) do nothing;
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_dtf_preparato(text, text, text, text, text, int) from public;
grant execute on function tc_dtf_preparato(text, text, text, text, text, int) to anon, authenticated;

-- I dati del Mac mini includono gli ordini da preparare
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
    'da_preparare', _tc_dtf_da_preparare(),
    'items', coalesce((select jsonb_object_agg(o.id, coalesce(o.dtf_items, '[]'::jsonb))
       from orders o where o.deleted_at is null
        and o.id in (select x->>'id' from jsonb_array_elements(v_lista) x)), '{}'::jsonb));
end;
$$;
