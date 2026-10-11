/**
 * Annonces accessibles : une région `aria-live="polite"` invisible, à débit limité.
 *
 * - Une annonce au plus toutes les `minIntervalMs` (3 s par défaut) : les suivantes attendent,
 *   et seule la plus récente est gardée (une annonce périmée ne sert à rien en jeu).
 * - Le même texte deux fois de suite est bien relu : la région est vidée, puis remplie au
 *   tour suivant.
 * - La région est placée hors du HUD (sinon elle se tairait quand le HUD est masqué) et ne
 *   capte aucun toucher. Styles : src/hud/bubbles.css (.sr-announcer).
 */

/** Débit par défaut : une annonce toutes les 3 s au plus. */
export const ANNOUNCE_MIN_INTERVAL_MS = 3000;

/** Délai entre le vidage et le remplissage de la région (relecture d'un même texte). */
const REFILL_DELAY_MS = 60;

/**
 * @param {HTMLElement} [parent] conteneur de la région (document.body par défaut)
 * @param {{minIntervalMs?: number, now?: () => number}} [options]
 * @returns {{announce(text: string): void, clear(): void, dispose(): void, element: HTMLElement}}
 */
export function createAnnouncer(parent = document.body, { minIntervalMs = ANNOUNCE_MIN_INTERVAL_MS, now = () => performance.now() } = {}) {
  const region = document.createElement('div');
  region.className = 'sr-announcer';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  parent.appendChild(region);

  let lastAt = -Infinity;
  /** @type {string | null} */
  let pending = null;
  let timer = 0;
  let refill = 0;

  function write(text) {
    lastAt = now();
    clearTimeout(refill);
    if (region.textContent === text) {
      region.textContent = '';
      refill = window.setTimeout(() => {
        region.textContent = text;
      }, REFILL_DELAY_MS);
    } else {
      region.textContent = text;
    }
  }

  function flush() {
    timer = 0;
    if (pending === null) return;
    const text = pending;
    pending = null;
    write(text);
  }

  return {
    element: region,

    /** Annonce un texte (poliment : après ce que lit le lecteur d'écran). */
    announce(text) {
      const value = String(text ?? '').trim();
      if (!value) return;
      const wait = lastAt + minIntervalMs - now();
      if (wait <= 0 && !timer) {
        write(value);
        return;
      }
      pending = value; // la plus récente remplace celle qui attendait
      if (!timer) timer = window.setTimeout(flush, Math.max(0, wait));
    },

    /** Oublie l'annonce en attente et vide la région. */
    clear() {
      pending = null;
      clearTimeout(timer);
      clearTimeout(refill);
      timer = 0;
      region.textContent = '';
    },

    dispose() {
      this.clear();
      region.remove();
    },
  };
}
