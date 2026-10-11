// Lampes de porte (raie ou corps noir, niveaux du jalon 3) : même aberration que le décor.
// La couleur n'est PAS calculée ici : le CPU la calcule à chaque image par la même chaîne
// que la règle de la porte (game/rules.perceivedLamp → physics/spectrum.perceivedColor :
// Doppler par la géométrie réelle, projecteur, exposition d'adaptation, tone mapping), et la
// passe dans l'uniforme uLampColor : la couleur affichée est exactement celle que juge la porte.
#include <rel_vertex>

void main() {
  highp vec3 rel = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
  gl_Position = relProject(relAberrate(rel));
}
