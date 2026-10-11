/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, relativity.shader:83-239 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
// Chunk « rel_vertex » (shaders de sommets) : aberration d'un point immobile dans la ville.
//
// OpenRelativity (relativity.shader:83-239) tourne le repère pour aligner la vitesse du
// joueur sur z, résout le temps d'émission de la lumière, puis applique la transformation
// de Lorentz. Pour le décor statique, ces trois étapes se réduisent à une forme vectorielle
// fermée, sans rotation ni acos :
//   rel = P − œil (repère Three, monde), r = |rel|, n = rel/r (direction monde)
//   D   = γ(1 + β·n)                       facteur Doppler (> 1 devant : bleu)
//   n'  = (n + (γ²/(γ+1)(β·n) + γ)β)/D     direction apparente (|n'| = 1)
// Le sommet est placé en œil + n'·r : on garde la distance MONDE r (l'image ne dépend que
// de la direction), si bien que near/far, brouillard et tri ne dépendent pas de β.
// Miroir JS : physics/relativity.js (aberrate), vérifié par tests/render-math.test.js.
// uGamma et uG2 = γ²/(γ+1) viennent du CPU (double précision, render/uniforms.js).
// Avec REL_CLASSIC (vision classique, jalon 1), l'aberration est court-circuitée.

uniform highp vec3 uBeta;   // β effectif de l'observateur (repère Three)
uniform highp float uGamma; // γ effectif
uniform highp float uG2;    // γ²/(γ + 1)

// Position apparente, relative à l'œil, du point vu en rel = P − œil.
highp vec3 relAberrate(highp vec3 rel) {
#ifdef REL_CLASSIC
  return rel;
#else
  highp float r = length(rel);
  highp float bn = dot(uBeta, rel) / max(r, 1e-6); // β·n
  highp float D = uGamma * (1.0 + bn);
  // n'·r = (rel + (γ²/(γ+1)(β·n) + γ)·r·β)/D
  return (rel + (uG2 * bn + uGamma) * r * uBeta) / D;
#endif
}

// Position de découpage d'un vecteur relatif à l'œil : seule la rotation de la vue
// s'applique (pas de soustraction de grandes coordonnées monde en float32).
highp vec4 relProject(highp vec3 rel) {
  return projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}
