-- Task di Live Printing: le mail di info@liveprinting.it diventano task col brand Live Printing,
-- così compaiono nella coda comune col loro filtro. Live Printing non è un negozio Shopify:
-- si toglie il legame della macroarea con shopify_stores (nessun dato cancellato). Rieseguibile.
alter table tasks drop constraint if exists tasks_macroarea_fkey;

-- I task già creati dalle mail di Live Printing
update tasks t set macroarea = 'liveprinting'
  from mail_messaggi m
 where m.id = t.mail_id and m.casella_id = 'liveprinting' and t.macroarea is null;

-- Andrea non lavora sui task: fuori dal piano del giorno
update task_operatori set attivo = false where nickname = 'andrea';
