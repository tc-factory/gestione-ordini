-- ════════════════════════════════════════════════════════
-- T&C Factory — Portale DTF per i clienti conto terzi (sola lettura)
--
-- Ogni cliente DTF può avere una password e un link personale.
-- Con link + password il cliente vede SOLO la propria tabella (metri e
-- dettaglio dei file per ogni giorno), senza poter modificare nulla.
--
-- • Credenziali in una tabella separata, non leggibile da nessuno:
--   si usano solo tramite le funzioni qui sotto.
-- • Password cifrata (bcrypt), mai restituita.
-- • 5 tentativi sbagliati → link bloccato per 15 minuti.
-- Richiede dtf-setup.sql e sicurezza-1-prepara.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists dtf_client_access (
  client_id        uuid primary key references dtf_clients(id) on delete cascade,
  token            text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  password_hash    text,
  failed_attempts  int not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);

alter table dtf_client_access enable row level security;   -- nessuna policy: accesso diretto negato
revoke all on dtf_client_access from anon, authenticated;

-- ─────────────────────────────────────────────
-- Staff: stato del link, impostazione password, nuovo link
-- ─────────────────────────────────────────────

create or replace function dtf_access_info(p_client_id uuid)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
declare v dtf_client_access;
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  if not exists (select 1 from dtf_clients where id = p_client_id) then
    return jsonb_build_object('success', false, 'error', 'Cliente non trovato');
  end if;
  insert into dtf_client_access (client_id) values (p_client_id) on conflict (client_id) do nothing;
  select * into v from dtf_client_access where client_id = p_client_id;
  return jsonb_build_object('success', true, 'token', v.token, 'has_password', v.password_hash is not null);
end; $$;

create or replace function dtf_set_password(p_client_id uuid, p_password text)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  if length(coalesce(p_password, '')) < 8 then
    return jsonb_build_object('success', false, 'error', 'La password deve avere almeno 8 caratteri');
  end if;
  if not exists (select 1 from dtf_clients where id = p_client_id) then
    return jsonb_build_object('success', false, 'error', 'Cliente non trovato');
  end if;
  insert into dtf_client_access (client_id, password_hash)
  values (p_client_id, crypt(p_password, gen_salt('bf')))
  on conflict (client_id) do update
    set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null, updated_at = now();
  return dtf_access_info(p_client_id);
end; $$;

-- Nuovo link: quello vecchio smette subito di funzionare
create or replace function dtf_regenerate_link(p_client_id uuid)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  insert into dtf_client_access (client_id) values (p_client_id) on conflict (client_id) do nothing;
  update dtf_client_access
     set token = encode(gen_random_bytes(24), 'hex'), failed_attempts = 0, locked_until = null, updated_at = now()
   where client_id = p_client_id;
  return dtf_access_info(p_client_id);
end; $$;

-- ─────────────────────────────────────────────
-- Cliente (pubblico): link + password → solo i propri dati, in lettura
-- ─────────────────────────────────────────────

create or replace function dtf_portal_get(p_token text, p_password text, p_from date, p_to date)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
declare
  a dtf_client_access;
  c dtf_clients;
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
begin
  select * into a from dtf_client_access where token = p_token;
  if not found or a.password_hash is null then
    perform pg_sleep(0.4);
    return jsonb_build_object('success', false, 'error', 'Link o password non validi');
  end if;

  if a.locked_until is not null and a.locked_until > now() then
    return jsonb_build_object('success', false, 'error', 'Troppi tentativi sbagliati: riprova tra qualche minuto');
  end if;

  if a.password_hash != crypt(coalesce(p_password, ''), a.password_hash) then
    update dtf_client_access
       set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
     where client_id = a.client_id;
    perform pg_sleep(0.4);
    return jsonb_build_object('success', false, 'error', 'Link o password non validi');
  end if;

  if a.failed_attempts > 0 then
    update dtf_client_access set failed_attempts = 0, locked_until = null where client_id = a.client_id;
  end if;

  -- Al massimo un trimestre per richiesta
  if v_to < v_from or v_to - v_from > 92 then v_to := v_from + 92; end if;

  select * into c from dtf_clients where id = a.client_id;
  return jsonb_build_object(
    'success', true,
    'cliente', jsonb_build_object('nome', c.nome, 'costo_metro', c.costo_metro),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('giorno', e.giorno, 'metri', e.metri, 'dettaglio', e.dettaglio) order by e.giorno)
        from dtf_entries e
       where e.client_id = a.client_id and e.giorno between v_from and v_to
    ), '[]'::jsonb)
  );
end; $$;

revoke execute on function dtf_access_info(uuid), dtf_set_password(uuid, text), dtf_regenerate_link(uuid) from public, anon;
grant  execute on function dtf_access_info(uuid), dtf_set_password(uuid, text), dtf_regenerate_link(uuid) to authenticated;
revoke execute on function dtf_portal_get(text, text, date, date) from public;
grant  execute on function dtf_portal_get(text, text, date, date) to anon, authenticated;
