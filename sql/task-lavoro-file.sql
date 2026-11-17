-- ════════════════════════════════════════════════════════
-- T&C Factory — Il lavoro sui file (NAS e locale) diventa task completati
--
-- Su ogni Mac collegato gira "TC Lavoro" (automazioni/lavoro-file): ogni 20 secondi guarda
-- quale documento è aperto davanti (Illustrator, Photoshop, InDesign, Anteprima, Acrobat…)
-- e conta il tempo solo se la persona è attiva (mouse/tastiera usati negli ultimi 3 minuti).
-- Dal percorso del file ricava il cliente (DATI/Clienti/<lettera>/<cliente>, le cartelle
-- clienti dei brand, altrimenti la cartella del brand o quella che contiene il file).
-- Ogni 5 minuti manda i totali del giorno: un task completato "Lavorazione grafica"
-- per Mac, giorno e cliente, con i file lavorati e i minuti di ognuno nella descrizione.
-- I totali si riscrivono finché il giorno è aperto. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- Mac collegati: la chiave è scritta solo nella configurazione del Mac
create table if not exists lavoro_dispositivi (
  chiave           text primary key check (length(chiave) >= 32),
  utente           text not null references app_users(nickname) on update cascade on delete cascade,
  nome             text not null default '',
  attivo           boolean not null default true,
  ultimo_contatto  timestamptz,
  created_at       timestamptz not null default now()
);
alter table lavoro_dispositivi enable row level security;
drop policy if exists "Admin legge dispositivi lavoro" on lavoro_dispositivi;
create policy "Admin legge dispositivi lavoro" on lavoro_dispositivi for select to authenticated using (app_is_admin());

insert into task_tipi (nome, minuti_standard, autonomia, descrizione)
values ('Lavorazione grafica', 30, 'solo_task',
        'Tempo passato sui file di un cliente (NAS o locale), misurato da TC Lavoro sul Mac.')
on conflict (nome) do nothing;

create unique index if not exists tasks_lavoro_file_idx on tasks ((fonte_rif->>'sessione')) where fonte = 'file';

-- p = { "giorni": [ { "giorno": "2026-11-17", "clienti": [ { "cliente", "cartella", "minuti", "fine", "dettaglio" } ] } ] }
create or replace function tc_registra_lavoro_file(p_chiave text, p jsonb)
returns int security definer set search_path = public language plpgsql as $$
declare
  v_chi  text;
  v_tipo uuid := (select id from task_tipi where nome = 'Lavorazione grafica');
  g      jsonb;
  c      jsonb;
  v_ses  text;
  v_id   uuid;
  v_min  int;
  v_n    int := 0;
begin
  select utente into v_chi from lavoro_dispositivi where chiave = p_chiave and attivo;
  if v_chi is null then raise exception 'Mac non collegato'; end if;
  update lavoro_dispositivi set ultimo_contatto = now() where chiave = p_chiave;

  for g in select * from jsonb_array_elements(coalesce(p->'giorni', '[]'::jsonb)) loop
    -- Solo gli ultimi giorni: niente riscritture dello storico
    continue when (g->>'giorno')::date < tc_oggi() - 7 or (g->>'giorno')::date > tc_oggi() + 1;
    for c in select * from jsonb_array_elements(coalesce(g->'clienti', '[]'::jsonb)) loop
      v_min := least(960, coalesce((c->>'minuti')::int, 0));
      continue when v_min < 2 or coalesce(trim(c->>'cliente'), '') = '';
      v_ses := left(p_chiave, 12) || ':' || (g->>'giorno') || ':' || lower(trim(c->>'cliente'));
      select id into v_id from tasks where fonte = 'file' and fonte_rif->>'sessione' = v_ses;
      if v_id is null then
        insert into tasks (tipo_id, titolo, descrizione, stato, assegnato_a, giorno, minuti_stimati, lavorato_sec,
                           fonte, fonte_rif, analisi, creato_da)
        values (v_tipo, left(trim(c->>'cliente'), 200), left(coalesce(c->>'dettaglio', ''), 5000), 'completato', v_chi,
                (g->>'giorno')::date, v_min, v_min * 60,
                'file', jsonb_build_object('sessione', v_ses, 'cartella', left(c->>'cartella', 500)),
                jsonb_build_object('cliente', jsonb_build_object('nome', left(trim(c->>'cliente'), 200))),
                'tc_lavoro')
        returning id into v_id;
      else
        update tasks set descrizione = left(coalesce(c->>'dettaglio', ''), 5000),
                         minuti_stimati = v_min, lavorato_sec = v_min * 60,
                         fonte_rif = fonte_rif || jsonb_build_object('cartella', left(c->>'cartella', 500))
         where id = v_id;
      end if;
      update tasks set completato_at = coalesce((c->>'fine')::timestamptz, now()) where id = v_id;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke execute on function tc_registra_lavoro_file(text, jsonb) from public;
grant execute on function tc_registra_lavoro_file(text, jsonb) to anon, authenticated;
