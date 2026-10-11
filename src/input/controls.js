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
 */
import { createKeyboard } from './keyboard.js';
import { createTouch } from './touch.js';

/** Plafond de la durée entre deux lectures, pour la rampe du volant clavier (s). */
const MAX_READ_DT = 0.1;

/**
 * @param {HTMLElement} rootElement calque des commandes tactiles (#controls de index.html) ;
 *   il est masqué (attribut hidden) quand les commandes sont coupées
 * @param {{mode?: 'drag'}} [options] mode tactile ; seul « drag » existe au jalon 1
 * @returns {{
 *   read(): {thrust: number, brake: number, steer: number, classic: boolean, pause: boolean},
 *   setEnabled(on: boolean): void, dispose(): void
 * }}
 */
export function createControls(rootElement, { mode = 'drag' } = {}) {
  const keyboard = createKeyboard(window);
  const touch = createTouch(rootElement, { mode });
  let enabled = true;
  let lastRead = 0;

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

  return {
    read() {
      const now = performance.now();
      const dt = lastRead ? Math.min((now - lastRead) / 1000, MAX_READ_DT) : 0;
      lastRead = now;
      const keys = keyboard.read(dt);
      if (!enabled) return { thrust: 0, brake: 0, steer: 0, classic: false, pause: keys.pause };
      const fingers = touch.read();
      const brake = Math.max(keys.brake, fingers.brake);
      return {
        thrust: brake > 0 ? 0 : Math.max(keys.thrust, fingers.thrust),
        brake,
        steer: Math.max(-1, Math.min(1, keys.steer + fingers.steer)),
        classic: keys.classic || fingers.classic,
        pause: keys.pause,
      };
    },

    setEnabled,

    dispose() {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      keyboard.dispose();
      touch.dispose();
    },
  };
}
