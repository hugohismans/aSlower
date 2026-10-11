/**
 * Affichage des bulles pédagogiques (le moteur, sans DOM, est src/game/bubbles.js ; main.js
 * fait le lien, car hud/ n'importe pas game/). Styles : src/hud/bubbles.css.
 *
 * - En haut, sous les horloges (juste après .hud-top dans le HUD), étroite et sur deux lignes
 *   au plus : le centre de la vue reste dégagé.
 * - Contraste fort (fond clair opaque, texte foncé, ≈ 18:1) : lisible au soleil.
 * - Un toucher (ou un clic) sur la bulle la ferme. Seule la bulle capte les touchers : le
 *   reste du HUD les laisse passer aux commandes, et le toucher qui ferme la bulle n'atteint
 *   pas le jeu (preventDefault + stopPropagation). Elle n'est pas focalisable : Espace (frein)
 *   ne peut pas la « cliquer ».
 * - Animation d'entrée et de sortie courte, supprimée avec prefers-reduced-motion.
 * - Le texte est annoncé par l'annonceur (région aria-live polie, débit limité) ; la bulle
 *   elle-même n'est pas une région live (pas de double lecture).
 */

/** Durée de l'animation de sortie (ms), à garder égale à la transition de bubbles.css. */
const EXIT_MS = 180;

/**
 * @param {HTMLElement} hudRoot conteneur du HUD (#hud), déjà rempli par createHud
 * @param {{onDismiss?: () => void, announcer?: {announce(text: string): void}}} [options]
 *   onDismiss : appelé au toucher (le plus souvent engine.dismiss) ;
 *   announcer : createAnnouncer (src/hud/announcer.js)
 * @returns {{show(bubble: {id: string, text: string, blocking?: boolean}): void, hide(): void,
 *            dispose(): void, element: HTMLElement}}
 */
export function createBubbleView(hudRoot, { onDismiss, announcer } = {}) {
  const element = document.createElement('div');
  element.className = 'bubble';
  element.hidden = true;
  element.dataset.state = 'out';

  const text = document.createElement('p');
  text.className = 'bubble-text';
  const close = document.createElement('span');
  close.className = 'bubble-close';
  close.setAttribute('aria-hidden', 'true');
  close.textContent = '✕';
  const hint = document.createElement('span');
  hint.className = 'bubble-hint';
  hint.textContent = 'Touche pour continuer';
  hint.hidden = true;
  element.append(text, close, hint);

  // Sous les horloges : après .hud-top s'il existe, sinon en fin de HUD.
  const top = hudRoot.querySelector('.hud-top');
  if (top) top.after(element);
  else hudRoot.appendChild(element);

  let exitTimer = 0;
  let enterFrame = 0;

  /** @param {PointerEvent} event */
  const onPointerDown = (event) => {
    // En sortie, la bulle ne capte plus rien (pointer-events: none dans bubbles.css).
    if (element.hidden || element.dataset.state === 'out') return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss?.();
  };
  element.addEventListener('pointerdown', onPointerDown);

  return {
    element,

    show(bubble) {
      clearTimeout(exitTimer);
      cancelAnimationFrame(enterFrame);
      text.textContent = bubble.text;
      element.dataset.id = bubble.id;
      element.classList.toggle('bubble-blocking', Boolean(bubble.blocking));
      hint.hidden = !bubble.blocking;
      element.hidden = false;
      element.dataset.state = 'enter';
      // Une image peinte dans l'état de départ (deux rAF, sans lecture de mise en page), puis
      // la transition vers « in ».
      enterFrame = requestAnimationFrame(() => {
        enterFrame = requestAnimationFrame(() => {
          element.dataset.state = 'in';
        });
      });
      announcer?.announce(bubble.text);
    },

    hide() {
      if (element.hidden) return;
      cancelAnimationFrame(enterFrame);
      element.dataset.state = 'out';
      clearTimeout(exitTimer);
      exitTimer = window.setTimeout(() => {
        element.hidden = true;
      }, EXIT_MS);
    },

    dispose() {
      clearTimeout(exitTimer);
      cancelAnimationFrame(enterFrame);
      element.removeEventListener('pointerdown', onPointerDown);
      element.remove();
    },
  };
}
