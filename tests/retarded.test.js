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

/** Référence indépendante : bissection pure (200 itérations) de c(t − te) = |obs − p(te)|. */
function bisectionReference(observer, t, positionAt, span = 1e4) {
  let lo = t - span; // trop tôt : c(t − te) > distance
  let hi = t;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (C * (t - mid) - dist(observer, positionAt(mid)) > 0) lo = mid;
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

describe('retardedTimeUniform (forme fermée)', () => {
  it('objet immobile : t − r/c', () => {
    const te = retardedTimeUniform({ x: 0, y: 0, z: 0 }, 10, { x: 300, y: 400, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    expectNear(te, 5, 1e-12);
  });

  it('mouvement colinéaire : retard r/(c − v) en approche, r/(c + v) en éloignement', () => {
    const obs = { x: 0, y: 0, z: 0 };
    // À t = 20, l'objet est à 300 m. En approche à 50 m/s : 300/(100 − 50) = 6 s.
    expectNear(retardedTimeUniform(obs, 20, { x: 300, y: 0, z: 0 }, { x: -50, y: 0, z: 0 }, 20), 14, 1e-12);
    // En éloignement à 50 m/s : 300/(100 + 50) = 2 s.
    expectNear(retardedTimeUniform(obs, 20, { x: 300, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, 20), 18, 1e-12);
  });

  it('vérifie l’équation du cône de lumière (formes conjuguées comprises)', () => {
    const obs = { x: 12, y: -7, z: 1.6 };
    for (const b of [0.01, 0.3, 0.9, 0.99, 0.999]) {
      for (const ang of [0, 1, 2, 3, 4, 5]) {
        const w = { x: b * C * Math.cos(ang), y: b * C * Math.sin(ang), z: 0 };
        const p0 = { x: 150, y: 200, z: 3 };
        const te = retardedTimeUniform(obs, 5, p0, w, 1);
        const p = uniform(p0, w, 1)(te);
        expect(te).toBeLessThanOrEqual(5);
        expectNear(C * (5 - te), dist(obs, p), 1e-9 * Math.max(1, C * (5 - te)));
      }
    }
  });

  it('refuse |w| ≥ c', () => {
    expect(() => retardedTimeUniform({ x: 0, y: 0, z: 0 }, 0, { x: 1, y: 0, z: 0 }, { x: C, y: 0, z: 0 }, 0)).toThrow();
  });
});

describe('retardedTime (Newton sécurisé)', () => {
  const observer = { x: 0, y: 0, z: 1.6 };

  it('mouvement uniforme : égal à la forme fermée (1e-6), ≤ 8 itérations jusqu’à β = 0,99', () => {
    let worstIterations = 0;
    for (const b of [0.01, 0.1, 0.3, 0.5, 0.9, 0.95, 0.99]) {
      for (const ang of [0, 0.7, Math.PI / 2, 2.5, Math.PI, 4, 5.5]) {
        const w = { x: b * C * Math.cos(ang), y: b * C * Math.sin(ang), z: 0 };
        const p0 = { x: 150, y: 200, z: 3 };
        const t = 5;
        const exact = retardedTimeUniform(observer, t, p0, w, 0);
        // Amorces : par défaut, la pire (te = t) et une valeur décalée (image précédente).
        for (const guess of [undefined, t, exact - 0.5, exact - 30]) {
          const res = retardedTime(observer, t, uniform(p0, w, 0), { guess });
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
      // Manège de 500 m de rayon (retard plus court qu'un tour).
      const R = 500;
      const om = (b * C) / R;
      trajectories.push((te) => ({ x: R * Math.cos(om * te), y: R * Math.sin(om * te), z: 0 }));
      // Mouvement hyperbolique (accélération propre constante) qui atteint β en t = 10 s.
      const g = (C * (b / Math.sqrt(1 - b * b))) / 10;
      const L = (C * C) / g;
      trajectories.push((te) => ({ x: L * (Math.sqrt(1 + ((g * te) / C) ** 2) - 1) - 300, y: 150, z: 0 }));
    }
    let worstIterations = 0;
    for (const positionAt of trajectories) {
      for (const ox of [-300, 0, 400]) {
        for (const t of [0, 3.3, 10]) {
          const obs = { x: ox, y: 120, z: 0 };
          const reference = bisectionReference(obs, t, positionAt);
          for (const guess of [undefined, t]) {
            const res = retardedTime(obs, t, positionAt, { guess });
            expect(res.converged).toBe(true);
            expectNear(res.te, reference, 1e-6);
            worstIterations = Math.max(worstIterations, res.iterations);
          }
        }
      }
    }
    expect(worstIterations).toBeLessThanOrEqual(8);
  });

  it('résidu nul dès le départ : 1 itération', () => {
    // Objet immobile, amorce par défaut (t − r/c, exacte).
    const fixed = retardedTime({ x: 0, y: 0, z: 0 }, 10, () => ({ x: 300, y: 0, z: 0 }));
    expect(fixed).toEqual({ te: 7, iterations: 1, converged: true });
    const fixed2 = retardedTime({ x: 0, y: 0, z: 0 }, 10, () => ({ x: 123.456, y: -78.9, z: 2 }));
    expect(fixed2.iterations).toBe(1);
    expect(fixed2.te).toBe(10 - Math.hypot(123.456, -78.9, 2) / C);
    // Objet mobile, amorce exacte : p(8) = (100, 0, 0) est à 1 s-lumière de l'observateur à t = 9.
    const moving = retardedTime({ x: 0, y: 0, z: 0 }, 9, (te) => ({ x: 50 * te - 300, y: 0, z: 0 }), { guess: 8 });
    expect(moving).toEqual({ te: 8, iterations: 1, converged: true });
    // Objet qui passe sur l'observateur à l'instant t : te = t (borne incluse).
    const crossing = retardedTime({ x: 5, y: 5, z: 0 }, 3, (te) => ({ x: 5 + 40 * (te - 3), y: 5, z: 0 }));
    expect(crossing).toEqual({ te: 3, iterations: 1, converged: true });
  });

  it('cas difficiles (orbite serrée à β = 0,99, amorce lointaine) : la bissection garantit la convergence', () => {
    const R = 20;
    const om = (0.99 * C) / R;
    const orbit = (te) => ({ x: R * Math.cos(om * te), y: R * Math.sin(om * te), z: 0 });
    for (const ox of [-300, 0, 50, 400]) {
      for (const t of [0, 3.3, 17]) {
        const obs = { x: ox, y: 120, z: 0 };
        const reference = bisectionReference(obs, t, orbit);
        for (const guess of [undefined, t, t - 500]) {
          const res = retardedTime(obs, t, orbit, { guess, tolerance: 1e-9 });
          expect(res.iterations).toBeLessThan(30);
          expectNear(res.te, reference, 1e-8);
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
      if (te <= way[0][0]) return { x: way[0][1], y: way[0][2], z: 0 };
      for (let i = 1; i < way.length; i++) {
        if (te <= way[i][0]) {
          const [ta, xa, ya] = way[i - 1];
          const [tb, xb, yb] = way[i];
          const f = (te - ta) / (tb - ta);
          return { x: xa + f * (xb - xa), y: ya + f * (yb - ya), z: 0 };
        }
      }
      const last = way[way.length - 1];
      return { x: last[1], y: last[2], z: 0 };
    };
    for (let t = 0; t < 70; t += 0.37) {
      const obs = { x: -150 + 2 * t, y: 80, z: 0 };
      const res = retardedTime(obs, t, walker);
      expectNear(res.te, bisectionReference(obs, t, walker), 1e-5);
      expect(res.iterations).toBeLessThanOrEqual(8);
    }
  });

  it('vitesse qui tend vers c dans le passé, observateur derrière l’horizon : converged = false', () => {
    // Mouvement hyperbolique des cas réguliers (β = 0,99 en t = 10 s) : venu de x = +∞ presque
    // à c, ses rayons vers −x vérifient x + ct > −L − 300 ≈ −442 m. À t = 0, x = −600 n'a
    // encore reçu aucune lumière : G(d) < 0 pour tout d, il n'y a pas de racine.
    const g = (C * (0.99 / Math.sqrt(1 - 0.99 * 0.99))) / 10;
    const L = (C * C) / g;
    const hyper = (te) => ({ x: L * (Math.sqrt(1 + ((g * te) / C) ** 2) - 1) - 300, y: 150, z: 0 });
    const behind = retardedTime({ x: -600, y: 120, z: 0 }, 0, hyper);
    expect(behind.converged).toBe(false);
    expect(behind.iterations).toBe(30);
    const seen = retardedTime({ x: -300, y: 120, z: 0 }, 0, hyper);
    expect(seen.converged).toBe(true);
    expectNear(seen.te, bisectionReference({ x: -300, y: 120, z: 0 }, 0, hyper), 1e-6);
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

  it('sert de trajectoire à retardedTime (mouvement uniforme : 1e-6)', () => {
    const p0 = { x: -400, y: 300, z: 0 };
    const w = { x: 60, y: -20, z: 0 };
    const truth = uniform(p0, w, 0);
    const h = createHistory({ capacity: 30 * 20 + 2, interval: 0.05 });
    for (let i = 0; i <= 20 * 60; i++) h.push(i / 60, truth(i / 60));
    const obs = { x: 50, y: -100, z: 1.6 };
    const res = retardedTime(obs, 20, h.positionAt);
    expectNear(res.te, retardedTimeUniform(obs, 20, p0, w, 0), 1e-6);
    expect(res.iterations).toBeLessThanOrEqual(8);
  });
});
