/**
 * Mise en forme du HUD et des écrans des niveaux (jalon 3). Module PUR (ni DOM, ni three) :
 * hud/ n'importe que physics/ ; main.js lui passe des objets simples tirés de l'état de
 * partie (game/level.js, game/rules.js, game/score.js).
 *
 * Typographie française du HUD (hud/format.js) : virgule décimale, espace fine insécable
 * avant les unités, valeurs tronquées.
 *
 * Indicateur du prochain arrêt, « sans tricher sur la relativité » : la flèche montre la
 * direction APPARENTE de l'arrêt (aberration de la lumière qui en vient, avec le β effectif
 * de la vision : k·β), c'est-à-dire là où le joueur voit la balise à l'écran, et non sa
 * direction « vraie » ; la distance est la distance dans la ville, maintenant (l'arrêt est
 * immobile : elle ne dépend d'aucune convention).
 */
import { EYE_HEIGHT } from '../physics/constants.js';
import { aberrate } from '../physics/relativity.js';
import { adaptationExposure, classifyHue, perceivedColor } from '../physics/spectrum.js';
import { formatClock, NNBSP } from './format.js';

const FLOOR_EPSILON = 1e-9;

/** Nombre → texte français à `decimals` décimales tronquées (« 12,5 »). */
export function frNumber(x, decimals = 0) {
  if (!Number.isFinite(x)) return '—';
  const p = 10 ** decimals;
  const v = Math.floor(Math.abs(x) * p + FLOOR_EPSILON) / p;
  return `${x < 0 && v > 0 ? '−' : ''}${v.toFixed(decimals).replace('.', ',')}`;
}

/**
 * Heure de la ville courte « m:ss » (secondes entières tronquées) : délais et « pas avant ».
 * @param {number} seconds
 */
export function formatClockShort(seconds) {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds + FLOOR_EPSILON) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Batterie restante (fraction de τmax, dans [0 ; 1]) : la batterie est le temps propre τ.
 * @param {number} tau
 * @param {number} tauMax
 */
export function batteryFraction(tau, tauMax) {
  if (!(tauMax > 0)) return 0;
  return Math.min(1, Math.max(0, (tauMax - tau) / tauMax));
}

/**
 * Niveau de la batterie pour la couleur de la jauge (le texte dit toujours la valeur) :
 * 'ok', 'bas' (< 25 %), 'critique' (< 10 %).
 * @param {number} fraction
 */
export function batteryLevel(fraction) {
  if (fraction < 0.1) return 'critique';
  if (fraction < 0.25) return 'bas';
  return 'ok';
}

/**
 * Secondes de batterie restantes : « 65 s » (tronqué ; « 0 s » à vide).
 * @param {number} tau
 * @param {number} tauMax
 */
export function formatBattery(tau, tauMax) {
  return `${frNumber(Math.max(0, tauMax - tau), 0)}${NNBSP}s`;
}

/**
 * Distance : « 8 m », « 126 m », « 1,2 km » (tronquée).
 * @param {number} m
 */
export function formatDistance(m) {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${frNumber(m, 0)}${NNBSP}m`;
  return `${frNumber(m / 1000, 1)}${NNBSP}km`;
}

/**
 * Étoiles : « ★★☆ ».
 * @param {number} n
 * @param {number} [max]
 */
export function formatStars(n, max = 3) {
  const k = Math.max(0, Math.min(max, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(max - k);
}

/**
 * Indicateur du prochain arrêt : direction APPARENTE (aberration avec le β effectif k·β) par
 * rapport au cap, et distance dans la ville.
 * @param {{x: number, y: number, vx: number, vy: number, hx: number, hy: number, c: number}} snap
 * @param {{x: number, y: number, rayon?: number}} stop
 * @param {{k?: number}} [options] k : vision (1 relativiste, 0 classique)
 * @returns {{distance: number, angle: number, worldAngle: number, inZone: boolean, behind: boolean}}
 *   angle : rad, 0 = droit devant, > 0 = à droite (sens horaire), dans ]−π ; π] ;
 *   worldAngle : la même chose sans aberration (pour comparaison et tests)
 */
export function stopIndicator(snap, stop, { k = 1 } = {}) {
  const dx = stop.x - snap.x;
  const dy = stop.y - snap.y;
  const distance = Math.hypot(dx, dy);
  const hx = snap.hx;
  const hy = snap.hy;
  const rel = (nx, ny) => -Math.atan2(hx * ny - hy * nx, hx * nx + hy * ny);
  if (!(distance > 0)) return { distance: 0, angle: 0, worldAngle: 0, inZone: true, behind: false };
  const n = { x: dx / distance, y: dy / distance, z: 0 };
  const kk = Math.min(Math.max(Number.isFinite(k) ? k : 1, 0), 1);
  const beta = { x: (kk * snap.vx) / snap.c, y: (kk * snap.vy) / snap.c, z: 0 };
  const apparent = Math.hypot(beta.x, beta.y) > 0 ? aberrate(beta, n) : n;
  const angle = rel(apparent.x, apparent.y);
  return {
    distance,
    angle,
    worldAngle: rel(n.x, n.y),
    inZone: distance <= (stop.rayon ?? 0),
    behind: Math.abs(angle) > Math.PI / 2,
  };
}

/**
 * Distance d'arrêt au frein plein, (c²/a)(γ − 1), sans annulation près de l'arrêt.
 * @param {{beta: number, gamma: number, c: number}} snap
 * @param {number} a accélération propre maximale (m/s²)
 */
export function brakingDistance(snap, a) {
  const gb = snap.gamma * snap.beta;
  return ((snap.c * snap.c) / a) * ((gb * gb) / (snap.gamma + 1));
}

/**
 * Ligne « quand » du prochain arrêt, en heure de la ville :
 * - client absent (t < pasAvant) : « absent jusqu'à 1:30 · encore 20 s » ;
 * - délai : « avant 0:45 · encore 12 s », puis « en retard (délai 0:45) » ;
 * - rien sinon.
 * @param {{kind: 'retrait' | 'livraison', pasAvant: number | null, delai: number | null}} stop
 * @param {number} t heure de la ville
 * @returns {{text: string, state: 'absent' | 'delai' | 'retard' | 'libre'}}
 */
export function stopTiming(stop, t) {
  const who = stop.kind === 'retrait' ? 'pas prêt' : 'absent';
  if (stop.pasAvant !== null && stop.pasAvant !== undefined && t < stop.pasAvant) {
    return { text: `${who} jusqu'à ${formatClockShort(stop.pasAvant)} · encore ${frNumber(stop.pasAvant - t, 0)}${NNBSP}s`, state: 'absent' };
  }
  if (stop.delai !== null && stop.delai !== undefined) {
    if (t <= stop.delai) return { text: `avant ${formatClockShort(stop.delai)} · encore ${frNumber(stop.delai - t, 0)}${NNBSP}s`, state: 'delai' };
    return { text: `en retard (délai ${formatClockShort(stop.delai)})`, state: 'retard' };
  }
  return { text: '', state: 'libre' };
}

/**
 * Batterie qu'auraient coûtée les mêmes kilomètres à vitesse constante β (ligne
 * contrefactuelle du bilan) : τ = d/(γβc). Ignore accélérations et arrêts (ordre de grandeur).
 * @param {number} distance m parcourus dans la ville
 * @param {number} c
 * @param {number} [beta]
 */
export function counterfactualBattery(distance, c, beta = 0.2) {
  if (!(distance > 0) || !(c > 0) || !(beta > 0 && beta < 1)) return 0;
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return distance / (gamma * beta * c);
}

/**
 * Teinte perçue d'une lampe vue de face, par la même chaîne que la règle des portes
 * (game/rules.perceivedLamp : D par la géométrie, projecteur, exposition d'adaptation, tone
 * mapping, classifyHue), pour un observateur qui roule droit vers elle à β.
 * @param {{kind: 'line' | 'blackbody', lambda?: number | null, T?: number | null,
 *          intensity?: number, z: number}} lamp
 * @param {number} beta
 * @param {number} distance distance horizontale à la lampe (m)
 */
export function headOnHue(lamp, beta, distance) {
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const dz = lamp.z - EYE_HEIGHT;
  const cos = distance / Math.hypot(distance, dz);
  const D = gamma * (1 + beta * cos);
  const source =
    lamp.kind === 'line'
      ? { kind: 'line', lambda: /** @type {number} */ (lamp.lambda), intensity: lamp.intensity ?? 1 }
      : { kind: 'blackbody', T: /** @type {number} */ (lamp.T), intensity: lamp.intensity ?? 1 };
  const exposure = adaptationExposure(Math.exp(Math.atanh(beta)));
  return classifyHue(perceivedColor(/** @type {any} */ (source), D, { exposure }));
}

/**
 * Fenêtre de vitesse (β) où la lampe paraît de la teinte voulue, vue de face à `distance` :
 * aide « zone verte » du compteur. Première plage continue trouvée en montant de 0 à 0,99.
 * @param {{kind: 'line' | 'blackbody', lambda?: number | null, T?: number | null,
 *          intensity?: number, z: number}} lamp
 * @param {string} hue teinte demandée
 * @param {{distance?: number, step?: number}} [options]
 * @returns {{min: number, max: number} | null}
 */
export function hueSpeedWindow(lamp, hue, { distance = 30, step = 0.0025 } = {}) {
  let min = null;
  let max = null;
  for (let beta = 0; beta < 0.99; beta += step) {
    const ok = headOnHue(lamp, beta, distance) === hue;
    if (ok && min === null) min = beta;
    if (ok) max = beta;
    if (!ok && min !== null) break;
  }
  return min === null || max === null ? null : { min, max };
}

/** Domaines de la lumière pour le spectromètre. */
function band(lambda) {
  if (lambda > 830) return 'infrarouge';
  if (lambda < 360) return 'ultraviolet';
  return '';
}

/**
 * Spectromètre (option, aussi pour les daltoniens) : teinte perçue de la lampe visée, en mots,
 * avec ✓ si c'est la teinte demandée, et la longueur d'onde vue (raie) ou la température vue
 * (corps noir, T·D).
 * @param {{hue: string, D: number, on: boolean, lambdaObs: number | null}} view perceivedLamp
 * @param {{kind: 'line' | 'blackbody', T?: number | null}} lamp
 * @param {string} wanted teinte demandée par la porte
 * @returns {{text: string, ok: boolean}}
 */
export function spectrometerReading(view, lamp, wanted) {
  const ok = view.hue === wanted;
  const mark = ok ? '✓' : '✗';
  if (!view.on) return { text: `éteinte ${mark}`, ok: false };
  if (lamp.kind === 'line' && view.lambdaObs !== null) {
    const where = band(view.lambdaObs);
    return { text: `${view.hue} ${mark} ${frNumber(view.lambdaObs, 0)}${NNBSP}nm${where ? ` (${where})` : ''}`, ok };
  }
  const T = (lamp.T ?? 0) * view.D;
  return { text: `${view.hue} ${mark} ${frNumber(T, 0)}${NNBSP}K`, ok };
}

/**
 * Indice à montrer après `echecs` échecs : le dernier dont apresEchecs ≤ echecs (ou null).
 * @param {{apresEchecs: number, texte: string, aide?: string}[] | undefined} indices
 * @param {number} echecs
 */
export function hintFor(indices, echecs) {
  let best = null;
  for (const h of indices ?? []) if (h.apresEchecs <= echecs) best = h;
  return best;
}

/**
 * Aides débloquées par les indices après `echecs` échecs (jamais de coût en étoiles).
 * @param {{apresEchecs: number, aide?: string}[] | undefined} indices
 * @param {number} echecs
 * @returns {Set<string>}
 */
export function activeAids(indices, echecs) {
  const out = new Set();
  for (const h of indices ?? []) if (h.aide && h.apresEchecs <= echecs) out.add(h.aide);
  return out;
}

/**
 * Lignes chiffrées du bilan (τ, t, écart, batterie restante, contrefactuel à 0,2 c).
 * @param {{tauFin: number, tFin: number, tauMax: number, distance: number, c: number}} r
 * @returns {{montre: string, ville: string, ecart: string, batterie: string, contrefactuel: string}}
 */
export function resultFigures({ tauFin, tFin, tauMax, distance, c }) {
  const slow = counterfactualBattery(distance, c, 0.2);
  const frac = batteryFraction(tauFin, tauMax);
  return {
    montre: `Ta montre : ${formatClock(tauFin)}`,
    ville: `Horloge de la ville : ${formatClock(tFin)}`,
    ecart: `Écart : +${frNumber(Math.max(0, tFin - tauFin), 1)}${NNBSP}s pour la ville`,
    batterie: `Batterie restante : ${frNumber(frac * 100, 0)}${NNBSP}% (${formatBattery(tauFin, tauMax)})`,
    contrefactuel:
      distance > 0
        ? `À 0,2${NNBSP}c (${frNumber(0.2 * c, 0)}${NNBSP}m/s), ces ${formatDistance(distance)} t'auraient coûté ≈ ${frNumber(slow, 0)}${NNBSP}s de batterie (toi : ${frNumber(tauFin, 0)}${NNBSP}s).`
        : '',
  };
}

/**
 * Lignes des trois étoiles du bilan, chiffres à l'appui (score de game/score.js).
 * @param {{reussite: boolean, econome: {ok: boolean, batterieRestante: number, seuil: number},
 *          ponctuel: {ok: boolean, tFin: number, seuil: number, retards: {client: string, t: number,
 *          delai: number}[]}}} score
 * @returns {{name: string, ok: boolean, detail: string}[]}
 */
export function starLines(score) {
  const e = score.econome;
  const p = score.ponctuel;
  let ponctuel;
  if (p.retards.length > 0) {
    const r = p.retards[0];
    ponctuel = `${r.client} livré à ${formatClockShort(r.t)}, délai ${formatClockShort(r.delai)} : en retard.`;
  } else if (p.ok) {
    ponctuel = `Fini à ${formatClockShort(p.tFin)} à l'horloge de la ville (objectif ≤ ${formatClockShort(p.seuil)}).`;
  } else {
    ponctuel = `Fini à ${formatClockShort(p.tFin)} à l'horloge de la ville : objectif ≤ ${formatClockShort(p.seuil)}.`;
  }
  return [
    { name: 'Livré', ok: score.reussite, detail: score.reussite ? 'Tous les colis sont arrivés.' : 'Livraison inachevée.' },
    {
      name: 'Économe',
      ok: e.ok,
      detail: `Batterie restante ${frNumber(e.batterieRestante * 100, 0)}${NNBSP}% (objectif ≥ ${frNumber(e.seuil * 100, 0)}${NNBSP}%).`,
    },
    { name: 'Ponctuel', ok: p.ok, detail: ponctuel },
  ];
}

/**
 * Raison d'un échec, en une phrase (score de game/score.js).
 * @param {{raison: string | null, econome: {tauFin: number}, ponctuel: {tFin: number}}} score
 */
export function failureText(score) {
  if (score.raison === 'batterie') {
    return `Batterie vide ! Ta montre a tourné ${frNumber(score.econome.tauFin, 0)}${NNBSP}s, l'horloge de la ville ${frNumber(score.ponctuel.tFin, 0)}${NNBSP}s.`;
  }
  return 'Livraison manquée.';
}
