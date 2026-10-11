/**
 * Carte des rues du sol (Canvas2D → CanvasTexture), lue par la passe d'environnement.
 *
 * Le canevas couvre exactement `bounds` (repère du jeu) : la colonne 0 est x = xmin, la
 * ligne 0 est y = ymax (le nord en haut) ; avec flipY (défaut des CanvasTexture), la
 * coordonnée de texture v = (y − ymin)/(ymax − ymin), comme dans environment.frag.glsl.
 * Couleurs en sRGB (texture SRGBColorSpace : le GPU les décode en linéaire).
 * Brancher la texture avec uniforms.setStreetMap(texture, bounds).
 *
 * Contenu (géométrie : streetPlan.js, pur et testé) : dalles des îlots, trottoirs dallés,
 * bordures de pierre claire, caniveaux pavés, chaussées d'asphalte, places dallées de teinte
 * chaude (motif en éventail), passages piétons zébrés, lignes d'arrêt, ligne axiale en tirets,
 * pelouses et pieds d'arbres, ombres portées des bâtiments.
 *
 * Canal « végétation » (alpha) : fraction v du texel couverte de végétation, codée
 * alpha = 1 − v/2 (v = 0 : alpha 1, sol minéral ; pelouse : alpha 0,5 ; terre des pieds
 * d'arbres : v = TREE_PIT_VEGETATION). Pourquoi l'alpha plutôt qu'une seconde texture : la
 * passe d'environnement (plein écran) ne fait toujours qu'UNE lecture de texture, sans
 * mémoire de plus, et le masque a la même résolution que les couleurs (bords nets). Un
 * canevas stocke ses pixels en alpha prémultiplié sur 8 bits : alpha ≥ 0,5 ne perd qu'un bit
 * de couleur sur les pelouses ; WebGL les « déprémultiplie » à l'envoi (premultiplyAlpha
 * faux), et le filtrage traite alpha comme un canal linéaire (mélange des réflectances au
 * prorata de la surface, ce qui est juste). Le canal est écrit en DERNIER (composition
 * « destination-out ») : les ombres et tout ce qui est peint auparavant gardent alpha = 1.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import {
  CENTER_LINE,
  CURB_WIDTH,
  GUTTER_WIDTH,
  SIDEWALK_WIDTH,
  isPlaza,
  normalizeGreens,
  normalizeTreePits,
  planStreets,
} from './streetPlan.js';
import { SUN_DIRECTION } from './uniforms.js';

/** Résolution maximale (px par mètre), côté maximal (px) et nombre maximal de texels. */
const PX_PER_M_MAX = 2;
const SIDE_MAX = 4096;
const TEXELS_MAX = 2048 * 2048;

/** Fraction de végétation de la terre des pieds d'arbres (herbes, mousses). */
export const TREE_PIT_VEGETATION = 0.3;

const COLORS = Object.freeze({
  ground: '#8e8a82', // dalles et sol des îlots
  sidewalk: '#b2ada3', // dalles de pierre calcaire
  curb: '#d2cdc3', // bordure de granit clair
  gutter: '#76726b', // caniveau pavé
  asphalt: '#47484c',
  marking: '#e6e2d6',
  plaza: '#b49a7c', // dallage de grès chaud
  plazaBand: '#cdbfa8', // bandes de travertin
  earth: '#6b5945', // terre des pieds d'arbres
  lawn: '#4e8f3a', // pelouse (palette « vegetation » par défaut)
  shadow: 'rgba(0, 0, 0, 0.4)',
});

/**
 * Taille du canevas pour des bornes données : au plus PX_PER_M_MAX px/m, SIDE_MAX px de
 * côté et TEXELS_MAX texels (mémoire GPU bornée sur GSM).
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} bounds
 * @returns {{width: number, height: number}}
 */
export function streetMapSize(bounds) {
  const spanX = Math.max(bounds.xmax - bounds.xmin, 1);
  const spanY = Math.max(bounds.ymax - bounds.ymin, 1);
  const scale = Math.min(
    PX_PER_M_MAX,
    SIDE_MAX / Math.max(spanX, spanY),
    Math.sqrt(TEXELS_MAX / (spanX * spanY)),
  );
  return {
    width: Math.max(1, Math.min(SIDE_MAX, Math.round(spanX * scale))),
    height: Math.max(1, Math.min(SIDE_MAX, Math.round(spanY * scale))),
  };
}

/**
 * Dessine la carte des rues.
 * @param {{from: {x: number, y: number}, to: {x: number, y: number}, width: number}[]} streets
 *   segments de rue (repère du jeu ; largeur de la chaussée en m)
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} bounds
 * @param {{buildings?: {x: number, y: number, width: number, depth: number, height: number}[],
 *          sunDir?: {x: number, y: number, z: number},
 *          detail?: 'full' | 'lite' | 'off',
 *          vegetation?: {x: number, y: number, r: number}[],
 *          greens?: ({x: number, y: number}[] | number[][])[],
 *          lawnColor?: string}} [options]
 *   buildings : emprises (centre (x, y), largeur selon x, profondeur selon y) pour cuire leurs
 *   ombres portées ; sunDir : direction du soleil (repère du jeu, vers le soleil) ;
 *   detail : 'full' (défaut), 'lite' (sans motifs de dalles ni de pavés), 'off' (carte
 *   d'avant : trottoir, chaussée, tirets, ombres ; ni végétation ni marquages nouveaux) ;
 *   vegetation : pieds d'arbres, disques de terre de rayon r (m) ; greens : pelouses,
 *   polygones (sommets {x, y} ou [x, y], sens quelconque) ; lawnColor : couleur sRGB des
 *   pelouses (palette « vegetation ») — vegetation et greens sont facultatifs
 * @returns {CanvasTexture} `userData.bounds` = bornes couvertes, `userData.detail`
 */
export function createStreetMap(
  streets,
  bounds,
  { buildings = [], sunDir = SUN_DIRECTION, detail = 'full', vegetation = [], greens = [], lawnColor = COLORS.lawn } = {},
) {
  const { width, height } = streetMapSize(bounds);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

  // Repère du jeu → pixels : x vers la droite, y vers le haut (ligne 0 = ymax).
  const sx = width / (bounds.xmax - bounds.xmin);
  const sy = height / (bounds.ymax - bounds.ymin);
  ctx.setTransform(sx, 0, 0, -sy, -bounds.xmin * sx, bounds.ymax * sy);

  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(bounds.xmin, bounds.ymin, bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin);

  if (detail === 'off') drawPlainStreets(ctx, streets);
  else drawDetailedStreets(ctx, streets, { patterns: detail !== 'lite', lawnColor, greens: normalizeGreens(greens), pits: normalizeTreePits(vegetation) });

  // Ombres portées des bâtiments (soleil fixe), par-dessus la chaussée.
  if (buildings.length > 0 && sunDir.z > 0.05) {
    ctx.fillStyle = COLORS.shadow;
    const shiftX = -sunDir.x / sunDir.z;
    const shiftY = -sunDir.y / sunDir.z;
    // Un seul chemin (enveloppes de même orientation) : les ombres qui se recouvrent ne
    // s'assombrissent pas deux fois.
    ctx.beginPath();
    for (const b of buildings) addPolygon(ctx, shadowPolygon(b, shiftX * b.height, shiftY * b.height));
    ctx.fill('nonzero');
  }

  // Canal végétation, en dernier (voir l'en-tête) : alpha = 1 − v/2.
  if (detail !== 'off') writeVegetation(ctx, normalizeGreens(greens), normalizeTreePits(vegetation));

  const texture = new CanvasTexture(canvas);
  texture.name = 'carte-des-rues';
  texture.colorSpace = SRGBColorSpace;
  texture.premultiplyAlpha = false; // alpha = canal végétation, pas une opacité
  texture.anisotropy = 8; // sol vu rasant depuis 1,6 m ; three borne au maximum du GPU
  texture.userData.bounds = { ...bounds };
  texture.userData.detail = detail;
  return texture;
}

/** Carte d'avant (`?solDetail=0`) : trottoirs, chaussées, ligne axiale continue en tirets. */
function drawPlainStreets(ctx, streets) {
  ctx.lineCap = 'square';
  strokeStreets(ctx, streets, COLORS.sidewalk, (s) => s.width + 2 * SIDEWALK_WIDTH);
  strokeStreets(ctx, streets, COLORS.asphalt, (s) => s.width);
  ctx.lineCap = 'butt';
  ctx.setLineDash([3, 6]);
  strokeStreets(ctx, streets, COLORS.marking, () => 0.2);
  ctx.setLineDash([]);
}

/**
 * Carte détaillée. Ordre : trottoirs, bordures, caniveaux, chaussées, places, marquages,
 * pelouses et pieds d'arbres. Chaque couche est tracée pour TOUTES les rues avant la
 * suivante : les carrefours restent propres (la bordure ne subsiste qu'au bord de l'union
 * des chaussées, le caniveau la suit).
 */
function drawDetailedStreets(ctx, streets, { patterns, lawnColor, greens, pits }) {
  const plan = planStreets(streets);
  const roads = streets.filter((s) => !isPlaza(s));
  const plazas = plan.plazas.map((i) => streets[i]);

  ctx.lineCap = 'square';
  strokeStreets(ctx, streets, (patterns && slabPattern(ctx)) || COLORS.sidewalk, (s) => s.width + 2 * SIDEWALK_WIDTH);
  strokeStreets(ctx, streets, COLORS.curb, (s) => s.width + 2 * CURB_WIDTH);
  strokeStreets(ctx, streets, COLORS.gutter, (s) => s.width);
  strokeStreets(ctx, roads, COLORS.asphalt, (s) => s.width - 2 * GUTTER_WIDTH);
  for (const plaza of plazas) {
    strokeStreets(ctx, [plaza], (patterns && plazaPattern(ctx, plaza)) || COLORS.plaza, (s) => s.width);
  }

  // Marquages : zébras et lignes d'arrêt (pleins), ligne axiale (tirets).
  ctx.fillStyle = COLORS.marking;
  ctx.beginPath();
  for (const cw of plan.crosswalks) for (const bar of cw.bars) addPolygon(ctx, bar);
  ctx.fill('nonzero');
  ctx.lineCap = 'butt';
  ctx.strokeStyle = COLORS.marking;
  for (const line of plan.stopLines) strokeLine(ctx, line);
  ctx.setLineDash([CENTER_LINE.dash, CENTER_LINE.space]);
  for (const line of plan.centerLines) strokeLine(ctx, line);
  ctx.setLineDash([]);

  // Pelouses, puis terre des pieds d'arbres (couleurs ; leur végétation est écrite à la fin).
  if (greens.length > 0) {
    ctx.fillStyle = lawnColor;
    ctx.beginPath();
    for (const g of greens) addPolygon(ctx, g);
    ctx.fill('nonzero');
  }
  if (pits.length > 0) {
    ctx.fillStyle = COLORS.earth;
    ctx.beginPath();
    for (const p of pits) addCircle(ctx, p);
    ctx.fill('nonzero');
  }
}

/**
 * Écrit le canal végétation : composition « destination-out » d'opacité v/2, qui multiplie
 * alpha par (1 − v/2) sans toucher aux couleurs (déprémultipliées). Un chemin par niveau de
 * v : les formes qui se recouvrent ne comptent qu'une fois ; un pied d'arbre sur une pelouse
 * donne v ≈ 1,15, que le shader borne à 1.
 */
function writeVegetation(ctx, greens, pits) {
  if (greens.length === 0 && pits.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  if (greens.length > 0) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    for (const g of greens) addPolygon(ctx, g);
    ctx.fill('nonzero');
  }
  if (pits.length > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${TREE_PIT_VEGETATION / 2})`;
    ctx.beginPath();
    for (const p of pits) addCircle(ctx, p);
    ctx.fill('nonzero');
  }
  ctx.restore();
}

/** Générateur pseudo-aléatoire déterministe (mulberry32), pour les nuances des dalles. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Couleur « #rrggbb » éclaircie (f > 1) ou assombrie (f < 1). */
function shade(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  const c = (k) => Math.max(0, Math.min(255, Math.round(((v >> k) & 255) * f)));
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

/**
 * Motif répété en coordonnées du jeu : tuile de `meters` m de côté à `pxPerM` px/m, dessinée
 * par draw(tctx, px) (px = pixels de la tuile par mètre), puis ramenée à l'échelle du jeu.
 * null si le navigateur ne sait pas transformer un motif.
 */
function gamePattern(ctx, meters, pxPerM, draw, origin = { x: 0, y: 0 }) {
  const size = Math.round(meters * pxPerM);
  const tile = document.createElement('canvas');
  tile.width = size;
  tile.height = size;
  const tctx = /** @type {CanvasRenderingContext2D} */ (tile.getContext('2d'));
  draw(tctx, pxPerM, size);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern || typeof pattern.setTransform !== 'function' || typeof DOMMatrix !== 'function') return null;
  pattern.setTransform(new DOMMatrix([1 / pxPerM, 0, 0, 1 / pxPerM, origin.x, origin.y]));
  return pattern;
}

/**
 * Trottoir dallé : dalles de 1,5 m × 1 m en rangées décalées, nuances de ± 4 % (aucun joint
 * peint : sous 0,5 m, il scintillerait). Tuile de 24 m : la répétition ne se voit pas.
 */
function slabPattern(ctx) {
  return gamePattern(ctx, 24, 2, (t, px, size) => {
    const rand = random(0x51ab);
    const slabL = 1.5;
    const slabW = 1;
    for (let row = 0; row * slabW < 24; row++) {
      const offset = (row % 2) * (slabL / 2);
      for (let col = -1; col * slabL < 24; col++) {
        t.fillStyle = shade(COLORS.sidewalk, 0.96 + 0.08 * rand());
        t.fillRect(Math.round((col * slabL + offset) * px), Math.round(row * slabW * px), Math.ceil(slabL * px), Math.ceil(slabW * px));
      }
    }
    void size;
  });
}

/**
 * Place : grès chaud posé en éventail (écailles de 2 m de rayon, deux anneaux de 1 m), dans un
 * quadrillage de bandes de travertin de 0,5 m tous les 8 m, centré sur la place.
 */
function plazaPattern(ctx, plaza) {
  const center = { x: (plaza.from.x + plaza.to.x) / 2, y: (plaza.from.y + plaza.to.y) / 2 };
  const cell = 8;
  const tileM = 4 * cell;
  const origin = { x: center.x - tileM / 2 - cell / 2, y: center.y - tileM / 2 - cell / 2 };
  return gamePattern(
    ctx,
    tileM,
    4,
    (t, px, size) => {
      const rand = random(0x91a2);
      t.fillStyle = COLORS.plaza;
      t.fillRect(0, 0, size, size);
      // Écailles : disques de rayon R en rangées tous les R (décalées d'un rayon une rangée
      // sur deux), chaque rangée posée sur la précédente : seuls les croissants restent vus.
      // Deux anneaux de 1 m (2 px de la carte) : le motif reste lisible sans scintiller.
      const R = 2;
      const rings = 2;
      for (let row = -1; row * R <= tileM + R; row++) {
        const shift = row % 2 === 0 ? 0 : R;
        for (let col = -1; col * 2 * R <= tileM + R; col++) {
          const base = 0.97 + 0.04 * rand();
          for (let k = 0; k < rings; k++) {
            t.fillStyle = shade(COLORS.plaza, base * (k % 2 === 0 ? 0.94 : 1));
            t.beginPath();
            t.arc((col * 2 * R + shift) * px, row * R * px, ((R * (rings - k)) / rings) * px, 0, 2 * Math.PI);
            t.fill();
          }
        }
      }
      // Bandes de travertin (bords de chaque case de 8 m).
      t.fillStyle = COLORS.plazaBand;
      const band = 0.5 * px;
      for (let k = 0; k <= tileM / cell; k++) {
        const p = k * cell * px - band / 2;
        t.fillRect(p, 0, band, size);
        t.fillRect(0, p, size, band);
      }
    },
    origin,
  );
}

/** Trace tous les segments de rue avec une couleur (ou un motif) et une largeur. */
function strokeStreets(ctx, streets, style, widthOf) {
  ctx.strokeStyle = style;
  for (const street of streets) {
    ctx.lineWidth = widthOf(street);
    ctx.beginPath();
    ctx.moveTo(street.from.x, street.from.y);
    ctx.lineTo(street.to.x, street.to.y);
    ctx.stroke();
  }
}

/** Trace un segment {from, to, width} avec le style de trait courant. */
function strokeLine(ctx, line) {
  ctx.lineWidth = line.width;
  ctx.beginPath();
  ctx.moveTo(line.from.x, line.from.y);
  ctx.lineTo(line.to.x, line.to.y);
  ctx.stroke();
}

/**
 * Ombre d'un bâtiment parallélépipédique : enveloppe convexe de son emprise et de l'emprise
 * décalée de (dx, dy) (projection du toit sur le sol).
 * @returns {{x: number, y: number}[]}
 */
function shadowPolygon(b, dx, dy) {
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const corners = [
    { x: b.x - hw, y: b.y - hd },
    { x: b.x + hw, y: b.y - hd },
    { x: b.x + hw, y: b.y + hd },
    { x: b.x - hw, y: b.y + hd },
  ];
  return convexHull([...corners, ...corners.map((p) => ({ x: p.x + dx, y: p.y + dy }))]);
}

/** Enveloppe convexe (chaîne monotone d'Andrew). */
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

function addPolygon(ctx, polygon) {
  polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

/** Disque (sens trigonométrique, comme les polygones normalisés). */
function addCircle(ctx, { x, y, r }) {
  ctx.moveTo(x + r, y);
  ctx.arc(x, y, r, 0, 2 * Math.PI, false);
  ctx.closePath();
}
