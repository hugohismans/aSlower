// Passe d'environnement (ciel, sol, brouillard) : triangle plein écran posé à z = 1
// (plan lointain), dessiné APRÈS les opaques avec depthFunc LessEqual et sans écriture de
// profondeur : seuls les pixels que rien n'a couverts sont ombrés.
// Géométrie : triangle (−1, −1), (3, −1), (−1, 3) en coordonnées normalisées (NDC).

uniform mat4 uInvProjection; // camera.projectionMatrixInverse
uniform mat3 uCameraRotation; // rotation de camera.matrixWorld (vue → monde)

varying highp vec3 vRay; // direction APPARENTE (référentiel du joueur, repère Three), non normée

void main() {
  // Point du plan lointain sous ce sommet, ramené au repère de la vue : sa composante w ne
  // dépend pas de (x, y) en perspective, donc la direction est affine sur l'écran et son
  // interpolation est exacte.
  vec4 view = uInvProjection * vec4(position.xy, 1.0, 1.0);
  vRay = uCameraRotation * (view.xyz / view.w);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
