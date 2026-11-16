/**
 * T&C Factory — File del mattino
 *
 * DDT, file di stampa e fogli DTF che lo script del mattino carica ogni giorno nel bucket privato
 * file-mattino (AAAA-MM-GG/..., con la sottocartella DTF). Qui si elencano per giorno e si scaricano
 * con un link firmato. La pulizia della domenica tiene solo l'ultima cartella generata (sql/file-mattino.sql).
 * Il DDT non si scarica: "Stampa" apre la finestra di stampa del browser e lo segna stampato (file_mattino_stampe),
 * il bottone diventa verde e una nuova stampa chiede conferma con data, ora e chi l'ha stampato.
 */

const FileMattino = { giorni: null, errore: null, carica: null, stampe: {} };
const fmDaStampare = (nome) => nome === 'DDT.pdf';

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

function fmRigaFile(f) {
  if (fmDaStampare(f.nome)) {
    const s = FileMattino.stampe[f.percorso];
    return `
    <li class="fm-file">
      <span class="fm-file-nome">${escapeHtml(f.nome)}</span>
      <span class="fm-file-peso">${s ? `Stampato ${escapeHtml(fmQuando(s.stampato_at))}` : fmPeso(f.peso)}</span>
      <button type="button" class="btn btn-secondary fm-scarica fm-stampa ${s ? 'is-stampato' : ''}" data-percorso="${escapeHtml(f.percorso)}" onclick="fmStampa(this)"
        aria-label="Stampa ${escapeHtml(f.nome)}${s ? ', già stampato' : ''}">${Icons.printer(15)} Stampa</button>
    </li>`;
  }
  return `
    <li class="fm-file">
      <span class="fm-file-nome">${escapeHtml(f.nome)}</span>
      <span class="fm-file-peso">${fmPeso(f.peso)}</span>
      <button type="button" class="btn btn-secondary fm-scarica" data-percorso="${escapeHtml(f.percorso)}" onclick="fmScarica(this)"
        aria-label="Scarica ${escapeHtml(f.nome)}">${Icons.download(15)} Scarica</button>
    </li>`;
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
  } catch (e) {
    uiAlert(`Download non riuscito: ${e.message || e}`);
  } finally {
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
  const s = FileMattino.stampe[percorso];
  if (s && !(await uiConfirm(`Già stampato ${fmQuando(s.stampato_at)}${s.stampato_da ? ` da ${s.stampato_da}` : ''}. Stampare di nuovo?`,
    { title: 'Attenzione', ok: 'Sì', cancel: 'No' }))) return;
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
    const { data: riga, error: e2 } = await supabaseClient.rpc('tc_file_mattino_stampato', { p_percorso: percorso });
    if (e2) throw e2;
    FileMattino.stampe[percorso] = riga;
    renderFileMattino();
  } catch (e) {
    uiAlert(`Stampa non riuscita: ${e.message || e}`);
    btn.disabled = false;
  }
}
