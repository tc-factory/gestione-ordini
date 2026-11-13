-- Messaggi di Facebook (Messenger) e Instagram dei negozi: conversazioni e messaggi.
-- Arrivano dal webhook meta-webhook (in tempo reale) e da social-sync (ogni 5 minuti, recupera anche
-- quello che il webhook non manda); le risposte partono da social-invia. Li vede e risponde lo staff.

create table if not exists public.social_conversazioni (
  id uuid primary key default gen_random_uuid(),
  account uuid not null references public.social_account(id) on delete cascade,
  thread_id text,                         -- id della conversazione su Meta (t_…), se noto
  utente_id text not null,                -- PSID (Messenger) o IGSID (Instagram) del cliente
  utente_nome text,
  ultimo_at timestamptz,
  ultimo_testo text,
  ultimo_da text check (ultimo_da in ('cliente', 'noi')),
  da_leggere boolean not null default false,
  creato_at timestamptz not null default now(),
  unique (account, utente_id)
);
create index if not exists social_conversazioni_ultimo on public.social_conversazioni (ultimo_at desc);

create table if not exists public.social_messaggi (
  id uuid primary key default gen_random_uuid(),
  conversazione uuid not null references public.social_conversazioni(id) on delete cascade,
  mid text unique,                        -- id del messaggio su Meta
  direzione text not null check (direzione in ('in', 'out')),
  testo text,
  allegati jsonb not null default '[]'::jsonb,
  at timestamptz not null default now(),
  inviato_da uuid,                        -- app_users.id di chi ha risposto dal gestionale
  errore text
);
create index if not exists social_messaggi_conv on public.social_messaggi (conversazione, at);

alter table public.social_conversazioni enable row level security;
alter table public.social_messaggi enable row level security;
drop policy if exists social_conversazioni_staff on public.social_conversazioni;
create policy social_conversazioni_staff on public.social_conversazioni for select to authenticated using (app_is_staff());
drop policy if exists social_messaggi_staff on public.social_messaggi;
create policy social_messaggi_staff on public.social_messaggi for select to authenticated using (app_is_staff());

-- Lo staff vede anche gli account collegati (nome, negozio), non i token
drop policy if exists social_account_admin on public.social_account;
drop policy if exists social_account_staff on public.social_account;
create policy social_account_staff on public.social_account for select to authenticated using (app_is_staff());

create or replace function public.tc_social_letta(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not app_is_staff() then return jsonb_build_object('success', false, 'error', 'Accesso negato'); end if;
  update social_conversazioni set da_leggere = false where id = p_id;
  return jsonb_build_object('success', true);
end;
$function$;

-- Lettura ogni 5 minuti (recupera anche i messaggi che il webhook non manda, es. app non pubblicata)
create or replace function public._tc_social_sync_call()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/social-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
end;
$$;
revoke execute on function public._tc_social_sync_call() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'social-sync') then perform cron.unschedule('social-sync'); end if;
  perform cron.schedule('social-sync', '2-59/5 * * * *', 'select _tc_social_sync_call()');
end $$;
