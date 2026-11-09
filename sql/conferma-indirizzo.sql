-- ════════════════════════════════════════════════════════
-- T&C Factory — Dopo un cambio di indirizzo, una persona controlla e conferma al cliente
--
-- Quando il task di cambio indirizzo si chiude, nasce il task "Conferma al cliente" con la
-- bozza già pronta. Si chiude rispondendo, da CS o dal programma di posta. Va ai responsabili
-- della competenza del task originale, saltando claude (il controllo lo fa una persona):
-- se nessuno è disponibile resta in coda comune. Il tipo non ha competenza propria,
-- così il piano del mattino non lo assegna a claude.
-- Se al cliente si è già risposto, non serve.
--
-- Richiede task-chiusura-reale.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into task_tipi (nome, minuti_standard, autonomia, descrizione, chiude_con_risposta)
values ('Conferma al cliente', 5, 'bozza', 'Controllare la modifica fatta e confermarla al cliente', true)
on conflict (nome) do nothing;

create or replace function _tc_conferma_indirizzo(p_id uuid)
returns uuid security definer set search_path = public language plpgsql as $$
declare
  t tasks%rowtype; o shopify_orders%rowtype; n jsonb; v_id uuid; v_negozio text; v_indirizzo text; v_stampato boolean; v_bozza text; v_chi text;
begin
  select * into t from tasks where id = p_id;
  if not found or t.mail_id is null or t.risposta_inviata_at is not null then return null; end if;
  if exists (select 1 from tasks where fonte_rif->>'conferma_di' = p_id::text) then return null; end if;

  n := t.analisi->'indirizzo_nuovo';
  select * into o from shopify_orders
   where store_id = t.analisi->'indirizzo_ordine'->>'negozio' and numero = t.analisi->'indirizzo_ordine'->>'numero';
  select nome into v_negozio from shopify_stores where id = t.macroarea;

  v_indirizzo := concat_ws(E'\n', nullif(n->>'presso', ''), n->>'via',
                           trim(concat_ws(' ', n->>'cap', n->>'citta', case when nullif(n->>'provincia', '') is not null then '(' || (n->>'provincia') || ')' end)));
  v_stampato := exists (select 1 from unnest(o.tags) g where lower(g) in ('stampato', 'auto-stampato'));

  select case when r.primario <> 'claude' and tc_disponibile(r.primario, tc_oggi()) then r.primario
              when r.secondario <> 'claude' and tc_disponibile(r.secondario, tc_oggi()) then r.secondario end
    into v_chi
    from task_tipi p
    join competenze_responsabili r on r.voce = coalesce(p.area, t.macroarea, 'produzione') || ':' || p.competenza
   where p.id = t.tipo_id;

  if t.analisi->>'lingua' = 'it' then
    v_bozza := 'Buongiorno' || coalesce(' ' || nullif(o.cliente, ''), '') || ',' || E'\n\n'
            || 'le confermiamo che abbiamo aggiornato l''indirizzo di spedizione del suo ordine ' || o.numero || ':' || E'\n\n'
            || v_indirizzo || E'\n\n' || 'Grazie e buona giornata,' || E'\n' || coalesce(v_negozio, '');
  end if;

  insert into tasks (tipo_id, titolo, descrizione, priorita, macroarea, mail_id, bozza_risposta, analisi, fonte, fonte_rif, giorno, assegnato_a, creato_da)
  values ((select id from task_tipi where nome = 'Conferma al cliente'),
          left('Conferma al cliente: nuovo indirizzo ordine ' || o.numero || coalesce(' di ' || nullif(o.cliente, ''), ''), 200),
          left('L''indirizzo è stato cambiato su Shopify. Controlla che sia giusto, poi conferma al cliente.' || E'\n\n' || v_indirizzo
               || case when v_stampato then E'\n\n' || 'ATTENZIONE: l''ordine era già stampato. DDT e fogli hanno il vecchio indirizzo: vanno sostituiti.' else '' end, 5000),
          'alta', t.macroarea, t.mail_id, v_bozza,
          jsonb_build_object('lingua', t.analisi->>'lingua', 'dubbi', coalesce(t.analisi->>'dubbi', ''), 'ordini', t.analisi->'ordini'),
          'mail', jsonb_build_object('conferma_di', p_id), tc_oggi(),
          v_chi, 'cervello')
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function _tc_conferma_indirizzo(uuid) from public, anon, authenticated;

create or replace function _tc_task_indirizzo_applicato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _tc_conferma_indirizzo(new.id);
  return null;
end;
$$;
revoke execute on function _tc_task_indirizzo_applicato() from public, anon, authenticated;

drop trigger if exists tasks_indirizzo_applicato on tasks;
create trigger tasks_indirizzo_applicato after update on tasks for each row
  when (new.analisi->>'indirizzo_stato' = 'applicato' and old.analisi->>'indirizzo_stato' is distinct from 'applicato')
  execute function _tc_task_indirizzo_applicato();

-- Indirizzo cambiato a mano su Shopify: si registra com'è, così la conferma lo riporta
create or replace function _tc_indirizzo_cambiato() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update tasks t
     set stato = 'completato', motivo = 'Indirizzo dell''ordine cambiato su Shopify',
         analisi = t.analisi || jsonb_build_object(
           'indirizzo_stato', 'applicato',
           'indirizzo_ordine', jsonb_build_object('negozio', new.store_id, 'numero', new.numero),
           'indirizzo_nuovo', jsonb_build_object('via', new.indirizzo->>'via', 'cap', new.indirizzo->>'cap',
                                                 'citta', new.indirizzo->>'citta', 'provincia', new.indirizzo->>'provincia'))
   where t.stato not in ('completato', 'non_completato')
     and t.analisi->>'modifica' = 'indirizzo'
     and t.analisi->'ordini' @> jsonb_build_array(jsonb_build_object('negozio', new.store_id, 'numero', new.numero))
     and position(new.numero in t.titolo) > 0;
  return null;
end;
$$;
revoke execute on function _tc_indirizzo_cambiato() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
