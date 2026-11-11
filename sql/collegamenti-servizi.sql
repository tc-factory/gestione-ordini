-- Collegamenti: tutti i servizi esterni (GLS, Claude, mappe, invio mail, Mac mini) e le operazioni pianificate.
-- Avviso "pagina GLS cambiata" solo se mancano i dati di spedizioni partite prima di oggi:
-- quelle di oggi non hanno dati finché GLS non le ritira, ed è normale.

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
  select 'tracking-lettura', 'Tracking GLS: ' || count(*) filter (where stato = 'senza_dati')
       || ' spedizioni dei giorni scorsi senza dati, la pagina GLS potrebbe essere cambiata'
    from spedizioni_tracking
   where controllata_at > now() - interval '2 hours' and stato <> 'consegnata'
     and (spedito_at at time zone 'Europe/Rome')::date < (now() at time zone 'Europe/Rome')::date
  having count(*) filter (where stato = 'senza_dati') >= 10
     and count(*) filter (where stato = 'senza_dati') * 2 >= count(*)
  union all
  select 'cron:' || j.jobname, 'Operazione pianificata ' || j.jobname || ': ' || coalesce(left(d.return_message, 120), 'non riuscita')
    from cron.job j
    join lateral (select * from cron.job_run_details r where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
   where j.active and d.status = 'failed';
$function$;

-- Stato di tutti i servizi esterni e delle operazioni pianificate (scheda Collegamenti, solo admin)
CREATE OR REPLACE FUNCTION public.tc_collegamenti_servizi()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  oggi date := (now() at time zone 'Europe/Rome')::date;
  servizi jsonb := '[]'::jsonb;
  r record;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;

  -- GLS tracking
  select max(controllata_at) ultimo,
         count(*) filter (where stato not in ('consegnata')) seguite,
         count(*) filter (where stato = 'in_viaggio') viaggio,
         count(*) filter (where stato in ('problema', 'ritardo')) problemi,
         count(*) filter (where stato = 'senza_dati' and (spedito_at at time zone 'Europe/Rome')::date = oggi) oggi_n,
         count(*) filter (where stato = 'senza_dati' and (spedito_at at time zone 'Europe/Rome')::date < oggi) vecchie
    into r from spedizioni_tracking where controllata_at > now() - interval '1 day';
  servizi := servizi || jsonb_build_object(
    'id', 'gls-tracking', 'nome', 'GLS · tracking', 'sotto', 'Webservice codici 2067 e 5456, poi pagina pubblica',
    'ultimo', r.ultimo, 'ogni', 'Ogni ora',
    'errore', (select testo from _tc_problemi() where chiave in ('tracking', 'tracking-lettura') limit 1),
    'dati', r.seguite || ' seguite · ' || r.viaggio || ' in viaggio · ' || r.problemi || ' con problemi'
            || case when r.oggi_n > 0 then ' · ' || r.oggi_n || ' partite oggi, in attesa del ritiro GLS' else '' end
            || case when r.vecchie > 0 then ' · ' || r.vecchie || ' dei giorni scorsi senza dati' else '' end);

  -- GLS svincolo giacenze
  select at, stato, riepilogo into r from automazione_esecuzioni where nome = 'svincolo-gls' order by at desc limit 1;
  servizi := servizi || jsonb_build_object(
    'id', 'gls-svincolo', 'nome', 'GLS · svincolo giacenze', 'sotto', 'Istruzioni di riconsegna a GLS (labelservice)',
    'ultimo', r.at, 'ogni', 'Quando serve',
    'errore', case when r.stato = 'errore' then coalesce(r.riepilogo->>'errore', 'Ultimo svincolo non riuscito') end,
    'dati', (select count(*) from spedizioni_tracking where svincolata_at > now() - interval '7 days') || ' svincolate negli ultimi 7 giorni');

  -- Claude (cervello)
  select max(at) ultimo,
         coalesce(sum(costo_usd) filter (where (at at time zone 'Europe/Rome')::date = oggi), 0) costo
    into r from cervello_consumi where at > now() - interval '2 days';
  servizi := servizi || jsonb_build_object(
    'id', 'claude', 'nome', 'Claude · cervello', 'sotto', 'Legge le mail e prepara task e risposte (Haiku filtra, Opus decide)',
    'ultimo', r.ultimo, 'ogni', 'Ogni 5 minuti',
    'errore', (select testo from _tc_problemi() where chiave = 'cervello' limit 1),
    'dati', (select count(*) from eventi where fonte = 'mail' and elaborato_at is null) || ' mail in attesa · $'
            || to_char(r.costo, 'FM990.00') || ' oggi');

  -- Mappe (riscontro indirizzi)
  select at, stato, riepilogo into r from automazione_esecuzioni where nome = 'verifica-indirizzi' order by at desc limit 1;
  servizi := servizi || jsonb_build_object(
    'id', 'mappe', 'nome', 'Mappe · riscontro indirizzi', 'sotto', 'Photon (OpenStreetMap) sugli ordini appena arrivati',
    'ultimo', r.at, 'ogni', 'All''arrivo degli ordini',
    'errore', case when r.stato = 'errore' then coalesce(r.riepilogo->>'errore', 'Ultimo riscontro non riuscito') end,
    'dati', coalesce((r.riepilogo->>'verificati') || ' ordini verificati · indirizzi corretti: ' || coalesce(r.riepilogo->>'corretti', '0'), '—')
            || ' all''ultimo giro');

  -- Invio mail (SMTP Aruba)
  servizi := servizi || jsonb_build_object(
    'id', 'smtp', 'nome', 'Aruba · invio mail', 'sotto', 'Risposte, mail automatiche e richieste dati',
    'ultimo', (select max(ricevuto_at) from mail_messaggi where direzione = 'out'), 'ogni', 'A ogni invio',
    'errore', null,
    'dati', (select count(*) from mail_messaggi where direzione = 'out' and (ricevuto_at at time zone 'Europe/Rome')::date = oggi) || ' inviate oggi');

  -- Mac mini: automazione del mattino
  select at, stato, riepilogo into r from automazione_esecuzioni where nome = 'mattino' and stato <> 'prova' order by at desc limit 1;
  servizi := servizi || jsonb_build_object(
    'id', 'mattino', 'nome', 'Mac mini · automazione del mattino', 'sotto', 'DDT, tag e file di stampa (Shopify e Customily)',
    'ultimo', r.at, 'ogni', 'Alle 5',
    'errore', case when r.stato = 'errore' then coalesce(r.riepilogo->>'errore', 'Ultimo giro non riuscito') end,
    'dati', coalesce((r.riepilogo->>'ordini') || ' ordini · ' || coalesce(r.riepilogo->>'tag', '0') || ' tag · '
            || coalesce(r.riepilogo->>'pagine_stampa', '0') || ' pagine di stampa', '—'));

  return jsonb_build_object('success', true, 'servizi', servizi, 'pianificate', coalesce((
    select jsonb_agg(jsonb_build_object('nome', j.jobname, 'schedule', j.schedule, 'attiva', j.active,
             'ultimo', d.start_time, 'stato', d.status, 'messaggio', case when d.status = 'failed' then left(d.return_message, 200) end)
           order by j.jobname)
      from cron.job j
      left join lateral (select * from cron.job_run_details x where x.jobid = j.jobid order by x.start_time desc limit 1) d on true), '[]'::jsonb));
end;
$function$;
revoke execute on function tc_collegamenti_servizi() from public, anon;
grant  execute on function tc_collegamenti_servizi() to authenticated;
