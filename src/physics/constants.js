/**
 * Constantes partagées du jeu (module pur : ni three, ni DOM).
 *
 * Unités SI : mètres, secondes, m/s, m/s². Repère du plan de jeu : x vers l'est,
 * y vers le nord, z vers le haut. Le rendu Three.js utilise X = x, Y = z, Z = −y.
 */

/** Vitesse de la lumière dans la ville (m/s). */
export const C = 100;

/** Accélération propre maximale du moteur (m/s²). */
export const A = 10;

/** Unités naturelles : c²/a = 1 000 m et c/a = 10 s. */
export const LENGTH_UNIT = (C * C) / A;
export const TIME_UNIT = C / A;

/**
 * Plafond de rapidité φ (v = c·tanh φ, γ = cosh φ). Valeur par défaut et borne
 * absolue : la LUT Doppler couvre |log₂ D| ≤ 4,5, soit φ ≤ 3,1, et β passé au GPU
 * en float32 s'arrondit à 1 vers φ ≈ 9.
 */
export const PHI_MAX_DEFAULT = 3;
export const PHI_MAX_LIMIT = 3;

/** Plafond du temps propre simulé par image (s) : on ne simule pas un joueur absent. */
export const MAX_FRAME_DT = 0.1;

/** Sous-pas internes de l'intégrateur : au plus 1/60 s et au plus 1 m parcouru. */
export const SUBSTEP_MAX_DT = 1 / 60;
export const SUBSTEP_MAX_DIST = 1;

/**
 * Conduite « arcade » (choix de l'auteur) : la route fournit la force latérale,
 * hors du budget du moteur. Le virage fait tourner la vitesse propre u à |u|
 * constant, au taux dθ/dτ = −steer·TURN_RATE (rad par seconde de temps propre ; steer > 0 :
 * à droite, θ diminue). Rayon dans la ville, volant à fond : r = |u|/TURN_RATE
 * (117 m à 76 m/s, 206 m à 90 m/s).
 */
export const TURN_RATE = 1.0;
/** Taux de pivot à l'arrêt (rad/s), pour se réorienter sans avancer. */
export const PIVOT_RATE = 0.8;

/** Vitesse au-dessous de laquelle on considère le joueur à l'arrêt (m/s de vitesse propre). */
export const REST_EPSILON = 1e-9;

/** Hauteur de l'œil au-dessus de la chaussée (m). */
export const EYE_HEIGHT = 1.6;

/* ------------------------------------------------------------------------- */
/* Couleur et rendu relativiste (partagés par physics/spectrum.js et render/) */
/* ------------------------------------------------------------------------- */

/** Fenêtre d'intégration des fonctions colorimétriques (nm). */
export const WAVELENGTH_MIN = 360;
export const WAVELENGTH_MAX = 830;

/** Température du soleil qui éclaire la ville (K). */
export const SUN_TEMPERATURE = 5800;

/**
 * Effet projecteur : couleur × min(D^BEAM_EXPONENT, BEAM_MAX).
 * Avec la convention de M(D) (facteur D inclus), l'exposant 4 est physique.
 */
export const BEAM_EXPONENT = 4;
export const BEAM_MAX = 8;

/** Tone mapping qui préserve la teinte : identité jusqu'au genou, compression douce au-delà. */
export const TONEMAP_KNEE = 0.75;

/** LUT Doppler : taille impaire (D = 1 au centre d'un texel) et plage de log₂ D. */
export const LUT_SIZE = 257;
export const LUT_LOG2_RANGE = 4.5;

/**
 * Lignes de la LUT : 5 colonnes de M(D) (réflectances r, g, b, IR, UV), puis une
 * ligne par température de corps noir (lampadaires, ciel).
 */
export const LUT_ROWS = Object.freeze({ r: 0, g: 1, b: 2, ir: 3, uv: 4 });
export const BLACKBODY_TEMPERATURES = Object.freeze([2700, 6500]);
export const LUT_HEIGHT = 5 + BLACKBODY_TEMPERATURES.length;

/** Ligne de la LUT pour un corps noir de température T (doit figurer dans BLACKBODY_TEMPERATURES). */
export function blackbodyRow(T) {
  const i = BLACKBODY_TEMPERATURES.indexOf(T);
  if (i < 0) throw new Error(`Température de corps noir absente de la LUT : ${T} K`);
  return 5 + i;
}

/** Préfixe de toutes les clés de stockage (l'origine github.io est partagée avec le portfolio). */
export const STORAGE_PREFIX = 'aslower:v1:';
