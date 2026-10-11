/*! Inspiré d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, skybox.shader — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
// Passe d'environnement : ciel, sol et brouillard, pour chaque pixel non couvert.
//
// OpenRelativity (skybox.shader) décale en fréquence la texture du ciel sans l'aberrer.
// Ici, pour chaque pixel :
// 1. direction apparente n' (référentiel du joueur), puis aberration INVERSE exacte vers la
//    direction monde n : D = 1/(γ(1 − β·n')), n = (n' + (γ²/(γ+1)(β·n') − γ)β)·D ;
// 2. intersection analytique avec le sol (Three : y = 0, œil à uEyeHeight), SANS branchement
//    avant la lecture de texture, puis carte des rues (repère du jeu, uStreetBounds) : rgb =
//    réflectances visibles, alpha = 1 − v/2 où v est la fraction de végétation du texel
//    (render/streetMap.js) ; ir et uv = luminance × rapport du sol minéral (uGroundIrUv) ou
//    de la végétation (uVegetationIrUv, « red edge » : ir fort pour un visible faible),
//    mélangés selon v ;
// 3. ciel en dégradé (horizon : ligne de LUT uSkyRow ; zénith : ciel dégagé à spectre continu,
//    ligne de LUT uSkyClearRow), disque solaire, brume à l'horizon ; brouillard du sol en
//    distance monde, mélangé avant le Doppler ;
// 4. même fin de chaîne que les façades (LUT, gamut, projecteur, tone mapping, sRGB).
// Miroir JS : physics/relativity.js (aberrateInverse), vérifié par tests/render-math.test.js.
#include <rel_fog>
#include <rel_doppler>

uniform highp float uEyeHeight;   // hauteur de l'œil au-dessus de la chaussée (m)
uniform sampler2D uStreetMap;     // carte des rues (sRGB, décodée en linéaire par le GPU)
uniform highp vec4 uStreetBounds; // (xmin, ymin, xmax, ymax) du jeu couverts par la carte
uniform highp vec3 uSunDir;       // direction du soleil (monde, repère Three, unitaire)
uniform float uSkyRow;            // ligne de LUT de la lumière du ciel (corps noir)
uniform float uSkyClearRow;       // ligne de LUT du ciel dégagé (spectre continu)
uniform vec2 uGroundIrUv;         // réflectances ir, uv du sol minéral, en fraction de sa luminance
uniform vec2 uVegetationIrUv;     // réflectances ir, uv de la végétation, en fraction de sa luminance

varying highp vec3 vRay;

// Ciel dégagé, en dégradé de l'horizon au zénith :
// - près de l'horizon, lumière diffuse blanche (longs trajets, diffusion multiple) : corps noir
//   de la ligne uSkyRow (6 500 K), luminance SKY_HORIZON ;
// - vers le zénith, lumière du soleil diffusée par l'air (Rayleigh, ∝ λ⁻⁴) et les aérosols
//   (∝ λ^−1,3), nulle sous 295 nm (ozone) : spectre CONTINU (spectrum.clearSkyColor), tabulé
//   dans la ligne uSkyClearRow de la LUT, de luminance SKY_CLEAR_LUMINANCE (0,186) au repos.
//   Décalé, il reste bleu et lisse : pas de fausses teintes aux bords des 5 bandes.
const float SKY_HORIZON = 0.55;
const float ZENITH_HEIGHT = 0.6;     // le bleu du ciel dégagé domine au-dessus de ≈ 37°
const float HAZE_HEIGHT = 0.12;      // le ciel sort de la brume sur ≈ 7° au-dessus de l'horizon
const float SUN_COS_OUTER = 0.99990; // disque solaire : bord flou entre ≈ 0,5° et 0,8°
const float SUN_COS_INNER = 0.99996;
const float SUN_INTENSITY = 30.0;    // disque (le tone mapping le ramène au blanc)
const float SUN_HALO = 0.35;         // halo autour du disque

// Aberration inverse : direction monde de ce qu'on voit dans la direction apparente nApp.
highp vec3 relAberrateInverse(highp vec3 nApp, out highp float D) {
#ifdef REL_CLASSIC
  D = 1.0;
  return nApp;
#else
  highp float bn = dot(uBeta, nApp);
  D = 1.0 / (uGamma * (1.0 - bn));
  return (nApp + (uG2 * bn - uGamma) * uBeta) * D;
#endif
}

void main() {
  highp float D;
  highp vec3 n = relAberrateInverse(normalize(vRay), D);

  // --- Sol (y = 0). La distance est bornée à uFogFar : au-delà le brouillard est opaque,
  // et les rayons montants tombent sur le même cercle, si bien que les coordonnées de
  // texture (et leurs dérivées) restent continues à travers l'horizon.
  highp float down = -n.y;
  highp float dist = min(uEyeHeight / max(down, 1e-6), uFogFar);
  highp vec2 hitXZ = cameraPosition.xz + n.xz * dist;
  highp vec2 hitGame = vec2(hitXZ.x, -hitXZ.y); // repère du jeu : y = −Z
  highp vec2 uv = (hitGame - uStreetBounds.xy) / (uStreetBounds.zw - uStreetBounds.xy);
  vec4 groundTexel = texture(uStreetMap, uv);
  vec3 ground = groundTexel.rgb;
  float vegetation = clamp(2.0 - 2.0 * groundTexel.a, 0.0, 1.0);
  float fog = relFogFactor(dist);
  vec3 groundRgb = mix(ground, uFogSpec, fog);
  vec2 groundIrUv = mix(mix(uGroundIrUv, uVegetationIrUv, vegetation) * dot(ground, REL_LUMA), uFogIrUv, fog);

  // --- Ciel : brume près de l'horizon, puis ciel dégagé en dégradé (blanc → bleu du ciel dégagé).
  float isGround = step(0.0, down);
  float up = max(n.y, 0.0);
  float clearSky = (1.0 - isGround) * smoothstep(0.0, HAZE_HEIGHT, up); // 0 : brume, 1 : dégagé
  float zenith = smoothstep(0.0, ZENITH_HEIGHT, up);                   // 0 : horizon, 1 : zénith
  vec3 skyRgb = uFogSpec * (1.0 - clearSky);
  vec2 skyIrUv = uFogIrUv * (1.0 - clearSky);

  // Soleil (corps noir à la température du soleil) : réflectance 1 dans les 5 bandes,
  // c'est-à-dire exactement le spectre solaire, décalé par M(D) comme le reste.
  float cosSun = dot(n, uSunDir);
  float sun = (1.0 - isGround) * (SUN_INTENSITY * smoothstep(SUN_COS_OUTER, SUN_COS_INNER, cosSun)
    + SUN_HALO * pow(max(cosSun, 0.0), 256.0));

  vec3 rho = mix(skyRgb, groundRgb, isGround) + vec3(sun);
  vec2 rhoIrUv = mix(skyIrUv, groundIrUv, isGround) + vec2(sun);
  vec3 c = relSurfaceColor(rho, rhoIrUv, D);
  c += (clearSky * (1.0 - zenith) * SKY_HORIZON) * relLutRow(D, uSkyRow)
     + (clearSky * zenith) * relLutRow(D, uSkyClearRow);

  gl_FragColor = vec4(relFinish(c, D), 1.0);
  #include <colorspace_fragment>
}
