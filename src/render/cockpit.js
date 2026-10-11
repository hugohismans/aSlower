/**
 * Avant du véhicule : guidon de trottinette low poly en bas de l'écran.
 *
 * Objet COMOBILE (il voyage avec le joueur) : rendu sans aberration ni Doppler, attaché à
 * la caméra (`camera.add(createCockpit())`, la caméra étant elle-même dans la scène).
 * Dessiné en premier (renderOrder −1) et écrit la profondeur : il masque le décor derrière
 * lui sans que celui-ci soit ombré (early-z). Un seul appel de dessin.
 *
 * Coordonnées des pièces : repère de la caméra (x à droite, z vers l'arrière), y compté
 * depuis le bord inférieur du champ (cockpit.vert.glsl ancre y = 0 sur ce bord).
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { createCockpitMaterial } from './materials.js';

/** Couleurs (sRGB linéaire). */
const COLORS = Object.freeze({
  frame: [0.045, 0.047, 0.05],
  rubber: [0.012, 0.012, 0.013],
  accent: [0.75, 0.22, 0.03], // orange du coursier
  screen: [0.02, 0.026, 0.032],
});

/** Lumière fixe du cockpit (repère de la caméra, vers la lumière) et ombrage. */
const LIGHT = new Vector3(-0.3, 1, 0.4).normalize();
const AMBIENT = 0.35;
const DIFFUSE = 0.65;

/**
 * Pièces : géométrie three, position, rotation (Euler, rad), couleur.
 * @returns {{geometry: BufferGeometry, position: number[], rotation?: number[], color: number[]}[]}
 */
function parts() {
  const bar = (radius, length) => new CylinderGeometry(radius, radius, length, 10, 1);
  const alongX = [0, 0, Math.PI / 2];
  // Colonne de direction : du collier du guidon vers le bas et l'avant, hors champ.
  const stemTop = new Vector3(0, 0.055, -0.505);
  const stemBottom = new Vector3(0, -0.3, -0.6);
  const stemAxis = new Vector3().subVectors(stemTop, stemBottom);
  const stemCenter = new Vector3().addVectors(stemTop, stemBottom).multiplyScalar(0.5);
  // Rotation autour de x qui amène l'axe du cylindre (+y) sur l'axe de la colonne.
  const stemTilt = Math.atan2(stemAxis.z, stemAxis.y);
  return [
    { geometry: bar(0.011, 0.4), position: [0, 0.065, -0.5], rotation: alongX, color: COLORS.frame },
    { geometry: bar(0.016, 0.09), position: [-0.175, 0.065, -0.5], rotation: alongX, color: COLORS.rubber },
    { geometry: bar(0.016, 0.09), position: [0.175, 0.065, -0.5], rotation: alongX, color: COLORS.rubber },
    {
      geometry: bar(0.019, stemAxis.length()),
      position: stemCenter.toArray(),
      rotation: [stemTilt, 0, 0],
      color: COLORS.frame,
    },
    { geometry: new BoxGeometry(0.05, 0.035, 0.05), position: [0, 0.065, -0.505], color: COLORS.accent },
    // Écran de navigation, incliné vers le conducteur.
    { geometry: new BoxGeometry(0.1, 0.008, 0.06), position: [0, 0.09, -0.485], rotation: [0.9, 0, 0], color: COLORS.screen },
    // Leviers de frein devant les poignées.
    { geometry: new BoxGeometry(0.075, 0.007, 0.012), position: [-0.15, 0.058, -0.535], rotation: [0, 0.12, 0], color: COLORS.frame },
    { geometry: new BoxGeometry(0.075, 0.007, 0.012), position: [0.15, 0.058, -0.535], rotation: [0, -0.12, 0], color: COLORS.frame },
  ];
}

/**
 * Assemble les pièces en une géométrie non indexée (position, color, aShade).
 * @returns {BufferGeometry}
 */
function buildCockpitGeometry() {
  const positions = [];
  const colors = [];
  const shades = [];
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const normal = new Vector3();
  for (const part of parts()) {
    const rotation = part.rotation ?? [0, 0, 0];
    quaternion.setFromEuler(new Euler(rotation[0], rotation[1], rotation[2]));
    matrix.compose(new Vector3(...part.position), quaternion, scale);
    const geometry = part.geometry.toNonIndexed();
    geometry.applyMatrix4(matrix);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      colors.push(...part.color);
      normal.fromBufferAttribute(nor, i);
      shades.push(AMBIENT + DIFFUSE * Math.max(0, normal.dot(LIGHT)));
    }
    geometry.dispose();
    part.geometry.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aShade', new Float32BufferAttribute(shades, 1));
  return geometry;
}

/**
 * Crée l'avant du véhicule, à attacher à la caméra.
 * @returns {Mesh}
 */
export function createCockpit() {
  const mesh = new Mesh(buildCockpitGeometry(), createCockpitMaterial());
  mesh.name = 'cockpit';
  mesh.renderOrder = -1;
  mesh.frustumCulled = false; // l'ancrage au bord de l'écran déplace les sommets dans le shader
  mesh.matrixAutoUpdate = false;
  return mesh;
}
