/**
 * Passage du repère du jeu au repère Three.js.
 *
 * Repère du jeu : x vers l'est, y vers le nord, z vers le haut (mètres).
 * Repère Three.js : X = x, Y = z (haut), Z = −y (le nord est vers −Z, direction
 * de visée par défaut d'une caméra Three).
 */
import { Vector3 } from 'three';

/**
 * Point ou vecteur du jeu → nouveau Vector3 Three.
 * @param {number} x
 * @param {number} y
 * @param {number} [z]
 * @returns {Vector3}
 */
export function toThree(x, y, z = 0) {
  return new Vector3(x, z, -y);
}

/**
 * Comme toThree, mais écrit dans `target` (aucune allocation) et le renvoie.
 * @param {Vector3} target
 * @param {number} x
 * @param {number} y
 * @param {number} [z]
 * @returns {Vector3}
 */
export function toThreeInto(target, x, y, z = 0) {
  return target.set(x, z, -y);
}
