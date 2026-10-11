/**
 * Commandes du joueur : fusionne le clavier et le tactile en une seule commande,
 * lue une fois par image par la boucle de jeu.
 *
 * Commande renvoyée par read() :
 * - thrust  ∈ [0, 1]  : accélérer (0 si le frein est enfoncé : frein prioritaire) ;
 * - brake   ∈ [0, 1]  : freiner ;
 * - steer   ∈ [−1, 1] : positif = à droite (sens horaire, le cap θ diminue) ;
 * - classic (booléen) : vision classique maintenue ;
 * - pause   (booléen) : vrai une seule fois par appui sur Échap ou P (le front est
 *   consommé par la lecture), y compris quand les commandes sont coupées, pour
 *   pouvoir reprendre au clavier.
 *
 * Perte du focus ou onglet caché : tout est relâché (aucune touche « collée »).
 *
 * Modes tactiles (docs/conception.md §5) ; le clavier marche dans tous les modes :
 * - 'drag' (glisser) : moitié gauche = volant à origine flottante, pédale de frein en bas à
 *   gauche de la moitié droite ;
 * - 'tilt' (inclinaison, jalon 2) : volant = inclinaison du GSM (tilt.js), frein = bouton en
 *   bas à gauche, accélérer = moitié droite ; la zone volant tactile est ignorée.
 * Le mode est reflété dans `rootElement.dataset.mode` ('drag' | 'tilt') : la feuille de style
 * place le frein et masque la zone volant selon le mode. Si le capteur passe à 'refuse' ou
 * 'indisponible' en mode inclinaison, repli automatique en 'drag' et appel de onFallback.
 */
import { createKeyboard } from './keyboard.js';
import { createTouch } from './touch.js';

/** Plafond de la durée entre deux lectures, pour la rampe du volant clavier (s). */
const MAX_READ_DT = 0.1;

/** Modes tactiles connus. */
export const CONTROL_MODES = Object.freeze(['drag', 'tilt']);

/** États du capteur d'inclinaison qui imposent le repli en mode glisser. */
const TILT_FAILED_STATES = new Set(['refuse', 'indisponible']);

/**
 * @param {HTMLElement} rootElement calque des commandes tactiles (#controls de index.html) ;
 *   il est masqué (attribut hidden) quand les commandes sont coupées
 * @param {{
 *   mode?: 'drag' | 'tilt',
 *   tilt?: {state: string, read(): number, subscribe(fn: (state: string) => void): () => void} | null,
 *   onFallback?: (reason: 'refuse' | 'indisponible') => void,
 * }} [options]
 *   mode : mode tactile demandé ; tilt : capteur d'inclinaison (createTilt de tilt.js), requis
 *   pour le mode 'tilt' ; onFallback : appelé quand le mode 'tilt' retombe en 'drag' (l'interface
 *   l'annonce), avec l'état du capteur ('indisponible' aussi si aucun capteur n'est fourni)
 * @returns {{
 *   read(): {thrust: number, brake: number, steer: number, classic: boolean, pause: boolean},
 *   setEnabled(on: boolean): void, setMode(mode: 'drag' | 'tilt'): 'drag' | 'tilt',
 *   getMode(): 'drag' | 'tilt', dispose(): void
 * }}
 */
export function createControls(rootElement, { mode = 'drag', tilt = null, onFallback } = {}) {
  const keyboard = createKeyboard(window);
  // touch.js ne connaît que le glisser : en mode inclinaison, on ignore simplement son volant
  // (zone masquée par la feuille de style) ; accélérateur, frein et vision classique servent tels quels.
  const touch = createTouch(rootElement, { mode: 'drag' });
  let enabled = true;
  let lastRead = 0;
  /** @type {'drag' | 'tilt'} */
  let currentMode = 'drag';

  /** Repli en glisser, annoncé une fois par passage du mode inclinaison au glisser. */
  function fallBack(reason) {
    applyMode('drag');
    if (onFallback) {
      try {
        onFallback(reason);
      } catch (error) {
        console.error(error);
      }
    }
  }

  function applyMode(next) {
    if (next !== currentMode) touch.releaseAll();
    currentMode = next;
    if (rootElement.dataset.mode !== next) rootElement.dataset.mode = next;
  }

  /**
   * Choisit le mode tactile. 'tilt' sans capteur, ou avec un capteur refusé ou indisponible,
   * retombe aussitôt en 'drag' (onFallback appelé).
   * @param {'drag' | 'tilt'} next
   * @returns {'drag' | 'tilt'} mode effectif
   */
  function setMode(next) {
    if (!CONTROL_MODES.includes(next)) throw new RangeError(`Mode de commandes inconnu : ${next}`);
    if (next === 'tilt') {
      if (!tilt) fallBack('indisponible');
      else if (TILT_FAILED_STATES.has(tilt.state)) fallBack(/** @type {any} */ (tilt.state));
      else applyMode('tilt');
    } else {
      applyMode('drag');
    }
    return currentMode;
  }

  // Le capteur échoue pendant qu'on est en mode inclinaison : repli automatique.
  const unsubscribeTilt = tilt
    ? tilt.subscribe((state) => {
        if (currentMode === 'tilt' && TILT_FAILED_STATES.has(state)) fallBack(state);
      })
    : null;

  function releaseAll() {
    keyboard.releaseAll();
    touch.releaseAll();
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') releaseAll();
  };
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onVisibility);

  function setEnabled(on) {
    enabled = Boolean(on);
    keyboard.setEnabled(enabled);
    touch.setEnabled(enabled);
    rootElement.hidden = !enabled;
    lastRead = 0;
  }
  setEnabled(true);
  applyMode('drag');
  setMode(mode);

  return {
    read() {
      const now = performance.now();
      const dt = lastRead ? Math.min((now - lastRead) / 1000, MAX_READ_DT) : 0;
      lastRead = now;
      const keys = keyboard.read(dt);
      if (!enabled) return { thrust: 0, brake: 0, steer: 0, classic: false, pause: keys.pause };
      const fingers = touch.read();
      const brake = Math.max(keys.brake, fingers.brake);
      // Le capteur est lu (et lissé) à chaque image, même quand le volant vient du clavier.
      const handSteer = currentMode === 'tilt' && tilt ? tilt.read() : fingers.steer;
      return {
        thrust: brake > 0 ? 0 : Math.max(keys.thrust, fingers.thrust),
        brake,
        steer: Math.max(-1, Math.min(1, keys.steer + handSteer)),
        classic: keys.classic || fingers.classic,
        pause: keys.pause,
      };
    },

    setEnabled,
    setMode,

    /** @returns {'drag' | 'tilt'} mode tactile effectif */
    getMode() {
      return currentMode;
    },

    /** Retire les écouteurs ; le capteur d'inclinaison (fourni par l'appelant) n'est pas arrêté. */
    dispose() {
      unsubscribeTilt?.();
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      keyboard.dispose();
      touch.dispose();
    },
  };
}
