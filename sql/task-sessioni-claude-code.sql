-- ════════════════════════════════════════════════════════
-- T&C Factory — Le sessioni di Claude Code dei progetti senza GitHub diventano task completati
--
-- Per le cartelle che non hanno commit su GitHub (Aggeggio, app di Box Factory Lab, Lavorazione,
-- 00-Prodotti) lo script automazioni/claude-code-sessioni/sessioni.py legge i registri delle sessioni
-- di Claude Code sul Mac e registra una riga per sessione e giorno: task "Lavorazione con Claude Code"
-- completato, del primario di sviluppo:claude_code (Riccardo), titolo della sessione,
-- tempo = minuti di lavoro attivo (le pause oltre 10 minuti non contano).
-- Una sessione che continua aggiorna la sua riga. Si può rieseguire.
-- ════════════════════════════════════════════════════════

create unique index if not exists tasks_sessione_cc_idx on tasks ((fonte_rif->>'sessione')) where fonte = 'claude_code';

create or replace function tc_registra_sessione(p jsonb)
returns boolean security definer set search_path = public language plpgsql as $$
declare
  v_id   uuid;
  v_fine timestamptz := (p->>'fine')::timestamptz;
  v_min  int := least(960, greatest(1, coalesce((p->>'minuti')::int, 1)));
  v_tipo uuid := (select id from task_tipi where nome = 'Lavorazione con Claude Code');
  v_chi  text := coalesce((select primario from competenze_responsabili where voce = 'sviluppo:claude_code'), 'riccardo');
begin
  select id into v_id from tasks where fonte = 'claude_code' and fonte_rif->>'sessione' = p->>'sessione';
  if v_id is null then
    insert into tasks (tipo_id, titolo, descrizione, stato, assegnato_a, giorno, minuti_stimati, lavorato_sec,
                       fonte, fonte_rif, analisi, creato_da)
    values (v_tipo, left(p->>'titolo', 200), left(coalesce(p->>'descrizione', ''), 5000), 'completato', v_chi,
            (p->>'giorno')::date, v_min, v_min * 60,
            'claude_code', jsonb_build_object('sessione', p->>'sessione', 'cartella', p->>'cartella'),
            jsonb_build_object('cliente', jsonb_build_object('nome', p->>'progetto'), 'sessione', true),
            'claude_code')
    returning id into v_id;
  else
    update tasks set titolo = left(p->>'titolo', 200), descrizione = left(coalesce(p->>'descrizione', ''), 5000),
                     minuti_stimati = v_min, lavorato_sec = v_min * 60
     where id = v_id;
  end if;
  -- Completato all'ultimo messaggio della sessione in quel giorno
  update tasks set completato_at = v_fine where id = v_id;
  return true;
end;
$$;
revoke execute on function tc_registra_sessione(jsonb) from public, anon, authenticated;
