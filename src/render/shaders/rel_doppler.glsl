/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, relativity.shader:299-379 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
// Chunk « rel_doppler » (shaders de fragments) : facteur Doppler, couleur décalée, projecteur,
// tone mapping. Même chaîne que physics/spectrum.js (perceivedColor) :
//   c = Σ_k ρ_k·M_k(D)              (5 lectures de LUT ; M(1) = [I | 0])
//   c = gamut(c)                     (désaturation à luminance constante)
//   c = c·min(D^p, borne)·exposition (effet projecteur ; p = 4 est physique)
//   c = toneMap(c, genou)            (compression du maximum, teinte conservée)
// OpenRelativity (relativity.shader:299-379) calcule, par fragment, le décalage de trois raies
// gaussiennes puis « constrainRGB » ; ici, les intégrales spectrales sont précalculées
// dans une LUT (render/dopplerLut.js) et le gamut garde la teinte.
// Avec REL_CLASSIC : D = 1, M = [I | 0], projecteur 1 ; brouillard et tone mapping inchangés.

uniform highp vec3 uBeta;
uniform highp float uGamma;
uniform highp float uG2;
uniform sampler2D uLut;  // LUT Doppler RGBA16F
uniform vec4 uLutParams; // (N, L, H, 0) : texels, plage de log₂ D, lignes
uniform float uBeamExp;
uniform float uBeamMax;
uniform float uKnee;
uniform float uExposure;

const vec3 REL_LUMA = vec3(0.2126, 0.7152, 0.0722); // luminance du sRGB linéaire

// Facteur Doppler d'une source immobile vue en rel = P − œil (direction monde, non aberrée) :
// D = γ(1 + β·n), n = rel/|rel|.
highp float relDopplerFactor(highp vec3 rel) {
#ifdef REL_CLASSIC
  return 1.0;
#else
  return uGamma * (1.0 + dot(uBeta, normalize(rel)));
#endif
}

// Abscisse de lecture de la LUT : x = clamp((log₂ D + L)/(2L), 0, 1), u = (x(N − 1) + 0,5)/N.
highp float relLutU(highp float D) {
  highp float x = clamp((log2(D) + uLutParams.y) / (2.0 * uLutParams.y), 0.0, 1.0);
  return (x * (uLutParams.x - 1.0) + 0.5) / uLutParams.x;
}

// Texel de la ligne `row` (centre de ligne : v = (ligne + 0,5)/H, pas de mélange vertical).
vec3 relLutTexel(highp float u, float row) {
  return texture(uLut, vec2(u, (row + 0.5) / uLutParams.z)).rgb;
}

// Ligne `row` de la LUT lue au facteur D (corps noirs, ciel).
vec3 relLutRow(highp float D, float row) {
  return relLutTexel(relLutU(D), row);
}

// Couleur Doppler (avant projecteur) d'une surface de réflectances (r, g, b) et (ir, uv).
vec3 relSurfaceColor(vec3 rgb, vec2 irUv, highp float D) {
#ifdef REL_CLASSIC
  return rgb; // M(1) = [I | 0]
#else
  highp float u = relLutU(D);
  return rgb.r * relLutTexel(u, 0.0)
       + rgb.g * relLutTexel(u, 1.0)
       + rgb.b * relLutTexel(u, 2.0)
       + irUv.x * relLutTexel(u, 3.0)
       + irUv.y * relLutTexel(u, 4.0);
#endif
}

// Hors gamut (composante négative) : désaturation vers le gris de même luminance Y
// (spectrum.gamutMap) ; teinte conservée.
vec3 relGamut(vec3 c) {
  float m = min(c.r, min(c.g, c.b));
  if (m >= 0.0) return c;
  float Y = dot(c, REL_LUMA);
  return Y > 0.0 ? max(vec3(Y) + (c - vec3(Y)) * (Y / (Y - m)), 0.0) : vec3(0.0);
}

// Effet projecteur (spectrum.beamFactor) : min(D^p, borne).
float relBeam(highp float D) {
#ifdef REL_CLASSIC
  return 1.0;
#else
  return min(pow(D, uBeamExp), uBeamMax);
#endif
}

// Tone mapping qui préserve la teinte (spectrum.toneMap) : identité jusqu'au genou K,
// puis m' = K + (1 − K)(1 − exp(−(m − K)/(1 − K))) appliqué au maximum m des canaux.
vec3 relToneMap(vec3 c, float knee) {
  float m = max(c.r, max(c.g, c.b));
  if (m <= knee) return c;
  float w = 1.0 - knee;
  float mt = w > 0.0 ? knee + w * (1.0 - exp(-(m - knee) / w)) : 1.0;
  return c * (mt / m);
}

// Fin de chaîne commune : gamut, projecteur × exposition, tone mapping (sRGB linéaire).
vec3 relFinish(vec3 c, highp float D) {
  return relToneMap(relGamut(c) * (relBeam(D) * uExposure), uKnee);
}
