/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, relativity.shader:27-47, 243-327, 356-371 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
/**
 * Modèle spectral et LUT Doppler (module pur : ni three, ni DOM).
 *
 * Seul le préréglage de comparaison `colorMatrixOpenRelativity` / `openRelativityColor`
 * (en fin de fichier) reprend OpenRelativity ; tout le reste est un modèle propre au jeu.
 *
 * ## Convention (docs/interfaces.md, plan §4 « Couleur (Doppler) »)
 *
 * Chaque surface porte 5 réflectances (r, g, b, ir, uv) sur des bases qui partitionnent
 * l'unité sur [0 ; ∞) en longueur d'onde ÉMISE :
 *   uv : λ < 360 nm ; b : [360 ; 490[ ; g : [490 ; 590[ ; r : [590 ; 830[ ; ir : λ ≥ 830 nm.
 * La ville est éclairée par un soleil corps noir E = B(λ, SUN_TEMPERATURE).
 * Vue avec le facteur Doppler D (> 1 devant), la lumière émise à Dλ arrive à λ :
 *
 *   M_k(D) = 𝐍 · RGB( ∫[360 ; 830] CMF(λ) · D · E(Dλ) · ρ_k(Dλ) dλ )
 *
 * - CMF : ajustement analytique multi-lobes de Wyman, Sloan et Shirley (2013) ;
 * - RGB : XYZ → sRGB linéaire (D65) ;
 * - 𝐍 : inverse du bloc 3×3 (r, g, b) à D = 1, appliqué aux 5 colonnes. C'est
 *   l'adaptation de l'œil au soleil : un blanc éclairé par le soleil vaut (1, 1, 1),
 *   d'où M(1) = [I | 0] (les bases ir et uv n'ont aucun support dans [360 ; 830] au repos).
 * - Un SEUL facteur D dans M(D) (jacobien dλ_émis/dλ_vu). Le reste du facteur physique
 *   D⁵ = D·D⁴ est l'effet projecteur, appliqué à part : beamFactor(D) = min(D^p, borne),
 *   avec p = BEAM_EXPONENT = 4 (réglage physique). Invariance qui fixe l'exposant :
 *   D⁴·M(D)·blanc = 𝐍·RGB(∫ CMF(λ)·B(λ, D·T_soleil) dλ) (un corps noir vu avec D est
 *   un corps noir de température D·T).
 *
 * Toutes les couleurs sont en sRGB LINÉAIRE ; la sortie sRGB se fait dans le shader.
 * Les lampes (corps noirs, raies) reçoivent la même adaptation 𝐍 que les surfaces :
 * une lampe à SUN_TEMPERATURE a exactement la couleur d'un blanc au soleil.
 *
 * ## Chaîne d'une couleur perçue (identique dans le GLSL, voir perceivedColor)
 *
 *   c = Σ_k ρ_k · M_k(D)            (surface : 5 lectures de LUT)
 *     | lineColor(λ₀/D) · intensité  (lampe à raie)
 *     | blackbodyColor(D, T) · intensité (lampe corps noir : une lecture de LUT)
 *   c = gamutMap(c)                 (désaturation à luminance constante)
 *   c = c · beamFactor(D) · exposition  (dans le jeu : adaptationExposure(D droit devant))
 *   c = toneMap(c, TONEMAP_KNEE)    (compression du maximum, teinte conservée)
 *
 * Références :
 * - C. Wyman, P.-P. Sloan, P. Shirley, « Simple Analytic Approximations to the CIE XYZ
 *   Color Matching Functions », Journal of Computer Graphics Techniques (JCGT),
 *   vol. 2, n° 2, p. 1-11, 2013 — http://jcgt.org/published/0002/02/01/
 * - IEC 61966-2-1:1999 (sRGB) : matrice XYZ → sRGB linéaire et coefficients de luminance.
 * - B. Ottosson, « A perceptual color space for image processing » (Oklab), 2020 —
 *   https://bottosson.github.io/posts/oklab/ (classification des teintes).
 */

import {
  WAVELENGTH_MIN,
  WAVELENGTH_MAX,
  SUN_TEMPERATURE,
  BEAM_EXPONENT,
  BEAM_MAX,
  TONEMAP_KNEE,
  LUT_SIZE,
  LUT_LOG2_RANGE,
  BLACKBODY_TEMPERATURES,
  ADAPTATION_REFERENCE,
  SKY_AEROSOL_FRACTION,
  SKY_CLEAR_LUMINANCE,
} from './constants.js';

/** @typedef {[number, number, number]} Rgb  sRGB linéaire */

/* ------------------------------------------------------------------------- */
/* Fonctions colorimétriques, corps noir, XYZ → sRGB                          */
/* ------------------------------------------------------------------------- */

/**
 * Lobe gaussien asymétrique de Wyman et al. : exp(−t²/2), t = (λ − μ)·(λ < μ ? a : b),
 * où a et b sont les INVERSES des largeurs (forme du listing 1 de l'article).
 */
function lobe(lambda, mu, invWidthBelow, invWidthAbove) {
  const t = (lambda - mu) * (lambda < mu ? invWidthBelow : invWidthAbove);
  return Math.exp(-0.5 * t * t);
}

/** x̄, ȳ, z̄ de Wyman et al. (fonctions séparées : l'intégrateur évite toute allocation). */
function xBar(l) {
  return 1.056 * lobe(l, 599.8, 0.0264, 0.0323) + 0.362 * lobe(l, 442.0, 0.0624, 0.0374)
    - 0.065 * lobe(l, 501.1, 0.049, 0.0382);
}
function yBar(l) {
  return 0.821 * lobe(l, 568.8, 0.0213, 0.0247) + 0.286 * lobe(l, 530.9, 0.0613, 0.0322);
}
function zBar(l) {
  return 1.217 * lobe(l, 437.0, 0.0845, 0.0278) + 0.681 * lobe(l, 459.0, 0.0385, 0.0725);
}

/**
 * Fonctions colorimétriques CIE 1931 2° : ajustement « multi-lobes » de Wyman, Sloan
 * et Shirley (JCGT 2(2), 2013, équation 2 et listing 1). Écart à la table CIE
 * comparable à la variabilité entre observateurs ; sous ≈ 400 nm, x̄ y est sous-estimé
 * (les raies très sombres de l'extrême violet tirent vers le bleu).
 * @param {number} lambdaNm longueur d'onde (nm)
 * @returns {{x: number, y: number, z: number}}
 */
export function cmfWyman(lambdaNm) {
  return { x: xBar(lambdaNm), y: yBar(lambdaNm), z: zBar(lambdaNm) };
}

/** Seconde constante de rayonnement c₂ = hc/k (nm·K). */
const SECOND_RADIATION_CONSTANT = 1.438776877e7;

/**
 * Luminance spectrale relative d'un corps noir (loi de Planck), à un facteur 2hc² près :
 * B(λ, T) = (λ / 1 µm)⁻⁵ / (exp(c₂/(λT)) − 1). Propriété utilisée partout :
 * D⁵·B(Dλ, T) = B(λ, D·T). Renvoie 0 pour λ ≤ 0 ou T ≤ 0 (et sans débordement :
 * exp trop grand → 0).
 * @param {number} lambdaNm longueur d'onde (nm)
 * @param {number} T température (K)
 */
export function planck(lambdaNm, T) {
  if (!(lambdaNm > 0) || !(T > 0)) return 0;
  const m = lambdaNm / 1000; // en micromètres
  const m2 = m * m;
  return 1 / (m2 * m2 * m * Math.expm1(SECOND_RADIATION_CONSTANT / (lambdaNm * T)));
}

/** Matrice XYZ → sRGB linéaire (primaires sRGB, blanc D65), IEC 61966-2-1, par lignes. */
export const XYZ_TO_LINEAR_SRGB = Object.freeze([
  Object.freeze([3.2406, -1.5372, -0.4986]),
  Object.freeze([-0.9689, 1.8758, 0.0415]),
  Object.freeze([0.0557, -0.204, 1.057]),
]);

/** Coefficients de luminance du sRGB linéaire (ligne Y de la matrice inverse, IEC 61966-2-1). */
const LUMA = Object.freeze([0.2126, 0.7152, 0.0722]);

/**
 * Luminance relative d'une couleur sRGB linéaire (le blanc (1, 1, 1) vaut 1).
 * GLSL : dot(c, vec3(0.2126, 0.7152, 0.0722)).
 * @param {ArrayLike<number>} rgb
 */
export function luminance(rgb) {
  return LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2];
}

/** Produit matrice 3×3 (par lignes) × vecteur. */
function mulMat3Vec(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Inverse d'une matrice 3×3 (par lignes), par les cofacteurs. */
function invertMat3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 0)) throw new Error('Matrice 3×3 non inversible');
  return [
    [A / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [C / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/* ------------------------------------------------------------------------- */
/* Bases de réflectance et intégration                                        */
/* ------------------------------------------------------------------------- */

/** Frontières internes des bases (nm) : bleu | vert à 490, vert | rouge à 590. */
const BLUE_GREEN_EDGE = 490;
const GREEN_RED_EDGE = 590;

/**
 * Supports [début ; fin[ des 5 bases en longueur d'onde émise, dans l'ordre r, g, b, ir, uv
 * (celui de LUT_ROWS et des colonnes de colorMatrix).
 */
const BASIS_SUPPORTS = Object.freeze([
  [GREEN_RED_EDGE, WAVELENGTH_MAX], // r
  [BLUE_GREEN_EDGE, GREEN_RED_EDGE], // g
  [WAVELENGTH_MIN, BLUE_GREEN_EDGE], // b
  [WAVELENGTH_MAX, Infinity], // ir : plateau de 830 nm à l'infini
  [0, WAVELENGTH_MIN], // uv
]);

/**
 * Base de réflectance k (0 r, 1 g, 2 b, 3 ir, 4 uv) à la longueur d'onde λ :
 * 1 dans son support, 0 ailleurs. Les 5 bases partitionnent l'unité sur [0 ; ∞).
 * @param {number} k
 * @param {number} lambdaNm
 * @returns {0 | 1}
 */
export function reflectanceBasis(k, lambdaNm) {
  const support = BASIS_SUPPORTS[k];
  if (!support) throw new RangeError(`Base de réflectance inconnue : ${k}`);
  return lambdaNm >= support[0] && lambdaNm < support[1] ? 1 : 0;
}

/**
 * Pas maximal (nm) de la règle de Simpson composite. Les bases sont discontinues : on
 * intègre séparément sur chaque support (bornes exactes λ = frontière/D), où l'intégrande
 * est lisse ; l'erreur relative mesurée est alors ≤ 2e-6 (1,5e-7 avec un pas de 0,5 nm).
 */
const INTEGRATION_STEP_NM = 1;

/**
 * ∫[a ; b] CMF(λ)·D·B(Dλ, T) dλ par Simpson composite → [X, Y, Z].
 * Avec D = 1 : spectre d'un corps noir de température T.
 */
function integrateXyz(D, T, a, b) {
  const n = 2 * Math.max(1, Math.ceil((b - a) / (2 * INTEGRATION_STEP_NM)));
  const h = (b - a) / n;
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let i = 0; i <= n; i++) {
    const lambda = a + i * h;
    const w = (i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2) * D * planck(D * lambda, T);
    if (w === 0) continue;
    X += w * xBar(lambda);
    Y += w * yBar(lambda);
    Z += w * zBar(lambda);
  }
  return [(X * h) / 3, (Y * h) / 3, (Z * h) / 3];
}

/** Vérifie qu'un facteur Doppler est utilisable (fini et > 0). */
function assertDoppler(D) {
  if (!(D > 0) || !Number.isFinite(D)) throw new RangeError(`Facteur Doppler invalide : ${D}`);
}

/**
 * RGB brut (avant 𝐍) de la base k vue avec D : RGB(∫ CMF(λ)·D·E(Dλ)·ρ_k(Dλ) dλ).
 * Le support observé est [début/D ; fin/D[ ∩ [WAVELENGTH_MIN ; WAVELENGTH_MAX].
 */
function rawBasisRgb(k, D) {
  const [start, end] = BASIS_SUPPORTS[k];
  const lo = Math.max(WAVELENGTH_MIN, start / D);
  const hi = Math.min(WAVELENGTH_MAX, end / D);
  if (!(hi > lo)) return [0, 0, 0];
  return mulMat3Vec(XYZ_TO_LINEAR_SRGB, integrateXyz(D, SUN_TEMPERATURE, lo, hi));
}

/** RGB brut (avant 𝐍) d'un corps noir de température T : RGB(∫[360 ; 830] CMF·B(λ, T) dλ). */
function rawBlackbodyRgb(T) {
  return mulMat3Vec(XYZ_TO_LINEAR_SRGB, integrateXyz(1, T, WAVELENGTH_MIN, WAVELENGTH_MAX));
}

/** 𝐍 : adaptation au soleil, calculée une seule fois. */
let adaptationMatrix = null;
function getAdaptation() {
  if (!adaptationMatrix) {
    const columns = [0, 1, 2].map((k) => rawBasisRgb(k, 1));
    const block = [0, 1, 2].map((row) => columns.map((col) => col[row]));
    adaptationMatrix = invertMat3(block);
  }
  return adaptationMatrix;
}

/* ------------------------------------------------------------------------- */
/* Matrice Doppler, corps noirs, raies                                        */
/* ------------------------------------------------------------------------- */

/**
 * Matrice de couleur M(D) : 5 colonnes [r, g, b] (sRGB linéaire), dans l'ordre des
 * réflectances r, g, b, ir, uv. Couleur d'une surface : Σ_k ρ_k·M_k(D) (avant projecteur).
 * M(1) = [I | 0]. Un seul facteur D inclus (voir l'en-tête).
 * @param {number} D facteur Doppler (> 0)
 * @returns {Rgb[]}
 */
export function colorMatrix(D) {
  assertDoppler(D);
  const N = getAdaptation();
  return [0, 1, 2, 3, 4].map((k) => /** @type {Rgb} */ (mulMat3Vec(N, rawBasisRgb(k, D))));
}

/** Luminance adaptée de chaque corps noir au repos (normalisation), mise en cache. */
const blackbodyRestLuminance = new Map();

/**
 * Couleur d'une lampe corps noir de température T (K) vue avec D, AVANT projecteur :
 * 𝐍·RGB(B(λ, D·T)) / D⁴, divisée par la luminance de 𝐍·RGB(B(λ, T)) pour que la
 * luminance vaille 1 à D = 1. Le D⁴ retiré ici est rendu par beamFactor (p = 4) :
 * blackbodyColor(D, T)·D⁴ est exactement le corps noir de température D·T, sans
 * jamais compter deux fois le facteur D⁴.
 * 𝐍 (adaptation au soleil) est appliqué comme aux surfaces : une lampe à SUN_TEMPERATURE
 * a la couleur d'un blanc éclairé par le soleil.
 * @param {number} D facteur Doppler (> 0)
 * @param {number} T température (K, > 0)
 * @returns {Rgb}
 */
export function blackbodyColor(D, T) {
  assertDoppler(D);
  if (!(T > 0)) throw new RangeError(`Température invalide : ${T}`);
  const N = getAdaptation();
  let restLuminance = blackbodyRestLuminance.get(T);
  if (restLuminance === undefined) {
    restLuminance = luminance(mulMat3Vec(N, rawBlackbodyRgb(T)));
    blackbodyRestLuminance.set(T, restLuminance);
  }
  const scale = 1 / (D ** 4 * restLuminance);
  const rgb = mulMat3Vec(N, rawBlackbodyRgb(D * T));
  return [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
}

/** Réflectance relative du ciel dégagé (Rayleigh + aérosols), nulle sous 295 nm (ozone). */
function clearSkyShape(lambdaNm) {
  if (lambdaNm < 295) return 0;
  const x = 550 / lambdaNm;
  return x * x * x * x + SKY_AEROSOL_FRACTION * x ** 1.3;
}

/** 𝐍·RGB(∫ CMF(λ)·D·E(Dλ)·shape(Dλ) dλ) sur [360 ; 830] (intégrande lisse : Simpson au pas de 1 nm). */
function rawClearSkyRgb(D) {
  const n = 470; // pas de 1 nm : intégrande lisse
  const h = (WAVELENGTH_MAX - WAVELENGTH_MIN) / n;
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let i = 0; i <= n; i++) {
    const l = WAVELENGTH_MIN + i * h;
    const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * D * planck(D * l, SUN_TEMPERATURE) * clearSkyShape(D * l);
    if (w === 0) continue;
    X += w * xBar(l);
    Y += w * yBar(l);
    Z += w * zBar(l);
  }
  return mulMat3Vec(getAdaptation(), mulMat3Vec(XYZ_TO_LINEAR_SRGB, [(X * h) / 3, (Y * h) / 3, (Z * h) / 3]));
}

let clearSkyScale = 0;
/**
 * Ciel dégagé vu avec D, AVANT projecteur (même convention que colorMatrix : un seul D).
 * Spectre continu (pas de créneaux) : décalé, il reste bleu et lisse, sans fausses teintes.
 * Luminance SKY_CLEAR_LUMINANCE au repos.
 * @param {number} D
 * @returns {Rgb}
 */
export function clearSkyColor(D) {
  assertDoppler(D);
  if (clearSkyScale === 0) clearSkyScale = SKY_CLEAR_LUMINANCE / luminance(rawClearSkyRgb(1));
  const rgb = rawClearSkyRgb(D);
  return [rgb[0] * clearSkyScale, rgb[1] * clearSkyScale, rgb[2] * clearSkyScale];
}

/** Gain G(D) de la façade de référence vue de face (projecteur compris), relatif au repos. */
function referenceGain(D, beamExponent, beamMax) {
  const M = colorMatrix(D);
  const c = [0, 0, 0];
  for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) c[j] += ADAPTATION_REFERENCE[k] * M[k][j];
  return (luminance(gamutMap(c)) * beamFactor(D, beamExponent, beamMax)) / luminance(ADAPTATION_REFERENCE);
}

/**
 * Table de log₂ G sur log₂ D ∈ [0 ; LUT_LOG2_RANGE] (129 points, ≈ 30 ms une seule fois) :
 * materials.js la construit au chargement, pour ne pas figer la première accélération.
 */
const ADAPTATION_SAMPLES = 129;
let adaptationTable = null;

/**
 * Exposition d'adaptation de l'œil, réglée sur ce que le joueur regarde (droit devant) :
 * E = 1/G(D_avant), G(D) = luminance(gamutMap(M(D)·ρ_ref))·beamFactor(D)/luminance(ρ_ref),
 * ρ_ref = ADAPTATION_REFERENCE, D_avant = γ(1 + β) = e^φ. La façade de référence vue de face
 * garde sa luminance du repos ; les rapports de luminance DANS l'image restent physiques.
 * E = 1 pour D_avant ≤ 1 (arrêt, vision classique) et E ≤ 1 toujours.
 * Réglages par défaut seulement (BEAM_EXPONENT, BEAM_MAX) : table interpolée (écart < 0,2 %),
 * à recalculer si l'exposant du projecteur devient réglable.
 * Règles de couleur du jeu (portes) : perceivedColor(src, D, {exposure: adaptationExposure(e^φ)}),
 * pour suivre la même loi que l'écran.
 * @param {number} Dforward
 */
export function adaptationExposure(Dforward) {
  assertDoppler(Dforward);
  if (Dforward <= 1) return 1;
  if (!adaptationTable) {
    adaptationTable = new Float64Array(ADAPTATION_SAMPLES);
    for (let i = 0; i < ADAPTATION_SAMPLES; i++) {
      const D = 2 ** ((LUT_LOG2_RANGE * i) / (ADAPTATION_SAMPLES - 1));
      adaptationTable[i] = Math.log2(Math.max(1, referenceGain(D, BEAM_EXPONENT, BEAM_MAX)));
    }
  }
  const s = Math.min(Math.log2(Dforward) / LUT_LOG2_RANGE, 1) * (ADAPTATION_SAMPLES - 1);
  const i = Math.min(Math.floor(s), ADAPTATION_SAMPLES - 2);
  const f = s - i;
  return 2 ** -((1 - f) * adaptationTable[i] + f * adaptationTable[i + 1]);
}

/** max ȳ de l'ajustement de Wyman (≈ 1 vers 556 nm), calculé une fois. */
let yBarMax = 0;
function getYBarMax() {
  if (yBarMax === 0) {
    for (let i = 0; i <= 4000; i++) yBarMax = Math.max(yBarMax, yBar(540 + i * 0.01));
  }
  return yBarMax;
}

/**
 * Couleur d'une raie monochromatique observée à λ (nm), AVANT projecteur.
 * Chromaticité : 𝐍·RGB(CMF(λ)) (même adaptation que les surfaces) ; luminance relative
 * exactement ȳ(λ)/max ȳ ; puis gamutMap (désaturation vers le gris de même luminance),
 * qui garde la teinte. Noir hors de [WAVELENGTH_MIN ; WAVELENGTH_MAX], comme pour les
 * surfaces (une raie à 900 nm est « éteinte » au repos).
 * @param {number} lambdaObsNm longueur d'onde observée (nm)
 * @returns {Rgb}
 */
export function lineColor(lambdaObsNm) {
  if (!(lambdaObsNm >= WAVELENGTH_MIN && lambdaObsNm <= WAVELENGTH_MAX)) return [0, 0, 0];
  const cmf = cmfWyman(lambdaObsNm);
  const rgb = mulMat3Vec(getAdaptation(), mulMat3Vec(XYZ_TO_LINEAR_SRGB, [cmf.x, cmf.y, cmf.z]));
  // La luminance adaptée reste > 0 sur tout [360 ; 830] (vérifié par les tests).
  const adaptedLuminance = luminance(rgb);
  if (!(adaptedLuminance > 0)) return [0, 0, 0];
  const scale = cmf.y / getYBarMax() / adaptedLuminance;
  return gamutMap([rgb[0] * scale, rgb[1] * scale, rgb[2] * scale]);
}

/* ------------------------------------------------------------------------- */
/* Gamut, projecteur, tone mapping                                            */
/* ------------------------------------------------------------------------- */

/**
 * Ramène une couleur hors gamut (composante négative) dans le gamut sans changer sa
 * teinte : désaturation vers le gris de même luminance Y,
 *   c' = Y + s·(c − Y), s = Y/(Y − min(c)), si min(c) < 0 ;
 * c' est un mélange de c et de blanc (même longueur d'onde dominante, même teinte TSV),
 * avec la même luminance. Luminance ≤ 0 → noir. Les valeurs > 1 sont laissées au toneMap.
 * Le GLSL fait exactement :
 *   float Y = dot(c, vec3(0.2126, 0.7152, 0.0722));
 *   float m = min(c.r, min(c.g, c.b));
 *   if (m < 0.0) c = Y > 0.0 ? max(vec3(Y) + (c - vec3(Y)) * (Y / (Y - m)), 0.0) : vec3(0.0);
 * @param {ArrayLike<number>} rgb
 * @returns {Rgb}
 */
export function gamutMap(rgb) {
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  const m = Math.min(r, g, b);
  if (m >= 0) return [r, g, b];
  const Y = luminance(rgb);
  if (!(Y > 0)) return [0, 0, 0];
  const s = Y / (Y - m);
  return [Math.max(0, Y + (r - Y) * s), Math.max(0, Y + (g - Y) * s), Math.max(0, Y + (b - Y) * s)];
}

/**
 * Effet projecteur (« beaming ») : min(D^p, max). Avec la convention de M(D)
 * (un seul facteur D), p = 4 est physique ; la borne évite l'éblouissement.
 * GLSL : min(pow(D, uBeamExp), uBeamMax).
 * @param {number} D
 * @param {number} [p]
 * @param {number} [max]
 */
export function beamFactor(D, p = BEAM_EXPONENT, max = BEAM_MAX) {
  return Math.min(D ** p, max);
}

/**
 * Tone mapping qui préserve la teinte. m = max(r, g, b), K = knee :
 * - m ≤ K : identité ;
 * - sinon m' = K + (1 − K)·(1 − exp(−(m − K)/(1 − K))) (raccord C¹, m' < 1), et les
 *   3 canaux sont multipliés par m'/m (rapports entre canaux conservés).
 * Le GLSL utilise EXACTEMENT la même formule :
 *   vec3 relToneMap(vec3 c, float knee) {
 *     float m = max(c.r, max(c.g, c.b));
 *     if (m <= knee) return c;
 *     float w = 1.0 - knee;
 *     float mt = w > 0.0 ? knee + w * (1.0 - exp(-(m - knee) / w)) : 1.0;
 *     return c * (mt / m);
 *   }
 * (knee ≥ 1 : simple écrêtage du maximum à 1.)
 * @param {ArrayLike<number>} rgb
 * @param {number} [knee]
 * @returns {Rgb}
 */
export function toneMap(rgb, knee = TONEMAP_KNEE) {
  const m = Math.max(rgb[0], rgb[1], rgb[2]);
  if (!(m > knee)) return [rgb[0], rgb[1], rgb[2]];
  const w = 1 - knee;
  const mt = w > 0 ? knee + w * (1 - Math.exp(-(m - knee) / w)) : 1;
  const s = mt / m;
  return [rgb[0] * s, rgb[1] * s, rgb[2] * s];
}

/* ------------------------------------------------------------------------- */
/* Couleur perçue (gameplay) et classification                                */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {{kind: 'surface', reflectance: number[]}
 *   | {kind: 'line', lambda: number, intensity?: number}
 *   | {kind: 'blackbody', T: number, intensity?: number}} LightSource
 */

/**
 * Couleur telle que le joueur la voit, par la même chaîne que le shader : couleur Doppler,
 * gamut, projecteur (et exposition), tone mapping. Pour les portes, D doit venir de la
 * géométrie réelle (dopplerFactor de relativity.js).
 * @param {LightSource} source réflectance [r, g, b, ir, uv] (ir, uv absents = 0) ;
 *   `intensity` (défaut 1) multiplie les lampes
 * @param {number} D facteur Doppler (> 0)
 * @param {{beamExponent?: number, beamMax?: number, knee?: number, exposure?: number}} [opts]
 * @returns {Rgb} sRGB linéaire, composantes dans [0 ; 1[
 */
export function perceivedColor(source, D, opts = {}) {
  const {
    beamExponent = BEAM_EXPONENT,
    beamMax = BEAM_MAX,
    knee = TONEMAP_KNEE,
    exposure = 1,
  } = opts;
  assertDoppler(D);
  /** @type {Rgb} */
  let c;
  if (source.kind === 'surface') {
    const M = colorMatrix(D);
    c = [0, 0, 0];
    for (let k = 0; k < 5; k++) {
      const rho = source.reflectance[k] ?? 0;
      for (let j = 0; j < 3; j++) c[j] += rho * M[k][j];
    }
  } else if (source.kind === 'line') {
    const intensity = source.intensity ?? 1;
    c = /** @type {Rgb} */ (lineColor(source.lambda / D).map((v) => v * intensity));
  } else if (source.kind === 'blackbody') {
    const intensity = source.intensity ?? 1;
    c = /** @type {Rgb} */ (blackbodyColor(D, source.T).map((v) => v * intensity));
  } else {
    throw new TypeError(`Source lumineuse inconnue : ${/** @type {any} */ (source).kind}`);
  }
  const gain = beamFactor(D, beamExponent, beamMax) * exposure;
  const mapped = gamutMap(c);
  return toneMap([mapped[0] * gain, mapped[1] * gain, mapped[2] * gain], knee);
}

/**
 * Oklab (Ottosson 2020) depuis le sRGB linéaire → [L, a, b]. L vaut 1 pour (1, 1, 1).
 * Teinte et chroma relative C/L ne dépendent pas de l'intensité (racine cubique).
 */
function linearSrgbToOklab(rgb) {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * Seuils de classifyHue (Oklab / OKLCh). Les bornes du vert sont RÉGLÉES sur les raies :
 * après lineColor, une raie à 562 nm a la teinte 127,7° et une raie à 510 nm 165,2°,
 * si bien qu'une raie est « vert » exactement pour λ ∈ [≈ 510 ; ≈ 562] nm (porte du N3).
 * Raie de 640 nm vue de face (perceivedColor, réglages par défaut, exposition 1) : rouge,
 * orange dès β = 0,071, jaune 0,093, vert 0,130 (561,8 nm), cyan 0,223 (510,3 nm), bleu
 * 0,273, violet 0,326, bleu 0,442 (sous 398 nm, où x̄ de Wyman est sous-estimé), noir dès
 * β = 0,446 ; à c = 30 m/s, vert de 3,9 à 6,7 m/s et noir dès 13,4 m/s.
 * Avec l'adaptation du jeu (exposure = adaptationExposure(D)) : mêmes seuils jusqu'au
 * violet (la fenêtre « vert » ne change pas), puis noir dès β = 0,407 (12,2 m/s à c = 30).
 */
const HUE_RULES = Object.freeze({
  /** Clarté Oklab sous laquelle tout est « noir » (≈ 0,8 % de la luminance du blanc). */
  blackLightness: 0.2,
  /** Chroma relative C/L sous laquelle la couleur est achromatique. */
  grayRelativeChroma: 0.05,
  /** Clarté à partir de laquelle un achromatique est « blanc » (le blanc tone-mappé vaut ≈ 0,97). */
  whiteLightness: 0.9,
  /** Bornes inférieures des teintes (degrés OKLCh), dans l'ordre croissant. */
  hueStarts: /** @type {ReadonlyArray<readonly [number, string]>} */ (Object.freeze([
    [45, 'orange'],
    [75, 'jaune'],
    [128, 'vert'],
    [165, 'cyan'],
    [225, 'bleu'],
    [275, 'violet'],
    [345, 'rouge'],
  ])),
});

/**
 * Nom de la teinte d'une couleur sRGB linéaire (typiquement la sortie de perceivedColor).
 * Règles (OKLCh : clarté L, chroma C, teinte h en degrés) :
 * 1. gamutMap, puis Oklab ;
 * 2. L < 0,2 → 'noir' ;
 * 3. C/L < 0,05 → achromatique : L ≥ 0,9 → 'blanc', sinon 'gris' ;
 * 4. sinon selon h : rouge [345 ; 45[, orange [45 ; 75[, jaune [75 ; 128[,
 *    vert [128 ; 165[, cyan [165 ; 225[, bleu [225 ; 275[, violet [275 ; 345[.
 * Exemples : (1, 0, 0) 29° rouge ; (1, 1, 0) 110° jaune ; (0, 1, 0) 142° vert ;
 * (0, 1, 1) 195° cyan ; (0, 0, 1) 264° bleu ; (1, 0, 1) 328° violet.
 * Teinte et C/L sont invariantes par changement d'intensité : projecteur et tone mapping
 * ne changent pas la classe d'une couleur assez claire.
 * @param {ArrayLike<number>} rgb sRGB linéaire
 * @returns {'noir' | 'blanc' | 'gris' | 'rouge' | 'orange' | 'jaune' | 'vert' | 'cyan' | 'bleu' | 'violet'}
 */
export function classifyHue(rgb) {
  const [L, a, b] = linearSrgbToOklab(gamutMap(rgb));
  if (!(L >= HUE_RULES.blackLightness)) return 'noir';
  const chroma = Math.hypot(a, b);
  if (chroma < HUE_RULES.grayRelativeChroma * L) {
    return L >= HUE_RULES.whiteLightness ? 'blanc' : 'gris';
  }
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  /** @type {any} */
  let name = 'rouge';
  for (const [start, label] of HUE_RULES.hueStarts) {
    if (h >= start) name = label;
  }
  return name;
}

/* ------------------------------------------------------------------------- */
/* LUT Doppler                                                                */
/* ------------------------------------------------------------------------- */

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/**
 * Bits d'un half float (IEEE 754 binary16) : la valeur est d'abord arrondie en float32,
 * puis en float16 AU PLUS PROCHE PAIR (dénormaux, infinis et NaN compris).
 * NB : DataUtils.toHalfFloat de three tronque la mantisse ; dopplerLut.js peut utiliser
 * cette fonction pour que le GPU reçoive exactement ce que sampleLutLikeGpu suppose.
 * @param {number} value
 * @returns {number} entier 16 bits
 */
export function halfFloatBits(value) {
  f32Scratch[0] = value;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = (x >>> 23) & 0xff;
  const mantissa = x & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0); // ±∞, NaN
  const e = exponent - 127 + 15; // exposant biaisé du half
  if (e >= 0x1f) return sign | 0x7c00; // dépassement → ±∞
  if (e <= 0) {
    // Dénormal du half (quantum 2⁻²⁴) ou zéro.
    if (e < -10) return sign;
    const full = mantissa | 0x800000;
    const shift = 14 - e;
    let h = full >>> shift;
    const rest = full & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rest > halfway || (rest === halfway && h & 1)) h++;
    return sign | h;
  }
  let h = (e << 10) | (mantissa >>> 13);
  const rest = mantissa & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h++; // la retenue peut passer à l'exposant (→ ∞)
  return sign | h;
}

/**
 * Valeur d'un half float à partir de ses 16 bits.
 * @param {number} bits
 */
function halfBitsToNumber(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

/**
 * Arrondi float32 → float16 → nombre (au plus proche pair), comme une texture HalfFloat.
 * @param {number} value
 */
export function roundToHalfFloat(value) {
  return halfBitsToNumber(halfFloatBits(value));
}

/**
 * Données de la LUT Doppler (RGBA float32, à convertir en HalfFloat par render/dopplerLut.js).
 * - Ligne LUT_ROWS.k (k = 0..4) : colonne k de M(D) ;
 * - ligne 5 + i : blackbodyColor(D, temperatures[i]) (blackbodyRow(T) pour les valeurs par défaut).
 * - Texel i ↔ log₂ D = −L + 2L·i/(size − 1) ; taille impaire : D = 1 au centre d'un texel.
 * - Alpha = 1 (inutilisé).
 * Échantillonnage GPU (voir sampleLutLikeGpu) : x = clamp((log₂ D + L)/(2L), 0, 1),
 * u = (x·(N − 1) + 0,5)/N, v = (ligne + 0,5)/H, LinearFilter, sans mipmaps.
 * Précision avec N = 257 : exacte à D = 1 ; ailleurs l'interpolation linéaire s'écarte
 * du modèle d'au plus ≈ 2 % (vers D ≈ 1,95), arrondi half float compris.
 * Coût : ≈ 1 400 évaluations spectrales par texel (quelques dizaines de ms en tout).
 * @param {{size?: number, log2Range?: number, temperatures?: readonly number[]}} [options]
 * @returns {{data: Float32Array, width: number, height: number, log2Range: number}}
 */
export function buildDopplerLutData({
  size = LUT_SIZE,
  log2Range = LUT_LOG2_RANGE,
  temperatures = BLACKBODY_TEMPERATURES,
} = {}) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError(`Taille de LUT invalide : ${size}`);
  if (!(log2Range > 0)) throw new RangeError(`Plage de LUT invalide : ${log2Range}`);
  const width = size;
  const height = 5 + temperatures.length + 1; // + ciel dégagé (dernière ligne)
  const data = new Float32Array(width * height * 4);
  const put = (row, i, rgb) => {
    const o = (row * width + i) * 4;
    data[o] = rgb[0];
    data[o + 1] = rgb[1];
    data[o + 2] = rgb[2];
    data[o + 3] = 1;
  };
  for (let i = 0; i < width; i++) {
    const D = 2 ** (-log2Range + (2 * log2Range * i) / (size - 1));
    const M = colorMatrix(D);
    for (let k = 0; k < 5; k++) put(k, i, M[k]);
    temperatures.forEach((T, t) => put(5 + t, i, blackbodyColor(D, T)));
    put(height - 1, i, clearSkyColor(D));
  }
  return { data, width, height, log2Range };
}

/**
 * Reproduit la lecture GPU d'une ligne de la LUT : valeurs arrondies en half float,
 * x = clamp((log₂ D + L)/(2L), 0, 1), u = (x·(N − 1) + 0,5)/N, puis filtrage linéaire
 * (texel s = u·N − 0,5, interpolation entre floor(s) et floor(s) + 1, bords répétés).
 * Le centre de ligne est visé exactement (v = (ligne + 0,5)/H) : pas de mélange vertical.
 * @param {{data: Float32Array, width: number, height: number, log2Range: number}} lut
 * @param {number} D
 * @param {number} row
 * @returns {Rgb}
 */
export function sampleLutLikeGpu(lut, D, row) {
  assertDoppler(D);
  const { data, width: n, height, log2Range: L } = lut;
  if (!Number.isInteger(row) || row < 0 || row >= height) throw new RangeError(`Ligne de LUT invalide : ${row}`);
  const x = Math.min(Math.max((Math.log2(D) + L) / (2 * L), 0), 1);
  const u = (x * (n - 1) + 0.5) / n;
  const s = u * n - 0.5;
  const i0 = Math.floor(s);
  const f = s - i0;
  const texel = (i, j) => {
    const ic = Math.min(Math.max(i, 0), n - 1);
    return roundToHalfFloat(data[(row * n + ic) * 4 + j]);
  };
  return /** @type {Rgb} */ ([0, 1, 2].map((j) => (1 - f) * texel(i0, j) + f * texel(i0 + 1, j)));
}

/* ------------------------------------------------------------------------- */
/* Préréglage OpenRelativity (comparaison seulement, jamais dans la LUT)       */
/* ------------------------------------------------------------------------- */
/*
 * Repris de relativity.shader (OpenRelativity, MIT) :
 * - CMF à une gaussienne par lobe (constantes xla…zc, :27-41) et centres IR/UV (:43-47) ;
 * - RGBToXYZC, XYZToRGBC, weightFromXYZCurves (:243-267) ;
 * - intégrale analytique raie gaussienne × lobe (getX/Y/ZFromCurve, :269-297) ;
 * - constrainRGB (:299-327) ;
 * - assemblage de frag() : raies 615/550/463 nm de largeurs 8/4/5 nm, lobes IR/UV
 *   d'amplitude 0,02 et de largeur 5 nm, facteur (1/shift)³ (:356-371).
 * Convention d'OpenRelativity : shift = 1/D (la raie μ est vue à μ·shift).
 * Écarts connus (non corrigés ici, c'est un préréglage) : intensité en D² au lieu de D⁴,
 * luminance qui s'effondre au-delà de β ≈ 0,5.
 */

const OR_CMF = Object.freeze({
  xla: 0.39952807612909519, xlb: 444.63156780935032, xlc: 20.095464678736523,
  xha: 1.1305579611401821, xhb: 593.23109262398259, xhc: 34.446036241271742,
  ya: 1.0098874822455657, yb: 556.03724875218927, yc: 46.184868454550838,
  za: 2.0648400466720593, zb: 448.45126344558236, zc: 22.357297606503543,
});
const OR_IR_RANGE = 400;
const OR_IR_START = 700;
const OR_UV_RANGE = 380;
const OR_UV_START = 0;
const OR_RGB_TO_XYZ = [
  [0.13514, 0.120432, 0.057128],
  [0.0668999, 0.232706, 0.0293946],
  [0.0, 0.0000218959, 0.358278],
];
const OR_XYZ_TO_RGB = [
  [9.94845, -5.1485, -1.16389],
  [-2.86007, 5.77745, -0.0179627],
  [0.000174791, -0.000353084, 2.79113],
];
const OR_WEIGHTS_FROM_XYZ = [
  [0.0735806, -0.0380793, -0.00860837],
  [-0.0665378, 0.134408, -0.000417865],
  [0.00000299624, -0.00000605249, 0.0484424],
];
/** Raies des canaux r, g, b : [centre, largeur] (nm). */
const OR_LINES = [[615, 8], [550, 4], [463, 5]];
const OR_SIDE_AMPLITUDE = 0.02;
const OR_SIDE_WIDTH = 5;

/** ∫ raie gaussienne (amplitude, centre·shift, largeur·shift) × lobe (a, b, c). */
function orOverlap(amplitude, center, width, shift, a, b, c) {
  const s = width * shift;
  const top = amplitude * a * Math.exp(-((center * shift - b) ** 2) / (2 * (s * s + c * c)))
    * Math.sqrt(2 * Math.PI);
  return top / Math.sqrt(1 / (s * s) + 1 / (c * c));
}

/** XYZ d'une raie gaussienne vue avec shift = 1/D (sans le facteur (1/shift)³). */
function orLineXyz(amplitude, center, width, shift) {
  const k = OR_CMF;
  return [
    orOverlap(amplitude, center, width, shift, k.xla, k.xlb, k.xlc)
      + orOverlap(amplitude, center, width, shift, k.xha, k.xhb, k.xhc),
    orOverlap(amplitude, center, width, shift, k.ya, k.yb, k.yc),
    orOverlap(amplitude, center, width, shift, k.za, k.zb, k.zc),
  ];
}

/**
 * constrainRGB d'OpenRelativity : ajoute du blanc pour annuler la composante la plus
 * négative, puis divise par le maximum s'il dépasse 1.
 * @param {ArrayLike<number>} rgb
 * @returns {Rgb}
 */
export function constrainRgbOpenRelativity(rgb) {
  let [r, g, b] = [rgb[0], rgb[1], rgb[2]];
  const w = -Math.min(0, r, g, b);
  if (w > 0) {
    r += w;
    g += w;
    b += w;
  }
  const m = Math.max(r, g, b);
  if (m > 1) {
    r /= m;
    g /= m;
    b /= m;
  }
  return [r, g, b];
}

/**
 * Préréglage OpenRelativity, partie linéaire : 5 colonnes comme colorMatrix (r, g, b, ir, uv).
 * Chaque canal r, g, b devient une raie (615, 550, 463 nm) ; les colonnes ir et uv sont
 * nulles, car les lobes IR/UV d'OpenRelativity sont des termes affines (amplitude fixe,
 * position codée par la texture) : voir openRelativityColor. Pour comparaison seulement.
 * @param {number} D facteur Doppler (> 0)
 * @returns {Rgb[]}
 */
export function colorMatrixOpenRelativity(D) {
  assertDoppler(D);
  const shift = 1 / D;
  const boost = D ** 3; // pow(1/shift, 3) de frag()
  // Matrice raies → XYZ (colonne = une raie d'amplitude 1).
  const lineXyz = OR_LINES.map(([center, width]) => orLineXyz(1, center, width, shift));
  // rgb → poids des raies : weightFromXYZCurves(RGBToXYZC(rgb)).
  const weights = OR_RGB_TO_XYZ.map((_, row) => [0, 1, 2].map((col) =>
    OR_WEIGHTS_FROM_XYZ[row][0] * OR_RGB_TO_XYZ[0][col]
    + OR_WEIGHTS_FROM_XYZ[row][1] * OR_RGB_TO_XYZ[1][col]
    + OR_WEIGHTS_FROM_XYZ[row][2] * OR_RGB_TO_XYZ[2][col]));
  /** @type {Rgb[]} */
  const columns = [0, 1, 2].map((col) => {
    const xyz = [0, 0, 0];
    for (let line = 0; line < 3; line++) {
      for (let j = 0; j < 3; j++) xyz[j] += boost * lineXyz[line][j] * weights[line][col];
    }
    return /** @type {Rgb} */ (mulMat3Vec(OR_XYZ_TO_RGB, xyz));
  });
  columns.push([0, 0, 0], [0, 0, 0]);
  return columns;
}

/**
 * Couleur complète du préréglage OpenRelativity : partie linéaire, lobes IR/UV
 * (amplitude 0,02, centres 700 + 400·ir et 0 + 380·uv nm), puis constrainRGB.
 * @param {ArrayLike<number>} rgb couleur de la texture (r, g, b)
 * @param {number} D facteur Doppler (> 0)
 * @param {{ir?: number, uv?: number}} [maps] valeurs des textures IR et UV (0..1)
 * @returns {Rgb}
 */
export function openRelativityColor(rgb, D, { ir = 0, uv = 0 } = {}) {
  const M = colorMatrixOpenRelativity(D);
  const shift = 1 / D;
  const boost = D ** 3;
  const sideXyz = [
    orLineXyz(OR_SIDE_AMPLITUDE, OR_UV_START + OR_UV_RANGE * uv, OR_SIDE_WIDTH, shift),
    orLineXyz(OR_SIDE_AMPLITUDE, OR_IR_START + OR_IR_RANGE * ir, OR_SIDE_WIDTH, shift),
  ];
  const side = mulMat3Vec(OR_XYZ_TO_RGB, [0, 1, 2].map((j) => boost * (sideXyz[0][j] + sideXyz[1][j])));
  const linear = [0, 1, 2].map((j) => M[0][j] * rgb[0] + M[1][j] * rgb[1] + M[2][j] * rgb[2] + side[j]);
  return constrainRgbOpenRelativity(linear);
}
