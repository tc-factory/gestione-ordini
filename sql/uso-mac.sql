-- ════════════════════════════════════════════════════════
-- T&C Factory — Uso dei Mac: quanto tempo per categoria (lavoro, mail, messaggi, video, social…)
--
-- Lo misura TC Lavoro (automazioni/lavoro-file) solo sui Mac dove l'admin lo accende
-- (Centro di controllo → Attivazioni, colonna "Uso del Mac"): spento di default.
-- Regole per stare nella legge (art. 4 Statuto dei Lavoratori, GDPR):
--   • solo totali del giorno: niente orari, niente schermate, niente tasti
--   • dei siti solo il dominio (youtube.com), mai l'indirizzo completo né le ricerche
--   • siti visti meno di 5 minuti nel giorno raggruppati in "Altri siti", senza nome
--   • i dati si cancellano da soli dopo 90 giorni
--   • li vede l'admin e la persona stessa (solo i suoi)
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table lavoro_dispositivi add column if not exists uso boolean not null default false;

create table if not exists lavoro_uso (
  chiave     text not null references lavoro_dispositivi(chiave) on delete cascade,
  utente     text not null references app_users(nickname) on update cascade on delete cascade,
  giorno     date not null,
  categoria  text not null,
  voce       text not null,
  minuti     int  not null check (minuti >= 0),
  primary key (chiave, giorno, categoria, voce)
);
create index if not exists lavoro_uso_giorno_idx on lavoro_uso (giorno, utente);
alter table lavoro_uso enable row level security;
drop policy if exists "Uso del Mac: admin e la persona" on lavoro_uso;
create policy "Uso del Mac: admin e la persona" on lavoro_uso for select to authenticated
  using (app_is_admin() or utente = app_nickname());

-- p = { "giorni": [ { "giorno": "2026-11-19", "voci": [ { "categoria": "video", "voce": "youtube.com", "minuti": 25 } ] } ] }
-- Risponde true se sul Mac l'uso è acceso: TC Lavoro raccoglie solo quando è true.
create or replace function tc_registra_uso_mac(p_chiave text, p jsonb)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  v_chi text;
  v_on  boolean;
  g     jsonb;
  v     jsonb;
  v_g   date;
begin
  select utente, uso into v_chi, v_on from lavoro_dispositivi where chiave = p_chiave and attivo;
  if v_chi is null then raise exception 'Mac non collegato'; end if;
  delete from lavoro_uso where giorno < tc_oggi() - 90;
  if not v_on then return false; end if;

  for g in select * from jsonb_array_elements(coalesce(p->'giorni', '[]'::jsonb)) loop
    v_g := (g->>'giorno')::date;
    continue when v_g < tc_oggi() - 7 or v_g > tc_oggi() + 1;
    delete from lavoro_uso where chiave = p_chiave and giorno = v_g;
    for v in select * from jsonb_array_elements(coalesce(g->'voci', '[]'::jsonb)) loop
      continue when coalesce((v->>'minuti')::int, 0) < 1
        or v->>'categoria' not in ('lavoro', 'mail', 'messaggi', 'ricerche', 'video', 'social', 'notizie', 'acquisti', 'altri');
      insert into lavoro_uso (chiave, utente, giorno, categoria, voce, minuti)
      values (p_chiave, v_chi, v_g, v->>'categoria', left(coalesce(nullif(trim(v->>'voce'), ''), '—'), 80), least(960, (v->>'minuti')::int))
      on conflict (chiave, giorno, categoria, voce) do update set minuti = excluded.minuti;
    end loop;
  end loop;
  return true;
end;
$$;
revoke execute on function tc_registra_uso_mac(text, jsonb) from public;
grant execute on function tc_registra_uso_mac(text, jsonb) to anon, authenticated;

-- Acceso/spento dal gestionale: solo admin. Spento, il Mac smette di raccogliere; lo storico resta fino ai 90 giorni.
create or replace function tc_lavoro_uso(p_chiave text, p_on boolean)
returns void security definer set search_path = public language plpgsql as $$
begin
  if not app_is_admin() then raise exception 'Solo gli admin accendono l''uso del Mac'; end if;
  update lavoro_dispositivi set uso = p_on where chiave = p_chiave;
end;
$$;
revoke execute on function tc_lavoro_uso(text, boolean) from public, anon;
grant execute on function tc_lavoro_uso(text, boolean) to authenticated;
