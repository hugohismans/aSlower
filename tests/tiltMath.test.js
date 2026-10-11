// Direction par inclinaison : mathématiques pures (src/input/tiltMath.js).
// Les tenues du GSM sont construites comme des matrices appareil → Terre (x est, y nord,
// z haut), puis décomposées en (β, γ) comme le fait le navigateur (convention W3C
// R = Rz(α)·Rx(β)·Ry(γ), γ ∈ [−90°, 90°[) : on vérifie que l'angle de volant retrouve
// exactement la rotation imposée, quelle que soit la tenue.
import { describe, expect, it } from 'vitest';
import {
  DEAD_ZONE_DEG,
  SATURATION_DEG,
  SMOOTHING_TIME_S,
  isValidOrientation,
  meanAngle,
  normalizeScreenAngle,
  smoothToward,
  steerFromAngle,
  steeringAngle,
  steeringAngleDetail,
  upVector,
  wrapDegrees,
} from '../src/input/tiltMath.js';

const D = Math.PI / 180;
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * B[k][j], 0)));
const Rx = (t) => [
  [1, 0, 0],
  [0, Math.cos(t), -Math.sin(t)],
  [0, Math.sin(t), Math.cos(t)],
];
const Rz = (t) => [
  [Math.cos(t), -Math.sin(t), 0],
  [Math.sin(t), Math.cos(t), 0],
  [0, 0, 1],
];

/** Décomposition W3C (γ ∈ ]−90°, 90°[) d'une matrice appareil → Terre → {beta, gamma} en degrés. */
function euler(R) {
  // Cas limite (appareil exactement vertical, blocage de cardan) : γ = −90°, β libre.
  if (Math.abs(R[2][2]) < 1e-12) return { beta: Math.atan2(R[2][1], R[2][0]) / D, gamma: -90 };
  const g = Math.atan(-R[2][0] / R[2][2]);
  const b = Math.atan2(R[2][1], R[2][2] / Math.cos(g));
  return { beta: b / D, gamma: g / D };
}

/**
 * Tenues de référence : joueur face au nord, écran tourné vers lui (vers le sud).
 * Colonnes : axes x, y, z de l'appareil dans le repère de la Terre.
 */
const HOLDS = [
  ['portrait', [[1, 0, 0], [0, 0, -1], [0, 1, 0]], 0],
  ['paysage 90 (haut à gauche)', [[0, -1, 0], [0, 0, -1], [1, 0, 0]], 90],
  ['paysage 270 (haut à droite)', [[0, 1, 0], [0, 0, -1], [-1, 0, 0]], 270],
];

/** Tenue basculée vers l'arrière de `pitch` degrés puis tournée de `wheel` degrés (sens horaire vu du joueur). */
function hold(R0, pitch, wheel) {
  return mul(mul(Rx(-pitch * D), R0), Rz(-wheel * D));
}

describe('steeringAngle : exact dans les tenues du prototype (60 cas)', () => {
  for (const [name, R0, screen] of HOLDS) {
    for (const pitch of [0, 10, 30, 60]) {
      for (const wheel of [-30, -10, 0, 15, 40]) {
        it(`${name}, basculé de ${pitch}°, volant ${wheel}°`, () => {
          const o = euler(hold(R0, pitch, wheel));
          expect(steeringAngle(o, screen)).toBeCloseTo(wheel, 6);
        });
      }
    }
  }
});

describe('steeringAngle : cas supplémentaires', () => {
  it('presque à plat : signe correct et monotone (paysage 90)', () => {
    const R0 = HOLDS[1][1];
    const v = [-20, -5, 5, 20].map((s) => steeringAngle(euler(hold(R0, 85, s)), 90));
    expect(v[0]).toBeLessThan(v[1]);
    expect(v[1]).toBeLessThan(0);
    expect(v[2]).toBeGreaterThan(0);
    expect(v[3]).toBeGreaterThan(v[2]);
  });

  it('presque à plat : signe correct et monotone (paysage 270)', () => {
    const R0 = HOLDS[2][1];
    const v = [-20, -5, 5, 20].map((s) => steeringAngle(euler(hold(R0, 85, s)), 270));
    expect(v[0]).toBeLessThan(v[1]);
    expect(v[1]).toBeLessThan(0);
    expect(v[2]).toBeGreaterThan(0);
    expect(v[3]).toBeGreaterThan(v[2]);
  });

  it('portrait à l\'envers (écran 180°) : exact', () => {
    const R0 = [[-1, 0, 0], [0, 0, -1], [0, -1, 0]];
    for (const pitch of [0, 30]) {
      for (const wheel of [-20, 0, 25]) {
        expect(steeringAngle(euler(hold(R0, pitch, wheel)), 180)).toBeCloseTo(wheel, 6);
      }
    }
  });

  it('iOS : window.orientation = −90 équivaut à 270', () => {
    const o = euler(hold(HOLDS[2][1], 30, 12));
    expect(steeringAngle(o, -90)).toBeCloseTo(12, 6);
  });

  it('pencher vers la droite = angle positif, dans les deux paysages', () => {
    for (const [, R0, screen] of HOLDS.slice(1)) {
      for (const pitch of [0, 20, 45, 70]) {
        expect(steeringAngle(euler(hold(R0, pitch, 10)), screen)).toBeGreaterThan(0);
        expect(steeringAngle(euler(hold(R0, pitch, -10)), screen)).toBeLessThan(0);
      }
    }
  });

  it('insensible à la représentation d\'Euler : (β, γ) et (180° − β, γ + 180°) donnent le même angle', () => {
    for (const [, R0, screen] of HOLDS) {
      const { beta, gamma } = euler(hold(R0, 25, 17));
      const alt = { beta: 180 - beta, gamma: gamma + 180 };
      expect(steeringAngle(alt, screen)).toBeCloseTo(steeringAngle({ beta, gamma }, screen), 9);
    }
  });

  it('blocage de cardan : continu autour de la verticale exacte (paysage 90)', () => {
    const R0 = HOLDS[1][1];
    for (const pitch of [-0.01, -0.0001, 0, 0.0001, 0.01]) {
      expect(steeringAngle(euler(hold(R0, pitch, 7)), 90)).toBeCloseTo(7, 4);
    }
  });

  it('α (boussole) est sans effet', () => {
    const o = euler(hold(HOLDS[1][1], 30, 12));
    expect(steeringAngle({ ...o, alpha: 0 }, 90)).toBe(steeringAngle({ ...o, alpha: 271 }, 90));
  });

  it('fondu à plat : continu quand on bascule vers l\'horizontale', () => {
    const R0 = HOLDS[1][1];
    let previous = steeringAngle(euler(hold(R0, 50, 10)), 90);
    for (let pitch = 50.5; pitch <= 89.5; pitch += 0.5) {
      const a = steeringAngle(euler(hold(R0, pitch, 10)), 90);
      expect(Math.abs(a - previous)).toBeLessThan(0.5);
      expect(a).toBeGreaterThan(0);
      previous = a;
    }
  });

  it('détail : tenu ≈ 1 à la verticale, ≈ 0 à plat', () => {
    const R0 = HOLDS[1][1];
    expect(steeringAngleDetail(euler(hold(R0, 10, 0)), 90).held).toBeCloseTo(1, 9);
    expect(steeringAngleDetail(euler(hold(R0, 89, 0)), 90).held).toBe(0);
  });
});

describe('upVector', () => {
  it('unitaire et égal à la troisième ligne de R', () => {
    const R = hold(HOLDS[1][1], 33, -14);
    const { beta, gamma } = euler(R);
    const u = upVector(beta, gamma);
    expect(Math.hypot(u.x, u.y, u.z)).toBeCloseTo(1, 12);
    expect(u.x).toBeCloseTo(R[2][0], 9);
    expect(u.y).toBeCloseTo(R[2][1], 9);
    expect(u.z).toBeCloseTo(R[2][2], 9);
  });
});

describe('normalizeScreenAngle et wrapDegrees', () => {
  it('angles d\'écran', () => {
    expect(normalizeScreenAngle(0)).toBe(0);
    expect(normalizeScreenAngle(90)).toBe(90);
    expect(normalizeScreenAngle(-90)).toBe(270);
    expect(normalizeScreenAngle(270)).toBe(270);
    expect(normalizeScreenAngle(180)).toBe(180);
    expect(normalizeScreenAngle(-180)).toBe(180);
    expect(normalizeScreenAngle(360)).toBe(0);
    expect(normalizeScreenAngle(undefined)).toBe(0);
    expect(normalizeScreenAngle(null)).toBe(0);
    expect(normalizeScreenAngle(NaN)).toBe(0);
  });

  it('angles ramenés dans ]−180, 180]', () => {
    expect(wrapDegrees(0)).toBe(0);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(725)).toBe(5);
  });
});

describe('isValidOrientation', () => {
  it('refuse les événements vides (ordinateur sans capteur)', () => {
    expect(isValidOrientation({ alpha: null, beta: null, gamma: null })).toBe(false);
    expect(isValidOrientation({ beta: 10, gamma: null })).toBe(false);
    expect(isValidOrientation(null)).toBe(false);
    expect(isValidOrientation({ alpha: null, beta: 0, gamma: 0 })).toBe(true);
  });
});

describe('steerFromAngle : zone morte, saturation, signe', () => {
  it('zone morte de 3°', () => {
    expect(DEAD_ZONE_DEG).toBe(3);
    expect(steerFromAngle(0)).toBe(0);
    expect(steerFromAngle(2.99)).toBe(0);
    expect(steerFromAngle(-3)).toBe(0);
    expect(steerFromAngle(3.5)).toBeGreaterThan(0);
  });

  it('saturation à 25° : ±1, et pas au-delà', () => {
    expect(SATURATION_DEG).toBe(25);
    expect(steerFromAngle(25)).toBe(1);
    expect(steerFromAngle(-25)).toBe(-1);
    expect(steerFromAngle(80)).toBe(1);
    expect(steerFromAngle(-170)).toBe(-1);
    expect(steerFromAngle(24)).toBeLessThan(1);
  });

  it('monotone, impair, continu à la zone morte', () => {
    let previous = 0;
    for (let a = 3; a <= 25; a += 0.25) {
      const s = steerFromAngle(a);
      expect(s).toBeGreaterThanOrEqual(previous);
      expect(steerFromAngle(-a)).toBeCloseTo(-s, 12);
      previous = s;
    }
    expect(steerFromAngle(3.01)).toBeLessThan(0.01);
  });

  it('relatif au neutre calibré, à travers ±180°', () => {
    expect(steerFromAngle(15, 15)).toBe(0);
    expect(steerFromAngle(40, 15)).toBe(1);
    expect(steerFromAngle(-178, 178)).toBeGreaterThan(0); // +4° à travers ±180°
    expect(steerFromAngle(NaN, 0)).toBe(0);
  });
});

describe('smoothToward', () => {
  it('constante de temps de 60 ms', () => {
    expect(SMOOTHING_TIME_S).toBe(0.06);
    expect(smoothToward(0, 1, 0.06)).toBeCloseTo(1 - Math.exp(-1), 12);
  });

  it('indépendant du découpage en images', () => {
    let a = 0;
    for (let i = 0; i < 6; i += 1) a = smoothToward(a, 1, 1 / 60);
    let b = 0;
    for (let i = 0; i < 12; i += 1) b = smoothToward(b, 1, 1 / 120);
    expect(a).toBeCloseTo(b, 12);
    expect(a).toBeCloseTo(1 - Math.exp(-0.1 / 0.06), 12);
  });

  it('dt nul ou négatif : inchangé', () => {
    expect(smoothToward(0.3, 1, 0)).toBe(0.3);
    expect(smoothToward(0.3, 1, -1)).toBe(0.3);
  });
});

describe('meanAngle', () => {
  it('moyenne ordinaire loin de ±180°', () => {
    expect(meanAngle([4, 6, 5])).toBeCloseTo(5, 9);
  });
  it('à travers ±180°', () => {
    expect(Math.abs(meanAngle([179, -179]))).toBeCloseTo(180, 9);
  });
  it('liste vide ou sans nombre : NaN', () => {
    expect(meanAngle([])).toBeNaN();
    expect(meanAngle([NaN])).toBeNaN();
  });
});
