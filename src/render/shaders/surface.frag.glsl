// Façades et décor statique : motif de façade (choix des réflectances), ombrage cuit,
// brouillard (avant Doppler), couleur Doppler par fragment (D depuis la direction monde
// interpolée, pas de taches de teinte entre sommets), projecteur, tone mapping, sortie sRGB.
#include <rel_fog>
#include <rel_doppler>
#include <rel_facade>

varying highp vec3 vRel;
varying vec3 vReflect;
varying vec2 vIrUv;
varying float vShade;
flat varying highp vec2 vFacade;
varying highp vec2 vFacadeUZ;

void main() {
  vec3 rgb = vReflect;
  vec2 irUv = vIrUv;
  relFacade(rgb, irUv, vFacade, vFacadeUZ);
  // L'ombrage multiplie les 5 réflectances (M(D) est linéaire : c'est exact).
  rgb *= vShade;
  irUv *= vShade;
  relApplyFog(rgb, irUv, length(vRel));
  highp float D = relDopplerFactor(vRel);
  gl_FragColor = vec4(relFinish(relSurfaceColor(rgb, irUv, D), D), 1.0);
  #include <colorspace_fragment>
}
