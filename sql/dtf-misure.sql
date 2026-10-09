-- ════════════════════════════════════════════════════════
-- T&C Factory — DTF: misure dei file
-- Ogni giorno salva, oltre ai nomi (dettaglio), l'elenco strutturato dei file:
-- [{ name, w_cm, h_cm, pz, metri, fonte, dpi_ipotizzato }]
-- I metri del giorno sono la somma dei metri dei file.
-- Il portale del cliente restituisce anche le misure.
-- Non distruttivo, si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table dtf_entries add column if not exists files jsonb not null default '[]';

-- Larghezza del rotolo e margine tra i pezzi (modificabili dalle Impostazioni)
insert into app_settings (key, value) values ('dtf_roll_cm', '57'), ('dtf_margin_cm', '0.5')
on conflict (key) do nothing;

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

  select * into c from dtf_clients where id = a.client_id;
  return jsonb_build_object(
    'success', true,
    'cliente', jsonb_build_object('nome', c.nome, 'costo_metro', c.costo_metro),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('giorno', e.giorno, 'metri', e.metri, 'dettaglio', e.dettaglio, 'files', e.files) order by e.giorno)
        from dtf_entries e
       where e.client_id = a.client_id and e.giorno between v_from and v_to
    ), '[]'::jsonb)
  );
end; $$;

revoke execute on function dtf_portal_get(text, text, date, date) from public;
grant  execute on function dtf_portal_get(text, text, date, date) to anon, authenticated;
