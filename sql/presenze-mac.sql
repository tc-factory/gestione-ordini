-- ════════════════════════════════════════════════════════
-- T&C Factory — Presenza dal Mac (TC Lavoro)
--
-- L'entrata conta da quando si apre il Mac ed è collegato alla rete del lavoro, anche se il
-- gestionale non è aperto: appena la persona usa il Mac, TC Lavoro chiama questa funzione
-- (finché la presenza del giorno non c'è). Se l'IP è di una rete del lavoro la presenza si
-- segna adesso, a nome di chi ha quel Mac. Chi è già segnato (anche assente) resta com'è.
-- ════════════════════════════════════════════════════════

create or replace function tc_lavoro_presenza(p_chiave text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_chi text;
begin
  select utente into v_chi from lavoro_dispositivi where chiave = p_chiave and attivo;
  if v_chi is null then raise exception 'Mac non collegato'; end if;
  update lavoro_dispositivi set ultimo_contatto = now() where chiave = p_chiave;
  if exists (select 1 from presenze where nickname = v_chi and giorno = tc_oggi()) then
    return jsonb_build_object('presente', true);
  end if;
  if not _tc_in_rete_lavoro() then return jsonb_build_object('presente', false); end if;
  insert into presenze (nickname, giorno, confermato_da, ip) values (v_chi, tc_oggi(), 'Mac', host(_tc_ip()))
  on conflict (nickname, giorno) do nothing;
  perform _tc_presenze_restituisci(v_chi);
  return jsonb_build_object('presente', true);
end;
$$;
revoke execute on function tc_lavoro_presenza(text) from public;
grant execute on function tc_lavoro_presenza(text) to anon, authenticated;
