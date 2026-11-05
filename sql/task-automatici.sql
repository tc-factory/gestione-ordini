-- ════════════════════════════════════════════════════════
-- T&C Factory — Task automatici e piano del giorno (Centro di controllo)
--
--   • ordine Shopify nuovo          → task "Preparare ordine" nella macroarea del negozio
--   • ordine del gestionale che scade entro 2 giorni → task con quello che manca
--   • i task si chiudono da soli quando l'ordine viene evaso, annullato o archiviato
--   • task_operatori: chi entra nel piano del giorno, con minuti, macroaree e competenze
--   • piano del giorno: ogni mattina la coda comune viene distribuita tra gli operatori attivi
--   • tc_task_mail: l'operatore legge la mail del proprio task (mail_messaggi resta solo admin)
-- Richiede cervello.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into task_tipi (nome, minuti_standard, autonomia, descrizione) values
  ('Preparare ordine', 15, 'solo_task', 'Ordine nuovo da un negozio Shopify'),
  ('Ordine in scadenza', 30, 'solo_task', 'Ordine del gestionale che scade entro 2 giorni')
on conflict (nome) do nothing;

-- ─────────────────────────────────────────────
-- 1. Task dagli ordini
-- ─────────────────────────────────────────────

create or replace function _tc_task_automatici()
returns void security definer set search_path = public language plpgsql as $$
declare e record; o record; v_task uuid; v_manca text[];
begin
  -- Ordini Shopify nuovi
  for e in select * from eventi where fonte = 'shopify' and tipo = 'ordine_creato' and elaborato_at is null order by ricevuto_at limit 200 loop
    select * into o from shopify_orders where store_id = e.account and shopify_id = e.id_esterno;
    if not found then
      update eventi set elaborato_at = now(), esito = 'Ordine non trovato' where id = e.id;
    elsif o.annullato_at is not null or o.stato_evasione = 'FULFILLED' then
      update eventi set elaborato_at = now(), esito = 'Già evaso o annullato: nessun task' where id = e.id;
    else
      insert into tasks (tipo_id, titolo, descrizione, macroarea, fonte, fonte_rif, creato_da)
      values ((select id from task_tipi where nome = 'Preparare ordine'),
              left('Preparare ordine ' || o.numero || coalesce(' · ' || o.cliente, ''), 200),
              coalesce((select string_agg((r->>'qnt') || '× ' || (r->>'titolo') || coalesce(' (' || (r->>'variante') || ')', ''), E'\n') from jsonb_array_elements(o.righe) r), '')
                || case when o.stato_pagamento is distinct from 'PAID' then E'\n\nPagamento: ' || coalesce(o.stato_pagamento, 'non indicato') else '' end,
              o.store_id, 'shopify', jsonb_build_object('evento_id', e.id, 'ordine', o.id), 'cervello')
      on conflict do nothing
      returning id into v_task;
      update eventi set elaborato_at = now(), esito = 'Task creato', task_id = v_task where id = e.id;
    end if;
  end loop;

  -- Ordini del gestionale in scadenza (non si recuperano quelli già scaduti: niente arretrato vecchio)
  for o in select * from orders
            where not archived and deleted_at is null
              and deadline between tc_oggi() and tc_oggi() + 2
              and not coalesce((stages->'spedito'->>'done')::boolean, false)
              and not coalesce((order_module->>'neutro')::boolean, false) loop
    v_manca := array_remove(array[
      case when not coalesce((o.stages->'merceCompleta'->>'done')::boolean, false) then 'merce' end,
      case when jsonb_array_length(coalesce(nullif(o.dtf_items, 'null'::jsonb), '[]'::jsonb)) > 0
            and not coalesce((o.stages->'dtfPronti'->>'done')::boolean, false) then 'DTF' end,
      case when o.lavorazione_esterna and not coalesce((o.stages->'lavorazioneEsterna'->>'done')::boolean, false) then 'lavorazione esterna' end,
      case when not coalesce((o.stages->'ordineStampato'->>'done')::boolean, false) then 'stampa' end
    ], null);
    insert into tasks (tipo_id, titolo, descrizione, priorita, scadenza, fonte, fonte_rif, riferimento, creato_da)
    values ((select id from task_tipi where nome = 'Ordine in scadenza'),
            left('Ordine in scadenza: ' || coalesce(o.nome, o.id), 200),
            case when cardinality(v_manca) > 0 then 'Manca: ' || array_to_string(v_manca, ', ') else 'Da evadere' end,
            case when o.deadline = tc_oggi() then 'urgente' else 'alta' end,
            ((o.deadline + 1)::timestamp at time zone 'Europe/Rome'),
            'gestionale', jsonb_build_object('evento_id', 'ordine:' || o.id, 'ordine', o.id),
            jsonb_build_object('tipo', 'ordine', 'id', o.id, 'label', coalesce(o.nome, o.id)), 'cervello')
    on conflict do nothing;
  end loop;

  -- Chiusura automatica
  update tasks t set stato = 'completato'
    from shopify_orders s
   where t.fonte = 'shopify' and t.stato not in ('completato', 'non_completato')
     and s.id = (t.fonte_rif->>'ordine')::uuid
     and (s.stato_evasione = 'FULFILLED' or s.annullato_at is not null);

  update tasks t set stato = 'completato'
    from orders g
   where t.fonte = 'gestionale' and t.stato not in ('completato', 'non_completato')
     and g.id = t.fonte_rif->>'ordine'
     and (g.archived or g.deleted_at is not null or coalesce((g.stages->'spedito'->>'done')::boolean, false));
end;
$$;
revoke execute on function _tc_task_automatici() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. Operatori del piano
-- ─────────────────────────────────────────────

create table if not exists task_operatori (
  nickname      text primary key references app_users(nickname) on delete cascade on update cascade,
  attivo        boolean not null default false,
  minuti_giorno int  not null default 420 check (minuti_giorno between 30 and 720),
  macroaree     text[] not null default '{}',   -- vuoto = tutte
  competenze    text[] not null default '{}'    -- confrontate con task_tipi.competenza
);
alter table task_operatori enable row level security;
drop policy if exists "Admin gestisce operatori" on task_operatori;
create policy "Admin gestisce operatori" on task_operatori for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on task_operatori from anon, authenticated;
grant select, insert, update, delete on task_operatori to authenticated;

-- ─────────────────────────────────────────────
-- 3. Piano del giorno: per priorità e scadenza, a chi può farlo e ha più tempo libero.
--    Ciò che non entra nei minuti di nessuno resta in coda comune.
-- ─────────────────────────────────────────────

create or replace function _tc_task_piano()
returns int security definer set search_path = public language plpgsql as $$
declare t record; v_chi text; n int := 0; v_oggi date := tc_oggi();
begin
  for t in
    select k.id, k.macroarea, coalesce(k.minuti_stimati, 15) minuti, p.competenza
      from tasks k left join task_tipi p on p.id = k.tipo_id
     where k.assegnato_a is null and k.stato in ('da_fare', 'rimandato') and k.giorno <= v_oggi
     order by array_position(array['urgente', 'alta', 'normale', 'bassa'], k.priorita), k.scadenza nulls last, k.created_at
  loop
    select o.nickname into v_chi
      from task_operatori o
      cross join lateral (
        select coalesce(sum(minuti_stimati), 0) carico from tasks x
         where x.assegnato_a = o.nickname and x.giorno <= v_oggi
           and x.stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato')
      ) c
     where o.attivo
       and (cardinality(o.macroaree) = 0 or t.macroarea is null or t.macroarea = any(o.macroaree))
       and (t.competenza is null or t.competenza = any(o.competenze))
       and c.carico + t.minuti <= o.minuti_giorno
     order by c.carico::numeric / o.minuti_giorno, o.nickname
     limit 1;
    if v_chi is not null then
      update tasks set assegnato_a = v_chi, giorno = v_oggi where id = t.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function _tc_task_piano() from public, anon, authenticated;

create or replace function tc_task_distribuisci()
returns jsonb security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'assegnati', _tc_task_piano());
end;
$$;
revoke execute on function tc_task_distribuisci() from public, anon;
grant  execute on function tc_task_distribuisci() to authenticated;

-- ─────────────────────────────────────────────
-- 4. La mail di un task, per chi può vedere quel task
-- ─────────────────────────────────────────────

create or replace function tc_task_mail(p_task uuid)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare t tasks%rowtype; m mail_messaggi%rowtype;
begin
  select * into t from tasks where id = p_task;
  if not found or not (app_is_admin() or t.assegnato_a = app_nickname() or (t.assegnato_a is null and app_is_staff())) then
    return jsonb_build_object('success', false, 'error', 'Task non trovato');
  end if;
  select * into m from mail_messaggi where id = t.mail_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Mail non trovata'); end if;
  return jsonb_build_object('success', true, 'mail', jsonb_build_object(
    'da_email', m.da_email, 'da_nome', m.da_nome, 'oggetto', m.oggetto,
    'ricevuto_at', m.ricevuto_at, 'testo', m.testo, 'allegati', m.allegati));
end;
$$;
revoke execute on function tc_task_mail(uuid) from public, anon;
grant  execute on function tc_task_mail(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 5. Cron: task ogni 5 minuti; piano alle 6:30 UTC (7:30 in Italia d'inverno, 8:30 d'estate), lunedì–sabato
-- ─────────────────────────────────────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'task-automatici') then perform cron.unschedule('task-automatici'); end if;
  if exists (select 1 from cron.job where jobname = 'task-piano')      then perform cron.unschedule('task-piano');      end if;
  perform cron.schedule('task-automatici', '2-59/5 * * * *', 'select _tc_task_automatici()');
  perform cron.schedule('task-piano', '30 6 * * 1-6', 'select _tc_task_piano()');
end $$;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
