/**
 * Panneau de diagnostic #diag (affiché avec ?diag ou ?bench) : de quoi trouver
 * le poste dominant quand le jeu rame sur un GSM.
 *
 * Mesures : i/s, temps d'image p50/p95 sur une fenêtre glissante, temps CPU du
 * rendu p50/p95, appels de dessin, triangles, durée de la première image.
 * Informations fixes (setInfo) : GPU (gl.RENDERER), KHR_parallel_shader_compile,
 * DPR atteint, profil de qualité…
 *
 * Le panneau ne se redessine qu'à 4 Hz et seulement s'il est visible ; aucune
 * lecture de mise en page.
 */

/** Taille de la fenêtre glissante (images) : ≈ 5 s à 60 Hz. */
const WINDOW_SIZE = 300;

/** Période de rafraîchissement du texte (ms). */
const PAINT_PERIOD_MS = 250;

/** Libellés français des informations connues (les autres clés s'affichent telles quelles). */
const INFO_LABELS = {
  renderer: 'GPU',
  vendor: 'Fabricant',
  parallelShaderCompile: 'KHR_parallel_shader_compile',
  dpr: 'DPR',
  profile: 'Profil',
  scene: 'Scène',
};

/**
 * Mode de diagnostic demandé dans l'URL.
 * @param {string} [search] par exemple « ?scene=avenue-test&bench »
 * @returns {'bench' | 'diag' | null}
 */
export function diagModeFromUrl(search = globalThis.location ? globalThis.location.search : '') {
  const params = new URLSearchParams(search);
  if (params.has('bench')) return 'bench';
  if (params.has('diag')) return 'diag';
  return null;
}

/**
 * Informations fixes d'un contexte WebGL : GPU réel si WEBGL_debug_renderer_info
 * est disponible, sinon gl.RENDERER, et présence de KHR_parallel_shader_compile.
 * @param {WebGLRenderingContext | WebGL2RenderingContext} gl
 */
export function readGlInfo(gl) {
  let renderer = gl.getParameter(gl.RENDERER);
  let vendor = gl.getParameter(gl.VENDOR);
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  if (debug) {
    renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) || renderer;
    vendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) || vendor;
  }
  return { renderer, vendor, parallelShaderCompile: Boolean(gl.getExtension('KHR_parallel_shader_compile')) };
}

/** Quantile p ∈ [0, 1] des n premières valeurs d'un tableau (copie triée). */
function quantile(values, n, p) {
  if (n === 0) return NaN;
  const sorted = Array.from(values.subarray(0, n)).sort((a, b) => a - b);
  return sorted[Math.min(n - 1, Math.round(p * (n - 1)))];
}

/** Nombre → texte court (« 16.7 », « — » si inconnu). */
function num(x, digits = 1) {
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}

/**
 * @param {HTMLElement} rootElement conteneur #diag
 * @returns {{
 *   frame(sample: {dtMs: number, cpuMs?: number, calls?: number, triangles?: number}): void,
 *   setInfo(info: object): void, addToggle(label: string, checked: boolean,
 *   onChange: (checked: boolean) => void): void, show(): void, hide(): void,
 *   results(): object
 * }}
 */
export function createDiag(rootElement) {
  rootElement.classList.add('diag');
  rootElement.innerHTML = '<pre class="diag-text"></pre><div class="diag-toggles"></div>';
  const textEl = rootElement.querySelector('.diag-text');
  const togglesEl = rootElement.querySelector('.diag-toggles');

  // Fenêtres glissantes (anneaux) des temps d'image et des temps CPU.
  const frameTimes = new Float64Array(WINDOW_SIZE);
  const cpuTimes = new Float64Array(WINDOW_SIZE);
  let filled = 0;
  let cpuFilled = 0;
  let head = 0;
  let cpuHead = 0;
  let totalFrames = 0;
  let calls = NaN;
  let triangles = NaN;
  let firstFrameMs = NaN; // durée CPU de la première image (compilation comprise)
  let firstFrameAt = NaN; // instant de la première image depuis le chargement (ms)
  const info = {};
  let visible = !rootElement.hidden;
  let lastPaint = -Infinity;
  let lastText = '';

  function results() {
    let sum = 0;
    for (let i = 0; i < filled; i++) sum += frameTimes[i];
    return {
      frames: totalFrames,
      window: filled,
      fps: filled ? (1000 * filled) / sum : NaN,
      frameP50: quantile(frameTimes, filled, 0.5),
      frameP95: quantile(frameTimes, filled, 0.95),
      cpuP50: quantile(cpuTimes, cpuFilled, 0.5),
      cpuP95: quantile(cpuTimes, cpuFilled, 0.95),
      calls,
      triangles,
      firstFrameMs,
      firstFrameAt,
      ...info,
    };
  }

  function paint() {
    const r = results();
    const lines = [
      `i/s        ${num(r.fps)}`,
      `image      p50 ${num(r.frameP50)}  p95 ${num(r.frameP95)} ms`,
      `CPU rendu  p50 ${num(r.cpuP50, 2)}  p95 ${num(r.cpuP95, 2)} ms`,
      `appels     ${Number.isFinite(calls) ? calls : '—'}`,
      `triangles  ${Number.isFinite(triangles) ? (triangles / 1000).toFixed(1) + ' k' : '—'}`,
      `1re image  ${num(firstFrameMs, 0)} ms (à ${num(firstFrameAt / 1000, 2)} s)`,
    ];
    for (const [key, value] of Object.entries(info)) {
      const shown = typeof value === 'boolean' ? (value ? 'oui' : 'non') : String(value);
      lines.push(`${INFO_LABELS[key] ?? key} : ${shown}`);
    }
    const text = lines.join('\n');
    if (text !== lastText) {
      lastText = text;
      textEl.textContent = text;
    }
  }

  return {
    /** Une mesure par image : intervalle entre images, temps CPU du rendu, renderer.info. */
    frame({ dtMs, cpuMs, calls: drawCalls, triangles: tris }) {
      const now = performance.now();
      if (totalFrames === 0) {
        firstFrameAt = now;
        if (Number.isFinite(cpuMs)) firstFrameMs = cpuMs;
      } else if (Number.isFinite(dtMs) && dtMs > 0) {
        // La première image n'a pas d'intervalle significatif : on l'exclut.
        frameTimes[head] = dtMs;
        head = (head + 1) % WINDOW_SIZE;
        filled = Math.min(filled + 1, WINDOW_SIZE);
      }
      if (totalFrames > 0 && Number.isFinite(cpuMs)) {
        cpuTimes[cpuHead] = cpuMs;
        cpuHead = (cpuHead + 1) % WINDOW_SIZE;
        cpuFilled = Math.min(cpuFilled + 1, WINDOW_SIZE);
      }
      if (Number.isFinite(drawCalls)) calls = drawCalls;
      if (Number.isFinite(tris)) triangles = tris;
      totalFrames += 1;
      if (visible && now - lastPaint >= PAINT_PERIOD_MS) {
        lastPaint = now;
        paint();
      }
    },

    /** Ajoute ou remplace des informations fixes (GPU, DPR, profil…). */
    setInfo(obj) {
      Object.assign(info, obj);
      if (visible) paint();
    },

    /** Interrupteur de diagnostic (ex. couper la passe ciel/sol pour mesurer son coût). */
    addToggle(label, checked, onChange) {
      const wrapper = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(checked);
      input.addEventListener('change', () => onChange(input.checked));
      wrapper.append(input, ` ${label}`);
      togglesEl.append(wrapper);
    },

    show() {
      visible = true;
      rootElement.hidden = false;
      paint();
    },

    hide() {
      visible = false;
      rootElement.hidden = true;
    },

    /** Mesures courantes (pour ?bench : à afficher ou copier en fin de parcours). */
    results,
  };
}
