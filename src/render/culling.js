/**
 * Élimination des îlots invisibles (module pur : ni DOM, ni three).
 *
 * Jalon 1 : coupe à la distance de visibilité. Le shader garde la distance monde r de
 * chaque sommet (seule la direction est aberrée) et le brouillard est totalement opaque à
 * `visibilite` : au-delà, un bâtiment est en pleine brume (uFogSpec), quelle que soit la
 * vitesse. La coupe est exacte à quelques niveaux près : seul le ciel juste au-dessus de
 * l'horizon (clearSky > 0) diffère de uFogSpec, si bien qu'elle fait disparaître quelques
 * dizaines de pixels de silhouette pâle au point de fuite des avenues (≤ 6/255 mesurés,
 * nul à grande vitesse).
 *
 * Le culling par frustum de three est désactivé (frustumCulled = false) : il
 * travaille avant l'aberration et ferait disparaître ce qui, derrière, revient
 * devant à grande vitesse. Le culling par « cône apparent » viendra au jalon 3.
 */

/**
 * Distance monde du point de l'îlot le plus proche de la caméra (m).
 * Utilise chunk.nearestDistance(x, y) (distance horizontale à l'emprise des
 * bâtiments, qui partent du sol : c'est aussi la distance 3D tant que l'œil est
 * sous les toits, ce que garantit layout.MIN_BUILDING_HEIGHT), sinon la sphère englobante.
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
