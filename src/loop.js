/**
 * Boucle d'images (requestAnimationFrame).
 *
 * À chaque image, `frame(dtReal, dt, now)` reçoit :
 * - dtReal : temps réel écoulé depuis l'image précédente (s), mesuré sur les horodatages
 *   de requestAnimationFrame (diagnostic, transitions d'interface) ;
 * - dt : clampFrameDt(dtReal), plafonné à MAX_FRAME_DT (temps propre à simuler : on ne
 *   simule pas un joueur absent) ;
 * - now : horodatage de l'image (ms).
 *
 * Onglet caché (visibilitychange) : la boucle s'arrête. À la reprise, l'horloge est
 * réinitialisée : la première image a dtReal = 0, sans « rattrapage » du temps passé
 * ailleurs.
 */
import { clampFrameDt } from './physics/player.js';

/**
 * @param {(dtReal: number, dt: number, now: number) => void} frame
 * @returns {{start(): void, stop(): void, readonly running: boolean, dispose(): void}}
 */
export function createLoop(frame) {
  let handle = 0;
  /** Horodatage de l'image précédente (ms) ; null : horloge à réinitialiser. */
  let last = null;
  /** start() demandé (et pas encore stop()) : la boucle reprend quand l'onglet revient. */
  let wanted = false;
  let running = false;

  function tick(now) {
    handle = requestAnimationFrame(tick);
    const dtReal = last === null ? 0 : Math.max(0, (now - last) / 1000);
    last = now;
    try {
      frame(dtReal, clampFrameDt(dtReal), now);
    } catch (error) {
      // Une erreur à chaque image inonderait la console : on arrête la boucle.
      wanted = false;
      halt();
      throw error;
    }
  }

  function run() {
    if (running) return;
    running = true;
    last = null;
    handle = requestAnimationFrame(tick);
  }

  function halt() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(handle);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') halt();
    else if (wanted) run();
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Démarre (ou reprend) la boucle ; sans effet tant que l'onglet est caché. */
    start() {
      wanted = true;
      if (document.visibilityState !== 'hidden') run();
    },

    /** Arrête la boucle (elle ne reprendra pas seule au retour de l'onglet). */
    stop() {
      wanted = false;
      halt();
    },

    get running() {
      return running;
    },

    dispose() {
      wanted = false;
      halt();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
