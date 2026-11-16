-- Content Studio — Fase 1: Brand Kit
-- Una scheda per brand (stesso id dei negozi: ciucciamilcalzino, bienjugado, boxfactorylab) passata come
-- contesto a ogni generazione. Gli account Instagram e Facebook non si duplicano: si leggono da
-- social_account con lo stesso negozio. Rieseguibile.

create table if not exists public.brand_kits (
  negozio       text primary key,
  nome          text not null,
  logo_chiaro   text,                                  -- percorso nel bucket brand-kit: logo per fondo chiaro
  logo_scuro    text,                                  -- logo per fondo scuro
  palette       jsonb not null default '[]'::jsonb,    -- [{nome, hex}]
  font          jsonb not null default '{}'::jsonb,    -- {titoli: {nome, file}, testi: {nome, file}}
  tono_voce     text not null default '',
  target        text not null default '',
  prodotti      text not null default '',
  parole_si     text[] not null default '{}',
  parole_no     text[] not null default '{}',
  esempi        jsonb not null default '[]'::jsonb,    -- [{url, immagine, nota}]
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text
);
alter table public.brand_kits enable row level security;

drop policy if exists brand_kits_legge on public.brand_kits;
drop policy if exists brand_kits_modifica on public.brand_kits;
create policy brand_kits_legge on public.brand_kits for select to authenticated using (app_vede_scheda('contenuti'));
create policy brand_kits_modifica on public.brand_kits for update to authenticated
  using (app_vede_scheda('contenuti')) with check (app_vede_scheda('contenuti'));
revoke all on public.brand_kits from anon, authenticated;
grant select, update on public.brand_kits to authenticated;

-- Chi ha modificato e quando
create or replace function public._brand_kits_firma() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.aggiornato_at := now();
  new.aggiornato_da := coalesce(app_nickname(), new.aggiornato_da);
  return new;
end;
$$;
drop trigger if exists brand_kits_firma on public.brand_kits;
create trigger brand_kits_firma before update on public.brand_kits for each row execute function _brand_kits_firma();

-- Bucket pubblico in lettura: loghi, font ed esempi devono poter arrivare ai servizi di grafica (Fase 3)
insert into storage.buckets (id, name, public, file_size_limit)
values ('brand-kit', 'brand-kit', true, 15728640)
on conflict (id) do update set public = true;

drop policy if exists "Content Studio carica brand-kit"  on storage.objects;
drop policy if exists "Content Studio modifica brand-kit" on storage.objects;
drop policy if exists "Content Studio elimina brand-kit"  on storage.objects;
create policy "Content Studio carica brand-kit"  on storage.objects for insert to authenticated with check (bucket_id = 'brand-kit' and app_vede_scheda('contenuti'));
create policy "Content Studio modifica brand-kit" on storage.objects for update to authenticated using (bucket_id = 'brand-kit' and app_vede_scheda('contenuti'));
create policy "Content Studio elimina brand-kit"  on storage.objects for delete to authenticated using (bucket_id = 'brand-kit' and app_vede_scheda('contenuti'));

-- Le righe dei 3 brand (i contenuti precompilati sono in content-studio-brand-kit-dati.sql)
insert into public.brand_kits (negozio, nome) values
  ('ciucciamilcalzino', 'Ciucciami il Calzino'),
  ('bienjugado', 'Bienjugado'),
  ('boxfactorylab', 'Box Factory Lab')
on conflict (negozio) do nothing;

-- Account Instagram e Pagina Facebook del brand (social_account la legge solo l'admin: qui senza token)
create or replace function public.tc_brand_kit_account(p_negozio text)
 returns table (piattaforma text, username text, nome text, foto text)
 language sql stable security definer set search_path to 'public'
as $$
  select a.piattaforma, a.username, a.nome, a.foto from social_account a
   where app_vede_scheda('contenuti') and a.negozio = p_negozio and a.attivo
     and a.piattaforma in ('instagram', 'messenger')
   order by a.piattaforma;
$$;
revoke execute on function public.tc_brand_kit_account(text) from public, anon;
grant  execute on function public.tc_brand_kit_account(text) to authenticated;
