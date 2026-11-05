-- ════════════════════════════════════════════════════════
-- T&C Factory — Cervello v1 (Centro di controllo, fase 2b)
--
-- Ogni mail scritta da una persona (evento 'mail_ricevuta') viene analizzata
-- dall'edge function cervello, che:
--   • scarta spam e phishing, lasciando il motivo in eventi.esito
--   • negli altri casi crea un task in coda comune, nella macroarea del negozio,
--     con la bozza di risposta da approvare
-- Nessuna risposta parte da sola: la invia una persona dal task (edge function mail-send).
-- Richiede mail.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Task: macroarea, mail d'origine, bozza
-- ─────────────────────────────────────────────

alter table tasks add column if not exists macroarea           text references shopify_stores(id) on delete set null;
alter table tasks add column if not exists mail_id             uuid references mail_messaggi(id) on delete set null;
alter table tasks add column if not exists bozza_risposta      text check (length(bozza_risposta) <= 20000);
alter table tasks add column if not exists analisi             jsonb;   -- categoria, lingua, ordini trovati, dubbi
alter table tasks add column if not exists risposta_inviata_at timestamptz;

create index if not exists tasks_macroarea_idx on tasks (macroarea, stato);
-- Un evento produce al massimo un task, anche se viene rielaborato
create unique index if not exists tasks_evento_idx on tasks ((fonte_rif->>'evento_id')) where fonte_rif ? 'evento_id';

-- Tipi usati dal cervello: i minuti sono una prima stima, si cambiano da Tipi di task
insert into task_tipi (nome, minuti_standard, autonomia, descrizione) values
  ('Stato ordine',             3, 'bozza', 'Il cliente chiede dov''è il suo ordine'),
  ('Reso o cambio',           10, 'bozza', 'Richiesta di reso, cambio o rimborso'),
  ('Problema con un ordine',  10, 'bozza', 'Prodotto sbagliato o danneggiato, ritardo, reclamo'),
  ('Modifica ordine',          5, 'bozza', 'Cambio di indirizzo, taglia o annullamento'),
  ('Informazioni prodotto',    5, 'bozza', 'Domande su prodotti, taglie, disponibilità'),
  ('Preventivo',              15, 'bozza', 'Richiesta di preventivo o ordine personalizzato'),
  ('Pagamenti e fatture',      5, 'bozza', 'Fatture, pagamenti, documenti'),
  ('Mail da gestire',          5, 'bozza', 'Tutto il resto')
on conflict (nome) do nothing;

-- ─────────────────────────────────────────────
-- 2. Coda di lavoro del cervello
-- ─────────────────────────────────────────────

alter table eventi add column if not exists tentativi          int not null default 0;
alter table eventi add column if not exists in_elaborazione_at timestamptz;

-- Prende gli eventi da elaborare: due giri sovrapposti non prendono lo stesso evento
create or replace function _tc_eventi_prendi(p_n int)
returns setof eventi security definer set search_path = public language sql as $$
  update eventi set in_elaborazione_at = now(), tentativi = tentativi + 1
   where id in (
     select id from eventi
      where fonte = 'mail' and tipo = 'mail_ricevuta' and elaborato_at is null and tentativi < 3
        and (in_elaborazione_at is null or in_elaborazione_at < now() - interval '10 minutes')
      order by ricevuto_at
      limit p_n
      for update skip locked
   )
  returning *;
$$;
revoke execute on function _tc_eventi_prendi(int) from public, anon, authenticated;
grant  execute on function _tc_eventi_prendi(int) to service_role;

-- Una mail scartata per errore: l'admin ne fa comunque un task
create or replace function tc_evento_crea_task(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
declare e eventi%rowtype; m mail_messaggi%rowtype; v_store text; v_task uuid;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  select * into e from eventi where id = p_id and fonte = 'mail' for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Mail non trovata'); end if;
  if e.task_id is not null then return jsonb_build_object('success', false, 'error', 'Il task esiste già'); end if;
  select * into m from mail_messaggi where id = (e.payload->>'mail_id')::uuid;
  select store_id into v_store from mail_caselle where id = e.account;

  insert into tasks (tipo_id, titolo, descrizione, macroarea, mail_id, fonte, fonte_rif)
  values ((select id from task_tipi where nome = 'Mail da gestire'),
          left('Rispondere a ' || coalesce(m.da_nome, m.da_email, 'mail') || ': ' || coalesce(m.oggetto, '(senza oggetto)'), 200),
          'Mail scartata dal cervello e recuperata a mano. Motivo dello scarto: ' || coalesce(e.esito, '—'),
          v_store, m.id, 'mail', jsonb_build_object('evento_id', e.id))
  returning id into v_task;

  update eventi set task_id = v_task where id = e.id;
  return jsonb_build_object('success', true, 'task', v_task);
end;
$$;
revoke execute on function tc_evento_crea_task(uuid) from public, anon;
grant  execute on function tc_evento_crea_task(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 3. Giro del cervello ogni 5 minuti, un minuto dopo il controllo delle caselle
-- ─────────────────────────────────────────────

create or replace function _tc_cervello_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/cervello',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
end;
$$;
revoke execute on function _tc_cervello_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cervello') then
    perform cron.unschedule('cervello');
  end if;
  perform cron.schedule('cervello', '1-59/5 * * * *', 'select _tc_cervello_call()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
