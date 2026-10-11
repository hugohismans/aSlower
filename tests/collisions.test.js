// Tests de src/physics/collisions.js : test balayé cercle/rectangle, réponse inélastique
// (composante normale de u annulée, tangentielle conservée), étourdissement κ·(γ_avant − γ_après)
// ajouté à τ ET t, pas de traversée à grande vitesse, coins, glissement le long d'un mur.
import { describe, expect, it } from 'vitest';
import { physicsFor, SUBSTEP_MAX_DIST } from '../src/physics/constants.js';
import {
  boundaryBoxes,
  boxesFromBuildings,
  boxFromCenter,
  CONTACT_SKIN,
  createBoxIndex,
  distanceToBox,
  PLAYER_RADIUS,
  resolveMove,
  STUN_MAX,
  STUN_PER_GAMMA,
  stepWithCollisions,
  stunFor,
  sweepCircle,
  sweepCircleBox,
} from '../src/physics/collisions.js';
import { createPlayer, snapshot } from '../src/physics/player.js';

const R = PLAYER_RADIUS;
const near = (a, b, tol) => expect(Math.abs(a - b), `${a} au lieu de ${b}`).toBeLessThanOrEqual(tol);

/** Joueur lancé à la rapidité φ dans la direction du cap (radians). */
function launched(phi, heading, { physics = physicsFor(30), x = 0, y = 0 } = {}) {
  const s = createPlayer({ x, y, heading, physics });
  const U = physics.c * Math.sinh(phi);
  s.ux = U * Math.cos(heading);
  s.uy = U * Math.sin(heading);
  return s;
}

describe('sweepCircleBox : premier contact du cercle balayé', () => {
  const wall = { x0: 5, y0: -10, x1: 6, y1: 10 };

  it('côté plat, de face : t = (5 − r)/10, normale (−1, 0)', () => {
    const hit = sweepCircleBox(0, 0, 10, 0, R, wall);
    near(hit.time, (5 - R) / 10, 1e-12);
    expect([hit.nx, hit.ny]).toEqual([-1, 0]);
    expect(hit.penetration).toBeUndefined();
  });

  it('trop court, à côté ou en s’éloignant : pas de contact', () => {
    expect(sweepCircleBox(0, 0, 4, 0, R, wall)).toBeNull(); // s'arrête à 1 m du mur grossi
    expect(sweepCircleBox(0, 10.7, 10, 0, R, wall)).toBeNull(); // passe au-dessus du coin (10 + r < 10,7)
    expect(sweepCircleBox(0, 0, -10, 0, R, wall)).toBeNull();
    // Au contact (reculé de la marge) et en s'éloignant : rien.
    expect(sweepCircleBox(5 - R - CONTACT_SKIN, 0, -1, 0, R, wall)).toBeNull();
    // Au contact et en glissant le long du mur : rien.
    expect(sweepCircleBox(5 - R - CONTACT_SKIN, 0, 0, 5, R, wall)).toBeNull();
  });

  it('coin arrondi : contact sur le cercle de rayon r autour du coin, normale radiale', () => {
    // Trajectoire horizontale à y = 10,3 : frôle le coin (5, 10) à 0,3 m de hauteur.
    const hit = sweepCircleBox(0, 10.3, 10, 0, R, wall);
    const xc = 5 - Math.sqrt(R * R - 0.3 * 0.3);
    near(hit.time, xc / 10, 1e-12);
    near(Math.hypot(hit.nx, hit.ny), 1, 1e-12);
    near(hit.nx, (xc - 5) / R, 1e-12);
    near(hit.ny, 0.3 / R, 1e-12);
  });

  it('pénétration au départ : time = 0, normale de sortie et profondeur', () => {
    const hit = sweepCircleBox(4.7, 0, 1, 0, R, wall);
    expect(hit.time).toBe(0);
    expect([hit.nx, hit.ny]).toEqual([-1, 0]);
    near(hit.penetration, R - 0.3, 1e-12);
    const inside = sweepCircleBox(5.2, 0, 0, 0, R, wall); // centre dans le mur : côté le plus proche
    expect([inside.nx, inside.ny]).toEqual([-1, 0]);
    near(inside.penetration, 0.2 + R, 1e-12);
  });

  it('sweepCircle garde le premier obstacle touché', () => {
    const far = { x0: 20, y0: -1, x1: 21, y1: 1, id: 'loin' };
    const close = { x0: 8, y0: -1, x1: 9, y1: 1, id: 'pres' };
    expect(sweepCircle(0, 0, 30, 0, R, [far, close]).box.id).toBe('pres');
    expect(sweepCircle(0, 0, 30, 0, R, [])).toBeNull();
  });
});

describe('resolveMove : réponse inélastique (fonction pure)', () => {
  const physics = physicsFor(30);
  const c = physics.c;
  const wall = { x0: 5, y0: -10, x1: 6, y1: 10, kind: 'batiment', id: 'mur' };

  it('de face : arrêt au contact, u normale annulée, étourdissement κ·(γ − 1)', () => {
    const U = c * Math.sinh(0.5);
    const from = { x: 0, y: 0 };
    const u = { ux: U, uy: 0 };
    const res = resolveMove(from, { x: 10, y: 0 }, u, [wall], { c });
    near(res.x, 5 - R - CONTACT_SKIN, 1e-12);
    expect(res.y).toBe(0);
    expect(res.ux).toBe(0);
    expect(res.uy).toBe(0);
    near(res.gammaBefore, Math.cosh(0.5), 1e-12);
    expect(res.gammaAfter).toBe(1);
    near(res.stun, STUN_PER_GAMMA * (Math.cosh(0.5) - 1), 1e-12);
    expect(res.dTau).toBe(res.stun);
    expect(res.dT).toBe(res.stun); // la batterie reste égale à τ
    expect(res.hits[0].box.id).toBe('mur');
    // Pure : les arguments ne changent pas.
    expect(from).toEqual({ x: 0, y: 0 });
    expect(u).toEqual({ ux: U, uy: 0 });
  });

  it('en biais : glisse le long du mur, composante tangentielle conservée', () => {
    const U = 10;
    const u = { ux: U * Math.SQRT1_2, uy: U * Math.SQRT1_2 };
    const res = resolveMove({ x: 0, y: 0 }, { x: 8, y: 8 }, u, [wall], { c });
    expect(res.ux).toBe(0);
    near(res.uy, U * Math.SQRT1_2, 1e-12);
    near(res.x, 5 - R - CONTACT_SKIN, 1e-12);
    near(res.y, 8, 1e-9); // le déplacement tangentiel est gardé en entier
    expect(res.stun).toBeGreaterThan(0);
    expect(res.stun).toBeLessThan(STUN_PER_GAMMA * (Math.hypot(1, U / c) - 1));
  });

  it('coin rentrant (deux murs en L) : les deux composantes sont annulées', () => {
    const east = { x0: 5, y0: -10, x1: 6, y1: 10 };
    const north = { x0: -10, y0: 5, x1: 5, y1: 6 };
    const u = { ux: 7, uy: 7 };
    const res = resolveMove({ x: 0, y: 0 }, { x: 9, y: 9 }, u, [east, north], { c });
    expect(res.ux).toBe(0);
    expect(res.uy).toBe(0);
    expect(res.x).toBeLessThanOrEqual(5 - R);
    expect(res.y).toBeLessThanOrEqual(5 - R);
    expect(res.hits.length).toBe(2);
  });

  it('sans obstacle : position d’arrivée, u et horloges inchangés', () => {
    const res = resolveMove({ x: 0, y: 0 }, { x: 3, y: 4 }, { ux: 3, uy: 4 }, [wall], { c });
    expect(res).toMatchObject({ x: 3, y: 4, ux: 3, uy: 4, stun: 0, hits: [] });
  });

  it('pénétration (porte refermée sur le joueur) : repoussé hors de l’obstacle', () => {
    const res = resolveMove({ x: 5.1, y: 0 }, { x: 5.1, y: 0 }, { ux: 0, uy: 0 }, [wall], { c });
    expect(distanceToBox(res.x, res.y, wall)).toBeGreaterThanOrEqual(R);
    expect(res.stun).toBe(0);
  });

  it('étourdissement borné : stunFor(γ = 10 → 1) = STUN_MAX', () => {
    expect(stunFor(10, 1)).toBe(STUN_MAX);
    expect(stunFor(1, 1)).toBe(0);
    near(stunFor(Math.cosh(0.2), 1), 20 * (Math.cosh(0.2) - 1), 1e-12);
  });
});

describe('stepWithCollisions : pas du joueur avec collisions', () => {
  it.each([10, 30, 100])('pas de traversée d’un mur de 0,5 m à φ = 3 (c = %i), par images de 0,1 s', (cValue) => {
    const physics = physicsFor(cValue);
    const s = launched(3, 0, { physics });
    const thin = { x0: 50, y0: -20, x1: 50.5, y1: 20, kind: 'batiment', id: 'mince' };
    const gamma0 = snapshot(s).gamma;
    const tau0 = s.tau;
    let hit = null;
    for (let i = 0; i < 20; i++) {
      const out = stepWithCollisions(s, { thrust: 1 }, 0.1, [thin]);
      if (out.hits.length && !hit) hit = out.hits[0];
      expect(s.x).toBeLessThanOrEqual(50 - R); // jamais de l'autre côté
    }
    expect(hit).not.toBeNull();
    expect(hit.id).toBe('mince');
    near(hit.gammaBefore, gamma0, 1e-9);
    expect(hit.stun).toBe(STUN_MAX); // γ = 10 → plafonné
    expect(s.tau - tau0).toBeGreaterThanOrEqual(2 + STUN_MAX - 1e-9);
  });

  it('le pas est découpé en morceaux de ≤ 1 m : un poteau de 0,2 m n’est pas sauté', () => {
    const physics = physicsFor(100);
    const s = launched(3, 0, { physics });
    const post = { x0: 40, y0: -0.1, x1: 40.2, y1: 0.1 };
    // Un seul appel de 0,5 s : ≈ 50 m parcourus, découpés en ≤ 1 m.
    const { hits } = stepWithCollisions(s, {}, 0.5, [post]);
    expect(hits.length).toBeGreaterThan(0);
    expect(s.x).toBeLessThan(40);
    expect(SUBSTEP_MAX_DIST).toBe(1);
  });

  it('étourdissement ajouté à τ ET t : l’écart t − τ ne change pas, la batterie reste τ', () => {
    const physics = physicsFor(30);
    const s = launched(0.5, 0, { physics, x: 0 });
    const wall = { x0: 1, y0: -5, x1: 2, y1: 5 };
    const before = { tau: s.tau, t: s.t };
    const gamma = Math.cosh(0.5);
    const { stun, hits } = stepWithCollisions(s, {}, 0.05, [wall]);
    expect(hits).toHaveLength(1);
    near(stun, STUN_PER_GAMMA * (gamma - 1), 1e-9);
    // Avant le choc : Δt ≈ γΔτ (roue libre) ; l'étourdissement ajoute stun aux deux.
    const flight = (1 - R - CONTACT_SKIN) / (physics.c * Math.sinh(0.5)); // τ jusqu'au contact
    expect(s.tau - before.tau).toBeCloseTo(0.05 + stun, 9);
    expect(s.t - s.tau).toBeGreaterThan(0);
    expect(s.t - s.tau).toBeLessThan(0.05 * (gamma - 1) + 1e-9); // l'étourdissement n'élargit pas l'écart
    expect(flight).toBeLessThan(0.05);
    expect(s.ux).toBe(0);
  });

  it('applyStun = false : l’étourdissement est renvoyé sans toucher aux horloges', () => {
    const s = launched(0.5, 0);
    const wall = { x0: 1, y0: -5, x1: 2, y1: 5 };
    const { stun } = stepWithCollisions(s, {}, 0.05, [wall], { applyStun: false });
    expect(stun).toBeGreaterThan(0);
    near(s.tau, 0.05, 1e-12);
  });

  it('glissement : en biais contre un mur, le cap suit la nouvelle vitesse', () => {
    const physics = physicsFor(30);
    const s = launched(0.3, Math.PI / 4, { physics });
    const wall = { x0: 3, y0: -50, x1: 4, y1: 200 };
    for (let i = 0; i < 60; i++) stepWithCollisions(s, {}, 1 / 60, [wall]);
    near(s.x, 3 - R - CONTACT_SKIN, 1e-6);
    expect(s.ux).toBe(0);
    near(s.uy, physics.c * Math.sinh(0.3) * Math.SQRT1_2, 1e-9);
    near(s.hx, 0, 1e-12);
    near(s.hy, 1, 1e-12);
    // Poussée contre le mur ensuite : on avance le long du mur, sans le traverser.
    for (let i = 0; i < 60; i++) stepWithCollisions(s, { thrust: 1, steer: 0.5 }, 1 / 60, [wall]);
    expect(s.x).toBeLessThanOrEqual(3 - R);
  });

  it('coin d’un îlot : le véhicule contourne ou s’arrête, jamais dedans', () => {
    const block = boxFromCenter(10, 10, 8, 8);
    const s = launched(0.4, Math.PI / 4);
    for (let i = 0; i < 120; i++) {
      stepWithCollisions(s, { thrust: 0.5 }, 1 / 60, [block]);
      expect(distanceToBox(s.x, s.y, block)).toBeGreaterThanOrEqual(R - 1e-9);
    }
  });

  it('bords de la carte : quatre murs autour des limites', () => {
    const walls = boundaryBoxes({ xmin: -10, ymin: -10, xmax: 10, ymax: 10 });
    expect(walls.map((w) => w.id)).toEqual(['ouest', 'est', 'sud', 'nord']);
    const s = launched(1, Math.PI / 2);
    for (let i = 0; i < 100; i++) stepWithCollisions(s, { thrust: 1 }, 0.1, walls);
    expect(s.y).toBeLessThanOrEqual(10 - R);
  });
});

describe('index spatial des obstacles', () => {
  it('même résultat qu’un filtrage linéaire, sans doublon', () => {
    const buildings = [];
    for (let i = 0; i < 40; i++) buildings.push({ x: (i % 8) * 30, y: Math.floor(i / 8) * 30, width: 20 + (i % 3) * 10, depth: 12, blockId: `b${i}` });
    const boxes = boxesFromBuildings(buildings);
    expect(boxes[0]).toMatchObject({ kind: 'batiment', id: 'b0', x0: -10, x1: 10 });
    const index = createBoxIndex(boxes, 16);
    for (const [x0, y0, x1, y1] of [
      [0, 0, 50, 50],
      [-100, -100, 400, 400],
      [61, 61, 62, 62],
    ]) {
      const expected = boxes.filter((b) => b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0);
      const got = index.query(x0, y0, x1, y1);
      expect(new Set(got)).toEqual(new Set(expected));
      expect(got.length).toBe(new Set(got).size);
    }
  });
});
