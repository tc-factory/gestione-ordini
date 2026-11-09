-- ════════════════════════════════════════════════════════
-- T&C Factory — Mail automatica al cliente per giacenza o indirizzo errato GLS
--
-- tracking-check, quando trova una spedizione in giacenza o con indirizzo errato, scrive una
-- volta sola al cliente dalla casella del negozio (anche nel weekend). Qui si ricorda l'invio.
-- Richiede tracking-gls.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table spedizioni_tracking add column if not exists avviso_cliente_at timestamptz;
alter table spedizioni_tracking add column if not exists avviso_cliente_esito text;

-- Le spedizioni già ferme prima dell'automazione non ricevono la mail: si avvisa solo dai casi nuovi.
-- Eccezione chiesta dall'utente il 2026-11-09: ordine #6298 (Ciucciami), che riceve la mail.
update spedizioni_tracking k
   set avviso_cliente_at = now(), avviso_cliente_esito = 'non inviata: già ferma prima dell''automazione'
  from shopify_orders o
 where o.id = k.ordine_id
   and k.stato = 'problema' and k.problema in ('Giacenza in deposito GLS', 'Indirizzo errato')
   and k.avviso_cliente_at is null
   and not (o.store_id = 'ciucciamilcalzino' and o.numero = '#6298');
