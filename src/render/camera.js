/**
 * Caméra première personne : œil à EYE_HEIGHT au-dessus de la chaussée, champ horizontal
 * de 90° en paysage (le champ vertical se déduit de l'aspect).
 *
 * La caméra porte l'avant du véhicule (cockpit.js) : l'ajouter à la scène
 * (`scene.add(camera)`) pour que ses enfants soient dessinés.
 */
import { MathUtils, PerspectiveCamera } from 'three';
import { EYE_HEIGHT } from '../physics/constants.js';

/** Champ horizontal en paysage (degrés). */
export const HORIZONTAL_FOV = 90;
/** Plan proche (m) : l'avant du véhicule est à ≈ 0,5 m de l'œil. */
export const CAMERA_NEAR = 0.1;
/** Marge du plan lointain au-delà de la visibilité (m) : un chunk gardé par la coupe à la
 * distance de visibilité peut dépasser cette distance de sa taille (îlot et hauteur). */
export const FAR_MARGIN = 250;

/**
 * Champ vertical (degrés) pour un aspect largeur/hauteur donné.
 * Paysage : hFOV fixé (90°) ; portrait (fenêtre étroite sur ordinateur) : vFOV = hFOV.
 * @param {number} aspect
 * @param {number} [horizontalFovDeg]
 */
export function verticalFov(aspect, horizontalFovDeg = HORIZONTAL_FOV) {
  if (!(aspect >= 1)) return horizontalFovDeg;
  const halfH = MathUtils.degToRad(horizontalFovDeg / 2);
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / aspect));
}

/**
 * @param {{aspect?: number, visibility?: number}} [options] visibilité = fin du brouillard (m)
 * @returns {PerspectiveCamera}
 */
export function createCamera({ aspect = 16 / 9, visibility = 600 } = {}) {
  const camera = new PerspectiveCamera(verticalFov(aspect), aspect, CAMERA_NEAR, visibility + FAR_MARGIN);
  camera.name = 'camera';
  camera.position.set(0, EYE_HEIGHT, 0);
  camera.updateMatrixWorld();
  return camera;
}

/**
 * Adapte aspect et champ vertical à la taille du canevas (px CSS).
 * @param {PerspectiveCamera} camera
 * @param {number} width
 * @param {number} height
 */
export function resizeCamera(camera, width, height) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  camera.aspect = aspect;
  camera.fov = verticalFov(aspect);
  camera.updateProjectionMatrix();
}

/**
 * Plan lointain ≥ visibilité + marge (appeler après setVisibility).
 * @param {PerspectiveCamera} camera
 * @param {number} visibility fin du brouillard (m)
 */
export function setCameraVisibility(camera, visibility) {
  camera.far = visibility + FAR_MARGIN;
  camera.updateProjectionMatrix();
}

/**
 * Place la caméra sur le joueur : position (x, EYE_HEIGHT, −y) et regard selon le cap.
 * Cap θ (depuis +x vers +y) → direction Three (cos θ, 0, −sin θ) : une caméra Three
 * regarde vers −Z, d'où une rotation de θ − π/2 autour de l'axe vertical.
 * @param {PerspectiveCamera} camera
 * @param {{x: number, y: number, heading: number}} snapshot instantané de physics/player.js
 */
export function updateCamera(camera, snapshot) {
  camera.position.set(snapshot.x, EYE_HEIGHT, -snapshot.y);
  camera.rotation.set(0, snapshot.heading - Math.PI / 2, 0);
  camera.updateMatrixWorld();
}
