/**
 * Élimination des îlots invisibles (module pur : ni DOM, ni three).
 *
 * Jalon 1 : coupe à la distance de visibilité. Elle est exacte : le shader garde la
 * distance monde r de chaque sommet (seule la direction est aberrée) et le
 * brouillard est totalement opaque à `visibilite` ; un îlot dont le point le plus
 * proche est au-delà ne contribue à aucun pixel, quelle que soit la vitesse.
 *
 * Le culling par frustum de three est désactivé (frustumCulled = false) : il
 * travaille avant l'aberration et ferait disparaître ce qui, derrière, revient
 * devant à grande vitesse. Le culling par « cône apparent » viendra au jalon 3.
 */

/**
 * Distance monde du point de l'îlot le plus proche de la caméra (m).
 * Utilise chunk.nearestDistance(x, y) (distance horizontale à l'emprise des
 * bâtiments, qui partent du sol : c'est aussi la distance 3D tant que l'œil est
 * sous les toits), sinon la sphère englobante.
 * @param {{nearestDistance?: (px: number, py: number) => number,
 *          center?: {x: number, y: number, z: number}, radius?: number}} chunk
 * @param {{x: number, y: number, z?: number}} camera position (repère du jeu)
 */
export function chunkDistance(chunk, camera) {
  if (typeof chunk.nearestDistance === 'function') return chunk.nearestDistance(camera.x, camera.y);
  const c = chunk.center;
  const d = Math.hypot(c.x - camera.x, c.y - camera.y, (c.z ?? 0) - (camera.z ?? 0));
  return Math.max(0, d - (chunk.radius ?? 0));
}

/**
 * Un îlot est visible si son point le plus proche est à moins de visibilityFar.
 * (Marge nulle : nearestDistance − 0 > visibilityFar → invisible.)
 * @param {Parameters<typeof chunkDistance>[0]} chunk
 * @param {{x: number, y: number, z?: number}} camera position (repère du jeu)
 * @param {number} visibilityFar distance où le brouillard devient opaque (m)
 */
export function isChunkVisible(chunk, camera, visibilityFar) {
  return chunkDistance(chunk, camera) <= visibilityFar;
}
