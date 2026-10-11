// Avant du véhicule : comobile, donc ni aberration, ni Doppler, ni projecteur ; même
// exposition et même tone mapping que la ville, puis sortie sRGB.
#include <rel_doppler>

varying vec3 vColor;

void main() {
  gl_FragColor = vec4(relToneMap(vColor * uExposure, uKnee), 1.0);
  #include <colorspace_fragment>
}
