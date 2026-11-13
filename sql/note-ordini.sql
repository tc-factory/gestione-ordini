-- ════════════════════════════════════════════════════════
-- T&C Factory — Note del cliente sugli ordini Shopify
--
-- Ogni ordine con una nota del cliente diventa un task "Nota ordine" nel Centro di controllo,
-- con il testo della nota. Se la nota cambia nasce un nuovo task con il testo nuovo.
-- La nota si vede anche sul DDT (riquadro sotto gli indirizzi) e nel riepilogo del mattino.
-- Il task si chiude a mano, a lavoro fatto; da solo solo se l'ordine viene annullato.
-- Richiede cervello.sql e shopify.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

insert into task_tipi (nome, minuti_standard, autonomia, descrizione) values
  ('Nota ordine', 5, 'solo_task', 'Il cliente ha scritto una nota sull''ordine Shopify')
on conflict (nome) do nothing;

create or replace function _tc_nota_ordine_task(o shopify_orders)
returns void security definer set search_path = public language plpgsql as $$
declare v_nota text := btrim(coalesce(o.note, ''));
begin
  if v_nota = '' or o.annullato_at is not null or o.stato_evasione = 'FULFILLED' then return; end if;
  insert into tasks (tipo_id, titolo, descrizione, priorita, macroarea, fonte, fonte_rif, creato_da)
  values ((select id from task_tipi where nome = 'Nota ordine'),
          left('Nota del cliente · ordine ' || o.numero || coalesce(' · ' || o.cliente, ''), 200),
          'Nota del cliente:' || E'\n' || v_nota
            || coalesce(E'\n\nArticoli:\n' || (select string_agg((r->>'qnt') || '× ' || (r->>'titolo') || coalesce(' (' || (r->>'variante') || ')', ''), E'\n')
                                                from jsonb_array_elements(o.righe) r), ''),
          'alta', o.store_id, 'shopify',
          jsonb_build_object('evento_id', 'nota:' || o.id || ':' || md5(v_nota), 'ordine', o.id, 'motivo', 'nota'), 'cervello')
  on conflict (((fonte_rif->>'evento_id'))) where fonte_rif ? 'evento_id' do nothing;
end;
$$;
revoke execute on function _tc_nota_ordine_task(shopify_orders) from public, anon, authenticated;

create or replace function _tc_nota_ordine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _tc_nota_ordine_task(new);
  -- Ordine annullato: la nota non serve più
  if new.annullato_at is not null then
    update tasks set stato = 'completato', motivo = 'Ordine annullato'
     where fonte = 'shopify' and fonte_rif->>'motivo' = 'nota' and fonte_rif->>'ordine' = new.id::text
       and stato not in ('completato', 'non_completato');
  end if;
  return null;
end;
$$;
revoke execute on function _tc_nota_ordine() from public, anon, authenticated;

drop trigger if exists shopify_orders_nota on shopify_orders;
create trigger shopify_orders_nota after insert or update of note, annullato_at on shopify_orders for each row
  when (new.note is not null and btrim(new.note) <> '') execute function _tc_nota_ordine();

-- Ordini già aperti con una nota
select _tc_nota_ordine_task(o) from shopify_orders o
 where o.note is not null and btrim(o.note) <> '' and o.annullato_at is null
   and o.stato_evasione is distinct from 'FULFILLED' and o.creato_at > now() - interval '60 days';

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
