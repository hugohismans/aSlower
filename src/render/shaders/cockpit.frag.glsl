// Avant du véhicule : comobile, donc ni aberration, ni Doppler, ni projecteur ; même tone
// mapping que la ville, puis sortie sRGB. Pas d'exposition d'adaptation (uExposure) : le
// cockpit est éclairé par la lumière projetée vers l'avant, dont l'éclairement croît avec
// la vitesse et compense l'adaptation de l'œil (sinon il devient noir à grande vitesse).
#include <rel_doppler>

varying vec3 vColor;

void main() {
  gl_FragColor = vec4(relToneMap(vColor, uKnee), 1.0);
  #include <colorspace_fragment>
}
