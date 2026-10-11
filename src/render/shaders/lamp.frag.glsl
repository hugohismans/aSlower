// Lampes de porte : couleur perçue calculée par le CPU (uLampColor, sRGB linéaire, déjà
// décalée, projetée, exposée et compressée : voir lamp.vert.glsl), sans brouillard (objet clé
// du puzzle, exempté du brouillard comme dans la règle), puis sortie sRGB.
uniform vec3 uLampColor;

void main() {
  gl_FragColor = vec4(uLampColor, 1.0);
  #include <colorspace_fragment>
}
