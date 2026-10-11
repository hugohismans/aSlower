/**
 * Éléments des niveaux (jalon 3) dans le même pipeline relativiste que la ville (aberration et
 * retard par sommet, Doppler par fragment) :
 * - zones de retrait et de livraison : anneau lumineux au sol (rayon de la zone) et balise,
 *   colonne de lumière « corps noir » à côté du client (6 500 K pour une livraison, 2 700 K
 *   pour un retrait), matériau des lampadaires (attribut aEmit) ;
 * - clients : silhouette low poly (boîtes), matériau des façades ; visible seulement si le
 *   client est VU présent (état à t_e = t − d/c, game/rules.seenClientPresent, calculé par
 *   main.js) ;
 * - portes : deux battants qui coulissent dans les façades quand la porte est VUE ouverte
 *   (game/rules.seenDoorOpen, à t_e), un linteau et la lampe du capteur ;
 * - lampes de porte : couleur calculée par le CPU à chaque image par la MÊME chaîne que la
 *   règle (game/rules.perceivedLamp → spectrum.perceivedColor), passée dans l'uniforme
 *   uLampColor (shaders/lamp.*.glsl) : la couleur affichée est celle que juge la porte.
 *
 * Ce module ne connaît pas game/ (imports permis de render/) : main.js lui passe une vue
 * statique du niveau (createLevelObjects) puis, à chaque image, l'état vu (update).
 * Toutes les géométries sont dans le repère Three (X = x, Y = z, Z = −y), subdivisées pour
 * l'aberration (arêtes ≤ 1 m sur les grandes faces).
 */
import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { blackbodyRow } from '../physics/constants.js';
import { FACE_SHADE, hexToLinearRgb } from './cityMesher.js';
import { createClassicVariant, createLampMaterial } from './materials.js';

/** Largeur de l'anneau d'une zone (m) et hauteur au-dessus du sol (m). */
export const RING_WIDTH = 0.6;
export const RING_HEIGHT = 0.05;
/**
 * Balise d'une zone : colonne de lumière dressée à côté du client (sur le trottoir, jamais
 * autour du joueur qui s'arrête dans la zone) ; section (m), hauteur (m), intensités
 * (× corps noir de référence).
 */
export const BEACON_SIZE = 1.2;
export const BEACON_HEIGHT = 10;
export const BEACON_INTENSITY = 2.5;
export const RING_INTENSITY = 1.6;
/** Températures des balises (K, lignes de la LUT) : livraison, retrait. */
export const STOP_TEMPERATURES = Object.freeze({ livraison: 6500, retrait: 2700 });
/** Côté de la lentille d'une lampe de porte (m). */
export const LAMP_SIZE = 1.4;
/** Épaisseur des battants (m) ; durée de l'ouverture vue (s). */
export const DOOR_THICKNESS_VISUAL = 0.5;
export const DOOR_OPEN_S = 0.8;
/** Pas maximal de subdivision des boîtes (m). */
const STEP = 1;

/** Couleurs (sRGB) des éléments. */
const COLORS = Object.freeze({
  porte: { srgb: '#5B5866', ir: 0.25, uv: 0.15 },
  linteau: { srgb: '#F5C71A', ir: 0.45, uv: 0.12 },
  potence: { srgb: '#2E2C33', ir: 0.2, uv: 0.1 },
  jambes: { srgb: '#3B3946', ir: 0.2, uv: 0.1 },
  visage: { srgb: '#E0B48C', ir: 0.5, uv: 0.1 },
});
/** Vestes des clients (cycle). */
const COATS = Object.freeze(['#E8371E', '#3557E0', '#34B04A', '#8A3FD1', '#F28A1A', '#1FB5C9']);

/* ------------------------------------------------------------------------- */
/* Géométries (pures, repère du jeu → repère Three)                           */
/* ------------------------------------------------------------------------- */

/** Accumulateur de géométrie : positions (jeu), attributs par sommet, indices. */
function createBuilder() {
  const positions = [];
  const colors = [];
  const specs = [];
  const emits = [];
  const indices = [];
  let count = 0;
  return {
    /** Ajoute un sommet (x, y, z du jeu) ; attrs : {color, spec} ou {emit}. */
    vertex(x, y, z, attrs) {
      positions.push(x, z, -y);
      if (attrs.color) {
        colors.push(...attrs.color);
        specs.push(...attrs.spec);
      }
      if (attrs.emit) emits.push(...attrs.emit);
      return count++;
    },
    tri(a, b, c) {
      indices.push(a, b, c);
    },
    /** BufferGeometry (attributs selon ce qui a été donné). */
    build(name) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      if (colors.length) {
        geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
        geometry.setAttribute('aSpec', new BufferAttribute(new Float32Array(specs), 3));
      }
      if (emits.length) geometry.setAttribute('aEmit', new BufferAttribute(new Float32Array(emits), 2));
      geometry.setIndex(new BufferAttribute(count <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices), 1));
      geometry.computeBoundingSphere();
      geometry.name = name;
      return geometry;
    },
  };
}

/**
 * Faces d'une boîte du jeu [x0, x1] × [y0, y1] × [z0, z1], chacune en grille de pas ≤ step,
 * orientée vers l'extérieur (sens trigonométrique vu de dehors : u × v = normale).
 * @param {ReturnType<typeof createBuilder>} b
 * @param {(face: string) => any} attrsOf attributs par face ('est', 'ouest', 'nord', 'sud', 'haut', 'bas')
 * @param {string[]} [skip] faces omises
 */
function addBox(b, x0, y0, z0, x1, y1, z1, attrsOf, step = STEP, skip = []) {
  /** [nom, origine, u (longueur), v (longueur)] avec u × v = normale sortante. */
  const faces = [
    ['est', [x1, y0, z0], [0, y1 - y0, 0], [0, 0, z1 - z0]],
    ['ouest', [x0, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0]],
    ['nord', [x0, y1, z0], [0, 0, z1 - z0], [x1 - x0, 0, 0]],
    ['sud', [x0, y0, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0]],
    ['haut', [x0, y0, z1], [x1 - x0, 0, 0], [0, y1 - y0, 0]],
    ['bas', [x0, y0, z0], [0, y1 - y0, 0], [x1 - x0, 0, 0]],
  ];
  for (const [name, o, u, v] of faces) {
    if (skip.includes(name)) continue;
    const lu = Math.hypot(...u);
    const lv = Math.hypot(...v);
    const nu = Math.max(1, Math.ceil(lu / step - 1e-9));
    const nv = Math.max(1, Math.ceil(lv / step - 1e-9));
    const attrs = attrsOf(name);
    const base = [];
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const s = i / nu;
        const t = j / nv;
        base.push(b.vertex(o[0] + s * u[0] + t * v[0], o[1] + s * u[1] + t * v[1], o[2] + s * u[2] + t * v[2], attrs));
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base[j * (nu + 1) + i];
        const c = base[(j + 1) * (nu + 1) + i + 1];
        b.tri(a, base[j * (nu + 1) + i + 1], c);
        b.tri(a, c, base[(j + 1) * (nu + 1) + i]);
      }
    }
  }
}

/** Ombrage cuit par face (comme les façades de la ville). */
const SHADE = Object.freeze({
  est: FACE_SHADE.east,
  ouest: FACE_SHADE.west,
  nord: FACE_SHADE.north,
  sud: FACE_SHADE.south,
  haut: FACE_SHADE.roof,
  bas: 0.5,
});

/** Attributs de surface d'une couleur {srgb, ir, uv}, ombrés par face. */
function surfaceAttrs(color) {
  const rgb = hexToLinearRgb(color.srgb);
  return (face) => ({ color: rgb, spec: [color.ir, color.uv, SHADE[face] ?? 1] });
}

/**
 * Anneau lumineux au sol (corps noir) : couronne de rayons r ± width/2, à z = RING_HEIGHT.
 * @returns {BufferGeometry} attributs position et aEmit
 */
export function ringGeometry(cx, cy, radius, { width = RING_WIDTH, temperature = 6500, intensity = RING_INTENSITY } = {}) {
  const b = createBuilder();
  const emit = [blackbodyRow(temperature), intensity];
  const segments = Math.max(24, Math.ceil((2 * Math.PI * radius) / STEP));
  const r0 = Math.max(0.05, radius - width / 2);
  const r1 = radius + width / 2;
  const inner = [];
  const outer = [];
  for (let k = 0; k <= segments; k++) {
    const a = (2 * Math.PI * k) / segments;
    inner.push(b.vertex(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), RING_HEIGHT, { emit }));
    outer.push(b.vertex(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a), RING_HEIGHT, { emit }));
  }
  for (let k = 0; k < segments; k++) {
    // Vue de dessus (+z), sens trigonométrique.
    b.tri(inner[k], outer[k], outer[k + 1]);
    b.tri(inner[k], outer[k + 1], inner[k + 1]);
  }
  return b.build('zone:anneau');
}

/**
 * Balise : colonne de lumière (corps noir) au centre de la zone.
 * @returns {BufferGeometry} attributs position et aEmit
 */
export function beaconGeometry(cx, cy, { size = BEACON_SIZE, height = BEACON_HEIGHT, temperature = 6500, intensity = BEACON_INTENSITY } = {}) {
  const b = createBuilder();
  const emit = [blackbodyRow(temperature), intensity];
  const h = size / 2;
  addBox(b, cx - h, cy - h, 0, cx + h, cy + h, height, () => ({ emit }), STEP, ['bas']);
  return b.build('zone:balise');
}

/**
 * Client : silhouette low poly (jambes, veste, tête) debout en (x, y).
 * @param {string} coat couleur de la veste (sRGB « #rrggbb »)
 * @returns {BufferGeometry} attributs position, color, aSpec
 */
export function clientGeometry(x, y, coat) {
  const b = createBuilder();
  addBox(b, x - 0.2, y - 0.13, 0, x + 0.2, y + 0.13, 0.85, surfaceAttrs(COLORS.jambes), 0.5, ['bas']);
  addBox(b, x - 0.27, y - 0.17, 0.85, x + 0.27, y + 0.17, 1.55, surfaceAttrs({ srgb: coat, ir: 0.4, uv: 0.12 }), 0.5);
  addBox(b, x - 0.13, y - 0.13, 1.58, x + 0.13, y + 0.13, 1.84, surfaceAttrs(COLORS.visage), 0.5);
  return b.build('client');
}

/**
 * Porte : battant (moitié de la largeur, `side` −1 ou +1 depuis le centre), dans le repère
 * LOCAL de la porte (origine au centre au sol ; x en travers du passage, y le long).
 * @returns {BufferGeometry}
 */
export function doorLeafGeometry(width, height, side) {
  const b = createBuilder();
  const x0 = side < 0 ? -width / 2 : 0;
  const x1 = side < 0 ? 0 : width / 2;
  const t = DOOR_THICKNESS_VISUAL / 2;
  addBox(b, x0 + (side < 0 ? 0 : 0.05), -t, 0, x1 - (side < 0 ? 0.05 : 0), t, height, surfaceAttrs(COLORS.porte), STEP, ['bas']);
  return b.build('porte:battant');
}

/**
 * Linteau (au-dessus de la porte) et potence de la lampe, repère LOCAL de la porte.
 * @returns {BufferGeometry}
 */
export function doorFrameGeometry(width, height, lampZ) {
  const b = createBuilder();
  const t = DOOR_THICKNESS_VISUAL / 2 + 0.1;
  addBox(b, -width / 2, -t, height, width / 2, t, height + 0.4, surfaceAttrs(COLORS.linteau), STEP);
  const bottom = lampZ - LAMP_SIZE / 2;
  if (bottom > height + 0.4 + 0.05) addBox(b, -0.15, -0.15, height + 0.4, 0.15, 0.15, bottom, surfaceAttrs(COLORS.potence), 0.5, ['bas']);
  return b.build('porte:linteau');
}

/** Lentille de la lampe (cube de LAMP_SIZE), centrée en (x, y, z) du jeu. Position seule. */
export function lampGeometry(x, y, z, size = LAMP_SIZE) {
  const b = createBuilder();
  const h = size / 2;
  addBox(b, x - h, y - h, z - h, x + h, y + h, z + h, () => ({}), 0.35);
  return b.build('porte:lampe');
}

/**
 * Où placer un client : au bord de sa zone, du côté de la façade la plus proche (sans entrer
 * dans un bâtiment).
 * @param {{x: number, y: number, rayon: number}} stop
 * @param {{x: number, y: number, width: number, depth: number}[]} buildings
 * @param {number} [extra] distance au-delà du bord de la zone (m)
 * @returns {{x: number, y: number}}
 */
export function clientSpot(stop, buildings = [], extra = 1.5) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let best = { d: Infinity, dir: [1, 0] };
  for (const dir of dirs) {
    // Distance de la zone, le long de dir, à la première façade (rayon de recherche 60 m).
    let d = Infinity;
    for (const bld of buildings) {
      const hw = bld.width / 2;
      const hd = bld.depth / 2;
      if (dir[0] !== 0) {
        if (Math.abs(stop.y - bld.y) > hd) continue;
        const face = dir[0] > 0 ? bld.x - hw - stop.x : stop.x - (bld.x + hw);
        if (face >= 0 && face < d) d = face;
      } else {
        if (Math.abs(stop.x - bld.x) > hw) continue;
        const face = dir[1] > 0 ? bld.y - hd - stop.y : stop.y - (bld.y + hd);
        if (face >= 0 && face < d) d = face;
      }
    }
    if (d < best.d) best = { d, dir };
  }
  const reach = Number.isFinite(best.d) ? Math.min(stop.rayon + extra, Math.max(0, best.d - 0.8)) : stop.rayon + extra;
  return { x: stop.x + best.dir[0] * reach, y: stop.y + best.dir[1] * reach };
}

/* ------------------------------------------------------------------------- */
/* Objets du niveau                                                           */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {object} LevelView vue statique d'un niveau (main.js la tire de game/level.js)
 * @property {{key: string, kind: 'retrait' | 'livraison', x: number, y: number, rayon: number}[]} stops
 * @property {{id: string, x: number, y: number, capDegres: number, largeur: number,
 *            hauteur: number, lampZ: number}[]} doors
 * @property {{x: number, y: number, width: number, depth: number}[]} [buildings] emprises
 *   (placement des clients)
 */

/**
 * @typedef {object} LevelRenderState état VU à une image (main.js)
 * @property {Record<string, {active: boolean, present: boolean}>} stops par clé d'arrêt :
 *   active (arrêt à faire), present (client vu présent à t_e)
 * @property {Record<string, {open: boolean, lampRgb: number[]}>} doors par id : open (vue
 *   ouverte à t_e), lampRgb (couleur perçue finale, sRGB linéaire)
 */

/**
 * @param {LevelView} view
 * @param {{surface: {rel: import('three').Material, classic: import('three').Material},
 *          emitter: {rel: import('three').Material, classic: import('three').Material}}} materials
 *   matériaux partagés de la ville (façades, lampadaires) et leurs variantes « vision classique »
 */
export function createLevelObjects(view, materials) {
  const group = new Group();
  group.name = 'niveau';
  let classic = false;
  /** @type {{mesh: Mesh, kind: 'surface' | 'emitter' | 'lamp', rel?: any, classic?: any}[]} */
  const entries = [];

  function add(geometry, kind, { position = null, rotationY = 0, lamp = null } = {}) {
    const rel = kind === 'lamp' ? lamp.rel : materials[kind].rel;
    const mesh = new Mesh(geometry, rel);
    mesh.frustumCulled = false; // l'aberration ramène devant ce qui est derrière
    if (position) {
      mesh.position.set(position[0], position[1], position[2]);
      mesh.rotation.y = rotationY;
    }
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.userData.r = 0;
    group.add(mesh);
    const entry = { mesh, kind, ...(lamp ?? {}) };
    entries.push(entry);
    return mesh;
  }

  const stops = new Map();
  view.stops.forEach((stop, i) => {
    const temperature = STOP_TEMPERATURES[stop.kind] ?? 6500;
    const ring = add(ringGeometry(stop.x, stop.y, stop.rayon, { temperature }), 'emitter');
    const spot = clientSpot(stop, view.buildings);
    const post = clientSpot(stop, view.buildings, 2.8);
    const beacon = add(beaconGeometry(post.x, post.y, { temperature }), 'emitter');
    const client = add(clientGeometry(spot.x, spot.y, COATS[i % COATS.length]), 'surface');
    ring.name = `zone:${stop.key}`;
    beacon.name = `balise:${stop.key}`;
    client.name = `client:${stop.key}`;
    stops.set(stop.key, { stop, ring, beacon, client });
  });

  const doors = new Map();
  for (const door of view.doors) {
    // Repère local : x en travers du passage. Passage nord-sud (90°, 270°) : la porte s'étend
    // le long de x du jeu ; passage est-ouest (0°, 180°) : le long de y (rotation de 90°).
    const across = Math.round(door.capDegres / 90) % 2 === 0 ? Math.PI / 2 : 0;
    const origin = [door.x, 0, -door.y];
    const left = add(doorLeafGeometry(door.largeur, door.hauteur, -1), 'surface', { position: origin, rotationY: across });
    const right = add(doorLeafGeometry(door.largeur, door.hauteur, 1), 'surface', { position: origin, rotationY: across });
    add(doorFrameGeometry(door.largeur, door.hauteur, door.lampZ), 'surface', { position: origin, rotationY: across });
    const relLamp = createLampMaterial();
    const classicLamp = createClassicVariant(relLamp); // mêmes uniformes (uLampColor compris)
    const lens = add(lampGeometry(door.x, door.y, door.lampZ), 'lamp', { lamp: { rel: relLamp, classic: classicLamp } });
    left.name = `porte:${door.id}:gauche`;
    right.name = `porte:${door.id}:droite`;
    lens.name = `lampe:${door.id}`;
    doors.set(door.id, { door, left, right, lens, material: relLamp, classicMaterial: classicLamp, across, open: 0 });
  }

  /** Place un battant : décalé de f × largeur/2 vers l'extérieur (dans les façades). */
  function placeLeaf(d, mesh, side) {
    const shift = side * d.open * (d.door.largeur / 2);
    // x local → monde : rotation de `across` autour de Y (Three).
    const ca = Math.cos(d.across);
    const sa = Math.sin(d.across);
    mesh.position.set(d.door.x + shift * ca, 0, -d.door.y - shift * sa);
    mesh.updateMatrix();
  }

  return {
    group,

    /** Matériaux propres (lampes) et leurs variantes, pour le préchauffage et la libération. */
    get ownMaterials() {
      const out = [];
      for (const d of doors.values()) out.push(d.material, d.classicMaterial);
      return out;
    },

    /** Bascule sur les variantes « vision classique » (même uniformes). */
    setClassic(on) {
      if (on === classic) return;
      classic = on;
      for (const e of entries) {
        if (e.kind === 'lamp') e.mesh.material = on ? e.classic : e.rel;
        else e.mesh.material = on ? materials[e.kind].classic : materials[e.kind].rel;
      }
    },

    /**
     * État vu de l'image : arrêts actifs, clients vus présents, portes vues ouvertes (battants
     * animés), couleurs des lampes ; distances de tri.
     * @param {LevelRenderState} state
     * @param {{x: number, y: number, z: number}} eye œil (repère du jeu)
     * @param {number} [dtReal] durée réelle de l'image (s), pour l'animation des battants
     */
    update(state, eye, dtReal = 0) {
      for (const [key, s] of stops) {
        const st = state.stops[key] ?? { active: false, present: false };
        s.ring.visible = st.active;
        s.beacon.visible = st.active;
        s.client.visible = st.active && st.present;
      }
      for (const [id, d] of doors) {
        const st = state.doors[id];
        if (!st) continue;
        const target = st.open ? 1 : 0;
        const step = dtReal > 0 ? dtReal / DOOR_OPEN_S : 1;
        const next = target > d.open ? Math.min(target, d.open + step) : Math.max(target, d.open - step);
        if (next !== d.open || dtReal === 0) {
          d.open = next;
          placeLeaf(d, d.left, -1);
          placeLeaf(d, d.right, 1);
        }
        const c = st.lampRgb;
        d.material.uniforms.uLampColor.value.set(c[0], c[1], c[2]);
      }
      // Distance de tri (cm entiers, comme les îlots) : centre de la géométrie à l'œil.
      for (const e of entries) {
        if (!e.mesh.visible) continue;
        const sphere = e.mesh.geometry.boundingSphere;
        const p = e.mesh.position;
        const cx = (sphere?.center.x ?? 0) + p.x;
        const cy = -((sphere?.center.z ?? 0) + p.z);
        const d = Math.max(0, Math.hypot(cx - eye.x, cy - eye.y) - (sphere?.radius ?? 0));
        e.mesh.userData.r = Math.round(d * 100);
      }
    },

    dispose() {
      for (const e of entries) e.mesh.geometry.dispose();
      for (const d of doors.values()) {
        d.material.dispose();
        d.classicMaterial.dispose();
      }
      group.clear();
    },
  };
}
