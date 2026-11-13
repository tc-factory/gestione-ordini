-- ════════════════════════════════════════════════════════
-- T&C Factory — Verifica dei task nati dalle mail: si chiudono da soli quando la
-- richiesta risulta fatta o non serve più (richiesta utente 2026-11-13)
--
--   • il cervello (supabase/functions/cervello/verifica.ts) rilegge il task con lo stato
--     ATTUALE dell'ordine su Shopify, il tracking GLS e le mail arrivate o inviate dopo,
--     e decide: fatto, non più necessario, doppione di un task più vecchio, ancora da fare
--   • si ricontrolla solo quando cambia qualcosa (ordine, mail, tracking): niente costi a vuoto
--   • chiude solo i tipi con task_tipi.chiusura_automatica = true (spento finché non si
--     approva la prova) e solo se il modello è certo
--   • un task chiuso in automatico e poi riaperto a mano non si richiude più da solo
--   • task_verifiche: ogni controllo, anche quelli di prova (prova = true, non toccano i task)
--
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_tipi add column if not exists chiusura_automatica boolean not null default false;
alter table tasks add column if not exists verificato_at timestamptz;

create table if not exists task_verifiche (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references tasks(id) on delete cascade,
  at          timestamptz not null default now(),
  prova       boolean not null default false,
  esito       text not null check (esito in ('fatto', 'non_necessario', 'doppione', 'aperto', 'errore')),
  certo       boolean not null default false,
  motivo      text,
  doppione_di uuid,
  chiuso      boolean not null default false,    -- il task è stato chiuso da questo controllo
  modello     text,
  costo_usd   numeric
);
create index if not exists task_verifiche_task_idx on task_verifiche (task_id, at desc);

alter table task_verifiche enable row level security;
drop policy if exists "Verifiche task visibili" on task_verifiche;
create policy "Verifiche task visibili" on task_verifiche for select to authenticated using (true);
revoke all on task_verifiche from anon, authenticated;
grant select on task_verifiche to authenticated;

-- Task da ricontrollare. Prova: tutti i task aperti nati da mail non ancora provati, senza
-- guardare l'interruttore. Normale: tipi accesi e qualcosa cambiato dall'ultimo controllo
-- (o dalla creazione: appena creato il task non si ricontrolla).
create or replace function _tc_task_da_verificare(p_n int, p_prova boolean default false)
returns setof uuid security definer set search_path = public language sql stable as $$
  select k.id
    from tasks k
    join task_tipi p on p.id = k.tipo_id
    join mail_messaggi m on m.id = k.mail_id
   where k.stato not in ('completato', 'non_completato')
     and not exists (select 1 from task_verifiche v where v.task_id = k.id and v.chiuso)
     and case when p_prova
         then not exists (select 1 from task_verifiche v where v.task_id = k.id and v.prova)
         else p.chiusura_automatica and (
           -- ordini del task aggiornati su Shopify
           exists (select 1
                     from jsonb_array_elements(case when jsonb_typeof(k.analisi->'ordini') = 'array' then k.analisi->'ordini' else '[]'::jsonb end) o
                     join shopify_orders so on so.store_id = coalesce(o->>'negozio', k.macroarea) and so.numero = o->>'numero'
                     left join spedizioni_tracking st on st.ordine_id = so.id
                    where so.aggiornato_at > coalesce(k.verificato_at, k.created_at)
                       or st.ultimo_at > coalesce(k.verificato_at, k.created_at))
           -- mail del cliente o nostre nella stessa casella
           or (m.da_email is not null and exists (select 1 from mail_messaggi x
                where x.casella_id = m.casella_id and x.id <> m.id
                  and x.ricevuto_at > coalesce(k.verificato_at, k.created_at)
                  and (lower(x.da_email) = lower(m.da_email) or position(lower(m.da_email) in lower(coalesce(x.a, ''))) > 0))))
         end
   order by k.created_at
   limit p_n;
$$;
revoke execute on function _tc_task_da_verificare(int, boolean) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
