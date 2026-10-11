// Façades et décor statique : aberration par sommet, couleur Doppler par fragment.
// Attributs (render/cityMesher.js) : position (repère Three), color (réflectance r, g, b
// linéaire), aSpec = (ir, uv, ombrage cuit ∈ [0, 1]), aFacade = (style codé, u, z, W) du
// motif de façade (rel_facade.glsl ; absent : valeur par défaut du matériau, style 0).
#include <rel_vertex>

attribute vec3 aSpec;
attribute vec4 aFacade;

varying highp vec3 vRel;         // position relative à l'œil, NON aberrée (Doppler et brouillard)
varying vec3 vReflect;           // réflectances r, g, b
varying vec2 vIrUv;              // réflectances ir, uv
varying float vShade;            // ombrage cuit
flat varying highp vec2 vFacade; // (style codé, W) : constant par mur, transmis exactement
varying highp vec2 vFacadeUZ;    // (u, z) en mètres

void main() {
  highp vec3 rel = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  vRel = rel;
  vReflect = color;
  vIrUv = aSpec.xy;
  vShade = aSpec.z;
  vFacade = aFacade.xw;
  vFacadeUZ = aFacade.yz;
  gl_Position = relProject(relAberrate(rel));
}
