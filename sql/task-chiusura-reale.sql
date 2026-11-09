-- ════════════════════════════════════════════════════════
-- T&C Factory — I task si chiudono quando il lavoro è fatto, non quando si risponde
--
--   • task_tipi.chiude_con_risposta: false per i tipi in cui rispondere al cliente
--     non basta (modifiche, resi, problemi): la risposta si registra, il task resta aperto
--   • cambio indirizzo: si chiude da solo quando l'indirizzo dell'ordine cambia su Shopify.
--     Vale solo per i task con analisi.modifica = 'indirizzo' e il numero d'ordine nel
--     titolo: analisi.ordini contiene tutti gli ordini del cliente, non solo quello chiesto.
--
-- Richiede mail-risposte-inviata.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_tipi add column if not exists chiude_con_risposta boolean not null default true;
update task_tipi set chiude_con_risposta = false
 where nome in ('Modifica ordine', 'Reso o cambio', 'Problema con un ordine');

-- La bozza del cervello non è il testo inviato quando si è risposto dal programma di posta
alter table tasks add column if not exists risposta_fuori_cs boolean not null default false;

create or replace function _tc_mail_risposte_chiudi()
returns void security definer set search_path = public language plpgsql as $$
begin
  update tasks t
     set risposta_inviata_at = r.quando,
         risposta_fuori_cs = true,
         stato  = case when r.chiude then 'completato' else t.stato end,
         motivo = case when r.chiude then 'Risposta trovata nella posta inviata' else t.motivo end
    from (
      select a.id, min(o.ricevuto_at) as quando, coalesce(bool_and(p.chiude_con_risposta), true) as chiude
        from tasks a
        left join task_tipi p on p.id = a.tipo_id
        join mail_messaggi m on m.id = a.mail_id and m.message_id is not null and m.da_email is not null
        join mail_messaggi o on o.casella_id = m.casella_id and o.direzione = 'out'
                            and (o.in_reply_to = m.message_id or position(m.message_id in coalesce(o.riferimenti, '')) > 0)
                            and position(lower(m.da_email) in lower(coalesce(o.a, ''))) > 0
       where a.stato not in ('completato', 'non_completato')
         and a.risposta_inviata_at is null      -- invio da CS in corso: lo gestisce mail-send
       group by a.id
    ) r
   where t.id = r.id;
end;
$$;
revoke execute on function _tc_mail_risposte_chiudi() from public, anon, authenticated;

create or replace function _tc_indirizzo_cambiato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tasks t
     set stato = 'completato', motivo = 'Indirizzo dell''ordine cambiato su Shopify'
   where t.stato not in ('completato', 'non_completato')
     and t.analisi->>'modifica' = 'indirizzo'
     and t.analisi->'ordini' @> jsonb_build_array(jsonb_build_object('negozio', new.store_id, 'numero', new.numero))
     and position(new.numero in t.titolo) > 0;
  return null;
end;
$$;
revoke execute on function _tc_indirizzo_cambiato() from public, anon, authenticated;

drop trigger if exists shopify_orders_indirizzo on shopify_orders;
create trigger shopify_orders_indirizzo after update of indirizzo on shopify_orders for each row
  when (old.indirizzo is distinct from new.indirizzo) execute function _tc_indirizzo_cambiato();

-- Task già aperti di solo cambio indirizzo (quelli nuovi li marca il cervello)
update tasks set analisi = coalesce(analisi, '{}'::jsonb) || '{"modifica": "indirizzo"}'::jsonb
 where id = '7ceab18b-11ad-41ad-9c6d-a50e54050aa5';

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
