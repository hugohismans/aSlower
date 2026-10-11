/**
 * Maillage du décor statique (render/decorLayout.js) : module pur (ni DOM, ni three).
 *
 * Chaque objet est un petit maillage « low-poly » à faces planes, fusionné par
 * render/cityMesher.js dans la géométrie de l'îlot auquel il est rattaché (aucun appel de
 * dessin en plus). Attributs IDENTIQUES à ceux des îlots (docs/interfaces.md) :
 * - position (repère Three : X = x, Y = z, Z = −y) ;
 * - color : réflectance r, g, b linéaire (entrées de src/data/palette.json, DECOR_MATERIALS) ;
 * - aSpec : (ir, uv, ombrage cuit) ; l'ombrage suit l'orientation de chaque face, avec la
 *   table FACE_SHADE des façades (soleil au sud-ouest, haut : `decorFaceShade`), le même
 *   assombrissement au pied (AO) et, pour les houppiers, un sous-bois plus sombre ;
 * - aFacade = (0, 0, 0, 0) : pas de motif de façade.
 * Faces orientées vers l'extérieur (élimination des faces arrière), triangles en éventail.
 *
 * La végétation garde son « red edge » : feuillage « vegetation » (ir 0,6, visible faible) ;
 * en fonçant, le Doppler ramène l'IR dans le visible et les platanes s'illuminent : c'est
 * physique et voulu. Teintes légèrement variées par arbre et par face.
 *
 * Niveaux de détail (même indice que les LOD des îlots) :
 * - LOD 0 : tout, grandes faces subdivisées au pas DECOR_STEP (1,5 m : l'aberration près de
 *   l'œil reste juste, comme les murs au pas le plus fin) ;
 * - LOD 1 : sans les petits objets (potelets, tables et chaises des terrasses) ;
 * - LOD 2 (loin) : arbres, kiosques, colonnes, fontaines et stores, simplifiés, seulement.
 */
import { createRandom, resolveColor } from './layout.js';

/** Pas maximal des grandes faces au LOD 0 (m). */
export const DECOR_STEP = 1.5;
/** Ombrage d'une face tournée vers le bas (dessous d'un houppier, d'un parasol, d'un store). */
export const DECOR_UNDERSIDE_SHADE = 0.5;
/** Assombrissement du bas des houppiers (sous-bois) : facteur au bas du houppier. */
export const CROWN_INNER_SHADE = 0.8;

/** Noms de la palette utilisés par le décor (cityMesher les résout en linéaire). */
export const DECOR_MATERIALS = Object.freeze([
  'vegetation',
  'ecorce',
  'ecorce-claire',
  'ecorce-olive',
  'fonte',
  'vert-wagon',
  'bois-banc',
  'pierre',
  'eau',
  'zinc',
  'rotin',
  'terre-cuite',
  'toile-rouge',
  'toile-verte',
  'toile-creme',
  'toile-bleue',
  'toile-jaune',
  'fleurs-rouges',
  'fleurs-roses',
  'fleurs-jaunes',
  'fleurs-blanches',
  'rouge',
  'orange',
  'jaune',
  'cyan',
  'bleu',
  'violet',
  'creme',
]);

/** Pseudo-hasard reproductible dans [0, 1[ d'un nombre (motifs d'écorce et de feuillage). */
const hash01 = (x) => {
  const v = Math.sin(x) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Entrées de la palette utilisées par le décor (DECOR_MATERIALS), en sRGB.
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette
 * @returns {Record<string, {srgb: string, ir: number, uv: number}>}
 */
export function decorPaletteEntries(palette) {
  const out = {};
  for (const name of DECOR_MATERIALS) out[name] = resolveColor(name, palette, 'décor');
  return out;
}

const BARK = ['ecorce', 'ecorce', 'ecorce-claire', 'ecorce-olive'];
const CANVAS = ['toile-rouge', 'toile-verte', 'toile-creme', 'toile-bleue', 'toile-jaune'];
const FLOWERS = ['fleurs-rouges', 'fleurs-roses', 'fleurs-jaunes', 'fleurs-blanches'];
const POSTERS = ['rouge', 'jaune', 'bleu', 'creme', 'orange', 'cyan', 'violet', 'toile-verte', 'creme'];

/**
 * @typedef {{rgb: number[], ir: number, uv: number}} DecorMaterial réflectances (rgb linéaire)
 * @typedef {object} DecorStyle
 * @property {Record<string, DecorMaterial>} materials entrées de DECOR_MATERIALS
 * @property {{roof: number, south: number, west: number, east: number, north: number}} faceShade
 *   ombrage par orientation (cityMesher.FACE_SHADE)
 * @property {number} aoHeight hauteur de l'assombrissement au pied (m) (cityMesher.AO_HEIGHT)
 * @property {number} aoStrength assombrissement au sol (cityMesher.AO_STRENGTH)
 */

/**
 * Ombrage cuit d'une face de normale unitaire (nx, ny, nz) (repère du jeu) : moyenne des
 * ombrages des façades (sud, ouest, est, nord) et du toit pondérée par les composantes de la
 * normale ; une face tournée vers le bas prend DECOR_UNDERSIDE_SHADE. Une face verticale
 * alignée sur les axes reçoit exactement l'ombrage d'une façade de même orientation.
 * @param {number} nx
 * @param {number} ny
 * @param {number} nz
 * @param {DecorStyle['faceShade']} table
 */
export function decorFaceShade(nx, ny, nz, table) {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const h = ax + ay;
  const horizontal = h > 0 ? (ax * (nx > 0 ? table.east : table.west) + ay * (ny > 0 ? table.north : table.south)) / h : 0;
  const up = Math.max(nz, 0);
  const down = Math.max(-nz, 0);
  const wh = Math.hypot(nx, ny);
  return (wh * horizontal + up * table.roof + down * DECOR_UNDERSIDE_SHADE) / (wh + up + down);
}

/* ------------------------------------------------------------------------- */
/* Constructeur de maillage                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Maillage en cours (repère du jeu) : faces planes convexes, sommets propres à chaque face.
 * @param {DecorStyle} style
 */
function createBuilder(style) {
  const pos = [];
  const col = [];
  const spec = [];
  const idx = [];
  let nv = 0;
  const ao = (z) => 1 - style.aoStrength * Math.max(0, 1 - z / style.aoHeight);

  return {
    /**
     * Face plane convexe (sommets dans l'ordre du contour, repère du jeu), orientée pour que
     * sa normale s'éloigne de `ref` (ou s'en approche si `inward`).
     * @param {number[][]} pts
     * @param {string} name matériau (DECOR_MATERIALS)
     * @param {{ref: number[], inward?: boolean, tint?: number[], shade?: (p: number[]) => number}} o
     */
    face(pts, name, o) {
      const m = style.materials[name];
      if (!m) throw new Error(`Décor : matériau « ${name} » absent de la palette`);
      // Normale de Newell.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const q = pts[(i + 1) % pts.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]);
        ny += (p[2] - q[2]) * (p[0] + q[0]);
        nz += (p[0] - q[0]) * (p[1] + q[1]);
        cx += p[0];
        cy += p[1];
        cz += p[2];
      }
      const ln = Math.hypot(nx, ny, nz);
      if (!(ln > 1e-12)) return; // face dégénérée
      nx /= ln;
      ny /= ln;
      nz /= ln;
      cx /= pts.length;
      cy /= pts.length;
      cz /= pts.length;
      const away = (cx - o.ref[0]) * nx + (cy - o.ref[1]) * ny + (cz - o.ref[2]) * nz;
      let list = pts;
      if ((away < 0) !== Boolean(o.inward)) {
        list = [...pts].reverse();
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const base = decorFaceShade(nx, ny, nz, style.faceShade);
      const t = o.tint ?? [1, 1, 1, 1];
      const r = m.rgb[0] * t[0];
      const g = m.rgb[1] * t[1];
      const b = m.rgb[2] * t[2];
      const ir = m.ir * (t[3] ?? 1);
      const first = nv;
      for (const p of list) {
        pos.push(p[0], p[1], p[2]);
        col.push(r, g, b);
        spec.push(ir, m.uv, base * ao(p[2]) * (o.shade ? o.shade(p) : 1));
        nv++;
      }
      for (let i = 1; i + 1 < list.length; i++) idx.push(first, first + i, first + i + 1);
    },

    /**
     * Quadrilatère plan p0 p1 p2 p3 subdivisé au pas `step` (grille bilinéaire).
     * @param {number[][]} q
     * @param {string} name
     * @param {Parameters<ReturnType<typeof createBuilder>['face']>[2]} o
     * @param {number} step
     */
    quad(q, name, o, step) {
      const [p0, p1, p2, p3] = q;
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const nu = Math.max(1, Math.ceil(Math.max(d(p0, p1), d(p3, p2)) / step - 1e-9));
      const nw = Math.max(1, Math.ceil(Math.max(d(p0, p3), d(p1, p2)) / step - 1e-9));
      if (nu === 1 && nw === 1) {
        this.face(q, name, o);
        return;
      }
      const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
      const at = (i, j) => lerp(lerp(p0, p1, i / nu), lerp(p3, p2, i / nu), j / nw);
      for (let j = 0; j < nw; j++) {
        for (let i = 0; i < nu; i++) this.face([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], name, o);
      }
    },

    finish() {
      const n = nv;
      const positions = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) {
        positions[3 * i] = pos[3 * i]; // X = x
        positions[3 * i + 1] = pos[3 * i + 2]; // Y = z
        positions[3 * i + 2] = -pos[3 * i + 1]; // Z = −y
      }
      return {
        positions,
        colors: new Float32Array(col),
        specs: new Float32Array(spec),
        facades: new Float32Array(4 * n), // (0, 0, 0, 0) : pas de motif
        indices: new Uint32Array(idx),
        vertexCount: n,
        triangleCount: idx.length / 3,
      };
    },
  };
}

/**
 * Repère local d'un objet : axe a selon le cap, axe b à sa gauche, z vers le haut.
 * @returns {(a: number, b: number, z: number) => number[]}
 */
function frameOf(x, y, cap) {
  const c = Math.cos(cap);
  const s = Math.sin(cap);
  return (a, b, z) => [x + a * c - b * s, y + a * s + b * c, z];
}

/**
 * Prisme (ou tronc de cône, ou cône) d'axe presque vertical, en repère local : anneaux
 * horizontaux de `sides` côtés entre (a0, b0, z0, r0) et (a1, b1, z1, r1), `segs` étages.
 * @param {ReturnType<typeof createBuilder>} B
 * @param {(a: number, b: number, z: number) => number[]} F
 * @param {{a0?: number, b0?: number, a1?: number, b1?: number, z0: number, z1: number,
 *          r0: number, r1: number, sides: number, segs?: number, rot?: number,
 *          mat: string | ((i: number, j: number) => string), tint?: number[],
 *          top?: boolean, bottom?: boolean, topMat?: string, bottomMat?: string}} p
 */
function prism(B, F, p) {
  const { z0, z1, r0, r1, sides } = p;
  const a0 = p.a0 ?? 0;
  const b0 = p.b0 ?? 0;
  const a1 = p.a1 ?? a0;
  const b1 = p.b1 ?? b0;
  const segs = p.segs ?? 1;
  const rot = p.rot ?? 0;
  const matOf = typeof p.mat === 'function' ? p.mat : () => /** @type {string} */ (p.mat);
  const ring = (s) => {
    const z = z0 + (z1 - z0) * s;
    const r = r0 + (r1 - r0) * s;
    const ca = a0 + (a1 - a0) * s;
    const cb = b0 + (b1 - b0) * s;
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const ang = rot + (2 * Math.PI * i) / sides;
      pts.push(F(ca + r * Math.cos(ang), cb + r * Math.sin(ang), z));
    }
    return { pts, center: F(ca, cb, z), r };
  };
  let lower = ring(0);
  for (let j = 0; j < segs; j++) {
    const upper = ring((j + 1) / segs);
    const ref = [(lower.center[0] + upper.center[0]) / 2, (lower.center[1] + upper.center[1]) / 2, (lower.center[2] + upper.center[2]) / 2];
    for (let i = 0; i < sides; i++) {
      const k = (i + 1) % sides;
      const pts = upper.r > 0 ? [lower.pts[i], lower.pts[k], upper.pts[k], upper.pts[i]] : [lower.pts[i], lower.pts[k], upper.center];
      if (lower.r <= 0) pts.splice(0, 2, lower.center);
      B.face(pts, matOf(i, j), { ref, tint: p.tint });
    }
    lower = upper;
  }
  if (p.top && r1 > 0) {
    const top = ring(1);
    B.face(top.pts, p.topMat ?? matOf(0, segs - 1), { ref: [top.center[0], top.center[1], top.center[2] - 1], tint: p.tint });
  }
  if (p.bottom && r0 > 0) {
    const bottom = ring(0);
    B.face(bottom.pts, p.bottomMat ?? matOf(0, 0), { ref: [bottom.center[0], bottom.center[1], bottom.center[2] + 1], tint: p.tint });
  }
}

/**
 * Boîte en repère local [a0, a1] × [b0, b1] × [z0, z1] ; faces subdivisées au pas `step`.
 * Le dessous n'est émis que si `bottom` (objet surélevé vu d'en dessous).
 * @param {ReturnType<typeof createBuilder>} B
 * @param {(a: number, b: number, z: number) => number[]} F
 * @param {string | ((face: string) => string)} mat
 * @param {{bottom?: boolean, top?: boolean, step?: number, tint?: number[]}} [o]
 */
function box(B, F, a0, a1, b0, b1, z0, z1, mat, o = {}) {
  const matOf = typeof mat === 'function' ? mat : () => mat;
  const ref = F((a0 + a1) / 2, (b0 + b1) / 2, (z0 + z1) / 2);
  const step = o.step ?? Infinity;
  const c = (a, b, z) => F(a, b, z);
  const faces = [
    ['sud', [c(a0, b0, z0), c(a1, b0, z0), c(a1, b0, z1), c(a0, b0, z1)]],
    ['est', [c(a1, b0, z0), c(a1, b1, z0), c(a1, b1, z1), c(a1, b0, z1)]],
    ['nord', [c(a1, b1, z0), c(a0, b1, z0), c(a0, b1, z1), c(a1, b1, z1)]],
    ['ouest', [c(a0, b1, z0), c(a0, b0, z0), c(a0, b0, z1), c(a0, b1, z1)]],
  ];
  if (o.top !== false) faces.push(['dessus', [c(a0, b0, z1), c(a1, b0, z1), c(a1, b1, z1), c(a0, b1, z1)]]);
  if (o.bottom) faces.push(['dessous', [c(a0, b1, z0), c(a1, b1, z0), c(a1, b0, z0), c(a0, b0, z0)]]);
  for (const [name, q] of faces) B.quad(q, matOf(name), { ref, tint: o.tint }, step);
}

/**
 * Houppier (ou massif) : ellipsoïde bosselé à faces planes, `seg` méridiens et `bands`
 * bandes de latitude (pôles compris) ; demi-axes ra, rb, et rzUp / rzDown au-dessus et
 * au-dessous du centre. Rayon déformé par des lobes lents et un bruit par sommet.
 * @param {ReturnType<typeof createBuilder>} B
 * @param {(a: number, b: number, z: number) => number[]} F
 * @param {{a: number, b: number, z: number, ra: number, rb: number, rzUp: number,
 *          rzDown: number, seg: number, bands: number, rand: () => number, bump?: number,
 *          mat: (face: number) => string, tint: (face: number) => number[],
 *          shade?: (p: number[]) => number}} p
 */
function blob(B, F, p) {
  const { seg, bands, rand } = p;
  const bump = p.bump ?? 0.12;
  const ph1 = rand() * 2 * Math.PI;
  const ph2 = rand() * 2 * Math.PI;
  // Rangées de sommets (sans les pôles) : latitude de −π/2 à π/2.
  const rows = [];
  for (let j = 1; j < bands; j++) {
    const lat = -Math.PI / 2 + (Math.PI * j) / bands;
    const row = [];
    for (let i = 0; i < seg; i++) {
      const lon = (2 * Math.PI * (i + (j % 2) * 0.5)) / seg;
      const k = 1 + bump * (0.6 * Math.sin(2 * lon + ph1) * Math.cos(lat) + 0.4 * Math.sin(3 * lon + ph2 + lat)) + bump * 0.5 * (rand() - 0.5);
      const rz = lat >= 0 ? p.rzUp : p.rzDown;
      row.push(F(p.a + p.ra * k * Math.cos(lat) * Math.cos(lon), p.b + p.rb * k * Math.cos(lat) * Math.sin(lon), p.z + rz * k * Math.sin(lat)));
    }
    rows.push(row);
  }
  const south = F(p.a, p.b, p.z - p.rzDown * (0.92 + 0.1 * rand()));
  const north = F(p.a, p.b, p.z + p.rzUp * (0.95 + 0.1 * rand()));
  const ref = F(p.a, p.b, p.z);
  let f = 0;
  const emit = (pts) => {
    B.face(pts, p.mat(f), { ref, tint: p.tint(f), shade: p.shade });
    f++;
  };
  const last = rows.length - 1;
  for (let i = 0; i < seg; i++) {
    const k = (i + 1) % seg;
    emit([south, rows[0][k], rows[0][i]]);
    emit([north, rows[last][i], rows[last][k]]);
  }
  // Bandes intermédiaires : rangées décalées d'un demi-pas en alternance (triangles).
  for (let j = 0; j < last; j++) {
    const lo = rows[j];
    const hi = rows[j + 1];
    const shift = j % 2 === 0; // la rangée du haut est décalée de +½ pas
    for (let i = 0; i < seg; i++) {
      const k = (i + 1) % seg;
      if (shift) {
        emit([lo[i], lo[k], hi[i]]);
        emit([hi[i], lo[k], hi[k]]);
      } else {
        emit([lo[i], lo[k], hi[k]]);
        emit([lo[i], hi[k], hi[i]]);
      }
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Objets                                                                     */
/* ------------------------------------------------------------------------- */

/** Platane : tronc écorce marbrée, maîtresses branches, houppier large et bosselé. */
function platane(B, it, lod) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  const size = 0.9 + 0.25 * rand();
  const rt = (0.22 + 0.06 * rand()) * size;
  const fork = 2.5 + 0.7 * rand();
  const lean = 0.15 + 0.2 * rand(); // vers la chaussée (b)
  const barkSeed = rand();
  const bark = (i, j) => BARK[Math.floor(hash01((i + 1) * 12.9898 + (j + 1) * 78.233 + barkSeed * 100) * BARK.length)];
  prism(B, F, { z0: 0, z1: fork, r0: rt * 1.2, r1: rt * 0.85, b1: lean, sides: [5, 4, 3][lod], segs: lod === 0 ? 2 : 1, mat: bark, rot: rand() });

  // Maîtresses branches (fourche) : visibles sous le houppier, de près.
  if (lod === 0) {
    const count = 3;
    const turn = rand() * 2 * Math.PI;
    for (let k = 0; k < count; k++) {
      const ang = turn + (2 * Math.PI * k) / count;
      const da = Math.cos(ang) * 1.3;
      const db = Math.sin(ang) * 0.9 + 0.5;
      prism(B, F, {
        a0: 0,
        b0: lean,
        z0: fork - 0.35,
        a1: da,
        b1: lean + db,
        z1: fork + 1.6 + 0.4 * rand(),
        r0: rt * 0.6,
        r1: rt * 0.3,
        sides: 3,
        mat: bark,
        rot: ang,
      });
    }
  }

  // Houppier : ellipsoïde large, base aplatie, décalé vers la chaussée, plus un lobe au sommet.
  const hue = rand() * 2 - 1;
  const light = 0.88 + 0.22 * rand();
  const irK = 0.92 + 0.14 * rand();
  const leafTint = (f) => {
    const k = light * (0.92 + 0.16 * hash01(f * 91.7 + hue * 13));
    return [k * (1 + 0.12 * hue), k, k * (1 - 0.18 * hue), irK];
  };
  // Au LOD 2 (sans lobe), le houppier unique reprend le volume du lobe.
  const far = lod === 2 ? 1.08 : 1;
  const ra = (3.2 + 0.5 * rand()) * size * far;
  const rb = (2.7 + 0.3 * rand()) * size * far;
  const rzDown = 1.4 * size;
  const rzUp = (2.4 + 0.4 * rand()) * size * (lod === 2 ? 1.3 : 1);
  const cz = fork + 0.45 + rzDown;
  const cb = lean + 0.55 + 0.3 * rand();
  const ca = (rand() - 0.5) * 0.5;
  const bottom = cz - rzDown;
  const top = cz + rzUp + 1.4 * size;
  const shade = (pt) => CROWN_INNER_SHADE + (1 - CROWN_INNER_SHADE) * Math.min(1, Math.max(0, (pt[2] - bottom) / (top - bottom)));
  const detail = [
    { seg: 8, bands: 4 },
    { seg: 7, bands: 3 },
    { seg: 5, bands: 3 },
  ][lod];
  blob(B, F, { a: ca, b: cb, z: cz, ra, rb, rzUp, rzDown, ...detail, rand, mat: () => 'vegetation', tint: leafTint, shade });
  if (lod < 2) {
    const side = rand() < 0.5 ? -1 : 1;
    blob(B, F, {
      a: ca + side * (0.7 + 0.4 * rand()),
      b: cb - 0.2,
      z: cz + rzUp * 0.55,
      ra: 2.1 * size,
      rb: 1.9 * size,
      rzUp: 1.5 * size,
      rzDown: 1.0 * size,
      seg: 5,
      bands: lod === 0 ? 3 : 2,
      rand,
      mat: () => 'vegetation',
      tint: (f) => leafTint(f + 101),
      shade,
    });
  }
}

/** Banc « Davioud » : assise et dossier à lattes de bois, pieds en fonte ; regarde vers b. */
function banc(B, it) {
  const F = frameOf(it.x, it.y, it.cap);
  // Assise et dossier (le dossier est du côté −b : le banc regarde vers +b).
  box(B, F, -0.9, 0.9, -0.22, 0.22, 0.4, 0.46, 'bois-banc', { bottom: true });
  box(B, F, -0.9, 0.9, -0.3, -0.24, 0.4, 0.86, 'bois-banc');
  for (const a of [-0.75, 0.75]) box(B, F, a - 0.04, a + 0.04, -0.22, 0.2, 0, 0.4, 'fonte');
}

/** Colonne Morris : socle, fût vert à bandeau d'affiches multicolores, corniche, dôme. */
function colonne(B, it, lod) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  const sides = 8;
  if (lod === 2) {
    const posters = POSTERS.map(() => POSTERS[Math.floor(rand() * POSTERS.length)]);
    prism(B, F, { z0: 0, z1: 2.9, r0: 0.62, r1: 0.6, sides: 5, mat: (i) => posters[i % posters.length] });
    prism(B, F, { z0: 2.9, z1: 3.6, r0: 0.66, r1: 0, sides: 5, mat: 'vert-wagon', bottom: true });
    return;
  }
  prism(B, F, { z0: 0, z1: 0.3, r0: 0.7, r1: 0.7, sides, mat: 'vert-wagon', top: true });
  prism(B, F, { z0: 0.3, z1: 0.55, r0: 0.6, r1: 0.6, sides, mat: 'vert-wagon' });
  const rows = lod === 0 ? 2 : 1;
  const posters = [];
  for (let k = 0; k < sides * rows; k++) posters.push(POSTERS[Math.floor(rand() * POSTERS.length)]);
  prism(B, F, { z0: 0.55, z1: 2.55, r0: 0.6, r1: 0.6, sides, segs: rows, mat: (i, j) => posters[j * sides + i] });
  prism(B, F, { z0: 2.55, z1: 2.8, r0: 0.6, r1: 0.6, sides, mat: 'vert-wagon' });
  prism(B, F, { z0: 2.8, z1: 2.98, r0: 0.74, r1: 0.74, sides, mat: 'vert-wagon', top: false, bottom: true });
  prism(B, F, { z0: 2.98, z1: 3.45, r0: 0.66, r1: 0.22, sides, mat: 'vert-wagon' });
  prism(B, F, { z0: 3.45, z1: 3.75, r0: 0.12, r1: 0, sides: 4, mat: 'vert-wagon' });
}

/** Kiosque à journaux : caisson vert, bandeau de journaux, auvent, toit en pavillon. */
function kiosque(B, it, lod) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  const step = lod === 0 ? DECOR_STEP : Infinity;
  const ha = 1.2;
  const hb = 0.8;
  if (lod === 2) {
    box(B, F, -ha, ha, -hb, hb, 0, 2.4, 'vert-wagon', { top: false });
    prism(B, F, { z0: 2.4, z1: 3, r0: 1.35 * Math.SQRT2, r1: 0, sides: 4, rot: Math.PI / 4, mat: 'zinc', bottom: true });
    return;
  }
  box(B, F, -ha, ha, -hb, hb, 0, 0.8, 'vert-wagon', { top: false, step });
  // Bandeau de journaux : panneaux de 0,6 m de couleurs variées, sur les quatre côtés.
  const papers = (n) => Array.from({ length: n }, () => POSTERS[Math.floor(rand() * POSTERS.length)]);
  const front = papers(4);
  const back = papers(4);
  const ends = papers(2);
  for (let i = 0; i < 4; i++) {
    const a0 = -ha + (2 * ha * i) / 4;
    const a1 = -ha + (2 * ha * (i + 1)) / 4;
    B.face([F(a0, hb, 0.8), F(a1, hb, 0.8), F(a1, hb, 2.0), F(a0, hb, 2.0)], front[i], { ref: F(0, 0, 1.4) });
    B.face([F(a0, -hb, 0.8), F(a1, -hb, 0.8), F(a1, -hb, 2.0), F(a0, -hb, 2.0)], back[i], { ref: F(0, 0, 1.4) });
  }
  for (const [s, k] of [[-1, 0], [1, 1]]) {
    B.face([F(s * ha, -hb, 0.8), F(s * ha, hb, 0.8), F(s * ha, hb, 2.0), F(s * ha, -hb, 2.0)], ends[k], { ref: F(0, 0, 1.4) });
  }
  box(B, F, -ha, ha, -hb, hb, 2.0, 2.3, 'vert-wagon', { top: false });
  box(B, F, -ha - 0.25, ha + 0.25, -hb - 0.25, hb + 0.25, 2.3, 2.45, 'vert-wagon', { bottom: true, top: false, step });
  prism(B, F, { z0: 2.45, z1: 3.0, r0: (ha + 0.25) * Math.SQRT2, r1: 0.25, sides: 4, rot: Math.PI / 4, mat: 'zinc', top: true });
  prism(B, F, { z0: 3.0, z1: 3.3, r0: 0.12, r1: 0, sides: 4, mat: 'vert-wagon' });
}

/** Table de terrasse : parasol de toile à pans alternés ; au LOD 0, table et deux chaises. */
function parasol(B, it, lod) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  if (lod === 0) {
    prism(B, F, { z0: 0, z1: 0.72, r0: 0.05, r1: 0.04, sides: 3, mat: 'fonte' });
    prism(B, F, { z0: 0.72, z1: 0.76, r0: 0.36, r1: 0.36, sides: 6, mat: 'pierre', top: true, bottom: true });
    for (const s of [-1, 1]) {
      const a = s * 0.62;
      box(B, F, a - 0.2, a + 0.2, -0.2, 0.2, 0.42, 0.47, 'rotin');
      prism(B, F, { a0: a, a1: a, z0: 0, z1: 0.42, r0: 0.04, r1: 0.04, sides: 3, mat: 'fonte' });
      const back = s > 0 ? [a + 0.17, a + 0.21] : [a - 0.21, a - 0.17];
      box(B, F, back[0], back[1], -0.2, 0.2, 0.47, 0.88, 'rotin');
    }
  }
  if (it.awning) return; // terrasse sous un store : pas de parasol
  prism(B, F, { z0: 0, z1: 2.15, r0: 0.03, r1: 0.03, sides: 3, mat: 'bois-banc' });
  const c1 = CANVAS[Math.floor(rand() * CANVAS.length)];
  let c2 = CANVAS[Math.floor(rand() * CANVAS.length)];
  if (c2 === c1) c2 = 'toile-creme';
  const striped = rand() < 0.6;
  const sides = 8;
  const mat = (i) => (striped && i % 2 === 1 ? c2 : c1);
  // Toile : cône de 1,1 m de rayon, fermé par un dessous plat (vu depuis la terrasse).
  prism(B, F, { z0: 2.15, z1: 2.55, r0: 1.1, r1: 0, sides, mat, rot: it.cap, bottom: true, bottomMat: c1 });
}

/** Store banne rayé contre la façade, au-dessus d'une terrasse (lambrequin compris). */
function store(B, it, lod) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  const half = (it.length ?? 4) / 2;
  const c1 = CANVAS[Math.floor(rand() * CANVAS.length)];
  const c2 = c1 === 'toile-creme' ? 'toile-rouge' : 'toile-creme';
  const depth = 1.25;
  const zWall = 3.1;
  const zFront = 2.6;
  const flap = 0.22;
  const thick = 0.04;
  // b = 0 contre la façade (b > 0 : vers la chaussée).
  const stripes = lod === 2 ? 1 : Math.max(2, Math.round((2 * half) / (lod === 0 ? 0.6 : 1.2)));
  const ref = F(0, depth / 2, (zWall + zFront) / 2 - 0.5);
  for (let i = 0; i < stripes; i++) {
    const a0 = -half + (2 * half * i) / stripes;
    const a1 = -half + (2 * half * (i + 1)) / stripes;
    const m = lod === 2 ? c1 : i % 2 === 0 ? c1 : c2;
    const top = [F(a0, 0.02, zWall), F(a1, 0.02, zWall), F(a1, depth, zFront), F(a0, depth, zFront)];
    B.face(top, m, { ref: F((a0 + a1) / 2, depth / 2, zFront) });
    const under = [F(a0, 0.02, zWall - thick), F(a1, 0.02, zWall - thick), F(a1, depth, zFront - thick), F(a0, depth, zFront - thick)];
    B.face(under, m, { ref: F((a0 + a1) / 2, depth / 2, zWall + 1) });
    const valance = [F(a0, depth, zFront), F(a1, depth, zFront), F(a1, depth, zFront - flap), F(a0, depth, zFront - flap)];
    B.face(valance, m, { ref });
  }
  if (lod === 2) return;
  for (const s of [-1, 1]) {
    B.face([F(s * half, 0.02, zWall), F(s * half, depth, zFront), F(s * half, depth, zFront - flap), F(s * half, 0.02, zWall - thick)], c1, { ref: F(0, depth / 2, zFront) });
  }
}

/** Jardinière fleurie : bac en terre cuite, massif de feuillage et de fleurs. */
function jardiniere(B, it) {
  const rand = createRandom(it.variant);
  const F = frameOf(it.x, it.y, it.cap);
  box(B, F, -0.7, 0.7, -0.25, 0.25, 0, 0.5, 'terre-cuite');
  const flower = FLOWERS[Math.floor(rand() * FLOWERS.length)];
  blob(B, F, {
    a: 0,
    b: 0,
    z: 0.5,
    ra: 0.72,
    rb: 0.3,
    rzUp: 0.38,
    rzDown: 0.05,
    seg: 8,
    bands: 3,
    rand,
    bump: 0.2,
    mat: (f) => (f % 3 === 0 ? 'vegetation' : flower),
    tint: () => [1, 1, 1, 1],
  });
}

/** Potelet en fonte, à tête ronde. */
function potelet(B, it) {
  const F = frameOf(it.x, it.y, it.cap);
  prism(B, F, { z0: 0, z1: 0.8, r0: 0.07, r1: 0.06, sides: 4, mat: 'fonte' });
  prism(B, F, { z0: 0.8, z1: 0.92, r0: 0.08, r1: 0, sides: 4, mat: 'fonte' });
}

/** Fontaine : bassin de pierre, eau, vasques superposées. */
function fontaine(B, it, lod) {
  const F = frameOf(it.x, it.y, it.cap);
  const R = it.radius ?? 3.2;
  const sides = lod === 2 ? 10 : 16;
  const rim = 0.3;
  const zRim = 0.55;
  const zWater = 0.4;
  const ri = R - rim;
  // Paroi extérieure, margelle (anneau), paroi intérieure tournée vers le centre.
  prism(B, F, { z0: 0, z1: zRim, r0: R, r1: R, sides, mat: 'pierre' });
  const ring = (r, z, i) => {
    const ang = (2 * Math.PI * i) / sides;
    return F(r * Math.cos(ang), r * Math.sin(ang), z);
  };
  for (let i = 0; i < sides; i++) {
    const k = (i + 1) % sides;
    B.face([ring(ri, zRim, i), ring(R, zRim, i), ring(R, zRim, k), ring(ri, zRim, k)], 'pierre', { ref: F(0, 0, 0) });
    B.face([ring(ri, zWater, i), ring(ri, zWater, k), ring(ri, zRim, k), ring(ri, zRim, i)], 'pierre', { ref: F(0, 0, zWater), inward: true });
  }
  // Eau : disque en anneaux concentriques (arêtes ≤ 1,5 m au LOD 0).
  const rings = lod === 0 ? Math.ceil(ri / DECOR_STEP) : 1;
  for (let j = 0; j < rings; j++) {
    const r0 = (ri * j) / rings;
    const r1 = (ri * (j + 1)) / rings;
    for (let i = 0; i < sides; i++) {
      const k = (i + 1) % sides;
      const pts = j === 0 ? [F(0, 0, zWater), ring(r1, zWater, i), ring(r1, zWater, k)] : [ring(r0, zWater, i), ring(r1, zWater, i), ring(r1, zWater, k), ring(r0, zWater, k)];
      B.face(pts, 'eau', { ref: F(0, 0, -1) });
    }
  }
  // Vasques.
  const s8 = lod === 2 ? 6 : 8;
  prism(B, F, { z0: zWater, z1: 1.3, r0: 0.45, r1: 0.35, sides: s8, mat: 'pierre' });
  prism(B, F, { z0: 1.3, z1: 1.6, r0: 0.35, r1: 1.25, sides: s8, mat: 'pierre', top: true, topMat: 'eau' });
  if (lod === 2) return;
  prism(B, F, { z0: 1.6, z1: 2.3, r0: 0.18, r1: 0.15, sides: 6, mat: 'pierre' });
  prism(B, F, { z0: 2.3, z1: 2.5, r0: 0.15, r1: 0.65, sides: s8, mat: 'pierre', top: true, topMat: 'eau' });
  prism(B, F, { z0: 2.5, z1: 2.95, r0: 0.1, r1: 0, sides: 6, mat: 'pierre' });
}

/** Objets dessinés à chaque LOD (les autres sont omis). */
const DRAWN = [
  null, // LOD 0 : tout
  new Set(['platane', 'banc', 'colonne', 'kiosque', 'parasol', 'store', 'jardiniere', 'fontaine']),
  new Set(['platane', 'colonne', 'kiosque', 'store', 'fontaine']),
];

const MESHERS = { platane, banc, colonne, kiosque, parasol, store, jardiniere, potelet, fontaine };

/**
 * Vrai si l'objet est dessiné au LOD donné.
 * @param {{kind: string}} item
 * @param {number} lod
 */
export function drawnAtLod(item, lod) {
  const set = DRAWN[Math.min(Math.max(lod, 0), DRAWN.length - 1)];
  return set === null || set.has(item.kind);
}

/**
 * Maille des objets du décor au LOD donné (pur : renvoie des tableaux typés).
 * @param {import('./decorLayout.js').DecorItem[]} items
 * @param {number} lod 0 (complet), 1 (sans petits objets) ou 2 (loin)
 * @param {DecorStyle} style matériaux résolus et ombrages (render/cityMesher.js)
 * @returns {{positions: Float32Array, colors: Float32Array, specs: Float32Array,
 *            facades: Float32Array, indices: Uint32Array, vertexCount: number,
 *            triangleCount: number}}
 */
export function meshDecor(items, lod, style) {
  const level = Math.min(Math.max(Math.round(lod) || 0, 0), 2);
  const B = createBuilder(style);
  for (const it of items) {
    if (!drawnAtLod(it, level)) continue;
    const mesher = MESHERS[it.kind];
    if (!mesher) throw new Error(`Décor : sorte « ${it.kind} » inconnue`);
    mesher(B, it, level);
  }
  return B.finish();
}
