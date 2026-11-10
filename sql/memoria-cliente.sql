-- T&C Factory — Memoria del cliente (2026-11-10)
--
-- I dati essenziali che il cliente ci ha dato nelle mail, per email: il cervello li estrae da ogni
-- mail e li rilegge alla mail dopo, così il cliente non deve ripeterli. Li usano anche lo svincolo
-- GLS (telefono, indirizzo) e il controllo delle giacenze (telefono da chiamare).
--   telefono, campanello: l'ultimo dato dal cliente
--   indirizzo: l'ultimo indirizzo di consegna indicato dal cliente { via, cap, citta, provincia }
--   note: altre informazioni utili [{ testo, at, mail_id }], le più recenti in coda (max 20)

create table if not exists clienti_memoria (
  email         text primary key check (email = lower(email)),
  nome          text,
  telefono      text,
  campanello    text,
  indirizzo     jsonb,
  note          jsonb not null default '[]',
  aggiornato_at timestamptz not null default now()
);

alter table clienti_memoria enable row level security;
drop policy if exists "Staff legge memoria clienti" on clienti_memoria;
drop policy if exists "Admin gestisce memoria clienti" on clienti_memoria;
create policy "Staff legge memoria clienti" on clienti_memoria for select to authenticated using (app_is_staff());
create policy "Admin gestisce memoria clienti" on clienti_memoria for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on clienti_memoria from anon, authenticated;
grant select, insert, update, delete on clienti_memoria to authenticated;
