-- Instagram (app Meta "CS Direct Connect", login unificato con token dell'utente di sistema che non scade).
-- L'admin preme "Collega Instagram" in Centro di controllo → Collegamenti: tc_meta_login_inizia crea uno
-- "state" usa e getta, il browser apre il login Meta, Meta rimanda a /functions/v1/meta-login che
-- scambia il codice, legge i profili Instagram concessi e li salva qui.
-- Il token sta in social_token: RLS attiva e nessuna policy, lo legge solo il service role.

create table if not exists public.social_account (
  id uuid primary key default gen_random_uuid(),
  piattaforma text not null check (piattaforma in ('instagram', 'messenger', 'whatsapp')),
  account_id text not null,              -- id Instagram (o pagina / numero per le altre piattaforme)
  username text,
  nome text,
  foto text,
  negozio text,                          -- ciucciamilcalzino, boxfactorylab, bienjugado, liveprinting
  attivo boolean not null default true,
  collegato_at timestamptz not null default now(),
  collegato_da uuid,
  ultimo_errore text,
  unique (piattaforma, account_id)
);
alter table public.social_account enable row level security;
drop policy if exists social_account_admin on public.social_account;
create policy social_account_admin on public.social_account for select using (app_is_admin());

create table if not exists public.social_token (
  account uuid primary key references public.social_account(id) on delete cascade,
  token text not null,
  aggiornato_at timestamptz not null default now()
);
alter table public.social_token enable row level security;

create table if not exists public.meta_login_stati (
  state text primary key,
  utente uuid,
  piattaforma text not null default 'instagram',
  creato_at timestamptz not null default now()
);
alter table public.meta_login_stati enable row level security;

-- Inizio del collegamento: solo admin, lo state vale 24 ore
create or replace function public.tc_meta_login_inizia(p_piattaforma text default 'instagram')
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  delete from meta_login_stati where creato_at < now() - interval '2 days';
  insert into meta_login_stati (state, utente, piattaforma) values (s, auth.uid(), p_piattaforma);
  return jsonb_build_object('success', true, 'state', s);
end;
$function$;

-- Negozio di un account (scelto dall'admin) e scollegamento
create or replace function public.tc_social_account_negozio(p_id uuid, p_negozio text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  update social_account set negozio = nullif(p_negozio, '') where id = p_id;
  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.tc_social_account_scollega(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  delete from social_account where id = p_id;
  return jsonb_build_object('success', true);
end;
$function$;

-- Token di un login che non ha trovato profili: resta qui per controllarlo senza rifare il login (solo service role)
create table if not exists public.meta_token_attesa (
  id bigint generated always as identity primary key,
  token text not null,
  riepilogo jsonb,
  creato_at timestamptz not null default now()
);
alter table public.meta_token_attesa enable row level security;
