// Façades et décor statique : brouillard (avant Doppler), couleur Doppler par fragment
// (D depuis la direction monde interpolée, pas de taches de teinte entre sommets),
// projecteur, tone mapping, sortie sRGB.
#include <rel_fog>
#include <rel_doppler>

varying highp vec3 vRel;
varying vec3 vReflect;
varying vec2 vIrUv;

void main() {
  vec3 rgb = vReflect;
  vec2 irUv = vIrUv;
  relApplyFog(rgb, irUv, length(vRel));
  highp float D = relDopplerFactor(vRel);
  gl_FragColor = vec4(relFinish(relSurfaceColor(rgb, irUv, D), D), 1.0);
  #include <colorspace_fragment>
}
