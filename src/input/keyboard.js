/**
 * Clavier (ordinateur, surtout pour le développement).
 *
 * On lit `event.code`, la position PHYSIQUE de la touche : ZQSD sur AZERTY (belge
 * ou français) et WASD sur QWERTY marchent sans réglage. C double Maj pour la
 * vision classique, car cinq appuis sur Maj ouvrent les Touches rémanentes de
 * Windows.
 */

/** Touche (event.code) → action. */
export const KEY_ACTIONS = Object.freeze({
  ArrowUp: 'thrust',
  KeyW: 'thrust',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Space: 'brake',
  ArrowDown: 'brake',
  KeyS: 'brake',
  KeyC: 'classic',
  ShiftLeft: 'classic',
  ShiftRight: 'classic',
  Escape: 'pause',
  KeyP: 'pause',
});

/** Durée de la rampe du volant clavier, de 0 à ±1 (s). */
export const STEER_RAMP_TIME = 0.15;

/** Vrai si l'événement vient d'un champ de saisie ou d'un dialogue ouvert. */
function isOutsideGame(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable], dialog[open]'));
}

/**
 * @param {Window | HTMLElement} [target] élément qui reçoit les événements clavier
 * @returns {{
 *   read(dt: number): {thrust: number, brake: number, steer: number, classic: boolean, pause: boolean},
 *   releaseAll(): void, setEnabled(on: boolean): void, dispose(): void
 * }}
 */
export function createKeyboard(target = window) {
  /** Touches de conduite enfoncées (event.code). */
  const down = new Set();
  /** Appuis sur pause depuis la dernière lecture (front montant). */
  let pausePresses = 0;
  /** Volant lissé par la rampe, ∈ [−1, 1]. */
  let steer = 0;
  let enabled = true;

  const isHeld = (action) => {
    for (const code of down) if (KEY_ACTIONS[code] === action) return true;
    return false;
  };

  function onKeyDown(event) {
    const action = KEY_ACTIONS[event.code];
    if (!action || event.ctrlKey || event.metaKey || event.altKey) return;
    if (isOutsideGame(event.target)) return; // Échap ferme le dialogue, Espace clique…
    if (action === 'pause') {
      // La pause reste lue quand les commandes sont coupées : on peut reprendre.
      if (!event.repeat) pausePresses += 1;
      if (enabled) event.preventDefault();
      return;
    }
    if (!enabled) return; // menus : Espace et flèches gardent leur rôle habituel
    event.preventDefault(); // sinon Espace « clique » le bouton qui a le focus
    down.add(event.code);
  }

  function onKeyUp(event) {
    // Toujours relâcher, même avec un modificateur enfoncé entre-temps.
    if (down.delete(event.code)) event.preventDefault();
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);

  return {
    /**
     * État du clavier pour cette image.
     * @param {number} dt durée écoulée depuis la lecture précédente (s), pour la rampe
     */
    read(dt) {
      const goal = (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
      // Changement de sens : on repart de 0 tout de suite, sans traverser lentement.
      if (goal !== 0 && steer * goal < 0) steer = 0;
      const maxDelta = Math.max(0, dt) / STEER_RAMP_TIME;
      steer += Math.max(-maxDelta, Math.min(maxDelta, goal - steer));
      const pause = pausePresses > 0;
      pausePresses = 0;
      return {
        thrust: isHeld('thrust') ? 1 : 0,
        brake: isHeld('brake') ? 1 : 0,
        steer,
        classic: isHeld('classic'),
        pause,
      };
    },

    /** Tout relâcher (perte du focus, onglet caché). Le volant revient à 0 d'un coup. */
    releaseAll() {
      down.clear();
      steer = 0;
    },

    /** Coupe ou rétablit la conduite au clavier ; un appui sur pause en attente est oublié. */
    setEnabled(on) {
      enabled = Boolean(on);
      down.clear();
      steer = 0;
      pausePresses = 0;
    },

    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      down.clear();
    },
  };
}
