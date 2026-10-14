-- ════════════════════════════════════════════════════════
-- T&C Factory — Portale DTF: dati visibili "dal giorno…"
-- Per ogni cliente si può scegliere da che giorno il link mostra i dati:
-- prima di quella data il portale non restituisce nulla.
-- Il portale restituisce anche i file con la loro eventuale tariffa diversa
-- (campo files, vedi dtf-misure.sql).
-- Richiede dtf-portale.sql e dtf-misure.sql. Non distruttivo, si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table dtf_client_access add column if not exists visibile_dal date;

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
  return jsonb_build_object('success', true, 'token', v.token, 'has_password', v.password_hash is not null,
                            'visibile_dal', v.visibile_dal);
end; $$;

-- null = il cliente vede tutto lo storico
create or replace function dtf_set_visibile_dal(p_client_id uuid, p_dal date)
returns jsonb security definer set search_path = public, extensions language plpgsql as $$
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Non autorizzato'); end if;
  if not exists (select 1 from dtf_clients where id = p_client_id) then
    return jsonb_build_object('success', false, 'error', 'Cliente non trovato');
  end if;
  insert into dtf_client_access (client_id, visibile_dal) values (p_client_id, p_dal)
  on conflict (client_id) do update set visibile_dal = excluded.visibile_dal, updated_at = now();
  return dtf_access_info(p_client_id);
end; $$;

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

  if v_to < v_from or v_to - v_from > 92 then v_to := v_from + 92; end if;
  -- Niente prima della data scelta dallo staff
  if a.visibile_dal is not null and v_from < a.visibile_dal then v_from := a.visibile_dal; end if;

  select * into c from dtf_clients where id = a.client_id;
  return jsonb_build_object(
    'success', true,
    'cliente', jsonb_build_object('nome', c.nome, 'costo_metro', c.costo_metro),
    'visibile_dal', a.visibile_dal,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('giorno', e.giorno, 'metri', e.metri, 'dettaglio', e.dettaglio, 'files', e.files) order by e.giorno)
        from dtf_entries e
       where e.client_id = a.client_id and e.giorno between v_from and v_to
    ), '[]'::jsonb)
  );
end; $$;

revoke execute on function dtf_access_info(uuid), dtf_set_visibile_dal(uuid, date) from public, anon;
grant  execute on function dtf_access_info(uuid), dtf_set_visibile_dal(uuid, date) to authenticated;
revoke execute on function dtf_portal_get(text, text, date, date) from public;
grant  execute on function dtf_portal_get(text, text, date, date) to anon, authenticated;
