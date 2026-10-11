// Tests de src/render/lod.js : coefficient κ, borne de D, seuils, hystérésis,
// et vérification numérique que la règle tient l'erreur de corde sous ε.
import { describe, expect, it } from 'vitest';
import { aberrate } from '../src/physics/relativity.js';
import {
  LOD_EPSILON,
  LOD_HYSTERESIS,
  LOD_KAPPA_MAX,
  apparentNearestDistance,
  chooseLod,
  dopplerMin,
  lodKappa,
} from '../src/render/lod.js';

const STEPS = [1.5, 5, 15];
const gammaOf = (beta) => 1 / Math.sqrt(1 - beta * beta);

/** Générateur pseudo-aléatoire à graine fixe (mulberry32). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('κ et borne de D', () => {
  it('ε vaut 2 px CSS à hFOV 90° (≈ 4,4 mrad)', () => {
    expect(LOD_EPSILON).toBeCloseTo(4.37e-3, 5);
    expect(LOD_HYSTERESIS).toBe(0.1);
  });

  it('κ = 0,2 à l\'arrêt et à basse vitesse, puis √(8ε/(γβ))', () => {
    expect(lodKappa(1, 0)).toBe(LOD_KAPPA_MAX);
    expect(lodKappa(gammaOf(0.3), 0.3)).toBe(0.2);
    const b = 0.9;
    const g = gammaOf(b);
    expect(lodKappa(g, b)).toBeCloseTo(Math.sqrt((8 * LOD_EPSILON) / (g * b)), 14);
    // Décroissant avec la vitesse.
    let previous = Infinity;
    for (const beta of [0, 0.3, 0.6, 0.76, 0.9, 0.95, 0.99]) {
      const k = lodKappa(gammaOf(beta), beta);
      expect(k).toBeLessThanOrEqual(previous);
      previous = k;
    }
  });

  it('D minimal : γ(1 − β) = e^(−φ) sur toute la sphère, γ(1 + β) droit devant', () => {
    for (const beta of [0, 0.5, 0.9]) {
      const g = gammaOf(beta);
      expect(dopplerMin(g, beta)).toBeCloseTo(g * (1 - beta), 12);
      expect(dopplerMin(g, beta)).toBeCloseTo(Math.exp(-Math.atanh(beta)), 12);
      expect(dopplerMin(g, beta, 0)).toBeCloseTo(g * (1 + beta), 12);
    }
    // Plus le champ est étroit, plus la borne est haute.
    const g = gammaOf(0.9);
    expect(dopplerMin(g, 0.9, Math.PI / 4)).toBeGreaterThan(dopplerMin(g, 0.9, Math.PI / 2));
    expect(apparentNearestDistance(50, g, 0.9)).toBeCloseTo(50 * g * 0.1, 12);
  });
});

describe('chooseLod', () => {
  it('applique les seuils s_k ≤ 0,2·d à l\'arrêt (LOD1 dès 25 m, LOD2 dès 75 m)', () => {
    const at = (d) => chooseLod(null, d, 1, 0, STEPS);
    expect(at(0)).toBe(0);
    expect(at(24.9)).toBe(0);
    expect(at(25)).toBe(1);
    expect(at(74.9)).toBe(1);
    expect(at(75)).toBe(2);
    expect(at(5000)).toBe(2);
  });

  it('accepte un LOD courant absent ou invalide (choix strict)', () => {
    for (const current of [undefined, null, -1, 3, 1.5]) expect(chooseLod(current, 80, 1, 0, STEPS)).toBe(2);
  });

  it('affine immédiatement, mais ne grossit qu\'avec 10 % de marge', () => {
    // Depuis LOD1 : LOD2 seulement à partir de 75 × 1,1 = 82,5 m.
    expect(chooseLod(1, 76, 1, 0, STEPS)).toBe(1);
    expect(chooseLod(1, 82.4, 1, 0, STEPS)).toBe(1);
    expect(chooseLod(1, 82.5, 1, 0, STEPS)).toBe(2);
    // Depuis LOD2 : retour à LOD1 dès que la règle stricte l'exige.
    expect(chooseLod(2, 76, 1, 0, STEPS)).toBe(2);
    expect(chooseLod(2, 74.9, 1, 0, STEPS)).toBe(1);
    // Depuis LOD0 loin : on saute directement au plus grossier permis avec marge.
    expect(chooseLod(0, 1000, 1, 0, STEPS)).toBe(2);
    expect(chooseLod(0, 80, 1, 0, STEPS)).toBe(1);
    // Hystérésis réglable.
    expect(chooseLod(1, 76, 1, 0, STEPS, { hysteresis: 0 })).toBe(2);
  });

  it('ne clignote pas quand la distance oscille autour d\'un seuil', () => {
    let lod = chooseLod(null, 74, 1, 0, STEPS);
    const changes = [];
    for (let i = 0; i < 200; i++) {
      const d = 75 + 3 * Math.sin(i / 3); // de 72 à 78 m
      const next = chooseLod(lod, d, 1, 0, STEPS);
      if (next !== lod) changes.push(i);
      lod = next;
    }
    expect(lod).toBe(1);
    expect(changes).toHaveLength(0);
  });

  it('est plus fin à grande vitesse, à distance monde égale', () => {
    for (const d of [10, 30, 60, 120, 250, 500]) {
      let previous = Infinity;
      for (const beta of [0, 0.5, 0.76, 0.9, 0.95]) {
        const g = gammaOf(beta);
        const lod = chooseLod(null, apparentNearestDistance(d, g, beta), g, beta, STEPS);
        expect(lod, `d = ${d} m, β = ${beta}`).toBeLessThanOrEqual(previous);
        previous = lod;
      }
    }
    // Exemple : à 100 m, LOD2 à l'arrêt, LOD1 à β = 0,76, LOD0 à β = 0,95.
    const pick = (beta) => chooseLod(null, apparentNearestDistance(100, gammaOf(beta), beta), gammaOf(beta), beta, STEPS);
    expect([pick(0), pick(0.76), pick(0.95)]).toEqual([2, 1, 0]);
  });

  it('se rabat sur le LOD le plus fin quand aucun ne suffit', () => {
    expect(chooseLod(2, 0.5, gammaOf(0.95), 0.95, STEPS)).toBe(0);
  });
});

describe('la règle tient l\'erreur de corde sous ε', () => {
  it('segment de longueur κ·r·D : écart à la courbe aberrée ≤ ε', () => {
    const norm = (v) => {
      const l = Math.hypot(v.x, v.y, v.z);
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    };
    const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const r = rng(7);
    for (const b of [0.5, 0.76, 0.9, 0.95]) {
      const g = gammaOf(b);
      const beta = { x: b, y: 0, z: 0 };
      const kappa = lodKappa(g, b);
      let worst = 0;
      for (let it = 0; it < 600; it++) {
        // Milieu dans une direction quelconque, à 5–100 m ; orientation quelconque.
        const m = norm({ x: 2 * r() - 1, y: 2 * r() - 1, z: 2 * r() - 1 });
        const dist = 5 + 95 * r();
        const s = kappa * dist * g * (1 + dot(beta, m)); // pas au seuil (D au milieu)
        const u = norm({ x: 2 * r() - 1, y: 2 * r() - 1, z: 2 * r() - 1 });
        const point = (t) => ({
          x: m.x * dist + u.x * s * (t - 0.5),
          y: m.y * dist + u.y * s * (t - 0.5),
          z: m.z * dist + u.z * s * (t - 0.5),
        });
        // Grand cercle des extrémités aberrées = ce que trace le GPU entre deux sommets.
        const pole = norm(cross(aberrate(beta, norm(point(0))), aberrate(beta, norm(point(1)))));
        for (let i = 1; i < 16; i++) {
          const p = aberrate(beta, norm(point(i / 16)));
          worst = Math.max(worst, Math.abs(Math.asin(Math.min(1, Math.max(-1, dot(p, pole))))));
        }
      }
      expect(worst, `β = ${b}`).toBeLessThanOrEqual(1.05 * LOD_EPSILON);
    }
  });
});
