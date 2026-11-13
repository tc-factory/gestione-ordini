-- ════════════════════════════════════════════════════════
-- T&C Factory — Mail: archivio e cestino, firme, modelli, nuove mail (2026-11-11)
--
--   • mail_messaggi.cartella: dove sta davvero la mail sulla casella Aruba (inbox, archivio, cestino)
--     cartella_voluta: dove la deve spostare mail-azioni (null = nessuno spostamento in sospeso)
--     cartella_decisa_at: qualcuno (persona o regola automatica) ha già deciso: le regole non la toccano più
--   • in automatico (_tc_mail_riordina, cron): spam nel Cestino, mail automatiche in Archivio
--   • mail_firme: la firma di ogni persona per ogni casella (senza riga vale quella automatica)
--   • mail_modelli: le mail di richiesta pronte, riempite con i dati dell'ordine
--   • tc_mail_ordini: ordini del negozio della casella, per riempire i modelli
--
-- Richiede mail-sezione.sql. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Cartelle
-- ─────────────────────────────────────────────

alter table mail_messaggi add column if not exists cartella text not null default 'inbox';
alter table mail_messaggi add column if not exists cartella_voluta text;
alter table mail_messaggi add column if not exists cartella_decisa_at timestamptz;
alter table mail_messaggi add column if not exists sposta_errore text;
alter table mail_messaggi add column if not exists sposta_tentativi int not null default 0;
do $$ begin
  alter table mail_messaggi add constraint mail_messaggi_cartella_chk check (cartella in ('inbox', 'archivio', 'cestino'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table mail_messaggi add constraint mail_messaggi_cartella_voluta_chk check (cartella_voluta in ('inbox', 'archivio', 'cestino'));
exception when duplicate_object then null; end $$;
create index if not exists mail_messaggi_da_spostare_idx on mail_messaggi (casella_id) where cartella_voluta is not null;

-- ─────────────────────────────────────────────
-- 2. Caselle, elenco e badge contano solo la posta in arrivo
-- ─────────────────────────────────────────────

create or replace function tc_mail_caselle()
returns jsonb security definer set search_path = public language plpgsql stable as $$
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'caselle', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'indirizzo', c.indirizzo, 'nome', c.nome, 'attiva_dal', c.attiva_dal,
      'ultimo_sync_at', c.ultimo_sync_at, 'ultimo_errore', c.ultimo_errore,
      'non_lette', (select count(distinct m.filo) from mail_messaggi m
                     where m.casella_id = c.id and m.direzione = 'in' and not m.automatica and m.letta_at is null
                       and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
    ) order by c.nome) from mail_caselle c where c.attivo
  ), '[]'::jsonb));
end;
$$;

-- p_vista: 'arrivo', 'da_leggere', 'inviate', 'archivio', 'cestino'
create or replace function tc_mail_lista(p_casella text, p_vista text, p_cerca text, p_prima timestamptz, p_limite int default 50)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_cerca text := nullif(trim(coalesce(p_cerca, '')), '');
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  return jsonb_build_object('success', true, 'fili', coalesce((
    select jsonb_agg(x.f order by x.ultima desc) from (
      select jsonb_build_object(
        'casella_id', m.casella_id,
        'filo', m.filo,
        'ultima_at', max(m.ricevuto_at),
        'oggetto', (array_agg(m.oggetto order by m.ricevuto_at))[1],
        'persona', coalesce((array_agg(coalesce(nullif(m.da_nome, ''), m.da_email) order by m.ricevuto_at desc) filter (where m.direzione = 'in'))[1],
                            (array_agg(m.a order by m.ricevuto_at desc) filter (where m.direzione = 'out'))[1]),
        'email', coalesce((array_agg(m.da_email order by m.ricevuto_at desc) filter (where m.direzione = 'in'))[1],
                          (array_agg(m.a order by m.ricevuto_at desc) filter (where m.direzione = 'out'))[1]),
        'anteprima', left(regexp_replace(coalesce((array_agg(m.testo order by m.ricevuto_at desc) filter (where m.testo is not null))[1], ''), '\s+', ' ', 'g'), 220),
        'messaggi', count(*),
        'non_lette', count(*) filter (where m.direzione = 'in' and m.letta_at is null),
        'allegati', coalesce(sum(jsonb_array_length(m.allegati)), 0),
        'ultima_out', (array_agg(m.direzione order by m.ricevuto_at desc))[1] = 'out',
        'automatica', bool_and(m.automatica or m.direzione = 'out')
      ) as f, max(m.ricevuto_at) as ultima
      from mail_messaggi m
      where (p_casella is null or m.casella_id = p_casella)
      group by m.casella_id, m.filo
      having
        case coalesce(p_vista, 'arrivo')
          when 'arrivo'     then bool_or(m.direzione = 'in' and not m.automatica and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
          when 'da_leggere' then bool_or(m.direzione = 'in' and not m.automatica and m.letta_at is null and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
          -- Con una nostra mail, tranne le conversazioni finite tutte nel cestino
          when 'inviate'    then bool_or(m.direzione = 'out')
                                 and (not bool_or(m.direzione = 'in') or bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) <> 'cestino'))
          when 'archivio'   then bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) = 'archivio')
                                 and not bool_or(m.direzione = 'in' and not m.automatica and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
          when 'cestino'    then bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) = 'cestino')
                                 and not bool_or(m.direzione = 'in' and coalesce(m.cartella_voluta, m.cartella) <> 'cestino')
          else true end
        and (p_prima is null or max(m.ricevuto_at) < p_prima)
        and (v_cerca is null or bool_or(
              m.oggetto ilike '%' || v_cerca || '%' or m.da_email ilike '%' || v_cerca || '%'
              or m.da_nome ilike '%' || v_cerca || '%' or m.a ilike '%' || v_cerca || '%'
              or m.testo ilike '%' || v_cerca || '%'))
      order by max(m.ricevuto_at) desc
      limit least(greatest(coalesce(p_limite, 50), 1), 200)
    ) x
  ), '[]'::jsonb));
end;
$$;

create or replace function tc_mail_badge()
returns int security definer set search_path = public language sql stable as $$
  select case when app_vede_scheda('mail') then (
    select count(distinct (m.casella_id, m.filo))::int from mail_messaggi m
     join mail_caselle c on c.id = m.casella_id and c.attivo
     where m.direzione = 'in' and not m.automatica and m.letta_at is null
       and coalesce(m.cartella_voluta, m.cartella) = 'inbox')
  else 0 end;
$$;

-- La conversazione aperta porta anche cartella e problemi di spostamento
create or replace function tc_mail_filo(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_messaggi jsonb;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;

  select jsonb_agg(jsonb_build_object(
           'id', m.id, 'direzione', m.direzione, 'da_email', m.da_email, 'da_nome', m.da_nome, 'a', m.a,
           'oggetto', m.oggetto, 'ricevuto_at', m.ricevuto_at, 'testo', m.testo, 'testo_citato', m.testo_citato,
           'allegati', m.allegati, 'automatica', m.automatica, 'message_id', m.message_id,
           'letta_at', m.letta_at, 'letta_da', m.letta_da,
           'cartella', coalesce(m.cartella_voluta, m.cartella), 'in_spostamento', m.cartella_voluta is not null,
           'sposta_errore', m.sposta_errore) order by m.ricevuto_at)
    into v_messaggi
    from mail_messaggi m where m.casella_id = p_casella and m.filo = p_filo;
  if v_messaggi is null then return jsonb_build_object('success', false, 'error', 'Conversazione non trovata'); end if;

  update mail_messaggi set letta_at = now(), letta_da = app_nickname()
   where casella_id = p_casella and filo = p_filo and letta_at is null;

  return jsonb_build_object('success', true, 'messaggi', v_messaggi, 'tasks', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'titolo', t.titolo, 'stato', t.stato, 'assegnato_a', t.assegnato_a, 'mail_id', t.mail_id,
             'bozza_risposta', t.bozza_risposta, 'risposta_inviata_at', t.risposta_inviata_at) order by t.created_at)
      from tasks t join mail_messaggi m on m.id = t.mail_id
     where m.casella_id = p_casella and m.filo = p_filo
  ), '[]'::jsonb));
end;
$$;

-- ─────────────────────────────────────────────
-- 3. Spostare: una persona (archivio, cestino, di nuovo in arrivo) o lo spam
-- ─────────────────────────────────────────────

-- Le mail ricevute della conversazione vanno in p_dest; lo spostamento su Aruba lo fa mail-azioni
create or replace function tc_mail_sposta(p_casella text, p_filo text, p_dest text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare n int;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  if p_dest not in ('inbox', 'archivio', 'cestino') then return jsonb_build_object('success', false, 'error', 'Cartella non valida'); end if;
  update mail_messaggi
     set cartella_voluta = case when cartella = p_dest then null else p_dest end,
         cartella_decisa_at = now(), sposta_errore = null, sposta_tentativi = 0,
         letta_at = case when p_dest = 'inbox' then letta_at else coalesce(letta_at, now()) end,
         letta_da = case when p_dest = 'inbox' or letta_at is not null then letta_da else app_nickname() end
   where casella_id = p_casella and filo = p_filo and direzione = 'in';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('success', false, 'error', 'Questa conversazione ha solo mail inviate: non c''è nulla da spostare'); end if;
  return jsonb_build_object('success', true, 'spostate', n);
end;
$$;
revoke execute on function tc_mail_sposta(text, text, text) from public, anon;
grant  execute on function tc_mail_sposta(text, text, text) to authenticated;

-- È spam: il mittente viene ricordato (il cervello scarterà le sue mail), i task aperti spariscono, tutto nel cestino
create or replace function tc_mail_spam(p_casella text, p_filo text)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); m record;
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  for m in select id, da_email from mail_messaggi
            where casella_id = p_casella and filo = p_filo and direzione = 'in' and da_email is not null
            order by ricevuto_at desc loop
    perform _tc_mail_regola(m.id, 'scarta');
    exit;   -- basta l'ultima: il mittente è la regola
  end loop;
  update eventi e set esito = 'Segnata come spam da ' || v_me, task_id = null
    from tasks t join mail_messaggi mm on mm.id = t.mail_id
   where e.task_id = t.id and mm.casella_id = p_casella and mm.filo = p_filo
     and t.risposta_inviata_at is null and t.stato not in ('completato', 'non_completato');
  delete from tasks t using mail_messaggi mm
   where mm.id = t.mail_id and mm.casella_id = p_casella and mm.filo = p_filo
     and t.risposta_inviata_at is null and t.stato not in ('completato', 'non_completato');
  return tc_mail_sposta(p_casella, p_filo, 'cestino');
end;
$$;
revoke execute on function tc_mail_spam(text, text) from public, anon;
grant  execute on function tc_mail_spam(text, text) to authenticated;

-- Regole automatiche + chiamata a mail-azioni per le caselle con spostamenti in sospeso.
-- Solo mail mai toccate da una persona (cartella_decisa_at null): rimesse in arrivo a mano, restano lì.
create or replace function _tc_mail_riordina()
returns void security definer set search_path = public language plpgsql as $$
declare v_key text;
begin
  -- Spam riconosciuto dal cervello o segnato dal team → Cestino
  update mail_messaggi m
     set cartella_voluta = 'cestino', cartella_decisa_at = now(), letta_at = coalesce(m.letta_at, now()), letta_da = coalesce(m.letta_da, 'sistema')
    from eventi e
   where e.fonte = 'mail' and e.payload->>'mail_id' = m.id::text
     and (e.esito like 'Scartata (spam_phishing)%' or e.esito like 'Scartata: mittente segnato come spam%' or e.esito like 'Segnata come spam%')
     and m.direzione = 'in' and m.cartella = 'inbox' and m.cartella_decisa_at is null;

  -- Mail automatiche (notifiche, newsletter, avvisi) → Archivio
  update mail_messaggi m
     set cartella_voluta = 'archivio', cartella_decisa_at = now()
   where m.direzione = 'in' and m.automatica and m.cartella = 'inbox' and m.cartella_decisa_at is null;

  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'shopify_sync_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url     := 'https://gdtlpyowpbwetnovxget.supabase.co/functions/v1/mail-azioni',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-key', v_key),
    body    := jsonb_build_object('azione', 'sposta', 'casella', c.casella_id),
    timeout_milliseconds := 120000
  ) from (select distinct casella_id from mail_messaggi
           where cartella_voluta is not null and cartella_voluta <> cartella and sposta_tentativi < 5) c;
end;
$$;
revoke execute on function _tc_mail_riordina() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mail-riordina') then
    perform cron.unschedule('mail-riordina');
  end if;
  perform cron.schedule('mail-riordina', '3-59/5 * * * *', 'select _tc_mail_riordina()');
end $$;

-- ─────────────────────────────────────────────
-- 4. Firme: ognuno legge e scrive solo le sue
-- ─────────────────────────────────────────────

create table if not exists mail_firme (
  nickname      text not null,
  casella_id    text not null references mail_caselle(id) on delete cascade,
  testo         text not null check (length(testo) <= 2000),
  aggiornato_at timestamptz not null default now(),
  primary key (nickname, casella_id)
);
alter table mail_firme enable row level security;
drop policy if exists "Ognuno gestisce le sue firme" on mail_firme;
create policy "Ognuno gestisce le sue firme" on mail_firme for all to authenticated
  using (nickname = app_nickname()) with check (nickname = app_nickname());
revoke all on mail_firme from anon;
grant select, insert, update, delete on mail_firme to authenticated;

-- ─────────────────────────────────────────────
-- 5. Modelli: li legge chi vede le mail, li modifica l'admin
--    Dati: {nome} {ordine} {data_ordine} {prodotti} {indirizzo} {telefono} {totale} {negozio}
--    Una riga con un dato che manca non si scrive; senza {nome} resta "Ciao,".
-- ─────────────────────────────────────────────

create table if not exists mail_modelli (
  id         uuid primary key default gen_random_uuid(),
  titolo     text not null check (length(trim(titolo)) between 1 and 80),
  oggetto    text not null default '' check (length(oggetto) <= 200),
  testo      text not null check (length(testo) <= 10000),
  ordine     int not null default 0,
  attivo     boolean not null default true,
  chiave     text unique,                 -- modelli di partenza: si inseriscono una volta sola
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text
);
alter table mail_modelli enable row level security;
drop policy if exists "Chi vede le mail legge i modelli" on mail_modelli;
drop policy if exists "Admin gestisce i modelli" on mail_modelli;
create policy "Chi vede le mail legge i modelli" on mail_modelli for select to authenticated using (app_vede_scheda('mail'));
create policy "Admin gestisce i modelli" on mail_modelli for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on mail_modelli from anon;
grant select, insert, update, delete on mail_modelli to authenticated;

insert into mail_modelli (chiave, ordine, titolo, oggetto, testo) values
('telefono', 1, 'Numero di telefono', 'Ordine {ordine} – numero di telefono per la consegna',
'Ciao {nome},
per la consegna il corriere ha bisogno di un numero di telefono a cui chiamarti se trova qualche difficoltà.
Puoi rispondere a questa mail con il tuo numero di cellulare?

Ordine {ordine} del {data_ordine}

Grazie,'),
('indirizzo', 2, 'Indirizzo di spedizione', 'Ordine {ordine} – indirizzo di spedizione',
'Ciao {nome},
prima di spedire vogliamo essere sicuri che il pacco arrivi senza problemi.
L''indirizzo che abbiamo è: {indirizzo}
Puoi controllarlo e scriverci se manca qualcosa (numero civico, scala, interno, nome sul citofono)?

Ordine {ordine} del {data_ordine}

Grazie,'),
('numero_ordine', 3, 'Numero d''ordine', 'Il tuo ordine',
'Ciao {nome},
per aiutarti dobbiamo trovare il tuo ordine.
Puoi scriverci il numero d''ordine (lo trovi nella mail di conferma, inizia con #) oppure nome e cognome usati per l''acquisto?

Grazie,'),
('foto', 4, 'Foto del problema', 'Ordine {ordine} – foto del prodotto',
'Ciao {nome},
ci dispiace per il problema.
Per capire cosa è successo e risolvere il prima possibile, puoi mandarci qualche foto del prodotto ricevuto e della confezione?
Se il problema riguarda la stampa o una cucitura, una foto da vicino ci aiuta molto.

Ordine {ordine} del {data_ordine}

Grazie,'),
('file_stampa', 5, 'Logo o file da stampare', 'Ordine {ordine} – file per la personalizzazione',
'Ciao {nome},
per preparare la personalizzazione ci serve il file della grafica in buona qualità.
Puoi mandarcelo rispondendo a questa mail? Vanno bene PDF, AI, SVG oppure PNG ad alta risoluzione (almeno 2000 pixel sul lato lungo, meglio se con lo sfondo trasparente).
Appena lo riceviamo lo controlliamo e mettiamo in lavorazione l''ordine.

Ordine {ordine} del {data_ordine}
Prodotti: {prodotti}

Grazie,'),
('testo_stampa', 6, 'Conferma testo da stampare', 'Ordine {ordine} – conferma del testo da stampare',
'Ciao {nome},
prima di stampare vogliamo essere sicuri che il testo della personalizzazione sia giusto.
Puoi confermarci il testo esatto da stampare, con maiuscole, accenti e spazi come li vuoi?
Finché non riceviamo la conferma teniamo l''ordine fermo, così non sbagliamo nulla.

Ordine {ordine} del {data_ordine}
Prodotti: {prodotti}

Grazie,'),
('taglia_colore', 7, 'Taglia o colore', 'Ordine {ordine} – taglia e colore',
'Ciao {nome},
prima di preparare il tuo ordine ci serve una conferma sulla taglia o sul colore.
Puoi rispondere a questa mail indicandoci cosa preferisci? Appena ci scrivi prepariamo la spedizione.

Ordine {ordine} del {data_ordine}
Prodotti: {prodotti}

Grazie,'),
('bonifico', 8, 'Pagamento con bonifico', 'Ordine {ordine} – pagamento con bonifico',
'Ciao {nome},
il tuo ordine è in attesa del pagamento con bonifico.
Totale da pagare: {totale}
I dati per il bonifico sono nella mail di conferma dell''ordine. Quando hai fatto il pagamento, rispondi a questa mail con la contabile: così mettiamo subito in lavorazione l''ordine.
Se hai già pagato, mandaci la contabile e controlliamo noi.

Ordine {ordine} del {data_ordine}

Grazie,')
on conflict (chiave) do nothing;

-- ─────────────────────────────────────────────
-- 6. Ordini per i modelli: del negozio della casella, per numero, email o nome
-- ─────────────────────────────────────────────

create or replace function tc_mail_ordini(p_casella text, p_cerca text)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_store text; v_q text := lower(trim(coalesce(p_cerca, '')));
begin
  if not app_vede_scheda('mail') then return jsonb_build_object('success', false, 'error', 'Non hai accesso alle mail'); end if;
  select store_id into v_store from mail_caselle where id = p_casella;
  if v_store is null or length(v_q) < 2 then return jsonb_build_object('success', true, 'ordini', '[]'::jsonb); end if;
  return jsonb_build_object('success', true, 'ordini', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'numero', o.numero, 'creato_at', o.creato_at, 'cliente', o.cliente, 'email', o.email,
             'telefono', o.telefono, 'totale', o.totale, 'valuta', o.valuta, 'stato_pagamento', o.stato_pagamento,
             'stato_evasione', o.stato_evasione, 'righe', o.righe, 'indirizzo', o.indirizzo, 'tracking', o.tracking) order by o.creato_at desc)
      from (select * from shopify_orders o
             where o.store_id = v_store and o.annullato_at is null
               and (lower(o.email) = v_q
                    or ltrim(o.numero, '#') = ltrim(v_q, '#')
                    or (length(v_q) >= 3 and (lower(o.cliente) like '%' || v_q || '%' or lower(o.email) like '%' || v_q || '%')))
             order by o.creato_at desc limit 8) o
  ), '[]'::jsonb));
end;
$$;
revoke execute on function tc_mail_ordini(text, text) from public, anon;
grant  execute on function tc_mail_ordini(text, text) to authenticated;

-- ════════════════════════════════════════════════════════
-- FINE SCRIPT
-- ════════════════════════════════════════════════════════
