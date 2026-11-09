// Sendcloud: collega "Spedizione da" (indirizzo mittente, quindi logo) al filtro del negozio
// nella pagina Ordini in entrata, nei due sensi, e mostra sempre una barra di controllo.
// Se Sendcloud cambia la pagina e il cambio automatico smette di funzionare,
// la barra lo dice (arancione) invece di restare zitta.

(() => {
  // Negozio (id integrazione Sendcloud) <-> inizio del nome dell'indirizzo mittente
  const COPPIE = [
    { negozio: 'BIENJUGADO',        integrazione: '424826', mittente: 'Bienjugado srl' },
    { negozio: 'DREAMSOCKS',        integrazione: '424827', mittente: 'Dreamsocks' },
    { negozio: 'BOX FACTORY LAB',   integrazione: '424828', mittente: 'Box Factory Lab' },
    { negozio: 'CIUCCIAMILCALZINO', integrazione: '424829', mittente: 'Ciucciami il Calzino' },
    { negozio: 'ASTEROIDI STORE',   integrazione: '647058', mittente: 'T&C FACTORY' },
  ];

  const SEL = {
    mittenteValore: '[data-test=sender-address-value]',
    mittenteBottone: '#address-switcher-button',
    mittenteVoce: 'li[data-test=address-switcher-item]',
    filtroNegozio: '[data-test=integration-switcher-button]',
  };

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const suPaginaOrdini = () => location.pathname.startsWith('/v2/shipping/list/orders');

  const mittenteAttuale = () => {
    const el = document.querySelector(SEL.mittenteValore);
    return el ? el.textContent : null;
  };
  const coppiaDaMittente = (testo) =>
    COPPIE.find((c) => norm(testo).startsWith(norm(c.mittente))) || null;
  const integrazioneAttuale = () => new URL(location.href).searchParams.get('integration') || 'all';
  const coppiaDaIntegrazione = (id) => COPPIE.find((c) => c.integrazione === id) || null;

  // ---------- Barra di controllo ----------
  let barra;
  function mostra(stato, testo) {
    if (!barra) {
      barra = document.createElement('div');
      barra.id = 'cs-sendcloud-mittente';
      Object.assign(barra.style, {
        position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)',
        zIndex: 2147483647, padding: '10px 18px', borderRadius: '999px',
        font: '600 14px/1.3 system-ui, -apple-system, sans-serif', color: '#fff',
        boxShadow: '0 4px 16px rgba(0,0,0,.25)', maxWidth: 'calc(100vw - 32px)', textAlign: 'center',
        pointerEvents: 'none',
      });
      document.body.appendChild(barra);
    }
    const colori = { ok: '#1a7f37', errore: '#c62828', rotto: '#e07000' };
    barra.style.background = colori[stato];
    barra.style.fontSize = stato === 'ok' ? '14px' : '16px';
    barra.textContent = testo;
    barra.style.display = 'block';
  }
  function nascondi() { if (barra) barra.style.display = 'none'; }

  // ---------- Azioni automatiche ----------
  let occupato = false;

  // I menu di Sendcloud a volte "mangiano" il primo click (es. mentre un altro menu si sta chiudendo):
  // per questo ogni scelta riprova fino a 4 volte.
  async function scegliMittente(coppia) {
    for (let tentativo = 0; tentativo < 4; tentativo++) {
      const bottone = document.querySelector(SEL.mittenteBottone);
      if (!bottone) return false;
      await pausa(300);
      let voci = document.querySelectorAll(SEL.mittenteVoce);
      if (!voci.length) { bottone.click(); await pausa(500); voci = document.querySelectorAll(SEL.mittenteVoce); }
      const voce = [...voci].find((li) => norm(li.textContent).startsWith(norm(coppia.mittente)));
      if (voce) {
        (voce.querySelector('button') || voce).click(); // il click va sul bottone dentro la voce
        await pausa(800);
        const c = coppiaDaMittente(mittenteAttuale());
        if (c && c.integrazione === coppia.integrazione) return true;
      } else if (voci.length) {
        bottone.click(); // menu aperto ma indirizzo non c'è: chiudi e smetti
        return false;
      }
    }
    return false;
  }

  async function scegliNegozio(coppia) {
    for (let tentativo = 0; tentativo < 4; tentativo++) {
      const filtro = document.querySelector(SEL.filtroNegozio);
      if (!filtro) return false;
      await pausa(300);
      const aperto = () => filtro.querySelector('.ui-dropdown__list-wrapper--open');
      if (!aperto()) { filtro.querySelector('button')?.click(); await pausa(500); }
      if (!aperto()) continue;
      const voce = [...filtro.querySelectorAll('[role=option]')]
        .find((o) => norm(o.textContent) === norm(coppia.negozio));
      if (!voce) { filtro.querySelector('button')?.click(); return false; }
      voce.click();
      await pausa(1200);
      if (integrazioneAttuale() === coppia.integrazione) return true;
    }
    return false;
  }

  // ---------- Controllo continuo ----------
  let ultimoMittente = null;
  let ultimaIntegrazione = null;
  let syncRotto = false;

  async function controlla() {
    if (!suPaginaOrdini()) { nascondi(); return; }
    if (occupato) return;

    const testoMittente = mittenteAttuale();
    const integrazione = integrazioneAttuale();

    if (testoMittente === null) {
      mostra('rotto', '⚠ Estensione mittente: non trovo "Spedizione da" nella pagina. Controlla a mano mittente e negozio prima di creare le etichette.');
      return;
    }

    const cMitt = coppiaDaMittente(testoMittente);
    const cInt = coppiaDaIntegrazione(integrazione);

    // Cambio automatico: segue quello che hai appena cambiato tu.
    const cambiatoMittente = ultimoMittente !== null && norm(testoMittente) !== norm(ultimoMittente);
    const cambiataIntegrazione = ultimaIntegrazione !== null && integrazione !== ultimaIntegrazione;
    const primaVolta = ultimoMittente === null;
    ultimoMittente = testoMittente;
    ultimaIntegrazione = integrazione;

    if (cMitt && cInt !== cMitt) {
      // mittente e negozio non coincidono: decidi chi seguire
      let fatto = null;
      occupato = true;
      try {
        if (cambiataIntegrazione && cInt) fatto = await scegliMittente(cInt);
        else if (cambiatoMittente || (primaVolta && !cInt)) fatto = await scegliNegozio(cMitt);
        else if (primaVolta && cInt) fatto = await scegliMittente(cInt);
      } finally {
        occupato = false;
        ultimoMittente = mittenteAttuale();
        ultimaIntegrazione = integrazioneAttuale();
      }
      if (fatto === false) syncRotto = true;
      if (fatto === true) syncRotto = false;
    }

    disegna();
  }

  function disegna() {
    const testoMittente = mittenteAttuale();
    if (testoMittente === null) return;
    const cMitt = coppiaDaMittente(testoMittente);
    const integrazione = integrazioneAttuale();
    const cInt = coppiaDaIntegrazione(integrazione);
    const nomeMitt = testoMittente.split(',')[0].trim();

    if (!cMitt) {
      mostra('errore', `⚠ Mittente "${nomeMitt}" non riconosciuto dall'estensione: controlla il logo prima di creare le etichette.`);
    } else if (integrazione === 'all') {
      mostra('errore', `⚠ Stai vedendo TUTTI i negozi con mittente ${nomeMitt}: gli ordini degli altri negozi uscirebbero col logo sbagliato. Scegli un negozio.`);
    } else if (!cInt) {
      mostra('errore', `⚠ Negozio filtrato non riconosciuto dall'estensione: controlla il mittente (ora ${nomeMitt}).`);
    } else if (cInt !== cMitt) {
      mostra('errore', `⚠ ATTENZIONE: negozio ${cInt.negozio} ma mittente ${nomeMitt}. Logo sbagliato!`);
    } else if (syncRotto) {
      mostra('rotto', `✓ ${cInt.negozio} ↔ ${nomeMitt} — ma il cambio automatico non ha funzionato: Sendcloud potrebbe aver cambiato la pagina.`);
    } else {
      mostra('ok', `✓ ${cInt.negozio} spedisce come ${nomeMitt}`);
    }
  }

  setInterval(controlla, 700);
})();
