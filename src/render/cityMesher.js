/**
 * Maillage de la ville : scène JSON → îlots (chunks) à LOD paresseux, lampadaires
 * émissifs, rues, départ, visibilité et limites.
 *
 * Un chunk = un îlot (render/layout.js garantit qu'aucun bâtiment n'est coupé et
 * que des bâtiments qui se touchent sont dans le même îlot). Deux îlots ne
 * partagent donc jamais d'arête : des LOD différents de part et d'autre d'une rue
 * ne peuvent pas ouvrir de fissure, et il n'est jamais nécessaire de subdiviser
 * les arêtes extérieures d'un îlot au pas le plus fin.
 *
 * Murs sans jonction en T à l'intérieur d'un îlot. Un mur est une suite de lignes
 * verticales (pas ≤ s le long du mur, coupures aux bords des voisins qui le
 * touchent). Chaque ligne verticale de l'îlot, au point (x, y), porte une liste de
 * hauteurs canonique : l'union des niveaux de tous les bâtiments dont l'emprise
 * contient ce point (niveaux d'un bâtiment : 0, AO_HEIGHT, puis pas ≤ s jusqu'au
 * toit). Toutes les faces qui passent par cette ligne y ont donc exactement les
 * mêmes sommets ; entre deux lignes, une bande « fermeture éclair » raccorde des
 * listes de tailles différentes (subdivide.js). Les parties de mur cachées par un
 * voisin mitoyen (mur commun) ne sont pas émises.
 *
 * Toits : vus d'en dessous depuis l'œil (1,6 m, sous tous les toits), ce sont des
 * faces arrière, éliminées par le GPU ; ils ne sont subdivisés qu'au pas
 * max(s, ROOF_STEP), sans les coupures des murs, pour rester robustes à l'aberration sans
 * coûter de triangles. Garde-fou : layout.js refuse tout bâtiment plus bas que
 * MIN_BUILDING_HEIGHT (3 m) ; un toit vu d'en haut ouvrirait des fentes sous aberration.
 *
 * Attributs (docs/interfaces.md) : position (repère Three : X = x, Y = z, Z = −y),
 * color (réflectance r, g, b linéaire), aSpec (ir, uv, ombrage cuit). Lampadaires :
 * position et aEmit (ligne de LUT du corps noir, intensité).
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three';
import { blackbodyRow } from '../physics/constants.js';
import { decorPaletteEntries, meshDecor } from './decorMesher.js';
import { expandScene, footprint } from './layout.js';
import { splitRange, uniqueSorted, zipperStrip } from './subdivide.js';

/**
 * Ombrage cuit par orientation de face (soleil au sud-ouest, haut dans le ciel) :
 * les volumes restent lisibles quand le Doppler fait glisser les teintes.
 */
export const FACE_SHADE = Object.freeze({ roof: 1, south: 0.85, west: 0.75, east: 0.68, north: 0.6 });

/**
 * Léger assombrissement au pied des murs : −AO_STRENGTH au sol, nul à AO_HEIGHT (m).
 * AO_HEIGHT est un niveau des murs à tous les LOD : la rampe, linéaire entre deux
 * sommets, est la même à chaque LOD (pas de saut de teinte au changement de LOD).
 */
export const AO_HEIGHT = 3;
export const AO_STRENGTH = 0.15;

/** Pas minimal de la grille des toits (m). */
export const ROOF_STEP = 15;

/** Tête de lampadaire : boîte émissive de LAMP_SIZE × LAMP_SIZE × LAMP_HEIGHT (m). */
export const LAMP_SIZE = 0.8;
export const LAMP_HEIGHT = 0.5;

/** LOD par défaut : pas de grille (m), du plus fin au plus grossier. */
export const DEFAULT_LOD_STEPS = Object.freeze([1.5, 5, 15]);

const TOL = 1e-6;

/**
 * Composante sRGB (0..1) → linéaire (fonction de transfert sRGB).
 * @param {number} c
 */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * « #rrggbb » → [r, g, b] linéaire.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToLinearRgb(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Couleur invalide : ${hex}`);
  return [srgbToLinear(parseInt(m[1], 16) / 255), srgbToLinear(parseInt(m[2], 16) / 255), srgbToLinear(parseInt(m[3], 16) / 255)];
}

/** Facteur d'assombrissement au pied des murs à la hauteur z. */
function ambientOcclusion(z) {
  return 1 - AO_STRENGTH * Math.max(0, 1 - z / AO_HEIGHT);
}

/**
 * @typedef {{x0: number, y0: number, x1: number, y1: number, h: number,
 *            rgb: number[], ir: number, uv: number}} Box
 *   bâtiment d'un îlot, dans le repère du jeu ; rgb linéaire.
 */

/** Agrandit un tableau typé (capacité doublée) pour contenir au moins `size` éléments. */
function ensure(array, size) {
  if (size <= array.length) return array;
  const next = new array.constructor(Math.max(size, 2 * array.length));
  next.set(array);
  return next;
}

/**
 * Maillage en cours de construction : sommets dans le repère du jeu (float64, pour
 * des tests de hauteur exacts), bâtiment d'origine et ombrage par sommet. `finish`
 * retire les sommets inutilisés et écrit les attributs dans le repère Three.
 * @param {Box[]} boxes
 */
function createWriter(boxes, step) {
  // Capacité initiale estimée (murs en grille + marge) : évite la plupart des agrandissements.
  let estimate = 64;
  for (const b of boxes) {
    estimate += (2 * (b.x1 - b.x0 + b.y1 - b.y0) / step + 8) * (b.h / step + 6);
  }
  estimate = Math.ceil(estimate);
  let pos = new Float64Array(3 * estimate);
  let shade = new Float32Array(estimate);
  let owner = new Uint16Array(estimate);
  let idx = new Uint32Array(6 * estimate);
  let nv = 0;
  let ni = 0;
  return {
    /** Ajoute un sommet (x, y, z du jeu) du bâtiment n° box et renvoie son indice. */
    vertex(x, y, z, box, s) {
      if (nv === shade.length) {
        pos = ensure(pos, 3 * (nv + 1));
        shade = ensure(shade, nv + 1);
        owner = ensure(owner, nv + 1);
      }
      pos[3 * nv] = x;
      pos[3 * nv + 1] = y;
      pos[3 * nv + 2] = z;
      shade[nv] = s;
      owner[nv] = box;
      return nv++;
    },
    /** Hauteur z (repère du jeu) du sommet i. */
    z(i) {
      return pos[3 * i + 2];
    },
    tri(a, b, c) {
      if (ni + 3 > idx.length) idx = ensure(idx, ni + 3);
      idx[ni++] = a;
      idx[ni++] = b;
      idx[ni++] = c;
    },
    finish() {
      const remap = new Int32Array(nv).fill(-1);
      let used = 0;
      for (let k = 0; k < ni; k++) if (remap[idx[k]] < 0) remap[idx[k]] = used++;
      const positions = new Float32Array(used * 3);
      const colors = new Float32Array(used * 3);
      const specs = new Float32Array(used * 3);
      for (let i = 0; i < nv; i++) {
        const j = remap[i];
        if (j < 0) continue;
        const b = boxes[owner[i]];
        positions[3 * j] = pos[3 * i]; // X = x
        positions[3 * j + 1] = pos[3 * i + 2]; // Y = z
        positions[3 * j + 2] = -pos[3 * i + 1]; // Z = −y
        colors[3 * j] = b.rgb[0];
        colors[3 * j + 1] = b.rgb[1];
        colors[3 * j + 2] = b.rgb[2];
        specs[3 * j] = b.ir;
        specs[3 * j + 1] = b.uv;
        specs[3 * j + 2] = shade[i];
      }
      const indices = used <= 65535 ? new Uint16Array(ni) : new Uint32Array(ni);
      for (let k = 0; k < ni; k++) indices[k] = remap[idx[k]];
      return { positions, colors, specs, indices, vertexCount: used, triangleCount: ni / 3 };
    },
  };
}

/**
 * Les quatre murs d'une boîte. `axis` : direction des lignes du mur ('x' pour un
 * mur dans un plan y = cste) ; `reversed` : le sens « gauche → droite » vu de
 * dehors va vers les coordonnées décroissantes (t × ẑ = normale sortante).
 * `touches(t)` : la boîte t touche ce mur par l'extérieur.
 * @param {Box} b
 */
function wallFaces(b) {
  return [
    { axis: 'x', fixed: b.y0, from: b.x0, to: b.x1, reversed: false, shade: FACE_SHADE.south, touches: (t) => Math.abs(t.y1 - b.y0) <= TOL, range: (t) => [t.x0, t.x1] },
    { axis: 'y', fixed: b.x1, from: b.y0, to: b.y1, reversed: false, shade: FACE_SHADE.east, touches: (t) => Math.abs(t.x0 - b.x1) <= TOL, range: (t) => [t.y0, t.y1] },
    { axis: 'x', fixed: b.y1, from: b.x0, to: b.x1, reversed: true, shade: FACE_SHADE.north, touches: (t) => Math.abs(t.y0 - b.y1) <= TOL, range: (t) => [t.x0, t.x1] },
    { axis: 'y', fixed: b.x0, from: b.y0, to: b.y1, reversed: true, shade: FACE_SHADE.west, touches: (t) => Math.abs(t.x1 - b.x0) <= TOL, range: (t) => [t.y0, t.y1] },
  ];
}

/**
 * Maille un îlot au pas s (pur : renvoie des tableaux typés, sans three).
 * @param {Box[]} boxes bâtiments de l'îlot
 * @param {number} step pas maximal de la grille des murs (m)
 * @returns {{positions: Float32Array, colors: Float32Array, specs: Float32Array,
 *            indices: Uint16Array | Uint32Array, vertexCount: number, triangleCount: number}}
 */
export function meshBlock(boxes, step) {
  if (boxes.length > 65535) throw new Error('Îlot trop grand : plus de 65 535 bâtiments');
  const w = createWriter(boxes, step);
  // Niveaux propres de chaque bâtiment : 0, AO_HEIGHT (si plus bas que le toit), pas ≤ s, toit.
  const rows = boxes.map((b) => splitRange(0, b.h, step, [AO_HEIGHT]));

  // Liste canonique des hauteurs de la ligne verticale (x, y) d'un mur du bâtiment n° owner,
  // commune à toutes les faces qui passent par cette ligne.
  const lineCache = new Map();
  const zLine = (px, py, owner) => {
    const inside = [];
    for (let i = 0; i < boxes.length; i++) {
      const c = boxes[i];
      if (px >= c.x0 - TOL && px <= c.x1 + TOL && py >= c.y0 - TOL && py <= c.y1 + TOL) inside.push(i);
    }
    if (inside.length === 1) return rows[owner]; // cas courant : ligne intérieure à un mur
    const key = `${px},${py}`;
    let all = lineCache.get(key);
    if (!all) {
      all = uniqueSorted(inside.flatMap((i) => rows[i]));
      lineCache.set(key, all);
    }
    const top = boxes[owner].h;
    const out = [];
    for (const z of all) {
      if (z > top + TOL) break;
      out.push(z);
    }
    return out;
  };

  boxes.forEach((b, bi) => {
    for (const face of wallFaces(b)) meshWall(w, boxes, bi, face, step, zLine);
    meshRoof(w, b, bi, step);
  });
  return w.finish();
}

/**
 * Vrai si des intervalles [lo, hi] couvrent entièrement [from, to].
 * @param {{lo: number, hi: number}[]} spans
 */
function covers(spans, from, to) {
  let reach = from;
  for (const s of [...spans].sort((a, b) => a.lo - b.lo)) {
    if (s.lo > reach + TOL) return false;
    reach = Math.max(reach, s.hi);
  }
  return reach >= to - TOL;
}

/** Un mur : lignes verticales, bandes « fermeture éclair », parties mitoyennes omises. */
function meshWall(w, boxes, bi, face, step, zLine) {
  const b = boxes[bi];
  // Voisins collés contre ce mur : coupures aux bords de leur contact, zones cachées.
  const hidden = [];
  const breaks = [];
  boxes.forEach((t, ti) => {
    if (ti === bi || !face.touches(t)) return;
    const [r0, r1] = face.range(t);
    const lo = Math.max(r0, face.from);
    const hi = Math.min(r1, face.to);
    if (hi - lo <= TOL) return;
    hidden.push({ lo, hi, h: t.h });
    breaks.push(lo, hi);
  });
  // Mur commun entièrement caché par des voisins au moins aussi hauts : rien à mailler.
  if (covers(hidden.filter((hd) => hd.h >= b.h - TOL), face.from, face.to)) return;

  const levels = splitRange(face.from, face.to, step, breaks);
  if (face.reversed) levels.reverse();
  const lines = levels.map((c) => {
    const px = face.axis === 'x' ? c : face.fixed;
    const py = face.axis === 'x' ? face.fixed : c;
    const zs = zLine(px, py, bi);
    const idx = zs.map((z) => w.vertex(px, py, z, bi, face.shade * ambientOcclusion(z)));
    return { c, zs, idx };
  });

  for (let k = 0; k + 1 < lines.length; k++) {
    const left = lines[k];
    const right = lines[k + 1];
    // Hauteur cachée par un voisin sur cette colonne (ses bords sont des lignes du mur,
    // et sa hauteur un niveau des deux lignes : aucun triangle n'est à cheval).
    const mid = (left.c + right.c) / 2;
    let cover = 0;
    for (const hd of hidden) if (mid > hd.lo && mid < hd.hi) cover = Math.max(cover, hd.h);
    zipperStrip(left.idx, left.zs, right.idx, right.zs, (i0, i1, i2) => {
      if (cover > 0 && (w.z(i0) + w.z(i1) + w.z(i2)) / 3 < cover - TOL) return;
      w.tri(i0, i1, i2);
    });
  }
}

/** Toit : grille grossière, triangles anti-horaires vus d'en haut. */
function meshRoof(w, b, bi, step) {
  const s = Math.max(step, ROOF_STEP);
  const xs = splitRange(b.x0, b.x1, s);
  const ys = splitRange(b.y0, b.y1, s);
  const shade = FACE_SHADE.roof * ambientOcclusion(b.h);
  const idx = [];
  for (const y of ys) for (const x of xs) idx.push(w.vertex(x, y, b.h, bi, shade));
  const nx = xs.length;
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = idx[j * nx + i];
      const bb = idx[j * nx + i + 1];
      const c = idx[(j + 1) * nx + i + 1];
      const d = idx[(j + 1) * nx + i];
      w.tri(a, bb, c);
      w.tri(a, c, d);
    }
  }
}

/**
 * Têtes de lampadaires : une boîte émissive par lampe, toutes dans une géométrie
 * (un seul appel de dessin). Pur : renvoie des tableaux typés.
 * @param {{x: number, y: number, height: number, temperature: number, intensity: number}[]} lamps
 */
export function meshLamps(lamps) {
  const positions = new Float32Array(lamps.length * 24 * 3);
  const emits = new Float32Array(lamps.length * 24 * 2);
  const count = lamps.length * 24;
  const indices = count <= 65535 ? new Uint16Array(lamps.length * 36) : new Uint32Array(lamps.length * 36);
  let v = 0;
  let t = 0;
  for (const lamp of lamps) {
    const row = blackbodyRow(lamp.temperature);
    const hs = LAMP_SIZE / 2;
    const x0 = lamp.x - hs;
    const x1 = lamp.x + hs;
    const y0 = lamp.y - hs;
    const y1 = lamp.y + hs;
    const z0 = lamp.height - LAMP_HEIGHT / 2;
    const z1 = lamp.height + LAMP_HEIGHT / 2;
    // Six faces, coins anti-horaires vus de dehors (repère du jeu).
    const quads = [
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], // sud
      [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // est
      [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], // nord
      [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], // ouest
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // dessus
      [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], // dessous
    ];
    for (const q of quads) {
      const base = v;
      for (const [x, y, z] of q) {
        positions[3 * v] = x;
        positions[3 * v + 1] = z;
        positions[3 * v + 2] = -y;
        emits[2 * v] = row;
        emits[2 * v + 1] = lamp.intensity;
        v++;
      }
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], t);
      t += 6;
    }
  }
  return { positions, emits, indices };
}

/* ------------------------------------------------------------------------- */
/* Décor statique fusionné dans les îlots                                     */
/* ------------------------------------------------------------------------- */
/*
 * Décor (render/decorLayout.js, render/decorMesher.js) : chaque objet est rattaché à l'îlot
 * du bâtiment le plus proche ; la géométrie du LOD k d'un îlot = murs (meshBlock) + décor de
 * l'îlot au même LOD, concaténés dans UN SEUL BufferGeometry (aucun appel de dessin en plus).
 * Les emprises du décor (houppiers compris) entrent dans la distance au plus proche, le
 * centre et le rayon du chunk. Un objet loin de tout bâtiment forme un chunk de décor seul.
 * Attribut aFacade (vec4 : style, u, z, W) : le décor écrit (0, 0, 0, 0) ; si meshBlock ne
 * fournit pas de tableau `facades`, la partie murs reçoit aussi des zéros (style 0 : aucun
 * motif) ; s'il en fournit un, il est recopié tel quel.
 */

/**
 * Concatène le maillage des murs et celui du décor (pur) : un seul jeu d'attributs, indices
 * décalés, aFacade nul là où les murs n'en fournissent pas.
 * @param {{positions: Float32Array, colors: Float32Array, specs: Float32Array,
 *          facades?: Float32Array, indices: Uint16Array | Uint32Array, vertexCount: number,
 *          triangleCount: number} | null} walls
 * @param {ReturnType<typeof meshDecor> | null} decor
 */
export function mergeChunkMeshes(walls, decor) {
  const parts = [walls, decor].filter((m) => m && m.vertexCount > 0);
  const vertexCount = parts.reduce((n, m) => n + m.vertexCount, 0);
  const indexCount = parts.reduce((n, m) => n + m.indices.length, 0);
  const positions = new Float32Array(3 * vertexCount);
  const colors = new Float32Array(3 * vertexCount);
  const specs = new Float32Array(3 * vertexCount);
  const facades = new Float32Array(4 * vertexCount);
  const indices = vertexCount <= 65535 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
  let v = 0;
  let t = 0;
  for (const m of parts) {
    positions.set(m.positions, 3 * v);
    colors.set(m.colors, 3 * v);
    specs.set(m.specs, 3 * v);
    if (m.facades) facades.set(m.facades, 4 * v);
    for (let k = 0; k < m.indices.length; k++) indices[t + k] = m.indices[k] + v;
    v += m.vertexCount;
    t += m.indices.length;
  }
  return {
    positions,
    colors,
    specs,
    facades,
    indices,
    vertexCount,
    triangleCount: indexCount / 3,
    wallTriangles: walls ? walls.triangleCount : 0,
    decorTriangles: decor ? decor.triangleCount : 0,
  };
}

/**
 * Style du décor (decorMesher) : matériaux de la palette en linéaire, ombrages des façades.
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette
 * @returns {import('./decorMesher.js').DecorStyle}
 */
export function decorStyle(palette) {
  const materials = {};
  for (const [name, c] of Object.entries(decorPaletteEntries(palette))) {
    materials[name] = { rgb: hexToLinearRgb(c.srgb), ir: c.ir, uv: c.uv };
  }
  return { materials, faceShade: FACE_SHADE, aoHeight: AO_HEIGHT, aoStrength: AO_STRENGTH };
}

/** Sphère englobante (repère Three) d'une boîte du jeu. */
function boundingSphere(center, radius) {
  return new Sphere(new Vector3(center.x, center.z, -center.y), radius);
}

/**
 * Un chunk (îlot) : emprise, distance au plus proche, LOD créés à la demande.
 * @param {string} id
 * @param {Box[]} boxes
 * @param {number[]} lodSteps
 * @param {import('./decorLayout.js').DecorItem[]} [decor] objets du décor rattachés à l'îlot
 * @param {import('./decorMesher.js').DecorStyle | null} [style] style du décor (decorStyle)
 */
function createChunk(id, boxes, lodSteps, decor = [], style = null) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  let hmax = 0;
  const rects = new Float64Array((boxes.length + decor.length) * 4);
  boxes.forEach((b, i) => {
    rects.set([b.x0, b.y0, b.x1, b.y1], 4 * i);
    xmin = Math.min(xmin, b.x0);
    ymin = Math.min(ymin, b.y0);
    xmax = Math.max(xmax, b.x1);
    ymax = Math.max(ymax, b.y1);
    hmax = Math.max(hmax, b.h);
  });
  // Emprises du décor (houppiers compris) : distance au plus proche, centre et rayon justes.
  decor.forEach((d, i) => {
    const e = d.extent;
    rects.set([e.x0, e.y0, e.x1, e.y1], 4 * (boxes.length + i));
    xmin = Math.min(xmin, e.x0);
    ymin = Math.min(ymin, e.y0);
    xmax = Math.max(xmax, e.x1);
    ymax = Math.max(ymax, e.y1);
    hmax = Math.max(hmax, d.height);
  });
  const center = { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2, z: hmax / 2 };
  const radius = Math.hypot((xmax - xmin) / 2, (ymax - ymin) / 2, hmax / 2);
  const cache = new Map();
  const levelOf = (k) => Math.min(Math.max(Math.round(k) || 0, 0), lodSteps.length - 1);

  return {
    id,
    center,
    radius,
    buildingCount: boxes.length,
    decorCount: decor.length,
    /**
     * Distance horizontale (m) du point (px, py) du jeu à l'emprise la plus proche
     * des bâtiments et du décor de l'îlot (0 à l'intérieur). Les murs partent du sol et
     * dépassent l'œil : c'est aussi la distance 3D depuis l'œil ; pour le décor (houppiers en
     * hauteur), c'est une borne basse : le LOD choisi n'est jamais trop grossier.
     */
    nearestDistance(px, py) {
      let best = Infinity;
      for (let i = 0; i < rects.length; i += 4) {
        const dx = Math.max(rects[i] - px, 0, px - rects[i + 2]);
        const dy = Math.max(rects[i + 1] - py, 0, py - rects[i + 3]);
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    },
    /**
     * Géométrie du LOD k (0 = la plus fine), créée au premier appel puis gardée.
     * @param {number} k
     * @returns {BufferGeometry}
     */
    lod(k) {
      const level = levelOf(k);
      let geometry = cache.get(level);
      if (!geometry) {
        const walls = boxes.length > 0 ? meshBlock(boxes, lodSteps[level]) : null;
        const props = decor.length > 0 && style ? meshDecor(decor, level, style) : null;
        const m = mergeChunkMeshes(walls, props);
        geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(m.positions, 3));
        geometry.setAttribute('color', new BufferAttribute(m.colors, 3));
        geometry.setAttribute('aSpec', new BufferAttribute(m.specs, 3));
        geometry.setAttribute('aFacade', new BufferAttribute(m.facades, 4));
        geometry.setIndex(new BufferAttribute(m.indices, 1));
        geometry.boundingSphere = boundingSphere(center, radius);
        geometry.name = `ilot:${id}:lod${level}`;
        geometry.userData = {
          chunk: id,
          lod: level,
          step: lodSteps[level],
          triangles: m.triangleCount,
          wallTriangles: m.wallTriangles,
          decorTriangles: m.decorTriangles,
        };
        cache.set(level, geometry);
      }
      return geometry;
    },
    /**
     * Libère la géométrie du LOD k (CPU et GPU) si elle existe ; un appel suivant à lod(k)
     * la remaille.
     * @param {number} k
     */
    release(k) {
      const level = levelOf(k);
      const geometry = cache.get(level);
      if (geometry) {
        geometry.dispose();
        cache.delete(level);
      }
    },
  };
}

/** Géométrie des lampadaires (null s'il n'y en a pas). */
function createEmitters(lamps) {
  if (lamps.length === 0) return null;
  const m = meshLamps(lamps);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(m.positions, 3));
  geometry.setAttribute('aEmit', new BufferAttribute(m.emits, 2));
  geometry.setIndex(new BufferAttribute(m.indices, 1));
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  let zmax = 0;
  for (const l of lamps) {
    xmin = Math.min(xmin, l.x);
    ymin = Math.min(ymin, l.y);
    xmax = Math.max(xmax, l.x);
    ymax = Math.max(ymax, l.y);
    zmax = Math.max(zmax, l.height);
  }
  const center = { x: (xmin + xmax) / 2, y: (ymin + ymax) / 2, z: zmax / 2 };
  geometry.boundingSphere = boundingSphere(center, Math.hypot((xmax - xmin) / 2, (ymax - ymin) / 2, zmax / 2) + LAMP_SIZE);
  geometry.name = 'lampadaires';
  geometry.userData = { lamps: lamps.length, triangles: lamps.length * 12 };
  return geometry;
}

/**
 * Construit la ville d'une scène.
 * @param {any} scene JSON de src/data/scenes/
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette src/data/palette.json
 * @param {{lodSteps?: number[], lengthUnit?: number,
 *          decor?: {enabled?: boolean, density?: number, small?: boolean} | false}} [options]
 *   pas des LOD (m), croissants ; unité de longueur L = 10·c de la partie (m), pour les
 *   longueurs de jeu de la scène (layout.expandScene ; défaut : réglage par défaut) ; réglage
 *   d'exécution du décor (layout.expandScene : `?decor=0`, profil « lite »)
 */
export function buildCity(scene, palette, { lodSteps = [...DEFAULT_LOD_STEPS], lengthUnit, decor } = {}) {
  if (!Array.isArray(lodSteps) || lodSteps.length === 0 || lodSteps.some((s, i) => !(s > 0) || (i > 0 && s < lodSteps[i - 1]))) {
    throw new Error(`lodSteps : pas positifs et croissants attendus (${lodSteps})`);
  }
  const layout = expandScene(scene, palette, {
    ...(lengthUnit === undefined ? {} : { lengthUnit }),
    ...(decor === undefined ? {} : { decor }),
  });
  const groups = new Map();
  const colorCache = new Map();
  for (const b of layout.buildings) {
    if (!colorCache.has(b.color)) colorCache.set(b.color, hexToLinearRgb(b.color));
    const f = footprint(b);
    const box = { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, h: b.height, rgb: colorCache.get(b.color), ir: b.ir, uv: b.uv };
    if (!groups.has(b.blockId)) groups.set(b.blockId, []);
    groups.get(b.blockId).push(box);
  }
  // Décor : par îlot de rattachement ; un blockId sans bâtiment fait un chunk de décor seul.
  const decorGroups = new Map();
  for (const d of layout.decor) {
    if (!decorGroups.has(d.blockId)) decorGroups.set(d.blockId, []);
    decorGroups.get(d.blockId).push(d);
    if (!groups.has(d.blockId)) groups.set(d.blockId, []);
  }
  const style = layout.decor.length > 0 ? decorStyle(palette) : null;
  const chunks = [...groups].map(([id, boxes]) => createChunk(id, boxes, lodSteps, decorGroups.get(id) ?? [], style));
  return {
    chunks,
    emitters: createEmitters(layout.lamps),
    streets: layout.streets,
    start: layout.start,
    visibility: layout.visibility,
    bounds: layout.bounds,
    buildings: layout.buildings, // emprises développées (ombres de streetMap.createStreetMap)
    decor: layout.decor, // objets du décor (decorLayout.js), déjà rattachés aux chunks
    lengthUnit: layout.lengthUnit,
  };
}
