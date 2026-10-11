// Tests de src/physics/retarded.js : temps retardé (Newton sécurisé), forme fermée du
// mouvement uniforme, historique en anneau.
import { describe, expect, it } from 'vitest';
import { C } from '../src/physics/constants.js';
import { createHistory, retardedTime, retardedTimeUniform } from '../src/physics/retarded.js';

/** Vérifie |actual − expected| ≤ tol. */
function expectNear(actual, expected, tol) {
  expect(Math.abs(actual - expected), `${actual} au lieu de ${expected}`).toBeLessThanOrEqual(tol);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/**
 * Référence indépendante : bissection pure (200 itérations) de c(t − te) = |obs − p(te)|.
 * @param {number} [c] vitesse de la lumière (m/s)
 */
function bisectionReference(observer, t, positionAt, span = 1e4, c = C) {
  let lo = t - span; // trop tôt : c(t − te) > distance
  let hi = t;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (c * (t - mid) - dist(observer, positionAt(mid)) > 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Mouvement uniforme p(te) = p0 + w·(te − t0). */
const uniform = (p0, w, t0) => (te) => ({
  x: p0.x + w.x * (te - t0),
  y: p0.y + w.y * (te - t0),
  z: p0.z + w.z * (te - t0),
});

/**
 * Les mêmes cas pour c = 100 m/s (cahier des charges, c injectée) et pour le réglage par
 * défaut (c = C = 30 m/s, sans injection). Les longueurs sont à l'échelle S = c/100 et les
 * vitesses en fractions de c : le problème sans dimension est le même, si bien que les temps
 * attendus (en secondes) et les nombres d'itérations ne dépendent pas de c.
 */
const CASES = [
  { label: 'c = 100 m/s injectée', c: 100, inject: true },
  { label: `c = ${C} m/s (réglage par défaut)`, c: C, inject: false },
];

describe.each(CASES)('temps retardé ($label)', ({ c, inject }) => {
  const S = c / 100;
  /** Options de c : injectée, ou absente (défaut C). */
  const withC = (options = {}) => (inject ? { ...options, c } : options);
  const uniformTime = (observer, t, p0, w, t0) =>
    inject ? retardedTimeUniform(observer, t, p0, w, t0, c) : retardedTimeUniform(observer, t, p0, w, t0);
  const solve = (observer, t, positionAt, options) => retardedTime(observer, t, positionAt, withC(options));
  const reference = (observer, t, positionAt) => bisectionReference(observer, t, positionAt, 1e4, c);
  const P = (x, y, z = 0) => ({ x: S * x, y: S * y, z: S * z });

  describe('retardedTimeUniform (forme fermée)', () => {
    it('objet immobile : t − r/c', () => {
      const te = uniformTime(P(0, 0), 10, P(300, 400), { x: 0, y: 0, z: 0 }, 0);
      expectNear(te, 5, 1e-12);
    });

    it('mouvement colinéaire : retard r/(c − v) en approche, r/(c + v) en éloignement', () => {
      const obs = P(0, 0);
      // À t = 20, l'objet est à 3c (300 m à c = 100). En approche à c/2 : 3c/(c − c/2) = 6 s.
      expectNear(uniformTime(obs, 20, P(300, 0), { x: -0.5 * c, y: 0, z: 0 }, 20), 14, 1e-12);
      // En éloignement à c/2 : 3c/(c + c/2) = 2 s.
      expectNear(uniformTime(obs, 20, P(300, 0), { x: 0.5 * c, y: 0, z: 0 }, 20), 18, 1e-12);
    });

    it('vérifie l’équation du cône de lumière (formes conjuguées comprises)', () => {
      const obs = P(12, -7, 1.6);
      for (const b of [0.01, 0.3, 0.9, 0.99, 0.999]) {
        for (const ang of [0, 1, 2, 3, 4, 5]) {
          const w = { x: b * c * Math.cos(ang), y: b * c * Math.sin(ang), z: 0 };
          const p0 = P(150, 200, 3);
          const te = uniformTime(obs, 5, p0, w, 1);
          const p = uniform(p0, w, 1)(te);
          expect(te).toBeLessThanOrEqual(5);
          expectNear(c * (5 - te), dist(obs, p), 1e-9 * Math.max(1, c * (5 - te)));
        }
      }
    });

    it('refuse |w| ≥ c', () => {
      expect(() => uniformTime(P(0, 0), 0, { x: 1, y: 0, z: 0 }, { x: c, y: 0, z: 0 }, 0)).toThrow();
    });
  });

  describe('retardedTime (Newton sécurisé)', () => {
    const observer = { x: 0, y: 0, z: 1.6 };

    it('mouvement uniforme : égal à la forme fermée (1e-6), ≤ 8 itérations jusqu’à β = 0,99', () => {
      let worstIterations = 0;
      for (const b of [0.01, 0.1, 0.3, 0.5, 0.9, 0.95, 0.99]) {
        for (const ang of [0, 0.7, Math.PI / 2, 2.5, Math.PI, 4, 5.5]) {
          const w = { x: b * c * Math.cos(ang), y: b * c * Math.sin(ang), z: 0 };
          const p0 = P(150, 200, 3);
          const t = 5;
          const exact = uniformTime(observer, t, p0, w, 0);
          // Amorces : par défaut, la pire (te = t) et une valeur décalée (image précédente).
          for (const guess of [undefined, t, exact - 0.5, exact - 30]) {
            const res = solve(observer, t, uniform(p0, w, 0), { guess });
            expectNear(res.te, exact, 1e-6);
            worstIterations = Math.max(worstIterations, res.iterations);
          }
        }
      }
      expect(worstIterations).toBeLessThanOrEqual(8);
    });

    it('trajectoires non uniformes jusqu’à β = 0,99 : ≤ 8 itérations, accord avec la bissection', () => {
      const trajectories = [];
      for (const b of [0.1, 0.5, 0.9, 0.99]) {
        // Manège de rayon 5c (500 m à c = 100) : retard plus court qu'un tour.
        const R = 500 * S;
        const om = (b * c) / R;
        trajectories.push((te) => ({ x: R * Math.cos(om * te), y: R * Math.sin(om * te), z: 0 }));
        // Mouvement hyperbolique (accélération propre constante) qui atteint β en t = 10 s.
        const g = (c * (b / Math.sqrt(1 - b * b))) / 10;
        const L = (c * c) / g;
        trajectories.push((te) => ({ x: L * (Math.sqrt(1 + ((g * te) / c) ** 2) - 1) - 300 * S, y: 150 * S, z: 0 }));
      }
      let worstIterations = 0;
      for (const positionAt of trajectories) {
        for (const ox of [-300, 0, 400]) {
          for (const t of [0, 3.3, 10]) {
            const obs = P(ox, 120);
            const ref = reference(obs, t, positionAt);
            for (const guess of [undefined, t]) {
              const res = solve(obs, t, positionAt, { guess });
              expect(res.converged).toBe(true);
              expectNear(res.te, ref, 1e-6);
              worstIterations = Math.max(worstIterations, res.iterations);
            }
          }
        }
      }
      expect(worstIterations).toBeLessThanOrEqual(8);
    });

    it('résidu nul dès le départ : 1 itération', () => {
      // Objet immobile, amorce par défaut (t − r/c, exacte).
      const fixed = solve(P(0, 0), 10, () => P(300, 0));
      expect(fixed.iterations).toBe(1);
      expect(fixed.converged).toBe(true);
      expectNear(fixed.te, 7, 1e-12);
      const far = P(123.456, -78.9, 2);
      const fixed2 = solve(P(0, 0), 10, () => far);
      expect(fixed2.iterations).toBe(1);
      expect(fixed2.te).toBe(10 - Math.hypot(far.x, far.y, far.z) / c);
      // Objet mobile, amorce exacte : p(8) est à 1 s-lumière de l'observateur à t = 9
      // (x = c·te/2 − 3c : p(8) = (c, 0, 0)).
      const moving = solve({ x: 0, y: 0, z: 0 }, 9, (te) => ({ x: 0.5 * c * te - 3 * c, y: 0, z: 0 }), { guess: 8 });
      expect(moving).toEqual({ te: 8, iterations: 1, converged: true });
      // Objet qui passe sur l'observateur à l'instant t : te = t (borne incluse).
      const crossing = solve({ x: 5, y: 5, z: 0 }, 3, (te) => ({ x: 5 + 0.4 * c * (te - 3), y: 5, z: 0 }));
      expect(crossing).toEqual({ te: 3, iterations: 1, converged: true });
    });

    it('cas difficiles (orbite serrée à β = 0,99, amorce lointaine) : la bissection garantit la convergence', () => {
      const R = 20 * S;
      const om = (0.99 * c) / R;
      const orbit = (te) => ({ x: R * Math.cos(om * te), y: R * Math.sin(om * te), z: 0 });
      for (const ox of [-300, 0, 50, 400]) {
        for (const t of [0, 3.3, 17]) {
          const obs = P(ox, 120);
          const ref = reference(obs, t, orbit);
          for (const guess of [undefined, t, t - 500]) {
            const res = solve(obs, t, orbit, { guess, tolerance: 1e-9 });
            expect(res.iterations).toBeLessThan(30);
            expectNear(res.te, ref, 1e-8);
          }
        }
      }
    });

    it('trajectoire anguleuse (marcheur par segments) : accord avec la bissection', () => {
      const way = [
        [0, 0, 0],
        [20, 30, 0],
        [25, 30, 0],
        [45, 30, 25],
        [60, 0, 25],
      ];
      const walker = (te) => {
        if (te <= way[0][0]) return P(way[0][1], way[0][2]);
        for (let i = 1; i < way.length; i++) {
          if (te <= way[i][0]) {
            const [ta, xa, ya] = way[i - 1];
            const [tb, xb, yb] = way[i];
            const f = (te - ta) / (tb - ta);
            return P(xa + f * (xb - xa), ya + f * (yb - ya));
          }
        }
        const last = way[way.length - 1];
        return P(last[1], last[2]);
      };
      for (let t = 0; t < 70; t += 0.37) {
        const obs = P(-150 + 2 * t, 80);
        const res = solve(obs, t, walker);
        expectNear(res.te, reference(obs, t, walker), 1e-5);
        expect(res.iterations).toBeLessThanOrEqual(8);
      }
    });

    it('vitesse qui tend vers c dans le passé, observateur derrière l’horizon : converged = false', () => {
      // Mouvement hyperbolique des cas réguliers (β = 0,99 en t = 10 s) : venu de x = +∞ presque
      // à c, ses rayons vers −x vérifient x + ct > −L − 3c ≈ −4,42c (−442 m à c = 100). À t = 0,
      // x = −6c n'a encore reçu aucune lumière : G(d) < 0 pour tout d, il n'y a pas de racine.
      const g = (c * (0.99 / Math.sqrt(1 - 0.99 * 0.99))) / 10;
      const L = (c * c) / g;
      const hyper = (te) => ({ x: L * (Math.sqrt(1 + ((g * te) / c) ** 2) - 1) - 300 * S, y: 150 * S, z: 0 });
      const behind = solve(P(-600, 120), 0, hyper);
      expect(behind.converged).toBe(false);
      expect(behind.iterations).toBe(30);
      const seen = solve(P(-300, 120), 0, hyper);
      expect(seen.converged).toBe(true);
      expectNear(seen.te, reference(P(-300, 120), 0, hyper), 1e-6);
    });

    it('sert de trajectoire à retardedTime via createHistory (mouvement uniforme : 1e-6)', () => {
      const p0 = P(-400, 300);
      const w = { x: 0.6 * c, y: -0.2 * c, z: 0 };
      const truth = uniform(p0, w, 0);
      const h = createHistory({ capacity: 30 * 20 + 2, interval: 0.05 });
      for (let i = 0; i <= 20 * 60; i++) h.push(i / 60, truth(i / 60));
      const obs = P(50, -100, 1.6);
      const res = solve(obs, 20, h.positionAt);
      expectNear(res.te, uniformTime(obs, 20, p0, w, 0), 1e-6);
      expect(res.iterations).toBeLessThanOrEqual(8);
    });
  });
});

describe('createHistory', () => {
  it('interpole linéairement entre les échantillons et borne aux extrémités', () => {
    const h = createHistory({ capacity: 10 });
    h.push(0, { x: 0, y: 0, z: 0 });
    h.push(1, { x: 10, y: -4, z: 2 });
    h.push(3, { x: 10, y: 0, z: 0 });
    expect(h.positionAt(0.5)).toEqual({ x: 5, y: -2, z: 1 });
    expect(h.positionAt(2)).toEqual({ x: 10, y: -2, z: 1 });
    expect(h.positionAt(-5)).toEqual({ x: 0, y: 0, z: 0 });
    expect(h.positionAt(99)).toEqual({ x: 10, y: 0, z: 0 });
    expect(h.positionAt(1)).toEqual({ x: 10, y: -4, z: 2 });
  });

  it('oublie les échantillons les plus anciens au-delà de la capacité', () => {
    const h = createHistory({ capacity: 4 });
    for (let i = 0; i <= 10; i++) h.push(i, { x: i * i, y: 0 });
    // Restent t = 7, 8, 9, 10.
    expect(h.positionAt(0).x).toBe(49);
    expect(h.positionAt(7.5).x).toBe(56.5);
    expect(h.positionAt(9.25).x).toBe(81 + 0.25 * 19);
    expect(h.positionAt(12).x).toBe(100);
  });

  it('interval : un échantillon gardé par intervalle, la position la plus récente toujours connue', () => {
    const h = createHistory({ capacity: 4, interval: 0.05 });
    const pos = (t) => ({ x: 20 * t, y: 5 * t * t, z: 0 });
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      h.push(t, pos(t));
      expect(h.positionAt(t)).toEqual(pos(t)); // le dernier échantillon suit l'objet
    }
    // Quatre échantillons, dont trois définitifs espacés d'au moins `interval` : au moins
    // 0,1 s d'historique (sans `interval`, il ne resterait que les 4 dernières images, 0,05 s).
    const covered = 1 - 0.1;
    expectNear(h.positionAt(covered).x, 20 * covered, 1e-9); // x est linéaire : exact
    // y est quadratique : erreur d'interpolation ≤ Δ²·|y''|/8, Δ ≤ interval + 1/60.
    expectNear(h.positionAt(covered).y, 5 * covered * covered, ((0.05 + 1 / 60) ** 2 * 10) / 8);
  });

  it('le temps qui recule (redémarrage) vide l’historique ; historique vide = erreur', () => {
    const h = createHistory({ capacity: 8 });
    expect(() => h.positionAt(0)).toThrow();
    h.push(5, { x: 1, y: 1 });
    h.push(6, { x: 2, y: 2 });
    h.push(1, { x: -7, y: 0 });
    expect(h.positionAt(5.5)).toEqual({ x: -7, y: 0, z: 0 });
    expect(() => createHistory({ capacity: 1 })).toThrow();
  });
});
