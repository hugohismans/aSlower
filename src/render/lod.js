/**
 * Choix du niveau de détail (LOD) d'un îlot (module pur : ni DOM, ni three).
 *
 * L'aberration courbe les arêtes droites ; entre deux sommets, le GPU trace une
 * corde. L'image d'un grand cercle de la sphère de vue a une courbure géodésique
 * ≤ γβ ; une arête de longueur apparente s vue à la distance apparente d s'écarte
 * donc de sa vraie courbe d'au plus ≈ γβ·(s/d)²/8 radian. Pour rester sous la
 * tolérance angulaire ε :
 *
 *   LOD k permis si s_k ≤ κ·d_min,   κ = min(0,2 ; √(8ε/(γβ)))
 *
 * (le plafond 0,2 couvre les basses vitesses, où la perspective seule limite déjà
 * la taille des triangles). d_min est la distance apparente du point le plus
 * proche de l'îlot : distance monde × facteur Doppler D (la taille apparente
 * d'un objet est multipliée par 1/D). On prend le D minimal sur le champ visible.
 *
 * Simplification du jalon 1 (permise par le plan) : sans connaître l'orientation de la
 * caméra, on borne D par son minimum sur toute la sphère, D_min = γ(1 − β) = e^(−φ).
 * C'est une borne basse : le LOD choisi est plus fin que nécessaire à grande
 * vitesse, jamais plus grossier. `apparentNearestDistance` accepte l'angle
 * apparent maximal du champ visible pour resserrer la borne (voir plus bas).
 *
 * Hystérésis : on affine dès que la règle l'exige (l'erreur ne dépasse jamais ε),
 * mais on ne passe à un LOD plus grossier que si la règle est tenue avec 10 % de
 * marge. Une distance qui oscille autour d'un seuil ne fait donc pas clignoter.
 */

/**
 * Tolérance angulaire ε par défaut : 2 px CSS en paysage, hFOV 90°, 915 px CSS de
 * large (au centre, 1 px = 2·tan 45°/915 rad), soit ≈ 4,4 mrad.
 */
export const LOD_EPSILON = 4 / 915;

/** Hystérésis relative pour passer à un LOD plus grossier. */
export const LOD_HYSTERESIS = 0.1;

/** Plafond de κ à basse vitesse. */
export const LOD_KAPPA_MAX = 0.2;

/**
 * Coefficient κ de la règle s_k ≤ κ·d_min.
 * @param {number} gamma facteur de Lorentz de l'observateur
 * @param {number} beta |v|/c de l'observateur
 * @param {number} [epsilon] tolérance angulaire (rad)
 */
export function lodKappa(gamma, beta, epsilon = LOD_EPSILON) {
  const gb = gamma * beta;
  if (!(gb > 0)) return LOD_KAPPA_MAX;
  return Math.min(LOD_KAPPA_MAX, Math.sqrt((8 * epsilon) / gb));
}

/**
 * Plus petit facteur Doppler D vu dans un cône apparent de demi-angle
 * `maxApparentAngle` autour de la vitesse : pour une direction apparente à
 * l'angle θ' de β, D = 1/(γ(1 − β cos θ')), qui décroît avec θ'.
 * Avec θ' = π (valeur par défaut), on obtient le minimum global γ(1 − β).
 * @param {number} gamma
 * @param {number} beta
 * @param {number} [maxApparentAngle] angle apparent maximal entre β̂ et le champ visible (rad)
 */
export function dopplerMin(gamma, beta, maxApparentAngle = Math.PI) {
  const theta = Math.min(Math.max(maxApparentAngle, 0), Math.PI);
  return 1 / (gamma * (1 - beta * Math.cos(theta)));
}

/**
 * Distance apparente minimale d'un îlot : distance monde du point le plus proche
 * (chunk.nearestDistance) × D minimal. Par défaut, borne basse globale
 * nearestDistance × γ(1 − β) ; si la caméra regarde dans l'axe de la vitesse
 * (conduite arcade), on peut passer l'angle du coin du champ (≈ 48° en paysage
 * 932 × 430, hFOV 90°), plus l'écart éventuel entre l'axe de la caméra et β̂.
 * Mesure (quartier de test, β = 0,917, visibilité 600 m) : ≈ 330 k triangles
 * visibles avec la borne globale, ≈ 85 k avec l'angle du coin du champ.
 * @param {number} nearestDistance distance monde (m)
 * @param {number} gamma
 * @param {number} beta
 * @param {number} [maxApparentAngle] voir `dopplerMin`
 */
export function apparentNearestDistance(nearestDistance, gamma, beta, maxApparentAngle = Math.PI) {
  return nearestDistance * dopplerMin(gamma, beta, maxApparentAngle);
}

/**
 * LOD le plus grossier permis par la règle, sans hystérésis (0 si aucun ne l'est).
 * @param {number} distance distance apparente (m)
 * @param {number} kappa
 * @param {number[]} lodSteps pas des LOD, croissants (LOD 0 = le plus fin)
 * @param {number} [margin] marge relative exigée (0 = règle stricte)
 */
function coarsestAllowed(distance, kappa, lodSteps, margin = 0) {
  for (let k = lodSteps.length - 1; k > 0; k--) {
    if (lodSteps[k] * (1 + margin) <= kappa * distance) return k;
  }
  return 0;
}

/**
 * Choisit le LOD d'un îlot.
 * @param {number | null | undefined} currentLod LOD actuel (null/undefined : pas encore choisi)
 * @param {number} nearestApparentDistance d_min (m), voir `apparentNearestDistance`
 * @param {number} gamma
 * @param {number} beta
 * @param {number[]} lodSteps pas des LOD (m), croissants, ex. [1,5 ; 5 ; 15]
 * @param {{epsilon?: number, hysteresis?: number}} [options]
 * @returns {number} indice du LOD (0 = le plus fin)
 */
export function chooseLod(
  currentLod,
  nearestApparentDistance,
  gamma,
  beta,
  lodSteps,
  { epsilon = LOD_EPSILON, hysteresis = LOD_HYSTERESIS } = {},
) {
  const kappa = lodKappa(gamma, beta, epsilon);
  const strict = coarsestAllowed(nearestApparentDistance, kappa, lodSteps);
  const known = Number.isInteger(currentLod) && currentLod >= 0 && currentLod < lodSteps.length;
  if (!known || strict <= currentLod) return strict; // premier choix, ou affinage immédiat
  // Passage à plus grossier : seulement avec la marge d'hystérésis, sinon on reste.
  return Math.max(currentLod, coarsestAllowed(nearestApparentDistance, kappa, lodSteps, hysteresis));
}
