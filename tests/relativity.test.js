// Tests de src/physics/relativity.js : cinématique, addition des vitesses, segment
// hyperbolique, aberration et Doppler. Constantes du réglage par défaut (c = 30 m/s,
// a = 3 m/s²) sauf mention ; vitesses écrites en fractions de c. Un groupe vérifie aussi
// l'injection de c (paramètre facultatif) avec les valeurs du cahier des charges (c = 100).
import { describe, expect, it } from 'vitest';
// Constantes des tests : c = 30 m/s, a = 3 m/s² (c/a = 10 s, rapidité 1 après 10 s de poussée).
const C = 30;
const A = 3;
import {
  aberrate,
  aberrateInverse,
  composeVelocities,
  dopplerFactor,
  emissionTimeStatic,
  gammaFromU,
  hyperbolicSegment,
  rapidityFromU,
  uFromVelocity,
  velocityFromU,
} from '../src/physics/relativity.js';

/** Générateur pseudo-aléatoire à graine fixe (mulberry32) : tests reproductibles. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vérifie |actual − expected| ≤ tol. */
function expectNear(actual, expected, tol) {
  expect(Math.abs(actual - expected), `${actual} au lieu de ${expected}`).toBeLessThanOrEqual(tol);
}

const norm3 = (v) => Math.hypot(v.x, v.y, v.z);
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Direction unitaire aléatoire en 3D. */
function randomDirection(r) {
  const z = 2 * r() - 1;
  const phi = 2 * Math.PI * r();
  const s = Math.sqrt(1 - z * z);
  return { x: s * Math.cos(phi), y: s * Math.sin(phi), z };
}

/** β aléatoire de norme < 0,995. */
function randomBeta(r) {
  const n = randomDirection(r);
  const b = 0.995 * r();
  return { x: b * n.x, y: b * n.y, z: b * n.z };
}

/**
 * Boost de Lorentz explicite (référence indépendante) : coordonnées (ct, x) du monde vers
 * le référentiel de vitesse βc. Renvoie {ct, x: {x, y, z}}.
 */
function boost(ct, p, beta) {
  const b2 = dot3(beta, beta);
  const g = 1 / Math.sqrt(1 - b2);
  const bx = dot3(beta, p);
  const k = b2 > 0 ? ((g - 1) * bx) / b2 - g * ct : 0;
  return { ct: g * (ct - bx), x: { x: p.x + k * beta.x, y: p.y + k * beta.y, z: p.z + k * beta.z } };
}

describe('vitesse propre, vitesse, rapidité', () => {
  it('γ, v et φ sont cohérents, et u ↔ v sont inverses', () => {
    const r = rng(1);
    for (let i = 0; i < 1000; i++) {
      const ux = (r() - 0.5) * 20 * C;
      const uy = (r() - 0.5) * 20 * C;
      const g = gammaFromU(ux, uy);
      const v = velocityFromU(ux, uy);
      const speed = Math.hypot(v.x, v.y);
      expect(speed).toBeLessThan(C);
      expectNear(g, 1 / Math.sqrt(1 - (speed * speed) / (C * C)), 1e-12 * g);
      expectNear(rapidityFromU(ux, uy), Math.atanh(speed / C), 1e-9);
      const u = uFromVelocity(v.x, v.y);
      expectNear(u.x, ux, 1e-9 * Math.abs(g * C));
      expectNear(u.y, uy, 1e-9 * Math.abs(g * C));
    }
  });

  it('à rapidité 1, v = c·tanh 1 et γ = cosh 1', () => {
    const u = C * Math.sinh(1);
    expectNear(gammaFromU(u, 0), Math.cosh(1), 1e-15);
    expectNear(velocityFromU(0, u).y, C * Math.tanh(1), 1e-12);
    expectNear(rapidityFromU(u, 0), 1, 1e-15);
  });

  it('uFromVelocity refuse |v| ≥ c', () => {
    expect(() => uFromVelocity(C, 0)).toThrow();
    expect(() => uFromVelocity(0.8 * C, 0.7 * C)).toThrow();
    expect(() => uFromVelocity(NaN, 0)).toThrow();
  });
});

describe('composeVelocities (v ⊕ w)', () => {
  it('v = 0 : renvoie w ; w = 0 : renvoie v', () => {
    expect(composeVelocities({ x: 0, y: 0 }, { x: 0.3 * C, y: -0.4 * C })).toEqual({ x: 0.3 * C, y: -0.4 * C });
    const r = composeVelocities({ x: 0.6 * C, y: 0.2 * C }, { x: 0, y: 0 });
    expectNear(r.x, 0.6 * C, 1e-12);
    expectNear(r.y, 0.2 * C, 1e-12);
  });

  it('colinéaire : les rapidités s’additionnent', () => {
    const r = rng(2);
    for (let i = 0; i < 1000; i++) {
      const dir = 2 * Math.PI * r();
      const a = (r() - 0.5) * 2 * 0.99 * C;
      const b = (r() - 0.5) * 2 * 0.99 * C;
      const cx = Math.cos(dir);
      const cy = Math.sin(dir);
      const res = composeVelocities({ x: a * cx, y: a * cy }, { x: b * cx, y: b * cy });
      const along = res.x * cx + res.y * cy;
      expectNear(-res.x * cy + res.y * cx, 0, 1e-12);
      expect(Math.abs(along)).toBeLessThan(C);
      expectNear(Math.atanh(along / C), Math.atanh(a / C) + Math.atanh(b / C), 1e-9);
    }
  });

  it('n’est pas commutative (même norme, directions différentes)', () => {
    const v = { x: 0.8 * C, y: 0 };
    const w = { x: 0, y: 0.5 * C };
    const vw = composeVelocities(v, w);
    const wv = composeVelocities(w, v);
    // Normes égales (γ_total = γ_v·γ_w quand v ⊥ w), directions différentes (rotation de Wigner).
    expectNear(Math.hypot(vw.x, vw.y), Math.hypot(wv.x, wv.y), 1e-12);
    expect(Math.abs(Math.atan2(vw.y, vw.x) - Math.atan2(wv.y, wv.x))).toBeGreaterThan(0.1);
    // Valeurs attendues : v ⊕ w = (0,8c, 0,5c/γ_v), w ⊕ v = (0,8c/γ_w, 0,5c).
    expectNear(vw.x, 0.8 * C, 1e-12);
    expectNear(vw.y, 0.5 * C * Math.sqrt(1 - 0.64), 1e-12);
    expectNear(wv.x, 0.8 * C * Math.sqrt(1 - 0.25), 1e-12);
    expectNear(wv.y, 0.5 * C, 1e-12);
  });

  it('reste sous c', () => {
    const res = composeVelocities({ x: 0.99 * C, y: 0 }, { x: 0.99 * C, y: 0.05 * C });
    expect(Math.hypot(res.x, res.y)).toBeLessThan(C);
  });
});

describe('hyperbolicSegment', () => {
  it('depuis l’arrêt, τ = 10 s à a = c/10 : valeurs exactes en un seul segment', () => {
    const seg = hyperbolicSegment(0, 0, A, 0, 10);
    expectNear(velocityFromU(seg.ux, seg.uy).x, C * Math.tanh(1), 1e-9);
    expectNear(seg.dt, (C / A) * Math.sinh(1), 1e-9);
    expectNear(seg.dx, ((C * C) / A) * (Math.cosh(1) - 1), 1e-9);
    expect(seg.uy).toBe(0);
    expect(seg.dy).toBe(0);
  });

  it('≡ v₀ ⊕ c·tanh(η)·â (10⁴ cas 2D aléatoires, 1e-9)', () => {
    const r = rng(3);
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const U = 3 * C * r();
      const th = 2 * Math.PI * r();
      const ph = 2 * Math.PI * r();
      const a = A * (0.05 + r());
      const h = 2 * r();
      const ux = U * Math.cos(th);
      const uy = U * Math.sin(th);
      const seg = hyperbolicSegment(ux, uy, a * Math.cos(ph), a * Math.sin(ph), h);
      const wMag = C * Math.tanh((a * h) / C);
      const v0 = velocityFromU(ux, uy);
      const expected = composeVelocities(v0, { x: wMag * Math.cos(ph), y: wMag * Math.sin(ph) });
      const got = velocityFromU(seg.ux, seg.uy);
      worst = Math.max(worst, Math.hypot(got.x - expected.x, got.y - expected.y));
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  // En ligne droite (poussée colinéaire à u, cas du joueur), le découpage ne change rien.
  // (En poussée oblique, deux demi-segments diffèrent d'un segment entier : la direction
  // de poussée est relue dans un référentiel comobile différent, rotation de Wigner.)
  it('poussée colinéaire : 300 segments de 0,01 s = un segment de 3 s', () => {
    const [u0, a] = [0.5 * C, 0.7 * A];
    const one = hyperbolicSegment(u0, 0, a, 0, 3);
    let s = { ux: u0, uy: 0, x: 0, t: 0 };
    for (let i = 0; i < 300; i++) {
      const seg = hyperbolicSegment(s.ux, s.uy, a, 0, 0.01);
      s = { ux: seg.ux, uy: seg.uy, x: s.x + seg.dx, t: s.t + seg.dt };
    }
    expectNear(s.ux, one.ux, 1e-10);
    expectNear(s.x, one.dx, 1e-9);
    expectNear(s.t, one.dt, 1e-11);
  });

  it('poussée oblique : â fixe dans le référentiel comobile initial (Fermi-Walker), découpage non indifférent', () => {
    const [ux, uy, ax, ay, h] = [C, 0, 0, A, 2];
    const one = hyperbolicSegment(ux, uy, ax, ay, h);
    // Hyperbole dans le référentiel comobile initial (boost pur de u₀), puis boost vers le monde.
    const a = Math.hypot(ax, ay);
    const eta = (a * h) / C;
    const g0 = gammaFromU(ux, uy);
    const v = { x: ux / g0, y: uy / g0 };
    const boost = (T, X, Y) => {
      const vx = (v.x * X + v.y * Y) / (v.x * v.x + v.y * v.y);
      return {
        T: g0 * (T + (v.x * X + v.y * Y) / (C * C)),
        X: X + (g0 - 1) * vx * v.x + g0 * v.x * T,
        Y: Y + (g0 - 1) * vx * v.y + g0 * v.y * T,
      };
    };
    const range = ((C * C) / a) * (Math.cosh(eta) - 1);
    const d = boost((C / a) * Math.sinh(eta), (range * ax) / a, (range * ay) / a);
    const u = boost(Math.cosh(eta), (C * Math.sinh(eta) * ax) / a, (C * Math.sinh(eta) * ay) / a);
    expectNear(one.dt / d.T, 1, 1e-12);
    expectNear(Math.hypot(one.dx - d.X, one.dy - d.Y) / Math.hypot(d.X, d.Y), 0, 1e-12);
    expectNear(Math.hypot(one.ux - u.X, one.uy - u.Y) / Math.hypot(u.X, u.Y), 0, 1e-12);
    // Deux demi-segments : la poussée est relue dans un autre référentiel comobile.
    const half = hyperbolicSegment(ux, uy, ax, ay, h / 2);
    const two = hyperbolicSegment(half.ux, half.uy, ax, ay, h / 2);
    expect(Math.hypot(two.ux - one.ux, two.uy - one.uy)).toBeGreaterThan(0.1);
  });

  it('sans poussée : roue libre exacte (Δx = u·h, Δt = γ·h)', () => {
    const seg = hyperbolicSegment(0.4 * C, -0.3 * C, 0, 0, 2);
    expect(seg.ux).toBe(0.4 * C);
    expect(seg.uy).toBe(-0.3 * C);
    expectNear(seg.dx, 0.8 * C, 1e-12);
    expectNear(seg.dy, -0.6 * C, 1e-12);
    expectNear(seg.dt, 2 * gammaFromU(0.4 * C, -0.3 * C), 1e-12);
  });

  it('frein colinéaire : la rapidité baisse de a·h/c', () => {
    const u = C * Math.sinh(1.2);
    const seg = hyperbolicSegment(u, 0, -A, 0, 5);
    expectNear(rapidityFromU(seg.ux, seg.uy), 0.7, 1e-12);
    expectNear(seg.dx, ((C * C) / A) * (Math.cosh(1.2) - Math.cosh(0.7)), 1e-9);
    expectNear(seg.dt, (C / A) * (Math.sinh(1.2) - Math.sinh(0.7)), 1e-12);
  });

  // Sans plafond effectif : on enchaîne les segments eux-mêmes. (Le joueur borne phiMax à
  // PHI_MAX_LIMIT, et ses sous-pas de 1 m demanderaient ~1,6e9 sous-pas pour 150 s à φ → 15.)
  it('150 s de poussée (φ = 15) : v < c strictement, rapidité additive à 1e-9', () => {
    let s = { ux: 0, uy: 0, x: 0, t: 0 };
    const h = 1 / 60;
    const n = 150 * 60;
    for (let i = 0; i < n; i++) {
      const seg = hyperbolicSegment(s.ux, s.uy, A, 0, h);
      s = { ux: seg.ux, uy: seg.uy, x: s.x + seg.dx, t: s.t + seg.dt };
    }
    const phi = (A * 150) / C;
    expectNear(rapidityFromU(s.ux, s.uy), phi, 1e-9);
    const v = velocityFromU(s.ux, s.uy);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(C);
    expect(Number.isFinite(s.x) && Number.isFinite(s.t)).toBe(true);
    expectNear(s.t / ((C / A) * Math.sinh(phi)), 1, 1e-9);
    expectNear(s.x / (((C * C) / A) * (Math.cosh(phi) - 1)), 1, 1e-9);
  });
});

describe('aberration et Doppler', () => {
  it('dopplerFactor : γ(1 + β) devant, γ(1 − β) derrière, γ sur le côté (monde)', () => {
    const b = 0.6;
    const g = 1.25;
    const beta = { x: b, y: 0, z: 0 };
    expectNear(dopplerFactor(beta, { x: 1, y: 0, z: 0 }), g * (1 + b), 1e-15);
    expectNear(dopplerFactor(beta, { x: -1, y: 0, z: 0 }), g * (1 - b), 1e-15);
    expectNear(dopplerFactor(beta, { x: 0, y: 1, z: 0 }), g, 1e-15);
    expect(dopplerFactor({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBe(1);
    expect(() => dopplerFactor({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toThrow();
  });

  it('aberrate : |n′| = 1 et accord avec un boost de Lorentz explicite', () => {
    const r = rng(4);
    for (let i = 0; i < 5000; i++) {
      const beta = randomBeta(r);
      const n = randomDirection(r);
      const res = aberrate(beta, n);
      expectNear(norm3(res), 1, 1e-12);
      // Séparation de genre lumière de l'observateur vers l'émission : (−r, r·n), r = 1.
      const b = boost(-1, n, beta);
      const len = norm3(b.x);
      expectNear(res.x, b.x.x / len, 1e-12);
      expectNear(res.y, b.x.y / len, 1e-12);
      expectNear(res.z, b.x.z / len, 1e-12);
      expectNear(res.D, len, 1e-12 * len); // D = r′/r
      expectNear(res.D, dopplerFactor(beta, n), 1e-12 * res.D);
    }
  });

  it('aberrate et aberrateInverse sont inverses l’un de l’autre (même D)', () => {
    const r = rng(5);
    for (let i = 0; i < 5000; i++) {
      const beta = randomBeta(r);
      const n = randomDirection(r);
      const app = aberrate(beta, n);
      const back = aberrateInverse(beta, app);
      expectNear(back.x, n.x, 1e-12);
      expectNear(back.y, n.y, 1e-12);
      expectNear(back.z, n.z, 1e-12);
      expectNear(back.D, app.D, 1e-12 * app.D);
      const world = aberrateInverse(beta, n);
      expectNear(norm3(world), 1, 1e-12);
      const again = aberrate(beta, world);
      expectNear(again.x, n.x, 1e-12);
      expectNear(again.y, n.y, 1e-12);
      expectNear(again.z, n.z, 1e-12);
    }
  });

  it('un objet à 90° (monde) est vu à acos(β) de l’avant ; devant, D = γ(1 + β)', () => {
    for (const b of [0.2, 0.5, Math.tanh(1), 0.9, 0.99]) {
      const g = 1 / Math.sqrt(1 - b * b);
      const beta = { x: 0, y: b, z: 0 };
      const side = aberrate(beta, { x: 1, y: 0, z: 0 });
      expectNear(Math.acos(side.y), Math.acos(b), 1e-12);
      expectNear(side.D, g, 1e-12 * g);
      const front = aberrate(beta, { x: 0, y: 1, z: 0 });
      expectNear(front.y, 1, 1e-15);
      expectNear(front.D, g * (1 + b), 1e-12 * g);
      // Vu de côté (90° apparent), la source est décalée vers le rouge : D = 1/γ.
      expectNear(aberrateInverse(beta, { x: 1, y: 0, z: 0 }).D, 1 / g, 1e-12);
    }
  });

  it('β = 0 : pas d’aberration, D = 1', () => {
    const n = { x: 0.6, y: 0, z: 0.8 };
    const res = aberrate({ x: 0, y: 0, z: 0 }, n);
    expect(res).toEqual({ x: 0.6, y: 0, z: 0.8, D: 1 });
  });

  it('emissionTimeStatic : t − d/c', () => {
    expect(emissionTimeStatic(10, 300)).toBe(10 - 300 / C); // 0 à c = 30 m/s
    expect(emissionTimeStatic(5, 0)).toBe(5);
  });
});

describe('constantes injectées (paramètre c facultatif)', () => {
  it('c = 100, a = 10 (cahier des charges) : v = 76,159416 m/s, t = 11,752012 s, x = 543,080635 m', () => {
    const seg = hyperbolicSegment(0, 0, 10, 0, 10, 100);
    expectNear(velocityFromU(seg.ux, seg.uy, 100).x, 76.159416, 1e-6);
    expectNear(seg.dt, 11.752012, 1e-6);
    expectNear(seg.dx, 543.080635, 1e-6);
    expectNear(rapidityFromU(seg.ux, seg.uy, 100), 1, 1e-15);
    expectNear(gammaFromU(seg.ux, seg.uy, 100), Math.cosh(1), 1e-14);
  });

  it('pour c = 10, 30 et 100 : mêmes résultats sans dimension (β, γ, φ, temps), longueurs ∝ c', () => {
    const ref = hyperbolicSegment(0.4 * 30, 0.2 * 30, 0.6 * 3, -0.3 * 3, 2.5, 30);
    for (const c of [10, 30, 57, 100]) {
      const k = c / 30;
      const seg = hyperbolicSegment(0.4 * c, 0.2 * c, 0.06 * c, -0.03 * c, 2.5, c);
      expectNear(seg.ux / c, ref.ux / 30, 1e-14);
      expectNear(seg.uy / c, ref.uy / 30, 1e-14);
      expectNear(seg.dx, k * ref.dx, 1e-12 * c);
      expectNear(seg.dt, ref.dt, 1e-14);
      const v = velocityFromU(0.9 * c, 0.1 * c, c);
      expectNear(Math.hypot(v.x, v.y) / c, Math.tanh(rapidityFromU(0.9 * c, 0.1 * c, c)), 1e-15);
      const u = uFromVelocity(v.x, v.y, c);
      expectNear(u.x, 0.9 * c, 1e-12 * c);
      expect(() => uFromVelocity(c, 0, c)).toThrow(RangeError);
      const w = composeVelocities({ x: 0.5 * c, y: 0 }, { x: 0.5 * c, y: 0 }, c);
      expectNear(w.x, 0.8 * c, 1e-12 * c); // (0,5 + 0,5)/(1 + 0,25) = 0,8
      expect(emissionTimeStatic(10, 3 * c, c)).toBe(7);
    }
  });
});
