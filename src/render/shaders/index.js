/**
 * Sources GLSL du rendu relativiste et enregistrement des chunks `rel_*` dans
 * THREE.ShaderChunk (utilisables par `#include <rel_vertex>`, `<rel_doppler>`, `<rel_fog>`).
 *
 * Les fichiers .glsl sont importés tels quels (`?raw`) : leur texte complet, en-têtes de
 * licence `/*! … *\/` compris, reste dans le bundle publié. Les commentaires sont retirés
 * de la copie envoyée au pilote GLSL : ils contiennent des caractères non ASCII
 * (accents), que certains compilateurs mobiles acceptent mal.
 */
import { ShaderChunk } from 'three';
import relVertex from './rel_vertex.glsl?raw';
import relDoppler from './rel_doppler.glsl?raw';
import relFog from './rel_fog.glsl?raw';
import surfaceVert from './surface.vert.glsl?raw';
import surfaceFrag from './surface.frag.glsl?raw';
import emitterVert from './emitter.vert.glsl?raw';
import emitterFrag from './emitter.frag.glsl?raw';
import environmentVert from './environment.vert.glsl?raw';
import environmentFrag from './environment.frag.glsl?raw';
import cockpitVert from './cockpit.vert.glsl?raw';
import cockpitFrag from './cockpit.frag.glsl?raw';
import lampVert from './lamp.vert.glsl?raw';
import lampFrag from './lamp.frag.glsl?raw';

/**
 * Retire les commentaires GLSL en gardant les sauts de ligne (les numéros de ligne des
 * messages d'erreur du compilateur restent ceux des fichiers source).
 * @param {string} source
 * @returns {string}
 */
export function stripGlslComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '');
}

/** Textes source complets (avec commentaires), pour les tests et les Crédits. */
export const GLSL_SOURCES = Object.freeze({
  rel_vertex: relVertex,
  rel_doppler: relDoppler,
  rel_fog: relFog,
  'surface.vert': surfaceVert,
  'surface.frag': surfaceFrag,
  'emitter.vert': emitterVert,
  'emitter.frag': emitterFrag,
  'environment.vert': environmentVert,
  'environment.frag': environmentFrag,
  'cockpit.vert': cockpitVert,
  'cockpit.frag': cockpitFrag,
  'lamp.vert': lampVert,
  'lamp.frag': lampFrag,
});

/** Enregistre les chunks rel_* dans THREE.ShaderChunk (idempotent ; fait à l'import). */
export function registerShaderChunks() {
  for (const name of ['rel_vertex', 'rel_doppler', 'rel_fog']) {
    ShaderChunk[name] = stripGlslComments(GLSL_SOURCES[name]);
  }
}

registerShaderChunks();

/** Paire de shaders (sans commentaires) d'un matériau. */
function program(vertex, fragment) {
  return Object.freeze({
    vertexShader: stripGlslComments(vertex),
    fragmentShader: stripGlslComments(fragment),
  });
}

/** Shaders des matériaux (render/materials.js). */
export const SHADERS = Object.freeze({
  surface: program(surfaceVert, surfaceFrag),
  emitter: program(emitterVert, emitterFrag),
  environment: program(environmentVert, environmentFrag),
  cockpit: program(cockpitVert, cockpitFrag),
  lamp: program(lampVert, lampFrag),
});
