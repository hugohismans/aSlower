/**
 * Mise en forme des valeurs du HUD (module pur : ni DOM, ni three).
 *
 * Typographie française : virgule décimale, espace fine insécable (U+202F) avant
 * les unités et le signe %. Les valeurs sont TRONQUÉES, jamais arrondies vers le
 * haut : une horloge n'affiche jamais « 0:60,0 » et la vitesse jamais c (« 30 m/s » à
 * c = 30 m/s). La vitesse de la lumière est celle de la partie (réglage du joueur) : les
 * fonctions de vitesse la reçoivent en paramètre (défaut : C_DEFAULT).
 */
import { C_DEFAULT, PHI_MAX_DEFAULT } from '../physics/constants.js';

/** Espace fine insécable (U+202F), entre un nombre et son unité. */
export const NNBSP = '\u202f';

/** Signe moins typographique (U+2212). */
const MINUS = '\u2212';

/**
 * Petite marge contre les erreurs de représentation binaire avant une troncature :
 * 5,9 × 10 vaut 59,000000000000007 mais 4,35 × 10 vaut 43,49999999999999.
 */
const FLOOR_EPSILON = 1e-9;

/** Nombre → texte avec une virgule décimale. */
function decimalComma(text) {
  return text.replace('.', ',');
}

/** Entier positif → texte groupé par milliers avec des espaces fines (« 1 234 »). */
function groupThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
}

/**
 * Horloge « m:ss,d » (minutes sans plafond, dixièmes tronqués).
 * Valeur négative ou invalide → « 0:00,0 ».
 * @param {number} seconds
 * @returns {string} par exemple « 1:05,3 »
 */
export function formatClock(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const tenths = Math.floor(s * 10 + FLOOR_EPSILON);
  const minutes = Math.floor(tenths / 600);
  const secs = Math.floor(tenths / 10) % 60;
  return `${minutes}:${String(secs).padStart(2, '0')},${tenths % 10}`;
}

/**
 * Écart entre les horloges (t − τ), toujours signé.
 * Dixièmes tronqués sous 100 s (« +8,3 s »), secondes entières au-delà (« +216 s »).
 * @param {number} seconds
 * @returns {string}
 */
export function formatGap(seconds) {
  const s = Number.isFinite(seconds) ? seconds : 0;
  // Un écart infime (−1e-12 après une soustraction) s'affiche « +0,0 s ».
  const sign = s <= -0.1 ? MINUS : '+';
  const a = Math.abs(s);
  if (a < 100) {
    const tenths = Math.floor(a * 10 + FLOOR_EPSILON);
    return `${sign}${Math.floor(tenths / 10)},${tenths % 10}${NNBSP}s`;
  }
  return `${sign}${groupThousands(Math.floor(a + FLOOR_EPSILON))}${NNBSP}s`;
}

/** 2,5 → « 2,5 » ; 3 → « 3 » (jamais « 3,0 »). */
function formatFactor(x) {
  return Number.isInteger(x) ? String(x) : decimalComma(String(x));
}

/**
 * Phrase γ en langage simple (formulation du cahier des charges) :
 * - γ < 1,01 : « Toi et la ville, même rythme » ;
 * - jusqu'à 1,5 : « La ville va 15 % plus vite que toi » (pourcentage entier) ;
 * - de 1,5 à 4,75 : « ×1,5 », « ×2 », « ×2,5 »… par pas de 0,5 ;
 * - au-delà : un entier (« ×10 »).
 *
 * Hystérésis : le libellé ne change que si γ s'écarte de plus de 0,6 pas de la
 * valeur affichée (pas du libellé courant : 0,01, 0,5 ou 1). La phrase ne clignote
 * donc pas quand γ oscille autour d'une frontière. Mais au-dessous de la frontière basse
 * de son régime, moins 0,6 pas du régime plus fin (1,495 − 0,006 pour « ×… », 4,75 − 0,3
 * pour les entiers), le libellé repasse au régime plus fin : en freinant, on ne garde
 * pas « ×1,5 » jusqu'à γ = 1,2. Comme le régime « × » ne commence qu'à 1,5, la phrase ne
 * dit jamais « ×1,0 ».
 *
 * Rappel physique : dt/dτ = γ compare ta montre aux horloges de la ville que tu
 * croises (référentiel de la ville).
 *
 * @returns {(gamma: number) => string}
 */
export function createGammaPhrase() {
  let center = NaN; // valeur de γ que le libellé courant représente
  let stepSize = 0; // pas du libellé courant
  let floor = -Infinity; // sous ce γ, on quitte le régime courant (hystérésis du pas plus fin)
  let text = '';
  return (gamma) => {
    const g = Number.isFinite(gamma) && gamma > 1 ? gamma : 1;
    if (text && g >= floor && Math.abs(g - center) <= 0.6 * stepSize) return text;
    if (g < 1.01) {
      center = 1;
      stepSize = 0.01;
      floor = -Infinity;
      text = 'Toi et la ville, même rythme';
    } else if (g < 1.495) {
      // 1 % à 49 % ; à partir de 1,495 on passe à « ×1,5 ».
      const percent = Math.round((g - 1) * 100);
      center = 1 + percent / 100;
      stepSize = 0.01;
      floor = -Infinity;
      text = `La ville va ${percent}${NNBSP}% plus vite que toi`;
    } else if (g < 4.75) {
      const x = Math.round(g * 2) / 2;
      center = x;
      stepSize = 0.5;
      floor = 1.495 - 0.6 * 0.01; // retour aux % dès γ < 1,489
      text = `La ville va ×${formatFactor(x)} plus vite que toi`;
    } else {
      const x = Math.round(g);
      center = x;
      stepSize = 1;
      floor = 4.75 - 0.6 * 0.5; // retour aux demi-pas dès γ < 4,45
      text = `La ville va ×${x} plus vite que toi`;
    }
    return text;
  };
}

/**
 * Nombre de décimales de la vitesse : on montre le premier chiffre de l'écart à c.
 * c − v = 6 m/s → 0 ; c − v = 0,49 m/s → 1 ; c − v = 0,05 m/s → 2…
 * L'asymptote se lit ainsi dans les chiffres (à c = 30 m/s : 28 → 29,3 → 29,8).
 * @param {number} speed
 * @param {number} c
 */
function speedDecimals(speed, c) {
  const gap = c - speed;
  if (!(gap > 0)) return Infinity; // v ≥ c : n'arrive pas, borné par l'appelant
  return Math.max(0, Math.ceil(-Math.log10(gap) - FLOOR_EPSILON));
}

/**
 * Vitesse affichée, tronquée : entière loin de c, des décimales s'ajoutent près de c.
 * Le nombre de décimales est plafonné par celui de la vitesse maximale
 * c·tanh(φ_max) : avec φ_max = 3, c·tanh 3 = 0,99505·c, soit « 29,8 m/s » à c = 30
 * (29,85 m/s), « 9,9 m/s » à c = 10 et « 99,5 m/s » à c = 100. Ne montre jamais c.
 * @param {number} speed m/s (≥ 0)
 * @param {number} [phiMax] plafond de rapidité du joueur
 * @param {number} [c] vitesse de la lumière de la partie (m/s)
 * @returns {string} par exemple « 22 m/s » ou « 29,8 m/s »
 */
export function formatSpeed(speed, phiMax = PHI_MAX_DEFAULT, c = C_DEFAULT) {
  const v = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const vMax = c * Math.tanh(Number.isFinite(phiMax) && phiMax > 0 ? phiMax : PHI_MAX_DEFAULT);
  const maxDecimals = Math.min(speedDecimals(vMax, c), 6);
  const decimals = Math.min(speedDecimals(v, c), maxDecimals);
  const p = 10 ** decimals;
  // Troncature, puis garde-fou : la valeur affichée reste strictement sous c.
  const units = Math.min(Math.floor(v * p + FLOOR_EPSILON), Math.ceil(c * p) - 1);
  return `${decimalComma((units / p).toFixed(decimals))}${NNBSP}m/s`;
}

/**
 * Position de l'aiguille de la jauge, linéaire en v : 0 à l'arrêt, 1 au mur (v = c).
 * À poussée constante l'aiguille ralentit en approchant du mur : c'est l'asymptote.
 * @param {number} speed m/s
 * @param {number} [c] vitesse de la lumière de la partie (m/s)
 * @returns {number} ∈ [0, 1]
 */
export function gaugeFraction(speed, c = C_DEFAULT) {
  if (!(speed > 0)) return 0;
  return Math.min(speed / c, 1);
}

/**
 * Libellé du réglage de c pour le HUD et #diag : « c = 30 m/s ».
 * @param {number} c
 * @returns {string}
 */
export function formatLightSpeed(c) {
  return `c${NNBSP}=${NNBSP}${Number.isFinite(c) ? Math.round(c) : '?'}${NNBSP}m/s`;
}

/**
 * Équivalent en km/h d'une vitesse en m/s, arrondi à l'unité : 30 m/s → « 108 km/h ».
 * @param {number} speed m/s
 * @returns {string}
 */
export function formatKmh(speed) {
  return `${groupThousands(Math.round(speed * 3.6))}${NNBSP}km/h`;
}

/**
 * État de la pastille d'écart, avec hystérésis :
 * - 'growing' (rouge, ▲) dès que γ > 1,02 : l'écart se creuse ;
 * - retour au gris seulement quand γ < 1,01 : 'steady' (écart figé) ou 'zero'
 *   (écart sous 0,05 s) ;
 * - entre 1,01 et 1,02, l'état précédent est conservé.
 * @param {string} previous état précédent ('' au départ)
 * @param {number} gamma
 * @param {number} gap écart t − τ (s)
 * @returns {'growing' | 'steady' | 'zero'}
 */
export function gapState(previous, gamma, gap) {
  if (gamma > 1.02) return 'growing';
  if (gamma >= 1.01 && previous === 'growing') return 'growing';
  return gap >= 0.05 ? 'steady' : 'zero';
}
