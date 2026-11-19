-- ════════════════════════════════════════════════════════
-- T&C Factory — Uso dei Mac: quanto tempo nei tool di lavoro, e quanto "Altro"
--
-- Lo misura TC Lavoro (automazioni/lavoro-file) solo sui Mac dove l'admin lo accende
-- (Centro di controllo → Attivazioni, colonna "Uso del Mac"): spento di default.
-- Si contano solo i tool di lavoro, col loro nome (Illustrator, Photoshop, Shopify, gestionale,
-- Customily, Mail…). Tutto il resto — altri siti, musica, messaggistica personale — finisce in
-- un'unica voce "Altro", senza nome: non si registra mai quali siti si aprono né cosa si cerca.
-- Regole per stare nella legge (art. 4 Statuto dei Lavoratori, GDPR):
--   • solo totali del giorno: niente orari, niente schermate, niente tasti
--   • dei non-lavoro resta solo il totale "Altro", mai il sito o l'app
--   • i dati si cancellano da soli dopo 90 giorni
--   • li vede l'admin e la persona stessa (solo i suoi)
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table lavoro_dispositivi add column if not exists uso boolean not null default false;

create table if not exists lavoro_uso (
  chiave     text not null references lavoro_dispositivi(chiave) on delete cascade,
  utente     text not null references app_users(nickname) on update cascade on delete cascade,
  giorno     date not null,
  categoria  text not null,   -- 'lavoro' | 'altro'
  voce       text not null,   -- nome del tool di lavoro, oppure 'Altro'
  minuti     int  not null check (minuti >= 0),
  primary key (chiave, giorno, categoria, voce)
);
create index if not exists lavoro_uso_giorno_idx on lavoro_uso (giorno, utente);
-- Allinea il vincolo al modello lavoro/altro (versioni precedenti elencavano più categorie)
alter table lavoro_uso drop constraint if exists lavoro_uso_categoria_check;
alter table lavoro_uso add  constraint lavoro_uso_categoria_check check (categoria in ('lavoro', 'altro'));
alter table lavoro_uso enable row level security;
drop policy if exists "Uso del Mac: admin e la persona" on lavoro_uso;
create policy "Uso del Mac: admin e la persona" on lavoro_uso for select to authenticated
  using (app_is_admin() or utente = app_nickname());

-- p = { "giorni": [ { "giorno": "2026-11-19", "voci": [ { "categoria": "lavoro", "voce": "Adobe Illustrator", "minuti": 190 } ] } ] }
-- Risponde true se sul Mac l'uso è acceso: TC Lavoro raccoglie solo quando è true.
create or replace function tc_registra_uso_mac(p_chiave text, p jsonb)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  v_chi text;
  v_on  boolean;
  g     jsonb;
  v     jsonb;
  v_g   date;
  v_cat text;
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
      v_cat := case when v->>'categoria' = 'lavoro' then 'lavoro' else 'altro' end;
      continue when coalesce((v->>'minuti')::int, 0) < 1;
      insert into lavoro_uso (chiave, utente, giorno, categoria, voce, minuti)
      values (p_chiave, v_chi, v_g, v_cat,
              case when v_cat = 'altro' then 'Altro' else left(coalesce(nullif(trim(v->>'voce'), ''), '—'), 80) end,
              least(960, (v->>'minuti')::int))
      on conflict (chiave, giorno, categoria, voce) do update set minuti = lavoro_uso.minuti + excluded.minuti;
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
