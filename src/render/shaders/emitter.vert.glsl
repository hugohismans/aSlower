// Lampadaires (corps noirs) : même aberration que le décor.
// Attributs : position (repère Three), aEmit = (ligne de LUT du corps noir, intensité).
#include <rel_vertex>

attribute vec2 aEmit;

varying highp vec3 vRel; // position relative à l'œil, non aberrée
varying vec2 vEmit;

void main() {
  highp vec3 rel = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  vRel = rel;
  vEmit = aEmit;
  gl_Position = relProject(relAberrate(rel));
}
