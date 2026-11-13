-- Metodo di spedizione dell'ordine (titolo della riga di spedizione su Shopify, es. "Ritiro in sede", "Ritiro in gara").
-- Con il ritiro non servono indirizzo e telefono: niente "Manca l'indirizzo", niente mail al cliente.
alter table shopify_orders add column if not exists spedizione text;

-- Rilettura degli ordini recenti, così prendono il metodo di spedizione
update shopify_stores set sync_da = least(coalesce(sync_da, now()), now() - interval '30 days');
