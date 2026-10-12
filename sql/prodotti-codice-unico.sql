-- ════════════════════════════════════════════════════════
-- T&C Factory — Prodotti: codice unico
-- Due prodotti non possono avere lo stesso codice (maiuscole/minuscole e spazi non contano).
-- I prodotti senza codice restano ammessi. Si può rieseguire senza danni.
-- ════════════════════════════════════════════════════════

create unique index if not exists products_codice_unico on products (upper(trim(codice))) where trim(codice) <> '';
