/**
 * Fabriques des matériaux relativistes (ShaderMaterial maison, non éclairés).
 *
 * Tous partagent l'objet REL (uniforms.js) PAR RÉFÉRENCE : `{...REL}` copie les références
 * des objets `{value}`, pas les valeurs. Ne jamais appeler `material.clone()`.
 * Sortie : renderer.toneMapping = NoToneMapping ; chaque shader fait son propre tone mapping
 * (identique à physics/spectrum.js) puis `#include <colorspace_fragment>` (sortie sRGB).
 *
 * Ordre de rendu (voir renderer.js, tri des opaques) : cockpit (renderOrder −1, écrit la
 * profondeur), décor trié par distance r, passe d'environnement (renderOrder 1).
 */
import {
  BufferGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  FrontSide,
  LessEqualDepth,
  Matrix3,
  Matrix4,
  Mesh,
  RGBAFormat,
  SRGBColorSpace,
  ShaderMaterial,
  Vector2,
  Vector3,
  UnsignedByteType,
} from 'three';
import { adaptationExposure } from '../physics/spectrum.js';
import { REL } from './uniforms.js';
import { createDopplerLutTexture } from './dopplerLut.js';
import { irUvPerLuminance } from './streetPlan.js';
import { SHADERS } from './shaders/index.js';

/** Réflectances ir et uv du sol, en fraction de sa luminance (asphalte, béton : spectre plat). */
const GROUND_IR_UV = Object.freeze([0.9, 0.5]);

/** Végétation par défaut (entrée « vegetation » de src/data/palette.json). */
const DEFAULT_VEGETATION = Object.freeze({ srgb: '#4E8F3A', ir: 0.6, uv: 0.05 });

/**
 * Pose les textures partagées manquantes : LUT Doppler (et ses paramètres) et, en
 * attendant la carte des rues, un sol gris uni.
 */
function ensureSharedTextures() {
  if (!REL.uLut.value) {
    const lut = createDopplerLutTexture();
    const { width, height, log2Range } = lut.userData.lut;
    REL.uLut.value = lut;
    REL.uLutParams.value.set(width, log2Range, height, 0);
    // Table d'adaptation (≈ 30 ms) construite au chargement, pas à la première accélération.
    adaptationExposure(2);
  }
  if (!REL.uStreetMap.value) {
    const ground = new DataTexture(new Uint8Array([110, 108, 104, 255]), 1, 1, RGBAFormat, UnsignedByteType);
    ground.colorSpace = SRGBColorSpace;
    ground.name = 'sol-uni';
    ground.needsUpdate = true;
    REL.uStreetMap.value = ground;
  }
}

/**
 * ShaderMaterial relativiste commun.
 * @param {string} name
 * @param {{vertexShader: string, fragmentShader: string}} shader
 * @param {Record<string, {value: any}>} [ownUniforms] uniformes propres au matériau
 * @param {object} [options] autres paramètres de ShaderMaterial
 */
function relMaterial(name, shader, ownUniforms = {}, options = {}) {
  ensureSharedTextures();
  return new ShaderMaterial({
    name,
    uniforms: { ...REL, ...ownUniforms },
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
    toneMapped: false,
    ...options,
  });
}

/**
 * Façades et sol maillé éventuel : attributs `color` (réflectance r, g, b linéaire) et
 * `aSpec` (ir, uv, ombrage). Faces avant seulement : le maillage doit être orienté vers
 * l'extérieur (sens trigonométrique vu de dehors). L'aberration conserve l'orientation.
 * Les meshes doivent avoir `frustumCulled = false` (l'aberration ramène devant ce qui est
 * derrière) et `userData.r` (distance à l'œil en cm, entière) pour le tri.
 * @returns {ShaderMaterial}
 */
export function createSurfaceMaterial() {
  return relMaterial('rel-surface', SHADERS.surface, {}, { vertexColors: true, side: FrontSide });
}

/**
 * Lampadaires corps noir : attribut `aEmit` = (ligne de LUT, intensité) ; deux faces.
 * @returns {ShaderMaterial}
 */
export function createEmitterMaterial() {
  return relMaterial('rel-emitter', SHADERS.emitter, {}, { side: DoubleSide });
}

/**
 * Lampe de porte (niveaux) : couleur perçue calculée par le CPU (uniforme `uLampColor`, sRGB
 * linéaire final : game/rules.perceivedLamp), même aberration que le décor, sans brouillard.
 * Un matériau par lampe (son uniforme propre) ; les uniformes partagés restent ceux de REL.
 * @returns {ShaderMaterial}
 */
export function createLampMaterial() {
  return relMaterial('rel-lampe', SHADERS.lamp, { uLampColor: { value: new Vector3(0, 0, 0) } }, { side: DoubleSide });
}

/**
 * Passe plein écran ciel + sol + brouillard. À dessiner avec renderOrder 1 sur un triangle
 * plein écran (voir createEnvironmentMesh). Ses uniformes de caméra (inverse de la
 * projection, rotation de la vue) sont mis à jour juste avant le dessin.
 * Sol : ir, uv = luminance de la carte des rues × rapport du sol minéral (uGroundIrUv) ou de la
 * végétation (uVegetationIrUv, selon le canal végétation de la carte : streetMap.js).
 * @param {{vegetation?: {srgb: string, ir?: number, uv?: number}}} [options] réflectances de
 *   la végétation (palette « vegetation »)
 * @returns {ShaderMaterial}
 */
export function createEnvironmentMaterial({ vegetation = DEFAULT_VEGETATION } = {}) {
  const vegetationIrUv = irUvPerLuminance(vegetation);
  const material = relMaterial(
    'rel-environment',
    SHADERS.environment,
    {
      uInvProjection: { value: new Matrix4() },
      uCameraRotation: { value: new Matrix3() },
      uGroundIrUv: { value: new Vector2(GROUND_IR_UV[0], GROUND_IR_UV[1]) },
      uVegetationIrUv: { value: new Vector2(vegetationIrUv[0], vegetationIrUv[1]) },
    },
    { depthWrite: false, depthTest: true, depthFunc: LessEqualDepth },
  );
  material.onBeforeRender = updateEnvironmentCamera;
  return material;
}

/**
 * Mesh de la passe d'environnement : triangle plein écran (−1, −1), (3, −1), (−1, 3),
 * renderOrder 1, jamais éliminé par le frustum culling.
 * @param {ShaderMaterial} [material] matériau d'environnement (ou sa variante classique)
 * @returns {Mesh}
 */
export function createEnvironmentMesh(material = createEnvironmentMaterial()) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const mesh = new Mesh(geometry, material);
  mesh.name = 'environnement';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Avant du véhicule : comobile, sans effet relativiste ; attributs `color` et `aShade`.
 * @returns {ShaderMaterial}
 */
export function createCockpitMaterial() {
  return relMaterial('rel-cockpit', SHADERS.cockpit, {}, { vertexColors: true, side: FrontSide });
}

/**
 * Même pipeline compilé sans effets relativistes (define REL_CLASSIC) : aberration
 * court-circuitée, D = 1, M = [I | 0], projecteur 1 ; brouillard, exposition et tone
 * mapping identiques. Partage le MÊME objet d'uniformes que `material` (pas de clone()).
 * @param {ShaderMaterial} material
 * @returns {ShaderMaterial}
 */
export function createClassicVariant(material) {
  const variant = new ShaderMaterial({
    name: `${material.name}-classique`,
    uniforms: material.uniforms,
    vertexShader: material.vertexShader,
    fragmentShader: material.fragmentShader,
    defines: { ...material.defines, REL_CLASSIC: '' },
    vertexColors: material.vertexColors,
    side: material.side,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
    depthFunc: material.depthFunc,
    transparent: material.transparent,
    toneMapped: false,
  });
  variant.onBeforeRender = material.onBeforeRender;
  variant.userData = { ...material.userData, classic: true };
  return variant;
}

/**
 * Uniformes de caméra de la passe d'environnement (appelé par three juste avant le dessin ;
 * `this` est le matériau). La rotation est celle de camera.matrixWorld (vue → monde).
 * @this {ShaderMaterial}
 * @param {import('three').WebGLRenderer} _renderer
 * @param {import('three').Scene} _scene
 * @param {import('three').Camera} camera
 */
function updateEnvironmentCamera(_renderer, _scene, camera) {
  this.uniforms.uInvProjection.value.copy(camera.projectionMatrixInverse);
  this.uniforms.uCameraRotation.value.setFromMatrix4(camera.matrixWorld);
}
