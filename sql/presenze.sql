-- ════════════════════════════════════════════════════════
-- T&C Factory — Conferma delle presenze (2026-11-17)
--
-- Ognuno ha un orario standard di entrata (task_operatori.ora_inizio). Nei giorni in cui
-- lavora (non in ferie/impegno nel Planner, non festivo, lun-ven) deve confermare di essere
-- al lavoro; la conferma vale solo dalla rete del posto di lavoro (IP pubblico in presenze_reti).
-- Dopo l'orario + 30 minuti senza conferma il gestionale apre un popup a lui e agli addetti
-- (task_operatori.addetto_presenze), che possono confermare per lui, sempre dalla rete del lavoro.
-- Si può rieseguire.
-- ════════════════════════════════════════════════════════

alter table task_operatori add column if not exists ora_inizio time;
alter table task_operatori add column if not exists addetto_presenze boolean not null default false;

create table if not exists presenze (
  nickname       text not null,
  giorno         date not null,
  confermato_at  timestamptz not null default now(),
  confermato_da  text not null,
  ip             text,
  primary key (nickname, giorno)
);
alter table presenze enable row level security;
drop policy if exists "Admin legge presenze" on presenze;
create policy "Admin legge presenze" on presenze for select to authenticated using (app_is_admin());

create table if not exists presenze_reti (
  rete        cidr primary key,
  nome        text not null default '',
  aggiunta_da text,
  aggiunta_at timestamptz not null default now()
);
alter table presenze_reti enable row level security;
drop policy if exists "Admin legge reti" on presenze_reti;
drop policy if exists "Admin toglie reti" on presenze_reti;
create policy "Admin legge reti"  on presenze_reti for select to authenticated using (app_is_admin());
create policy "Admin toglie reti" on presenze_reti for delete to authenticated using (app_is_admin());

-- IP pubblico di chi chiama (intestazioni della richiesta all'API)
create or replace function _tc_ip()
returns inet stable language plpgsql set search_path = public as $$
declare h jsonb; v text;
begin
  h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v := trim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-forwarded-for', ''), ',', 1));
  return nullif(v, '')::inet;
exception when others then return null;
end;
$$;

create or replace function _tc_in_rete_lavoro()
returns boolean stable language sql security definer set search_path = public as $$
  select exists (select 1 from presenze_reti r where _tc_ip() <<= r.rete);
$$;

-- Chi deve confermare oggi: ha un orario ed è nel piano del giorno
create or replace function _tc_presenze_attese()
returns table (nickname text, ora_inizio time, limite time) stable language sql security definer set search_path = public as $$
  select o.nickname, o.ora_inizio, (o.ora_inizio + interval '30 minutes')::time
    from task_operatori o
   where o.ora_inizio is not null and o.nickname <> 'claude' and tc_disponibile(o.nickname, tc_oggi());
$$;

create or replace function _tc_addetto_presenze()
returns boolean stable language sql security definer set search_path = public as $$
  select app_is_admin() or coalesce((select addetto_presenze from task_operatori where nickname = app_nickname()), false);
$$;

-- Stato per il gestionale: la propria presenza e, per admin e addetti, quella di tutti
create or replace function tc_presenze_stato()
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_ora time := (now() at time zone 'Europe/Rome')::time; v_add boolean := _tc_addetto_presenze();
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  return jsonb_build_object('success', true, 'in_rete', _tc_in_rete_lavoro(), 'addetto', v_add, 'ora', to_char(v_ora, 'HH24:MI'),
    'me', (select jsonb_build_object('ora_inizio', to_char(a.ora_inizio, 'HH24:MI'), 'scaduto', v_ora > a.limite,
                                     'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da)
             from _tc_presenze_attese() a left join presenze p on p.nickname = a.nickname and p.giorno = tc_oggi()
            where a.nickname = v_me),
    'tutti', case when v_add then coalesce((
      select jsonb_agg(jsonb_build_object('nickname', a.nickname, 'ora_inizio', to_char(a.ora_inizio, 'HH24:MI'),
                                          'scaduto', v_ora > a.limite, 'confermato_at', p.confermato_at, 'confermato_da', p.confermato_da)
                       order by a.ora_inizio, a.nickname)
        from _tc_presenze_attese() a left join presenze p on p.nickname = a.nickname and p.giorno = tc_oggi()), '[]'::jsonb) end);
end;
$$;

-- Conferma: la propria, o di un altro se si è addetti; sempre dalla rete del lavoro
create or replace function tc_presenza_conferma(p_chi text default null)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); v_chi text := coalesce(nullif(trim(p_chi), ''), app_nickname());
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  if v_chi <> v_me and not _tc_addetto_presenze() then
    return jsonb_build_object('success', false, 'error', 'Solo gli addetti confermano la presenza degli altri');
  end if;
  if not _tc_in_rete_lavoro() then
    return jsonb_build_object('success', false, 'error', 'La presenza si conferma solo da un dispositivo collegato alla rete del posto di lavoro');
  end if;
  if not exists (select 1 from app_users where nickname = v_chi) then
    return jsonb_build_object('success', false, 'error', 'Persona non trovata');
  end if;
  insert into presenze (nickname, giorno, confermato_da, ip) values (v_chi, tc_oggi(), v_me, host(_tc_ip()))
  on conflict (nickname, giorno) do nothing;
  return jsonb_build_object('success', true);
end;
$$;

-- L'admin registra la rete da cui sta usando il gestionale (IPv4 esatto, IPv6 la rete /64)
create or replace function tc_presenze_rete_aggiungi(p_nome text default '')
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_ip inet := _tc_ip(); v_rete cidr;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo gli admin'); end if;
  if v_ip is null then return jsonb_build_object('success', false, 'error', 'Indirizzo della rete non leggibile'); end if;
  v_rete := network(set_masklen(v_ip, case when family(v_ip) = 4 then 32 else 64 end))::cidr;
  insert into presenze_reti (rete, nome, aggiunta_da) values (v_rete, left(coalesce(trim(p_nome), ''), 80), app_nickname())
  on conflict (rete) do update set nome = excluded.nome;
  return jsonb_build_object('success', true, 'rete', v_rete::text);
end;
$$;

revoke execute on function _tc_ip() from public, anon, authenticated;
revoke execute on function _tc_in_rete_lavoro() from public, anon, authenticated;
revoke execute on function _tc_presenze_attese() from public, anon, authenticated;
revoke execute on function _tc_addetto_presenze() from public, anon, authenticated;
revoke execute on function tc_presenze_stato() from public, anon;
revoke execute on function tc_presenza_conferma(text) from public, anon;
revoke execute on function tc_presenze_rete_aggiungi(text) from public, anon;
grant execute on function tc_presenze_stato() to authenticated;
grant execute on function tc_presenza_conferma(text) to authenticated;
grant execute on function tc_presenze_rete_aggiungi(text) to authenticated;
