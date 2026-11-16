-- ════════════════════════════════════════════════════════
-- T&C Factory — Coda di stampa verso le SC-F500
--
-- Dalla scheda "File del mattino" un PDF dei calzini si manda in stampa (tc_stampa_invia). Un Mac in sede,
-- che vede le stampanti, gira l'agente automazioni/stampa/agente_stampa.py: prende il lavoro più vecchio
-- (tc_stampa_prossima), lo manda alla stampante col driver e scrive com'è andata (tc_stampa_esito).
-- L'agente usa la chiave dello script del mattino (Vault 'automazione_mattino_key').
--
-- Richiede file-mattino.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create table if not exists public.stampa_coda (
  id           bigint generated always as identity primary key,
  percorso     text not null,                       -- nel bucket file-mattino, es. 2026-11-16/Ciucciami - 6518-6568.pdf
  stampante    text not null default 'sc-f500',
  stato        text not null default 'in_coda' check (stato in ('in_coda', 'in_stampa', 'stampato', 'errore')),
  errore       text,
  richiesto_da text,
  richiesto_at timestamptz not null default now(),
  iniziato_at  timestamptz,
  finito_at    timestamptz,
  agente       text
);
create index if not exists stampa_coda_percorso on public.stampa_coda (percorso, richiesto_at desc);
create index if not exists stampa_coda_attesa on public.stampa_coda (richiesto_at) where stato = 'in_coda';
alter table public.stampa_coda enable row level security;
drop policy if exists stampa_coda_legge on public.stampa_coda;
create policy stampa_coda_legge on public.stampa_coda for select to authenticated using (app_vede_scheda('file'));
revoke all on public.stampa_coda from anon, authenticated;
grant select on public.stampa_coda to authenticated;

-- Mac che fanno da ponte verso le stampanti: l'ultima volta che hanno chiesto lavoro
create table if not exists public.stampa_agenti (
  nome     text primary key,
  visto_at timestamptz not null default now()
);
alter table public.stampa_agenti enable row level security;
drop policy if exists stampa_agenti_legge on public.stampa_agenti;
create policy stampa_agenti_legge on public.stampa_agenti for select to authenticated using (app_vede_scheda('file'));
revoke all on public.stampa_agenti from anon, authenticated;
grant select on public.stampa_agenti to authenticated;

-- Dal gestionale: mette il file in coda (uno per volta: se è già in coda o in stampa non lo raddoppia)
create or replace function tc_stampa_invia(p_percorso text) returns public.stampa_coda
language plpgsql security definer set search_path = public as $$
declare r public.stampa_coda;
begin
  if not app_vede_scheda('file') then raise exception 'Non autorizzato'; end if;
  if p_percorso !~ '^\d{4}-\d{2}-\d{2}/[^/]+\.pdf$' then raise exception 'File non stampabile'; end if;
  select * into r from stampa_coda where percorso = p_percorso and stato in ('in_coda', 'in_stampa') limit 1;
  if found then return r; end if;
  insert into stampa_coda (percorso, richiesto_da) values (p_percorso, app_nickname()) returning * into r;
  return r;
end;
$$;
revoke execute on function tc_stampa_invia(text) from public, anon;
grant  execute on function tc_stampa_invia(text) to authenticated;

-- Dall'agente: segna che è vivo e prende il lavoro più vecchio
create or replace function tc_stampa_prossima(p_chiave text, p_agente text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.stampa_coda;
begin
  if not _tc_mattino_chiave_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  insert into stampa_agenti (nome, visto_at) values (p_agente, now()) on conflict (nome) do update set visto_at = now();
  -- Un lavoro rimasto "in stampa" da più di un'ora (Mac spento a metà) torna disponibile come errore, non si ristampa da solo
  update stampa_coda set stato = 'errore', errore = 'Interrotto: il Mac non ha risposto', finito_at = now()
   where stato = 'in_stampa' and iniziato_at < now() - interval '1 hour';
  select * into r from stampa_coda where stato = 'in_coda' order by richiesto_at limit 1 for update skip locked;
  if not found then return jsonb_build_object('success', true, 'lavoro', null); end if;
  update stampa_coda set stato = 'in_stampa', iniziato_at = now(), agente = p_agente where id = r.id returning * into r;
  return jsonb_build_object('success', true, 'lavoro', to_jsonb(r));
end;
$$;

create or replace function tc_stampa_esito(p_chiave text, p_id bigint, p_ok boolean, p_errore text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not _tc_mattino_chiave_ok(p_chiave) then return jsonb_build_object('success', false, 'error', 'Chiave non valida'); end if;
  update stampa_coda set stato = case when p_ok then 'stampato' else 'errore' end, errore = left(p_errore, 500), finito_at = now()
   where id = p_id and stato = 'in_stampa';
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_stampa_prossima(text, text), tc_stampa_esito(text, bigint, boolean, text) from public, authenticated;
grant  execute on function tc_stampa_prossima(text, text), tc_stampa_esito(text, bigint, boolean, text) to anon;
