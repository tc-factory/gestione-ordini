-- ════════════════════════════════════════════════════════
-- T&C Factory — Cervello: conoscenza dei negozi, correzioni, briefing, report, avvisi
--
--   • negozi_conoscenza: spedizioni, resi e regole di ogni negozio, usate per le bozze
--   • mail_regole: le correzioni fatte dal team (mittente sempre spam o sempre vero);
--     gli ultimi esempi vengono mostrati al cervello, che impara anche sui mittenti nuovi
--   • briefing del mattino: un messaggio in CS a ogni persona con task, uno generale agli admin
--   • tc_report: dati della scheda Report
--   • controllo dei collegamenti: avviso agli admin se un collegamento si ferma
-- I messaggi automatici sono scritti "da sé stessi": messages.mittente deve essere un utente.
-- Richiede task-automatici.sql già eseguito. Si può rieseguire.
-- ════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1. Conoscenza dei negozi
-- ─────────────────────────────────────────────

create table if not exists negozi_conoscenza (
  store_id      text primary key references shopify_stores(id) on delete cascade,
  testo         text not null default '' check (length(testo) <= 20000),
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text
);
alter table negozi_conoscenza enable row level security;
drop policy if exists "Admin gestisce conoscenza" on negozi_conoscenza;
create policy "Admin gestisce conoscenza" on negozi_conoscenza for all to authenticated using (app_is_admin()) with check (app_is_admin());
revoke all on negozi_conoscenza from anon, authenticated;
grant select, insert, update on negozi_conoscenza to authenticated;

-- ─────────────────────────────────────────────
-- 2. Correzioni
-- ─────────────────────────────────────────────

create table if not exists mail_regole (
  mittente   text primary key check (mittente = lower(mittente)),
  azione     text not null check (azione in ('scarta', 'task')),
  esempio    text,                 -- oggetto e inizio della mail, mostrati al cervello
  creato_da  text,
  created_at timestamptz not null default now()
);
alter table mail_regole enable row level security;
drop policy if exists "Admin legge regole"  on mail_regole;
drop policy if exists "Admin toglie regole" on mail_regole;
create policy "Admin legge regole"  on mail_regole for select to authenticated using (app_is_admin());
create policy "Admin toglie regole" on mail_regole for delete to authenticated using (app_is_admin());
revoke all on mail_regole from anon, authenticated;
grant select, delete on mail_regole to authenticated;

create or replace function _tc_mail_regola(p_mail uuid, p_azione text)
returns void security definer set search_path = public language plpgsql as $$
declare m mail_messaggi%rowtype;
begin
  select * into m from mail_messaggi where id = p_mail;
  if not found or m.da_email is null then return; end if;
  insert into mail_regole (mittente, azione, esempio, creato_da)
  values (lower(m.da_email), p_azione, left(coalesce(m.oggetto, '(senza oggetto)') || ' — ' || coalesce(m.testo, ''), 300), app_nickname())
  on conflict (mittente) do update set azione = excluded.azione, esempio = excluded.esempio,
    creato_da = excluded.creato_da, created_at = now();
end;
$$;
revoke execute on function _tc_mail_regola(uuid, text) from public, anon, authenticated;

-- Il task nasce da spam: sparisce e il mittente viene ricordato
create or replace function tc_task_spam(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
declare v_me text := app_nickname(); t tasks%rowtype;
begin
  if v_me is null then return jsonb_build_object('success', false, 'error', 'Sessione non valida'); end if;
  select * into t from tasks where id = p_id for update;
  if not found or t.mail_id is null then return jsonb_build_object('success', false, 'error', 'Task non trovato'); end if;
  if not app_is_admin() and t.assegnato_a is not null and t.assegnato_a <> v_me then
    return jsonb_build_object('success', false, 'error', 'Il task è assegnato a ' || t.assegnato_a);
  end if;
  if t.risposta_inviata_at is not null then return jsonb_build_object('success', false, 'error', 'A questa mail è già stato risposto'); end if;
  perform _tc_mail_regola(t.mail_id, 'scarta');
  update eventi set esito = 'Segnata come spam da ' || v_me, task_id = null where task_id = t.id;
  delete from tasks where id = t.id;
  return jsonb_build_object('success', true);
end;
$$;
revoke execute on function tc_task_spam(uuid) from public, anon;
grant  execute on function tc_task_spam(uuid) to authenticated;

-- Mail scartata per errore: diventa un task e il mittente viene ricordato come vero
create or replace function tc_evento_crea_task(p_id uuid)
returns jsonb security definer set search_path = public language plpgsql as $$
declare e eventi%rowtype; m mail_messaggi%rowtype; v_store text; v_task uuid;
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  select * into e from eventi where id = p_id and fonte = 'mail' for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Mail non trovata'); end if;
  if e.task_id is not null then return jsonb_build_object('success', false, 'error', 'Il task esiste già'); end if;
  select * into m from mail_messaggi where id = (e.payload->>'mail_id')::uuid;
  select store_id into v_store from mail_caselle where id = e.account;

  insert into tasks (tipo_id, titolo, descrizione, macroarea, mail_id, fonte, fonte_rif)
  values ((select id from task_tipi where nome = 'Mail da gestire'),
          left('Rispondere a ' || coalesce(m.da_nome, m.da_email, 'mail') || ': ' || coalesce(m.oggetto, '(senza oggetto)'), 200),
          'Mail scartata dal cervello e recuperata a mano. Motivo dello scarto: ' || coalesce(e.esito, '—'),
          v_store, m.id, 'mail', jsonb_build_object('evento_id', e.id))
  returning id into v_task;

  update eventi set task_id = v_task where id = e.id;
  perform _tc_mail_regola(m.id, 'task');
  return jsonb_build_object('success', true, 'task', v_task);
end;
$$;

-- ─────────────────────────────────────────────
-- 3. Avvisi agli admin
-- ─────────────────────────────────────────────

create or replace function _tc_avvisa_admin(p_testo text)
returns void security definer set search_path = public language sql as $$
  insert into messages (mittente, destinatario, testo, riferimento)
  select nickname, nickname, left(p_testo, 2000),
         jsonb_build_object('tipo', 'pagina', 'id', 'controllo', 'label', 'Centro di controllo', 'hash', '#/controllo')
    from app_users where is_admin;
$$;
revoke execute on function _tc_avvisa_admin(text) from public, anon, authenticated;

create table if not exists avvisi_collegamenti (
  chiave   text primary key,
  ultimo_at timestamptz not null default now()
);
alter table avvisi_collegamenti enable row level security;
revoke all on avvisi_collegamenti from anon, authenticated;

-- Problemi attuali dei collegamenti: chiave e testo
create or replace function _tc_problemi()
returns table (chiave text, testo text) security definer set search_path = public language sql stable as $$
  select 'shopify:' || id, 'Shopify ' || nome || ': ' || coalesce(ultimo_errore, 'nessun aggiornamento da più di 20 minuti')
    from shopify_stores where attivo and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'mail:' || id, 'Casella ' || indirizzo || ': ' || coalesce(ultimo_errore, 'nessun controllo da più di 20 minuti')
    from mail_caselle where attivo and (ultimo_errore is not null or ultimo_sync_at is null or ultimo_sync_at < now() - interval '20 minutes')
  union all
  select 'cervello', 'Cervello: ' || count(*) || ' mail in attesa da più di 30 minuti'
    from eventi where fonte = 'mail' and elaborato_at is null and ricevuto_at < now() - interval '30 minutes'
  having count(*) > 0;
$$;
revoke execute on function _tc_problemi() from public, anon, authenticated;

-- Un avviso per problema, ripetuto al massimo ogni 6 ore; risolto il problema si azzera
create or replace function _tc_controllo_collegamenti()
returns void security definer set search_path = public language plpgsql as $$
declare v_testo text;
begin
  delete from avvisi_collegamenti a where not exists (select 1 from _tc_problemi() p where p.chiave = a.chiave);
  select string_agg(p.testo, E'\n') into v_testo from _tc_problemi() p
   where not exists (select 1 from avvisi_collegamenti a where a.chiave = p.chiave and a.ultimo_at > now() - interval '6 hours');
  if v_testo is null then return; end if;
  insert into avvisi_collegamenti (chiave)
  select p.chiave from _tc_problemi() p on conflict (chiave) do update set ultimo_at = now();
  perform _tc_avvisa_admin(E'⚠️ Problema ai collegamenti\n' || v_testo);
end;
$$;
revoke execute on function _tc_controllo_collegamenti() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. Briefing del mattino
-- ─────────────────────────────────────────────

create or replace function _tc_briefing()
returns void security definer set search_path = public language plpgsql as $$
declare u record; v_oggi date := tc_oggi(); v_dal timestamptz := ((v_oggi - 1)::timestamp at time zone 'Europe/Rome');
        v_al timestamptz := (v_oggi::timestamp at time zone 'Europe/Rome'); v_macro text; v_prob text;
begin
  -- A ogni persona: il suo giorno
  for u in
    select assegnato_a nick, count(*) n, sum(minuti_stimati) minuti,
           count(*) filter (where priorita = 'urgente') urgenti,
           count(*) filter (where giorno < v_oggi) arretrati
      from tasks
     where assegnato_a is not null and giorno <= v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato')
     group by 1
  loop
    insert into messages (mittente, destinatario, testo, riferimento)
    values (u.nick, u.nick,
      'Buongiorno! Oggi hai ' || u.n || ' task'
        || ' (circa ' || (u.minuti / 60) || ' h ' || (u.minuti % 60) || ' min)'
        || case when u.urgenti > 0 then ', ' || u.urgenti || ' urgenti' else '' end
        || case when u.arretrati > 0 then ', ' || u.arretrati || ' arretrati dai giorni scorsi' else '' end || '.',
      jsonb_build_object('tipo', 'pagina', 'id', 'controllo', 'label', 'Tasks', 'hash', '#/controllo'));
  end loop;

  -- Agli admin: il quadro generale
  select string_agg(coalesce(s.nome, 'Senza macroarea') || ': ' || x.n, ', ' order by x.n desc) into v_macro
    from (select macroarea, count(*) n from tasks
           where giorno <= v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato') group by 1) x
    left join shopify_stores s on s.id = x.macroarea;
  select string_agg(testo, E'\n') into v_prob from _tc_problemi();

  perform _tc_avvisa_admin(
    'Buongiorno! Il quadro di oggi.' || E'\n\n' ||
    'Task aperti: ' || (select count(*) from tasks where giorno <= v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'))
      || ' (in coda comune ' || (select count(*) from tasks where assegnato_a is null and giorno <= v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'))
      || ', urgenti ' || (select count(*) from tasks where priorita = 'urgente' and giorno <= v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'))
      || ', arretrati ' || (select count(*) from tasks where giorno < v_oggi and stato in ('da_fare', 'in_lavorazione', 'in_pausa', 'rimandato'))
      || ', bloccati ' || (select count(*) from tasks where stato = 'bloccato') || ')' || E'\n' ||
    coalesce('Per macroarea: ' || v_macro || E'\n', '') || E'\n' ||
    'Ieri: ' || (select count(*) from tasks where completato_at >= v_dal and completato_at < v_al) || ' task completati, '
      || (select count(*) from shopify_orders where creato_at >= v_dal and creato_at < v_al) || ' ordini online, '
      || (select count(*) from mail_messaggi where direzione = 'in' and not automatica and ricevuto_at >= v_dal and ricevuto_at < v_al) || ' mail da persone, '
      || (select count(*) from mail_messaggi where direzione = 'out' and ricevuto_at >= v_dal and ricevuto_at < v_al) || ' risposte inviate.' || E'\n\n' ||
    coalesce('⚠️ Collegamenti:' || E'\n' || v_prob, 'Collegamenti: tutto a posto.'));
end;
$$;
revoke execute on function _tc_briefing() from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 5. Report (solo admin)
-- ─────────────────────────────────────────────

create or replace function tc_report(p_dal date, p_al date)
returns jsonb security definer set search_path = public language plpgsql stable as $$
declare v_da timestamptz := (p_dal::timestamp at time zone 'Europe/Rome');
        v_a  timestamptz := ((p_al + 1)::timestamp at time zone 'Europe/Rome');
begin
  if not app_is_admin() then return jsonb_build_object('success', false, 'error', 'Solo admin'); end if;
  return jsonb_build_object('success', true,
    'operatori', tc_task_punteggi(p_dal, p_al)->'punteggi',
    'ore', coalesce((select jsonb_object_agg(assegnato_a, s) from (
        select assegnato_a, sum(lavorato_sec) s from tasks where assegnato_a is not null and giorno between p_dal and p_al group by 1) x), '{}'::jsonb),
    'task', jsonb_build_object(
      'creati', (select count(*) from tasks where created_at >= v_da and created_at < v_a),
      'completati', (select count(*) from tasks where completato_at >= v_da and completato_at < v_a),
      'per_fonte', coalesce((select jsonb_object_agg(fonte, n) from (select fonte, count(*) n from tasks where created_at >= v_da and created_at < v_a group by 1) x), '{}'::jsonb)),
    'mail', jsonb_build_object(
      'da_persone', (select count(*) from mail_messaggi where direzione = 'in' and not automatica and ricevuto_at >= v_da and ricevuto_at < v_a),
      'risposte', (select count(*) from mail_messaggi where direzione = 'out' and ricevuto_at >= v_da and ricevuto_at < v_a),
      'automatiche', (select count(*) from tasks where analisi->>'automatica' = 'true' and created_at >= v_da and created_at < v_a),
      'scartate', (select count(*) from eventi where fonte = 'mail' and task_id is null and elaborato_at >= v_da and elaborato_at < v_a),
      'minuti_risposta', (select round((percentile_cont(0.5) within group (order by extract(epoch from t.risposta_inviata_at - m.ricevuto_at)) / 60)::numeric)
                            from tasks t join mail_messaggi m on m.id = t.mail_id
                           where t.risposta_inviata_at >= v_da and t.risposta_inviata_at < v_a)),
    'negozi', coalesce((select jsonb_agg(jsonb_build_object('nome', s.nome, 'ordini', x.n, 'totale', x.tot, 'valuta', x.valuta) order by x.n desc) from (
        select store_id, count(*) n, sum(totale) filter (where annullato_at is null) tot, min(valuta) valuta
          from shopify_orders where creato_at >= v_da and creato_at < v_a group by 1) x
        join shopify_stores s on s.id = x.store_id), '[]'::jsonb));
end;
$$;
revoke execute on function tc_report(date, date) from public, anon;
grant  execute on function tc_report(date, date) to authenticated;

-- ─────────────────────────────────────────────
-- 6. Cron: briefing dopo il piano del giorno, controllo ogni 15 minuti
-- ─────────────────────────────────────────────

do $$
begin
  if exists (select 1 from cron.job where jobname = 'briefing')              then perform cron.unschedule('briefing');              end if;
  if exists (select 1 from cron.job where jobname = 'controllo-collegamenti') then perform cron.unschedule('controllo-collegamenti'); end if;
  perform cron.schedule('briefing', '40 6 * * 1-6', 'select _tc_briefing()');

end $$;

-- ════════════════════════════════════════════════════════
-- Testi iniziali
-- ════════════════════════════════════════════════════════

-- Testi iniziali: politiche pubblicate sui siti. Non sovrascrive quelli già modificati.
insert into negozi_conoscenza (store_id, testo) values ('ciucciamilcalzino', $testo$SPEDIZIONI
Evasione ordine: Il tuo ordine sarà affidato al Corriere entro 48/72 ore, festivi esclusi.
Corriere Utilizzato: GLS Corriere Espresso
Tempi di consegna: 24/48 ore lavorative dalla conferma dell'ordine.
Costi di spedizione: Specificati durante la fase di checkout.
Tracking: Il codice di tracciamento verrà inviato via email al momento della spedizione.
Non si effettuano spedizioni nei giorni festivi e nei weekend.

RESI E RIMBORSI
La nostra informativa sui resi entro 14 giorni prevede che, dopo la ricezione di un articolo, hai 14 giorni di tempo per richiedere un reso.
Perché sia idoneo al reso, l'articolo deve essere nelle stesse condizioni in cui lo hai ricevuto, non deve essere stato indossato o utilizzato, deve avere tutti i cartellini e deve essere contenuto nell'imballaggio originario. Inoltre, avrai bisogno della ricevuta o di una prova d'acquisto. Gli articoli "personalizzati" non sono idonei al reso, ad eccezione di articoli che presentano difetti di fabbrica.
Per avviare un reso, contattaci all'indirizzo info@ciucciamilcalzino.it. I resi dovranno essere spediti al seguente indirizzo: Via dei Calzolai, 92 - 55041 Camaiore (LU). 
Se il reso viene accettato, ti invieremo un'etichetta di spedizione per il reso e le istruzioni su come e dove spedire il pacco. Gli articoli inviati senza una precedente richiesta di reso non saranno accettati.
Per qualsiasi domanda sui resi, contattaci in qualsiasi momento all'indirizzo info@ciucciamilcalzino.it.
Danni e problemi
Ispeziona l'ordine al momento della ricezione e contattaci immediatamente in caso di difetti o danni o se hai ricevuto l'articolo sbagliato. In questo modo, potremo valutare il problema e fare in modo di risolverlo.
Eccezioni / articoli non restituibili
Determinati tipi di articoli non possono essere restituiti, come i beni deperibili (ad esempio cibo, fiori o piante), i prodotti su misura (ad esempio ordini speciali o articoli personalizzati) e i prodotti per la cura della persona (ad esempio prodotti di bellezza). Inoltre, non accettiamo il reso di materiali pericolosi, liquidi infiammabili o gas. Se hai domande o dubbi su un articolo specifico, non esitare a contattarci.
Sfortunatamente non possiamo accettare il reso di articoli in promo o buoni regalo.
Sostituzioni
Il modo più rapido per assicurarti di ricevere ciò che desideri è restituire l'articolo ricevuto e, quando il reso sarà stato accettato, acquistare il nuovo articolo a parte.
Periodo di riflessione di 14 giorni per l'Unione Europea
Nonostante quanto sopra affermato, se la merce viene spedita nell'Unione Europea, hai il diritto di annullare o restituire l'ordine entro 14 giorni per qualsiasi motivo e senza dover fornire alcuna giustificazione. Come sopra, l'articolo deve essere nelle stesse condizioni in cui lo hai ricevuto, non deve essere stato indossato o utilizzato, deve avere tutti i cartellini e deve essere contenuto nell'imballaggio originario. Inoltre, avrai bisogno della ricevuta o di una prova d'acquisto.
Rimborsi
Non appena avremo ricevuto e ispezionato il tuo reso, ti avviseremo per comunicarti se il rimborso è stato approvato o meno. In caso di approvazione, entro 10 giorni lavorativi riceverai il rimborso in automatico attraverso il metodo di pagamento originario. Potrebbe volerci del tempo prima che la banca o la società che ha emesso la carta di credito elaborino e rendano visibile il rimborso.
Una volta passati più di 15 giorni lavorativi dall'approvazione del reso, contattaci all'indirizzo info@ciucciamilcalzino.it.$testo$) on conflict (store_id) do nothing;
insert into negozi_conoscenza (store_id, testo) values ('boxfactorylab', $testo$RESI E RIMBORSI
Il rimborso è disponibile solo nel caso in cui un qualsiasi articolo risulti difettoso, puoi richiedere il diritto di recesso entro 7 giorni lavorativi dalla data di consegna dell’ordine. Potrai richiedere un cambio con altri prodotti o il rimborso di quanto speso.
Contattaci alla mail info@boxfactorylab.it per avviare la procedura di reso e riceverai una risposta entro 24 ore.
Nel caso di acquisto di prodotti personalizzati non è possibile fare resi o rimborsi dovuti a ripensamenti, a meno che non siano presenti anomalie di natura strutturale (capo fallato, stampa con evidenti difetti, ecc.), dato che il diritto di recesso non si applica agli articoli personalizzati (art. 5 comma 3 lettera c del D.Lgs. 185 del 22/05/99).
Una volta approvata la tua richiesta di reso riceverai il rimborso concordato con lo stesso metodo utilizzato per il pagamento appena avremo ricevuto la merce.
Le spese di spedizione per il reso sono a carico del cliente.$testo$) on conflict (store_id) do nothing;
insert into negozi_conoscenza (store_id, testo) values ('asteroidi', $testo$SPEDIZIONI
Ultimo aggiornamento: 23 ottobre 2026
  Grazie per aver acquistato su Asteroidi Store. Questa informativa spiega come spediamo il tuo ordine, quanto costa e cosa aspettarsi dopo l'acquisto.
  Elaborazione dell'ordine
    Salvo diversa indicazione sul nostro sito web, gli ordini vengono elaborati entro 1 giorno lavorativo (esclusi i giorni festivi).
    L'elaborazione degli ordini effettuati dopo mezzogiorno, nel fine settimana e nei giorni festivi potrebbe iniziare il giorno lavorativo successivo.
  Non appena l'ordine verrà spedito, riceverai un'email di conferma con il monitoraggio, se il metodo di spedizione lo supporta.
  Metodi di spedizione e tempi di consegna
  I metodi di spedizione disponibili e i tempi di consegna stimati sono visualizzati al check-out. I tempi di consegna sono stime, non garanzie, e decorrono dal momento in cui l'ordine viene spedito. Possono essere influenzati da ritardi del corriere, maltempo o da altri eventi al di fuori del nostro controllo.
  Costi di spedizione
  I costi di spedizione vengono calcolati al check-out in base a destinazione, peso dell'ordine e metodo di spedizione selezionato. La spedizione standard gratuita potrebbe essere disponibile su determinati ordini, come visualizzato al check-out.
    Dogana del Regno Unito, imposte e altre commissioni applicabili
    Per gli ordini spediti nel Regno Unito, potrebbero essere applicati dazi, imposte e spese di importazione. Se disponibili, tali costi verranno calcolati e riscossi al check-out. Se imposte o dazi vengono riscossi al check-out, ti saranno mostrati prima di effettuare l'ordine. Se non vengono riscossi al check-out, potrebbero essere dovuti prima o al momento della consegna e sono a carico del cliente, salvo diversa indicazione.
    In alcuni casi, spese di importazione aggiuntive, dazi doganali, IVA, spese di intermediazione o di gestione del corriere potrebbero essere dovute all'arrivo dell'ordine nel Regno Unito. Tali spese sono stabilite dalle autorità doganali del Regno Unito e/o dal corriere e sono a carico del cliente, a meno che non indichiamo espressamente al check-out che dazi e imposte sono prepagati.
    Le procedure di sdoganamento possono influire anche sui tempi di consegna. Prima di effettuare un ordine, ti consigliamo di verificare le normative di importazione locali.
    Dogana dell'Unione europea, imposte e altre commissioni applicabili
    Gli ordini spediti nei paesi dell'Unione europea potrebbero essere soggetti a IVA, dazi doganali, imposte di importazione e spese di intermediazione o di gestione del corriere. Se disponibili, imposte, dazi e spese di importazione applicabili verranno calcolati e mostrati al check-out prima di effettuare l'ordine. Se non vengono riscossi al check-out, potrebbero essere dovuti prima o al momento della consegna e sono a carico del cliente, salvo diversa indicazione.
    Se al check-out viene specificato che dazi e imposte sono prepagati, l'ordine verrà spedito con tali costi già pagati e non dovrebbero esserti richieste spese di importazione aggiuntive alla consegna. Se al check-out non è specificato che dazi e imposte sono prepagati, potrebbe esserti richiesto di pagare IVA, dazi doganali, imposte di importazione, spese di intermediazione o di gestione del corriere prima o al momento della consegna.
    I costi di importazione sono determinati dalle autorità doganali dell'UE e/o dal corriere e possono variare in base al paese di destinazione, alla classificazione o al valore del prodotto, al paese di origine e al metodo di spedizione. Le procedure di sdoganamento possono influire anche sui tempi di consegna.
  Monitoraggio dell'ordine
  Una volta spedito l'ordine, ti invieremo un'email di conferma con un numero di tracciamento e un link, se applicabile. Tieni presente che l'aggiornamento delle informazioni di tracciamento potrebbe richiedere del tempo.
  Destinazioni di spedizione
    Al momento spediamo in: Italia.
    Gli ordini internazionali possono essere soggetti a dazi doganali, imposte di importazione, commissioni e ritardi in dogana. Eventuali addebiti applicabili riscossi al check-out saranno mostrati prima di completare l'acquisto.
  Esattezza dell'indirizzo
  Controlla il tuo indirizzo di spedizione al check-out. Contattaci il prima possibile se devi correggerlo.
  Pacchi smarriti, danneggiati o in ritardo
  Se il tuo ordine è andato perso, è stato danneggiato o è in ritardo, contattaci e ti aiuteremo a interfacciarti con il corriere.
  Modifiche e annullamenti dell'ordine
  Devi modificare o annullare il tuo ordine? Contattaci il prima possibile. Potremmo essere in grado di soddisfare la tua richiesta prima che l'ordine venga spedito ma, una volta in transito, non potremo più modificarlo. I rimborsi per ordini annullati o in ritardo saranno elaborati tempestivamente e inviati sul metodo di pagamento originale, ove possibile.
  Domande?
    Contatta il nostro team all'indirizzo info@asteroidistore.it o utilizza i recapiti nei nostri informativa sui contatti.

RESI E RIMBORSI
La nostra informativa sui resi entro 30 giorni prevede che, dopo la ricezione di un articolo, hai 30 giorni di tempo per richiedere un reso.
Perché sia idoneo al reso, l'articolo deve essere nelle stesse condizioni in cui lo hai ricevuto, non deve essere stato indossato o utilizzato, deve avere tutti i cartellini e deve essere contenuto nell'imballaggio originario. Inoltre, avrai bisogno della ricevuta o di una prova d'acquisto.
Per avviare un reso, contattaci all'indirizzo info@asteroidistore.it. I resi dovranno essere spediti al seguente indirizzo: T&C Factory srl, Via dei Calzolai, 92 - 55041 Camaiore (LU). 
Se il reso viene accettato, ti invieremo un'etichetta di spedizione per il reso e le istruzioni su come e dove spedire il pacco. Gli articoli inviati senza una precedente richiesta di reso non saranno accettati.
Per qualsiasi domanda sui resi, contattaci in qualsiasi momento all'indirizzo info@asteroidistore.it.
Danni e problemi
Ispeziona l'ordine al momento della ricezione e contattaci immediatamente in caso di difetti o danni o se hai ricevuto l'articolo sbagliato. In questo modo, potremo valutare il problema e fare in modo di risolverlo.
Eccezioni / articoli non restituibili
Determinati tipi di articoli non possono essere restituiti, come i beni deperibili (ad esempio cibo, fiori o piante), i prodotti su misura (ad esempio ordini speciali o articoli personalizzati) e i prodotti per la cura della persona (ad esempio prodotti di bellezza). Inoltre, non accettiamo il reso di materiali pericolosi, liquidi infiammabili o gas. Se hai domande o dubbi su un articolo specifico, non esitare a contattarci.
Sfortunatamente non possiamo accettare il reso di articoli in promo o buoni regalo.
Sostituzioni
Il modo più rapido per assicurarti di ricevere ciò che desideri è restituire l'articolo ricevuto e, quando il reso sarà stato accettato, acquistare il nuovo articolo a parte.
Periodo di riflessione di 14 giorni per l'Unione Europea
Nonostante quanto sopra affermato, se la merce viene spedita nell'Unione Europea, hai il diritto di annullare o restituire l'ordine entro 14 giorni per qualsiasi motivo e senza dover fornire alcuna giustificazione. Come sopra, l'articolo deve essere nelle stesse condizioni in cui lo hai ricevuto, non deve essere stato indossato o utilizzato, deve avere tutti i cartellini e deve essere contenuto nell'imballaggio originario. Inoltre, avrai bisogno della ricevuta o di una prova d'acquisto.
Rimborsi
Non appena avremo ricevuto e ispezionato il tuo reso, ti avviseremo per comunicarti se il rimborso è stato approvato o meno. In caso di approvazione, entro 10 giorni lavorativi riceverai il rimborso in automatico attraverso il metodo di pagamento originario. Potrebbe volerci del tempo prima che la banca o la società che ha emesso la carta di credito elaborino e rendano visibile il rimborso.
Una volta passati più di 15 giorni lavorativi dall'approvazione del reso, contattaci all'indirizzo info@asteroidistore.it.$testo$) on conflict (store_id) do nothing;
insert into negozi_conoscenza (store_id, testo) values ('bienjugado', $testo$RESI E RIMBORSI
Art. 11. Diritto di recesso
11.1 Solo se il Cliente che stipula il contratto è un Consumatore (intendendosi con tale definizione qualsiasi persona fisica che agisca sul sito per scopi estranei all’attività imprenditoriale o professionale eventualmente svolta), avrà il diritto di recedere dal contratto concluso con il Venditore, senza alcuna penalità e senza specificarne il motivo, entro il termine quattordici (14) giorni lavorativi, decorrenti dal giorno del ricevimento dei prodotti acquistati sul sito.
11.2 Per esercitare il diritto di recesso il Cliente deve inviare entro il termine di quattordici (14) giorni lavorativi decorrenti dal giorno del ricevimento dei Prodotti una e-mail all’indirizzo info@bienjugado.it specificando il nr. d’Ordine ed i/il codice/i articolo/i per i quali intende avvalersi del diritto di recesso.
11.3 Successivamente al ricevimento della e-mail di cui al precedente articolo il Cliente riceverà tutte le istruzioni per la restituzione del/i Prodotto/i.
11.4 Il diritto di recesso è sottoposto alle seguenti condizioni:
Non possono essere restituiti prodotti personalizzati. Per personalizzazione viene inteso il capo che riporta un nome o il capo per il quale è stata selezionata una combinazione di colori di stampa. 
i Prodotti resi vanno restituiti nella loro interezza e non su parti o componenti di essi anche nel caso di kit;
i Prodotti resi non devono essere stati utilizzati, indossati, lavati o danneggiati;
i Prodotti resi devono essere restituiti nella loro confezione originale non danneggiata;
Prodotti resi devono essere inviati al Venditore in una sola spedizione. Il Venditore si riserva il diritto di non accettare Prodotti di uno stesso Ordine resi e spediti in momenti diversi;
i Prodotti resi devono essere consegnati al corriere entro quattordici (14) giorni lavorativi decorrenti dalla data in cui hai ricevuto i prodotti (fa fede la data di consegna dichiarata dal Corriere);
nelle ipotesi in cui il Venditore, a fronte dell acquisto di un pacchetto determinato di Prodotti, offra la possibilità di acquistarli ad un prezzo inferiore rispetto a quello che verrebbe normalmente praticato acquistandoli singolarmente (es. 5x4, 3x2 ecc.), il diritto di recesso potrà essere esercitato anche con la restituzione solamente di alcuni dei prodotti acquistati: in questa ipotesi il prezzo verrà ricalcolato prendendo come riferimento il prezzo normalmente praticato per l’acquisto del singolo prodotto. In tutte le altre ipotesi (es. vendite abbinate, operazioni a premio ecc. ecc.) il diritto di recesso potrà essere esercitato solo con la restituzione di tutti i Prodotti oggetto dell’acquisto, escludendosi pertanto ogni esclusione parziale.
11.5 Se il diritto di recesso è dal Cliente esercitato conformemente alle precedenti condizioni (paragrafo 8.4), il Venditore è tenuto a rimborsare le somme versate dal Cliente entro e non oltre 30 giorni dal ricevimento da parte del Venditore dei prodotti restituiti.
11.5.1 Normalmente il riaccredito da parte del Venditore dell’importo inizialmente prelevato avviene molto celermente, ma i tempi in base ai quali il riaccredito sarà effettivamente visibile per il Cliente dipenderà dalla sua banca, istituto di carta di credito o Paypal. Nel caso di pagamento dell'ordine in contrassegno, sarà cura del Cliente indicare con quale modalità preferisce il rimborso, scegliendo tra conto Paypal e Bonificico Bancario.
11.6 Il Venditore si impegna a sostenere anche le spese di spedizione iniziali dei Prodotti esclusivamente in caso di danno agli stessi dovuto al trasporto o di errori nella spedizione da parte del Venditore stesso. Solamente in questi casi, il Venditore rimborserà anche l’importo che il Cliente ha pagato a titolo di spese di spedizione. Il Venditore invierà un corriere espresso per il ritiro del Prodotto presso il domicilio indicato dal Cliente.
11.7 In caso di esercizio del diritto di recesso, il Venditore provvederà al rimborso corrispondente, entro 30 giorni dalla data di ricezione da parte dello stesso dei Prodotti resi secondo le modalità sopra indicate, mediante accredito dell’importo da rimborsare con le stesse modalità di pagamento scelte dal Cliente al momento dell’Ordine.
11.8 Nel caso di esercizio del diritto di recesso senza il rispetto delle modalità sopra indicate (ad es. oltre i 14 giorni previsti dalla legge, oppure senza aver seguito le istruzioni per il reso), il Venditore provvederà a rinviare nuovamente al Cliente i Prodotti acquistati addebitandogli anche le ulteriori spese di spedizione.
11.9 Il Diritto di recesso non può essere applicato nel caso di prodotti personalizzati su esplicita richiesta del Cliente al momento dell’inserimento dell’Ordine.
11.10 In caso in cui il Cliente scelga di spedire personalmente il reso dovrà spedire il pacco al seguente indirizzo: Via dei Calzolai, 92 - 55041 Camaiore (LU)
11.11 CAMBIO MERCE
NON EFFETTUIAMO IL SERVIZIO DI CAMBIO MERCE 
NON E' PREVISTO IL CAMBIO MERCE SU ARTICOLI PERSONALIZZATI CON IL NOME O SUI QUALI E' STATO SCELTO UN COLORE DI STAMPA
Prima di effettuare un ordine, valutare con attenzione la scelta della taglia utilizzando le tabelle taglie sul sito, eventualmente contattando la nostra assistenza clienti scrivendo una mail a info@bienjugado.it oppure attraverso il servizio chat sul nostro sito www.bienjugado.it.
Se la merce rientra nel materiale standard che può essere restituito , provvederemo a rimborsare l'intero importo detratti 5,90€ per il costo del servizio.
PAGAMENTI SICURI
I tuoi dati di pagamento vengono elaborati in modo sicuro.
CUSTOMER SERVICE
Siamo disponibili dal lunedì al venerdì per rispondere alle vostre domande.
CONTATTACI
Hai bisogno di contattarci? Inviaci una e-mail a info@bienjugado.it
                Vai alla slide 1
                Vai alla slide 2
                Vai alla slide 3$testo$) on conflict (store_id) do nothing;
