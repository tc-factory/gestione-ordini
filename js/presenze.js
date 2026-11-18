/* ════════════════════════════════════════════════════════
 * Presenze (sql/presenze.sql)
 *
 * • Chi apre il gestionale col proprio account dalla rete del posto di lavoro
 *   risulta presente in automatico: niente domande né popup.
 * • Fuori dalla rete non si conferma; gli addetti possono sempre segnare
 *   presenti o assenti gli altri dal riquadro del team.
 * ════════════════════════════════════════════════════════ */

const Presenze = {
  stato: null,
  _timer: null,

  async start() {
    this.stop();
    await this.check();
    this._timer = setInterval(() => this.check(), 60 * 1000);
  },

  stop() {
    clearInterval(this._timer);
    Object.assign(this, { _timer: null, stato: null, _auto: false });
    document.getElementById('presenza-bar')?.remove();
  },

  async check() {
    const { data, error } = await supabaseClient.rpc('tc_presenze_stato');
    if (error || !data?.success) return;
    // La pagina si ridisegna solo se l'elenco è cambiato (non a ogni minuto: si perderebbe ciò che si sta scrivendo)
    const cambiato = JSON.stringify(data.tutti) !== JSON.stringify(this.stato?.tutti);
    this.stato = data;
    if (cambiato && data.addetto && typeof ctrlAperto === 'function' && ctrlAperto() && ['squadra', 'giorno'].includes(Ctrl.view)) refreshControlPage();
    // Aperto il gestionale dalla rete del lavoro: presente, senza chiedere (chi è segnato assente resta assente)
    const me = data.me;
    if (me && !me.confermato_at && !me.stato && data.in_rete && !this._auto) {
      this._auto = true;
      const { data: r } = await supabaseClient.rpc('tc_presenza_conferma', { p_chi: null });
      this._auto = false;
      if (r?.success) {
        if (r.restituiti) showToast(`${r.restituiti} task tornati a te`);
        await this.check();
        if (typeof ctrlAperto === 'function' && ctrlAperto()) { await Ctrl.load(); refreshControlPage(); }
      }
    }
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
    if (prossimo === 'assente' && !(await uiConfirm(`Segnare ${chi} assente oggi? I suoi task vanno in coda comune; tornano a ${chi} se lo rimetti presente.`,
      { title: 'Assenza', ok: 'Segna assente', danger: true }))) return;
    const { data, error } = await supabaseClient.rpc('tc_presenza_imposta', { p_chi: chi, p_stato: prossimo });
    if (error || !data?.success) { showToast(data?.error || 'Errore di connessione', 'error'); return; }
    if (data.restituiti) showToast(`${data.restituiti} task tornati a ${chi}`);
    await this.check();
    // Il carico cambia quando i task vanno in coda o tornano
    if (typeof ctrlAperto === 'function' && ctrlAperto()) { await Ctrl.load(); refreshControlPage(); }
  },

};
