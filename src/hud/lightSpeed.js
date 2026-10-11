/**
 * Réglage « Vitesse de la lumière : [ n ] m/s » (écran titre et menu pause).
 *
 * Champ de saisie (texte à clavier numérique : la lecture, virgule comprise, est la nôtre et
 * ne dépend pas de la langue du navigateur) avec boutons − et +, préréglages, aide courte et équivalent en
 * km/h. Cibles tactiles ≥ 48 px (styles : src/styles/base.css, .c-setting). La lecture du
 * texte saisi (refus ou valeur ramenée dans la plage, avec message) est confiée à `parse`
 * (game/settings.js → parseLightSpeed, passé par main.js : hud/ n'importe pas game/).
 */
import { C_DEFAULT, C_MAX, C_MIN } from '../physics/constants.js';
import { formatKmh } from './format.js';

let instances = 0;

/**
 * @param {HTMLElement} container élément vide qui reçoit le réglage
 * @param {{value?: number, presets?: readonly number[],
 *          parse: (raw: unknown) => {c: number | null, message: string},
 *          onChange?: (c: number) => void}} options
 * @returns {{readonly value: number, setValue(c: number): void, setMessage(text: string): void,
 *            element: HTMLElement}}
 */
export function createLightSpeedControl(container, { value = C_DEFAULT, presets = [], parse, onChange = () => {} }) {
  const id = `c-input-${++instances}`;
  const root = document.createElement('div');
  root.className = 'c-setting';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Vitesse de la lumière');
  root.innerHTML = `
    <div class="c-setting-row">
      <label class="c-setting-label" for="${id}">Vitesse de la lumière</label>
      <div class="c-setting-stepper">
        <button type="button" class="btn btn-step" data-step="-1" aria-label="Diminuer c d'un m/s">−</button>
        <span class="c-setting-field">
          <input id="${id}" class="c-setting-input" type="text" inputmode="numeric" maxlength="5"
                 autocomplete="off" spellcheck="false" enterkeyhint="done"
                 aria-describedby="${id}-help" title="Entier de ${C_MIN} à ${C_MAX} m/s" />
          <span class="c-setting-unit">m/s</span>
        </span>
        <button type="button" class="btn btn-step" data-step="1" aria-label="Augmenter c d'un m/s">+</button>
      </div>
      <div class="c-setting-presets">
        ${presets.map((p) => `<button type="button" class="btn btn-preset" data-preset="${p}" aria-pressed="false">${p}</button>`).join('')}
      </div>
    </div>
    <p class="c-setting-help" id="${id}-help">Plus c est bas, plus les effets arrivent tôt · <span data-ref="kmh"></span></p>
    <p class="c-setting-message" role="status" aria-live="polite"></p>
  `;
  container.replaceChildren(root);

  const input = /** @type {HTMLInputElement} */ (root.querySelector('input'));
  const kmh = /** @type {HTMLElement} */ (root.querySelector('[data-ref="kmh"]'));
  const message = /** @type {HTMLElement} */ (root.querySelector('.c-setting-message'));
  const presetButtons = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('[data-preset]')]);
  let current = value;

  /** Affiche c (champ, km/h, préréglage actif) sans rien annoncer. */
  function render() {
    input.value = String(current);
    kmh.textContent = `c = ${current} m/s ≈ ${formatKmh(current)}`;
    for (const b of presetButtons) b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === current));
  }

  /** Applique une valeur proposée (texte ou nombre). */
  function propose(raw) {
    const { c, message: text } = parse(raw);
    message.textContent = text;
    message.dataset.kind = c === null ? 'refus' : text ? 'ajuste' : '';
    if (c !== null && c !== current) {
      current = c;
      onChange(c);
    }
    render(); // valeur refusée : le champ revient à la valeur courante
  }

  input.addEventListener('change', () => propose(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur(); // « change » suit
  });
  root.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target).closest('button');
    if (!target) return;
    if (target.dataset.step) propose(Math.min(C_MAX, Math.max(C_MIN, current + Number(target.dataset.step))));
    else if (target.dataset.preset) propose(Number(target.dataset.preset));
  });

  render();
  return {
    get value() {
      return current;
    },
    /** Fixe la valeur affichée (sans appeler onChange). */
    setValue(c) {
      current = c;
      message.textContent = '';
      render();
    },
    /** Message sous le réglage (ex. « ?c= ignoré »). */
    setMessage(text) {
      message.textContent = text;
    },
    element: root,
  };
}
