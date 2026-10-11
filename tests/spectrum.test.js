// Tests du modèle spectral et de la LUT Doppler (src/physics/spectrum.js).
// Les références (𝐍, intégrales, facteur Doppler) sont recalculées ici de façon
// indépendante : autre pas d'intégration, D = √((1 + β)/(1 − β)) écrit à la main.
import { describe, it, expect, beforeAll } from 'vitest';
import palette from '../src/data/palette.json';
import {
  cmfWyman,
  planck,
  XYZ_TO_LINEAR_SRGB,
  luminance,
  reflectanceBasis,
  colorMatrix,
  blackbodyColor,
  lineColor,
  gamutMap,
  beamFactor,
  toneMap,
  perceivedColor,
  classifyHue,
  clearSkyColor,
  adaptationExposure,
  buildDopplerLutData,
  sampleLutLikeGpu,
  halfFloatBits,
  roundToHalfFloat,
  colorMatrixOpenRelativity,
  openRelativityColor,
  constrainRgbOpenRelativity,
} from '../src/physics/spectrum.js';
import {
  WAVELENGTH_MIN,
  WAVELENGTH_MAX,
  SUN_TEMPERATURE,
  BEAM_EXPONENT,
  BEAM_MAX,
  TONEMAP_KNEE,
  LUT_SIZE,
  LUT_LOG2_RANGE,
  LUT_ROWS,
  LUT_HEIGHT,
  BLACKBODY_TEMPERATURES,
  blackbodyRow,
  ADAPTATION_REFERENCE,
  SKY_CLEAR_ROW,
  C,
} from '../src/physics/constants.js';

/* ---------------------------- Outils de référence ---------------------------- */

/**
 * Facteur Doppler d'une source vue de face à la vitesse v (m/s), c = C (réglage par défaut,
 * 30 m/s). Les couleurs ne dépendent que de β = v/c : les vitesses des tests sont écrites
 * β·C (à c = 100 m/s, β = 0,9 était « 90 m/s »).
 */
const dopplerHeadOn = (v, c = C) => {
  const beta = v / c;
  return Math.sqrt((1 + beta) / (1 - beta));
};

const mulMat3Vec = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

function invert3(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/** RGB linéaire de ∫[a ; b] CMF(λ)·S(λ) dλ (Simpson, pas de 0,1 nm : indépendant du module). */
function rgbOfSpectrum(S, a, b) {
  if (!(b > a)) return [0, 0, 0];
  const n = 2 * Math.ceil((b - a) / 0.2);
  const h = (b - a) / n;
  const xyz = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const l = a + i * h;
    const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * S(l);
    const c = cmfWyman(l);
    xyz[0] += w * c.x;
    xyz[1] += w * c.y;
    xyz[2] += w * c.z;
  }
  return mulMat3Vec(XYZ_TO_LINEAR_SRGB, xyz.map((v) => (v * h) / 3));
}

/** Supports des bases (longueur d'onde émise), écrits d'après le contrat. */
const SUPPORTS = [[590, 830], [490, 590], [360, 490], [830, Infinity], [0, 360]];

/** RGB brut de la base k vue avec D (intégration découpée aux bornes exactes). */
function rawBasis(k, D) {
  const [s, e] = SUPPORTS[k];
  const lo = Math.max(360, s / D);
  const hi = Math.min(830, e / D);
  return rgbOfSpectrum((l) => D * planck(D * l, 5800), lo, hi);
}

/** 𝐍 recalculé : inverse du bloc RGB des bases r, g, b au repos. */
let N_REF;
const rawBlackbody = (T) => rgbOfSpectrum((l) => planck(l, T), 360, 830);
const adaptedBlackbody = (T) => mulMat3Vec(N_REF, rawBlackbody(T));

beforeAll(() => {
  const cols = [0, 1, 2].map((k) => rawBasis(k, 1));
  N_REF = invert3([0, 1, 2].map((row) => cols.map((c) => c[row])));
});

const maxAbs = (v) => Math.max(...v.map(Math.abs));
const maxDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
const apply = (M, w) => [0, 1, 2].map((j) => M.reduce((s, col, k) => s + col[j] * (w[k] ?? 0), 0));

/** Couleur sRGB (hex) → réflectances linéaires. */
const srgbHexToLinear = (hex) => [0, 2, 4].map((i) => {
  const s = parseInt(hex.slice(i, i + 2), 16) / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
});
/** Façades saturées de la palette (ordre de l'arc-en-ciel, plan §6). */
const FACADES = {
  rouge: 'E8371E',
  orange: 'F28A1A',
  jaune: 'F5C71A',
  vert: '34B04A',
  cyan: '1FB5C9',
  bleu: '3557E0',
  violet: '8A3FD1',
};

/* ---------------------------------- Tests ---------------------------------- */

describe('CMF, Planck et XYZ → sRGB', () => {
  it('cmfWyman suit les valeurs CIE 1931 aux pics', () => {
    expect(cmfWyman(555).y).toBeCloseTo(1.0, 1);
    expect(cmfWyman(600).x).toBeCloseTo(1.0622, 1);
    expect(cmfWyman(445).z).toBeCloseTo(1.7826, 1);
    // ∫ȳ sur [360 ; 830] ≈ 106,86 nm (table CIE)
    let s = 0;
    for (let l = 360; l <= 830; l += 0.5) s += cmfWyman(l).y * 0.5;
    expect(Math.abs(s / 106.857 - 1)).toBeLessThan(0.01);
  });

  it('planck : loi de Wien et identité D⁵·B(Dλ, T) = B(λ, D·T)', () => {
    let best = 0;
    let at = 0;
    for (let l = 400; l <= 600; l += 0.01) {
      const v = planck(l, SUN_TEMPERATURE);
      if (v > best) [best, at] = [v, l];
    }
    expect(at).toBeCloseTo(2.897771955e6 / SUN_TEMPERATURE, 1);
    for (const D of [0.05, 0.5, 2, 20]) {
      for (const l of [360, 555, 830]) {
        const lhs = D ** 5 * planck(D * l, 2700);
        const rhs = planck(l, D * 2700);
        expect(Math.abs(lhs / rhs - 1)).toBeLessThan(1e-12);
      }
    }
    expect(planck(500, 0)).toBe(0);
    expect(planck(0, 5800)).toBe(0);
    expect(planck(360, 50)).toBe(0); // exp trop grand : 0, pas NaN
  });

  it('XYZ_TO_LINEAR_SRGB envoie le blanc D65 sur (1, 1, 1) et luminance = Y', () => {
    const white = mulMat3Vec(XYZ_TO_LINEAR_SRGB, [0.95047, 1, 1.08883]);
    expect(maxDiff(white, [1, 1, 1])).toBeLessThan(1e-3);
    for (const xyz of [[0.3, 0.5, 0.2], [0.1, 0.05, 0.6]]) {
      expect(luminance(mulMat3Vec(XYZ_TO_LINEAR_SRGB, xyz))).toBeCloseTo(xyz[1], 3);
    }
  });
});

describe('bases de réflectance', () => {
  it('partitionnent l\'unité sur [0 ; ∞), frontières comprises', () => {
    const probes = [0, 100, 359.999, 360, 489.999, 490, 589.999, 590, 829.999, 830, 1200, 1e5];
    for (let l = 0; l <= 2000; l += 0.5) probes.push(l);
    for (const l of probes) {
      const sum = [0, 1, 2, 3, 4].reduce((s, k) => s + reflectanceBasis(k, l), 0);
      expect(sum).toBe(1);
    }
    expect(reflectanceBasis(LUT_ROWS.uv, 359.999)).toBe(1);
    expect(reflectanceBasis(LUT_ROWS.b, 360)).toBe(1);
    expect(reflectanceBasis(LUT_ROWS.g, 490)).toBe(1);
    expect(reflectanceBasis(LUT_ROWS.r, 590)).toBe(1);
    expect(reflectanceBasis(LUT_ROWS.ir, 830)).toBe(1);
    expect(reflectanceBasis(LUT_ROWS.ir, 1e6)).toBe(1);
    expect(() => reflectanceBasis(5, 500)).toThrow();
  });
});

describe('matrice Doppler M(D)', () => {
  it('M(1) = [I | 0] à 1e-12 (colonnes IR et UV nulles)', () => {
    const M = colorMatrix(1);
    expect(M).toHaveLength(5);
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let k = 0; k < 3; k++) expect(maxDiff(M[k], I[k])).toBeLessThan(1e-12);
    expect(maxAbs(M[LUT_ROWS.ir])).toBeLessThan(1e-12);
    expect(maxAbs(M[LUT_ROWS.uv])).toBeLessThan(1e-12);
  });

  it('suit la définition 𝐍·RGB(∫ CMF·D·E(Dλ)·ρ_k(Dλ) dλ) (intégration indépendante)', () => {
    for (const D of [0.37, 0.8, 1.07, 1.3, 2.5]) {
      const M = colorMatrix(D);
      const ref = [0, 1, 2, 3, 4].map((k) => mulMat3Vec(N_REF, rawBasis(k, D)));
      const scale = Math.max(...ref.map(maxAbs));
      for (let k = 0; k < 5; k++) expect(maxDiff(M[k], ref[k]) / scale).toBeLessThan(1e-5);
    }
  });

  it('IR visible seulement si D > 1, UV seulement si D < 1', () => {
    // D = 0,99 et 1,01 : support observé de quelques nm seulement, mais non nul
    for (const D of [0.3, 0.7, 0.99]) {
      const M = colorMatrix(D);
      expect(maxAbs(M[LUT_ROWS.ir])).toBe(0);
      expect(maxAbs(M[LUT_ROWS.uv])).toBeGreaterThan(D < 0.9 ? 1e-3 : 0);
    }
    for (const D of [1.01, 1.5, 8]) {
      const M = colorMatrix(D);
      expect(maxAbs(M[LUT_ROWS.uv])).toBe(0);
      expect(maxAbs(M[LUT_ROWS.ir])).toBeGreaterThan(D > 1.1 ? 1e-3 : 0);
    }
  });

  it('invariance du corps noir : D⁴·M(D)·blanc = 𝐍·RGB(B(λ, D·5800 K)) à 1e-4', () => {
    const white = [1, 1, 1, 1, 1]; // r + g + b + ir + uv ≡ 1 : réflectance plate
    for (const D of [0.5, 2, 6, 20]) {
      const lhs = apply(colorMatrix(D), white).map((v) => v * D ** 4);
      const rhs = adaptedBlackbody(D * SUN_TEMPERATURE);
      expect(maxDiff(lhs, rhs) / maxAbs(rhs)).toBeLessThan(1e-4);
      // un facteur D en trop ou en moins se verrait d'un facteur 2 au moins
      expect(maxDiff(lhs.map((v) => v * D), rhs) / maxAbs(rhs)).toBeGreaterThan(0.4);
    }
  });

  it('rejette un facteur Doppler invalide', () => {
    for (const D of [0, -1, NaN, Infinity]) expect(() => colorMatrix(D)).toThrow(RangeError);
  });
});

describe('lampes corps noir', () => {
  it('luminance 1 au repos ; 5 800 K a la couleur du blanc éclairé par le soleil', () => {
    for (const T of [...BLACKBODY_TEMPERATURES, SUN_TEMPERATURE]) {
      expect(luminance(blackbodyColor(1, T))).toBeCloseTo(1, 12);
    }
    expect(maxDiff(blackbodyColor(1, SUN_TEMPERATURE), [1, 1, 1])).toBeLessThan(1e-5);
    const warm = blackbodyColor(1, 2700);
    expect(warm[0]).toBeGreaterThan(warm[1]);
    expect(warm[1]).toBeGreaterThan(warm[2]);
  });

  it('blackbodyColor(D, T)·D⁴ = corps noir de température D·T (chromaticité et intensité), sans double D⁴', () => {
    for (const T of [2700, 6500]) {
      const restY = luminance(adaptedBlackbody(T));
      for (const D of [0.5, 0.8, 1.25, 2, 4]) {
        const lamp = blackbodyColor(D, T).map((v) => v * D ** 4);
        const ref = adaptedBlackbody(D * T).map((v) => v / restY);
        expect(maxDiff(lamp, ref) / maxAbs(ref)).toBeLessThan(1e-4);
        // même chromaticité : rapports entre canaux identiques
        expect(lamp[2] / lamp[0]).toBeCloseTo(ref[2] / ref[0], 4);
        // avec le projecteur physique non borné, on retrouve exactement ce corps noir
        const seen = perceivedColor({ kind: 'blackbody', T }, D, { beamMax: Infinity, knee: Infinity });
        expect(maxDiff(seen, gamutMap(ref)) / maxAbs(ref)).toBeLessThan(1e-4);
      }
    }
  });
});

describe('raies monochromatiques', () => {
  it('luminance ȳ(λ)/max ȳ, composantes ≥ 0, noir hors de [360 ; 830] nm', () => {
    let yMax = 0;
    for (let l = 540; l <= 580; l += 0.001) yMax = Math.max(yMax, cmfWyman(l).y);
    for (let l = WAVELENGTH_MIN; l <= WAVELENGTH_MAX; l += 2.5) {
      const c = lineColor(l);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
      expect(luminance(c)).toBeCloseTo(cmfWyman(l).y / yMax, 7);
    }
    expect(lineColor(359)).toEqual([0, 0, 0]);
    expect(lineColor(900)).toEqual([0, 0, 0]);
  });

  it('ramenée dans le gamut sans changer de teinte (mélange avec le gris de même luminance)', () => {
    for (let l = WAVELENGTH_MIN; l <= WAVELENGTH_MAX; l += 5) {
      const cmf = cmfWyman(l);
      const raw = mulMat3Vec(N_REF, mulMat3Vec(XYZ_TO_LINEAR_SRGB, [cmf.x, cmf.y, cmf.z]));
      expect(luminance(raw)).toBeGreaterThan(0); // luminance adaptée positive partout
      const c = lineColor(l);
      const Y = luminance(c);
      const target = raw.map((v) => (v * Y) / luminance(raw));
      // c − Y = s·(target − Y), même s pour les trois canaux, s ∈ ]0 ; 1]
      const dir = target.map((v) => v - Y);
      const j = dir.map(Math.abs).indexOf(maxAbs(dir));
      const s = (c[j] - Y) / dir[j];
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThanOrEqual(1 + 1e-9);
      for (let i = 0; i < 3; i++) expect(c[i] - Y).toBeCloseTo(s * dir[i], 6);
    }
  });
});

describe('gamut, projecteur, tone mapping', () => {
  it('gamutMap : identité dans le gamut, luminance conservée, noir si Y ≤ 0', () => {
    expect(gamutMap([0.2, 0.5, 0])).toEqual([0.2, 0.5, 0]);
    const c = gamutMap([1.5, -0.2, 0.1]);
    expect(Math.min(...c)).toBeCloseTo(0, 12);
    expect(luminance(c)).toBeCloseTo(luminance([1.5, -0.2, 0.1]), 12);
    expect(gamutMap([-1, 0.1, 0])).toEqual([0, 0, 0]);
  });

  it('beamFactor = min(D^p, max), p = 4 et max = BEAM_MAX par défaut', () => {
    expect(BEAM_EXPONENT).toBe(4);
    expect(beamFactor(1)).toBe(1);
    expect(beamFactor(1.2)).toBeCloseTo(1.2 ** 4, 12);
    expect(beamFactor(0.5)).toBeCloseTo(0.0625, 12);
    expect(beamFactor(9)).toBe(BEAM_MAX);
    expect(beamFactor(4.36)).toBeCloseTo(4.36 ** 4, 9); // β = 0,9 de face : D⁴ non borné
    expect(beamFactor(2, 2, 10)).toBe(4);
  });

  it('toneMap : identité sous le genou, compression douce et continue, teinte conservée', () => {
    const K = TONEMAP_KNEE;
    expect(toneMap([0.3, K, 0.1])).toEqual([0.3, K, 0.1]);
    for (const m of [K + 1e-9, 0.9, 1, 2, 10, 1e6]) {
      const c = [m, m / 2, m / 4];
      const t = toneMap(c);
      const expected = K + (1 - K) * (1 - Math.exp(-(m - K) / (1 - K)));
      expect(t[0]).toBeCloseTo(expected, 12);
      expect(t[0]).toBeLessThanOrEqual(1); // < 1 en exact ; = 1 en flottant pour m énorme
      expect(t[1] / t[0]).toBeCloseTo(0.5, 12);
      expect(t[2] / t[0]).toBeCloseTo(0.25, 12);
    }
    // continuité C¹ au genou et monotonie
    const d = 1e-6;
    expect((toneMap([K + d, 0, 0])[0] - K) / d).toBeCloseTo(1, 5);
    let previous = 0;
    for (let m = 0; m < 5; m += 0.01) {
      const v = toneMap([m, 0, 0])[0];
      expect(v).toBeGreaterThanOrEqual(previous);
      previous = v;
    }
    expect(toneMap([3, 1.5, 0], 1)).toEqual([1, 0.5, 0]); // genou ≥ 1 : écrêtage du maximum
  });

  it('perceivedColor enchaîne Doppler, gamut, projecteur × exposition et tone mapping', () => {
    const rho = [0.6, 0.3, 0.1, 0.5, 0.2];
    const D = 1.4;
    const expected = toneMap(gamutMap(apply(colorMatrix(D), rho)).map((v) => v * beamFactor(D) * 0.7));
    expect(maxDiff(perceivedColor({ kind: 'surface', reflectance: rho }, D, { exposure: 0.7 }), expected))
      .toBeLessThan(1e-12);
    const line = perceivedColor({ kind: 'line', lambda: 640, intensity: 0.5 }, D);
    expect(maxDiff(line, toneMap(lineColor(640 / D).map((v) => v * 0.5 * beamFactor(D))))).toBeLessThan(1e-12);
    expect(() => perceivedColor({ kind: 'laser' }, 1)).toThrow(TypeError);
  });
});

describe('classifyHue', () => {
  it('nomme les couleurs de référence', () => {
    const cases = [
      [[1, 0, 0], 'rouge'],
      [[1, 0.216, 0], 'orange'],
      [[1, 1, 0], 'jaune'],
      [[0, 1, 0], 'vert'],
      [[0, 1, 1], 'cyan'],
      [[0, 0, 1], 'bleu'],
      [[0.216, 0, 1], 'violet'],
      [[1, 0, 1], 'violet'],
      [[0, 0, 0], 'noir'],
      [[0.003, 0.003, 0.003], 'noir'],
      [[0.9, 0.9, 0.9], 'blanc'],
      [[0.2, 0.2, 0.2], 'gris'],
    ];
    for (const [rgb, name] of cases) expect(classifyHue(rgb)).toBe(name);
    for (const [name, hex] of Object.entries(FACADES)) expect(classifyHue(srgbHexToLinear(hex))).toBe(name);
  });

  it('ne dépend pas de l\'intensité tant que la couleur est assez claire', () => {
    for (const hex of Object.values(FACADES)) {
      const c = srgbHexToLinear(hex);
      expect(classifyHue(c.map((v) => v * 0.3))).toBe(classifyHue(c));
    }
  });

  it('lampe à 640 nm : « vert » exactement quand λ₀/D ∈ [510 ; 562] nm (±3 nm), balayage fin de v', () => {
    const greenSteps = [];
    const dBeta = 5e-5;
    for (let i = 0; i <= 8000; i++) {
      const v = i * dBeta * C; // β de 0 à 0,4 (0 à 12 m/s à c = 30)
      const D = dopplerHeadOn(v);
      const lambdaSeen = 640 / D;
      const isGreen = classifyHue(perceivedColor({ kind: 'line', lambda: 640 }, D)) === 'vert';
      // Même fenêtre avec l'adaptation de l'écran (règle de porte du jeu).
      const adapted = perceivedColor({ kind: 'line', lambda: 640 }, D, { exposure: adaptationExposure(D) });
      expect(classifyHue(adapted) === 'vert', `v = ${v} m/s (adaptation)`).toBe(isGreen);
      if (lambdaSeen >= 513 && lambdaSeen <= 559) expect(isGreen, `v = ${v} m/s`).toBe(true);
      if (lambdaSeen < 507 || lambdaSeen > 565) expect(isGreen, `v = ${v} m/s`).toBe(false);
      if (isGreen) greenSteps.push(i);
    }
    // une seule plage, β ≈ [0,129 ; 0,223] : v ≈ [3,9 ; 6,7] m/s à c = 30 ([12,9 ; 22,3] à c = 100)
    expect(greenSteps.length).toBe(greenSteps[greenSteps.length - 1] - greenSteps[0] + 1);
    const lo = greenSteps[0] * dBeta * C;
    const hi = greenSteps[greenSteps.length - 1] * dBeta * C;
    expect(640 / dopplerHeadOn(lo)).toBeGreaterThan(559);
    expect(640 / dopplerHeadOn(lo)).toBeLessThan(565);
    expect(640 / dopplerHeadOn(hi)).toBeGreaterThan(507);
    expect(640 / dopplerHeadOn(hi)).toBeLessThan(513);
    expect(lo / C).toBeCloseTo(0.129, 2);
    expect(hi / C).toBeCloseTo(0.223, 2);
    expect(lo).toBeCloseTo(3.87, 1);
    expect(hi).toBeCloseTo(6.69, 1);
    // au repos la lampe est rouge
    expect(classifyHue(perceivedColor({ kind: 'line', lambda: 640 }, 1))).toBe('rouge');
  });
});

describe('Doppler et lisibilité', () => {
  it('bleu devant : une façade rouge vue à D = 1,3 n\'est plus rouge', () => {
    const facade = { kind: 'surface', reflectance: [...srgbHexToLinear(FACADES.rouge), 0.3, 0.1] };
    expect(classifyHue(perceivedColor(facade, 1))).toBe('rouge');
    expect(classifyHue(perceivedColor(facade, 1.3))).not.toBe('rouge');
  });

  it('le blanc vire au bleuté devant (D > 1) et au rougeâtre derrière (D < 1)', () => {
    const white = { kind: 'surface', reflectance: [1, 1, 1, 1, 1] };
    const rest = perceivedColor(white, 1);
    expect(rest[2] / rest[0]).toBeCloseTo(1, 12);
    let previous = 1;
    for (const D of [1.1, 1.3, 2, 4]) {
      const c = perceivedColor(white, D);
      expect(c[2] / c[0]).toBeGreaterThan(previous);
      previous = c[2] / c[0];
    }
    previous = 1;
    for (const D of [0.9, 0.7, 0.5]) {
      const c = perceivedColor(white, D);
      expect(c[0] / c[2]).toBeGreaterThan(previous);
      previous = c[0] / c[2];
    }
  });

  it('façade saturée (ir = 0,3) vue de face à γ = 4 : ≥ 2 % de la luminance du blanc au repos', () => {
    const gamma = 4;
    const beta = Math.sqrt(1 - 1 / gamma ** 2);
    const D = gamma * (1 + beta); // ≈ 7,87
    expect(D).toBeCloseTo(7.873, 3);
    const whiteRest = luminance(apply(colorMatrix(1), [1, 1, 1, 0, 0]));
    expect(whiteRest).toBeCloseTo(1, 12);
    const M = colorMatrix(D);
    for (const hex of Object.values(FACADES)) {
      const rho = [...srgbHexToLinear(hex), 0.3, 0];
      const seen = luminance(gamutMap(apply(M, rho))) * beamFactor(D, 4, BEAM_MAX);
      expect(seen).toBeGreaterThanOrEqual(0.02 * whiteRest);
    }
  });
});

describe('half float', () => {
  it('arrondit au plus proche pair (normaux, dénormaux, dépassement)', () => {
    expect(halfFloatBits(1)).toBe(0x3c00);
    expect(halfFloatBits(-2)).toBe(0xc000);
    expect(halfFloatBits(0)).toBe(0);
    expect(halfFloatBits(-0)).toBe(0x8000);
    expect(halfFloatBits(65504)).toBe(0x7bff);
    expect(halfFloatBits(65519)).toBe(0x7bff);
    expect(halfFloatBits(65520)).toBe(0x7c00); // milieu → pair → ∞
    expect(halfFloatBits(Infinity)).toBe(0x7c00);
    expect(Number.isNaN(roundToHalfFloat(NaN))).toBe(true);
    expect(roundToHalfFloat(1 + 2 ** -11)).toBe(1); // milieu → pair (vers le bas)
    expect(roundToHalfFloat(1 + 3 * 2 ** -11)).toBe(1 + 2 ** -9); // milieu → pair (vers le haut)
    expect(roundToHalfFloat(1 + 2 ** -11 + 2 ** -20)).toBe(1 + 2 ** -10);
    expect(roundToHalfFloat(2 ** -24)).toBe(2 ** -24); // plus petit dénormal
    expect(roundToHalfFloat(2 ** -25)).toBe(0); // milieu → pair (0)
    expect(roundToHalfFloat(3 * 2 ** -25)).toBe(2 ** -23); // milieu → pair (2 quanta)
    expect(roundToHalfFloat(2 ** -14 - 2 ** -26)).toBe(2 ** -14); // dénormal arrondi vers le normal
    expect(roundToHalfFloat(0.1)).toBe(0.0999755859375);
    expect(roundToHalfFloat(-1234.567)).toBe(-1235);
  });

  it('erreur relative ≤ 2⁻¹¹ sur la plage normale', () => {
    for (let x = 6.2e-5; x < 6e4; x *= 1.0137) {
      expect(Math.abs(roundToHalfFloat(x) / x - 1)).toBeLessThanOrEqual(2 ** -11 + 1e-12);
    }
  });
});

describe('LUT Doppler', () => {
  let lut;
  beforeAll(() => {
    lut = buildDopplerLutData();
  });

  it('dimensions, valeurs finies et représentables en half float', () => {
    expect(lut.width).toBe(LUT_SIZE);
    expect(lut.height).toBe(LUT_HEIGHT);
    expect(lut.log2Range).toBe(LUT_LOG2_RANGE);
    expect(lut.data).toBeInstanceOf(Float32Array);
    expect(lut.data.length).toBe(LUT_SIZE * LUT_HEIGHT * 4);
    for (const v of lut.data) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThan(65504);
    }
  });

  it('texel i ↔ log₂ D = −L + 2L·i/(N − 1) ; lignes M(D) puis corps noirs', () => {
    const L = LUT_LOG2_RANGE;
    for (const i of [0, 37, 128, 200, LUT_SIZE - 1]) {
      const D = 2 ** (-L + (2 * L * i) / (LUT_SIZE - 1));
      const M = colorMatrix(D);
      const texel = (row) => Array.from(lut.data.subarray((row * LUT_SIZE + i) * 4, (row * LUT_SIZE + i) * 4 + 3));
      for (const k of Object.values(LUT_ROWS)) {
        expect(maxDiff(texel(k), M[k])).toBeLessThanOrEqual(1e-6 * Math.max(1, maxAbs(M[k])));
      }
      for (const T of BLACKBODY_TEMPERATURES) {
        const bb = blackbodyColor(D, T);
        expect(maxDiff(texel(blackbodyRow(T)), bb)).toBeLessThanOrEqual(1e-6 * Math.max(1, maxAbs(bb)));
      }
    }
  });

  it('échantillonnée comme le GPU à D = 1 : [I | 0] à 1e-3, corps noirs inchangés', () => {
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 5; k++) expect(maxDiff(sampleLutLikeGpu(lut, 1, k), I[k])).toBeLessThan(1e-3);
    for (const T of BLACKBODY_TEMPERATURES) {
      const exact = blackbodyColor(1, T);
      expect(maxDiff(sampleLutLikeGpu(lut, 1, blackbodyRow(T)), exact) / maxAbs(exact)).toBeLessThan(1e-3);
    }
  });

  it('échantillonnée comme le GPU ailleurs : proche du modèle exact, bornée aux bords', () => {
    const white = [1, 1, 1, 0.3, 0.3];
    for (let l2 = -4.4; l2 <= 4.4; l2 += 0.173) {
      const D = 2 ** l2;
      const exact = apply(colorMatrix(D), white);
      const sampled = [0, 1, 2].map((j) => [0, 1, 2, 3, 4]
        .reduce((s, k) => s + white[k] * sampleLutLikeGpu(lut, D, k)[j], 0));
      // interpolation linéaire entre texels distants de 0,035 en log₂ D : ≈ 2 % au pire
      // (vers D ≈ 1,95, quand la borne 830/D de la base IR traverse le lobe bleu de z̄)
      expect(maxDiff(sampled, exact)).toBeLessThan(0.03 * Math.max(maxAbs(exact), 0.05));
    }
    // hors plage : bord de la texture (ClampToEdge)
    const far = sampleLutLikeGpu(lut, 2 ** 10, LUT_ROWS.ir);
    const edge = Array.from(lut.data.subarray((LUT_ROWS.ir * LUT_SIZE + LUT_SIZE - 1) * 4, (LUT_ROWS.ir * LUT_SIZE + LUT_SIZE - 1) * 4 + 3));
    expect(maxDiff(far, edge.map(roundToHalfFloat))).toBe(0);
    expect(() => sampleLutLikeGpu(lut, 1, LUT_HEIGHT)).toThrow(RangeError);
  });

  it('accepte une taille, une plage et des températures personnalisées', () => {
    const small = buildDopplerLutData({ size: 9, log2Range: 1, temperatures: [3000] });
    expect(small.width).toBe(9);
    expect(small.height).toBe(7);
    expect(small.data.length).toBe(9 * 7 * 4);
    expect(maxDiff(sampleLutLikeGpu(small, 1, 5), blackbodyColor(1, 3000))).toBeLessThan(2e-3);
  });
});

describe('préréglage OpenRelativity (comparaison)', () => {
  it('quasi-identité au repos, mêmes 5 colonnes que colorMatrix (IR et UV nulles)', () => {
    const M = colorMatrixOpenRelativity(1);
    expect(M).toHaveLength(5);
    const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let k = 0; k < 3; k++) expect(maxDiff(M[k], I[k])).toBeLessThan(0.01);
    expect(M[3]).toEqual([0, 0, 0]);
    expect(M[4]).toEqual([0, 0, 0]);
    expect(maxDiff(openRelativityColor([0.8, 0.4, 0.2], 1), [0.8, 0.4, 0.2])).toBeLessThan(0.03);
  });

  it('constrainRGB ajoute du blanc puis divise par le maximum', () => {
    expect(constrainRgbOpenRelativity([0.5, -0.25, 0.25])).toEqual([0.75, 0, 0.5]);
    expect(constrainRgbOpenRelativity([2, 1, 0])).toEqual([1, 0.5, 0]);
  });

  it('s\'éteint de face vers β = 0,54, contrairement au modèle du jeu', () => {
    const D = dopplerHeadOn(0.54 * C);
    expect(luminance(openRelativityColor([1, 1, 1], D))).toBeLessThan(0.02);
    const ours = luminance(apply(colorMatrix(D), [1, 1, 1, 0.3, 0.3])) * beamFactor(D);
    expect(ours).toBeGreaterThan(0.2);
  });
});

describe('projecteur physique et adaptation (revue J1)', () => {
  const lumAhead = (rho, D) => luminance(gamutMap(apply(colorMatrix(D), rho))) * beamFactor(D);

  it('façades de face : plus lumineuses à β = 0,9 qu’à β = 0,477 (BEAM_MAX = 8 inversait l’ordre)', () => {
    for (const hex of [...Object.values(FACADES), 'EDE6D6']) {
      const rho = [...srgbHexToLinear(hex), 0.3, 0.1];
      const at48 = lumAhead(rho, dopplerHeadOn(0.477 * C));
      const at90 = lumAhead(rho, dopplerHeadOn(0.9 * C));
      expect(at90 / at48, hex).toBeGreaterThan(3);
      // l'ancienne borne : β = 0,9 plus sombre que β = 0,477
      const old = (D) => luminance(gamutMap(apply(colorMatrix(D), rho))) * beamFactor(D, 4, 8);
      expect(old(dopplerHeadOn(0.9 * C)) / old(dopplerHeadOn(0.477 * C)), hex).toBeLessThan(0.5);
    }
  });

  it('adaptation : la façade de référence vue de face garde sa luminance de repos', () => {
    expect(adaptationExposure(1)).toBe(1);
    expect(adaptationExposure(0.5)).toBe(1);
    const rest = luminance(ADAPTATION_REFERENCE);
    let previous = 1;
    for (const beta of [0.05, 0.2, 0.3, 0.5, 0.7616, 0.9, 0.95]) {
      const D = dopplerHeadOn(beta * C);
      const E = adaptationExposure(D);
      expect(E).toBeLessThan(previous);
      previous = E;
      expect(Math.abs((lumAhead(ADAPTATION_REFERENCE, D) * E) / rest - 1)).toBeLessThan(2e-3);
      expect(E).toBeLessThanOrEqual(1);
    }
  });

  it('ciel dégagé continu : luminance de repos, bleu sans fausses teintes, pas de creux vers D = 2', () => {
    expect(luminance(clearSkyColor(1))).toBeCloseTo(0.186, 6);
    let previous = 0;
    for (let D = 1; D <= 4.5; D += 0.05) {
      const c = clearSkyColor(D);
      if (D <= 2.5) expect(classifyHue(c.map((x) => x * 3)), `D = ${D}`).toBe('bleu');
      const y = luminance(c) * D ** 4;
      expect(y, `D = ${D}`).toBeGreaterThan(previous);
      previous = y;
    }
    const lut = buildDopplerLutData();
    expect(maxDiff(sampleLutLikeGpu(lut, 1, SKY_CLEAR_ROW), clearSkyColor(1))).toBeLessThan(1e-3);
  });

  it('palette : au-delà de D = 830/360, les façades restent distinctes par leur proche IR', () => {
    // À D = 3, seule la base IR tombe dans le visible : avec ir = 0,3 partout, rapport 1,000.
    const names = ['rouge', 'orange', 'jaune', 'vert', 'cyan', 'bleu', 'violet'];
    const lums = names.map((n) => {
      const { srgb, ir, uv } = palette[n];
      return lumAhead([...srgbHexToLinear(srgb.slice(1)), ir, uv], 3);
    });
    expect(Math.max(...lums) / Math.min(...lums)).toBeGreaterThanOrEqual(3);
    // La moyenne des façades reste proche de la référence d'adaptation (ir 0,3).
    const meanIr = names.reduce((s, n) => s + palette[n].ir, 0) / names.length;
    expect(Math.abs(meanIr - ADAPTATION_REFERENCE[3])).toBeLessThan(0.05);
  });
});
