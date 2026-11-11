-- ════════════════════════════════════════════════════════
-- T&C Factory — Firme con immagine e firma del negozio (2026-11-11)
--
--   • mail_firme.immagine / larghezza: logo o firma già fatta della persona (bucket mail-firme)
--   • mail_firme_negozio: la firma neutra di ogni casella, usata dalle mail che partono da sole
--     (risposte automatiche del cervello, avvisi di giacenza, svincoli automatici). La modifica l'admin.
--   • bucket mail-firme (privato): persone/<nickname>/<casella>.<ext>, negozi/<casella>.<ext>
--     Le edge function lo leggono con la chiave di servizio e incorporano l'immagine nella mail.
--
-- Richiede mail-archivio-firme-modelli.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table mail_firme add column if not exists immagine text;
alter table mail_firme add column if not exists larghezza int not null default 220;
alter table mail_firme alter column testo set default '';
do $$ begin
  alter table mail_firme add constraint mail_firme_larghezza_chk check (larghezza between 60 and 600);
exception when duplicate_object then null; end $$;

create table if not exists mail_firme_negozio (
  casella_id    text primary key references mail_caselle(id) on delete cascade,
  testo         text not null default '' check (length(testo) <= 2000),
  immagine      text,
  larghezza     int not null default 220 check (larghezza between 60 and 600),
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text
);
alter table mail_firme_negozio enable row level security;
drop policy if exists "Staff legge firme negozio" on mail_firme_negozio;
drop policy if exists "Admin gestisce firme negozio" on mail_firme_negozio;
create policy "Staff legge firme negozio" on mail_firme_negozio for select to authenticated using (app_is_staff());
create policy "Admin gestisce firme negozio" on mail_firme_negozio for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on mail_firme_negozio from anon;
grant select, insert, update, delete on mail_firme_negozio to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mail-firme', 'mail-firme', false, 1048576, array['image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Firme: ognuno le sue immagini" on storage.objects;
drop policy if exists "Firme: admin le immagini dei negozi" on storage.objects;
drop policy if exists "Firme: staff vede le immagini dei negozi" on storage.objects;
create policy "Firme: ognuno le sue immagini" on storage.objects for all to authenticated
  using (bucket_id = 'mail-firme' and (storage.foldername(name))[1] = 'persone' and (storage.foldername(name))[2] = app_nickname())
  with check (bucket_id = 'mail-firme' and (storage.foldername(name))[1] = 'persone' and (storage.foldername(name))[2] = app_nickname());
create policy "Firme: admin le immagini dei negozi" on storage.objects for all to authenticated
  using (bucket_id = 'mail-firme' and (storage.foldername(name))[1] = 'negozi' and app_is_admin())
  with check (bucket_id = 'mail-firme' and (storage.foldername(name))[1] = 'negozi' and app_is_admin());
create policy "Firme: staff vede le immagini dei negozi" on storage.objects for select to authenticated
  using (bucket_id = 'mail-firme' and (storage.foldername(name))[1] = 'negozi' and app_is_staff());

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
