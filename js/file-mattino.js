/**
 * T&C Factory — Stampe del giorno (id scheda: 'file')
 *
 * DDT, file di stampa e fogli DTF che lo script del mattino carica ogni giorno nel bucket privato
 * file-mattino (AAAA-MM-GG/..., con la sottocartella DTF). Qui si elencano per giorno e si scaricano
 * con un link firmato. La pulizia della domenica tiene solo l'ultima cartella generata (sql/file-mattino.sql).
 * Il DDT non si scarica: "Stampa" apre la finestra di stampa del browser. Gli altri file hanno "Scarica".
 * Entrambi segnano il file (file_mattino_stampe): il bottone diventa verde con data, ora e operatore,
 * e un nuovo clic chiede conferma.
 * I PDF dei calzini (nella cartella del giorno, DDT escluso) si aprono come PDF ("Apri") e si scelgono con la
 * casella; "Stampa" apre le impostazioni (stampante, formato, qualità, pagine, copie) e i file vanno nella coda
 * stampa_coda: il Mac in sede (automazioni/stampa) li manda alla SC-F500 col driver (sql/stampa-coda.sql).
 */

const FileMattino = { giorni: null, errore: null, carica: null, stampe: {}, coda: {}, agenti: [], timer: null, scelti: new Set() };
const fmDaStampare = (nome) => nome === 'DDT.pdf';
const fmCalzini = (f) => /^\d{4}-\d{2}-\d{2}\/[^/]+\.pdf$/.test(f.percorso) && !fmDaStampare(f.nome);
const FM_AGENTE_VIVO = 60 * 1000;   // l'agente chiede lavoro ogni 10 secondi
const FM_IMPOSTAZIONI = 'fm-stampa-impostazioni';
const FM_QUALITA = [['velocita', 'Velocità'], ['qualita', 'Qualità'], ['massima', 'Qualità massima']];
const FM_PREDEFINITE = { stampante: null, larghezza: 230, altezza: 430, rotolo: true, aggraffa: true,
  qualita: 'qualita', alta_velocita: true, massimo_dettaglio: false, pagine: null, copie: 1 };

const fmBucket = () => supabaseClient.storage.from('file-mattino');

function fmPeso(byte) {
  if (byte == null) return '';
  if (byte >= 1024 ** 3) return `${(byte / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  if (byte >= 1024 ** 2) return `${Math.round(byte / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(byte / 1024))} KB`;
}

function fmGiorno(g) {
  const s = new Date(`${g}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Elenco di una cartella: i file con il loro peso, le sottocartelle a parte
async function fmElenca(cartella) {
  const { data, error } = await fmBucket().list(cartella, { limit: 1000, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw error;
  const file = [], sotto = [];
  for (const x of data || []) {
    if (x.name.startsWith('.')) continue;
    if (x.id) file.push({ nome: x.name, percorso: `${cartella}/${x.name}`, peso: x.metadata?.size });
    else sotto.push(x.name);
  }
  return { file, sotto };
}

async function fmCarica() {
  const [{ data, error }, stampe] = await Promise.all([
    fmBucket().list('', { limit: 1000 }),
    supabaseClient.from('file_mattino_stampe').select('*'),
    fmCaricaCoda(),
  ]);
  if (error) throw error;
  if (stampe.error) throw stampe.error;
  FileMattino.stampe = Object.fromEntries((stampe.data || []).map(x => [x.percorso, x]));
  const nomi = (data || []).filter(x => !x.id && /^\d{4}-\d{2}-\d{2}$/.test(x.name)).map(x => x.name).sort().reverse();
  return Promise.all(nomi.map(async g => {
    const { file, sotto } = await fmElenca(g);
    const gruppi = await Promise.all(sotto.map(async s => ({ nome: s, file: (await fmElenca(`${g}/${s}`)).file })));
    // Prima i DDT, poi i file di stampa
    file.sort((a, b) => (b.nome === 'DDT.pdf') - (a.nome === 'DDT.pdf') || a.nome.localeCompare(b.nome, 'it'));
    return { giorno: g, file, gruppi: gruppi.filter(x => x.file.length) };
  }));
}

async function openFileMattinoPage() {
  const root = document.getElementById('file-mattino-root');
  if (!root) return;
  if (!FileMattino.giorni) root.innerHTML = `<div class="glass-card empty-state"><p>Caricamento…</p></div>`;
  const giro = FileMattino.carica = fmCarica();
  try {
    const giorni = await giro;
    if (giro !== FileMattino.carica) return;
    FileMattino.giorni = giorni;
    FileMattino.errore = null;
  } catch (e) {
    if (giro !== FileMattino.carica) return;
    FileMattino.errore = e.message || String(e);
  }
  if (Nav.current === 'file') renderFileMattino();
}

// Ultimo lavoro di stampa per file, e i Mac che fanno da ponte
async function fmCaricaCoda() {
  const [coda, agenti] = await Promise.all([
    supabaseClient.from('stampa_coda').select('*').order('richiesto_at', { ascending: false }).limit(300),
    supabaseClient.from('stampa_agenti').select('*'),
  ]);
  if (coda.error) throw coda.error;
  if (agenti.error) throw agenti.error;
  FileMattino.coda = {};
  for (const x of coda.data || []) if (!FileMattino.coda[x.percorso]) FileMattino.coda[x.percorso] = x;
  FileMattino.agenti = agenti.data || [];
}

const fmAgenteVivo = () => FileMattino.agenti.some(a => Date.now() - new Date(a.visto_at) < FM_AGENTE_VIVO);
const fmInCorso = (l) => l && (l.stato === 'in_coda' || l.stato === 'in_stampa');

// Mentre c'è un lavoro in coda o in stampa, lo stato si aggiorna da solo
function fmSegui() {
  clearTimeout(FileMattino.timer);
  if (!Object.values(FileMattino.coda).some(fmInCorso)) return;
  FileMattino.timer = setTimeout(async () => {
    if (Nav.current !== 'file') return;
    try { await fmCaricaCoda(); renderFileMattino(); } catch { fmSegui(); }
  }, 5000);
}

// Stampanti che i Mac in sede dicono di avere (stampanti.json); agenti vecchi o nessun agente: la SC-F500 di sempre
function fmStampanti() {
  const viste = new Map();
  const agenti = [...FileMattino.agenti].sort((a, b) => new Date(b.visto_at) - new Date(a.visto_at));
  for (const a of agenti) for (const x of Array.isArray(a.stampanti) ? a.stampanti : []) if (x?.id && !viste.has(x.id)) viste.set(x.id, x);
  return viste.size ? [...viste.values()] : [{ id: 'sc-f500', nome: 'SC-F500' }];
}
const fmNomeStampante = (id) => fmStampanti().find(x => x.id === id)?.nome || 'SC-F500';

function fmStatoStampa(l) {
  const chi = l.richiesto_da ? ` da ${l.richiesto_da}` : '';
  const sc = fmNomeStampante(l.stampante);
  if (l.stato === 'in_coda') return fmAgenteVivo() ? `In coda per la ${sc}${chi}` : `In coda${chi}: il Mac della stampa non risponde, parte quando si riaccende`;
  if (l.stato === 'in_stampa') return `In stampa sulla ${sc}${chi}`;
  if (l.stato === 'stampato') return `Stampato sulla ${sc} ${fmQuando(l.finito_at || l.richiesto_at)}${chi}`;
  return `Stampa non riuscita: ${l.errore || 'errore sconosciuto'}`;
}

// DDT: Stampa. Tutti gli altri: Scarica. Dopo il clic il bottone è verde, con chi e quando, e la volta dopo chiede conferma.
// I PDF dei calzini hanno la casella per sceglierli e "Apri" per vederli; lo stato dice com'è andata la SC-F500
function fmRigaFile(f) {
  const stampa = fmDaStampare(f.nome);
  const s = FileMattino.stampe[f.percorso];
  const azione = stampa ? 'Stampa' : 'Scarica';
  const fatto = s ? `${stampa ? 'Stampato' : 'Scaricato'} ${fmQuando(s.stampato_at)}${s.stampato_da ? ` da ${s.stampato_da}` : ''}` : '';
  const calzini = fmCalzini(f);
  const l = calzini ? FileMattino.coda[f.percorso] : null;
  const stato = l ? fmStatoStampa(l) : (s ? fatto : fmPeso(f.peso));
  const casella = calzini
    ? `<input type="checkbox" class="fm-scelta" data-percorso="${escapeHtml(f.percorso)}" onchange="fmScegli(this)"
        ${FileMattino.scelti.has(f.percorso) ? 'checked' : ''} ${fmInCorso(l) ? 'disabled' : ''} aria-label="Scegli ${escapeHtml(f.nome)} per la stampa">`
    : '<span></span>';
  const apri = !calzini ? '' : `
      <button type="button" class="btn btn-secondary fm-scarica ${l?.stato === 'stampato' ? 'is-fatto' : l?.stato === 'errore' ? 'is-errore' : fmInCorso(l) ? 'is-attesa' : ''}"
        data-percorso="${escapeHtml(f.percorso)}" onclick="fmApri(this)" aria-label="Apri il PDF ${escapeHtml(f.nome)}">${Icons.eye(15)} Apri</button>`;
  return `
    <li class="fm-file">
      ${casella}
      <span class="fm-file-nome">${escapeHtml(f.nome)}</span>
      <span class="fm-file-peso ${l?.stato === 'errore' ? 'is-errore' : ''}">${escapeHtml(stato)}</span>
      <span class="fm-azioni">${apri}
      <button type="button" class="btn btn-secondary fm-scarica ${s ? 'is-fatto' : ''}" data-percorso="${escapeHtml(f.percorso)}"
        onclick="${stampa ? 'fmStampa' : 'fmScarica'}(this)"
        aria-label="${azione} ${escapeHtml(f.nome)}${s ? `, già ${stampa ? 'stampato' : 'scaricato'}` : ''}">${stampa ? Icons.printer(15) : Icons.download(15)} ${azione}</button>
      </span>
    </li>`;
}

// Se il file è già stato stampato o scaricato: popup con data, ora e operatore
async function fmConferma(percorso, stampa) {
  const s = FileMattino.stampe[percorso];
  if (!s) return true;
  return uiConfirm(`Già ${stampa ? 'stampato' : 'scaricato'} ${fmQuando(s.stampato_at)}${s.stampato_da ? ` da ${s.stampato_da}` : ''}. ${stampa ? 'Stampare' : 'Scaricare'} di nuovo?`,
    { title: 'Attenzione', ok: 'Sì', cancel: 'No' });
}

async function fmSegna(percorso) {
  const { data, error } = await supabaseClient.rpc('tc_file_mattino_stampato', { p_percorso: percorso });
  if (error) throw error;
  FileMattino.stampe[percorso] = data;
  renderFileMattino();
}

// Il PDF si apre in una scheda nuova, nel visore PDF del browser (la scheda si apre subito, se no il browser la blocca)
async function fmApri(btn) {
  const w = window.open('', '_blank');
  try {
    const { data, error } = await fmBucket().createSignedUrl(btn.dataset.percorso, 3600);
    if (error) throw error;
    if (w) { w.opener = null; w.location.href = data.signedUrl; }
    else window.location.assign(data.signedUrl);
  } catch (e) {
    w?.close();
    uiAlert(`Il PDF non si apre: ${e.message || e}`);
  }
}

const fmScelti = (g) => g.file.filter(f => fmCalzini(f) && FileMattino.scelti.has(f.percorso));

function fmScegli(box) {
  if (box.checked) FileMattino.scelti.add(box.dataset.percorso);
  else FileMattino.scelti.delete(box.dataset.percorso);
  renderFileMattino();
}

function fmImpostazioniSalvate() {
  try { return { ...FM_PREDEFINITE, ...JSON.parse(localStorage.getItem(FM_IMPOSTAZIONI) || '{}'), pagine: null, copie: 1 }; }
  catch { return { ...FM_PREDEFINITE }; }
}

// Impostazioni di stampa dei file scelti di un giorno: stampante, formato, qualità, pagine e copie
async function fmApriStampa(giorno) {
  const g = (FileMattino.giorni || []).find(x => x.giorno === giorno);
  const file = g ? fmScelti(g) : [];
  if (!file.length) return;
  const gia = file.filter(f => FileMattino.coda[f.percorso]?.stato === 'stampato');
  if (gia.length && !(await uiConfirm(`${gia.length === 1 ? `${gia[0].nome} è già stato stampato` : `${gia.length} file sono già stati stampati`}. Stampare di nuovo?`,
    { title: 'Attenzione', ok: 'Sì', cancel: 'No' }))) return;
  const stampanti = fmStampanti();
  const imp = fmImpostazioniSalvate();
  if (!stampanti.some(x => x.id === imp.stampante)) imp.stampante = (stampanti.find(x => x.pronta !== false) || stampanti[0]).id;
  imp.pagine_modo = 'tutte';
  FileMattino.dialogo = { giorno, file: file.map(f => f.percorso), imp };
  let el = document.getElementById('fm-stampa-modal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fm-stampa-modal';
    el.className = 'modal-overlay';
    document.body.appendChild(el);
  }
  const seg = (campo, voci) => `<div class="segmented" role="radiogroup">${voci.map(([v, t]) =>
    `<button type="button" role="radio" aria-checked="${imp[campo] === v}" class="${imp[campo] === v ? 'active' : ''}" data-campo="${campo}" data-valore="${escapeHtml(v)}" onclick="fmImpScegli(this)">${escapeHtml(t)}</button>`).join('')}</div>`;
  const interruttore = (campo, testo) => `
    <label class="switch-row"><span><strong>${testo}</strong></span>
      <input type="checkbox" class="switch" data-campo="${campo}" ${imp[campo] ? 'checked' : ''} onchange="FileMattino.dialogo.imp[this.dataset.campo] = this.checked; fmImpAggiorna()"></label>`;
  el.innerHTML = `
    <div class="modal fm-stampa" role="dialog" aria-modal="true" aria-labelledby="fm-stampa-titolo">
      <div class="modal-header">
        <h2 id="fm-stampa-titolo">Stampa</h2>
        <button class="btn-icon" onclick="closeModal('fm-stampa-modal')" aria-label="Chiudi">${Icons.x()}</button>
      </div>
      <div class="modal-body">
        <ul class="fm-stampa-file">${file.map(f => `<li>${escapeHtml(f.nome)}</li>`).join('')}</ul>
        <div class="form-group">
          <span class="form-label">Stampante</span>
          ${seg('stampante', stampanti.map(x => [x.id, x.nome || x.id]))}
          <p class="fm-stampa-avviso" id="fm-stampa-avviso" hidden></p>
        </div>
        <div class="form-group">
          <span class="form-label">Dimensione pagina</span>
          <div class="fm-stampa-misure">
            <input class="form-input" type="number" id="fm-larghezza" min="5" max="61" step="0.1" value="${imp.larghezza / 10}" aria-label="Larghezza in cm" oninput="fmImpAggiorna()">
            <span>×</span>
            <input class="form-input" type="number" id="fm-altezza" min="5" max="300" step="0.1" value="${imp.altezza / 10}" aria-label="Altezza in cm" oninput="fmImpAggiorna()">
            <span>cm</span>
          </div>
        </div>
        <div class="fm-stampa-blocco">
          ${interruttore('rotolo', 'Carta in rotolo')}
          <div class="switch-row" style="cursor:default;"><span><strong>Formato carta</strong></span><span id="fm-formato"></span></div>
          ${interruttore('aggraffa', 'Aggraffa dai margini')}
        </div>
        <div class="form-group">
          <span class="form-label">Qualità</span>
          ${seg('qualita', FM_QUALITA)}
        </div>
        <div class="fm-stampa-blocco">
          ${interruttore('alta_velocita', 'Alta velocità')}
          ${interruttore('massimo_dettaglio', 'Massimo dettaglio')}
        </div>
        <div class="form-group">
          <span class="form-label">Pagine${file.length > 1 ? ' <span>(per ogni file)</span>' : ''}</span>
          ${seg('pagine_modo', [['tutte', 'Tutte'], ['scelte', 'Scegli']])}
          <input class="form-input" type="text" id="fm-pagine" inputmode="numeric" placeholder="es. 1-3, 5" autocomplete="off" hidden oninput="fmImpAggiorna()">
        </div>
        <div class="form-group">
          <label class="form-label" for="fm-copie">Copie</label>
          <input class="form-input fm-stampa-copie" type="number" id="fm-copie" min="1" max="99" step="1" value="1" oninput="fmImpAggiorna()">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal('fm-stampa-modal')">Annulla</button>
        <button class="btn btn-primary" id="fm-stampa-ok" onclick="fmInviaStampa()">${Icons.printer(15)} Stampa</button>
      </div>
    </div>`;
  el.onclick = (e) => { if (e.target === el) closeModal('fm-stampa-modal'); };
  el.classList.remove('closing');
  el.classList.add('active');
  fmImpAggiorna();
}

function fmImpScegli(btn) {
  const imp = FileMattino.dialogo.imp;
  imp[btn.dataset.campo] = btn.dataset.valore;
  for (const b of btn.parentElement.children) {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-checked', b === btn);
  }
  if (btn.dataset.campo === 'pagine_modo') {
    const inp = document.getElementById('fm-pagine');
    inp.hidden = btn.dataset.valore !== 'scelte';
    if (!inp.hidden) inp.focus();
  }
  fmImpAggiorna();
}

// Legge i campi, controlla i valori e aggiorna formato carta, avviso stampante e bottone Stampa
function fmImpAggiorna() {
  const d = FileMattino.dialogo;
  if (!d) return;
  const imp = d.imp;
  const mm = (id) => Math.round(parseFloat(String(document.getElementById(id).value).replace(',', '.')) * 10);
  imp.larghezza = mm('fm-larghezza');
  imp.altezza = mm('fm-altezza');
  const pagine = String(document.getElementById('fm-pagine').value).replace(/\s+/g, '');
  imp.pagine = imp.pagine_modo === 'scelte' ? pagine : null;
  imp.copie = Number(document.getElementById('fm-copie').value);
  const misureOk = imp.larghezza >= 50 && imp.larghezza <= 610 && imp.altezza >= 50 && imp.altezza <= 3000;
  const pagineOk = imp.pagine === null || /^[1-9]\d{0,3}(-[1-9]\d{0,3})?(,[1-9]\d{0,3}(-[1-9]\d{0,3})?)*$/.test(imp.pagine);
  const copieOk = Number.isInteger(imp.copie) && imp.copie >= 1 && imp.copie <= 99;
  document.getElementById('fm-larghezza').setAttribute('aria-invalid', !misureOk);
  document.getElementById('fm-altezza').setAttribute('aria-invalid', !misureOk);
  document.getElementById('fm-pagine').setAttribute('aria-invalid', !pagineOk);
  document.getElementById('fm-copie').setAttribute('aria-invalid', !copieOk);
  document.getElementById('fm-formato').textContent = misureOk ? `${imp.rotolo ? 'Carta in rotolo · ' : ''}${imp.larghezza}×${imp.altezza} mm` : '—';
  const st = fmStampanti().find(x => x.id === imp.stampante);
  const avviso = document.getElementById('fm-stampa-avviso');
  avviso.hidden = st?.pronta !== false;
  avviso.textContent = 'Impostazioni della stampante da confermare sul Mac in sede: per ora non stampa.';
  document.getElementById('fm-stampa-ok').disabled = !(misureOk && pagineOk && copieOk);
}

async function fmInviaStampa() {
  const d = FileMattino.dialogo;
  const ok = document.getElementById('fm-stampa-ok');
  if (!d || ok.disabled) return;
  const { stampante, pagine_modo, ...imp } = d.imp;
  try { localStorage.setItem(FM_IMPOSTAZIONI, JSON.stringify({ stampante, ...imp, pagine: null, copie: 1 })); } catch {}
  ok.disabled = true;
  const errori = [];
  for (const percorso of d.file) {
    try {
      const { data, error } = await supabaseClient.rpc('tc_stampa_invia', { p_percorso: percorso, p_stampante: stampante, p_impostazioni: imp });
      if (error) throw error;
      FileMattino.coda[percorso] = data;
      FileMattino.scelti.delete(percorso);
    } catch (e) {
      errori.push(`${percorso.split('/').pop()}: ${e.message || e}`);
    }
  }
  closeModal('fm-stampa-modal');
  FileMattino.dialogo = null;
  renderFileMattino();
  if (errori.length) uiAlert(`Invio alla stampante non riuscito.\n\n${errori.join('\n')}`);
}

function renderFileMattino() {
  const root = document.getElementById('file-mattino-root');
  if (!root) return;
  fmSegui();
  if (FileMattino.errore) {
    root.innerHTML = `<div class="glass-card empty-state"><h2>File non disponibili</h2><p>${escapeHtml(FileMattino.errore)}</p></div>`;
    return;
  }
  const giorni = FileMattino.giorni || [];
  if (!giorni.length) {
    root.innerHTML = `<div class="glass-card empty-state"><h2>Nessun file</h2><p>I file compaiono qui dopo il giro del mattino.</p></div>`;
    return;
  }
  root.innerHTML = `<div class="fm-giorni">${giorni.map(g => {
    const scelti = fmScelti(g).length;
    const stampa = g.file.some(fmCalzini) ? `
        <button type="button" class="btn btn-primary fm-stampa-scelti" onclick="fmApriStampa('${g.giorno}')" ${scelti ? '' : 'disabled'}>
          ${Icons.printer(15)} Stampa${scelti ? ` (${scelti})` : ''}</button>` : '';
    return `
    <section class="glass-card fm-giorno" aria-labelledby="fm-${g.giorno}">
      <div class="fm-giorno-head"><h2 id="fm-${g.giorno}">${fmGiorno(g.giorno)}</h2>${stampa}</div>
      ${g.file.length ? `<ul class="fm-lista">${g.file.map(fmRigaFile).join('')}</ul>` : ''}
      ${g.gruppi.map(s => `
        <h3>${escapeHtml(s.nome)}</h3>
        <ul class="fm-lista">${s.file.map(fmRigaFile).join('')}</ul>`).join('')}
    </section>`;
  }).join('')}</div>`;
}

async function fmScarica(btn) {
  const percorso = btn.dataset.percorso;
  if (!(await fmConferma(percorso, false))) return;
  btn.disabled = true;
  try {
    const { data, error } = await fmBucket().createSignedUrl(percorso, 3600, { download: percorso.split('/').pop() });
    if (error) throw error;
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await fmSegna(percorso);
  } catch (e) {
    uiAlert(`Download non riuscito: ${e.message || e}`);
    btn.disabled = false;
  }
}

function fmQuando(iso) {
  const d = new Date(iso);
  return `il ${d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })} alle ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

// Il PDF si apre in un riquadro nascosto della pagina e parte la finestra di stampa del browser
async function fmStampa(btn) {
  const percorso = btn.dataset.percorso;
  if (!(await fmConferma(percorso, true))) return;
  btn.disabled = true;
  try {
    const { data, error } = await fmBucket().download(percorso);
    if (error) throw error;
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    document.getElementById('fm-stampa-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'fm-stampa-frame';
    frame.className = 'fm-stampa-frame';
    frame.title = 'DDT da stampare';
    frame.src = url;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch { window.open(url, '_blank', 'noopener'); }   // browser che non stampano dal riquadro: si apre in una scheda
    };
    document.body.appendChild(frame);
    await fmSegna(percorso);
  } catch (e) {
    uiAlert(`Stampa non riuscita: ${e.message || e}`);
    btn.disabled = false;
  }
}
