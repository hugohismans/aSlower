/**
 * Panneau ?debug de l'inclinaison : de quoi vérifier les signes sur un vrai iPhone et un
 * vrai Android (docs/conception.md §5). Affiche α, β, γ bruts, l'angle de l'écran, l'angle
 * de volant (et la part « tenu » du fondu à plat), le neutre calibré, la cible, le volant
 * lissé et l'état du capteur.
 *
 * Le panneau ne lit pas le capteur lui-même (hud/ n'importe pas input/) : main.js lui passe
 * à chaque image `tilt.debugInfo()`. Texte réécrit à 12 Hz au plus, seulement s'il change ;
 * aucune lecture de mise en page. Styles en ligne : le panneau ne dépend d'aucune feuille.
 */

/** Période de rafraîchissement du texte (ms). */
const PAINT_PERIOD_MS = 1000 / 12;

/**
 * Vrai si l'URL demande le panneau (?debug).
 * @param {string} [search]
 */
export function tiltDebugFromUrl(search = globalThis.location ? globalThis.location.search : '') {
  return new URLSearchParams(search).has('debug');
}

/** Nombre → texte à largeur fixe (« +12.3 », « — » si inconnu). */
function fixed(x, digits = 1, width = 7) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'.padStart(width);
  const text = (x >= 0 ? '+' : '') + x.toFixed(digits);
  return text.padStart(width);
}

/**
 * Texte du panneau (fonction séparée pour les tests).
 * @param {{state?: string, alpha?: number | null, beta?: number | null, gamma?: number | null,
 *   screenAngle?: number, angle?: number, held?: number, neutral?: number, target?: number,
 *   steer?: number, mode?: string} | null | undefined} info
 */
export function formatTiltDebug(info) {
  const i = info ?? {};
  return [
    `inclinaison  ${i.state ?? '—'}${i.mode ? `  (mode ${i.mode})` : ''}`,
    `α ${fixed(i.alpha)}°  β ${fixed(i.beta)}°  γ ${fixed(i.gamma)}°`,
    `écran ${fixed(i.screenAngle, 0, 4)}°   tenu ${fixed(i.held, 2, 5)}`,
    `volant ${fixed(i.angle)}°  neutre ${fixed(i.neutral)}°`,
    `cible ${fixed(i.target, 2)}   steer ${fixed(i.steer, 2)}`,
  ].join('\n');
}

/**
 * @param {HTMLElement} container élément où ajouter le panneau (par exemple document.body)
 * @returns {{update(info: object, now?: number): void, show(): void, hide(): void,
 *   dispose(): void, element: HTMLElement}}
 */
export function createTiltDebug(container) {
  const doc = container.ownerDocument;
  const element = doc.createElement('pre');
  element.className = 'tilt-debug';
  element.setAttribute('aria-hidden', 'true');
  Object.assign(element.style, {
    position: 'fixed',
    left: 'max(24px, env(safe-area-inset-left))',
    bottom: '120px',
    zIndex: '40',
    margin: '0',
    padding: '6px 8px',
    font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#fff',
    background: 'rgb(0 0 0 / 0.7)',
    borderRadius: '6px',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  });
  element.hidden = true;
  container.appendChild(element);

  let lastPaint = -Infinity;
  let lastText = '';

  return {
    element,

    /**
     * @param {object} info `tilt.debugInfo()`, éventuellement avec `mode` (controls.getMode())
     * @param {number} [now] horloge en ms (défaut : performance.now)
     */
    update(info, now = globalThis.performance.now()) {
      if (element.hidden || now - lastPaint < PAINT_PERIOD_MS) return;
      lastPaint = now;
      const text = formatTiltDebug(info);
      if (text !== lastText) {
        lastText = text;
        element.textContent = text;
      }
    },

    show() {
      element.hidden = false;
    },

    hide() {
      element.hidden = true;
    },

    dispose() {
      element.remove();
    },
  };
}
