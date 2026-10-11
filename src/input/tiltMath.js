/**
 * Direction par inclinaison (gyroscope) : mathématiques pures, sans DOM (testées dans
 * tests/tiltMath.test.js).
 *
 * Entrée : un événement `deviceorientation` (α, β, γ en degrés, convention W3C
 * R = Rz(α)·Rx(β)·Ry(γ), matrice appareil → Terre) et `screen.orientation.angle`
 * (0, 90, 180, 270 ; −90 sur iOS via window.orientation).
 *
 * Méthode (prototype vérifié, docs de recherche §3 « Gyroscope ») :
 * 1. « haut » (opposé de la gravité) dans le repère de l'appareil, troisième ligne de R :
 *    u = (−sin γ·cos β, sin β, cos γ·cos β). α (boussole) n'y entre pas. Ce vecteur est
 *    continu même là où les angles d'Euler sautent (β proche de ±90°, γ qui bascule de
 *    +90° à −90°) : insensible au blocage de cardan.
 * 2. projection dans le repère de l'écran (rotation de −angle autour de la normale,
 *    comme three.js) : à 90°, le haut de l'appareil est à gauche.
 * 3. téléphone tenu (pas à plat) : vraie rotation « volant » autour de la normale à l'écran,
 *    atan2(−sx, sy), indépendante du basculement vers l'arrière ; presque à plat : inclinaison
 *    latérale asin(−sx) (plateau à bille). Fondu continu entre les deux.
 *
 * Signe : pencher le GSM vers la droite (rotation horaire vue par le joueur, comme un volant)
 * donne un angle positif, donc steer > 0 = tourner à droite (docs/interfaces.md), dans les
 * deux paysages comme en portrait.
 */

const DEG = Math.PI / 180;

/** Zone morte autour du neutre (degrés). */
export const DEAD_ZONE_DEG = 3;
/** Inclinaison du plein braquage, depuis le neutre (degrés). */
export const SATURATION_DEG = 25;
/** Exposant de la courbe de réponse entre zone morte et saturation (précision au centre). */
export const RESPONSE_EXPONENT = 1.3;
/** Constante de temps du lissage du volant (s). */
export const SMOOTHING_TIME_S = 0.06;
/**
 * Fondu « à plat » → « tenu » selon la norme de la projection du haut dans le plan de
 * l'écran : 0 (écran horizontal) … 1 (écran vertical). En dessous de FLAT_FADE_START,
 * inclinaison latérale seule ; au-dessus de FLAT_FADE_END, rotation volant seule.
 */
export const FLAT_FADE_START = 0.2;
export const FLAT_FADE_END = 0.45;

/** Interpolation d'Hermite entre a et b (0 avant a, 1 après b). */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Angle d'écran ramené à 0, 90, 180 ou 270 (−90 → 270, valeur absente ou illisible → 0).
 * @param {number | null | undefined} angle `screen.orientation.angle` ou `window.orientation`
 * @returns {0 | 90 | 180 | 270}
 */
export function normalizeScreenAngle(angle) {
  const a = Number(angle);
  if (angle === null || angle === undefined || !Number.isFinite(a)) return 0;
  const quarter = ((Math.round(a / 90) % 4) + 4) % 4;
  return /** @type {0 | 90 | 180 | 270} */ (quarter * 90);
}

/**
 * Angle en degrés ramené dans ]−180, 180].
 * @param {number} deg
 */
export function wrapDegrees(deg) {
  let a = deg % 360;
  if (a <= -180) a += 360;
  else if (a > 180) a -= 360;
  return a;
}

/**
 * Vrai si l'événement porte de vraies valeurs (Chrome sur ordinateur envoie un événement
 * dont β et γ sont null).
 * @param {{beta?: number | null, gamma?: number | null} | null | undefined} event
 */
export function isValidOrientation(event) {
  return Boolean(event) && Number.isFinite(event.beta) && Number.isFinite(event.gamma);
}

/**
 * « Haut » (opposé de la gravité, unitaire) dans le repère de l'appareil.
 * @param {number} betaDeg
 * @param {number} gammaDeg
 * @returns {{x: number, y: number, z: number}}
 */
export function upVector(betaDeg, gammaDeg) {
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  return { x: -Math.sin(g) * Math.cos(b), y: Math.sin(b), z: Math.cos(g) * Math.cos(b) };
}

/**
 * Angle de volant détaillé (pour le panneau ?debug).
 * @param {{alpha?: number | null, beta: number, gamma: number}} orientation valeurs de
 *   l'événement deviceorientation (α ignoré : la boussole n'a pas d'effet sur le volant)
 * @param {number} screenAngle angle de l'écran (degrés, normalisé ici)
 * @returns {{angle: number, held: number, sx: number, sy: number}} angle en degrés
 *   (+ = penché vers la droite) ; held ∈ [0, 1] : 0 = à plat, 1 = tenu ; (sx, sy) : haut
 *   projeté dans le plan de l'écran (x vers la droite, y vers le haut de l'image)
 */
export function steeringAngleDetail({ beta, gamma }, screenAngle) {
  const u = upVector(beta, gamma);
  const o = normalizeScreenAngle(screenAngle) * DEG;
  const sx = u.x * Math.cos(o) - u.y * Math.sin(o);
  const sy = u.x * Math.sin(o) + u.y * Math.cos(o);
  const held = smoothstep(FLAT_FADE_START, FLAT_FADE_END, Math.hypot(sx, sy));
  const wheel = Math.atan2(-sx, sy);
  const tray = Math.asin(clamp(-sx, -1, 1));
  return { angle: (held * wheel + (1 - held) * tray) / DEG, held, sx, sy };
}

/**
 * Angle de volant (degrés, + = penché vers la droite).
 * @param {{alpha?: number | null, beta: number, gamma: number}} orientation
 * @param {number} screenAngle
 */
export function steeringAngle(orientation, screenAngle) {
  return steeringAngleDetail(orientation, screenAngle).angle;
}

/**
 * Commande de volant à partir de l'angle et du neutre calibré : zone morte, puis courbe
 * sign·t^RESPONSE_EXPONENT jusqu'à la saturation.
 * @param {number} angleDeg angle de volant (degrés)
 * @param {number} [neutralDeg] angle neutre (calibrage)
 * @param {{deadZone?: number, saturation?: number, exponent?: number}} [options]
 * @returns {number} steer ∈ [−1, 1] (0 si l'angle n'est pas un nombre)
 */
export function steerFromAngle(
  angleDeg,
  neutralDeg = 0,
  { deadZone = DEAD_ZONE_DEG, saturation = SATURATION_DEG, exponent = RESPONSE_EXPONENT } = {},
) {
  const d = wrapDegrees(angleDeg - neutralDeg);
  if (!Number.isFinite(d)) return 0;
  const m = Math.abs(d);
  if (m <= deadZone) return 0;
  const t = Math.min(1, (m - deadZone) / (saturation - deadZone));
  return Math.sign(d) * t ** exponent;
}

/**
 * Lissage du premier ordre, appliqué une fois par image : s += (cible − s)·(1 − e^(−dt/τ)).
 * @param {number} previous valeur lissée précédente
 * @param {number} target valeur visée
 * @param {number} dt durée depuis l'image précédente (s, ≥ 0)
 * @param {number} [tau] constante de temps (s)
 */
export function smoothToward(previous, target, dt, tau = SMOOTHING_TIME_S) {
  if (!(dt > 0)) return previous;
  if (!(tau > 0)) return target;
  return previous + (target - previous) * (1 - Math.exp(-dt / tau));
}

/**
 * Moyenne circulaire d'angles (degrés), pour le calibrage : correcte de part et d'autre
 * de ±180°.
 * @param {number[]} anglesDeg
 * @returns {number} moyenne dans ]−180, 180] ; NaN si la liste est vide
 */
export function meanAngle(anglesDeg) {
  let s = 0;
  let c = 0;
  let n = 0;
  for (const a of anglesDeg) {
    if (!Number.isFinite(a)) continue;
    s += Math.sin(a * DEG);
    c += Math.cos(a * DEG);
    n += 1;
  }
  if (n === 0) return NaN;
  return wrapDegrees(Math.atan2(s, c) / DEG);
}
