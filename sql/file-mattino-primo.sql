-- Stampe del giorno: oltre all'ultimo clic si tiene il primo (ora e chi), che un nuovo clic non sovrascrive
alter table public.file_mattino_stampe add column if not exists primo_at timestamptz;
alter table public.file_mattino_stampe add column if not exists primo_da text;
update public.file_mattino_stampe set primo_at = stampato_at, primo_da = stampato_da where primo_at is null;

create or replace function tc_file_mattino_stampato(p_percorso text) returns public.file_mattino_stampe
language plpgsql security definer set search_path = public as $$
declare r public.file_mattino_stampe;
begin
  if not app_vede_scheda('file') then raise exception 'Non autorizzato'; end if;
  insert into file_mattino_stampe (percorso, stampato_at, stampato_da, primo_at, primo_da)
  values (p_percorso, now(), app_nickname(), now(), app_nickname())
  on conflict (percorso) do update set stampato_at = excluded.stampato_at, stampato_da = excluded.stampato_da
  returning * into r;
  return r;
end;
$$;
revoke execute on function tc_file_mattino_stampato(text) from public, anon;
grant  execute on function tc_file_mattino_stampato(text) to authenticated;
