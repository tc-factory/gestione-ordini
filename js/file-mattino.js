/**
 * T&C Factory — Stampe del giorno (id scheda: 'file')
 *
 * DDT, file di stampa e fogli DTF che lo script del mattino carica ogni giorno nel bucket privato
 * file-mattino (AAAA-MM-GG/..., con la sottocartella DTF). Qui si elencano per giorno e si scaricano
 * con un link firmato. La pulizia della domenica tiene solo l'ultima cartella generata (sql/file-mattino.sql).
 * Il DDT non si scarica: "Stampa" apre la finestra di stampa del browser. Gli altri file hanno "Scarica".
 * Entrambi segnano il file (file_mattino_stampe): il bottone diventa verde con data, ora e operatore,
 * e un nuovo clic chiede conferma.
 * I PDF dei calzini (nella cartella del giorno, DDT escluso) hanno anche "Apri": il PDF si apre nel browser e si
 * stampa da qualsiasi Mac con la finestra di stampa del sistema (driver Epson). Le stampe identiche sono su una
 * pagina sola: le copie di ogni pagina arrivano dallo script del mattino in "<nome>.copie.json" e si leggono qui.
 */

const FileMattino = { giorni: null, errore: null, carica: null, stampe: {} };
const fmDaStampare = (nome) => nome === 'DDT.pdf';
const fmCalzini = (f) => /^\d{4}-\d{2}-\d{2}\/[^/]+\.pdf$/.test(f.percorso) && !fmDaStampare(f.nome);
const FM_COPIE = '.copie.json';

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
  ]);
  if (error) throw error;
  if (stampe.error) throw stampe.error;
  FileMattino.stampe = Object.fromEntries((stampe.data || []).map(x => [x.percorso, x]));
  const nomi = (data || []).filter(x => !x.id && /^\d{4}-\d{2}-\d{2}$/.test(x.name)).map(x => x.name).sort().reverse();
  return Promise.all(nomi.map(async g => {
    const elenco = await fmElenca(g);
    const { sotto } = elenco;
    const file = await fmLeggiCopie(elenco.file);
    const gruppi = await Promise.all(sotto.map(async s => ({ nome: s, file: (await fmElenca(`${g}/${s}`)).file })));
    // Prima i DDT, poi i file di stampa
    file.sort((a, b) => (b.nome === 'DDT.pdf') - (a.nome === 'DDT.pdf') || a.nome.localeCompare(b.nome, 'it'));
    return { giorno: g, file, gruppi: gruppi.filter(x => x.file.length) };
  }));
}

// Toglie dall'elenco i file delle copie e le attacca al loro PDF (f.copie = copie per pagina)
async function fmLeggiCopie(file) {
  const pdf = file.filter(f => !f.nome.endsWith(FM_COPIE));
  await Promise.all(file.filter(f => f.nome.endsWith(FM_COPIE)).map(async j => {
    const p = pdf.find(f => f.nome === j.nome.slice(0, -FM_COPIE.length) + '.pdf');
    if (!p) return;
    try {
      const { data, error } = await fmBucket().download(j.percorso);
      if (error) throw error;
      const copie = JSON.parse(await data.text()).copie;
      if (Array.isArray(copie) && copie.every(n => Number.isInteger(n) && n > 0)) p.copie = copie;
    } catch { /* senza copie il file si mostra lo stesso */ }
  }));
  return pdf;
}

// "pag. 1-40: 1 copia · pag. 41-43: 2 copie" (le pagine arrivano già in ordine di copie)
function fmTestoCopie(copie) {
  const gruppi = [];
  copie.forEach((n, i) => {
    const g = gruppi[gruppi.length - 1];
    if (g && g.n === n) g.a = i + 1; else gruppi.push({ da: i + 1, a: i + 1, n });
  });
  return gruppi.map(g => `pag. ${g.da}${g.a !== g.da ? `-${g.a}` : ''}: ${g.n} ${g.n === 1 ? 'copia' : 'copie'}`).join(' · ');
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

// DDT: Stampa. Tutti gli altri: Scarica. Dopo il clic il bottone è verde, con chi e quando, e la volta dopo chiede conferma
function fmRigaFile(f) {
  const stampa = fmDaStampare(f.nome);
  const s = FileMattino.stampe[f.percorso];
  const azione = stampa ? 'Stampa' : 'Scarica';
  const fatto = s ? `${stampa ? 'Stampato' : 'Scaricato'} ${fmQuando(s.stampato_at)}${s.stampato_da ? ` da ${s.stampato_da}` : ''}` : '';
  const stato = s ? fatto : fmPeso(f.peso);
  const apri = !fmCalzini(f) ? '' : `
      <button type="button" class="btn btn-secondary fm-scarica" data-percorso="${escapeHtml(f.percorso)}" onclick="fmApri(this)"
        aria-label="Apri il PDF ${escapeHtml(f.nome)}">${Icons.eye(15)} Apri</button>`;
  const copie = f.copie ? `<span class="fm-file-copie">${f.copie.length} ${f.copie.length === 1 ? 'pagina' : 'pagine'}, ${f.copie.reduce((x, y) => x + y, 0)} stampe — ${escapeHtml(fmTestoCopie(f.copie))}</span>` : '';
  return `
    <li class="fm-file">
      <span class="fm-file-nome">${escapeHtml(f.nome)}${copie}</span>
      <span class="fm-file-peso">${escapeHtml(stato)}</span>
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

// Il PDF si apre in una scheda nuova (aperta subito, se no il browser la blocca) e si stampa da lì
async function fmApri(btn) {
  const w = window.open('', '_blank');
  try {
    const { data, error } = await fmBucket().createSignedUrl(btn.dataset.percorso, 3600);
    if (error) throw error;
    if (w) { w.opener = null; w.location.href = data.signedUrl; }
    else window.location.assign(data.signedUrl);
    // Aperto per stamparlo: conta come stampa (la prima diventa un task fatto da chi stampa)
    fmSegna(btn.dataset.percorso).catch(e => console.warn('Stampa non segnata', e));
  } catch (e) {
    w?.close();
    uiAlert(`Il PDF non si apre: ${e.message || e}`);
  }
}

function renderFileMattino() {
  const root = document.getElementById('file-mattino-root');
  if (!root) return;
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
