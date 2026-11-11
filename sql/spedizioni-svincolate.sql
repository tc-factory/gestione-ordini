-- ════════════════════════════════════════════════════════
-- T&C Factory — Spedizioni svincolate
--
-- Dopo lo svincolo GLS continua a mostrare "in giacenza" finché il deposito non rimette in
-- consegna il pacco (di solito il giorno lavorativo dopo). Qui si ricorda lo svincolo, così il
-- gestionale non la tratta più come un problema da seguire: torna un problema solo se GLS
-- registra un nuovo evento dopo lo svincolo e la spedizione è ancora ferma.
-- Richiede tracking-gls.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table spedizioni_tracking add column if not exists svincolata_at timestamptz;
alter table spedizioni_tracking add column if not exists svincolo_tipo text;

-- Svincoli già mandati prima di questa modifica
update spedizioni_tracking k
   set svincolata_at = e.fine, svincolo_tipo = e.tipo
  from (select distinct on (riepilogo->>'tracking') riepilogo->>'tracking' tracking, riepilogo->>'tipo' tipo, fine
          from automazione_esecuzioni where nome = 'svincolo-gls' and stato = 'ok' order by riepilogo->>'tracking', fine desc) e
 where k.numero = e.tracking and k.svincolata_at is null;

-- Scheda GLS del Centro di controllo: le spedizioni con problemi o ritardi, con cliente e task aperto.
-- svincolata: istruzioni mandate a GLS e nessun evento nuovo dopo, si aspetta che il pacco riparta.
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
      'task_id', t.id, 'fare', t.descrizione,
      'svincolata', k.stato = 'problema' and k.svincolata_at is not null and (k.ultimo_at is null or k.ultimo_at <= k.svincolata_at),
      'svincolata_at', k.svincolata_at, 'svincolo_tipo', k.svincolo_tipo
    ) order by k.stato, k.spedito_at)
      from spedizioni_tracking k
      join shopify_orders o on o.id = k.ordine_id
      left join tasks t on t.fonte_rif->>'evento_id' = 'consegna:' || k.ordine_id and t.stato not in ('completato', 'non_completato')
     where k.stato in ('problema', 'ritardo') and o.annullato_at is null
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_spedizioni_problemi() from public, anon;
grant  execute on function tc_spedizioni_problemi() to authenticated;
