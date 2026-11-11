-- ════════════════════════════════════════════════════════
-- T&C Factory — Sezione Mail (2026-11-11)
--
-- Le mail di tutte le caselle, lette da mail-sync, si leggono e si rispondono
-- dal gestionale (js/mail.js). Le mail sono raggruppate in conversazioni:
--   • mail_messaggi.filo: primo Message-ID della conversazione (References,
--     poi In-Reply-To, poi il proprio Message-ID)
--   • letta_at / letta_da: lettura condivisa dal team (una casella, un solo stato)
--
-- Accesso: chi vede la scheda "mail" (Impostazioni → Account), non solo l'admin.
-- La tabella resta chiusa: si passa solo da queste funzioni.
-- Richiede mail.sql, mail-risposte-inviata.sql e account-permessi.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_messaggi add column if not exists letta_at timestamptz;
alter table mail_messaggi add column if not exists letta_da text;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'mail_messaggi' and column_name = 'filo') then
    alter table mail_messaggi add column filo text generated always as (coalesce(
      substring(riferimenti from '<[^>]+>'),
      substring(in_reply_to from '<[^>]+>'),
      message_id,
      id::text)) stored;

    -- Prima volta: già lette le inviate, le automatiche e quelle già gestite (task chiuso o risposta data)
    update mail_messaggi m set letta_at = now(), letta_da = 'sistema'
     where m.letta_at is null and (
       m.direzione = 'out' or m.automatica
       or exists (select 1 from tasks t where t.mail_id = m.id and t.stato in ('completato', 'non_completato'))
       or exists (select 1 from mail_messaggi o where o.casella_id = m.casella_id and o.direzione = 'out'
                    and m.message_id is not null and o.in_reply_to = m.message_id));
  end if;
end $$;

create index if not exists mail_messaggi_filo_idx on mail_messaggi (casella_id, filo);
create index if not exists mail_messaggi_non_lette_idx on mail_messaggi (casella_id) where letta_at is null and direzione = 'in' and not automatica;

-- Chi può aprire una scheda: admin, account senza limiti (schede null) o con la scheda nel ruolo/elenco
create or replace function app_vede_scheda(p_scheda text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users u left join app_roles r on r.id = u.ruolo_id
     where u.auth_id = auth.uid()
       and (u.is_admin or case when u.ruolo_id is not null then coalesce(r.schede, '[]'::jsonb) ? p_scheda
                               else u.schede is null or u.schede ? p_scheda end)
  );
$$;
revoke execute on function app_vede_scheda(text) from public, anon;
grant  execute on function app_vede_scheda(text) to authenticated;

-- Caselle con le conversazioni da leggere
create or replace function tc_mail_caselle()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'caselle', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'indirizzo', c.indirizzo, 'nome', c.nome, 'attiva_dal', c.attiva_dal,
      'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore,
      'non_lette', (select count(distinct m.filo) from mail_messaggi m
                     where m.casella_id = c.id and m.direzione = 'in' and not m.automatica and m.letta_at is null)
    ) order by c.nome) from mail_caselle c where c.attivo
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_caselle() from public, anon;
grant  execute on function tc_mail_caselle() to authenticated;

-- Elenco delle conversazioni, dalla più recente
--   p_vista: 'arrivo' (scritte da persone), 'inviate' (con una nostra risposta), 'automatiche', 'da_leggere'
--   p_prima: per caricare le successive (ultima data già mostrata)
create or replace function tc_mail_lista(p_casella text, p_vista text, p_cerca text, p_prima timestamptz, p_limite int default 50)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_cerca text := nullif(trim(coalesce(p_cerca, '')), '');
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'fili', coalesce((
    select jsonb_agg(x.f order by x.ultima desc) from (
      select jsonb_build_object(
        'casella_id', m.casella_id,
        'filo', m.filo,
        'ultima_at', max(m.ricevuto_at),
        'oggetto', (array_agg(m.oggetto order by m.ricevuto_at))[1],
        -- Chi è dall'altra parte: l'ultimo che ci ha scritto, o il destinatario della nostra mail
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
          when 'arrivo'      then bool_or(m.direzione = 'in' and not m.automatica)
          when 'da_leggere'  then bool_or(m.direzione = 'in' and not m.automatica and m.letta_at is null)
          when 'inviate'     then bool_or(m.direzione = 'out')
          when 'automatiche' then bool_or(m.direzione = 'in') and bool_and(m.automatica or m.direzione = 'out')
          else true end
        and (p_prima is null or max(m.ricevuto_at) < p_prima)
        and (v_cerca is null or bool_or(
              m.oggetto ilike '%' || v_cerca || '%' or m.da_email ilike '%' || v_cerca || '%'
              or m.da_nome ilike '%' || v_cerca || '%' or m.a ilike '%' || v_cerca || '%'
              or m.testo ilike '%' || v_cerca || '%'))
      order by max(m.ricevuto_at) desc
      limit least(greatest(coalesce(p_limite, 50), 1), 200)
    ) x
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_lista(text, text, text, timestamptz, int) from public, anon;
grant  execute on function tc_mail_lista(text, text, text, timestamptz, int) to authenticated;

-- Una conversazione: messaggi in ordine e task collegati. Aprirla la segna letta.
create or replace function tc_mail_filo(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_messaggi jsonb;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;

  select jsonb_agg(jsonb_build_object(
           'id', m.id, 'direzione', m.direzione, 'da_email', m.da_email, 'da_nome', m.da_nome, 'a', m.a,
           'oggetto', m.oggetto, 'ricevuto_at', m.ricevuto_at, 'testo', m.testo, 'testo_citato', m.testo_citato,
           'allegati', m.allegati, 'automatica', m.automatica, 'message_id', m.message_id,
           'letta_at', m.letta_at, 'letta_da', m.letta_da) order by m.ricevuto_at)
    into v_messaggi
    from mail_messaggi m where m.casella_id = p_casella and m.filo = p_filo;
  if v_messaggi is null then return jsonb_build_object('success', false, 'error', 'Conversazione non trovata'); end if;

  update mail_messaggi set letta_at = now(), letta_da = app_nickname()
   where casella_id = p_casella and filo = p_filo and letta_at is null;

  return jsonb_build_object('success', true, 'messaggi', v_messaggi, 'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'titolo', t.titolo, 'stato', t.stato, 'assegnato_a', t.assegnato_a, 'mail_id', t.mail_id,
             'bozza_risposta', t.bozza_risposta, 'risposta_inviata_at', t.risposta_inviata_at) order by t.created_at)
      from tasks t join mail_messaggi m on m.id = t.mail_id
     where m.casella_id = p_casella and m.filo = p_filo
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_filo(text, text) from public, anon;
grant  execute on function tc_mail_filo(text, text) to authenticated;

-- Rimette da leggere una conversazione (le mail ricevute)
create or replace function tc_mail_da_leggere(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  update mail_messaggi set letta_at = null, letta_da = null
   where casella_id = p_casella and filo = p_filo and direzione = 'in';
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_mail_da_leggere(text, text) from public, anon;
grant  execute on function tc_mail_da_leggere(text, text) to authenticated;

-- Numero per la navbar: conversazioni con mail da leggere scritte da persone
create or replace function tc_mail_badge()
returns int security definer set search_path = public language sql stable as $$
  select case when app_vede_scheda('mail') then (
    select count(distinct (m.casella_id, m.filo))::int from mail_messaggi m
     join mail_caselle c on c.id = m.casella_id and c.attivo
     where m.direzione = 'in' and not m.automatica and m.letta_at is null)
  else 0 end;
$$;
revoke execute on function tc_mail_badge() from public, anon;
grant  execute on function tc_mail_badge() to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
