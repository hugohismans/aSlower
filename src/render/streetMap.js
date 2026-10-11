/**
 * Carte des rues du sol (Canvas2D → CanvasTexture), lue par la passe d'environnement.
 *
 * Le canevas couvre exactement `bounds` (repère du jeu) : la colonne 0 est x = xmin, la
 * ligne 0 est y = ymax (le nord en haut) ; avec flipY (défaut des CanvasTexture), la
 * coordonnée de texture v = (y − ymin)/(ymax − ymin), comme dans environment.frag.glsl.
 * Couleurs en sRGB (texture SRGBColorSpace : le GPU les décode en linéaire).
 * Brancher la texture avec uniforms.setStreetMap(texture, bounds).
 */
import { CanvasTexture, SRGBColorSpace } from 'three';
import { SUN_DIRECTION } from './uniforms.js';

/** Résolution maximale (px par mètre), côté maximal (px) et nombre maximal de texels. */
const PX_PER_M_MAX = 2;
const SIDE_MAX = 4096;
const TEXELS_MAX = 2048 * 2048;

/** Largeur du trottoir de chaque côté de la chaussée (m). */
const SIDEWALK_WIDTH = 3;

const COLORS = Object.freeze({
  ground: '#8e8a82', // dalles et sol des îlots
  sidewalk: '#b2ada3',
  asphalt: '#47484c',
  marking: '#e6e2d6',
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
 *          sunDir?: {x: number, y: number, z: number}}} [options] bâtiments (centre (x, y)
 *   de l'emprise, largeur selon x, profondeur selon y) pour cuire leurs ombres portées ;
 *   direction du soleil (repère du jeu, vers le soleil)
 * @returns {CanvasTexture} `userData.bounds` = bornes couvertes
 */
export function createStreetMap(streets, bounds, { buildings = [], sunDir = SUN_DIRECTION } = {}) {
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

  // Trottoirs, puis chaussées, puis marquages : les carrefours restent propres.
  ctx.lineCap = 'square';
  strokeStreets(ctx, streets, COLORS.sidewalk, (s) => s.width + 2 * SIDEWALK_WIDTH);
  strokeStreets(ctx, streets, COLORS.asphalt, (s) => s.width);
  ctx.lineCap = 'butt';
  ctx.setLineDash([3, 6]);
  strokeStreets(ctx, streets, COLORS.marking, () => 0.2);
  ctx.setLineDash([]);

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

  const texture = new CanvasTexture(canvas);
  texture.name = 'carte-des-rues';
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8; // sol vu rasant depuis 1,6 m ; three borne au maximum du GPU
  texture.userData.bounds = { ...bounds };
  return texture;
}

/** Trace tous les segments de rue avec une couleur et une largeur. */
function strokeStreets(ctx, streets, color, widthOf) {
  ctx.strokeStyle = color;
  for (const street of streets) {
    ctx.lineWidth = widthOf(street);
    ctx.beginPath();
    ctx.moveTo(street.from.x, street.from.y);
    ctx.lineTo(street.to.x, street.to.y);
    ctx.stroke();
  }
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
