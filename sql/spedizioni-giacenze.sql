-- ════════════════════════════════════════════════════════
-- T&C Factory — Giacenze in evidenza nella scheda Spedizioni
--
-- tc_spedizioni_problemi restituisce anche quello che serve per gestire una giacenza senza
-- aprire altro: deposito GLS, da quando è ferma, tentativi falliti, giacenze precedenti,
-- indirizzo dell'ordine, avviso al cliente, stato del contatto (dal task della spedizione),
-- task con le istruzioni GLS proposte dalla risposta del cliente, ultimi eventi.
-- Richiede tracking-gls.sql, spedizioni-svincolate.sql, avviso-giacenza.sql, deposito-gls.sql.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

create or replace function tc_spedizioni_problemi()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'spedizioni', coalesce((
    select jsonb_agg(jsonb_build_object(
      'ordine_id', k.ordine_id, 'store_id', k.store_id, 'numero', k.numero, 'stato', k.stato, 'problema', k.problema,
      'ultimo_evento', k.ultimo_evento, 'ultimo_at', k.ultimo_at, 'spedito_at', k.spedito_at, 'controllata_at', k.controllata_at,
      'giorni_testo', case when k.spedito_at is not null then tc_testo_giorni((k.spedito_at at time zone 'Europe/Rome')::date, tc_oggi()) end,
      'ordine', o.numero, 'cliente', o.cliente, 'email', o.email, 'telefono', o.telefono, 'citta', o.indirizzo->>'citta',
      'indirizzo', o.indirizzo,
      'task_id', t.id, 'fare', t.descrizione,
      'svincolata', k.stato = 'problema' and k.svincolata_at is not null and (k.ultimo_at is null or k.ultimo_at <= k.svincolata_at),
      'di_nuovo_ferma', k.svincolata_at is not null and k.ultimo_at > k.svincolata_at,
      'svincolata_at', k.svincolata_at, 'svincolo_tipo', k.svincolo_tipo,
      'deposito', k.deposito,
      'avviso_cliente_at', k.avviso_cliente_at, 'avviso_cliente_esito', k.avviso_cliente_esito,
      'contatto', ct.analisi->'contatto',
      'task_svincolo_id', sv.id,
      'ferma_dal', g.ferma_dal,
      'ferma_testo', case when g.ferma_dal is not null then tc_testo_giorni((g.ferma_dal at time zone 'Europe/Rome')::date, tc_oggi()) end,
      'prima_giacenza_at', g.prima_giacenza_at, 'tentativi', g.tentativi, 'giacenze_n', g.giacenze_n,
      'eventi', coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(k.eventi) e limit 5) x), '[]'::jsonb)
    ) order by k.stato, k.spedito_at)
      from spedizioni_tracking k
      join shopify_orders o on o.id = k.ordine_id
      left join tasks t on t.fonte_rif->>'evento_id' = 'consegna:' || k.ordine_id and t.stato not in ('completato', 'non_completato')
      -- Contatto col cliente: dal task della spedizione più recente, anche se chiuso dallo svincolo
      left join lateral (select x.analisi from tasks x where x.fonte_rif->>'evento_id' = 'consegna:' || k.ordine_id
                          order by x.created_at desc limit 1) ct on true
      -- Risposta del cliente con le istruzioni per GLS ancora da mandare
      left join lateral (select x.id from tasks x where x.analisi->'svincolo'->>'tracking' = k.numero
                            and x.analisi->'svincolo'->>'stato' <> 'inviato' and x.stato not in ('completato', 'non_completato')
                          order by x.created_at desc limit 1) sv on true
      cross join lateral (
        -- Ferma dal primo evento di giacenza dopo l'ultimo evento di altro tipo (consegna tentata, transito…)
        select min((e->>'at')::timestamptz) filter (where e->>'codice' in ('66', '68', '3')
                 and (e->>'at')::timestamptz > coalesce((select max((y->>'at')::timestamptz) from jsonb_array_elements(k.eventi) y
                   where y->>'codice' is not null and y->>'codice' not in ('66', '68', '3')), '-infinity')) ferma_dal,
               min((e->>'at')::timestamptz) filter (where e->>'codice' in ('66', '68', '3')) prima_giacenza_at,
               count(*) filter (where e->>'codice' in ('1', '7')) tentativi,
               count(distinct left(e->>'at', 10)) filter (where e->>'codice' = '66') giacenze_n
          from jsonb_array_elements(k.eventi) e
      ) g
     where k.stato in ('problema', 'ritardo') and o.annullato_at is null
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_spedizioni_problemi() from public, anon;
grant  execute on function tc_spedizioni_problemi() to authenticated;
