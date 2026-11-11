-- ════════════════════════════════════════════════════════
-- T&C Factory — Bozze di mail da confermare e casella info@tcfactory.it (2026-11-11)
--
--   • mail_caselle.interna: casella dell'azienda (non di un negozio), solo per inviare.
--     Non si legge (mail-sync la salta) e nei testi "T&C Factory" resta com'è.
--   • casella 'tcfactory' = info@tcfactory.it (Aruba). Password nel secret MAIL_PASSWORD_TCFACTORY.
--   • mail_bozze: mail nuove preparate per una persona; le vede in Mail → Bozze, le controlla e le invia.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_caselle add column if not exists interna boolean not null default false;

insert into mail_caselle (id, indirizzo, nome, store_id, imap_host, smtp_host, attivo, attiva_dal, interna)
values ('tcfactory', 'info@tcfactory.it', 'T&C Factory', null, 'imaps.aruba.it', 'smtps.aruba.it', true, now(), true)
on conflict (id) do nothing;

create table if not exists mail_bozze (
  id           uuid primary key default gen_random_uuid(),
  per          text not null,                 -- nickname di chi la deve controllare e inviare
  casella_id   text not null references mail_caselle(id),
  a            text not null,
  a_nome       text,
  oggetto      text not null,
  testo        text not null,
  nota         text,                          -- perché è stata preparata (solo per chi la invia)
  creata_da    text not null default 'claude',
  created_at   timestamptz not null default now(),
  inviata_at   timestamptz,
  inviata_da   text
);
create index if not exists mail_bozze_per_idx on mail_bozze (per) where inviata_at is null;
alter table mail_bozze enable row level security;
revoke all on mail_bozze from anon, authenticated;   -- solo dalle funzioni qui sotto e dal servizio

-- Bozze da inviare della persona collegata
create or replace function tc_mail_bozze()
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_me text;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  select nickname into v_me from app_users where auth_id = auth.uid();
  return jsonb_build_object('success', true, 'bozze', coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'casella_id', b.casella_id, 'a', b.a, 'a_nome', b.a_nome,
      'oggetto', b.oggetto, 'testo', b.testo, 'nota', b.nota, 'created_at', b.created_at) order by b.created_at, b.a)
    from mail_bozze b where b.per = v_me and b.inviata_at is null
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_bozze() from public, anon;
grant  execute on function tc_mail_bozze() to authenticated;

-- Scartare una bozza (solo la propria)
create or replace function tc_mail_bozza_scarta(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text;
begin
  select nickname into v_me from app_users where auth_id = auth.uid();
  delete from mail_bozze where id = p_id and per = v_me and inviata_at is null;
  if not found then return jsonb_build_object('success', false, 'error', 'Bozza non trovata'); end if;
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_mail_bozza_scarta(uuid) from public, anon;
grant  execute on function tc_mail_bozza_scarta(uuid) to authenticated;

-- Le caselle interne non si leggono: niente avvisi "non controllata" (Centro di controllo, Collegamenti, mattino)
CREATE OR REPLACE FUNCTION public._tc_problemi()
 RETURNS TABLE(chiave text, testo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'shopify:' || id, 'Shopify ' || nome || ': ' || coalesce(ultimo_errore, 'nessun aggiornamento da più di 20 minuti')
    from shopify_stores where attivo and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'mail:' || id, 'Casella ' || indirizzo || ': ' || coalesce(ultimo_errore, 'nessun controllo da più di 20 minuti')
    from mail_caselle where attivo and not interna and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'cervello', 'Cervello: ' || count(*) || ' mail in attesa da più di 30 minuti'
    from eventi where fonte = 'mail' and elaborato_at is null and ricevuto_at < now() - interval '30 minutes'
  having count(*) > 0
  union all
  select 'tracking', 'Tracking GLS: nessun controllo da più di 2 ore, in orario di lavoro'
   where exists (select 1 from spedizioni_tracking) and (select max(controllata_at) from spedizioni_tracking) < now() - interval '2 hours'
     and extract(hour from now() at time zone 'Europe/Rome') between 9 and 17
  union all
  select 'tracking-lettura', 'Tracking GLS: ' || count(*) || ' spedizioni senza dati, la pagina GLS potrebbe essere cambiata'
    from spedizioni_tracking where stato = 'senza_dati' and controllata_at > now() - interval '2 hours'
  having count(*) > 40;
$function$;
CREATE OR REPLACE FUNCTION public.tc_mail_stato()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'caselle', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'indirizzo', c.indirizzo, 'nome', c.nome, 'attivo', c.attivo, 'attiva_dal', c.attiva_dal,
      'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore,
      'ricevute', (select count(*) from mail_messaggi m where m.casella_id = c.id and m.direzione = 'in'),
      'da_persone', (select count(*) from mail_messaggi m where m.casella_id = c.id and m.direzione = 'in' and not m.automatica)
    ) order by c.nome) from mail_caselle c where not c.interna
  ), '[]'::jsonb));
end;
$function$;
CREATE OR REPLACE FUNCTION public.tc_mattino_dati(p_chiave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_oggi date := tc_oggi();
begin
  if not _tc_chiave_automazione_ok(p_chiave) then
    return jsonb_build_object('success', false, 'error', 'Chiave non valida');
  end if;
  return jsonb_build_object(
    'success', true,
    'lavorativo', tc_giorno_lavorativo(v_oggi),
    'motivo', case when extract(isodow from v_oggi) >= 6 then 'Weekend'
                   when tc_festivo(v_oggi) then 'Festivo'
                   when tc_chiuso(v_oggi) then 'Chiusura: ' || (select string_agg(title, ', ') from calendar_events where event_type = 'chiusura' and v_oggi between date_from and date_to) end,
    'negozi', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nome', s.nome, 'dominio', s.dominio, 'token', t.access_token, 'token_scade', t.scade_at))
      from shopify_stores s left join shopify_tokens t on t.store_id = s.id where s.attivo), '[]'::jsonb),
    'modifiche', coalesce((select jsonb_agg(jsonb_build_object(
        'negozio', k.macroarea, 'titolo', k.titolo, 'descrizione', k.descrizione, 'creato', k.created_at,
        'ordini', coalesce((select jsonb_agg(o->>'numero') from jsonb_array_elements(
                     case when jsonb_typeof(k.analisi->'ordini') = 'array' then k.analisi->'ordini' else '[]'::jsonb end) o), '[]'::jsonb)))
      from tasks k join task_tipi p on p.id = k.tipo_id
      where p.nome = 'Modifica ordine' and k.stato not in ('completato', 'non_completato')), '[]'::jsonb),
    'caselle', coalesce((select jsonb_agg(jsonb_build_object(
        'indirizzo', c.indirizzo, 'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore))
      from mail_caselle c where not c.interna), '[]'::jsonb));
end;
$function$;
