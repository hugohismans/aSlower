/**
 * Page « Théorie » : choix du niveau (débutant, intermédiaire, expert).
 *
 * - Lien direct : #debutant, #intermediaire, #expert, ou l'ancre d'une partie d'un niveau
 *   (le niveau qui la contient est alors choisi).
 * - Sans ancre : dernier niveau choisi, mémorisé (clé « aslower:v1:theorie-niveau », via
 *   src/storage.js : try/catch et repli en mémoire), sinon débutant.
 * - Sans JavaScript, les trois niveaux s'affichent l'un après l'autre.
 */
import { local } from '../src/storage.js';

const STORAGE_KEY = 'theorie-niveau';
const LEVELS = ['debutant', 'intermediaire', 'expert'];

/** @type {Record<string, HTMLElement>} */
const sections = {};
for (const id of LEVELS) {
  const el = document.getElementById(id);
  if (el) sections[id] = el;
}
const tabs = /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll('[data-level-tab]')]);

/** Niveau qui contient l'élément d'identifiant `hash` (sans « # »), ou null. */
function levelOf(hash) {
  if (!hash) return null;
  if (LEVELS.includes(hash)) return hash;
  let target = null;
  try {
    target = document.getElementById(decodeURIComponent(hash));
  } catch {
    target = null;
  }
  const section = target?.closest('[data-level]');
  return section ? section.getAttribute('data-level') : null;
}

/**
 * Affiche un niveau.
 * @param {string} level
 * @param {{remember?: boolean}} [options]
 */
function show(level, { remember = true } = {}) {
  if (!LEVELS.includes(level)) level = LEVELS[0];
  for (const id of LEVELS) {
    if (sections[id]) sections[id].hidden = id !== level;
  }
  for (const tab of tabs) {
    const on = tab.dataset.levelTab === level;
    if (on) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  document.documentElement.dataset.niveau = level;
  if (remember) local.set(STORAGE_KEY, level);
}

/** Fait défiler jusqu'à l'ancre `hash` : début d'un niveau ou partie d'un niveau. */
function scrollToHash(hash, behavior = 'auto') {
  const target = document.getElementById(hash);
  target?.scrollIntoView({ block: 'start', behavior });
}

function fromHash({ scroll }) {
  const hash = location.hash.slice(1);
  const level = levelOf(hash);
  if (!level) return false;
  show(level);
  if (scroll) scrollToHash(hash);
  return true;
}

document.documentElement.classList.add('js');

// État initial : ancre, sinon niveau mémorisé, sinon débutant.
if (!fromHash({ scroll: false })) {
  const stored = local.get(STORAGE_KEY, null);
  show(typeof stored === 'string' && LEVELS.includes(stored) ? stored : LEVELS[0], { remember: false });
} else if (!LEVELS.includes(location.hash.slice(1))) {
  // Ancre d'une partie : la section vient d'être affichée, le navigateur n'a pas pu y aller.
  const go = () => scrollToHash(location.hash.slice(1), 'instant');
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

// Onglets : changer de niveau sans sauter au milieu de la page.
for (const tab of tabs) {
  tab.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const level = tab.dataset.levelTab ?? LEVELS[0];
    show(level);
    history.pushState(null, '', `#${level}`);
    scrollToHash(level);
  });
}

// Liens internes vers un autre niveau, retour arrière, ancre modifiée à la main.
window.addEventListener('hashchange', () => fromHash({ scroll: true }));
window.addEventListener('popstate', () => fromHash({ scroll: false }));
