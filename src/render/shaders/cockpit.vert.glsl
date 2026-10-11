// Avant du véhicule (guidon de trottinette) : objet COMOBILE, attaché à la caméra, rendu sans
// effet relativiste. Attributs : position (repère de la caméra), color (linéaire), aShade.
//
// Ancrage au bas de l'écran : y = 0 du modèle est posé sur le bord inférieur du champ, à la
// profondeur de chaque sommet (y_bord = −d·tan(vFOV/2) = z/P₁₁), quel que soit l'aspect.

attribute float aShade; // ombrage cuit ∈ [0, 1]

varying vec3 vColor;

void main() {
  vColor = color * aShade;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.y += mv.z / projectionMatrix[1][1];
  gl_Position = projectionMatrix * mv;
}
