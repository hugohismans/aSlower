/**
 * Réglage « Direction : [Inclinaison] [Glisser] » (écran titre et menu pause, jalon 2).
 *
 * Deux boutons à bascule (aria-pressed), une aide courte, un message (repli de l'inclinaison)
 * et, après un repli, un bouton « Réessayer l'inclinaison ». Cibles tactiles ≥ 48 px (styles :
 * src/styles/base.css, .dir-setting). Le module ne touche pas au capteur (hud/ n'importe pas
 * input/) : main.js reçoit le choix par `onChange`, APPELÉ DE FAÇON SYNCHRONE dans le
 * gestionnaire `click` (geste utilisateur) : main.js peut y demander la permission du capteur
 * d'inclinaison en toute première ligne, comme l'exige iOS.
 *
 * Le message n'est pas une région live : main.js l'annonce par l'annonceur (hud/announcer.js),
 * pour ne pas le faire lire deux fois.
 */

/** Libellés des modes. */
const LABELS = Object.freeze({ tilt: 'Inclinaison', drag: 'Glisser' });

let instances = 0;

/**
 * @param {HTMLElement} container élément vide qui reçoit le réglage
 * @param {{value?: 'tilt' | 'drag', onChange?: (mode: 'tilt' | 'drag') => void,
 *          onRetry?: () => void}} [options]
 *   value : mode affiché comme choisi ; onChange : appelé à chaque toucher d'un mode (même déjà
 *   choisi : toucher « Inclinaison » après un repli la redemande) ; onRetry : « Réessayer
 *   l'inclinaison » (par défaut : onChange('tilt'))
 * @returns {{readonly value: 'tilt' | 'drag', setValue(mode: 'tilt' | 'drag'): void,
 *            setMessage(text: string): void, setRetry(visible: boolean): void, element: HTMLElement}}
 */
export function createDirectionControl(container, { value = 'drag', onChange = () => {}, onRetry } = {}) {
  const id = `dir-${++instances}`;
  const root = document.createElement('div');
  root.className = 'dir-setting';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-labelledby', `${id}-label`);
  root.innerHTML = `
    <div class="c-setting-row">
      <span class="c-setting-label" id="${id}-label">Direction</span>
      <div class="dir-setting-choices">
        ${Object.entries(LABELS)
          .map(
            ([mode, label]) =>
              `<button type="button" class="btn btn-preset" data-mode="${mode}" aria-pressed="false" aria-describedby="${id}-help">${label}</button>`,
          )
          .join('')}
      </div>
      <button type="button" class="btn btn-preset dir-setting-retry" data-retry hidden>Réessayer l'inclinaison</button>
    </div>
    <p class="c-setting-help" id="${id}-help">Inclinaison&nbsp;: penche ton GSM comme un volant · Glisser&nbsp;: pouce à gauche de l'écran</p>
    <p class="c-setting-message dir-setting-message"></p>
  `;
  container.replaceChildren(root);

  const buttons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-mode]')]);
  const retry = /** @type {HTMLButtonElement} */ (root.querySelector('[data-retry]'));
  const message = /** @type {HTMLElement} */ (root.querySelector('.dir-setting-message'));
  /** @type {'tilt' | 'drag'} */
  let current = value;

  function render() {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === current));
  }

  // Gestionnaire `click` (pas pointerdown : il n'active pas la page sur iOS) et appel synchrone.
  root.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target).closest('button');
    if (!target) return;
    if (target.dataset.mode) {
      onChange(/** @type {'tilt' | 'drag'} */ (target.dataset.mode));
    } else if (target.dataset.retry !== undefined) {
      if (onRetry) onRetry();
      else onChange('tilt');
    }
  });

  render();
  return {
    get value() {
      return current;
    },
    /** Mode affiché comme choisi (sans appeler onChange). */
    setValue(mode) {
      current = mode;
      render();
    },
    /** Message sous le réglage (vide : masqué). */
    setMessage(text) {
      if (message.textContent !== text) message.textContent = text;
    },
    /** Affiche ou masque « Réessayer l'inclinaison ». */
    setRetry(visible) {
      retry.hidden = !visible;
    },
    element: root,
  };
}
