-- Regole dei brand: anche T&C Factory e Live Printing, che non sono negozi Shopify.
-- Si toglie il legame con shopify_stores (nessun dato cancellato). Rieseguibile.
alter table negozi_conoscenza drop constraint if exists negozi_conoscenza_store_id_fkey;
