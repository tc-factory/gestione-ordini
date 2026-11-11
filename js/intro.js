/* ============================================
   INTRO — rete neurale all'apertura di Creative System
   Sfera di neuroni in 3D; utenti, negozi, corrieri e macchine in pillole di vetro
   che le girano intorno, collegate con fili gialli. Gira sempre più veloce,
   si comprime, esplode e lascia la scritta; poi si apre il gestionale.
   Durata massima 5 s. Clic, tocco o tasto: salta.
   Una volta per scheda (sessionStorage); ?intro nell'indirizzo la forza.
   ============================================ */

const Intro = {
  KEY: 'cs_intro_visto',
  T_BOOM: 3.15,     // esplosione
  T_CLOSE: 4.25,    // inizio apertura del gestionale (+0,7 s di uscita)

  UTENTI: ['Riccardo', 'Gianluca', 'Lisa', 'Jacopo', 'Matteo', 'Simone', 'Andrea', 'Luca', 'Michele', 'Claude'],
  NEGOZI: [
    { t: 'Ciucciami il Calzino', c: '#ec4899' },
    { t: 'Bienjugado',           c: '#f59e0b' },
    { t: 'Box Factory Lab',      c: '#818cf8' },
    { t: 'Asteroidi Store',      c: '#14b8a6' },
  ],
  CORRIERI: ['GLS', 'Sendcloud'],
  MACCHINE: [
    { t: 'Stampante DTF', c: '#5AE1F0' },
    { t: 'Stampante UV',  c: '#A078F0' },
    { t: 'Mimaki',        c: '#5AE1F0' },
    { t: 'Laser',         c: '#ff6b6b' },
  ],

  // Da chiamare subito: decide se l'intro va mostrata (e toglie il velo se no)
  shouldPlay() {
    const el = document.getElementById('cs-intro');
    let forza = /[?&#]intro\b/.test(location.search + location.hash), visto = false;
    try { visto = sessionStorage.getItem(this.KEY) === '1'; } catch {}
    const ridotto = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ok = !!el && (forza || (!visto && !ridotto));
    if (!ok) el?.remove();
    return ok;
  },

  // Nomi degli utenti dal database (solo con la sessione attiva)
  async utentiDalDb() {
    const { data, error } = await supabaseClient.from('app_users').select('nickname').order('created_at');
    if (error || !data?.length) return null;
    return data.map(u => u.nickname).filter(n => n && n !== 'tcfactory')
      .map(n => n.charAt(0).toUpperCase() + n.slice(1));
  },

  // Utenti veri: arrivano dopo il controllo della sessione. Se tardano si usa l'elenco fisso.
  _nomi: null,
  fornisciNomi(p) {
    Promise.resolve(p).then(n => { if (Array.isArray(n) && n.length) this._nomi = n.slice(0, 14); }, () => {});
  },

  // Salvaschermo: la stessa rete, continua, finché non si tocca lo schermo o un tasto
  screensaver(onEnd) {
    if (document.getElementById('cs-intro') || document.getElementById('cs-saver')) return null;
    const root = document.createElement('div');
    root.id = 'cs-saver'; root.className = 'cs-intro ss'; root.setAttribute('aria-hidden', 'true');
    root.style.opacity = '0';
    document.body.appendChild(root);
    const chiudi = this._run(root, true, onEnd);
    requestAnimationFrame(() => requestAnimationFrame(() => { root.style.transition = 'opacity 0.9s ease'; root.style.opacity = '1'; }));
    return chiudi;
  },

  play() {
    const root = document.getElementById('cs-intro');
    if (!root) return;
    try { sessionStorage.setItem(this.KEY, '1'); } catch {}
    this._run(root);
  },

  // ss = salvaschermo: gira all'infinito, niente esplosione; onEnd quando si chiude
  _run(root, ss = false, onEnd = null) {
    const self = this;
    const T_BOOM = self.T_BOOM, T_CLOSE = self.T_CLOSE;
    root.innerHTML = `
      <canvas class="cs-intro-net"></canvas>
      <div class="cs-intro-tags"></div>
      <canvas class="cs-intro-fx"></canvas>
      <div class="cs-intro-brand" role="img" aria-label="Creative System">
        <span class="fill"></span><span class="sheen"></span>
      </div>
      <div class="cs-intro-skip">${ss ? 'Tocca lo schermo o premi un tasto' : 'Tocca per saltare'}</div>`;
    new Image().src = 'img/brand/cs-testo-bianco.png'; // la maschera della scritta deve essere pronta al botto
    const net = root.querySelector('.cs-intro-net'), fx = root.querySelector('.cs-intro-fx');
    const ctx = net.getContext('2d'), fxc = fx.getContext('2d');
    const tagsBox = root.querySelector('.cs-intro-tags'), brand = root.querySelector('.cs-intro-brand');

    // ── Misure ──
    let W, H, DPR, cx, cy, R;
    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = root.clientWidth; H = root.clientHeight;
      for (const c of [net, fx]) { c.width = W * DPR; c.height = H * DPR; }
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0); fxc.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * (W < 640 ? 0.2 : 0.17);
    };
    resize();
    window.addEventListener('resize', resize);

    // ── Neuroni: punti di Fibonacci sulla sfera, un po' irregolari ──
    const N = W < 640 ? 120 : 170, GOLD = Math.PI * (3 - Math.sqrt(5));
    const nodes = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), a = i * GOLD;
      const k = 0.9 + Math.random() * 0.16;
      nodes.push({ x: Math.cos(a) * r * k, y: y * k, z: Math.sin(a) * r * k, s: 0.6 + Math.random() * 1.2, ph: Math.random() * 6.28 });
    }
    // Sinapsi: ogni neurone ai 3 vicini più qualche corda interna
    const edges = [], seen = new Set();
    const addEdge = (a, b) => { const k = a < b ? a + '-' + b : b + '-' + a; if (!seen.has(k) && a !== b) { seen.add(k); edges.push([a, b]); } };
    nodes.forEach((n, i) => {
      nodes.map((m, j) => [j, (n.x - m.x) ** 2 + (n.y - m.y) ** 2 + (n.z - m.z) ** 2])
        .sort((p, q) => p[1] - q[1]).slice(1, 4).forEach(([j]) => addEdge(i, j));
    });
    for (let i = 0; i < N / 6; i++) addEdge((Math.random() * N) | 0, (Math.random() * N) | 0);
    const signals = [];

    // ── Etichette: punti di Fibonacci su un'orbita più ampia, lontane dai poli ──
    let tags = [];
    const buildTags = (t) => {
    const voci = [
      ...(self._nomi || self.UTENTI).map(t => ({ t, c: '#FFD35C' })),
      ...self.NEGOZI.map(n => ({ ...n, k: 'negozio' })),
      ...self.CORRIERI.map(t => ({ t, c: '#5B86E5', k: 'corriere' })),
      ...self.MACCHINE.map(m => ({ ...m, k: 'stampa' })),
    ].sort(() => Math.random() - 0.5);
    const K = voci.length;
    tags = voci.map((v, i) => {
      const y = (1 - (i + 0.5) / K * 2) * 0.78, r = Math.sqrt(1 - y * y), a = i * GOLD * 1.7;
      const el = document.createElement('div');
      el.className = 'cs-intro-tag';
      el.style.setProperty('--c', v.c);
      el.innerHTML = `<i></i>${v.t.replace(/</g, '&lt;')}${v.k ? `<small>${v.k}</small>` : ''}`;
      tagsBox.appendChild(el);
      const d = { x: Math.cos(a) * r, y, z: Math.sin(a) * r };
      // neurone d'aggancio: il più vicino alla direzione dell'etichetta
      let best = 0, bd = 9;
      nodes.forEach((n, j) => { const q = (n.x - d.x) ** 2 + (n.y - d.y) ** 2 + (n.z - d.z) ** 2; if (q < bd) { bd = q; best = j; } });
      return { el, d, node: best, c: v.c, born: t + 0.02 + i * (1.2 / K), w: 0, h: 0, vx: 0, vy: 0, px: 0, py: 0, rot: 0 };
    });
    const misura = () => tags.forEach(g => { g.w = g.el.offsetWidth; g.h = g.el.offsetHeight; });
    misura();
    document.fonts?.ready.then(misura);
    };

    // ── Proiezione ──
    let theta = 0;
    const proj = (p, rad, th, tilt) => {
      const ct = Math.cos(th), st = Math.sin(th), cx1 = Math.cos(tilt), sx1 = Math.sin(tilt);
      const x = p.x * ct + p.z * st, z0 = -p.x * st + p.z * ct;
      const y = p.y * cx1 - z0 * sx1, z = p.y * sx1 + z0 * cx1;
      const f = 3.2, s = f / (f + z);
      return { x: cx + x * rad * s, y: cy + y * rad * s, z, s };
    };
    const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
    const backOut = (t) => { t = Math.min(1, Math.max(0, t)); const c = 2.2; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

    // ── Esplosione ──
    let boomed = false;
    const sparks = [];
    const boom = (pn) => {
      boomed = true;
      const COL = ['#FFD35C', '#FFE38F', '#FFFFFF', '#5B86E5', '#A078F0', '#5AE1F0'];
      pn.forEach(p => {
        const dx = p.x - cx, dy = p.y - cy, l = Math.hypot(dx, dy) || 1, v = 500 + Math.random() * 1300;
        sparks.push({ x: p.x, y: p.y, vx: dx / l * v, vy: dy / l * v, r: 1 + Math.random() * 2.2, c: COL[(Math.random() * COL.length) | 0], life: 0.7 + Math.random() * 0.6 });
      });
      for (let i = 0; i < (W < 640 ? 140 : 260); i++) {
        const a = Math.random() * 6.283, v = 300 + Math.random() * 1800;
        sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0.6 + Math.random() * 1.8, c: COL[(Math.random() * COL.length) | 0], life: 0.5 + Math.random() * 0.8 });
      }
      tags.forEach(g => {
        const dx = g.px - cx, dy = g.py - cy, l = Math.hypot(dx, dy) || 1, v = 900 + Math.random() * 900;
        g.vx = dx / l * v; g.vy = dy / l * v; g.rot = (Math.random() - 0.5) * 70;
      });
      brand.classList.add('on');
    };

    // ── Ciclo ──
    let t0 = performance.now(), last = t0, raf = 0, closing = false, done = false, closeT = 0;
    const frame = (now) => {
      const t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;

      // velocità angolare: lenta, poi cresce in modo esponenziale fino all'esplosione
      if (!tags.length && (ss || t >= 0.28 || self._nomi)) buildTags(ss ? 0.4 : t);
      // salvaschermo: velocità costante, inclinazione che ondeggia piano, battito ogni tanto
      const acc = ss ? 0 : Math.max(0, (t - 0.5) / (T_BOOM - 0.5));
      const omega = ss ? 0.3 : 0.55 + 30 * acc ** 3.2;
      theta += omega * dt;
      const tilt = ss ? 0.36 + Math.sin(t * 0.21) * 0.2 : 0.38 + Math.sin(t * 0.9) * 0.08;
      const beat = ss ? Math.max(0, Math.sin(t * 0.8)) ** 12 : 0;
      // compressione prima del botto
      const squeeze = !ss && t < T_BOOM ? 1 - 0.28 * ease((t - (T_BOOM - 0.38)) / 0.38) : 1;
      const appear = backOut(t / 0.75);
      const rad = R * appear * squeeze * (1 + (ss ? 0.03 * Math.sin(t * 0.8) + 0.04 * beat : 0.04 * Math.sin(t * 6) * (1 - acc)));

      // scia: con l'accelerazione la tela si cancella solo in parte
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${boomed ? 0.35 : 1 - 0.7 * acc ** 1.5})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';

      const pn = nodes.map(n => proj(n, rad, theta, tilt));

      if (!boomed) {
        // alone centrale: si accende con la velocità
        const heat = acc ** 2 + beat * 0.35;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.5);
        g.addColorStop(0, `rgba(255,211,92,${0.10 + heat * 0.45})`);
        g.addColorStop(0.45, `rgba(91,134,229,${0.08 + heat * 0.2})`);
        g.addColorStop(1, 'rgba(91,134,229,0)');
        ctx.fillStyle = g; ctx.fillRect(cx - rad * 1.6, cy - rad * 1.6, rad * 3.2, rad * 3.2);

        // sinapsi
        // raggruppate per profondità: 5 tracciati invece di uno per linea
        ctx.lineWidth = 0.8;
        const fasce = [[], [], [], [], []];
        for (const e of edges) {
          const p = pn[e[0]], q = pn[e[1]], f = Math.min(4, ((1 - (p.z + q.z) / 2) / 2 * 5) | 0);
          fasce[f].push(p, q);
        }
        fasce.forEach((pts, f) => {
          if (!pts.length) return;
          ctx.strokeStyle = `rgba(${150 + heat * 105 | 0},${180 + heat * 40 | 0},255,${((0.10 + 0.32 * (f + 0.5) / 5) * appear).toFixed(3)})`;
          ctx.beginPath();
          for (let i = 0; i < pts.length; i += 2) { ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[i + 1].x, pts[i + 1].y); }
          ctx.stroke();
        });
        // impulsi lungo le sinapsi
        const spawn = (2 + 40 * acc + 14 * beat) * dt * 10;
        for (let i = 0; i < spawn; i++) if (signals.length < 160) signals.push({ e: edges[(Math.random() * edges.length) | 0], p: 0, v: 1.2 + Math.random() * 2 });
        for (let i = signals.length - 1; i >= 0; i--) {
          const s = signals[i]; s.p += s.v * dt * (1 + acc * 3);
          if (s.p >= 1) { signals.splice(i, 1); continue; }
          const p = pn[s.e[0]], q = pn[s.e[1]], x = p.x + (q.x - p.x) * s.p, y = p.y + (q.y - p.y) * s.p;
          ctx.fillStyle = 'rgba(255,227,143,0.95)';
          ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 6.283); ctx.fill();
          ctx.fillStyle = 'rgba(255,211,92,0.25)';
          ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
        }
        // neuroni
        pn.forEach((p, i) => {
          const n = nodes[i], front = 1 - (p.z + 1) / 2, tw = 0.6 + 0.4 * Math.sin(t * 4 + n.ph);
          const r = n.s * p.s * (1 + heat * 0.6);
          ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.7 * front) * tw * appear})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.283); ctx.fill();
          if (front > 0.6) {
            ctx.fillStyle = `rgba(143,176,255,${0.18 * front * appear})`;
            ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, 6.283); ctx.fill();
          }
        });
      }

      // etichette in orbita + fili gialli
      const orbit = Math.min(W, H) * (W < 640 ? 0.36 : 0.3) * squeeze;
      const stretch = Math.min(1.7, Math.max(1, W / H * 0.95));
      const stretchY = Math.min(2.2, Math.max(1, H / W * 0.9));   // telefono in verticale: orbita alta
      tags.forEach(g => {
        const life = (t - g.born) / 0.45;
        if (life <= 0) return;
        let x, y, s, op, z;
        if (!boomed) {
          const p = proj(g.d, orbit, theta * 0.82 + 0.4, tilt);
          x = cx + (p.x - cx) * stretch; y = cy + (p.y - cy) * stretchY; z = p.z; s = p.s * (0.55 + 0.45 * backOut(life));
          op = Math.min(1, life) * (0.42 + 0.58 * (1 - (z + 1) / 2));
          g.px = x; g.py = y;
          // filo giallo: cresce dal neurone verso l'etichetta
          const q = pn[g.node], grow = ease(life * 0.9);
          const ex = q.x + (x - q.x) * grow, ey = q.y + (y - q.y) * grow;
          const lg = ctx.createLinearGradient(q.x, q.y, ex, ey);
          lg.addColorStop(0, 'rgba(255,211,92,0.15)');
          lg.addColorStop(1, `rgba(255,211,92,${0.85 * op})`);
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.strokeStyle = `rgba(255,201,58,${0.12 * op})`;
          ctx.lineWidth = 5; ctx.stroke();
          // impulso che corre sul filo
          const k = (t * 1.6 + g.born * 3) % 1;
          ctx.fillStyle = `rgba(255,240,190,${op})`;
          ctx.beginPath(); ctx.arc(q.x + (ex - q.x) * k, q.y + (ey - q.y) * k, 2, 0, 6.283); ctx.fill();
          g.el.style.zIndex = z < 0 ? 4 : 1;
        } else {
          // via con lo scoppio
          g.px += g.vx * dt; g.py += g.vy * dt; g.vx *= 0.96; g.vy *= 0.96;
          const k = Math.min(1, (t - T_BOOM) / 0.55);
          x = g.px; y = g.py; s = 1 + k * 0.8; op = 1 - k; z = -1;
          g.el.style.zIndex = 7;
        }
        const blur = boomed ? 0 : Math.max(0, (omega - 6) / 5);
        g.el.style.opacity = op.toFixed(3);
        g.el.style.transform = `translate3d(${(x - g.w / 2).toFixed(1)}px,${(y - g.h / 2).toFixed(1)}px,0) scale(${s.toFixed(3)}) rotate(${boomed ? g.rot * (t - T_BOOM) : 0}deg)`;
        g.el.style.filter = blur > 0.3 ? `blur(${Math.min(4, blur).toFixed(1)}px)` : '';
      });

      if (!ss && !boomed && t >= T_BOOM) boom(pn);

      // effetti: lampo, onda d'urto, scintille
      fxc.clearRect(0, 0, W, H);
      if (boomed) {
        const k = t - T_BOOM;
        if (k < 0.6) {
          const a = 1 - k / 0.6;
          const g = fxc.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * (0.3 + k));
          g.addColorStop(0, `rgba(255,255,255,${a})`);
          g.addColorStop(0.25, `rgba(255,227,143,${a * 0.75})`);
          g.addColorStop(0.6, `rgba(91,134,229,${a * 0.3})`);
          g.addColorStop(1, 'rgba(91,134,229,0)');
          fxc.fillStyle = g; fxc.fillRect(0, 0, W, H);
        }
        const diag = Math.hypot(W, H);
        [[0, '255,211,92', 7], [0.08, '143,176,255', 4], [0.16, '90,225,240', 2]].forEach(([d, c, w]) => {
          const kk = (k - d) / 0.9;
          if (kk <= 0 || kk >= 1) return;
          const r = ease(kk) ** 0.7 * diag * 0.6;
          fxc.strokeStyle = `rgba(${c},${(1 - kk) * 0.8})`;
          fxc.lineWidth = w * (1 - kk) + 0.5;
          fxc.beginPath(); fxc.arc(cx, cy, r, 0, 6.283); fxc.stroke();
        });
        fxc.globalCompositeOperation = 'lighter';
        for (const p of sparks) {
          if (k > p.life) continue;
          const a = 1 - k / p.life;
          p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.955; p.vy *= 0.955;
          fxc.strokeStyle = p.c; fxc.globalAlpha = a; fxc.lineWidth = p.r;
          fxc.beginPath(); fxc.moveTo(p.x, p.y); fxc.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025); fxc.stroke();
        }
        fxc.globalAlpha = 1; fxc.globalCompositeOperation = 'source-over';
        // scossa
        const sh = k < 0.3 ? (1 - k / 0.3) * 9 : 0;
        net.style.transform = sh ? `translate(${(Math.random() - 0.5) * sh}px,${(Math.random() - 0.5) * sh}px)` : '';
        // scritta: entra dal bagliore
        const b = Math.min(1, Math.max(0, (k - 0.08) / 0.75));
        const via = closeT ? ease((t - closeT) / 0.4) : 0;   // all'uscita la scritta vola verso chi guarda
        brand.style.opacity = (Math.min(1, b * 1.6) * (1 - via)).toFixed(3);
        brand.style.filter = `blur(${(18 * (1 - ease(b))).toFixed(1)}px) drop-shadow(0 0 ${(28 - 14 * ease(b)).toFixed(1)}px rgba(255,211,92,${(0.55 * Math.min(1, b * 2)).toFixed(2)}))`;
        brand.style.transform = `translate(-50%,-50%) scale(${((0.55 + 0.45 * backOut(b) + k * 0.03) * (1 + via * 0.7)).toFixed(4)})`;
      }

      if (!ss && t >= T_CLOSE) close(false);
      if (!done) raf = requestAnimationFrame(frame);
    };

    const close = (fast) => {
      if (closing) { if (fast) root.classList.add('fast'); return; }
      closing = true;
      closeT = (performance.now() - t0) / 1000;
      root.style.transition = ''; root.style.opacity = '';
      root.classList.add('out');
      if (fast) root.classList.add('fast');
      setTimeout(finish, fast ? 380 : 720);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointermove', onMove, true);
      root.remove();
      onEnd?.();
    };
    // Intro: solo Esc/Invio/Spazio. Salvaschermo: qualsiasi tasto, tocco o movimento del mouse.
    const onKey = (e) => {
      if (ss || ['Escape', 'Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); close(true); }
    };
    let mossa0 = null;
    const onMove = (e) => {
      if (!ss || performance.now() - t0 < 600) return;
      if (!mossa0) { mossa0 = [e.clientX, e.clientY]; return; }
      if (Math.hypot(e.clientX - mossa0[0], e.clientY - mossa0[1]) > 12) close(true);
    };
    root.addEventListener('pointerdown', (e) => { e.preventDefault(); close(true); });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointermove', onMove, true);

    raf = requestAnimationFrame((n) => { t0 = last = n; frame(n); });
    return () => close(true);
  },
};

/* Salvaschermo dopo un tempo di inattività scelto nelle Impostazioni (per dispositivo).
   Si sblocca toccando lo schermo o un tasto: niente password. */
const Salvaschermo = {
  KEY: 'cs_salvaschermo_min',
  OPZIONI: [0, 1, 5, 10, 15, 30],   // minuti; 0 = mai
  DEFAULT: 5,
  _ultimo: Date.now(),
  _timer: 0,
  _attivo: false,

  minuti() {
    let v = null;
    try { v = localStorage.getItem(this.KEY); } catch {}
    const n = v === null ? this.DEFAULT : parseInt(v, 10);
    return this.OPZIONI.includes(n) ? n : this.DEFAULT;
  },
  set(min) {
    try { localStorage.setItem(this.KEY, String(min)); } catch {}
    this._ultimo = Date.now();
    if (typeof Nav !== 'undefined' && Nav.current === 'impostazioni') renderSettingsDialog();
  },

  _attivita: () => { Salvaschermo._ultimo = Date.now(); },
  start() {
    if (this._timer) return;
    this._ultimo = Date.now();
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, this._attivita, { capture: true, passive: true }));
    window.addEventListener('scroll', this._attivita, { capture: true, passive: true });
    this._timer = setInterval(() => this._controlla(), 5000);
  },
  stop() {
    clearInterval(this._timer); this._timer = 0;
    ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(ev =>
      window.removeEventListener(ev, this._attivita, { capture: true }));
    this._chiudi?.();
  },
  _controlla() {
    const min = this.minuti();
    if (!min || this._attivo || document.visibilityState !== 'visible') return;
    if (Date.now() - this._ultimo >= min * 60000) this.mostra();
  },
  mostra() {
    if (this._attivo) return;
    const chiudi = Intro.screensaver(() => { this._attivo = false; this._chiudi = null; this._ultimo = Date.now(); });
    if (chiudi) { this._attivo = true; this._chiudi = chiudi; }
  },
};
