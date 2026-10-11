/*! Adapté d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, RelativisticObject.cs:316-328 ; relativity.shader:176-182 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
/**
 * Temps retardé des objets mobiles (module pur : ni DOM, ni three).
 *
 * On voit un objet là où il était quand il a émis la lumière qui nous parvient : à
 * l'instant t (temps de la ville), l'observateur en x_obs reçoit la lumière émise à te tel que
 *   c·(t − te) = |x_obs − p(te)|,  te ≤ t.
 * Le cône de lumière est invariant : la vitesse de l'observateur n'intervient pas.
 * Si l'objet va moins vite que la lumière, la racine est unique.
 *
 * Reprise d'OpenRelativity : la forme fermée du mouvement uniforme est leur équation du
 * second degré (RelativisticObject.cs:316-328, relativity.shader:176-182), réécrite sous une
 * forme sans annulation. Elle sert de solution exacte (mouvement uniforme) et d'amorce
 * pour le cas général, résolu par Newton sécurisé par bissection.
 */
import { C } from './constants.js';

/** Pas (s) de la différence finie centrée qui estime la vitesse de l'objet. */
const DERIVATIVE_STEP = 1e-4;

/**
 * Distance entre deux points {x, y, z} (z absent = 0).
 * @param {{x: number, y: number, z?: number}} a
 * @param {{x: number, y: number, z?: number}} b
 */
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/**
 * Retard t − te pour un objet en mouvement uniforme de vitesse w, qui est en p à l'instant
 * de réception. Avec d = x_obs − p, racine positive de (c² − w²)τ² − 2(d·w)τ − |d|² = 0 :
 *   τ = ((d·w) + √((d·w)² + (c² − w²)|d|²))/(c² − w²),
 * écrite sous la forme conjuguée |d|²/(√… − d·w) quand d·w < 0 (pas d'annulation).
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @param {number} wx
 * @param {number} wy
 * @param {number} wz
 */
function uniformDelay(dx, dy, dz, wx, wy, wz) {
  const w2 = wx * wx + wy * wy + wz * wz;
  if (!(w2 < C * C)) throw new RangeError('Temps retardé : l’objet doit aller moins vite que la lumière');
  // Objet immobile : simple retard r/c (même calcul de r que dans retardedTime, au bit près).
  if (w2 === 0) return Math.hypot(dx, dy, dz) / C;
  const d2 = dx * dx + dy * dy + dz * dz;
  const dw = dx * wx + dy * wy + dz * wz;
  const root = Math.sqrt(dw * dw + (C * C - w2) * d2);
  return dw >= 0 ? (dw + root) / (C * C - w2) : d2 / (root - dw);
}

/**
 * Forme fermée pour un mouvement uniforme p(te) = p0 + w·(te − t0), |w| < c.
 * @param {{x: number, y: number, z?: number}} observer position de l'observateur à l'instant t
 * @param {number} t instant de réception (temps de la ville)
 * @param {{x: number, y: number, z?: number}} p0 position de l'objet à l'instant t0
 * @param {{x: number, y: number, z?: number}} w vitesse de l'objet (m/s)
 * @param {number} t0
 * @returns {number} te
 */
export function retardedTimeUniform(observer, t, p0, w, t0) {
  const wz = w.z ?? 0;
  const s = t - t0;
  const dx = observer.x - (p0.x + w.x * s);
  const dy = observer.y - (p0.y + w.y * s);
  const dz = (observer.z ?? 0) - ((p0.z ?? 0) + wz * s);
  return t - uniformDelay(dx, dy, dz, w.x, w.y, wz);
}

/**
 * Résout te = t − |observer − positionAt(te)|/c (te ≤ t) par Newton sécurisé.
 *
 * On travaille sur le retard d = t − te ≥ 0 : G(d) = d − |observer − p(t − d)|/c est
 * strictement croissante (G' = 1 − n̂·w/c ≥ 1 − β > 0), G(0) ≤ 0, d'où une racine unique.
 * - Amorce : `guess` (te de l'image précédente, par exemple) ou, à défaut, la forme fermée
 *   du mouvement uniforme à la vitesse de l'objet en t (exacte si l'objet est uniforme).
 * - Chaque itération évalue G (et une différence finie centrée pour G'), resserre
 *   l'encadrement [lo, hi] de la racine (bornes inclusives), puis fait un pas de Newton ;
 *   si ce pas sort de l'encadrement, bissection (ou, tant qu'aucune borne haute n'est
 *   connue, pas de point fixe d ← |observer − p(t − d)|/c, qui monte vers la racine).
 * - Sortie anticipée si G est exactement nul ; arrêt quand le pas est ≤ tolerance.
 * @param {{x: number, y: number, z?: number}} observer position de l'observateur à l'instant t
 * @param {number} t instant de réception (temps de la ville)
 * @param {(te: number) => {x: number, y: number, z?: number}} positionAt trajectoire (ville)
 * @param {{tolerance?: number, maxIterations?: number, guess?: number}} [options]
 *   tolerance en secondes sur te ; guess : te de départ.
 * @returns {{te: number, iterations: number}} iterations = nombre d'évaluations de G
 */
export function retardedTime(observer, t, positionAt, { tolerance = 1e-5, maxIterations = 30, guess } = {}) {
  /**
   * Position de l'objet à l'émission te = t − d et différence finie de sa vitesse.
   * @param {number} d retard (s)
   */
  const sample = (d) => {
    const te = t - d;
    const p = positionAt(te);
    const pPlus = positionAt(te + DERIVATIVE_STEP);
    const pMinus = positionAt(te - DERIVATIVE_STEP);
    const k = 1 / (2 * DERIVATIVE_STEP);
    return {
      p,
      wx: (pPlus.x - pMinus.x) * k,
      wy: (pPlus.y - pMinus.y) * k,
      wz: ((pPlus.z ?? 0) - (pMinus.z ?? 0)) * k,
    };
  };

  // Amorce.
  let d;
  if (typeof guess === 'number' && Number.isFinite(guess) && guess <= t) {
    d = t - guess;
  } else {
    const now = sample(0);
    const dx = observer.x - now.p.x;
    const dy = observer.y - now.p.y;
    const dz = (observer.z ?? 0) - (now.p.z ?? 0);
    const w2 = now.wx * now.wx + now.wy * now.wy + now.wz * now.wz;
    d = w2 < C * C ? uniformDelay(dx, dy, dz, now.wx, now.wy, now.wz) : Math.hypot(dx, dy, dz) / C;
  }

  let lo = 0; // G(lo) ≤ 0
  let hi = Infinity; // G(hi) ≥ 0, inconnue au départ
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    const { p, wx, wy, wz } = sample(d);
    const rx = observer.x - p.x;
    const ry = observer.y - p.y;
    const rz = (observer.z ?? 0) - (p.z ?? 0);
    const r = Math.hypot(rx, ry, rz);
    const g = d - r / C;
    if (g === 0) break; // résidu nul : d est la racine
    if (g < 0) lo = d;
    else hi = d;

    // G'(d) = 1 − n̂·w/c, n̂ = direction de l'objet vers l'observateur.
    const slope = r > 0 ? 1 - (rx * wx + ry * wy + rz * wz) / (r * C) : 1;
    /** @type {number} */
    let next = d - g / slope;
    if (!(slope > 0 && next >= lo && next <= hi)) {
      next = hi < Infinity ? 0.5 * (lo + hi) : r / C;
    }
    const change = Math.abs(next - d);
    d = next;
    if (change <= tolerance) break;
  }
  return { te: t - d, iterations };
}

/**
 * Historique en anneau des positions d'un objet (pour les objets réactifs, sans
 * trajectoire analytique), interpolé linéairement.
 *
 * Un nouvel échantillon n'est gardé que s'il est à au moins `interval` secondes du
 * précédent ; entre-temps, le dernier échantillon est provisoire et remplacé à chaque
 * `push`, de sorte que la position la plus récente est toujours connue. Au-delà de
 * `capacity` échantillons, les plus anciens sont oubliés. Si le temps recule
 * (redémarrage du niveau), l'historique repart de zéro.
 * @param {{capacity: number, interval?: number}} options
 *   capacity ≥ 2 : prévoir (retard maximal)/interval + 2, par exemple 30 s/0,05 s + 2.
 * @returns {{push: (t: number, p: {x: number, y: number, z?: number}) => void,
 *            positionAt: (t: number) => {x: number, y: number, z: number}}}
 */
export function createHistory({ capacity, interval = 0 }) {
  if (!(Number.isInteger(capacity) && capacity >= 2)) {
    throw new RangeError(`createHistory : capacity doit être un entier ≥ 2 (reçu : ${capacity})`);
  }
  const times = new Float64Array(capacity);
  const xs = new Float64Array(capacity);
  const ys = new Float64Array(capacity);
  const zs = new Float64Array(capacity);
  let first = 0; // indice de l'échantillon le plus ancien
  let count = 0;
  /** @param {number} j rang chronologique (0 = le plus ancien) → indice dans l'anneau */
  const slot = (j) => (first + j) % capacity;

  /**
   * Ajoute la position p de l'objet à l'instant t (temps de la ville).
   * @param {number} t
   * @param {{x: number, y: number, z?: number}} p
   */
  function push(t, p) {
    let i;
    const last = count > 0 ? slot(count - 1) : -1;
    if (count > 0 && t < times[last]) count = 0; // le temps recule : on repart de zéro
    if (count > 0 && (t === times[last] || (count >= 2 && times[last] - times[slot(count - 2)] < interval))) {
      i = last; // échantillon provisoire (ou même instant) : remplacé
    } else if (count < capacity) {
      i = slot(count);
      count++;
    } else {
      i = first; // anneau plein : on écrase le plus ancien
      first = (first + 1) % capacity;
    }
    times[i] = t;
    xs[i] = p.x;
    ys[i] = p.y;
    zs[i] = p.z ?? 0;
  }

  /**
   * Position interpolée à l'instant t (bornée aux échantillons extrêmes).
   * @param {number} t
   */
  function positionAt(t) {
    if (count === 0) throw new Error('Historique vide : aucune position connue');
    /** @param {number} i */
    const at = (i) => ({ x: xs[i], y: ys[i], z: zs[i] });
    const oldest = slot(0);
    const newest = slot(count - 1);
    if (t <= times[oldest]) return at(oldest);
    if (t >= times[newest]) return at(newest);
    // Recherche dichotomique de l'intervalle [a, b] qui contient t.
    let lo = 0;
    let hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[slot(mid)] <= t) lo = mid;
      else hi = mid;
    }
    const a = slot(lo);
    const b = slot(hi);
    const f = (t - times[a]) / (times[b] - times[a]);
    return { x: xs[a] + f * (xs[b] - xs[a]), y: ys[a] + f * (ys[b] - ys[a]), z: zs[a] + f * (zs[b] - zs[a]) };
  }

  return { push, positionAt };
}
