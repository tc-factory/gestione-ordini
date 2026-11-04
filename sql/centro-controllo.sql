-- ════════════════════════════════════════════════════════
-- T&C Factory — Centro di controllo (fase 0: motore dei task)
--
--   • task_tipi:    catalogo dei tipi di task, con il tempo standard in minuti,
--                   la competenza richiesta e il livello di autonomia del cervello
--   • tasks:        i task del giorno; assegnato_a null = coda comune
--   • task_storico: ogni cambio di stato, con chi, quando e perché
--   • eventi:       tutto ciò che arriverà dai servizi esterni (Shopify, mail,
--                   WhatsApp, Meta…), da cui il cervello creerà i task
--
-- Il tempo di lavoro lo conta il database: parte quando il task passa
-- "in lavorazione" e si ferma a ogni altro stato (lavorato_sec).
-- Lo stato lo cambia l'operatore con tc_task_stato; creare, modificare,
-- assegnare ed eliminare i task spetta all'admin.
-- Richiede sicurezza-2-blocca.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- Oggi in Italia (il database lavora in UTC)
create or replace function tc_oggi() returns date
language sql stable as $$ select (now() at time zone 'Europe/Rome')::date $$;

-- ─────────────────────────────────────────────
-- 1. Tipi di task
-- ─────────────────────────────────────────────

create table if not exists task_tipi (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null unique check (length(trim(nome)) between 1 and 80),
  descrizione     text not null default '' check (length(descrizione) <= 1000),
  minuti_standard int  not null default 15 check (minuti_standard between 1 and 960),
  competenza      text check (length(competenza) <= 60),
  autonomia       text not null default 'solo_task' check (autonomia in ('solo_task', 'bozza', 'automatico')),
  attivo          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table task_tipi enable row level security;
drop policy if exists "Staff legge tipi task"   on task_tipi;
drop policy if exists "Admin gestisce tipi task" on task_tipi;
create policy "Staff legge tipi task"    on task_tipi for select to authenticated using (app_is_staff());
create policy "Admin gestisce tipi task" on task_tipi for all    to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on task_tipi from anon, authenticated;
grant select, insert, update, delete on task_tipi to authenticated;

-- ─────────────────────────────────────────────
-- 2. Task
-- ─────────────────────────────────────────────

create table if not exists tasks (
  id             uuid primary key default gen_random_uuid(),
  tipo_id        uuid references task_tipi(id) on delete set null,
  titolo         text not null check (length(trim(titolo)) between 1 and 200),
  descrizione    text not null default '' check (length(descrizione) <= 5000),
  priorita       text not null default 'normale' check (priorita in ('urgente', 'alta', 'normale', 'bassa')),
  stato          text not null default 'da_fare'
                 check (stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'completato', 'rimandato', 'bloccato', 'non_completato')),
  assegnato_a    text references app_users(nickname) on delete set null on update cascade,
  giorno         date not null default tc_oggi(),
  scadenza       timestamptz,
  minuti_stimati int check (minuti_stimati between 1 and 960),
  lavorato_sec   int not null default 0 check (lavorato_sec >= 0),
  lavoro_dal     timestamptz,                -- inizio della sessione di lavoro in corso
  motivo         text check (length(motivo) <= 500),
  riaperture     int not null default 0,     -- quante volte è stato riaperto dopo il completamento
  rinvii         int not null default 0,
  fonte          text not null default 'manuale',   -- manuale, regola, shopify, mail, whatsapp…
  fonte_rif      jsonb,                              -- id dell'evento / messaggio / ordine d'origine
  riferimento    jsonb,                              -- elemento del gestionale collegato { tipo, id, label, hash }
  creato_da      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  completato_at  timestamptz
);
create index if not exists tasks_giorno_idx    on tasks (giorno, assegnato_a);
create index if not exists tasks_assegnato_idx on tasks (assegnato_a, stato);

create table if not exists task_storico (
  id        bigint generated always as identity primary key,
  task_id   uuid not null references tasks(id) on delete cascade,
  da_stato  text,
  a_stato   text not null,
  utente    text,
  motivo    text,
  at        timestamptz not null default now()
);
create index if not exists task_storico_task_idx on task_storico (task_id, at);

-- Tempo di lavoro, completamento, riaperture
create or replace function _tc_task_before() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.minuti_stimati is null then
      new.minuti_stimati := coalesce((select minuti_standard from task_tipi where id = new.tipo_id), 15);
    end if;
    new.creato_da := coalesce(new.creato_da, app_nickname());
    if new.stato = 'in_lavorazione' then new.lavoro_dal := now(); end if;
    if new.stato = 'completato' then new.completato_at := now(); end if;
    return new;
  end if;

  new.updated_at := now();
  if new.minuti_stimati is null then new.minuti_stimati := old.minuti_stimati; end if;
  if new.stato is distinct from old.stato then
    if old.stato = 'in_lavorazione' and old.lavoro_dal is not null then
      new.lavorato_sec := old.lavorato_sec + greatest(0, extract(epoch from now() - old.lavoro_dal)::int);
      new.lavoro_dal := null;
    end if;
    if new.stato = 'in_lavorazione' then new.lavoro_dal := now(); end if;
    if new.stato = 'completato' then new.completato_at := now(); end if;
    if old.stato = 'completato' then
      new.completato_at := null;
      new.riaperture := old.riaperture + 1;
    end if;
    if new.stato = 'rimandato' then new.rinvii := old.rinvii + 1; end if;
  end if;
  return new;
end;
$$;

create or replace function _tc_task_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stato is distinct from old.stato then
    insert into task_storico (task_id, da_stato, a_stato, utente, motivo)
    values (new.id, case when tg_op = 'UPDATE' then old.stato end, new.stato, app_nickname(), new.motivo);
  end if;
  return null;
end;
$$;

drop trigger if exists tasks_before on tasks;
drop trigger if exists tasks_after  on tasks;
create trigger tasks_before before insert or update on tasks for each row execute function _tc_task_before();
create trigger tasks_after  after  insert or update on tasks for each row execute function _tc_task_after();

-- Chi vede cosa: l'admin tutto, l'operatore i suoi task e la coda comune
alter table tasks enable row level security;
drop policy if exists "Task visibili"        on tasks;
drop policy if exists "Admin gestisce task"  on tasks;
create policy "Task visibili" on tasks for select to authenticated
  using (app_is_admin() or assegnato_a = app_nickname() or (assegnato_a is null and app_is_staff()));
create policy "Admin gestisce task" on tasks for all to authenticated
  using (app_is_admin()) with check (app_is_admin());
revoke all on tasks from anon, authenticated;
grant select, insert, update, delete on tasks to authenticated;

alter table task_storico enable row level security;
drop policy if exists "Storico task visibile" on task_storico;
create policy "Storico task visibile" on task_storico for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id));   -- segue la visibilità del task
revoke all on task_storico from anon, authenticated;
grant select on task_storico to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tasks') then
    alter publication supabase_realtime add table tasks;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- 3. Cambio di stato (operatore del task o admin)
--    • in_lavorazione: mette in pausa l'altro task in corso della stessa persona
--    • rimandato / bloccato / non_completato: motivo obbligatorio
--    • rimandato: sposta il task al giorno scelto
--    • un task della coda comune passa a chi lo prende in mano
-- ─────────────────────────────────────────────

create or replace function tc_task_stato(p_id uuid, p_stato text, p_motivo text default null, p_giorno date default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); t tasks%rowtype; v_chi text;
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  select * into t from tasks where id = p_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Task non trovato'); end if;
  if not app_is_admin() and t.assegnato_a is not null and t.assegnato_a <> v_me then
    return jsonb_build_object('success', false, 'error', 'Il task è assegnato a ' || t.assegnato_a);
  end if;
  if p_stato not in ('da_fare', 'in_lavorazione', 'in_pausa', 'completato', 'rimandato', 'bloccato', 'non_completato') then
    return jsonb_build_object('success', false, 'error', 'Stato non valido');
  end if;
  if p_stato in ('rimandato', 'bloccato', 'non_completato') and coalesce(trim(p_motivo), '') = '' then
    return jsonb_build_object('success', false, 'error', 'Scrivi il motivo');
  end if;
  if p_stato = 'rimandato' and (p_giorno is null or p_giorno <= tc_oggi()) then
    return jsonb_build_object('success', false, 'error', 'Scegli un giorno a partire da domani');
  end if;
  if p_stato = t.stato and p_stato <> 'rimandato' then return jsonb_build_object('success', true); end if;

  v_chi := coalesce(t.assegnato_a, v_me);
  if p_stato = 'in_lavorazione' then
    update tasks set stato = 'in_pausa', motivo = null
     where assegnato_a = v_chi and stato = 'in_lavorazione' and id <> p_id;
  end if;

  update tasks
     set stato       = p_stato,
         motivo      = case when p_stato in ('rimandato', 'bloccato', 'non_completato') then left(trim(p_motivo), 500) end,
         giorno      = case when p_stato = 'rimandato' then p_giorno else giorno end,
         assegnato_a = v_chi
   where id = p_id;
  return jsonb_build_object('success', true);
end;
$$;

-- Prende un task dalla coda comune
create or replace function tc_task_prendi(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname();
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  update tasks set assegnato_a = v_me where id = p_id and assegnato_a is null;
  if not found then return jsonb_build_object('success', false, 'error', 'Il task è già stato preso'); end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function tc_task_stato(uuid, text, text, date) from public, anon;
revoke execute on function tc_task_prendi(uuid)                  from public, anon;
grant  execute on function tc_task_stato(uuid, text, text, date) to authenticated;
grant  execute on function tc_task_prendi(uuid)                  to authenticated;

-- ─────────────────────────────────────────────
-- 4. Punteggio di produttività 0–100 (solo admin)
--   70% minuti standard completati ÷ minuti assegnati
--   20% puntualità: completati entro la scadenza (o entro il loro giorno)
--   10% qualità: completati senza essere stati riaperti
--   I task bloccati non contano (dipendono da altri); i rimandati contano solo dal nuovo giorno.
-- ─────────────────────────────────────────────

create or replace function tc_task_punteggi(p_dal date, p_al date)
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'punteggi', coalesce((
    select jsonb_agg(to_jsonb(s)) from (
      select assegnato_a as operatore,
             count(*)                                             as task,
             count(*) filter (where stato = 'completato')         as completati,
             sum(minuti_stimati)                                  as minuti_assegnati,
             coalesce(sum(minuti_stimati) filter (where stato = 'completato'), 0) as minuti_completati,
             round(coalesce(sum(lavorato_sec) filter (where stato = 'completato'), 0) / 60.0) as minuti_reali,
             round(100 * (
               0.7 * least(1, coalesce(sum(minuti_stimati) filter (where stato = 'completato'), 0)::numeric / nullif(sum(minuti_stimati), 0))
             + 0.2 * coalesce(count(*) filter (where stato = 'completato'
                       and completato_at <= coalesce(scadenza, ((giorno + 1)::timestamp at time zone 'Europe/Rome')))::numeric
                       / nullif(count(*) filter (where stato = 'completato'), 0), 0)
             + 0.1 * coalesce(count(*) filter (where stato = 'completato' and riaperture = 0)::numeric
                       / nullif(count(*) filter (where stato = 'completato'), 0), 0)
             ))::int as punteggio
        from tasks
       where assegnato_a is not null and giorno between p_dal and p_al
         and stato <> 'bloccato'
         and not (stato = 'rimandato' and giorno > tc_oggi())   -- un rimandato conta dal suo nuovo giorno
       group by assegnato_a
    ) s
  ), '[]'::jsonb));
end;
$$;

-- Tempi reali per tipo negli ultimi 90 giorni: base per ricalibrare i minuti standard
create or replace function tc_task_tempi_reali()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true, 'tempi', coalesce((
    select jsonb_agg(to_jsonb(s)) from (
      select tipo_id, count(*) as campioni,
             round((percentile_cont(0.5) within group (order by lavorato_sec) / 60.0)::numeric, 1) as mediana_minuti
        from tasks
       where tipo_id is not null and stato = 'completato' and lavorato_sec > 0
         and completato_at > now() - interval '90 days'
       group by tipo_id
    ) s
  ), '[]'::jsonb));
end;
$$;

revoke execute on function tc_task_punteggi(date, date) from public, anon;
revoke execute on function tc_task_tempi_reali()        from public, anon;
grant  execute on function tc_task_punteggi(date, date) to authenticated;
grant  execute on function tc_task_tempi_reali()        to authenticated;

-- ─────────────────────────────────────────────
-- 5. Eventi dai servizi esterni (usata dalle fasi successive)
--    Li scrivono le edge functions con la chiave di servizio; l'admin li legge.
-- ─────────────────────────────────────────────

create table if not exists eventi (
  id           uuid primary key default gen_random_uuid(),
  fonte        text not null,          -- shopify, mail, whatsapp, instagram, facebook, meta_ads…
  account      text,                   -- quale store / casella / numero
  tipo         text not null,          -- es. ordine_creato, messaggio_ricevuto
  id_esterno   text,                   -- id nel servizio d'origine, per non elaborare due volte
  payload      jsonb not null default '{}',
  ricevuto_at  timestamptz not null default now(),
  elaborato_at timestamptz,
  esito        text,                   -- cosa ne ha fatto il cervello
  task_id      uuid references tasks(id) on delete set null,
  unique (fonte, account, id_esterno)
);
create index if not exists eventi_da_elaborare_idx on eventi (ricevuto_at) where elaborato_at is null;

alter table eventi enable row level security;
drop policy if exists "Admin legge eventi" on eventi;
create policy "Admin legge eventi" on eventi for select to authenticated using (app_is_admin());
revoke all on eventi from anon, authenticated;
grant select on eventi to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
