/**
 * Façades procédurales (module pur : ni DOM, ni three) : choix du style d'un bâtiment,
 * codage de l'attribut `aFacade` et constantes GLSL des matériaux de façade.
 *
 * Le motif (fenêtres, encadrements, volets, balcons, mansardes…) est dessiné par le shader
 * des surfaces (shaders/rel_facade.glsl) : il ne fait que CHOISIR, par fragment, les
 * réflectances (r, g, b, ir, uv) AVANT le brouillard et le Doppler (M(D) est linéaire : c'est
 * exact). La couleur de base du bâtiment (palette) reste celle du mur : elle sert à la
 * pédagogie du Doppler.
 *
 * Attribut `aFacade` (vec4) = (style, u, z, W) (docs/interfaces.md) :
 * - style : partie entière = style de façade (FACADE_STYLE ; 0 = pas de motif : toits, décor,
 *   murs mitoyens) ; partie fractionnaire = code du bâtiment (hauteur du toit au quart de
 *   mètre près et graine de variation), voir encodeFacade. Le shader le lit en `flat` : la
 *   valeur arrive exacte, sans interpolation ;
 * - u : abscisse le long du mur (m), depuis le bord gauche du mur vu de dehors ;
 * - z : hauteur (m) ;
 * - W : longueur totale du mur du bâtiment (m).
 */

/** Styles de façade (partie entière de aFacade.x). */
export const FACADE_STYLE = Object.freeze({
  /** Pas de motif. */
  aucun: 0,
  /** Paris : rez-de-chaussée haut, balcons filants, mansarde d'ardoise. */
  haussmannien: 1,
  /** Italie, Provence : enduit, volets, appuis clairs. */
  colore: 2,
  /** Europe du Nord : brique, joints, pierres d'angle, fenêtres à encadrement blanc. */
  brique: 3,
  /** Rez-de-chaussée commercial, enseignes colorées. */
  boutiques: 4,
});

/** Nombre de graines de variation par style (codées dans aFacade.x). */
export const FACADE_SEEDS = 32;
/** Pas de la hauteur codée (m). */
export const FACADE_HEIGHT_STEP = 0.25;
/** Hauteur codée maximale (m) : 2 047 pas. */
export const FACADE_HEIGHT_MAX = 2047 * FACADE_HEIGHT_STEP;
/** Dénominateur du code (partie fractionnaire de aFacade.x) : 2¹⁶. */
export const FACADE_CODE_SCALE = 65536;

/** Plus petite largeur d'emprise (m) d'un bâtiment à motif (panneaux, kiosques : sans motif). */
export const FACADE_MIN_SIZE = 4;
/** Hauteur minimale (m) d'un immeuble haussmannien (rez-de-chaussée, étage, mansarde). */
export const HAUSSMANN_MIN_HEIGHT = 12;

/**
 * Matériaux de façade : nom de la constante GLSL → entrée de src/data/palette.json.
 * Le shader reçoit FAC_<NOM> (r, g, b linéaire) et FAC_<NOM>_IU (ir, uv).
 */
export const FACADE_MATERIALS = Object.freeze({
  VERRE: 'facade-verre',
  PIERRE: 'facade-pierre',
  ARDOISE: 'facade-ardoise',
  FER: 'facade-fer',
  PORTE: 'facade-porte',
  VOLET_SAUGE: 'facade-volet-sauge',
  VOLET_GRIS: 'facade-volet-gris',
  ENSEIGNE_BORDEAUX: 'facade-enseigne-bordeaux',
  ENSEIGNE_VERTE: 'facade-enseigne-verte',
  ENSEIGNE_BLEUE: 'facade-enseigne-bleue',
});

/**
 * Graine d'une emprise (FNV-1a sur ses coordonnées) : même calcul que layout.hashSeed, sur un
 * texte qui ne dépend que de l'emprise (pas de l'ordre des bâtiments ni de la scène).
 * @param {{x0: number, y0: number, x1: number, y1: number}} f
 */
function footprintHash(f) {
  const text = `${f.x0},${f.y0},${f.x1},${f.y1}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Mélange final (les derniers caractères diffèrent peu d'un voisin à l'autre).
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Style et graine de façade d'un bâtiment, déterministes (hachage de son emprise).
 * - emprise plus étroite que FACADE_MIN_SIZE (panneaux IR/UV, kiosques) : aucun motif ;
 * - haussmannien (≈ 40 %) seulement à partir de HAUSSMANN_MIN_HEIGHT ; sinon coloré, brique
 *   ou boutiques.
 * @param {{x0: number, y0: number, x1: number, y1: number}} f emprise (repère du jeu)
 * @param {number} height hauteur (m)
 * @returns {{style: number, seed: number}}
 */
export function facadeStyle(f, height) {
  if (Math.min(f.x1 - f.x0, f.y1 - f.y0) < FACADE_MIN_SIZE) return { style: FACADE_STYLE.aucun, seed: 0 };
  const h = footprintHash(f);
  const seed = (h >>> 8) % FACADE_SEEDS;
  const r = (h & 0xff) / 256;
  let style;
  if (height >= HAUSSMANN_MIN_HEIGHT && r < 0.4) style = FACADE_STYLE.haussmannien;
  else {
    const k = height >= HAUSSMANN_MIN_HEIGHT ? (r - 0.4) / 0.6 : r;
    style = k < 0.4 ? FACADE_STYLE.colore : k < 0.7 ? FACADE_STYLE.boutiques : FACADE_STYLE.brique;
  }
  return { style, seed };
}

/**
 * Valeur de aFacade.x d'un mur : style + code/2¹⁶, code = 32·round(h/0,25) + graine.
 * Exacte en float32 (au plus 3 + 16 bits significatifs). Style 0 : 0 (pas de code).
 * @param {number} style FACADE_STYLE
 * @param {number} height hauteur du toit (m)
 * @param {number} seed graine (0 à FACADE_SEEDS − 1)
 */
export function encodeFacade(style, height, seed) {
  if (!(style >= 1)) return 0;
  const hq = Math.min(Math.max(Math.round(height / FACADE_HEIGHT_STEP), 0), 2047);
  const code = hq * FACADE_SEEDS + (Math.floor(seed) % FACADE_SEEDS);
  return Math.floor(style) + code / FACADE_CODE_SCALE;
}

/**
 * Inverse de encodeFacade (miroir du décodage GLSL de rel_facade.glsl).
 * @param {number} x aFacade.x
 * @returns {{style: number, height: number, seed: number}}
 */
export function decodeFacade(x) {
  const style = Math.floor(x);
  const code = Math.floor((x - style) * FACADE_CODE_SCALE + 0.5);
  const hq = Math.floor(code / FACADE_SEEDS);
  return { style, height: hq * FACADE_HEIGHT_STEP, seed: code - FACADE_SEEDS * hq };
}

/**
 * Composante sRGB (0..1) → linéaire (même formule que cityMesher.srgbToLinear ; ce module
 * pur n'importe pas cityMesher, qui dépend de three).
 * @param {number} c
 */
function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Réflectances d'un matériau de façade lues dans la palette.
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette
 * @param {string} name entrée de la palette
 * @returns {{rgb: [number, number, number], ir: number, uv: number}}
 */
export function facadeMaterial(palette, name) {
  const entry = palette[name];
  const m = entry && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(entry.srgb);
  if (!m || typeof entry.ir !== 'number' || typeof entry.uv !== 'number') {
    throw new Error(`Palette : matériau de façade « ${name} » absent ou incomplet (srgb, ir, uv)`);
  }
  const rgb = /** @type {[number, number, number]} */ ([1, 2, 3].map((i) => srgbToLinear(parseInt(m[i], 16) / 255)));
  return { rgb, ir: entry.ir, uv: entry.uv };
}

/** Nombre GLSL (toujours avec un point décimal). */
function glslFloat(v) {
  const s = Number(v.toFixed(6)).toString();
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * Constantes GLSL des matériaux de façade, générées depuis la palette au chargement (placées
 * avant le chunk rel_facade) : `const vec3 FAC_VERRE = vec3(r, g, b);` (linéaire) et
 * `const vec2 FAC_VERRE_IU = vec2(ir, uv);`. Texte ASCII, sans commentaire.
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette
 * @returns {string}
 */
export function facadeGlslConstants(palette) {
  const lines = [];
  for (const [constant, name] of Object.entries(FACADE_MATERIALS)) {
    const { rgb, ir, uv } = facadeMaterial(palette, name);
    lines.push(`const vec3 FAC_${constant} = vec3(${rgb.map(glslFloat).join(', ')});`);
    lines.push(`const vec2 FAC_${constant}_IU = vec2(${glslFloat(ir)}, ${glslFloat(uv)});`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Niveau de détail des façades : 0 = motifs coupés (`?facades=0`, mesures), 1 = simplifiés
 * (profil « lite » : fenêtres, encadrements, mansardes ; ni volets, ni balcons, ni joints),
 * 2 = complets. `?facades=0|1|2` dans l'URL impose le niveau ; sinon il suit le profil.
 * @param {string} search ex. location.search
 * @param {'default' | 'lite'} tier profil de qualité
 * @returns {0 | 1 | 2}
 */
export function facadeDetail(search, tier) {
  const raw = new URLSearchParams(search).get('facades');
  if (raw === '0' || raw === '1' || raw === '2') return /** @type {0 | 1 | 2} */ (Number(raw));
  return tier === 'lite' ? 1 : 2;
}
