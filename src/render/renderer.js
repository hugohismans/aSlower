/**
 * WebGLRenderer du jeu (WebGL2) : création, redimensionnement, tri des opaques, perte et
 * restauration du contexte, préchauffage des programmes.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  NoToneMapping,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { resizeCamera } from './camera.js';
import { resolvePixelRatio } from './quality.js';

/**
 * Tri des opaques : renderOrder (cockpit −1, décor 0, environnement 1), puis distance r à
 * l'œil (`object.userData.r`, en cm, entière, posée par le culling) d'avant en arrière, pour
 * l'early-z. Le z de three viendrait de la géométrie non aberrée : il serait faux ici.
 * Résultat toujours −1, 0 ou 1 (pas de différence flottante, qui allouerait sous V8).
 * @param {{renderOrder: number, object: import('three').Object3D}} a
 * @param {{renderOrder: number, object: import('three').Object3D}} b
 */
export function opaqueSort(a, b) {
  if (a.renderOrder !== b.renderOrder) return a.renderOrder < b.renderOrder ? -1 : 1;
  const ra = a.object.userData.r ?? 0;
  const rb = b.object.userData.r ?? 0;
  return ra < rb ? -1 : ra > rb ? 1 : 0;
}

/**
 * Crée le renderer.
 * @param {HTMLCanvasElement} canvas
 * @param {import('./quality.js').Quality} quality
 * @returns {WebGLRenderer}
 */
export function createRenderer(canvas, quality) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    alpha: false,
    stencil: false,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    precision: 'highp',
  });
  // Chaque shader fait son tone mapping (identique à spectrum.toneMap) puis la sortie sRGB.
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setOpaqueSort(opaqueSort);
  renderer.setClearColor(0x000000, 1);
  resizeRenderer(renderer, quality);
  return renderer;
}

/**
 * Taille de la zone visible (px CSS) : visualViewport quand il existe (barres d'adresse
 * mobiles), sinon la fenêtre.
 * @returns {{width: number, height: number}}
 */
export function viewportSize() {
  const vv = window.visualViewport;
  const width = Math.round(vv ? vv.width : window.innerWidth);
  const height = Math.round(vv ? vv.height : window.innerHeight);
  return { width: Math.max(width, 1), height: Math.max(height, 1) };
}

/**
 * Ajuste le canevas à la zone visible, avec le DPR de la qualité (plafond de pixels), et la
 * caméra si elle est fournie.
 * @param {WebGLRenderer} renderer
 * @param {import('./quality.js').Quality} quality
 * @param {import('three').PerspectiveCamera | null} [camera]
 * @returns {{width: number, height: number, dpr: number}}
 */
export function resizeRenderer(renderer, quality, camera = null) {
  const { width, height } = viewportSize();
  const dpr = resolvePixelRatio(quality, width, height);
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, true);
  if (camera) resizeCamera(camera, width, height);
  return { width, height, dpr };
}

/**
 * Appelle `callback` quand la zone visible change (rotation, barres d'adresse, fenêtre).
 * @param {() => void} callback
 * @returns {() => void} désabonnement
 */
export function observeViewport(callback) {
  const vv = window.visualViewport;
  window.addEventListener('resize', callback);
  window.addEventListener('orientationchange', callback);
  vv?.addEventListener('resize', callback);
  return () => {
    window.removeEventListener('resize', callback);
    window.removeEventListener('orientationchange', callback);
    vv?.removeEventListener('resize', callback);
  };
}

/**
 * Perte et restauration du contexte WebGL. three réinitialise son état à la restauration ;
 * les tableaux CPU (géométries, LUT, carte des rues) sont conservés et renvoyés au GPU au
 * premier dessin. À la restauration, l'appelant refait warmup() avant de reprendre.
 * @param {WebGLRenderer} renderer
 * @param {{onLost?: (e: Event) => void, onRestored?: (e: Event) => void,
 *          onRestoreTimeout?: () => void, timeoutMs?: number}} callbacks
 *   onLost : mettre le jeu en pause ; onRestored : recompiler puis reprendre ;
 *   onRestoreTimeout : pas de restauration après timeoutMs (défaut 5 s) → proposer « Recharger ».
 * @returns {() => void} désabonnement
 */
export function watchContextLoss(renderer, { onLost, onRestored, onRestoreTimeout, timeoutMs = 5000 } = {}) {
  const canvas = renderer.domElement;
  let timer = 0;
  const lost = (event) => {
    event.preventDefault(); // indispensable pour que le navigateur restaure le contexte
    clearTimeout(timer);
    timer = setTimeout(() => onRestoreTimeout?.(), timeoutMs);
    onLost?.(event);
  };
  const restored = (event) => {
    clearTimeout(timer);
    onRestored?.(event);
  };
  canvas.addEventListener('webglcontextlost', lost, false);
  canvas.addEventListener('webglcontextrestored', restored, false);
  return () => {
    clearTimeout(timer);
    canvas.removeEventListener('webglcontextlost', lost, false);
    canvas.removeEventListener('webglcontextrestored', restored, false);
  };
}

/**
 * Préchauffage, derrière l'écran de chargement : compile tous les programmes de la scène
 * (en parallèle si KHR_parallel_shader_compile est là), puis 2 rendus. `extraMaterials`
 * (variantes « vision classique »…) sont attachés le temps du préchauffage à des triangles
 * dégénérés, invisibles.
 * @param {WebGLRenderer} renderer
 * @param {import('three').Scene} scene
 * @param {import('three').Camera} camera
 * @param {import('three').Material[]} [extraMaterials]
 * @returns {Promise<void>}
 */
export async function warmup(renderer, scene, camera, extraMaterials = []) {
  const extras = new Group();
  extras.name = 'prechauffage';
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3));
  for (const material of extraMaterials) {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    extras.add(mesh);
  }
  scene.add(extras);
  try {
    // compileAsync interroge KHR_parallel_shader_compile avec extensions.get(), qui écrit un
    // avertissement quand elle manque (SwiftShader, certains GSM) : compilation directe alors.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
  } finally {
    scene.remove(extras);
    geometry.dispose();
  }
}
