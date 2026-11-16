-- ════════════════════════════════════════════════════════
-- Più caselle per brand (2026-11-16)
--   • mail_caselle.brand: il brand (pagina Negozi) a cui appartiene la casella; più caselle per brand.
--   • T&C Factory: riccardo@tcfactory.it (id 'tcfactory', già collegata) + info@tcfactory.it (id 'tcfactory_info')
--   • Live Printing: info@liveprinting.it (id 'liveprinting') + riccardo@liveprinting.it (id 'liveprinting_riccardo')
--   • Le caselle interne (T&C Factory) ora si leggono anche: "interna" vuol dire solo che il nome T&C Factory resta nei testi.
--   Le caselle nuove restano spente finché non c'è la password nel secret MAIL_PASSWORD_<ID IN MAIUSCOLO>.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_caselle add column if not exists brand text;
update mail_caselle set brand = coalesce(store_id, id) where brand is null;

insert into mail_caselle (id, indirizzo, nome, brand, interna, attivo) values
  ('tcfactory_info',        'info@tcfactory.it',        'T&C Factory',   'tcfactory',    true,  false),
  ('liveprinting_riccardo', 'riccardo@liveprinting.it', 'Live Printing', 'liveprinting', false, false)
on conflict (id) do update set indirizzo = excluded.indirizzo, nome = excluded.nome, brand = excluded.brand, interna = excluded.interna;

-- riccardo@tcfactory.it finora solo per inviare: da adesso si legge, dalle mail che arrivano da oggi
update mail_caselle set attiva_dal = now(), uidvalidity = null, ultimo_uid = null, ultimo_errore = null
 where id = 'tcfactory' and ultimo_uid is null;

-- Controlli sulle caselle: anche quelle interne, ora che si leggono
do $$
declare d text;
begin
  d := pg_get_functiondef('_tc_problemi'::regproc);
  if d like '%attivo and not interna and%' then execute replace(d, 'attivo and not interna and', 'attivo and'); end if;
  d := pg_get_functiondef('tc_mail_stato'::regproc);
  if d like '%from mail_caselle c where not c.interna%' then execute replace(d, 'from mail_caselle c where not c.interna', 'from mail_caselle c where true'); end if;
end $$;

-- Elenco caselle: anche il brand
create or replace function tc_mail_caselle()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'caselle', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'indirizzo', c.indirizzo, 'nome', c.nome, 'brand', coalesce(c.brand, c.store_id, c.id), 'attiva_dal', c.attiva_dal,
      'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore,
      'non_lette', (select count(distinct m.filo) from mail_messaggi m
                     where m.casella_id = c.id and m.direzione = 'in' and not m.automatica and m.letta_at is null
                       and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
    ) order by c.nome, c.indirizzo) from mail_caselle c where c.attivo
  ), '[]'::jsonb));
end;
$$;

-- Elenco conversazioni: p_casella può essere più caselle separate da virgola (tutte quelle di un brand)
do $$
declare d text;
begin
  d := pg_get_functiondef('tc_mail_lista(text, text, text, timestamptz, integer, text)'::regprocedure);
  if d like '%(p_casella is null or m.casella_id = p_casella)%' then
    execute replace(d, '(p_casella is null or m.casella_id = p_casella)', '(p_casella is null or m.casella_id = any(string_to_array(p_casella, '','')))');
  end if;
end $$;
