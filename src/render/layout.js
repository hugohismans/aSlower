/**
 * Développement des scènes JSON (module pur : ni DOM, ni three).
 *
 * Une scène (src/data/scenes/*.json, schéma « coursier-scene/1 ») décrit la ville
 * en peu de lignes ; `expandScene` la déplie en bâtiments (boîtes alignées sur les
 * axes), lampadaires, rues, départ, visibilité et limites. Le développement est
 * déterministe : générateur pseudo-aléatoire à graine (une graine par rangée,
 * dérivée de la graine de la scène et de l'id de la rangée).
 *
 * Format (clés en français camelCase, unités SI, repère du jeu : x vers l'est,
 * y vers le nord) :
 *
 *   schema       "coursier-scene/1"
 *   id, titre, description
 *   graine       entier
 *   limites      {min: [x, y], max: [x, y]}               (facultatif)
 *   visibilite   {lite: m, defaut: m}                     (brouillard opaque à cette distance)
 *   depart       {pos: [x, y], capDegres}                 (0 = est, 90 = nord, sens trigonométrique)
 *   rues[]       {id, nom?, de: [x, y], a: [x, y], largeur, repeter?: {nombre, pas: [dx, dy]}}
 *                largeur = chaussée ; streetMap.js ajoute 3 m de trottoir de chaque côté
 *                (une rue de 24 m entre façades a donc une chaussée de 18 m)
 *   rangees[]    macro : rangée d'îlots identiques, remplis de bâtiments mitoyens
 *                {id, coin: [x, y] (coin sud-ouest du 1er îlot), ilot: [lx, ly],
 *                 nombre, pas: [dx, dy], rangs?: {nombre, pas: [dx, dy]} (répète la rangée),
 *                 facades: ["sud" | "nord" | "ouest" | "est"] (côtés bâtis de l'îlot),
 *                 largeurs: [min, max] (le long de la façade), profondeurs: [min, max],
 *                 hauteurs: [min, max] (min ≥ MIN_BUILDING_HEIGHT), couleurs: [noms de la palette],
 *                 ordreCouleurs: "suite" (dans l'ordre, en boucle) | "hasard"}
 *   batiments[]  {id, nom?, pos: [x, y] (centre), taille: [lx, ly], hauteur (≥ MIN_BUILDING_HEIGHT), couleur,
 *                 ir?, uv?, ilot? (regroupe plusieurs bâtiments isolés dans un même îlot)}
 *   lampadaires[] {rue (id d'une entrée de rues, répétitions comprises), pas, depart?,
 *                  hauteur? (6), temperature? (2700), intensite? (1), retrait? (1,5 m : distance
 *                  du bord de la chaussée au lampadaire, sur le trottoir),
 *                  cotes? ("deux" | "gauche" | "droite")}
 *
 * Îlots et chunks : chaque îlot d'une rangée, et chaque bâtiment isolé, reçoit un
 * `blockId`. Le maillage fait un chunk par blockId (render/cityMesher.js). Un
 * bâtiment n'est jamais coupé, et deux bâtiments qui se touchent finissent
 * toujours dans le même îlot (les blocs en contact sont fusionnés) : les façades
 * mitoyennes sont donc maillées ensemble, sans fissure entre LOD différents.
 *
 * Coordonnées générées arrondies au demi-mètre (multiple d'une puissance de 2) :
 * les bords communs de deux bâtiments mitoyens sont alors des valeurs identiques,
 * et centre ± demi-taille les redonne exactement en virgule flottante.
 */
import { BLACKBODY_TEMPERATURES, EYE_HEIGHT } from '../physics/constants.js';

export const SCENE_SCHEMA = 'coursier-scene/1';

/** Pas d'arrondi des dimensions générées (m). */
export const LAYOUT_GRID = 0.5;

/**
 * Hauteur minimale d'un bâtiment (m) : l'œil (EYE_HEIGHT) reste sous tous les toits, avec
 * 1 m de marge, et la valeur est sur la grille. cityMesher ne subdivise les toits qu'au pas
 * max(s, ROOF_STEP), sans les coupures des murs : un toit vu d'en haut ouvrirait des fissures
 * sous aberration.
 */
export const MIN_BUILDING_HEIGHT = Math.ceil((EYE_HEIGHT + 1) / LAYOUT_GRID) * LAYOUT_GRID;

/** Contenu IR et UV par défaut d'une couleur donnée en hexadécimal. */
export const DEFAULT_IR = 0.3;
export const DEFAULT_UV = 0.15;

/** Visibilité par défaut si la scène n'en donne pas (m). */
export const DEFAULT_VISIBILITY = Object.freeze({ lite: 400, default: 600 });

const SIDES = ['sud', 'nord', 'ouest', 'est'];
const TOL = 1e-6;
/** Une bande de façade plus courte que ceci (m) reste vide. */
const MIN_STRIP = 4;
/** Marge autour du contenu quand la scène ne donne pas de limites (m). */
const BOUNDS_MARGIN = 20;

/**
 * Générateur pseudo-aléatoire à graine (mulberry32) : nombres dans [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function createRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Graine dérivée d'une graine et d'un texte (FNV-1a) : chaque rangée a sa propre
 * suite, si bien que modifier une rangée ne change pas les autres.
 * @param {number} seed
 * @param {string} text
 */
export function hashSeed(seed, text) {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Couleur d'un nom de la palette (ou d'un hexadécimal « #rrggbb »).
 * @param {string} name
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette
 * @param {string} [where] contexte pour le message d'erreur
 * @returns {{srgb: string, ir: number, uv: number}}
 */
export function resolveColor(name, palette, where = 'scène') {
  const entry = Object.prototype.hasOwnProperty.call(palette, name) ? palette[name] : null;
  if (entry) {
    if (!/^#[0-9a-f]{6}$/i.test(entry.srgb)) throw new Error(`Palette : « ${name} » n'a pas de srgb « #rrggbb »`);
    return { srgb: entry.srgb, ir: entry.ir ?? DEFAULT_IR, uv: entry.uv ?? DEFAULT_UV };
  }
  if (/^#[0-9a-f]{6}$/i.test(name)) return { srgb: name, ir: DEFAULT_IR, uv: DEFAULT_UV };
  throw new Error(`${where} : couleur « ${name} » absente de la palette`);
}

/**
 * Emprise au sol d'un bâtiment (x, y = centre ; width le long de x, depth le long de y).
 * @param {{x: number, y: number, width: number, depth: number}} b
 */
export function footprint(b) {
  const hw = b.width / 2;
  const hd = b.depth / 2;
  return { x0: b.x - hw, y0: b.y - hd, x1: b.x + hw, y1: b.y + hd };
}

/**
 * Aire commune de deux emprises (0 s'ils se touchent seulement).
 * @param {{x0: number, y0: number, x1: number, y1: number}} a
 * @param {{x0: number, y0: number, x1: number, y1: number}} b
 */
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > TOL && d > TOL ? w * d : 0;
}

/**
 * Vrai si les emprises fermées se touchent ou se chevauchent.
 * @param {{x0: number, y0: number, x1: number, y1: number}} a
 * @param {{x0: number, y0: number, x1: number, y1: number}} b
 */
export function footprintsTouch(a, b) {
  return a.x0 <= b.x1 + TOL && b.x0 <= a.x1 + TOL && a.y0 <= b.y1 + TOL && b.y0 <= a.y1 + TOL;
}

/* ------------------------------------------------------------------------- */
/* Petits outils                                                              */
/* ------------------------------------------------------------------------- */

function need(condition, message) {
  if (!condition) throw new Error(message);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isPair = (v) => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
const isRange = (v) => isPair(v) && v[0] > 0 && v[1] >= v[0];

/** Arrondi au pas LAYOUT_GRID. */
const snap = (v) => Math.round(v / LAYOUT_GRID) * LAYOUT_GRID;
/** Arrondi inférieur au pas LAYOUT_GRID. */
const snapDown = (v) => Math.floor(v / LAYOUT_GRID + 1e-9) * LAYOUT_GRID;

/**
 * Découpe une longueur en largeurs comprises dans [min, max], au demi-mètre près.
 * Repli (bornes impossibles à tenir) : parts égales.
 * @param {number} length
 * @param {[number, number]} range
 * @param {() => number} rand
 * @returns {number[]}
 */
function partitionLength(length, [wmin, wmax], rand) {
  const units = length / LAYOUT_GRID;
  const lo = Math.ceil(wmin / LAYOUT_GRID - 1e-9);
  const hi = Math.floor(wmax / LAYOUT_GRID + 1e-9);
  if (Math.abs(units - Math.round(units)) < 1e-9 && lo >= 1 && hi >= lo) {
    const total = Math.round(units);
    const nMin = Math.ceil(total / hi);
    const nMax = Math.floor(total / lo);
    if (nMin <= nMax) {
      const n = nMin + Math.floor(rand() * (nMax - nMin + 1));
      const widths = [];
      let rest = total;
      for (let i = 0; i < n - 1; i++) {
        // Bornes qui laissent aux bâtiments restants une largeur permise.
        const left = n - 1 - i;
        const a = Math.max(lo, rest - left * hi);
        const b = Math.min(hi, rest - left * lo);
        const w = a + Math.floor(rand() * (b - a + 1));
        widths.push(w * LAYOUT_GRID);
        rest -= w;
      }
      widths.push(rest * LAYOUT_GRID);
      return widths;
    }
  }
  const n = Math.max(1, Math.round(length / ((wmin + wmax) / 2)));
  return Array.from({ length: n }, () => length / n);
}

/* ------------------------------------------------------------------------- */
/* Rangées d'îlots                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Choix des couleurs d'une rangée : dans l'ordre (en boucle) ou au hasard, sans
 * répéter deux fois de suite la même couleur.
 */
function colorPicker(row, rand, where) {
  const list = row.couleurs ?? ['gris'];
  need(Array.isArray(list) && list.length > 0, `${where}.couleurs : liste vide`);
  const mode = row.ordreCouleurs ?? 'suite';
  need(mode === 'suite' || mode === 'hasard', `${where}.ordreCouleurs : « ${mode} » inconnu`);
  let k = 0;
  let last = null;
  return () => {
    let name;
    if (mode === 'hasard') {
      let i = Math.floor(rand() * list.length);
      if (list.length > 1 && list[i] === last) i = (i + 1) % list.length;
      name = list[i];
    } else {
      name = list[k++ % list.length];
    }
    last = name;
    return name;
  };
}

/**
 * Bande de bâtiments mitoyens le long d'une façade d'îlot, de a à b.
 * @returns {{a: number, b: number, depth: number, height: number}[]}
 */
function strip(a, b, maxDepth, row, rand) {
  const widths = partitionLength(b - a, row.largeurs, rand);
  const pieces = [];
  let cut = a;
  widths.forEach((w, i) => {
    const next = i === widths.length - 1 ? b : cut + w; // dernière coupure exacte
    const [dmin, dmax] = row.profondeurs;
    const [hmin, hmax] = row.hauteurs;
    const depth = Math.min(snap(dmin + rand() * (dmax - dmin)), snapDown(maxDepth));
    const height = Math.max(LAYOUT_GRID, snap(hmin + rand() * (hmax - hmin)));
    pieces.push({ a: cut, b: next, depth, height });
    cut = next;
  });
  return pieces;
}

/**
 * Bâtiments d'un îlot [x0, x0 + lx] × [y0, y0 + ly]. Les façades sud et nord
 * prennent toute la largeur (coins compris) ; les façades ouest et est vont de la
 * bande sud à la bande nord, avec une profondeur au plus égale à la largeur des
 * bâtiments d'angle (pas de chevauchement). Ordre : sud et nord d'ouest en est,
 * puis ouest et est du sud au nord.
 */
function expandBlock(x0, y0, row, ctx, blockId, out) {
  const [lx, ly] = row.ilot;
  const x1 = x0 + lx;
  const y1 = y0 + ly;
  const sides = row.facades ?? SIDES;
  const has = (s) => sides.includes(s);
  const maxNS = has('sud') && has('nord') ? ly / 2 : ly;
  const maxEW = has('ouest') && has('est') ? lx / 2 : lx;
  const emit = (bx0, by0, bx1, by1, height) => {
    out.push(makeBuilding(bx0, by0, bx1, by1, height, ctx.nextColor(), ctx.palette, blockId, ctx.where));
  };

  const south = has('sud') ? strip(x0, x1, maxNS, row, ctx.rand) : [];
  for (const p of south) emit(p.a, y0, p.b, y0 + p.depth, p.height);
  const north = has('nord') ? strip(x0, x1, maxNS, row, ctx.rand) : [];
  for (const p of north) emit(p.a, y1 - p.depth, p.b, y1, p.height);

  for (const side of ['ouest', 'est']) {
    if (!has(side)) continue;
    const corner = (list) => (list.length === 0 ? null : side === 'ouest' ? list[0] : list[list.length - 1]);
    const cs = corner(south);
    const cn = corner(north);
    const ya = cs ? y0 + cs.depth : y0;
    const yb = cn ? y1 - cn.depth : y1;
    if (yb - ya < MIN_STRIP) continue;
    let maxDepth = maxEW;
    if (cs) maxDepth = Math.min(maxDepth, cs.b - cs.a);
    if (cn) maxDepth = Math.min(maxDepth, cn.b - cn.a);
    for (const p of strip(ya, yb, maxDepth, row, ctx.rand)) {
      if (side === 'ouest') emit(x0, p.a, x0 + p.depth, p.b, p.height);
      else emit(x1 - p.depth, p.a, x1, p.b, p.height);
    }
  }
}

/** Valide puis développe une entrée de `rangees`. */
function expandRow(row, index, seed, palette, out) {
  const where = `rangees[${index}]${row.id ? ` (${row.id})` : ''}`;
  need(typeof row.id === 'string' && row.id.length > 0, `${where} : id manquant`);
  need(isPair(row.coin), `${where}.coin : [x, y] attendu`);
  need(isPair(row.ilot) && row.ilot[0] > 0 && row.ilot[1] > 0, `${where}.ilot : [lx, ly] positifs attendus`);
  for (const key of ['largeurs', 'profondeurs', 'hauteurs']) {
    need(isRange(row[key]), `${where}.${key} : [min, max] positifs attendus`);
  }
  need(row.hauteurs[0] >= MIN_BUILDING_HEIGHT, `${where}.hauteurs : au moins ${MIN_BUILDING_HEIGHT} m (l'œil doit rester sous les toits)`);
  const sides = row.facades ?? SIDES;
  need(Array.isArray(sides) && sides.every((s) => SIDES.includes(s)), `${where}.facades : ${SIDES.join(', ')}`);
  const count = row.nombre ?? 1;
  const step = row.pas ?? [0, 0];
  const ranks = row.rangs ?? { nombre: 1, pas: [0, 0] };
  need(Number.isInteger(count) && count >= 1, `${where}.nombre : entier ≥ 1 attendu`);
  need(isPair(step), `${where}.pas : [dx, dy] attendu`);
  need(Number.isInteger(ranks.nombre) && ranks.nombre >= 1 && isPair(ranks.pas), `${where}.rangs : {nombre, pas} attendu`);

  const rand = createRandom(hashSeed(seed, row.id));
  const ctx = { rand, palette, where, nextColor: colorPicker(row, rand, where) };
  for (let r = 0; r < ranks.nombre; r++) {
    for (let i = 0; i < count; i++) {
      const x0 = row.coin[0] + i * step[0] + r * ranks.pas[0];
      const y0 = row.coin[1] + i * step[1] + r * ranks.pas[1];
      const blockId = ranks.nombre > 1 ? `${row.id}-${r}-${i}` : `${row.id}-${i}`;
      expandBlock(x0, y0, row, ctx, blockId, out);
    }
  }
}

function makeBuilding(x0, y0, x1, y1, height, colorName, palette, blockId, where, overrides = {}) {
  const c = resolveColor(colorName, palette, where);
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    width: x1 - x0,
    depth: y1 - y0,
    height,
    color: c.srgb,
    ir: overrides.ir ?? c.ir,
    uv: overrides.uv ?? c.uv,
    blockId,
  };
}

/* ------------------------------------------------------------------------- */
/* Bâtiments isolés, rues, lampadaires                                        */
/* ------------------------------------------------------------------------- */

function expandStandalone(entry, index, palette, out) {
  const where = `batiments[${index}]${entry.id ? ` (${entry.id})` : ''}`;
  need(isPair(entry.pos), `${where}.pos : [x, y] attendu`);
  need(isPair(entry.taille) && entry.taille[0] > 0 && entry.taille[1] > 0, `${where}.taille : [lx, ly] positifs attendus`);
  need(isNum(entry.hauteur) && entry.hauteur > 0, `${where}.hauteur : nombre positif attendu`);
  need(entry.hauteur >= MIN_BUILDING_HEIGHT, `${where}.hauteur : au moins ${MIN_BUILDING_HEIGHT} m (l'œil doit rester sous les toits)`);
  const [cx, cy] = entry.pos;
  const [lx, ly] = entry.taille;
  const blockId = entry.ilot ?? entry.id ?? `batiment-${index}`;
  out.push(
    makeBuilding(cx - lx / 2, cy - ly / 2, cx + lx / 2, cy + ly / 2, entry.hauteur, entry.couleur, palette, blockId, where, {
      ir: entry.ir,
      uv: entry.uv,
    }),
  );
}

/** Rues (répétitions dépliées) : liste pour le rendu et index par id pour les lampadaires. */
function expandStreets(entries) {
  const list = [];
  const byId = new Map();
  entries.forEach((r, i) => {
    const where = `rues[${i}]${r.id ? ` (${r.id})` : ''}`;
    need(isPair(r.de) && isPair(r.a), `${where} : de et a [x, y] attendus`);
    need(isNum(r.largeur) && r.largeur > 0, `${where}.largeur : nombre positif attendu`);
    const rep = r.repeter ?? { nombre: 1, pas: [0, 0] };
    need(Number.isInteger(rep.nombre) && rep.nombre >= 1 && isPair(rep.pas), `${where}.repeter : {nombre, pas} attendu`);
    const segments = [];
    for (let k = 0; k < rep.nombre; k++) {
      const dx = k * rep.pas[0];
      const dy = k * rep.pas[1];
      const seg = { from: { x: r.de[0] + dx, y: r.de[1] + dy }, to: { x: r.a[0] + dx, y: r.a[1] + dy }, width: r.largeur };
      segments.push(seg);
      list.push(seg);
    }
    if (r.id) {
      need(!byId.has(r.id), `${where} : id « ${r.id} » en double`);
      byId.set(r.id, segments);
    }
  });
  return { list, byId };
}

/** Lampadaires le long des rues, des deux côtés (ou d'un seul). */
function expandLamps(entries, streetsById) {
  const lamps = [];
  entries.forEach((e, i) => {
    const where = `lampadaires[${i}]`;
    const segments = streetsById.get(e.rue);
    need(segments, `${where}.rue : rue « ${e.rue} » inconnue`);
    need(isNum(e.pas) && e.pas > 0, `${where}.pas : nombre positif attendu`);
    const start = e.depart ?? e.pas / 2;
    const height = e.hauteur ?? 6;
    const temperature = e.temperature ?? 2700;
    const intensity = e.intensite ?? 1;
    const setback = e.retrait ?? 1.5;
    const sides = e.cotes ?? 'deux';
    need(BLACKBODY_TEMPERATURES.includes(temperature), `${where}.temperature : ${temperature} K absente de la LUT`);
    need(['deux', 'gauche', 'droite'].includes(sides), `${where}.cotes : deux, gauche ou droite`);
    for (const s of segments) {
      const dx = s.to.x - s.from.x;
      const dy = s.to.y - s.from.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const ux = dx / len;
      const uy = dy / len;
      const offset = s.width / 2 + setback; // sur le trottoir ; normale à gauche du sens de la rue : (−uy, ux)
      for (let k = 0; start + k * e.pas <= len + 1e-9; k++) {
        const d = start + k * e.pas;
        const px = s.from.x + ux * d;
        const py = s.from.y + uy * d;
        if (sides !== 'droite') lamps.push({ x: px - uy * offset, y: py + ux * offset, height, temperature, intensity });
        if (sides !== 'gauche') lamps.push({ x: px + uy * offset, y: py - ux * offset, height, temperature, intensity });
      }
    }
  });
  return lamps;
}

/**
 * Fusionne les îlots dont des bâtiments se touchent (le premier id rencontré reste)
 * et refuse les chevauchements. Balayage selon x : quasi linéaire.
 */
function mergeTouchingBlocks(buildings) {
  const parent = new Map();
  const rank = new Map();
  for (const b of buildings) {
    if (!parent.has(b.blockId)) {
      parent.set(b.blockId, b.blockId);
      rank.set(b.blockId, rank.size);
    }
  }
  const find = (id) => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r);
    parent.set(id, r);
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank.get(ra) < rank.get(rb)) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  const boxes = buildings.map(footprint);
  const order = buildings.map((_, i) => i).sort((i, j) => boxes[i].x0 - boxes[j].x0);
  for (let a = 0; a < order.length; a++) {
    const bi = boxes[order[a]];
    for (let c = a + 1; c < order.length; c++) {
      const bj = boxes[order[c]];
      if (bj.x0 > bi.x1 + TOL) break;
      if (!footprintsTouch(bi, bj)) continue;
      const p = buildings[order[a]];
      const q = buildings[order[c]];
      need(
        overlapArea(bi, bj) === 0,
        `Bâtiments qui se chevauchent : îlot ${p.blockId} (${p.x}, ${p.y}) et îlot ${q.blockId} (${q.x}, ${q.y})`,
      );
      union(p.blockId, q.blockId);
    }
  }
  for (const b of buildings) b.blockId = find(b.blockId);
}

/** Limites calculées depuis le contenu (si la scène n'en donne pas). */
function contentBounds(buildings, streets, lamps) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  const add = (x, y, r = 0) => {
    xmin = Math.min(xmin, x - r);
    ymin = Math.min(ymin, y - r);
    xmax = Math.max(xmax, x + r);
    ymax = Math.max(ymax, y + r);
  };
  for (const b of buildings) {
    const f = footprint(b);
    add(f.x0, f.y0);
    add(f.x1, f.y1);
  }
  for (const s of streets) {
    add(s.from.x, s.from.y, s.width / 2);
    add(s.to.x, s.to.y, s.width / 2);
  }
  for (const l of lamps) add(l.x, l.y);
  if (!Number.isFinite(xmin)) return { xmin: -BOUNDS_MARGIN, ymin: -BOUNDS_MARGIN, xmax: BOUNDS_MARGIN, ymax: BOUNDS_MARGIN };
  return { xmin: xmin - BOUNDS_MARGIN, ymin: ymin - BOUNDS_MARGIN, xmax: xmax + BOUNDS_MARGIN, ymax: ymax + BOUNDS_MARGIN };
}

/* ------------------------------------------------------------------------- */
/* Point d'entrée                                                             */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {{x: number, y: number, width: number, depth: number, height: number,
 *            color: string, ir: number, uv: number, blockId: string}} Building
 *   (x, y) centre de l'emprise ; width le long de x, depth le long de y (m) ;
 *   color : sRGB « #rrggbb » (converti en linéaire par cityMesher).
 * @typedef {{x: number, y: number, height: number, temperature: number, intensity: number}} Lamp
 * @typedef {{from: {x: number, y: number}, to: {x: number, y: number}, width: number}} Street
 */

/**
 * Développe une scène JSON.
 * @param {any} scene contenu d'un fichier de src/data/scenes/
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette src/data/palette.json
 * @returns {{buildings: Building[], lamps: Lamp[], streets: Street[],
 *            start: {x: number, y: number, heading: number},
 *            visibility: {lite: number, default: number},
 *            bounds: {xmin: number, ymin: number, xmax: number, ymax: number}}}
 */
export function expandScene(scene, palette) {
  need(scene && typeof scene === 'object', 'Scène absente');
  const name = scene.id ?? 'scène';
  need(scene.schema === SCENE_SCHEMA, `Scène « ${name} » : schéma « ${scene.schema} » au lieu de « ${SCENE_SCHEMA} »`);
  need(palette && typeof palette === 'object', `Scène « ${name} » : palette absente`);
  const seed = Number.isInteger(scene.graine) ? scene.graine : 0;

  const { list: streets, byId } = expandStreets(scene.rues ?? []);
  const buildings = [];
  (scene.rangees ?? []).forEach((row, i) => expandRow(row, i, seed, palette, buildings));
  (scene.batiments ?? []).forEach((b, i) => expandStandalone(b, i, palette, buildings));
  mergeTouchingBlocks(buildings);
  const lamps = expandLamps(scene.lampadaires ?? [], byId);

  const depart = scene.depart ?? {};
  const pos = isPair(depart.pos) ? depart.pos : [0, 0];
  const capDegrees = isNum(depart.capDegres) ? depart.capDegres : 90;
  // (cap/180)·π : 90° donne exactement Math.PI / 2.
  const start = { x: pos[0], y: pos[1], heading: (capDegrees / 180) * Math.PI };

  const vis = scene.visibilite ?? {};
  const visibility = {
    lite: isNum(vis.lite) ? vis.lite : DEFAULT_VISIBILITY.lite,
    default: isNum(vis.defaut) ? vis.defaut : DEFAULT_VISIBILITY.default,
  };

  const lim = scene.limites;
  const bounds =
    lim && isPair(lim.min) && isPair(lim.max)
      ? { xmin: lim.min[0], ymin: lim.min[1], xmax: lim.max[0], ymax: lim.max[1] }
      : contentBounds(buildings, streets, lamps);

  return { buildings, lamps, streets, start, visibility, bounds };
}
