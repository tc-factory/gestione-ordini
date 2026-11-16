/**
 * T&C Factory — File del mattino
 *
 * DDT, file di stampa e fogli DTF che lo script del mattino carica ogni giorno nel bucket privato
 * file-mattino (AAAA-MM-GG/..., con la sottocartella DTF). Qui si elencano per giorno e si scaricano
 * con un link firmato. La pulizia della domenica tiene solo l'ultima cartella generata (sql/file-mattino.sql).
 * Il DDT non si scarica: "Stampa" apre la finestra di stampa del browser. Gli altri file hanno "Scarica".
 * Entrambi segnano il file (file_mattino_stampe): il bottone diventa verde con data, ora e operatore,
 * e un nuovo clic chiede conferma.
 * I PDF dei calzini (nella cartella del giorno, DDT escluso) hanno anche "SC-F500": il file va nella coda
 * stampa_coda e il Mac in sede (automazioni/stampa) lo manda alla stampante col driver (sql/stampa-coda.sql).
 */

const FileMattino = { giorni: null, errore: null, carica: null, stampe: {}, coda: {}, agenti: [], timer: null };
const fmDaStampare = (nome) => nome === 'DDT.pdf';
const fmCalzini = (f) => /^\d{4}-\d{2}-\d{2}\/[^/]+\.pdf$/.test(f.percorso) && !fmDaStampare(f.nome);
const FM_AGENTE_VIVO = 60 * 1000;   // l'agente chiede lavoro ogni 10 secondi

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

function fmStatoStampa(l) {
  const chi = l.richiesto_da ? ` da ${l.richiesto_da}` : '';
  if (l.stato === 'in_coda') return fmAgenteVivo() ? `In coda per la SC-F500${chi}` : `In coda${chi}: il Mac della stampa non risponde, parte quando si riaccende`;
  if (l.stato === 'in_stampa') return `In stampa sulla SC-F500${chi}`;
  if (l.stato === 'stampato') return `Stampato sulla SC-F500 ${fmQuando(l.finito_at || l.richiesto_at)}${chi}`;
  return `Stampa non riuscita: ${l.errore || 'errore sconosciuto'}`;
}

// DDT: Stampa. Tutti gli altri: Scarica. Dopo il clic il bottone è verde, con chi e quando, e la volta dopo chiede conferma
function fmRigaFile(f) {
  const stampa = fmDaStampare(f.nome);
  const s = FileMattino.stampe[f.percorso];
  const azione = stampa ? 'Stampa' : 'Scarica';
  const fatto = s ? `${stampa ? 'Stampato' : 'Scaricato'} ${fmQuando(s.stampato_at)}${s.stampato_da ? ` da ${s.stampato_da}` : ''}` : '';
  const l = fmCalzini(f) ? FileMattino.coda[f.percorso] : null;
  const stato = l ? fmStatoStampa(l) : (s ? fatto : fmPeso(f.peso));
  const sc = !fmCalzini(f) ? '' : `
      <button type="button" class="btn btn-secondary fm-scarica ${l?.stato === 'stampato' ? 'is-fatto' : l?.stato === 'errore' ? 'is-errore' : fmInCorso(l) ? 'is-attesa' : ''}"
        data-percorso="${escapeHtml(f.percorso)}" onclick="fmInviaStampante(this)" ${fmInCorso(l) ? 'disabled' : ''}
        aria-label="Invia ${escapeHtml(f.nome)} alla SC-F500">${Icons.printer(15)} SC-F500</button>`;
  return `
    <li class="fm-file ${sc ? 'has-due' : ''}">
      <span class="fm-file-nome">${escapeHtml(f.nome)}</span>
      <span class="fm-file-peso ${l?.stato === 'errore' ? 'is-errore' : ''}">${escapeHtml(stato)}</span>
      <span class="fm-azioni">
      <button type="button" class="btn btn-secondary fm-scarica ${s ? 'is-fatto' : ''}" data-percorso="${escapeHtml(f.percorso)}"
        onclick="${stampa ? 'fmStampa' : 'fmScarica'}(this)"
        aria-label="${azione} ${escapeHtml(f.nome)}${s ? `, già ${stampa ? 'stampato' : 'scaricato'}` : ''}">${stampa ? Icons.printer(15) : Icons.download(15)} ${azione}</button>${sc}
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

// Il PDF va nella coda: il Mac in sede lo manda alla SC-F500 col driver, senza scaricarlo qui
async function fmInviaStampante(btn) {
  const percorso = btn.dataset.percorso;
  const l = FileMattino.coda[percorso];
  if (l?.stato === 'stampato' && !(await uiConfirm(`Già stampato sulla SC-F500 ${fmQuando(l.finito_at || l.richiesto_at)}${l.richiesto_da ? ` da ${l.richiesto_da}` : ''}. Stampare di nuovo?`,
    { title: 'Attenzione', ok: 'Sì', cancel: 'No' }))) return;
  btn.disabled = true;
  try {
    const { data, error } = await supabaseClient.rpc('tc_stampa_invia', { p_percorso: percorso });
    if (error) throw error;
    FileMattino.coda[percorso] = data;
    renderFileMattino();
  } catch (e) {
    uiAlert(`Invio alla stampante non riuscito: ${e.message || e}`);
    btn.disabled = false;
  }
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
  root.innerHTML = `<div class="fm-giorni">${giorni.map(g => `
    <section class="glass-card fm-giorno" aria-labelledby="fm-${g.giorno}">
      <h2 id="fm-${g.giorno}">${fmGiorno(g.giorno)}</h2>
      ${g.file.length ? `<ul class="fm-lista">${g.file.map(fmRigaFile).join('')}</ul>` : ''}
      ${g.gruppi.map(s => `
        <h3>${escapeHtml(s.nome)}</h3>
        <ul class="fm-lista">${s.file.map(fmRigaFile).join('')}</ul>`).join('')}
    </section>`).join('')}</div>`;
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
