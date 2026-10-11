/**
 * Ciel animé des menus (hud/sky.js) : calculs purs (ni DOM, ni three).
 *
 * Des étoiles immobiles dans la ville, vues par un observateur qui file droit devant à βc, β
 * montant doucement de 0 à SKY.betaMax puis redescendant. Rien n'est truqué : c'est la même
 * physique que le jeu.
 * - Aberration : une étoile vue à l'angle θ de l'axe du mouvement (au repos) paraît à θ′, avec
 *   cos θ′ = (cos θ + β)/(1 + β cos θ) : le ciel se resserre devant.
 * - Effet Doppler : D = γ(1 + β cos θ) (> 1 devant : bleu ; < 1 derrière : rouge, puis
 *   infrarouge, invisible). Une étoile corps noir de température T vue avec D est un corps noir
 *   de température D·T, plus lumineux devant (effet projecteur) : blackbodyColor·beamFactor,
 *   comme les lampes du jeu (physics/spectrum.js).
 * - Projection stéréographique (r = tan(θ′/2)) : grand champ, sans déformation des petites
 *   figures.
 */
import { beamFactor, blackbodyColor, gamutMap, luminance } from '../physics/spectrum.js';

/** Réglages du ciel : vitesse maximale, période de l'aller-retour (s), roulis (s par tour). */
export const SKY = Object.freeze({
  betaMax: 0.9,
  periodS: 30,
  rollPeriodS: 240,
  stars: 420,
  /** Températures des étoiles (K) : rouges, solaires, bleues. */
  temperatures: Object.freeze([3600, 5800, 9500]),
  /** Table des couleurs : log2 D de −3 à +3, par pas de 1/8. */
  log2Min: -3,
  log2Max: 3,
  log2Step: 1 / 8,
  /** β figé sous prefers-reduced-motion (image fixe). */
  betaStill: 0.6,
});

/**
 * β à l'instant t (s) : 0 → betaMax → 0 sur une période, en cosinus (départ et arrivée doux).
 * @param {number} t
 * @param {{betaMax?: number, periodS?: number}} [o]
 */
export function skyBeta(t, { betaMax = SKY.betaMax, periodS = SKY.periodS } = {}) {
  const phase = (((t / periodS) % 1) + 1) % 1;
  return (betaMax * (1 - Math.cos(2 * Math.PI * phase))) / 2;
}

/** γ = 1/√(1 − β²). */
export function gammaOf(beta) {
  return 1 / Math.sqrt(1 - beta * beta);
}

/**
 * Aberration le long de l'axe du mouvement : cos θ′ apparent d'une étoile à cos θ au repos.
 * @param {number} cosTheta direction au repos (θ = 0 : droit devant)
 * @param {number} beta
 */
export function aberrateCos(cosTheta, beta) {
  return (cosTheta + beta) / (1 + beta * cosTheta);
}

/**
 * Facteur Doppler D = γ(1 + β cos θ) d'une étoile à cos θ (direction au repos).
 * @param {number} cosTheta
 * @param {number} beta
 */
export function dopplerCos(cosTheta, beta) {
  return gammaOf(beta) * (1 + beta * cosTheta);
}

/**
 * Rayon stéréographique tan(θ′/2) = √((1 − cos θ′)/(1 + cos θ′)) (1 à 90°, ∞ droit derrière).
 * @param {number} cosApparent
 */
export function stereoRadius(cosApparent) {
  const c = Math.min(1, Math.max(-1, cosApparent));
  return c <= -1 ? Infinity : Math.sqrt((1 - c) / (1 + c));
}

/** Petit générateur pseudo-aléatoire déterministe (mulberry32) : le même ciel à chaque fois. */
export function random32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Étoiles uniformes sur la sphère : cos θ (axe du mouvement), azimut φ, type de température
 * (indice dans SKY.temperatures), éclat propre (0,35 à 1, beaucoup d'étoiles faibles).
 * @param {number} count
 * @param {number} [seed]
 * @returns {{cos: number, phi: number, kind: number, mag: number}[]}
 */
export function makeStars(count, seed = 1905) {
  const rand = random32(seed);
  const stars = [];
  for (let i = 0; i < count; i++) {
    const cos = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const r = rand();
    const kind = r < 0.3 ? 0 : r < 0.8 ? 1 : 2;
    const mag = 0.35 + 0.65 * rand() ** 2.5;
    stars.push({ cos, phi, kind, mag });
  }
  return stars;
}

/**
 * Table des couleurs vues : pour chaque température et chaque log2 D (pas SKY.log2Step), la
 * teinte (sRGB 0–255, maximum à 255) et la luminance relative (1 au repos, D⁴ et plus devant).
 * Calcul spectral : ≈ 150 entrées, à faire une fois, hors de la première image.
 * @returns {{rgb: string[][], intensity: Float64Array[]}} rgb[k][i] « rgb(r g b) »
 */
export function starColorTable({ temperatures = SKY.temperatures, log2Min = SKY.log2Min, log2Max = SKY.log2Max, log2Step = SKY.log2Step } = {}) {
  const steps = Math.round((log2Max - log2Min) / log2Step) + 1;
  const rgb = [];
  const intensity = [];
  for (const T of temperatures) {
    const row = [];
    const lum = new Float64Array(steps);
    for (let i = 0; i < steps; i++) {
      const D = 2 ** (log2Min + i * log2Step);
      const c = gamutMap(blackbodyColor(D, T).map((v) => v * beamFactor(D)));
      const m = Math.max(c[0], c[1], c[2]);
      const to255 = (v) => (m > 0 ? Math.round(255 * Math.min(1, v / m) ** (1 / 2.2)) : 0); // sRGB approché
      row.push(`rgb(${to255(c[0])} ${to255(c[1])} ${to255(c[2])})`);
      lum[i] = Math.max(0, luminance(c));
    }
    rgb.push(row);
    intensity.push(lum);
  }
  return { rgb, intensity };
}

/**
 * Indice de la table pour un facteur Doppler D (borné aux extrémités).
 * @param {number} D
 */
export function tableIndex(D, { log2Min = SKY.log2Min, log2Max = SKY.log2Max, log2Step = SKY.log2Step } = {}) {
  const l = Math.min(log2Max, Math.max(log2Min, Math.log2(D)));
  return Math.round((l - log2Min) / log2Step);
}

/**
 * Opacité et rayon relatifs d'une étoile d'éclat propre `mag` et de luminance relative I
 * (perception compressée : une étoile mille fois plus lumineuse n'est pas mille fois plus grosse).
 * @param {number} I
 * @param {number} mag
 * @returns {{alpha: number, size: number}}
 */
export function starLook(I, mag) {
  const p = Math.max(0, I) ** 0.2;
  return { alpha: Math.min(1, 0.95 * mag * p), size: Math.min(2.4, Math.max(0.6, p ** 0.7)) * (0.75 + 0.75 * mag) };
}

/**
 * Lecture « β = 0,62 · γ = 1,27 » (virgule décimale, deux décimales tronquées).
 * @param {number} beta
 */
export function formatSkyReadout(beta) {
  const two = (x) => (Math.floor(x * 100 + 1e-9) / 100).toFixed(2).replace('.', ',');
  return `v = ${two(beta)} c · γ = ${two(gammaOf(beta))}`;
}
