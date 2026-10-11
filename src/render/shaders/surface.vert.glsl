// Façades et décor statique : aberration par sommet, couleur Doppler par fragment.
// Attributs (render/cityMesher.js) : position (repère Three), color (réflectance r, g, b
// linéaire), aSpec = (ir, uv, ombrage cuit ∈ [0, 1]).
#include <rel_vertex>

attribute vec3 aSpec;

varying highp vec3 vRel; // position relative à l'œil, NON aberrée (Doppler et brouillard)
varying vec3 vReflect;   // réflectances r, g, b × ombrage
varying vec2 vIrUv;      // réflectances ir, uv × ombrage

void main() {
  highp vec3 rel = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  vRel = rel;
  // L'ombrage multiplie les 5 réflectances (M(D) est linéaire : c'est exact).
  vReflect = color * aSpec.z;
  vIrUv = aSpec.xy * aSpec.z;
  gl_Position = relProject(relAberrate(rel));
}
