-- ════════════════════════════════════════════════════════
-- T&C Factory — Competenze del team (Centro di controllo → Squadra)
--
-- task_operatori.competenze contiene voci "area:competenza", es. "bienjugado:email".
-- Area = macroarea del task, oppure "produzione" per i task senza negozio.
-- Il piano del giorno assegna un task solo a chi ha la competenza del suo tipo in quell'area;
-- se il tipo non ha competenza, a chi ha almeno una competenza in quell'area.
-- Richiede task-automatici.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

update task_tipi set competenza = 'email'
 where competenza is null and nome in ('Stato ordine', 'Reso o cambio', 'Problema con un ordine', 'Modifica ordine',
       'Informazioni prodotto', 'Preventivo', 'Pagamenti e fatture', 'Mail da gestire', 'Pagamento in sospeso');
update task_tipi set competenza = 'preparazione' where competenza is null and nome in ('Preparare ordine', 'Ordine fermo');
update task_tipi set competenza = 'spedizione'   where competenza is null and nome = 'Tracking mancante';
update task_tipi set competenza = 'lavorazione'  where competenza is null and nome = 'Ordine in scadenza';

create or replace function _tc_task_piano()
returns int security definer set search_path = public language plpgsql as $$
declare t record; v_chi text; n int := 0; v_oggi date := tc_oggi();
begin
  for t in
    select k.id, coalesce(k.macroarea, 'produzione') area, coalesce(k.minuti_stimati, 15) minuti, p.competenza
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
       and case when t.competenza is null
                then exists (select 1 from unnest(o.competenze) v where v like t.area || ':%')
                else (t.area || ':' || t.competenza) = any(o.competenze) end
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
