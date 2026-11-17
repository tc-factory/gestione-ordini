/* ════════════════════════════════════════════════════════
 * Presenze: chi lavora oggi conferma di essere al lavoro (sql/presenze.sql)
 *
 * • Prima della conferma, sotto la testata c'è la barra "Sei al lavoro?" con il pulsante.
 * • Passati 30 minuti dall'orario standard senza conferma si apre un popup a lui
 *   e agli addetti alle presenze (che possono confermare per lui). Si ripete ogni 15 minuti.
 * • Si conferma solo dalla rete del posto di lavoro: lo controlla il database dall'IP.
 * ════════════════════════════════════════════════════════ */

const Presenze = {
  stato: null,
  _timer: null,
  _chiesto: {},           // persona → ultima volta che il popup è stato mostrato
  RIPETI_MS: 15 * 60 * 1000,

  async start() {
    this.stop();
    await this.check();
    this._timer = setInterval(() => this.check(), 60 * 1000);
  },

  stop() {
    clearInterval(this._timer);
    Object.assign(this, { _timer: null, stato: null, _chiesto: {} });
    this.renderBar();
  },

  async check() {
    const { data, error } = await supabaseClient.rpc('tc_presenze_stato');
    if (error || !data?.success) return;
    // La pagina si ridisegna solo se l'elenco è cambiato (non a ogni minuto: si perderebbe ciò che si sta scrivendo)
    const cambiato = JSON.stringify(data.tutti) !== JSON.stringify(this.stato?.tutti);
    this.stato = data;
    this.renderBar();
    if (cambiato && data.addetto && typeof ctrlAperto === 'function' && ctrlAperto() && ['squadra', 'giorno'].includes(Ctrl.view)) refreshControlPage();
    this.popup();
  },

  async conferma(chi = null) {
    const { data, error } = await supabaseClient.rpc('tc_presenza_conferma', { p_chi: chi });
    if (error || !data?.success) { showToast(data?.error || 'Errore di connessione', 'error'); return false; }
    showToast(chi ? `Presenza di ${chi} confermata` : 'Presenza confermata, buon lavoro');
    await this.check();
    return true;
  },

  // Riquadro Presenze (addetti): grigio → presente → assente → da confermare
  async ciclo(chi) {
    const p = (this.stato?.tutti || []).find(x => x.nickname === chi);
    const prossimo = !p?.stato ? 'presente' : p.stato === 'presente' ? 'assente' : null;
    const { data, error } = await supabaseClient.rpc('tc_presenza_imposta', { p_chi: chi, p_stato: prossimo });
    if (error || !data?.success) { showToast(data?.error || 'Errore di connessione', 'error'); return; }
    await this.check();
  },

  renderBar() {
    let el = document.getElementById('presenza-bar');
    const me = this.stato?.me;
    if (!me || me.confermato_at) { el?.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'presenza-bar';
      el.className = 'presenza-bar';
      el.setAttribute('role', 'status');
      document.getElementById('header-root')?.insertAdjacentElement('afterend', el);
    }
    el.classList.toggle('is-late', !!me.scaduto);
    el.innerHTML = `
      <span><strong>Sei al lavoro?</strong> Entrata alle ${escapeHtml(me.ora_inizio)}.
        ${this.stato.in_rete ? '' : this.stato.reti ? 'Puoi confermare solo dalla rete del posto di lavoro.' : 'La rete del posto di lavoro non è ancora stata registrata.'}</span>
      ${this.stato.in_rete ? `<button type="button" class="btn btn-primary" onclick="Presenze.conferma()">Sono al lavoro</button>` : ''}`;
  },

  // Un popup alla volta: prima la propria presenza, poi quelle degli altri (addetti)
  async popup() {
    if (UIDialog._resolve || this._inCorso) return;
    const s = this.stato, ora = Date.now();
    const daChiedere = (k) => !this._chiesto[k] || ora - this._chiesto[k] > this.RIPETI_MS;
    const coda = [];
    if (s.me && !s.me.confermato_at && s.me.scaduto && daChiedere('')) coda.push(null);
    const me = TCAuth.getNickname();
    (s.tutti || []).filter(p => !p.assente && !p.confermato_at && p.scaduto && p.nickname !== me && daChiedere(p.nickname))
      .forEach(p => coda.push(p));
    if (!coda.length) return;

    this._inCorso = true;
    try {
      for (const p of coda) {
        this._chiesto[p ? p.nickname : ''] = Date.now();
        const ok = await uiConfirm(p
          ? `${p.nickname} non ha confermato la presenza (entrata alle ${p.ora_inizio}). È al lavoro?`
          : `Non hai ancora confermato la presenza (entrata alle ${s.me.ora_inizio}). Sei al lavoro?`,
          { title: 'Presenza', ok: p ? 'Sì, confermo' : 'Sono al lavoro', cancel: 'Non ora' });
        if (ok) await this.conferma(p ? p.nickname : null);
      }
    } finally { this._inCorso = false; }
  },
};
