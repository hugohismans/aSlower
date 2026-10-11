/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, MovementScripts.cs:164-183 ; relativity.shader:122-224 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
/**
 * Relativité restreinte du jeu (module pur : ni DOM, ni three).
 *
 * Unités SI. La vitesse de la lumière c est un réglage de la partie (physicsFor dans
 * constants.js) : chaque fonction qui en dépend la reçoit en DERNIER paramètre, facultatif
 * (défaut : C, celle du réglage par défaut, 30 m/s). Les fonctions sans dimension (Doppler,
 * aberration : β sans unité) n'en dépendent pas.
 * Les vitesses « propres » u = γv (m/s) servent d'état à l'intégrateur : |v| =
 * |u|/√(1 + |u|²/c²) reste sous c pour tout u fini (en float64, tant que la rapidité reste
 * en deçà de ≈ 18 ; le jeu la plafonne à 3).
 *
 * Reprises d'OpenRelativity, réécrites :
 * - `composeVelocities` : addition relativiste des vitesses de MovementScripts.cs:164-183
 *   (là-bas après rotation de l'axe x sur la vitesse ; ici sous forme vectorielle) ;
 * - `aberrate` : miroir CPU du boost de Lorentz appliqué par sommet dans
 *   relativity.shader:122-224 (OpenRelativity tourne le repère, cherche le temps
 *   d'émission, puis contracte ; ici la forme vectorielle directe, sans rotation).
 * Ajouts propres au jeu : segment hyperbolique exact, aberration inverse (ciel).
 */
import { C } from './constants.js';

/**
 * sinh(e)/e sans division par zéro ni perte de précision près de 0.
 * @param {number} e
 */
function sinhc(e) {
  if (Math.abs(e) < 1e-4) {
    const e2 = e * e;
    return 1 + (e2 / 6) * (1 + e2 / 20); // erreur relative < e⁶/5040
  }
  return Math.sinh(e) / e;
}

/**
 * Facteur de Lorentz γ = √(1 + |u|²/c²) d'une vitesse propre u.
 * @param {number} ux
 * @param {number} uy
 * @param {number} [c] vitesse de la lumière (m/s)
 */
export function gammaFromU(ux, uy, c = C) {
  return Math.sqrt(1 + (ux * ux + uy * uy) / (c * c));
}

/**
 * Vitesse v = u/γ (m/s) d'une vitesse propre u.
 * @param {number} ux
 * @param {number} uy
 * @param {number} [c] vitesse de la lumière (m/s)
 * @returns {{x: number, y: number}}
 */
export function velocityFromU(ux, uy, c = C) {
  const g = gammaFromU(ux, uy, c);
  return { x: ux / g, y: uy / g };
}

/**
 * Vitesse propre u = γv d'une vitesse v (m/s). Lève une erreur si |v| ≥ c.
 * @param {number} vx
 * @param {number} vy
 * @param {number} [c] vitesse de la lumière (m/s)
 * @returns {{x: number, y: number}}
 */
export function uFromVelocity(vx, vy, c = C) {
  const b2 = (vx * vx + vy * vy) / (c * c);
  if (!(b2 < 1)) throw new RangeError(`Vitesse supérieure ou égale à c : |v| = ${Math.sqrt(b2) * c} m/s`);
  const g = 1 / Math.sqrt(1 - b2);
  return { x: g * vx, y: g * vy };
}

/**
 * Rapidité φ = asinh(|u|/c) : v = c·tanh φ, γ = cosh φ. Elle s'additionne en ligne droite.
 * @param {number} ux
 * @param {number} uy
 * @param {number} [c] vitesse de la lumière (m/s)
 */
export function rapidityFromU(ux, uy, c = C) {
  return Math.asinh(Math.hypot(ux, uy) / c);
}

/**
 * Addition relativiste des vitesses v ⊕ w : vitesse, dans le monde, d'un mobile qui va à w
 * dans le référentiel (sans rotation) qui va lui-même à v. Le référentiel vient d'abord :
 * l'opération n'est pas commutative (les deux ordres diffèrent d'une rotation de Wigner).
 *   v ⊕ w = (v + w∥ + w⊥/γ_v)/(1 + v·w/c²), w∥ et w⊥ relatifs à la direction de v.
 * @param {{x: number, y: number}} v vitesse du référentiel (m/s), |v| < c
 * @param {{x: number, y: number}} w vitesse dans ce référentiel (m/s), |w| < c
 * @param {number} [c] vitesse de la lumière (m/s)
 * @returns {{x: number, y: number}}
 */
export function composeVelocities(v, w, c = C) {
  const c2 = c * c;
  const v2 = v.x * v.x + v.y * v.y;
  if (!(v2 < c2)) throw new RangeError('composeVelocities : |v| doit rester sous c');
  const vw = v.x * w.x + v.y * w.y;
  const invGamma = Math.sqrt(1 - v2 / c2);
  // Composantes de w parallèle et perpendiculaire à v (tout w est « perpendiculaire » si v = 0).
  const k = v2 > 0 ? vw / v2 : 0;
  const parX = k * v.x;
  const parY = k * v.y;
  const den = 1 + vw / c2;
  return {
    x: (v.x + parX + (w.x - parX) * invGamma) / den,
    y: (v.y + parY + (w.y - parY) * invGamma) / den,
  };
}

/**
 * Segment de ligne d'univers sous poussée propre constante, en forme exacte.
 *
 * La poussée (ax, ay) (m/s²) est exprimée dans le référentiel comobile initial (boost pur
 * de u₀) et y reste fixe pendant le temps propre h (transport de Fermi-Walker), ce qui
 * diffère d'axes du monde reboostés à chaque instant (précession de Thomas). La ligne
 * d'univers est une hyperbole :
 * avec η = |a|h/c, S = sinh η/η, K = (cosh η − 1)/η² et A = a + (a·u₀)u₀/(c²(γ₀ + 1)),
 *   u₁ = cosh η·u₀ + h·S·A
 *   Δx = h·S·u₀ + h²·K·A
 *   Δt = h·S·γ₀ + h²·K·(a·u₀)/c²
 * C'est exactement v₀ ⊕ c·tanh(η)·â (« Δv = a·Δτ » du cahier des charges, sous forme
 * exacte), avec en plus le déplacement et le temps de la ville exacts. Si a ∥ u₀ (cas du
 * joueur), le résultat ne dépend pas du découpage en pas ; en poussée oblique, il en dépend
 * (la direction de poussée est relue dans un autre référentiel comobile : rotation de Wigner).
 * @param {number} ux vitesse propre initiale (m/s)
 * @param {number} uy
 * @param {number} ax poussée propre (m/s²)
 * @param {number} ay
 * @param {number} h durée en temps propre (s), h ≥ 0
 * @param {number} [c] vitesse de la lumière (m/s)
 * @returns {{ux: number, uy: number, dx: number, dy: number, dt: number}}
 */
export function hyperbolicSegment(ux, uy, ax, ay, h, c = C) {
  const c2 = c * c;
  const eta = (Math.hypot(ax, ay) * h) / c;
  const g0 = gammaFromU(ux, uy, c);
  const au = ax * ux + ay * uy;
  const k = au / (c2 * (g0 + 1));
  const accX = ax + k * ux;
  const accY = ay + k * uy;
  const s = sinhc(eta);
  const half = sinhc(eta / 2);
  const kk = 0.5 * half * half; // (cosh η − 1)/η² = 2 sinh²(η/2)/η², sans annulation
  const hs = h * s;
  const h2k = h * h * kk;
  return {
    ux: Math.cosh(eta) * ux + hs * accX,
    uy: Math.cosh(eta) * uy + hs * accY,
    dx: hs * ux + h2k * accX,
    dy: hs * uy + h2k * accY,
    dt: hs * g0 + (h2k * au) / c2,
  };
}

/**
 * Lit β (sans unité) et renvoie γ ; lève une erreur si |β| ≥ 1.
 * @param {{x: number, y: number, z: number}} beta
 */
function gammaFromBeta(beta) {
  const b2 = beta.x * beta.x + beta.y * beta.y + beta.z * beta.z;
  if (!(b2 < 1)) throw new RangeError('β doit rester strictement sous 1');
  return 1 / Math.sqrt(1 - b2);
}

/**
 * Facteur Doppler D = ν reçue / ν émise = γ(1 + β·n) pour une source immobile dans la ville
 * et un observateur de vitesse βc. n : direction (unitaire, monde) de l'observateur vers
 * la source. D > 1 devant (décalage vers le bleu), D < 1 derrière.
 * @param {{x: number, y: number, z: number}} beta
 * @param {{x: number, y: number, z: number}} n
 */
export function dopplerFactor(beta, n) {
  const g = gammaFromBeta(beta);
  return g * (1 + beta.x * n.x + beta.y * n.y + beta.z * n.z);
}

/**
 * Aberration : direction apparente n' (référentiel de l'observateur) d'une source vue dans
 * la direction monde n, et facteur Doppler D. Obtenue en boostant la séparation de genre
 * lumière (−r, r·n) : n' = (n + (γ²/(γ + 1)(β·n) + γ)β)/D, avec D = γ(1 + β·n) = r'/r.
 * Même formule que le vertex shader (où r·n = position relative du sommet).
 * @param {{x: number, y: number, z: number}} beta
 * @param {{x: number, y: number, z: number}} n unitaire
 * @returns {{x: number, y: number, z: number, D: number}}
 */
export function aberrate(beta, n) {
  const g = gammaFromBeta(beta);
  const bn = beta.x * n.x + beta.y * n.y + beta.z * n.z;
  const D = g * (1 + bn);
  const k = ((g * g) / (g + 1)) * bn + g;
  return { x: (n.x + k * beta.x) / D, y: (n.y + k * beta.y) / D, z: (n.z + k * beta.z) / D, D };
}

/**
 * Inverse de `aberrate` (passe du ciel) : direction monde n de ce qu'on voit dans la
 * direction apparente n', et le même facteur Doppler D = 1/(γ(1 − β·n')).
 *   n = (n' + (γ²/(γ + 1)(β·n') − γ)β)·D
 * @param {{x: number, y: number, z: number}} beta
 * @param {{x: number, y: number, z: number}} nApparent unitaire
 * @returns {{x: number, y: number, z: number, D: number}}
 */
export function aberrateInverse(beta, nApparent) {
  const g = gammaFromBeta(beta);
  const bn = beta.x * nApparent.x + beta.y * nApparent.y + beta.z * nApparent.z;
  const D = 1 / (g * (1 - bn));
  const k = ((g * g) / (g + 1)) * bn - g;
  return {
    x: (nApparent.x + k * beta.x) * D,
    y: (nApparent.y + k * beta.y) * D,
    z: (nApparent.z + k * beta.z) * D,
    D,
  };
}

/**
 * Date d'émission (temps de la ville) de la lumière qu'on reçoit à l'instant t d'un objet
 * immobile situé à la distance d (m) : t − d/c.
 * @param {number} t
 * @param {number} d
 * @param {number} [c] vitesse de la lumière (m/s)
 */
export function emissionTimeStatic(t, d, c = C) {
  return t - d / c;
}
