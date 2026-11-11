-- ════════════════════════════════════════════════════════
-- T&C Factory — Tag delle conversazioni mail (2026-11-11)
--
--   • mail_tag: l'elenco dei tag. 'auto' = calcolati dal gestionale, 'manuale' = messi dal team.
--     L'admin può rinominarli, cambiare colore, spegnerli e aggiungere tag manuali.
--   • mail_filo_tag: i tag messi a mano su una conversazione
--   • _tc_mail_tag_auto: i tag automatici di una conversazione, calcolati al momento (scelte utente 2026-11-11):
--       argomento (categoria del cervello), Giacenza GLS, Rimborso,
--       Senza risposta (il cliente aspetta da 1 giorno lavorativo o più),
--       Aspetta il cliente (ultima mail nostra, nessuna risposta da 3 giorni lavorativi)
--
-- Richiede mail-archivio-firme-modelli.sql e automazioni-registro.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists mail_tag (
  id         text primary key check (id ~ '^[a-z0-9_]+$'),
  nome       text not null check (length(trim(nome)) between 1 and 40),
  colore     text not null default '#64748b' check (colore ~ '^#[0-9a-fA-F]{6}$'),
  tipo       text not null default 'manuale' check (tipo in ('auto', 'manuale')),
  attivo     boolean not null default true,
  ordine     int not null default 0,
  created_at timestamptz not null default now()
);
alter table mail_tag enable row level security;
drop policy if exists "Chi vede le mail legge i tag" on mail_tag;
drop policy if exists "Admin gestisce i tag" on mail_tag;
create policy "Chi vede le mail legge i tag" on mail_tag for select to authenticated using (app_vede_scheda('mail'));
create policy "Admin gestisce i tag" on mail_tag for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on mail_tag from anon;
grant select, insert, update, delete on mail_tag to authenticated;

insert into mail_tag (id, nome, colore, tipo, ordine) values
  ('senza_risposta',      'Senza risposta',     '#dc2626', 'auto', 1),
  ('aspetta_cliente',     'Aspetta il cliente', '#64748b', 'auto', 2),
  ('giacenza',            'Giacenza GLS',       '#d97706', 'auto', 3),
  ('rimborso',            'Rimborso',           '#be123c', 'auto', 4),
  ('arg_problema_ordine', 'Problema',           '#ef4444', 'auto', 10),
  ('arg_modifica_ordine', 'Modifica',           '#f97316', 'auto', 11),
  ('arg_stato_ordine',    'Stato ordine',       '#3b82f6', 'auto', 12),
  ('arg_reso_cambio',     'Reso o cambio',      '#8b5cf6', 'auto', 13),
  ('arg_preventivo',      'Preventivo',         '#0d9488', 'auto', 14),
  ('arg_pagamenti',       'Pagamento',          '#16a34a', 'auto', 15),
  ('arg_info_prodotto',   'Info prodotto',      '#0ea5e9', 'auto', 16),
  ('importante',          'Importante',         '#e11d48', 'manuale', 30),
  ('da_richiamare',       'Da richiamare',      '#7c3aed', 'manuale', 31),
  ('attesa_fornitore',    'In attesa fornitore','#a16207', 'manuale', 32)
on conflict (id) do nothing;

create table if not exists mail_filo_tag (
  casella_id text not null references mail_caselle(id) on delete cascade,
  filo       text not null,
  tag_id     text not null references mail_tag(id) on delete cascade,
  messo_da   text,
  messo_at   timestamptz not null default now(),
  primary key (casella_id, filo, tag_id)
);
alter table mail_filo_tag enable row level security;
revoke all on mail_filo_tag from anon, authenticated;   -- solo dalle funzioni qui sotto

-- Tag automatici di una conversazione (solo quelli accesi)
create or replace function _tc_mail_tag_auto(p_casella text, p_filo text)
returns text[] security definer set search_path = public language plpgsql stable as $$
declare
  v_ultima record; v_email text; v_store text; v_out text[] := '{}';
  v_oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  select m.id, m.direzione, m.ricevuto_at, m.automatica, coalesce(m.cartella_voluta, m.cartella) as cartella into v_ultima
    from mail_messaggi m where m.casella_id = p_casella and m.filo = p_filo order by m.ricevuto_at desc limit 1;
  if not found then return '{}'; end if;

  -- Argomento e rimborso: dai task che il cervello ha fatto nascere dalle mail della conversazione
  v_out := v_out || array(
    select distinct 'arg_' || case t.analisi->>'categoria' when 'bonifico' then 'pagamenti' else t.analisi->>'categoria' end
      from tasks t join mail_messaggi mm on mm.id = t.mail_id
     where mm.casella_id = p_casella and mm.filo = p_filo
       and coalesce(t.analisi->>'categoria', 'altro') not in ('altro', 'spam_phishing', 'nessuna_azione'));
  if exists (select 1 from tasks t join mail_messaggi mm on mm.id = t.mail_id
              where mm.casella_id = p_casella and mm.filo = p_filo and (t.analisi->>'rimborso')::boolean is true) then
    v_out := v_out || 'rimborso'::text;
  end if;

  -- Giacenza: un pacco del cliente fermo da GLS, non ancora consegnato
  select lower(m.da_email) into v_email from mail_messaggi m
   where m.casella_id = p_casella and m.filo = p_filo and m.direzione = 'in' and m.da_email is not null
   order by m.ricevuto_at desc limit 1;
  if v_email is null then
    select lower(trim(split_part(m.a, ',', 1))) into v_email from mail_messaggi m
     where m.casella_id = p_casella and m.filo = p_filo and m.direzione = 'out' order by m.ricevuto_at desc limit 1;
  end if;
  select store_id into v_store from mail_caselle where id = p_casella;
  if v_email is not null and exists (
    select 1 from spedizioni_tracking st join shopify_orders o on o.id = st.ordine_id
     where o.store_id = v_store and lower(o.email) = v_email and st.consegnata_at is null
       and st.problema in ('Giacenza in deposito GLS', 'Indirizzo errato', 'Prima consegna non riuscita',
                           'Seconda consegna non riuscita', 'Da ritirare al GLS Point')) then
    v_out := v_out || 'giacenza'::text;
  end if;

  -- Tempi, in giorni lavorativi (senza sabato, domenica, festivi e chiusure del Planner)
  -- Non conta se l'ultima mail è già gestita: task chiuso, o scartata dal cervello (un "grazie", spam)
  if v_ultima.direzione = 'in' and not v_ultima.automatica and v_ultima.cartella = 'inbox'
     and not exists (select 1 from tasks t where t.mail_id = v_ultima.id and t.stato in ('completato', 'non_completato'))
     and not exists (select 1 from eventi e where e.fonte = 'mail' and e.payload->>'mail_id' = v_ultima.id::text
                       and (e.esito like 'Scartata%' or e.esito like 'Segnata come spam%'))
     and tc_giorni_lavorativi((v_ultima.ricevuto_at at time zone 'Europe/Rome')::date, v_oggi) >= 1 then
    v_out := v_out || 'senza_risposta'::text;
  end if;
  if v_ultima.direzione = 'out'
     and not exists (select 1 from mail_messaggi m where m.casella_id = p_casella and m.filo = p_filo and m.direzione = 'in'
                       and coalesce(m.cartella_voluta, m.cartella) = 'cestino')
     and tc_giorni_lavorativi((v_ultima.ricevuto_at at time zone 'Europe/Rome')::date, v_oggi) >= 3 then
    v_out := v_out || 'aspetta_cliente'::text;
  end if;

  return array(select x from unnest(v_out) x join mail_tag t on t.id = x and t.attivo);
end;
$$;
revoke execute on function _tc_mail_tag_auto(text, text) from public, anon, authenticated;

-- Tutti i tag di una conversazione: automatici + manuali (accesi)
create or replace function _tc_mail_tag(p_casella text, p_filo text)
returns text[] security definer set search_path = public language sql stable as $$
  select _tc_mail_tag_auto(p_casella, p_filo) || coalesce(array(
    select ft.tag_id from mail_filo_tag ft join mail_tag t on t.id = ft.tag_id and t.attivo
     where ft.casella_id = p_casella and ft.filo = p_filo order by t.ordine), '{}');
$$;
revoke execute on function _tc_mail_tag(text, text) from public, anon, authenticated;

-- Elenco: ogni conversazione porta i suoi tag; p_tag filtra
drop function if exists tc_mail_lista(text, text, text, timestamptz, int);
create or replace function tc_mail_lista(p_casella text, p_vista text, p_cerca text, p_prima timestamptz, p_limite int default 50, p_tag text default null)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_cerca text := nullif(trim(coalesce(p_cerca, '')), '');
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'fili', coalesce((
    select jsonb_agg(z.f order by z.ultima desc) from (
    select y.f || jsonb_build_object('tag', to_jsonb(y.tag)) as f, y.ultima from (
      select x.f, x.ultima, _tc_mail_tag(x.casella_id, x.filo) as tag
      from (
        select m.casella_id, m.filo, jsonb_build_object(
          'casella_id', m.casella_id,
          'filo', m.filo,
          'ultima_at', max(m.ricevuto_at),
          'oggetto', (array_agg(m.oggetto order by m.ricevuto_at))[1],
          'persona', coalesce((array_agg(coalesce(nullif(m.da_nome, ''), m.da_email) order by m.ricevuto_at desc) filter (where m.direzione = 'in'))[1],
                              (array_agg(m.a order by m.ricevuto_at desc) filter (where m.direzione = 'out'))[1]),
          'email', coalesce((array_agg(m.da_email order by m.ricevuto_at desc) filter (where m.direzione = 'in'))[1],
                            (array_agg(m.a order by m.ricevuto_at desc) filter (where m.direzione = 'out'))[1]),
          'anteprima', left(regexp_replace(coalesce((array_agg(m.testo order by m.ricevuto_at desc) filter (where m.testo is not null))[1], ''), '\s+', ' ', 'g'), 220),
          'messaggi', count(*),
          'non_lette', count(*) filter (where m.direzione = 'in' and m.letta_at is null),
          'allegati', coalesce(sum(jsonb_array_length(m.allegati)), 0),
          'ultima_out', (array_agg(m.direzione order by m.ricevuto_at desc))[1] = 'out',
          'automatica', bool_and(m.automatica or m.direzione = 'out')
        ) as f, max(m.ricevuto_at) as ultima
        from mail_messaggi m
        where (p_casella is null or m.casella_id = p_casella)
        group by m.casella_id, m.filo
        having
          case coalesce(p_vista, 'arrivo')
            when 'arrivo'     then bool_or(m.direzione = 'in' and not m.automatica and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
            when 'da_leggere' then bool_or(m.direzione = 'in' and not m.automatica and m.letta_at is null and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
            when 'inviate'    then bool_or(m.direzione = 'out')
                                   and (not bool_or(m.direzione = 'in') or bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) <> 'cestino'))
            when 'archivio'   then bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) = 'archivio')
                                   and not bool_or(m.direzione = 'in' and not m.automatica and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
            when 'cestino'    then bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) = 'cestino')
                                   and not bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) <> 'cestino')
            else true end
          and (p_prima is null or max(m.ricevuto_at) < p_prima)
          and (v_cerca is null or bool_or(
                m.oggetto ilike '%' || v_cerca || '%' or m.da_email ilike '%' || v_cerca || '%'
                or m.da_nome ilike '%' || v_cerca || '%' or m.a ilike '%' || v_cerca || '%'
                or m.testo ilike '%' || v_cerca || '%'))
      ) x
    ) y
    where p_tag is null or p_tag = any(y.tag)
    order by y.ultima desc
    limit least(greatest(coalesce(p_limite, 50), 1), 200)
    ) z
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_lista(text, text, text, timestamptz, int, text) from public, anon;
grant  execute on function tc_mail_lista(text, text, text, timestamptz, int, text) to authenticated;

-- Tag della conversazione aperta
create or replace function tc_mail_tag_filo(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'auto', to_jsonb(_tc_mail_tag_auto(p_casella, p_filo)),
    'manuali', coalesce((select jsonb_agg(jsonb_build_object('id', ft.tag_id, 'messo_da', ft.messo_da, 'messo_at', ft.messo_at))
                           from mail_filo_tag ft where ft.casella_id = p_casella and ft.filo = p_filo), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_tag_filo(text, text) from public, anon;
grant  execute on function tc_mail_tag_filo(text, text) to authenticated;

-- Mette o toglie un tag manuale
create or replace function tc_mail_tag_set(p_casella text, p_filo text, p_tag text, p_on boolean)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  if not exists (select 1 from mail_tag where id = p_tag and tipo = 'manuale' and attivo) then
    return jsonb_build_object('success', false, 'error', 'I tag automatici li mette il gestionale');
  end if;
  if p_on then
    insert into mail_filo_tag (casella_id, filo, tag_id, messo_da) values (p_casella, p_filo, p_tag, app_nickname())
    on conflict do nothing;
  else
    delete from mail_filo_tag where casella_id = p_casella and filo = p_filo and tag_id = p_tag;
  end if;
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_mail_tag_set(text, text, text, boolean) from public, anon;
grant  execute on function tc_mail_tag_set(text, text, text, boolean) to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
