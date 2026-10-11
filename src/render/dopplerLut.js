/**
 * Texture de la LUT Doppler (lignes 0..4 : colonnes de M(D) ; lignes suivantes : corps noirs).
 *
 * Données calculées en double précision par physics/spectrum.js (buildDopplerLutData),
 * envoyées au GPU en RGBA HalfFloat : filtrables en WebGL2 sans extension, contrairement
 * au float32 (OES_texture_float_linear, souvent absente sur Mali).
 * Lecture GPU (rel_doppler.glsl) : x = clamp((log₂ D + L)/(2L), 0, 1),
 * u = (x(N − 1) + 0,5)/N, v = (ligne + 0,5)/H ; D = 1 tombe au centre du texel central.
 */
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
} from 'three';
import { buildDopplerLutData } from '../physics/spectrum.js';

/**
 * Float → bits d'un half float, ARRONDI AU PLUS PROCHE (égalité : mantisse paire).
 * DataUtils.toHalfFloat tronque la mantisse ; on corrige d'un cran si le voisin
 * supérieur est plus proche, pour que le GPU reçoive exactement les valeurs que
 * spectrum.sampleLutLikeGpu suppose (arrondi au plus proche).
 * @param {number} value
 * @returns {number}
 */
export function toHalfFloatNearest(value) {
  const v = Math.fround(value);
  const h = DataUtils.toHalfFloat(v);
  if (!Number.isFinite(v)) return h;
  const low = DataUtils.fromHalfFloat(h);
  if (low === v) return h;
  // En signe-magnitude, h + 1 est le half suivant en valeur absolue (même signe).
  const up = h + 1;
  const high = DataUtils.fromHalfFloat(up);
  const dLow = Math.abs(v - low);
  const dHigh = Math.abs(high - v);
  if (dHigh < dLow || (dHigh === dLow && (h & 1) === 1)) return up;
  return h;
}

/**
 * Crée la texture de la LUT Doppler.
 * Les données (half floats) restent attachées à `texture.image.data` : après une perte
 * de contexte WebGL, three les renvoie au GPU sans recalcul.
 * @param {Parameters<typeof buildDopplerLutData>[0]} [options] taille, plage, températures
 *   (valeurs par défaut de physics/constants.js)
 * @returns {DataTexture} `userData.lut = {width, height, log2Range}` (pour uLutParams)
 */
export function createDopplerLutTexture(options) {
  const lut = buildDopplerLutData(options);
  const half = new Uint16Array(lut.data.length);
  for (let i = 0; i < half.length; i++) half[i] = toHalfFloatNearest(lut.data[i]);

  const texture = new DataTexture(half, lut.width, lut.height, RGBAFormat, HalfFloatType);
  texture.name = 'lut-doppler';
  // r186 : DataTexture est en NearestFilter par défaut ; l'interpolation est indispensable.
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace; // ce sont des données, pas une image sRGB
  texture.flipY = false; // ligne 0 des données = v ≈ 0
  texture.unpackAlignment = 1;
  texture.userData.lut = { width: lut.width, height: lut.height, log2Range: lut.log2Range };
  texture.needsUpdate = true;
  return texture;
}
