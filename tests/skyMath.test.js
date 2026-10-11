// Ciel animé des menus (src/hud/skyMath.js) : aberration, Doppler et couleurs des étoiles,
// mêmes formules que le moteur (physics/relativity.js, physics/spectrum.js).
import { describe, expect, it } from 'vitest';
import { aberrate, dopplerFactor } from '../src/physics/relativity.js';
import {
  aberrateCos,
  dopplerCos,
  formatSkyReadout,
  gammaOf,
  makeStars,
  SKY,
  skyBeta,
  starColorTable,
  starLook,
  stereoRadius,
  tableIndex,
} from '../src/hud/skyMath.js';

const rgbOf = (text) => text.match(/\d+/g).map(Number);

describe('skyBeta', () => {
  it('part de 0, monte à betaMax à mi-période, revient à 0 (périodique)', () => {
    expect(skyBeta(0)).toBeCloseTo(0, 12);
    expect(skyBeta(SKY.periodS / 2)).toBeCloseTo(SKY.betaMax, 12);
    expect(skyBeta(SKY.periodS)).toBeCloseTo(0, 12);
    expect(skyBeta(SKY.periodS * 1.25)).toBeCloseTo(skyBeta(SKY.periodS * 0.25), 12);
    expect(skyBeta(-1)).toBeCloseTo(skyBeta(SKY.periodS - 1), 12);
  });

  it('reste dans [0, betaMax] (< 1)', () => {
    for (let t = 0; t < 2 * SKY.periodS; t += 0.37) {
      const b = skyBeta(t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(SKY.betaMax);
    }
    expect(SKY.betaMax).toBeLessThan(1);
  });
});

describe('aberration et Doppler le long du mouvement', () => {
  const beta = { x: 0, y: 0, z: 0.8 };
  for (const cos of [-0.95, -0.5, 0, 0.3, 0.9]) {
    it(`cos θ = ${cos} : comme aberrate et dopplerFactor du moteur`, () => {
      const sin = Math.sqrt(1 - cos * cos);
      const n = { x: sin, y: 0, z: cos };
      const a = aberrate(beta, n);
      expect(aberrateCos(cos, 0.8)).toBeCloseTo(a.z, 12);
      expect(dopplerCos(cos, 0.8)).toBeCloseTo(dopplerFactor(beta, n), 12);
      // D = 1/(γ(1 − β cos θ′)) avec la direction apparente.
      expect(dopplerCos(cos, 0.8)).toBeCloseTo(1 / (gammaOf(0.8) * (1 - 0.8 * aberrateCos(cos, 0.8))), 12);
    });
  }

  it('le ciel se resserre devant : cos θ′ ≥ cos θ', () => {
    for (let cos = -0.99; cos <= 1; cos += 0.11) expect(aberrateCos(cos, 0.6)).toBeGreaterThanOrEqual(cos - 1e-12);
  });

  it('au repos, rien ne change', () => {
    expect(aberrateCos(0.42, 0)).toBe(0.42);
    expect(dopplerCos(0.42, 0)).toBe(1);
  });
});

describe('stereoRadius', () => {
  it('0 droit devant, 1 à 90°, infini droit derrière', () => {
    expect(stereoRadius(1)).toBe(0);
    expect(stereoRadius(0)).toBeCloseTo(1, 12);
    expect(stereoRadius(-1)).toBe(Infinity);
    expect(stereoRadius(Math.cos(Math.PI / 3))).toBeCloseTo(Math.tan(Math.PI / 6), 12);
  });
});

describe('makeStars', () => {
  it('déterministe, uniforme en cos θ, valeurs dans leurs plages', () => {
    const a = makeStars(300);
    expect(a).toEqual(makeStars(300));
    expect(a).toHaveLength(300);
    let mean = 0;
    for (const s of a) {
      expect(Math.abs(s.cos)).toBeLessThanOrEqual(1);
      expect(s.phi).toBeGreaterThanOrEqual(0);
      expect(s.phi).toBeLessThan(2 * Math.PI);
      expect([0, 1, 2]).toContain(s.kind);
      expect(s.mag).toBeGreaterThanOrEqual(0.35);
      expect(s.mag).toBeLessThanOrEqual(1);
      mean += s.cos / a.length;
    }
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });
});

describe('starColorTable', () => {
  const table = starColorTable();
  const steps = Math.round((SKY.log2Max - SKY.log2Min) / SKY.log2Step) + 1;
  const sun = SKY.temperatures.indexOf(5800);

  it('une ligne par température, une entrée par pas de log2 D', () => {
    expect(table.rgb).toHaveLength(SKY.temperatures.length);
    for (const row of table.rgb) expect(row).toHaveLength(steps);
  });

  it('au repos, une étoile solaire est blanche, de luminance 1', () => {
    const i = tableIndex(1);
    const [r, g, b] = rgbOf(table.rgb[sun][i]);
    expect(Math.min(r, g, b)).toBeGreaterThan(235);
    expect(table.intensity[sun][i]).toBeCloseTo(1, 2);
  });

  it('devant (D = 2) : bleue et plus lumineuse ; derrière (D = 0,5) : rouge et plus sombre', () => {
    const [r2, , b2] = rgbOf(table.rgb[sun][tableIndex(2)]);
    const [rh, , bh] = rgbOf(table.rgb[sun][tableIndex(0.5)]);
    expect(b2).toBeGreaterThan(r2);
    expect(rh).toBeGreaterThan(bh);
    expect(table.intensity[sun][tableIndex(2)]).toBeGreaterThan(5);
    expect(table.intensity[sun][tableIndex(0.5)]).toBeLessThan(0.1);
  });
});

describe('tableIndex et starLook', () => {
  it('indice borné aux extrémités', () => {
    expect(tableIndex(1e-6)).toBe(0);
    expect(tableIndex(1e6)).toBe(Math.round((SKY.log2Max - SKY.log2Min) / SKY.log2Step));
    expect(tableIndex(1)).toBe(Math.round(-SKY.log2Min / SKY.log2Step));
  });

  it('plus lumineuse = plus opaque et plus grosse, dans des bornes', () => {
    const faint = starLook(0.01, 1);
    const bright = starLook(50, 1);
    expect(bright.alpha).toBeGreaterThan(faint.alpha);
    expect(bright.size).toBeGreaterThan(faint.size);
    expect(bright.alpha).toBeLessThanOrEqual(1);
    expect(starLook(0, 1).alpha).toBe(0);
  });
});

describe('formatSkyReadout', () => {
  it('virgule décimale, deux décimales tronquées', () => {
    expect(formatSkyReadout(0.6)).toBe('v = 0,60 c · γ = 1,25');
    expect(formatSkyReadout(0)).toBe('v = 0,00 c · γ = 1,00');
    expect(formatSkyReadout(0.899)).toContain('0,89');
  });
});
