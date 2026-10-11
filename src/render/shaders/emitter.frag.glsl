// Lampadaires (corps noirs) : couleur = ligne de LUT du corps noir au facteur D
// (RGB(B(D·T))/D⁴, luminance 1 au repos) × intensité, puis projecteur D⁴ borné :
// un corps noir vu avec D est un corps noir de température D·T, sans compter deux fois D⁴.
#include <rel_fog>
#include <rel_doppler>

varying highp vec3 vRel;
varying vec2 vEmit;

void main() {
  highp float D = relDopplerFactor(vRel);
  vec3 lamp = relLutRow(D, floor(vEmit.x + 0.5)) * vEmit.y;
  // Brouillard : la lampe est atténuée et la brume éclairée par le soleil la remplace.
  float f = relFogFactor(length(vRel));
  vec3 c = mix(lamp, relSurfaceColor(uFogSpec, uFogIrUv, D), f);
  gl_FragColor = vec4(relFinish(c, D), 1.0);
  #include <colorspace_fragment>
}
