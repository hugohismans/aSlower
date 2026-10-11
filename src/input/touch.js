/**
 * Commandes tactiles, mode « glisser » (seul mode tactile du jalon 1 ; repli du
 * mode inclinaison au jalon 2).
 *
 * Disposition (paysage) : éléments de `rootElement` repérés par `data-control` :
 * - `thrust`  : moitié droite, maintenir = accélérer ;
 * - `brake`   : pédale de 96×80 px en bas à gauche de la moitié droite (prioritaire) ;
 * - `steer`   : moitié gauche, volant à origine flottante (R = 56 px) ;
 * - `classic` : bouton de 60 px à mi-hauteur du bord gauche (vision classique,
 *               à maintenir), posé au-dessus de la zone volant donc exclu d'elle.
 * La pédale et le bouton sont des frères des zones (pas des enfants) : un appui
 * sur eux n'atteint pas la zone en dessous.
 *
 * Pointer Events avec capture : le doigt peut glisser hors de sa zone sans la
 * relâcher. Plusieurs doigts sont suivis séparément ; lâcher = 0.
 */

/** Rayon du volant glisser (px) : un déplacement de R donne un braquage complet. */
export const STEER_RADIUS = 56;

const HOLD_CONTROLS = ['thrust', 'brake', 'classic'];

/**
 * @param {HTMLElement} rootElement calque des commandes tactiles (#controls)
 * @param {{mode?: string}} [options]
 * @returns {{
 *   read(): {thrust: number, brake: number, steer: number, classic: boolean},
 *   releaseAll(): void, setEnabled(on: boolean): void, dispose(): void
 * }}
 */
export function createTouch(rootElement, { mode = 'drag' } = {}) {
  if (mode !== 'drag') {
    // Le mode inclinaison (gyroscope) arrive au jalon 2 ; d'ici là, glisser.
    console.warn(`Mode tactile « ${mode} » indisponible : mode glisser utilisé.`);
  }

  /** Éléments des commandes, cherchés une fois pour toutes. */
  const elements = new Map(
    [...HOLD_CONTROLS, 'steer'].map((name) => [
      name,
      /** @type {HTMLElement | null} */ (rootElement.querySelector(`[data-control="${name}"]`)),
    ]),
  );
  const knob = /** @type {HTMLElement | null} */ (rootElement.querySelector('[data-steer-knob]'));
  const knobDot = /** @type {HTMLElement | null} */ (knob ? knob.querySelector('[data-steer-dot]') : null);

  /** Doigts posés sur chaque zone « à maintenir » : nom → Set(pointerId). */
  const holds = new Map(HOLD_CONTROLS.map((name) => [name, new Set()]));
  /** Doigts posés sur le volant, dans l'ordre d'arrivée : pointerId → {x0, x, y0}. */
  const steerPointers = new Map();
  let enabled = true;
  /** Fonctions qui retirent les écouteurs posés. */
  const cleanups = [];

  function listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  /** Reflète l'état dans le DOM (data-active), seulement aux changements. */
  function setActive(el, active) {
    if (!el) return;
    const value = active ? 'true' : 'false';
    if (el.dataset.active !== value) el.dataset.active = value;
  }

  /** Doigt du volant qui commande : le dernier posé encore présent. */
  function currentSteerPointer() {
    let last = null;
    for (const p of steerPointers.values()) last = p;
    return last;
  }

  function steerValue() {
    const p = currentSteerPointer();
    if (!p) return 0;
    return Math.max(-1, Math.min(1, (p.x - p.x0) / STEER_RADIUS));
  }

  /** Place le repère visuel du volant (transform seulement, aucune lecture de mise en page). */
  function updateKnob() {
    if (!knob) return;
    const p = currentSteerPointer();
    setActive(knob, Boolean(p));
    if (!p) return;
    knob.style.transform = `translate3d(${p.x0.toFixed(1)}px, ${p.y0.toFixed(1)}px, 0)`;
    if (knobDot) knobDot.style.transform = `translate3d(${(steerValue() * STEER_RADIUS).toFixed(1)}px, 0, 0)`;
  }

  /** Accepte le doigt (ou le clic principal) et capture le pointeur. */
  function accept(event, el) {
    if (!enabled) return false;
    if (event.pointerType === 'mouse' && event.button !== 0) return false;
    event.preventDefault(); // pas de sélection, de loupe ni d'événements souris émulés
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      /* pointeur déjà relâché : sans conséquence */
    }
    return true;
  }

  /** Doigts de l'accélérateur glissés sur la pédale : ils freinent (capturés par l'accélérateur). */
  const slidOnBrake = new Set();
  /** Rectangle de la pédale, lu au pointerdown de l'accélérateur (jamais dans la boucle d'images). */
  let brakeRect = null;
  const brakeHeld = () => holds.get('brake').size > 0 || slidOnBrake.size > 0;

  // Zones « à maintenir » : accélérateur, frein, vision classique.
  for (const name of HOLD_CONTROLS) {
    const el = elements.get(name);
    const pointers = holds.get(name);
    listen(el, 'pointerdown', (event) => {
      if (!accept(event, el)) return;
      pointers.add(event.pointerId);
      if (name === 'thrust') brakeRect = elements.get('brake')?.getBoundingClientRect() ?? null;
      setActive(el, true);
    });
    const release = (event) => {
      if (name === 'thrust' && slidOnBrake.delete(event.pointerId)) setActive(elements.get('brake'), brakeHeld());
      if (pointers.delete(event.pointerId) && pointers.size === 0) setActive(el, name === 'brake' ? brakeHeld() : false);
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(el, type, release);
  }

  // Le pouce glisse de l'accélérateur sur la pédale : il freine ; s'il en ressort, il réaccélère.
  listen(elements.get('thrust'), 'pointermove', (event) => {
    if (!brakeRect || !holds.get('thrust').has(event.pointerId)) return;
    const r = brakeRect;
    const over = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (over === slidOnBrake.has(event.pointerId)) return;
    if (over) slidOnBrake.add(event.pointerId);
    else slidOnBrake.delete(event.pointerId);
    setActive(elements.get('brake'), brakeHeld());
    setActive(elements.get('thrust'), holds.get('thrust').size > slidOnBrake.size);
  });

  // Volant à origine flottante.
  const steerZone = elements.get('steer');
  listen(steerZone, 'pointerdown', (event) => {
    if (!accept(event, steerZone)) return;
    steerPointers.set(event.pointerId, { x0: event.clientX, x: event.clientX, y0: event.clientY });
    updateKnob();
  });
  listen(steerZone, 'pointermove', (event) => {
    const p = steerPointers.get(event.pointerId);
    if (!p) return;
    p.x = event.clientX;
    // Au-delà de R, l'origine suit le doigt : un changement de sens répond tout de suite.
    const dx = p.x - p.x0;
    if (Math.abs(dx) > STEER_RADIUS) p.x0 = p.x - Math.sign(dx) * STEER_RADIUS;
    updateKnob();
  });
  const releaseSteer = (event) => {
    if (steerPointers.delete(event.pointerId)) updateKnob();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(steerZone, type, releaseSteer);

  // Pas de menu contextuel (appui long Android) ni de zoom par pincement (iOS).
  listen(rootElement, 'contextmenu', (event) => event.preventDefault());
  listen(rootElement, 'gesturestart', (event) => event.preventDefault());

  function releaseAll() {
    slidOnBrake.clear();
    for (const [name, pointers] of holds) {
      pointers.clear();
      setActive(elements.get(name), false);
    }
    steerPointers.clear();
    updateKnob();
  }

  return {
    read() {
      return {
        thrust: holds.get('thrust').size > slidOnBrake.size ? 1 : 0,
        brake: brakeHeld() ? 1 : 0,
        steer: steerValue(),
        classic: holds.get('classic').size > 0,
      };
    },

    releaseAll,

    setEnabled(on) {
      enabled = Boolean(on);
      releaseAll();
    },

    dispose() {
      releaseAll();
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
