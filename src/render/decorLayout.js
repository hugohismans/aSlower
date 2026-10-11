/**
 * Placement du décor statique (mobilier urbain et végétation) : module pur (ni DOM, ni three).
 *
 * Appelé par layout.expandScene, qui range le résultat dans `layout.decor` : une liste
 * d'objets {kind, x, y, cap, …, blockId, collision, extent, height, small}. Ambiance de ville
 * européenne : platanes d'alignement, bancs, colonnes Morris, kiosques à journaux, terrasses
 * de café (parasols ou stores bannes), jardinières fleuries, potelets, fontaines sur les places.
 * Le maillage est fait par render/decorMesher.js, les collisions par game/level.js.
 *
 * Règles de placement (déterministes : graine dérivée de celle de la scène par hashSeed, une
 * suite par rue, si bien que modifier une rue ne change pas le décor des autres) :
 * - uniquement sur les TROTTOIRS (bande de SIDEWALK_WIDTH = 3 m entre le bord de la chaussée
 *   et la façade, comme render/streetMap.js) qui bordent des bâtiments (une façade à moins de
 *   FRONTAGE_DISTANCE : pas de mobilier en rase campagne), et sur les PLACES (rue de chaussée
 *   ≥ PLACE_MIN_WIDTH : une fontaine au plus près du centre, loin des bâtiments et des rues) ;
 * - jamais sur une chaussée (celle de sa rue ni celle d'une rue qui croise ; chaussées
 *   prolongées d'une demi-largeur aux bouts, comme le dessin de streetMap.js), jamais dans un
 *   bâtiment ni hors des limites ;
 * - rien près d'un carrefour : à moins de CORNER_CLEARANCE_LOW (14 m) de la chaussée d'une
 *   autre rue qui croise (non parallèle) pour les objets bas (le pilote coupe les virages et
 *   sort large), à moins de CORNER_CLEARANCE_TALL (10 m) pour les arbres et les objets hauts ;
 *   une rue en double (même axe, même largeur, comprise dans une autre) n'a pas de trottoir
 *   propre ;
 * - pas sur les lampadaires : arbres à ≥ TREE_LAMP_CLEARANCE (3,5 m : la tête de la lampe, à
 *   6 m, reste hors du houppier), autres objets à ≥ 1 m ; les platanes sont en quinconce avec
 *   les lampadaires du même trottoir (à mi-distance de deux arbres) ;
 * - hors des EXCLUSIONS : disques {pos, rayon} ou couloirs {de, a, rayon} (scène :
 *   `decorExclusions`, voir game/level.sceneOfLevel), et à ≥ START_CLEARANCE du départ ;
 * - deux objets ne se chevauchent pas (emprises au sol en disques).
 *
 * Densité : la clé `decor: {actif?: true, densite?: 1}` de la scène règle les probabilités de
 * placement. Le réglage d'exécution (`options.decor` : `{enabled, density, small}`, par
 * exemple le profil « lite » ou `?decor=0`) n'est qu'un FILTRE appliqué après coup : le décor
 * allégé est un sous-ensemble exact du décor complet (les obstacles du jeu restent ceux qui
 * sont dessinés, et le pilote de référence, qui roule avec le décor complet, couvre tous les
 * profils).
 *
 * Chaque objet est rattaché à l'îlot (blockId) du bâtiment le plus proche (à moins de
 * ATTACH_RADIUS) ; sinon à une case de DECOR_CELL m (`decor:i,j`), qui devient un chunk de
 * décor seul (render/cityMesher.js).
 */
import { createRandom, hashSeed } from './layout.js';

/** Largeur du trottoir de chaque côté de la chaussée (m), comme render/streetMap.js. */
export const SIDEWALK_WIDTH = 3;
/** Chaussée à partir de laquelle une « rue » est une place (m). */
export const PLACE_MIN_WIDTH = 40;
/** Distance minimale à la chaussée d'une autre rue (m) : objets bas, arbres et objets hauts. */
export const CORNER_CLEARANCE_LOW = 14;
export const CORNER_CLEARANCE_TALL = 10;
/** Distance minimale d'un arbre à un lampadaire, et des autres objets (m). */
export const TREE_LAMP_CLEARANCE = 3.5;
export const LAMP_CLEARANCE = 1;
/** Distance minimale au départ (m). */
export const START_CLEARANCE = 6;
/** Pas des platanes d'alignement (m) : ≈ 10,5 m, tiré dans [10 ; 11] par rue. */
export const TREE_SPACING = 10.5;
/** Distance du bord de chaussée à l'axe des arbres et du mobilier (m). */
export const FURNITURE_SETBACK = 1.3;
/** Probabilité qu'une rue soit plantée (la rue du départ l'est toujours). */
export const TREE_STREET_PROBABILITY = 0.45;
/** Distance maximale d'un objet de trottoir à la façade la plus proche (m). */
export const FRONTAGE_DISTANCE = 6;
/** Rayon de la fontaine (m) et dégagement exigé autour (bâtiments, rues, exclusions). */
export const FOUNTAIN_RADIUS = 3.2;
export const FOUNTAIN_CLEARANCE = 10;
/** Rayon de rattachement à un îlot (m) et case des chunks de décor seul. */
export const ATTACH_RADIUS = 60;
export const DECOR_CELL = 80;

/** Marge entre un objet et une chaussée, un bâtiment (m). */
const CURB_MARGIN = 0.3;
const WALL_MARGIN = 0.1;
const TOL = 1e-6;
/** Nombre d'or : suite à faible discrépance pour éclaircir les alignements (sous-ensembles). */
const GOLDEN = 0.6180339887498949;

/**
 * Description des sortes d'objets : `foot` rayon au sol (disque d'occupation entre objets du
 * décor, m) ; `across` demi-profondeur en travers de la rue (distance gardée au bord de la
 * chaussée et aux façades, m) ; hauteur (m) ; objet bas (règle des carrefours) ; petit objet
 * (absent du profil « lite ») ; boîte de collision indulgente (demi-tailles le long de l'axe
 * local a = cap et en travers b) ou null.
 */
export const DECOR_KINDS = Object.freeze({
  platane: { foot: 0.4, across: 0.4, height: 10, low: false, small: false, box: [0.25, 0.25] },
  banc: { foot: 1.0, across: 0.3, height: 0.9, low: true, small: false, box: [0.8, 0.2] },
  colonne: { foot: 0.8, across: 0.7, height: 3.7, low: false, small: false, box: [0.5, 0.5] },
  kiosque: { foot: 1.6, across: 0.85, height: 3, low: false, small: false, box: [1.1, 0.7] },
  parasol: { foot: 1.15, across: 1.15, height: 2.6, low: true, small: true, box: [0.35, 0.35] },
  store: { foot: 0, across: 0, height: 3.2, low: false, small: false, box: null },
  jardiniere: { foot: 0.8, across: 0.3, height: 0.9, low: true, small: true, box: [0.65, 0.22] },
  potelet: { foot: 0.25, across: 0.1, height: 0.9, low: true, small: true, box: [0.1, 0.1] },
  fontaine: { foot: FOUNTAIN_RADIUS + 0.3, across: FOUNTAIN_RADIUS, height: 3, low: false, small: false, box: [FOUNTAIN_RADIUS * 0.85, FOUNTAIN_RADIUS * 0.85] },
});

/**
 * Réglages du décor : clé `decor` de la scène, puis réglage d'exécution.
 * @param {any} sceneDecor `decor` de la scène : {actif?: boolean, densite?: number}
 * @param {{enabled?: boolean, density?: number, small?: boolean} | boolean | undefined} override
 *   réglage d'exécution (false : pas de décor) ; density ∈ [0, 1] : fraction gardée
 * @returns {{enabled: boolean, density: number, keep: number, small: boolean}}
 *   density : densité de placement (scène) ; keep : fraction gardée après coup (exécution)
 */
export function decorSettings(sceneDecor, override) {
  const scene = sceneDecor && typeof sceneDecor === 'object' ? sceneDecor : {};
  if (scene.actif !== undefined && typeof scene.actif !== 'boolean') throw new Error('decor.actif : booléen attendu');
  if (scene.densite !== undefined && !(typeof scene.densite === 'number' && scene.densite >= 0 && scene.densite <= 3)) {
    throw new Error('decor.densite : nombre de 0 à 3 attendu');
  }
  const run = override === false ? { enabled: false } : override && typeof override === 'object' ? override : {};
  const keep = run.density === undefined ? 1 : Math.min(Math.max(Number(run.density) || 0, 0), 1);
  return {
    enabled: (scene.actif ?? true) && run.enabled !== false && keep > 0,
    density: scene.densite ?? 1,
    keep,
    small: run.small !== false,
  };
}

/* ------------------------------------------------------------------------- */
/* Géométrie plane                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Chaussée d'une rue : rectangle orienté, prolongé d'une demi-largeur à chaque bout (bouts
 * carrés du dessin de streetMap.js).
 * @param {{from: {x: number, y: number}, to: {x: number, y: number}, width: number}} s
 */
function carriageway(s, index) {
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len = Math.hypot(dx, dy);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  const hw = s.width / 2;
  const reach = len + hw;
  // Boîte englobante (index spatial).
  const ex = Math.abs(ux) * (len / 2 + hw) + Math.abs(uy) * hw;
  const ey = Math.abs(uy) * (len / 2 + hw) + Math.abs(ux) * hw;
  const cx = (s.from.x + s.to.x) / 2;
  const cy = (s.from.y + s.to.y) / 2;
  return {
    index,
    street: s,
    ox: s.from.x,
    oy: s.from.y,
    ux,
    uy,
    len,
    hw,
    place: s.width >= PLACE_MIN_WIDTH,
    bbox: { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey },
    /** Distance (m) du point à la chaussée (0 dedans). */
    distance(px, py) {
      const rx = px - s.from.x;
      const ry = py - s.from.y;
      const a = rx * ux + ry * uy;
      const b = -rx * uy + ry * ux;
      const da = Math.max(-hw - a, 0, a - reach);
      const db = Math.max(Math.abs(b) - hw, 0);
      return Math.hypot(da, db);
    },
  };
}

/** Distance d'un point à un rectangle aligné {x0, y0, x1, y1} (0 dedans). */
function rectDistance(px, py, r) {
  const dx = Math.max(r.x0 - px, 0, px - r.x1);
  const dy = Math.max(r.y0 - py, 0, py - r.y1);
  return Math.hypot(dx, dy);
}

/** Distance d'un point au segment [a, b]. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / l2, 0), 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/**
 * Index spatial simple (grille uniforme) d'éléments à boîte englobante.
 * @template T
 * @param {number} cell
 */
function createGrid(cell) {
  /** @type {Map<number, T[]>} */
  const map = new Map();
  // Clé numérique d'une case (|gx|, |gy| < 2^20 : cartes de moins de 2^20 cases de côté).
  const key = (gx, gy) => gx * 2097152 + gy;
  return {
    /** @param {T} item @param {{x0: number, y0: number, x1: number, y1: number}} box */
    add(item, box) {
      for (let gx = Math.floor(box.x0 / cell); gx <= Math.floor(box.x1 / cell); gx++) {
        for (let gy = Math.floor(box.y0 / cell); gy <= Math.floor(box.y1 / cell); gy++) {
          const k = key(gx, gy);
          const list = map.get(k);
          if (list) list.push(item);
          else map.set(k, [item]);
        }
      }
    },
    /**
     * Appelle fn sur les éléments des cases qui touchent le carré (x ± r, y ± r) (un élément
     * peut revenir plusieurs fois) ; s'arrête et renvoie true dès que fn renvoie true.
     * @param {(item: T) => boolean | void} fn
     */
    some(x, y, r, fn) {
      for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++) {
        for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) {
          const list = map.get(key(gx, gy));
          if (list) for (const it of list) if (fn(it)) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Exclusions de la scène, normalisées : disques {x, y, r} et couloirs {ax, ay, bx, by, r}.
 * @param {any} list `decorExclusions` : [{pos: [x, y], rayon} | {de: [x, y], a: [x, y], rayon}]
 */
export function normalizeExclusions(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('decorExclusions : liste attendue');
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
  return list.map((e, i) => {
    const where = `decorExclusions[${i}]`;
    if (!e || typeof e !== 'object') throw new Error(`${where} : objet attendu`);
    if (!(typeof e.rayon === 'number' && e.rayon >= 0)) throw new Error(`${where}.rayon : nombre positif attendu`);
    if (pair(e.pos)) return { ax: e.pos[0], ay: e.pos[1], bx: e.pos[0], by: e.pos[1], r: e.rayon };
    if (pair(e.de) && pair(e.a)) return { ax: e.de[0], ay: e.de[1], bx: e.a[0], by: e.a[1], r: e.rayon };
    throw new Error(`${where} : pos [x, y], ou de et a [x, y], attendus`);
  });
}

/* ------------------------------------------------------------------------- */
/* Placement                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {object} DecorItem
 * @property {string} kind sorte d'objet (clé de DECOR_KINDS)
 * @property {number} x centre au sol (repère du jeu)
 * @property {number} y
 * @property {number} cap orientation (rad) de l'axe local a ; l'axe b est à sa gauche. Banc,
 *   kiosque, jardinière, store : a le long de la rue, b vers la chaussée (le banc regarde la
 *   chaussée) ; platane : b vers la chaussée (le houppier penche vers la lumière)
 * @property {number} variant entier : graine de forme et de couleurs (decorMesher.js)
 * @property {number} [length] store : longueur le long de la façade (m)
 * @property {number} [radius] fontaine : rayon du bassin (m)
 * @property {string} blockId îlot de rattachement (chunk)
 * @property {{x0: number, y0: number, x1: number, y1: number} | null} collision obstacle
 * @property {{x0: number, y0: number, x1: number, y1: number}} extent emprise au sol totale
 *   (houppier compris), pour la distance et la sphère du chunk
 * @property {number} height hauteur maximale (m)
 * @property {boolean} small petit objet (retiré du profil « lite »)
 * @property {number} keep tirage uniforme dans [0, 1[ : l'objet est gardé si keep < fraction
 */

/** Emprise au sol (rayon horizontal maximal autour du centre, m) pour l'étendue du chunk. */
function reachOf(kind, item) {
  switch (kind) {
    case 'platane':
      return 5.6; // houppier ≤ 4,3 m de rayon, décalé de ≤ 1,3 m vers la chaussée
    case 'fontaine':
      return (item.radius ?? FOUNTAIN_RADIUS) + 0.1;
    case 'store':
      return (item.length ?? 4) / 2 + 1.5;
    case 'kiosque':
      return 1.8;
    case 'parasol':
      return 1.3;
    case 'banc':
      return 1;
    default:
      return 0.9;
  }
}

/**
 * Boîte de collision alignée sur les axes d'un objet (demi-tailles locales tournées).
 * @param {number} x
 * @param {number} y
 * @param {number} cap
 * @param {[number, number] | null} half
 */
function collisionBox(x, y, cap, half) {
  if (!half) return null;
  const c = Math.abs(Math.cos(cap));
  const s = Math.abs(Math.sin(cap));
  const ex = c * half[0] + s * half[1];
  const ey = s * half[0] + c * half[1];
  return { x0: x - ex, y0: y - ey, x1: x + ex, y1: y + ey };
}

/**
 * Place le décor d'une scène développée.
 * @param {{buildings: {x: number, y: number, width: number, depth: number, height: number,
 *          blockId: string}[], streets: {from: {x: number, y: number}, to: {x: number, y: number},
 *          width: number}[], lamps: {x: number, y: number}[],
 *          bounds: {xmin: number, ymin: number, xmax: number, ymax: number},
 *          start?: {x: number, y: number}}} city
 * @param {{seed?: number, density?: number, exclusions?: any[]}} [options] graine de la
 *   scène ; densité de placement (≥ 0, 1 par défaut) ; exclusions (`decorExclusions`)
 * @returns {DecorItem[]} décor complet (avant le filtre d'exécution : voir filterDecor)
 */
export function placeDecor(city, { seed = 0, density = 1, exclusions = [] } = {}) {
  const { buildings, streets, lamps, bounds } = city;
  const excl = normalizeExclusions(exclusions);
  if (city.start) excl.push({ ax: city.start.x, ay: city.start.y, bx: city.start.x, by: city.start.y, r: START_CLEARANCE });

  // Index : bâtiments, chaussées, lampadaires, exclusions, objets placés.
  const rects = buildings.map((b) => ({
    x0: b.x - b.width / 2,
    y0: b.y - b.depth / 2,
    x1: b.x + b.width / 2,
    y1: b.y + b.depth / 2,
    height: b.height,
    blockId: b.blockId,
  }));
  const buildingGrid = createGrid(16);
  for (const r of rects) buildingGrid.add(r, r);
  const ways = streets.map((s, i) => carriageway(s, i));
  const wayGrid = createGrid(32);
  for (const w of ways) wayGrid.add(w, w.bbox);
  const lampGrid = createGrid(16);
  for (const l of lamps) lampGrid.add(l, { x0: l.x, y0: l.y, x1: l.x, y1: l.y });
  const exclGrid = createGrid(32);
  for (const e of excl) {
    exclGrid.add(e, { x0: Math.min(e.ax, e.bx) - e.r, y0: Math.min(e.ay, e.by) - e.r, x1: Math.max(e.ax, e.bx) + e.r, y1: Math.max(e.ay, e.by) + e.r });
  }
  const placedGrid = createGrid(8);

  /** @type {DecorItem[]} */
  const items = [];

  /** Distance minimale du point aux bâtiments, cherchés jusqu'à `radius`. */
  const buildingClearance = (x, y, radius) => {
    let best = Infinity;
    buildingGrid.some(x, y, radius, (r) => {
      best = Math.min(best, rectDistance(x, y, r));
    });
    return best;
  };

  /**
   * Vrai si un objet de la sorte `kind` peut aller en (x, y).
   * @param {string} kind
   * @param {{host?: any, inPlace?: any, wall?: number}} [where] host : chaussée de la rue
   *   d'accueil (exemptée de la règle des carrefours, pas de celle de la chaussée) ; inPlace :
   *   place qui accueille l'objet (sa chaussée est permise ; pas besoin de façade proche) ;
   *   wall : marge aux façades (m)
   */
  const fits = (x, y, kind, where = {}) => {
    const { foot, across, low } = DECOR_KINDS[kind];
    const lampClear = kind === 'platane' ? TREE_LAMP_CLEARANCE : LAMP_CLEARANCE;
    if (x - foot < bounds.xmin + 1 || x + foot > bounds.xmax - 1 || y - foot < bounds.ymin + 1 || y + foot > bounds.ymax - 1) return false;
    const facade = buildingClearance(x, y, FRONTAGE_DISTANCE + 1);
    if (facade < across + (where.wall ?? WALL_MARGIN)) return false;
    if (!where.inPlace && facade > FRONTAGE_DISTANCE) return false;
    const corner = low ? CORNER_CLEARANCE_LOW : CORNER_CLEARANCE_TALL;
    const blocked = wayGrid.some(x, y, corner + foot, (w) => {
      if (w === where.inPlace) return false;
      const d = w.distance(x, y);
      if (d < across + CURB_MARGIN) return true; // sur une chaussée
      return w !== where.host && !(where.host && parallel(w, where.host)) && d < corner + across; // carrefour
    });
    if (blocked) return false;
    if (lampGrid.some(x, y, lampClear + foot, (l) => Math.hypot(l.x - x, l.y - y) < lampClear + across)) return false;
    if (exclGrid.some(x, y, foot, (e) => segmentDistance(x, y, e.ax, e.ay, e.bx, e.by) < e.r + foot)) return false;
    return !placedGrid.some(x, y, foot + 4, (p) => Math.hypot(p.x - x, p.y - y) < foot + p.foot - TOL);
  };

  /** Ajoute un objet (déjà validé). */
  const add = (kind, x, y, cap, extra, keep, foot = DECOR_KINDS[kind].foot) => {
    const spec = DECOR_KINDS[kind];
    const item = /** @type {DecorItem} */ ({
      kind,
      x,
      y,
      cap,
      variant: 0,
      ...extra,
      blockId: '',
      collision: collisionBox(x, y, cap, spec.box),
      extent: { x0: x, y0: y, x1: x, y1: y },
      height: spec.height,
      small: spec.small,
      keep,
    });
    const reach = reachOf(kind, item);
    item.extent = { x0: x - reach, y0: y - reach, x1: x + reach, y1: y + reach };
    items.push(item);
    if (foot > 0) placedGrid.add({ x, y, foot }, { x0: x - foot, y0: y - foot, x1: x + foot, y1: y + foot });
    return item;
  };

  // 1. Fontaines sur les places.
  ways.forEach((w) => {
    if (!w.place || w.len <= 0) return;
    const rand = createRandom(hashSeed(seed, `decor:place:${w.index}`));
    const u = rand();
    const p = Math.min(1, 0.9 * density);
    if (u >= p) return;
    placeFountain(w, rand, u / p);
  });

  // 2. Trottoirs de chaque rue (et des places), des deux côtés.
  ways.forEach((w) => {
    if (w.len <= 0 || ways.some((o) => o.index < w.index && duplicates(w, o))) return;
    const rand = createRandom(hashSeed(seed, `decor:rue:${w.index}`));
    const startStreet = city.start !== undefined && w.distance(city.start.x, city.start.y) === 0;
    const planted = rand() < TREE_STREET_PROBABILITY || startStreet;
    const spacing = TREE_SPACING - 0.5 + rand();
    for (const side of [1, -1]) sidewalk(w, side, planted, spacing, rand);
  });

  // 3. Rattachement aux îlots.
  for (const item of items) item.blockId = attach(item.x, item.y);
  return items;

  /* --- Détails ------------------------------------------------------------ */

  /** Deux chaussées parallèles (ou opposées). */
  function parallel(p, q) {
    return Math.abs(p.ux * q.uy - p.uy * q.ux) < 1e-6;
  }

  /** La chaussée w double o : même axe, même largeur, comprise dans o (rue répétée). */
  function duplicates(w, o) {
    if (!parallel(w, o) || Math.abs(w.hw - o.hw) > 0.01) return false;
    const proj = (x, y) => ({ a: (x - o.ox) * o.ux + (y - o.oy) * o.uy, b: -(x - o.ox) * o.uy + (y - o.oy) * o.ux });
    const p0 = proj(w.ox, w.oy);
    const p1 = proj(w.ox + w.ux * w.len, w.oy + w.uy * w.len);
    const inside = (p) => Math.abs(p.b) < 0.5 && p.a > -1 && p.a < o.len + 1;
    return inside(p0) && inside(p1);
  }

  /** Point du trottoir : abscisse t le long de la rue, décalage b depuis l'axe (côté side). */
  function at(w, t, b, side) {
    return { x: w.ox + w.ux * t - w.uy * b * side, y: w.oy + w.uy * t + w.ux * b * side };
  }

  /** Cap tel que l'axe local b (à gauche de a) pointe vers la chaussée. */
  function capToward(w, side) {
    // b = (−sin cap, cos cap) doit valoir −side·n, n = (−uy, ux) normale gauche de la rue.
    const bx = side * w.uy;
    const by = -side * w.ux;
    return Math.atan2(-bx, by);
  }

  function sidewalk(w, side, planted, spacing, rand) {
    const curb = w.hw;
    const line = curb + FURNITURE_SETBACK;
    const t0 = -w.hw;
    const t1 = w.len + w.hw;
    const capStreet = capToward(w, side);

    // Lampadaires de ce trottoir (pour le quinconce).
    const lampTs = [];
    for (const l of lamps) {
      const rx = l.x - w.ox;
      const ry = l.y - w.oy;
      const a = rx * w.ux + ry * w.uy;
      const b = (-rx * w.uy + ry * w.ux) * side;
      if (a >= t0 && a <= t1 && b > curb && b < curb + SIDEWALK_WIDTH) lampTs.push(a);
    }
    lampTs.sort((p, q) => p - q);
    const phase = lampTs.length > 0 ? lampTs[0] + spacing / 2 : rand() * spacing;
    const first = phase - Math.ceil((phase - t0) / spacing) * spacing;

    // Platanes d'alignement.
    const treeTs = [];
    if (planted) {
      const offset = rand();
      let k = 0;
      for (let t = first; t <= t1 + TOL; t += spacing, k++) {
        const keep = (offset + k * GOLDEN) % 1;
        if (keep >= Math.min(1, density)) continue;
        const p = at(w, t, line, side);
        if (!fits(p.x, p.y, 'platane', { host: w })) continue;
        const variant = Math.floor(rand() * 1e9);
        add('platane', p.x, p.y, capStreet, { variant }, keep);
        treeTs.push(t);
      }
    }

    // Façades bordant ce trottoir : terrasses et jardinières.
    const fronts = facadesAlong(w, side);
    for (const f of fronts) {
      const u = rand();
      const variant = Math.floor(rand() * 1e9);
      const awning = rand() < 0.45;
      const pTerrace = Math.min(1, 0.16 * density);
      const pPlanters = Math.min(1 - pTerrace, 0.14 * density);
      if (u < pTerrace) terrace(w, side, f, awning, variant, u / pTerrace);
      else if (u < pTerrace + pPlanters) planters(w, side, f, variant, (u - pTerrace) / pPlanters);
    }

    // Mobilier dans les intervalles (entre les arbres, ou tous les 5 m sans arbres).
    const slots = [];
    if (planted) for (const t of treeTs) slots.push(t + spacing / 2);
    else for (let t = first; t <= t1 + TOL; t += spacing / 2) slots.push(t);
    let kiosk = false;
    const corners = slotsNearEnds(w, side, slots, line);
    for (const t of slots) {
      const u = rand();
      const variant = Math.floor(rand() * 1e9);
      const p = at(w, t, line, side);
      if (corners.has(t)) {
        const pColumn = Math.min(1, 0.12 * density);
        if (u < pColumn && fits(p.x, p.y, 'colonne', { host: w })) add('colonne', p.x, p.y, capStreet, { variant }, u / pColumn);
        continue;
      }
      const pKiosk = Math.min(0.05, 0.05 * density);
      if (!planted && !kiosk && u < pKiosk) {
        if (fits(p.x, p.y, 'kiosque', { host: w })) {
          add('kiosque', p.x, p.y, capStreet, { variant }, u / pKiosk);
          kiosk = true;
        }
        continue;
      }
      const pBench = Math.min(0.55, (planted ? 0.22 : 0.12) * density);
      if (u >= 0.05 && u < 0.05 + pBench) {
        if (fits(p.x, p.y, 'banc', { host: w })) add('banc', p.x, p.y, capStreet, { variant }, (u - 0.05) / pBench);
        continue;
      }
      const pBollards = Math.min(0.4, 0.08 * density);
      if (!planted && u >= 0.6 && u < 0.6 + pBollards) bollards(w, side, t, variant, (u - 0.6) / pBollards);
    }
  }

  /**
   * Abscisses des intervalles les plus proches de chaque bout de la partie libre du trottoir
   * (au plus près des carrefours permis) : colonnes Morris.
   */
  function slotsNearEnds(w, side, slots, line) {
    const ok = slots.filter((t) => {
      const p = at(w, t, line, side);
      return fits(p.x, p.y, 'colonne', { host: w });
    });
    const out = new Set();
    // Débuts de séries : un trou de plus de 3 pas (carrefour) sépare deux séries.
    const gap = 3 * (slots.length > 1 ? Math.abs(slots[1] - slots[0]) : TREE_SPACING);
    for (let i = 0; i < ok.length; i++) {
      if (i === 0 || ok[i] - ok[i - 1] > gap) out.add(ok[i]);
      if (i === ok.length - 1 || ok[i + 1] - ok[i] > gap) out.add(ok[i]);
    }
    return out;
  }

  /**
   * Façades parallèles à la rue, au fond du trottoir du côté `side` : [{ta, tb, b}] (abscisses
   * le long de la rue, décalage de la façade depuis l'axe).
   */
  function facadesAlong(w, side) {
    const out = [];
    const want = w.hw + SIDEWALK_WIDTH;
    const seen = new Set();
    // Échantillonne la bande de façade le long de la rue.
    const visit = (r) => {
      if (seen.has(r)) return;
      seen.add(r);
        // Coins du bâtiment dans le repère de la rue.
      const corners = [
        [r.x0, r.y0],
        [r.x1, r.y0],
        [r.x1, r.y1],
        [r.x0, r.y1],
      ].map(([x, y]) => {
        const rx = x - w.ox;
        const ry = y - w.oy;
        return { a: rx * w.ux + ry * w.uy, b: (-rx * w.uy + ry * w.ux) * side };
      });
      const bmin = Math.min(...corners.map((c) => c.b));
      if (Math.abs(bmin - want) > 0.5) return;
      const ta = Math.max(0, Math.min(...corners.map((c) => c.a)));
      const tb = Math.min(w.len, Math.max(...corners.map((c) => c.a)));
      if (tb - ta >= 6) out.push({ ta, tb, b: bmin, height: r.height });
    };
    // Rues obliques : pas de façade parallèle (bâtiments alignés sur les axes).
    if (Math.abs(w.ux) > TOL && Math.abs(w.uy) > TOL) return out;
    for (let t = 0; t <= w.len; t += 8) {
      const p = at(w, t, want, side);
      buildingGrid.some(p.x, p.y, 2, visit);
    }
    return out.sort((p, q) => p.ta - q.ta);
  }

  /** Terrasse de café le long d'une façade : tables à parasol, ou store banne et tables. */
  function terrace(w, side, f, awning, variant, keep) {
    const pitch = 2.6;
    const n = Math.min(4, Math.floor((f.tb - f.ta - 2) / pitch));
    if (n < 2) return;
    const mid = (f.ta + f.tb) / 2;
    const tableLine = f.b - 1.25;
    const capStreet = capToward(w, side);
    const placed = [];
    for (let i = 0; i < n; i++) {
      const t = mid + (i - (n - 1) / 2) * pitch;
      const p = at(w, t, tableLine, side);
      if (!fits(p.x, p.y, 'parasol', { host: w, wall: 0.05 })) continue;
      placed.push(t);
      add('parasol', p.x, p.y, capStreet, { variant: variant + i, awning }, keep);
    }
    if (awning && placed.length >= 2 && f.height >= 3.5) {
      const ta = placed[0] - 1.3;
      const tb = placed[placed.length - 1] + 1.3;
      const p = at(w, (ta + tb) / 2, f.b, side);
      add('store', p.x, p.y, capStreet, { variant, length: tb - ta }, keep, 0);
    }
  }

  /** Deux jardinières fleuries contre une façade. */
  function planters(w, side, f, variant, keep) {
    const mid = (f.ta + f.tb) / 2;
    const capStreet = capToward(w, side);
    for (const dt of [-2.2, 2.2]) {
      const p = at(w, mid + dt, f.b - 0.45, side);
      if (fits(p.x, p.y, 'jardiniere', { host: w, wall: 0.05 })) {
        add('jardiniere', p.x, p.y, capStreet, { variant: variant + (dt > 0 ? 1 : 0) }, keep);
      }
    }
  }

  /** Rangée de quatre potelets le long du bord de la chaussée. */
  function bollards(w, side, t, variant, keep) {
    const capStreet = capToward(w, side);
    for (let i = 0; i < 4; i++) {
      const p = at(w, t + (i - 1.5) * 1.6, w.hw + 0.4, side);
      if (fits(p.x, p.y, 'potelet', { host: w })) {
        add('potelet', p.x, p.y, capStreet, { variant: variant + i }, keep);
      }
    }
  }

  /**
   * Fontaine d'une place : point de la chaussée de la place, à FOUNTAIN_CLEARANCE au moins des
   * bâtiments, des autres rues, des lampadaires et des exclusions, le plus près du centre ;
   * quatre bancs autour.
   */
  function placeFountain(w, rand, keep) {
    const R = FOUNTAIN_RADIUS;
    const need = R + FOUNTAIN_CLEARANCE;
    const inset = R + 2;
    const cx = w.ox + (w.ux * w.len) / 2;
    const cy = w.oy + (w.uy * w.len) / 2;
    // Points candidats de la place (≤ 80 × 80), du plus proche du centre au plus loin.
    const spanA = w.len + 2 * w.hw - 2 * inset;
    const spanB = 2 * w.hw - 2 * inset;
    if (spanA < 0 || spanB < 0) return;
    const stepGrid = Math.max(2, spanA / 80, spanB / 80);
    const candidates = [];
    for (let a = -w.hw + inset; a <= w.len + w.hw - inset + TOL; a += stepGrid) {
      for (let b = -w.hw + inset; b <= w.hw - inset + TOL; b += stepGrid) {
        const x = w.ox + w.ux * a - w.uy * b;
        const y = w.oy + w.uy * a + w.ux * b;
        candidates.push({ x, y, d: Math.hypot(x - cx, y - cy) });
      }
    }
    candidates.sort((p, q) => p.d - q.d);
    const best = candidates.find(({ x, y }) => {
      if (x - need < bounds.xmin || x + need > bounds.xmax || y - need < bounds.ymin || y + need > bounds.ymax) return false;
      if (buildingClearance(x, y, need + 1) < need) return false;
      if (wayGrid.some(x, y, need, (o) => o !== w && !o.place && o.distance(x, y) < need)) return false;
      if (lampGrid.some(x, y, need, (l) => Math.hypot(l.x - x, l.y - y) < need)) return false;
      return !exclGrid.some(x, y, R + 2, (e) => segmentDistance(x, y, e.ax, e.ay, e.bx, e.by) < e.r + R + 2);
    });
    if (!best) return;
    const variant = Math.floor(rand() * 1e9);
    const capPlace = Math.atan2(w.uy, w.ux);
    add('fontaine', best.x, best.y, capPlace, { variant, radius: R }, keep);
    // Bancs autour, tournés vers la fontaine (b vers le centre).
    for (let k = 0; k < 4; k++) {
      const ang = capPlace + Math.PI / 4 + (k * Math.PI) / 2;
      const x = best.x + Math.cos(ang) * (R + 3);
      const y = best.y + Math.sin(ang) * (R + 3);
      // Axe b = (−sin cap, cos cap) vers le centre : cap = ang − π/2 + π.
      const cap = ang + Math.PI / 2;
      if (fits(x, y, 'banc', { inPlace: w, host: w })) {
        add('banc', x, y, cap, { variant: variant + k + 1 }, keep);
      }
    }
  }

  /** Îlot du bâtiment le plus proche, ou case de décor seul. */
  function attach(x, y) {
    let best = null;
    let bestD = Infinity;
    const visit = (r) => {
      const d = rectDistance(x, y, r);
      if (d < bestD - TOL || (Math.abs(d - bestD) <= TOL && best && r.blockId < best.blockId)) {
        bestD = d;
        best = r;
      }
    };
    // D'abord tout près (cas courant : la façade derrière le trottoir), puis plus loin.
    for (const radius of [8, ATTACH_RADIUS]) {
      buildingGrid.some(x, y, radius, visit);
      if (best && bestD <= radius) return best.blockId;
    }
    return `decor:${Math.floor(x / DECOR_CELL)},${Math.floor(y / DECOR_CELL)}`;
  }
}

/**
 * Filtre d'exécution : fraction gardée et petits objets (profil « lite », `?decor=0`).
 * Le résultat est un sous-ensemble de `items`, décroissant avec `keep`.
 * @param {DecorItem[]} items
 * @param {{enabled: boolean, keep: number, small: boolean}} settings voir decorSettings
 * @returns {DecorItem[]}
 */
export function filterDecor(items, settings) {
  if (!settings.enabled) return [];
  return items.filter((it) => it.keep < settings.keep && (settings.small || !it.small));
}
