/**
 * Collisions du véhicule (jalon 3) : module pur (ni DOM, ni three).
 *
 * Le véhicule est un cercle de rayon PLAYER_RADIUS (0,6 m) dans le plan du jeu ; les obstacles
 * sont des rectangles alignés sur les axes (emprises des bâtiments, portes fermées, bords de
 * la carte) : `{x0, y0, x1, y1, kind?, id?}`.
 *
 * Test BALAYÉ : le segment parcouru pendant un morceau de pas est confronté à chaque
 * rectangle grossi du rayon (somme de Minkowski : rectangle aux coins arrondis), si bien
 * qu'aucune vitesse ne fait traverser un mur. `stepWithCollisions` découpe en plus le pas en
 * morceaux de ≤ SUBSTEP_MAX_DIST (1 m) parcourus, comme l'intégrateur, et teste chaque
 * morceau (la trajectoire courbe d'un virage reste ainsi collée à sa corde).
 *
 * Réponse INÉLASTIQUE (docs/conception.md §3) : au contact, la composante normale entrante de
 * la vitesse propre u est annulée, la composante tangentielle est conservée (on glisse le long
 * du mur) ; le reste du déplacement du morceau est projeté sur la tangente (jusqu'à
 * MAX_SLIDES contacts, pour les coins rentrants). Pénalité : un ÉTOURDISSEMENT À L'ARRÊT de
 * κ·(γ_avant − γ_après) secondes (κ = STUN_PER_GAMMA, borné à STUN_MAX), ajouté au temps
 * propre τ ET au temps de la ville t : immobile, Δt = Δτ, et la batterie reste égale à τ.
 * Exemples (pour tout c, β seul compte) : choc de face à β = 0,2 → 0,41 s ; β = 0,5 → 3,1 s ;
 * β = 0,76 → 10,9 s.
 *
 * `resolveMove` est la fonction pure qui renvoie les ajustements (position, vitesse propre,
 * dTau = dT = étourdissement) ; `stepWithCollisions` les applique à l'état du joueur (comme
 * `step`, elle modifie l'état).
 */
import {
  ACCEL_TIME,
  C,
  PHI_MAX_LIMIT,
  REST_EPSILON,
  SUBSTEP_MAX_DIST,
  SUBSTEP_MAX_DT,
} from './constants.js';
import { step } from './player.js';
import { gammaFromU, rapidityFromU } from './relativity.js';

/** Rayon du véhicule dans le plan (m). */
export const PLAYER_RADIUS = 0.6;
/** κ : secondes d'étourdissement par unité de γ perdue au choc. */
export const STUN_PER_GAMMA = 20;
/** Étourdissement maximal d'un choc (s). */
export const STUN_MAX = 30;
/** Après un contact, le centre est reculé de cette marge le long de la normale (m). */
export const CONTACT_SKIN = 1e-5;
/** Contacts successifs traités dans un même morceau (coins rentrants). */
export const MAX_SLIDES = 4;

/** Tolérance de pénétration (m) : en deçà, le cercle est considéré au contact, pas dedans. */
const PENETRATION_TOL = 1e-7;
/** Tolérance sur l'instant de contact (fraction du morceau). */
const TIME_TOL = 1e-6;

/**
 * @typedef {{x0: number, y0: number, x1: number, y1: number, kind?: string, id?: string}} Box
 * @typedef {{query(xmin: number, ymin: number, xmax: number, ymax: number): Box[]}} BoxSource
 * @typedef {Box[] | BoxSource} Obstacles
 */

/**
 * Rectangle centré (x, y), de largeur `width` le long de x et de profondeur `depth` le long de y.
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} depth
 * @param {{kind?: string, id?: string}} [extra]
 * @returns {Box}
 */
export function boxFromCenter(x, y, width, depth, extra = {}) {
  return { x0: x - width / 2, y0: y - depth / 2, x1: x + width / 2, y1: y + depth / 2, ...extra };
}

/**
 * Emprises des bâtiments développés (render/layout.js expandScene) → obstacles.
 * @param {{x: number, y: number, width: number, depth: number, blockId?: string}[]} buildings
 * @returns {Box[]}
 */
export function boxesFromBuildings(buildings) {
  return buildings.map((b) => boxFromCenter(b.x, b.y, b.width, b.depth, { kind: 'batiment', id: b.blockId }));
}

/**
 * Quatre murs épais juste à l'extérieur des limites de la carte.
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} bounds
 * @param {number} [thickness]
 * @returns {Box[]}
 */
export function boundaryBoxes(bounds, thickness = 50) {
  const { xmin, ymin, xmax, ymax } = bounds;
  const t = thickness;
  return [
    { x0: xmin - t, y0: ymin - t, x1: xmin, y1: ymax + t, kind: 'limite', id: 'ouest' },
    { x0: xmax, y0: ymin - t, x1: xmax + t, y1: ymax + t, kind: 'limite', id: 'est' },
    { x0: xmin, y0: ymin - t, x1: xmax, y1: ymin, kind: 'limite', id: 'sud' },
    { x0: xmin, y0: ymax, x1: xmax, y1: ymax + t, kind: 'limite', id: 'nord' },
  ];
}

/**
 * Distance d'un point à un rectangle (0 à l'intérieur).
 * @param {number} px
 * @param {number} py
 * @param {Box} box
 */
export function distanceToBox(px, py, box) {
  const dx = Math.max(box.x0 - px, 0, px - box.x1);
  const dy = Math.max(box.y0 - py, 0, py - box.y1);
  return Math.hypot(dx, dy);
}

/**
 * Index spatial (grille uniforme) des obstacles fixes, pour ne tester que les voisins.
 * @param {Box[]} boxes
 * @param {number} [cell] taille d'une case (m)
 * @returns {BoxSource & {boxes: Box[]}}
 */
export function createBoxIndex(boxes, cell = 32) {
  /** @type {Map<string, number[]>} */
  const grid = new Map();
  boxes.forEach((b, i) => {
    for (let gx = Math.floor(b.x0 / cell); gx <= Math.floor(b.x1 / cell); gx++) {
      for (let gy = Math.floor(b.y0 / cell); gy <= Math.floor(b.y1 / cell); gy++) {
        const key = `${gx},${gy}`;
        const list = grid.get(key);
        if (list) list.push(i);
        else grid.set(key, [i]);
      }
    }
  });
  const stamp = new Uint32Array(boxes.length);
  let generation = 0;
  return {
    boxes,
    query(xmin, ymin, xmax, ymax) {
      generation = (generation + 1) >>> 0 || 1;
      if (generation === 1) stamp.fill(0);
      const out = [];
      for (let gx = Math.floor(xmin / cell); gx <= Math.floor(xmax / cell); gx++) {
        for (let gy = Math.floor(ymin / cell); gy <= Math.floor(ymax / cell); gy++) {
          const list = grid.get(`${gx},${gy}`);
          if (!list) continue;
          for (const i of list) {
            if (stamp[i] === generation) continue;
            stamp[i] = generation;
            const b = boxes[i];
            if (b.x0 <= xmax && b.x1 >= xmin && b.y0 <= ymax && b.y1 >= ymin) out.push(b);
          }
        }
      }
      return out;
    },
  };
}

/**
 * Obstacles candidats dans un rectangle de recherche.
 * @param {Obstacles} obstacles
 * @returns {Box[]}
 */
function candidates(obstacles, xmin, ymin, xmax, ymax) {
  if (Array.isArray(obstacles)) {
    return obstacles.filter((b) => b.x0 <= xmax && b.x1 >= xmin && b.y0 <= ymax && b.y1 >= ymin);
  }
  return obstacles.query(xmin, ymin, xmax, ymax);
}

/**
 * Premier contact d'un cercle de rayon r qui va de (x0, y0) à (x0 + dx, y0 + dy) avec un
 * rectangle : intersection du segment et du rectangle grossi de r (côtés plats et coins
 * arrondis). Un cercle déjà en pénétration renvoie time = 0, la normale de sortie et la
 * profondeur `penetration` (> 0). Un cercle au contact qui s'éloigne ne touche pas.
 * @param {number} x0
 * @param {number} y0
 * @param {number} dx
 * @param {number} dy
 * @param {number} r
 * @param {Box} box
 * @returns {{time: number, nx: number, ny: number, penetration?: number} | null}
 *   time ∈ [0, 1] : fraction du segment ; (nx, ny) : normale sortante unitaire au contact
 */
export function sweepCircleBox(x0, y0, dx, dy, r, box) {
  // Pénétration au départ ?
  const cx = Math.min(Math.max(x0, box.x0), box.x1);
  const cy = Math.min(Math.max(y0, box.y0), box.y1);
  const ex = x0 - cx;
  const ey = y0 - cy;
  const d2 = ex * ex + ey * ey;
  if (d2 < (r - PENETRATION_TOL) ** 2) {
    if (d2 > 1e-18) {
      const d = Math.sqrt(d2);
      return { time: 0, nx: ex / d, ny: ey / d, penetration: r - d };
    }
    // Centre dans le rectangle : sortie par le côté le plus proche.
    const exits = [
      [x0 - box.x0, -1, 0],
      [box.x1 - x0, 1, 0],
      [y0 - box.y0, 0, -1],
      [box.y1 - y0, 0, 1],
    ];
    exits.sort((p, q) => p[0] - q[0]);
    const [depth, nx, ny] = exits[0];
    return { time: 0, nx, ny, penetration: depth + r };
  }

  /** @type {{time: number, nx: number, ny: number} | null} */
  let best = null;
  const consider = (t, nx, ny) => {
    if (t >= -TIME_TOL && t <= 1 && (best === null || t < best.time)) best = { time: Math.max(t, 0), nx, ny };
  };
  // Côtés plats du rectangle grossi.
  if (dx > 0) {
    const t = (box.x0 - r - x0) / dx;
    const y = y0 + dy * t;
    if (y >= box.y0 && y <= box.y1) consider(t, -1, 0);
  } else if (dx < 0) {
    const t = (box.x1 + r - x0) / dx;
    const y = y0 + dy * t;
    if (y >= box.y0 && y <= box.y1) consider(t, 1, 0);
  }
  if (dy > 0) {
    const t = (box.y0 - r - y0) / dy;
    const x = x0 + dx * t;
    if (x >= box.x0 && x <= box.x1) consider(t, 0, -1);
  } else if (dy < 0) {
    const t = (box.y1 + r - y0) / dy;
    const x = x0 + dx * t;
    if (x >= box.x0 && x <= box.x1) consider(t, 0, 1);
  }
  // Coins arrondis : cercle de rayon r centré sur chaque coin, dans son quadrant.
  const a = dx * dx + dy * dy;
  if (a > 0) {
    for (const [kx, ky, sx, sy] of [
      [box.x0, box.y0, -1, -1],
      [box.x1, box.y0, 1, -1],
      [box.x0, box.y1, -1, 1],
      [box.x1, box.y1, 1, 1],
    ]) {
      const fx = x0 - kx;
      const fy = y0 - ky;
      const b = fx * dx + fy * dy;
      if (b >= 0) continue; // on s'éloigne du coin
      const cc = fx * fx + fy * fy - r * r;
      const disc = b * b - a * cc;
      if (disc < 0) continue;
      const t = (-b - Math.sqrt(disc)) / a;
      const hx = fx + dx * t;
      const hy = fy + dy * t;
      if (hx * sx < -1e-12 || hy * sy < -1e-12) continue; // hors du quadrant : côté plat
      consider(t, hx / r, hy / r);
    }
  }
  return best;
}

/**
 * Premier contact parmi des obstacles (voir sweepCircleBox).
 * @param {number} x0
 * @param {number} y0
 * @param {number} dx
 * @param {number} dy
 * @param {number} r
 * @param {Box[]} boxes
 * @returns {{time: number, nx: number, ny: number, penetration?: number, box: Box} | null}
 */
export function sweepCircle(x0, y0, dx, dy, r, boxes) {
  let best = null;
  for (const box of boxes) {
    const hit = sweepCircleBox(x0, y0, dx, dy, r, box);
    if (!hit) continue;
    // À instant égal, la pénétration la plus profonde d'abord.
    if (best === null || hit.time < best.time || (hit.time === best.time && (hit.penetration ?? 0) > (best.penetration ?? 0))) {
      best = { ...hit, box };
    }
  }
  return best;
}

/**
 * Étourdissement d'un choc : κ·(γ_avant − γ_après), borné à [0 ; STUN_MAX].
 * @param {number} gammaBefore
 * @param {number} gammaAfter
 * @param {number} [kappa]
 */
export function stunFor(gammaBefore, gammaAfter, kappa = STUN_PER_GAMMA) {
  return Math.min(Math.max(kappa * (gammaBefore - gammaAfter), 0), STUN_MAX);
}

/**
 * @typedef {{box: Box, nx: number, ny: number, x: number, y: number}} Contact
 * @typedef {{x: number, y: number, ux: number, uy: number, hits: Contact[],
 *            gammaBefore: number, gammaAfter: number, stun: number, dTau: number, dT: number}} MoveResolution
 */

/**
 * Ajustements d'un déplacement rectiligne de `from` à `to` (vitesse propre u à l'arrivée) :
 * fonction PURE. Sans contact : la position `to` et u inchangés. Au contact : position de
 * contact (reculée de CONTACT_SKIN), composante normale entrante de u annulée, reste du
 * déplacement projeté sur la tangente (glissement), étourdissement dTau = dT = stun.
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {{ux: number, uy: number}} u vitesse propre (m/s)
 * @param {Obstacles} obstacles
 * @param {{radius?: number, c?: number, kappa?: number}} [options]
 * @returns {MoveResolution}
 */
export function resolveMove(from, to, u, obstacles, { radius = PLAYER_RADIUS, c = C, kappa = STUN_PER_GAMMA } = {}) {
  let x = from.x;
  let y = from.y;
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  let ux = u.ux;
  let uy = u.uy;
  const gammaBefore = gammaFromU(ux, uy, c);
  const reach = Math.hypot(dx, dy) + radius + 1;
  const boxes = candidates(obstacles, x - reach, y - reach, x + reach, y + reach);
  /** @type {Contact[]} */
  const hits = [];
  for (let i = 0; i <= MAX_SLIDES; i++) {
    const hit = i < MAX_SLIDES ? sweepCircle(x, y, dx, dy, radius, boxes) : null;
    if (!hit) {
      if (i < MAX_SLIDES) {
        x += dx;
        y += dy;
      }
      break;
    }
    const { time, nx, ny, box } = hit;
    if (hit.penetration !== undefined) {
      x += nx * (hit.penetration + CONTACT_SKIN);
      y += ny * (hit.penetration + CONTACT_SKIN);
    } else {
      x += dx * time + nx * CONTACT_SKIN;
      y += dy * time + ny * CONTACT_SKIN;
    }
    hits.push({ box, nx, ny, x, y });
    const un = ux * nx + uy * ny;
    if (un < 0) {
      ux -= un * nx;
      uy -= un * ny;
    }
    let rx = dx * (1 - time);
    let ry = dy * (1 - time);
    const rn = rx * nx + ry * ny;
    if (rn < 0) {
      rx -= rn * nx;
      ry -= rn * ny;
    }
    dx = rx;
    dy = ry;
    if (dx * dx + dy * dy < 1e-24) break;
  }
  const gammaAfter = gammaFromU(ux, uy, c);
  const stun = hits.length ? stunFor(gammaBefore, gammaAfter, kappa) : 0;
  return { x, y, ux, uy, hits, gammaBefore, gammaAfter, stun, dTau: stun, dT: stun };
}

/**
 * @typedef {{box: Box, kind: string | undefined, id: string | undefined, nx: number, ny: number,
 *            x: number, y: number, gammaBefore: number, gammaAfter: number, stun: number,
 *            tau: number, t: number}} CollisionHit
 *   tau, t : horloges du joueur au moment du choc (avant l'étourdissement)
 */

/**
 * Avance le joueur comme `step` (modifie et renvoie ses ajustements), en morceaux de
 * ≤ SUBSTEP_MAX_DT et ≤ SUBSTEP_MAX_DIST parcourus, chacun soumis à `resolveMove`. Après un
 * choc, le cap suit la nouvelle vitesse (glissement) ; arrêt net si elle s'annule.
 * @param {import('./player.js').PlayerState} state
 * @param {import('./player.js').DriveCommand} cmd
 * @param {number} dtau temps propre (s), ≥ 0
 * @param {Obstacles} obstacles
 * @param {{radius?: number, kappa?: number, applyStun?: boolean}} [options]
 *   applyStun (défaut vrai) : ajoute l'étourdissement à state.tau et state.t ; faux : le
 *   laisse à l'appelant (game/level.js, qui remplace le choc contre une porte par une reprise)
 * @returns {{hits: CollisionHit[], stun: number}}
 */
export function stepWithCollisions(state, cmd, dtau, obstacles, { radius = PLAYER_RADIUS, kappa = STUN_PER_GAMMA, applyStun = true } = {}) {
  if (!(dtau >= 0 && Number.isFinite(dtau))) {
    throw new RangeError(`stepWithCollisions : dtau doit être un nombre fini ≥ 0 (reçu : ${dtau})`);
  }
  const c = state.c ?? C;
  const a = state.a ?? c / ACCEL_TIME;
  const phiCap = Math.min(state.phiMax, PHI_MAX_LIMIT);
  /** @type {CollisionHit[]} */
  const hits = [];
  let stun = 0;
  let remaining = dtau;
  while (remaining > 0) {
    const phi = rapidityFromU(state.ux, state.uy, c);
    const phiBound = Math.min(phi + (a * SUBSTEP_MAX_DT) / c, Math.max(phi, phiCap));
    const speedBound = c * Math.sinh(phiBound);
    const h = Math.min(remaining, SUBSTEP_MAX_DT, speedBound > 0 ? SUBSTEP_MAX_DIST / speedBound : Infinity);
    const from = { x: state.x, y: state.y };
    step(state, cmd, h);
    const res = resolveMove(from, state, state, obstacles, { radius, c, kappa });
    if (res.hits.length) {
      state.x = res.x;
      state.y = res.y;
      const U = Math.hypot(res.ux, res.uy);
      if (U > REST_EPSILON) {
        const sign = res.ux * state.hx + res.uy * state.hy < 0 ? -1 : 1;
        state.ux = res.ux;
        state.uy = res.uy;
        state.hx = (sign * res.ux) / U;
        state.hy = (sign * res.uy) / U;
      } else {
        state.ux = 0;
        state.uy = 0;
      }
      const first = res.hits[0];
      hits.push({
        box: first.box,
        kind: first.box.kind,
        id: first.box.id,
        nx: first.nx,
        ny: first.ny,
        x: first.x,
        y: first.y,
        gammaBefore: res.gammaBefore,
        gammaAfter: res.gammaAfter,
        stun: res.stun,
        tau: state.tau,
        t: state.t,
      });
      stun += res.stun;
    }
    remaining -= h;
  }
  if (applyStun && stun > 0) {
    state.tau += stun;
    state.t += stun;
  }
  return { hits, stun };
}
