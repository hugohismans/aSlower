/**
 * Constantes partagées du jeu (module pur : ni three, ni DOM).
 *
 * Unités SI : mètres, secondes, m/s, m/s². Repère du plan de jeu : x vers l'est,
 * y vers le nord, z vers le haut. Le rendu Three.js utilise X = x, Y = z, Z = −y.
 */

/**
 * Vitesse de la lumière : un RÉGLAGE DU JOUEUR (décision du 2026-10-11), entier de C_MIN à
 * C_MAX m/s, C_DEFAULT par défaut. Toute la partie lit ses constantes physiques dans
 * `physicsFor(c)`, qui garde les rapports au même c : même rythme et même ville, à l'échelle,
 * quel que soit c.
 * - Accélération propre du moteur : a = c/ACCEL_TIME (0,76·c en ACCEL_TIME s de temps propre).
 * - Unité de longueur des niveaux : L = c·LENGTH_TIME = 10·c mètres. C'était c²/a quand
 *   a valait c/10 (jalons 1 à 3) ; depuis l'accélération « franche » (a = c/5), L = 2·c²/a :
 *   la ville garde sa taille et l'on y va deux fois plus vite.
 */
export const C_DEFAULT = 30;
export const C_MIN = 10;
export const C_MAX = 100;

/** Temps c/a (s) : la poussée à fond donne la rapidité φ = τ/ACCEL_TIME. */
export const ACCEL_TIME = 5;

/** Temps de lumière de l'unité de longueur, L/c (s). */
export const LENGTH_TIME = 10;

/**
 * @typedef {{c: number, a: number, lengthUnit: number}} PhysicsConstants
 * c : vitesse de la lumière (m/s) ; a : accélération propre maximale du moteur (m/s²) ;
 * lengthUnit : L = c·LENGTH_TIME (m).
 */

/**
 * Constantes physiques d'une partie pour la vitesse de la lumière c.
 * @param {number} c entier de C_MIN à C_MAX (m/s)
 * @returns {Readonly<PhysicsConstants>} {c, a = c/ACCEL_TIME, lengthUnit = c·LENGTH_TIME}
 */
export function physicsFor(c) {
  if (!(Number.isInteger(c) && c >= C_MIN && c <= C_MAX)) {
    throw new RangeError(`Vitesse de la lumière : entier de ${C_MIN} à ${C_MAX} m/s attendu (reçu : ${c})`);
  }
  return Object.freeze({ c, a: c / ACCEL_TIME, lengthUnit: c * LENGTH_TIME });
}

/** Constantes physiques du réglage par défaut (c = 30 m/s, a = 6 m/s², L = 300 m). */
export const DEFAULT_PHYSICS = physicsFor(C_DEFAULT);

/**
 * Valeurs par défaut des fonctions physiques quand aucune constante n'est injectée
 * (= DEFAULT_PHYSICS). Le jeu, lui, passe toujours les constantes de la partie.
 */
export const C = DEFAULT_PHYSICS.c;
export const A = DEFAULT_PHYSICS.a;
export const LENGTH_UNIT = DEFAULT_PHYSICS.lengthUnit;

/**
 * Plafond de rapidité φ (v = c·tanh φ, γ = cosh φ). Valeur par défaut et borne
 * absolue : la LUT Doppler couvre |log₂ D| ≤ 4,5, soit φ ≤ 3,1, et β passé au GPU
 * en float32 s'arrondit à 1 vers φ ≈ 9.
 */
export const PHI_MAX_DEFAULT = 3;
export const PHI_MAX_LIMIT = 3;

/** Plafond du temps propre simulé par image (s) : on ne simule pas un joueur absent. */
export const MAX_FRAME_DT = 0.1;

/**
 * Sous-pas internes de l'intégrateur : au plus 1/60 s et au plus 1 m parcouru (à l'échelle
 * humaine, indépendant de c).
 */
export const SUBSTEP_MAX_DT = 1 / 60;
export const SUBSTEP_MAX_DIST = 1;

/**
 * Conduite « arcade » (choix de l'auteur) : la route fournit la force latérale,
 * hors du budget du moteur. Le virage fait tourner la vitesse propre u à |u|
 * constant, au taux dθ/dτ = −steer·TURN_RATE (rad par seconde de temps propre ; steer > 0 :
 * à droite, θ diminue). Rayon dans la ville, volant à fond : r = |u|/TURN_RATE = γv/TURN_RATE,
 * proportionnel à c à β donné : 0,117·L à β = 0,76 et 0,206·L à β = 0,9 (L = 10·c m), soit
 * 35 m et 62 m à c = 30 m/s, 117 m et 206 m à c = 100 m/s. Le taux, en rad par seconde,
 * ne dépend pas de c (les temps du jeu sont les mêmes pour tout c).
 */
export const TURN_RATE = 1.0;
/** Taux de pivot à l'arrêt (rad/s), pour se réorienter sans avancer. */
export const PIVOT_RATE = 0.8;

/**
 * Marche arrière lente (jalon 3, option `reverse` de createPlayer) : frein maintenu à l'arrêt
 * pendant REVERSE_DELAY s de temps propre, puis recul plafonné à REVERSE_MAX_BETA·c
 * (1,5 m/s à c = 30). Le délai laisse le temps de livrer (0,5 s sous 0,03·c) sans reculer.
 */
export const REVERSE_DELAY = 0.5;
export const REVERSE_MAX_BETA = 0.05;

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
 * BEAM_MAX = 8⁴ : D⁴ exact jusqu'à D = 8 (γ ≈ 4,1 de face), donc sur tous les niveaux prévus ;
 * la borne reste (cahier des charges) et garde les valeurs loin du maximum half float (65 504).
 * La luminosité d'ensemble est rendue par l'adaptation (spectrum.adaptationExposure).
 */
export const BEAM_EXPONENT = 4;
export const BEAM_MAX = 4096;

/**
 * Façade de référence de l'adaptation de l'œil (r, g, b, ir, uv) : gris moyen, ir et uv
 * moyens de la palette. L'exposition garde sa luminance de face égale à celle du repos.
 */
export const ADAPTATION_REFERENCE = Object.freeze([0.6, 0.6, 0.6, 0.3, 0.15]);

/**
 * Ciel dégagé à spectre continu : ρ(λ) ∝ (550/λ)⁴ + SKY_AEROSOL_FRACTION·(550/λ)^1,3, nul sous
 * 295 nm (ozone), de luminance SKY_CLEAR_LUMINANCE au repos.
 */
export const SKY_AEROSOL_FRACTION = 0.35;
export const SKY_CLEAR_LUMINANCE = 0.186;

/** Tone mapping qui préserve la teinte : identité jusqu'au genou, compression douce au-delà. */
export const TONEMAP_KNEE = 0.75;

/** LUT Doppler : taille impaire (D = 1 au centre d'un texel) et plage de log₂ D. */
export const LUT_SIZE = 257;
export const LUT_LOG2_RANGE = 4.5;

/**
 * Lignes de la LUT : 5 colonnes de M(D) (réflectances r, g, b, IR, UV), puis une
 * ligne par température de corps noir (lampadaires, ciel), puis le ciel dégagé.
 */
export const LUT_ROWS = Object.freeze({ r: 0, g: 1, b: 2, ir: 3, uv: 4 });
export const BLACKBODY_TEMPERATURES = Object.freeze([2700, 6500]);
export const SKY_CLEAR_ROW = 5 + BLACKBODY_TEMPERATURES.length;
export const LUT_HEIGHT = SKY_CLEAR_ROW + 1;

/** Ligne de la LUT pour un corps noir de température T (doit figurer dans BLACKBODY_TEMPERATURES). */
export function blackbodyRow(T) {
  const i = BLACKBODY_TEMPERATURES.indexOf(T);
  if (i < 0) throw new Error(`Température de corps noir absente de la LUT : ${T} K`);
  return 5 + i;
}

/** Préfixe de toutes les clés de stockage (l'origine github.io est partagée avec le portfolio). */
export const STORAGE_PREFIX = 'aslower:v1:';
