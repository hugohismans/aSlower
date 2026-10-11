/**
 * Ciel animé des menus (accueil, sélection des niveaux, briefing) : un canevas 2D plein écran
 * derrière les écrans, au-dessus de la vue 3D (qui n'est pas encore créée, ou qui garde la
 * dernière image d'une partie). Calculs : hud/skyMath.js (aberration, Doppler, corps noir).
 *
 * Léger : ≈ 400 disques par image, 30 images/s au plus, DPR plafonné à 2, rien tant que le ciel
 * est masqué ou l'onglet caché. La table des couleurs (calcul spectral) est faite après la
 * première image : les étoiles apparaissent un instant après le menu, sans le retarder.
 * Sous prefers-reduced-motion : une seule image, fixe (β = SKY.betaStill).
 *
 * La lecture « v = 0,62 c · γ = 1,27 » (élément `readout`, aria-hidden) suit β à 4 Hz.
 */
import { aberrateCos, dopplerCos, formatSkyReadout, makeStars, SKY, skyBeta, starColorTable, starLook, stereoRadius, tableIndex } from './skyMath.js';

/** Intervalle minimal entre deux images (ms) : ≈ 30 images/s. */
const FRAME_MS = 1000 / 30 - 2;
/** Intervalle de mise à jour de la lecture (ms). */
const READOUT_MS = 250;

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{readout?: HTMLElement | null, reducedMotion?: MediaQueryList}} [options]
 * @returns {{show(): void, hide(): void, readonly visible: boolean}}
 */
export function createSky(canvas, { readout = null, reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)') } = {}) {
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d', { alpha: false }));
  const stars = makeStars(SKY.stars);
  /** Table des couleurs (calculée après la première image). */
  let table = null;
  let visible = false;
  let raf = 0;
  let last = 0;
  let lastReadout = -Infinity;
  /** Temps du ciel (s) : n'avance que pendant l'affichage (reprise là où il s'était arrêté). */
  let skyTime = SKY.periodS * 0.32;
  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  /** Dessine le ciel pour β. */
  function draw(beta, roll) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = width * 0.5;
    const cy = height * 0.46;
    const scale = 0.62 * Math.hypot(width, height) * 0.5; // 90° apparent à 62 % de la demi-diagonale
    // Fond : nuit, avec la lueur bleutée du ciel droit devant (plus vive quand β monte).
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.75);
    bg.addColorStop(0, `rgb(${18 + 30 * beta} ${26 + 40 * beta} ${48 + 70 * beta})`);
    bg.addColorStop(0.45, '#0c1220');
    bg.addColorStop(1, '#07090f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    if (!table) return;
    const maxR = Math.hypot(width, height) * 0.5 + 4;
    for (const s of stars) {
      const cosA = aberrateCos(s.cos, beta);
      const r = stereoRadius(cosA) * scale;
      if (!(r < maxR)) continue;
      const D = dopplerCos(s.cos, beta);
      const i = tableIndex(D);
      const look = starLook(table.intensity[s.kind][i], s.mag);
      if (look.alpha < 0.03) continue;
      const a = s.phi + roll;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      ctx.fillStyle = table.rgb[s.kind][i];
      if (look.size > 2.3) {
        // Halo des étoiles les plus vives (devant, effet projecteur).
        ctx.globalAlpha = 0.12 * look.alpha;
        ctx.beginPath();
        ctx.arc(x, y, look.size * 2.2, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = look.alpha;
      ctx.beginPath();
      ctx.arc(x, y, look.size, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function still() {
    return reducedMotion.matches;
  }

  function render(beta) {
    resize();
    draw(beta, (2 * Math.PI * skyTime) / SKY.rollPeriodS);
  }

  function tick(now) {
    raf = 0;
    if (!visible) return;
    if (still()) {
      render(SKY.betaStill);
      if (readout) readout.textContent = formatSkyReadout(SKY.betaStill);
      return; // image fixe : plus d'animation
    }
    raf = requestAnimationFrame(tick);
    if (now - last < FRAME_MS) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    skyTime += dt;
    const beta = skyBeta(skyTime);
    render(beta);
    if (readout && now - lastReadout >= READOUT_MS) {
      lastReadout = now;
      readout.textContent = formatSkyReadout(beta);
    }
  }

  function start() {
    if (!visible || raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // Table des couleurs après la première image (calcul spectral, quelques dizaines de ms).
  requestAnimationFrame(() =>
    setTimeout(() => {
      table = starColorTable();
      if (visible) {
        stop();
        start();
      }
    }, 0),
  );

  window.addEventListener('resize', () => {
    if (visible && !raf) start();
  });
  reducedMotion.addEventListener?.('change', () => {
    if (visible) {
      stop();
      start();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop();
    else start();
  });

  return {
    show() {
      if (visible) return;
      visible = true;
      canvas.hidden = false;
      if (readout) readout.hidden = false;
      start();
    },
    hide() {
      visible = false;
      canvas.hidden = true;
      if (readout) readout.hidden = true;
      stop();
    },
    get visible() {
      return visible;
    },
  };
}
