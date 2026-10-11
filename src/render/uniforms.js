/**
 * Uniformes partagés par tous les matériaux relativistes.
 *
 * Chaque ShaderMaterial reçoit `{...REL}` (ou REL lui-même) : les objets `{value}` sont
 * partagés PAR RÉFÉRENCE, si bien qu'une seule mise à jour par image suffit pour tous
 * les matériaux. Ne jamais appeler `material.clone()` : three copierait les uniformes
 * (et ré-enverrait la LUT au GPU).
 *
 * Repère : Three.js (X = x, Y = z, Z = −y), voir coords.js.
 */
import { Vector2, Vector3, Vector4 } from 'three';
import {
  BEAM_EXPONENT,
  BEAM_MAX,
  EYE_HEIGHT,
  LUT_HEIGHT,
  LUT_LOG2_RANGE,
  LUT_SIZE,
  TONEMAP_KNEE,
  SKY_CLEAR_ROW,
  blackbodyRow,
} from '../physics/constants.js';
import { adaptationExposure } from '../physics/spectrum.js';

/**
 * Direction du soleil dans le repère du JEU (unitaire, vers le soleil) : sud-ouest,
 * 40° au-dessus de l'horizon. Sert au disque solaire et aux ombres de la carte des rues.
 */
export const SUN_DIRECTION = Object.freeze(sunDirection(225, 40));

/** Brume (5 canaux r, g, b, ir, uv) : air éclairé par le soleil, un peu bleuté, riche en UV. */
const FOG_REFLECTANCE = Object.freeze([0.55, 0.62, 0.72, 0.4, 0.8]);

/** Visibilité par défaut (m) avant l'appel de setVisibility par la scène. */
const DEFAULT_FOG_NEAR = 150;
const DEFAULT_FOG_FAR = 600;

/**
 * Uniformes partagés (voir docs/interfaces.md, « render/uniforms.js »).
 * - uBeta, uGamma, uG2 : observateur effectif (β_eff = kβ), calculés en double côté CPU ;
 * - uLut, uLutParams (N, L, H, 0) : LUT Doppler (posée par materials.js à la première fabrique) ;
 * - uBeamExp, uBeamMax, uKnee, uExposure : projecteur, tone mapping, exposition d'adaptation
 *   (calculée par updateObserver) ;
 * - uFogNear, uFogFar, uFogSpec (r, g, b), uFogIrUv (ir, uv) : brouillard en distance monde ;
 * - uEyeHeight, uStreetMap, uStreetBounds (xmin, ymin, xmax, ymax du jeu) : sol de la passe
 *   d'environnement ;
 * - uSunDir (repère Three), uSkyRow (ligne de LUT de la lumière du ciel), uSkyClearRow (ligne
 *   de LUT du ciel dégagé à spectre continu).
 */
export const REL = {
  uBeta: { value: new Vector3(0, 0, 0) },
  uGamma: { value: 1 },
  uG2: { value: 0.5 },
  uLut: { value: null },
  uLutParams: { value: new Vector4(LUT_SIZE, LUT_LOG2_RANGE, LUT_HEIGHT, 0) },
  uBeamExp: { value: BEAM_EXPONENT },
  uBeamMax: { value: BEAM_MAX },
  uKnee: { value: TONEMAP_KNEE },
  uExposure: { value: 1 },
  uFogNear: { value: DEFAULT_FOG_NEAR },
  uFogFar: { value: DEFAULT_FOG_FAR },
  uFogSpec: { value: new Vector3(FOG_REFLECTANCE[0], FOG_REFLECTANCE[1], FOG_REFLECTANCE[2]) },
  uFogIrUv: { value: new Vector2(FOG_REFLECTANCE[3], FOG_REFLECTANCE[4]) },
  uEyeHeight: { value: EYE_HEIGHT },
  uStreetMap: { value: null },
  uStreetBounds: { value: new Vector4(-1000, -1000, 1000, 1000) },
  uSunDir: { value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.z, -SUN_DIRECTION.y) },
  uSkyRow: { value: blackbodyRow(6500) },
  uSkyClearRow: { value: SKY_CLEAR_ROW },
};

/**
 * Met à jour l'observateur relativiste à partir de l'instantané du joueur.
 * - β monde = (vx, vy)/c, c = snapshot.c (vitesse de la lumière de la partie), passé au
 *   repère Three : (βx, 0, −βy) ;
 * - vision classique : β_eff = k·β, γ_eff = 1/√(1 − k²β²), uG2 = γ_eff²/(γ_eff + 1).
 * γ_eff est calculé en double précision sous la forme 1/√((1 − k²) + k²/γ²), qui évite
 * l'annulation de 1 − β² près de c (γ vient de la vitesse propre, sans perte).
 * - exposition : uExposure = adaptationExposure(D droit devant = γ_eff + √(γ_eff² − 1)),
 *   1 à l'arrêt et en vision classique (spectrum.js).
 * @param {{vx: number, vy: number, c: number, gamma?: number}} snapshot instantané de
 *   physics/player.js (c obligatoire : pas de vitesse de la lumière implicite)
 * @param {number} k 1 = relativiste, 0 = vision classique (borné à [0, 1])
 */
export function updateObserver(snapshot, k) {
  const c = snapshot.c;
  if (!(c > 0)) throw new RangeError(`updateObserver : snapshot.c (vitesse de la lumière) attendu (reçu : ${c})`);
  const kk = Math.min(Math.max(Number.isFinite(k) ? k : 1, 0), 1);
  const bx = snapshot.vx / c;
  const by = snapshot.vy / c;
  const gamma = snapshot.gamma ?? 1 / Math.sqrt(1 - (bx * bx + by * by));
  REL.uBeta.value.set(kk * bx, 0, -kk * by);
  const k2 = kk * kk;
  const gammaEff = 1 / Math.sqrt(1 - k2 + k2 / (gamma * gamma));
  REL.uGamma.value = gammaEff;
  REL.uG2.value = (gammaEff * gammaEff) / (gammaEff + 1);
  // Adaptation de l'œil au facteur Doppler droit devant, e^φ_eff = γ + √(γ² − 1).
  REL.uExposure.value = adaptationExposure(gammaEff + Math.sqrt(Math.max(0, gammaEff * gammaEff - 1)));
}

/**
 * Distances du brouillard (m, distance MONDE à l'œil) : début `near`, totalement opaque à
 * `far` (qui sert aussi de distance de coupe des chunks).
 * @param {number} near
 * @param {number} far
 */
export function setVisibility(near, far) {
  if (!(far > 0) || !(near >= 0) || !(near < far)) {
    throw new RangeError(`Visibilité invalide : near = ${near}, far = ${far}`);
  }
  REL.uFogNear.value = near;
  REL.uFogFar.value = far;
}

/**
 * Branche la carte des rues (streetMap.js) sur la passe d'environnement.
 * @param {import('three').Texture} texture
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} bounds repère du jeu
 */
export function setStreetMap(texture, bounds) {
  REL.uStreetMap.value = texture;
  REL.uStreetBounds.value.set(bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax);
}

/**
 * Vecteur unitaire du jeu vers une direction d'azimut (degrés, depuis +x vers +y) et
 * d'élévation (degrés au-dessus de l'horizon).
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 */
function sunDirection(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return { x: Math.cos(el) * Math.cos(az), y: Math.cos(el) * Math.sin(az), z: Math.sin(el) };
}
