-- ════════════════════════════════════════════════════════
-- T&C Factory — Task delle mail: chiusura quando si è già risposto
--
-- Il team risponde anche dal programma di posta, non solo da CS. mail-sync legge
-- la posta inviata e salva quelle mail come direzione 'out'; qui i task aperti
-- nati da una mail si chiudono quando c'è una risposta nella stessa conversazione,
-- indirizzata a chi aveva scritto (un inoltro a un collega o a un fornitore non conta).
--
-- Gira a parte da mail-sync perché il task può nascere dopo che la risposta è
-- già stata letta. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_caselle add column if not exists inviata_uidvalidity bigint;
alter table mail_caselle add column if not exists inviata_ultimo_uid  bigint;

create index if not exists mail_messaggi_out_idx on mail_messaggi (casella_id) where direzione = 'out';

create or replace function _tc_mail_risposte_chiudi()
returns void security definer set search_path = public language plpgsql as $$
begin
  update tasks t
     set stato = 'completato',
         risposta_inviata_at = r.quando,
         motivo = 'Risposta trovata nella posta inviata'
    from (
      select a.id, min(o.ricevuto_at) as quando
        from tasks a
        join mail_messaggi m on m.id = a.mail_id and m.message_id is not null and m.da_email is not null
        join mail_messaggi o on o.casella_id = m.casella_id and o.direzione = 'out'
                            and (o.in_reply_to = m.message_id or position(m.message_id in coalesce(o.riferimenti, '')) > 0)
                            and position(lower(m.da_email) in lower(coalesce(o.a, ''))) > 0
       where a.stato not in ('completato', 'non_completato')
         and a.risposta_inviata_at is null      -- invio da CS in corso: lo chiude mail-send a nome di chi invia
       group by a.id
    ) r
   where t.id = r.id;
end;
$$;
revoke execute on function _tc_mail_risposte_chiudi() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mail-risposte') then
    perform cron.unschedule('mail-risposte');
  end if;
  perform cron.schedule('mail-risposte', '4-59/5 * * * *', 'select _tc_mail_risposte_chiudi()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
