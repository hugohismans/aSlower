// Chunk « rel_fog » (shaders de fragments) : brouillard de la ville.
//
// Le brouillard est un milieu IMMOBILE dans la ville : il se mélange aux réflectances
// (5 canaux r, g, b, ir, uv) AVANT le décalage Doppler, en fonction de la distance MONDE r
// (non aberrée), si bien qu'il se décale exactement comme ce qu'il recouvre. Il est
// totalement opaque à uFogFar, qui sert aussi de distance de coupe des chunks.
// Le scene.fog de three, appliqué après la couleur et sur la position apparente, serait faux.

uniform float uFogNear;   // début du brouillard (m)
uniform float uFogFar;    // brouillard opaque (m)
uniform vec3 uFogSpec;    // réflectances r, g, b de la brume (sRGB linéaire)
uniform vec2 uFogIrUv;    // réflectances ir, uv de la brume

// Opacité du brouillard ∈ [0, 1] à la distance monde r (raccord doux aux deux bouts).
float relFogFactor(highp float r) {
  float t = clamp((r - uFogNear) / max(uFogFar - uFogNear, 1e-3), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Mélange les réflectances avec la brume à la distance monde r.
void relApplyFog(inout vec3 rgb, inout vec2 irUv, highp float r) {
  float f = relFogFactor(r);
  rgb = mix(rgb, uFogSpec, f);
  irUv = mix(irUv, uFogIrUv, f);
}
