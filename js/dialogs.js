// Popup di conferma, inserimento e avviso con la grafica del gestionale,
// al posto di confirm(), prompt() e alert() del browser.
// Sempre al centro della pagina, anche su telefono.
//
//   if (!(await uiConfirm('Eliminare il tag?', { ok: 'Elimina', danger: true }))) return;
//   const nome = await uiPrompt('Nome del nuovo fornitore:');      // null se annullato
//   await uiAlert('Errore calendario: ...');

const UIDialog = {
  _resolve: null,
  _prevFocus: null,

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  _overlay() {
    let el = document.getElementById('ui-dialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ui-dialog';
      el.className = 'modal-overlay ui-dialog-overlay';
      document.body.appendChild(el);
    }
    return el;
  },

  // Il primo paragrafo è la domanda, gli altri (separati da una riga vuota) sono note
  _testo(msg) {
    const parti = String(msg ?? '').split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    return parti.map((p, i) => `<p class="${i ? 'ui-dialog-note' : 'ui-dialog-text'}">${this._esc(p)}</p>`).join('');
  },

  _close(value) {
    const el = document.getElementById('ui-dialog');
    const resolve = this._resolve;
    this._resolve = null;
    document.removeEventListener('keydown', this._onKey, true);
    if (el && el.classList.contains('active')) {
      el.classList.remove('active');
      el.classList.add('closing');
      clearTimeout(el._closeTimer);
      el._closeTimer = setTimeout(() => el.classList.remove('closing'), 180);
    }
    try { this._prevFocus?.focus?.(); } catch {}
    resolve?.(value);
  },

  _onKey(e) {
    if (!UIDialog._resolve) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      UIDialog._cancel();
    } else if (e.key === 'Enter' && !e.shiftKey && e.target?.tagName !== 'BUTTON') {
      e.preventDefault(); e.stopPropagation();
      UIDialog._confirm();
    }
  },

  _cancel() { this._close(this._mode === 'alert' ? undefined : (this._mode === 'prompt' ? null : false)); },

  _confirm() {
    if (this._mode === 'prompt') {
      const v = document.getElementById('ui-dialog-input')?.value ?? '';
      this._close(v);
    } else {
      this._close(this._mode === 'alert' ? undefined : true);
    }
  },

  open(mode, msg, opts = {}) {
    // Un popup già aperto viene chiuso come annullato
    if (this._resolve) this._cancel();
    this._mode = mode;
    this._prevFocus = document.activeElement;
    const el = this._overlay();
    const okLabel = opts.ok || (mode === 'alert' ? 'Ok' : 'Conferma');
    const okClass = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
    const titolo = opts.title ? `<h2 id="ui-dialog-title" class="ui-dialog-title">${this._esc(opts.title)}</h2>` : '';
    const input = mode === 'prompt'
      ? `<input id="ui-dialog-input" class="form-input" type="${opts.type || 'text'}" autocomplete="${opts.type === 'password' ? 'new-password' : 'off'}"
           value="${this._esc(opts.value || '')}" placeholder="${this._esc(opts.placeholder || '')}">`
      : '';
    el.innerHTML = `
      <div class="modal ui-dialog" role="${mode === 'alert' ? 'alertdialog' : 'dialog'}" aria-modal="true"
           ${opts.title ? 'aria-labelledby="ui-dialog-title"' : ''} aria-describedby="ui-dialog-body">
        <div class="ui-dialog-body" id="ui-dialog-body">
          ${titolo}
          ${this._testo(msg)}
          ${input}
        </div>
        <div class="ui-dialog-actions">
          ${mode === 'alert' ? '' : `<button type="button" class="btn btn-secondary" data-ui="cancel">${this._esc(opts.cancel || 'Annulla')}</button>`}
          <button type="button" class="${okClass}" data-ui="ok">${this._esc(okLabel)}</button>
        </div>
      </div>`;
    el.querySelector('[data-ui="cancel"]')?.addEventListener('click', () => this._cancel());
    el.querySelector('[data-ui="ok"]').addEventListener('click', () => this._confirm());
    el.onclick = (e) => { if (e.target === el) this._cancel(); };
    el.classList.remove('closing');
    el.classList.add('active');
    document.addEventListener('keydown', this._onKey, true);
    setTimeout(() => {
      const inp = document.getElementById('ui-dialog-input');
      if (inp) { inp.focus(); inp.select(); }
      else el.querySelector('[data-ui="ok"]')?.focus();
    }, 30);
    return new Promise(resolve => { this._resolve = resolve; });
  },
};

function uiConfirm(msg, opts) { return UIDialog.open('confirm', msg, opts); }
function uiPrompt(msg, opts) { return UIDialog.open('prompt', msg, opts); }
function uiAlert(msg, opts) { return UIDialog.open('alert', msg, opts); }
