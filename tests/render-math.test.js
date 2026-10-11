/**
 * Formules du rendu relativiste : miroir JS des shaders GLSL, vérifié contre
 * physics/relativity.js (aberration, Doppler) et physics/spectrum.js (LUT, couleur perçue).
 *
 * Chaque fonction `glsl…` ci-dessous reprend LIGNE À LIGNE une fonction des shaders ; un
 * dernier groupe de tests vérifie que ces lignes figurent bien dans les sources GLSL
 * (garde-fou contre une dérive entre le miroir et les shaders).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DataTexture, DataUtils, HalfFloatType, LessEqualDepth, LinearFilter, RGBAFormat, Vector3 } from 'three';
import { C, EYE_HEIGHT, LUT_HEIGHT, LUT_LOG2_RANGE, LUT_SIZE, TONEMAP_KNEE } from '../src/physics/constants.js';
import { aberrate, aberrateInverse, dopplerFactor, gammaFromU, velocityFromU } from '../src/physics/relativity.js';
import {
  adaptationExposure,
  blackbodyColor,
  buildDopplerLutData,
  colorMatrix,
  perceivedColor,
  sampleLutLikeGpu,
} from '../src/physics/spectrum.js';
import { toThree, toThreeInto } from '../src/render/coords.js';
import { REL, setVisibility, updateObserver } from '../src/render/uniforms.js';
import { createDopplerLutTexture, toHalfFloatNearest } from '../src/render/dopplerLut.js';
import { GLSL_SOURCES, SHADERS, stripGlslComments } from '../src/render/shaders/index.js';
import {
  createClassicVariant,
  createCockpitMaterial,
  createEmitterMaterial,
  createEnvironmentMaterial,
  createEnvironmentMesh,
  createSurfaceMaterial,
} from '../src/render/materials.js';
import { createCamera, updateCamera, verticalFov } from '../src/render/camera.js';
import { createCockpit } from '../src/render/cockpit.js';
import { opaqueSort } from '../src/render/renderer.js';
import { streetMapSize } from '../src/render/streetMap.js';

/* ------------------------------------------------------------------------- */
/* Petits outils vectoriels (tableaux [x, y, z], repère Three)                */
/* ------------------------------------------------------------------------- */

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (a) => scale(a, 1 / len(a));
const obj = (a) => ({ x: a[0], y: a[1], z: a[2] });
const arr = (v) => [v.x, v.y, v.z];
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const mix = (a, b, t) => a + (b - a) * t;

/** Générateur pseudo-aléatoire déterministe (LCG). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Direction unitaire aléatoire (sphère). */
function randomDirection(rand) {
  const u = 2 * rand() - 1;
  const a = 2 * Math.PI * rand();
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(a), u, s * Math.sin(a)];
}

/** Instantané « joueur » pour une vitesse propre (ux, uy) dans le repère du jeu. */
function snapshotFromU(ux, uy) {
  const v = velocityFromU(ux, uy);
  return { vx: v.x, vy: v.y, gamma: gammaFromU(ux, uy) };
}

/** Uniformes observateur lus dans REL (valeurs JS : double précision). */
function observer() {
  return { beta: arr(REL.uBeta.value), gamma: REL.uGamma.value, g2: REL.uG2.value };
}

/* ------------------------------------------------------------------------- */
/* Miroir JS des shaders                                                      */
/* ------------------------------------------------------------------------- */

/** rel_vertex.glsl — relAberrate(rel) : position apparente relative à l'œil. */
function glslAberrate(rel, { beta, gamma, g2 }) {
  const r = len(rel);
  const bn = dot(beta, rel) / Math.max(r, 1e-6);
  const D = gamma * (1 + bn);
  return scale(add(rel, scale(beta, (g2 * bn + gamma) * r)), 1 / D);
}

/** rel_doppler.glsl — relDopplerFactor(rel). */
function glslDopplerFactor(rel, { beta, gamma }) {
  return gamma * (1 + dot(beta, normalize(rel)));
}

/** environment.frag.glsl — relAberrateInverse(nApp, out D). */
function glslAberrateInverse(nApp, { beta, gamma, g2 }) {
  const bn = dot(beta, nApp);
  const D = 1 / (gamma * (1 - bn));
  return { n: scale(add(nApp, scale(beta, g2 * bn - gamma)), D), D };
}

/** environment.frag.glsl — sol : distance bornée et coordonnées de la carte des rues. */
function glslGroundUv(eye, n, { eyeHeight, fogFar, bounds }) {
  const down = -n[1];
  const dist = Math.min(eyeHeight / Math.max(down, 1e-6), fogFar);
  const hitX = eye[0] + n[0] * dist;
  const hitZ = eye[2] + n[2] * dist;
  const game = [hitX, -hitZ];
  return {
    dist,
    uv: [(game[0] - bounds[0]) / (bounds[2] - bounds[0]), (game[1] - bounds[1]) / (bounds[3] - bounds[1])],
  };
}

/** rel_fog.glsl — relFogFactor(r). */
function glslFogFactor(r, near, far) {
  const t = clamp((r - near) / Math.max(far - near, 1e-3), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Lecture d'un texel half float de la texture (comme le GPU après envoi). */
function makeTextureSampler(texture) {
  const { data, width, height } = texture.image;
  const value = (i, j, c) => DataUtils.fromHalfFloat(data[(j * width + i) * 4 + c]);
  /** texture(uLut, vec2(u, v)).rgb avec LinearFilter et ClampToEdge. */
  return (u, v) => {
    const s = u * width - 0.5;
    const t = v * height - 0.5;
    const i0 = Math.floor(s);
    const j0 = Math.floor(t);
    const fs = s - i0;
    const ft = t - j0;
    const ci = (i) => clamp(i, 0, width - 1);
    const cj = (j) => clamp(j, 0, height - 1);
    return [0, 1, 2].map((c) => {
      const a = mix(value(ci(i0), cj(j0), c), value(ci(i0 + 1), cj(j0), c), fs);
      const b = mix(value(ci(i0), cj(j0 + 1), c), value(ci(i0 + 1), cj(j0 + 1), c), fs);
      return mix(a, b, ft);
    });
  };
}

/** rel_doppler.glsl — relLutU, relLutTexel, relLutRow, relSurfaceColor, relGamut, relBeam,
 * relToneMap, relFinish ; `classic` reproduit le define REL_CLASSIC. */
function makeFragmentMirror(texture, params, { classic = false } = {}) {
  const sample = makeTextureSampler(texture);
  const [N, L, H] = params;
  const lutU = (D) => {
    const x = clamp((Math.log2(D) + L) / (2 * L), 0, 1);
    return (x * (N - 1) + 0.5) / N;
  };
  const lutTexel = (u, row) => sample(u, (row + 0.5) / H);
  const lutRow = (D, row) => lutTexel(lutU(D), row);
  const surfaceColor = (rgb, irUv, D) => {
    if (classic) return [...rgb];
    const u = lutU(D);
    const rho = [...rgb, ...irUv];
    const c = [0, 0, 0];
    for (let k = 0; k < 5; k++) {
      const t = lutTexel(u, k);
      for (let j = 0; j < 3; j++) c[j] += rho[k] * t[j];
    }
    return c;
  };
  const gamut = (c) => {
    const m = Math.min(...c);
    if (m >= 0) return c;
    const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return Y > 0 ? c.map((v) => Math.max(Y + (v - Y) * (Y / (Y - m)), 0)) : [0, 0, 0];
  };
  const beam = (D) => (classic ? 1 : Math.min(D ** REL.uBeamExp.value, REL.uBeamMax.value));
  const toneMap = (c, knee) => {
    const m = Math.max(...c);
    if (m <= knee) return c;
    const w = 1 - knee;
    const mt = w > 0 ? knee + w * (1 - Math.exp(-(m - knee) / w)) : 1;
    return c.map((v) => v * (mt / m));
  };
  const finish = (c, D) => toneMap(scale(gamut(c), beam(D) * REL.uExposure.value), REL.uKnee.value);
  return { lutU, lutRow, surfaceColor, gamut, toneMap, finish };
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                      */
/* ------------------------------------------------------------------------- */

describe('coords', () => {
  it('passe du repère du jeu au repère Three : (x, y, z) → (x, z, −y)', () => {
    expect(arr(toThree(3, 4, 5))).toEqual([3, 5, -4]);
    expect(arr(toThree(-2, 7))).toEqual([-2, 0, -7]);
    const target = new Vector3();
    expect(toThreeInto(target, 1, 2, 3)).toBe(target);
    expect(arr(target)).toEqual([1, 3, -2]);
  });
});

describe('uniforms.updateObserver', () => {
  it('β monde → repère Three (βx, 0, −βy), γ et γ²/(γ + 1) en double précision', () => {
    const snap = snapshotFromU(120, -250);
    updateObserver(snap, 1);
    const { beta, gamma, g2 } = observer();
    expect(beta[0]).toBeCloseTo(snap.vx / C, 15);
    expect(beta[1]).toBe(0);
    expect(beta[2]).toBeCloseTo(-snap.vy / C, 15);
    expect(gamma).toBeCloseTo(snap.gamma, 14);
    expect(g2).toBeCloseTo((gamma * gamma) / (gamma + 1), 14);
    expect(1 / Math.sqrt(1 - dot(beta, beta))).toBeCloseTo(gamma, 9);
  });

  it('vision classique : β_eff = kβ, γ_eff = 1/√(1 − k²β²) ; k = 0 donne exactement le repos', () => {
    const phi = 3; // plafond de rapidité
    const snap = snapshotFromU(C * Math.sinh(phi) * Math.cos(0.4), C * Math.sinh(phi) * Math.sin(0.4));
    const b = Math.hypot(snap.vx, snap.vy) / C;
    for (const k of [0.25, 0.5, 0.9, 1]) {
      updateObserver(snap, k);
      const { beta, gamma } = observer();
      expect(len(beta)).toBeCloseTo(k * b, 14);
      expect(gamma / (1 / Math.sqrt(1 - k * k * b * b)) - 1).toBeLessThan(1e-12);
    }
    updateObserver(snap, 1);
    expect(observer().gamma / Math.cosh(phi) - 1).toBeLessThan(1e-13);
    updateObserver(snap, 0);
    const rest = observer();
    expect(len(rest.beta)).toBe(0);
    expect(rest.gamma).toBe(1);
    expect(rest.g2).toBe(0.5);
    // k hors de [0, 1] : borné.
    updateObserver(snap, 7);
    expect(len(observer().beta)).toBeCloseTo(b, 14);
  });

  it('exposition d’adaptation : E(e^φ_eff) suivie à chaque mise à jour, 1 à l’arrêt et en vision classique', () => {
    const phi = Math.atanh(90 / C); // 90 m/s
    const snap = snapshotFromU(C * Math.sinh(phi), 0);
    updateObserver(snap, 1);
    expect(REL.uExposure.value).toBeCloseTo(adaptationExposure(Math.exp(phi)), 12);
    expect(REL.uExposure.value).toBeCloseTo(0.0392, 3);
    updateObserver(snap, 0);
    expect(REL.uExposure.value).toBe(1);
    updateObserver(snapshotFromU(0, 0), 1);
    expect(REL.uExposure.value).toBe(1);
  });

  it('setVisibility pose le brouillard et refuse des distances incohérentes', () => {
    setVisibility(120, 450);
    expect(REL.uFogNear.value).toBe(120);
    expect(REL.uFogFar.value).toBe(450);
    expect(() => setVisibility(500, 400)).toThrow(RangeError);
    setVisibility(150, 600);
  });
});

describe('rel_vertex : aberration par sommet', () => {
  it('direction = aberrate() de physics/relativity.js, distance monde r conservée', () => {
    const rand = rng(1);
    for (let i = 0; i < 2000; i++) {
      const phi = 3 * rand();
      const theta = 2 * Math.PI * rand();
      updateObserver(snapshotFromU(C * Math.sinh(phi) * Math.cos(theta), C * Math.sinh(phi) * Math.sin(theta)), 1);
      const obs = observer();
      const n = randomDirection(rand);
      const r = 0.2 + 3000 * rand() ** 2;
      const apparent = glslAberrate(scale(n, r), obs);
      const ref = aberrate(obj(obs.beta), obj(n));
      expect(len(apparent) / r - 1).toBeCloseTo(0, 12);
      expect(len(add(normalize(apparent), scale(arr(ref), -1)))).toBeLessThan(1e-11);
    }
  });

  it('en float32 (GPU, highp), l’erreur de direction reste < 5e-5 rad jusqu’à φ = 3', () => {
    const f = Math.fround;
    const rand = rng(2);
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const phi = 3 * rand();
      const theta = 2 * Math.PI * rand();
      updateObserver(snapshotFromU(C * Math.sinh(phi) * Math.cos(theta), C * Math.sinh(phi) * Math.sin(theta)), 1);
      const { beta, gamma, g2 } = observer();
      const n = randomDirection(rand);
      const r = 0.3 + 2000 * rand() ** 2;
      // Même suite d'opérations que relAberrate, chaque résultat arrondi en float32.
      const rel = n.map((c) => f(c * r));
      const B = beta.map(f);
      const rr = f(Math.sqrt(f(f(f(rel[0] * rel[0]) + f(rel[1] * rel[1])) + f(rel[2] * rel[2]))));
      const bn = f(f(f(f(B[0] * rel[0]) + f(B[1] * rel[1])) + f(B[2] * rel[2])) / Math.max(rr, 1e-6));
      const D = f(f(gamma) * f(1 + bn));
      const k = f(f(f(f(g2) * bn) + f(gamma)) * rr);
      const out = rel.map((c, j) => f(f(c + f(k * B[j])) / D));
      const ref = arr(aberrate(obj(beta), obj(n)));
      worst = Math.max(worst, len(add(normalize(out), scale(ref, -1))));
    }
    expect(worst).toBeLessThan(5e-5);
  });

  it('REL_CLASSIC et k = 0 : aucune aberration', () => {
    updateObserver(snapshotFromU(80, 30), 0);
    const rel = [12, -1.6, -40];
    expect(glslAberrate(rel, observer())).toEqual(rel);
  });
});

describe('Doppler par fragment et aberration inverse (environnement)', () => {
  it('D(vRel) = dopplerFactor(β, n) = 1/(γ(1 − β·n′)) ; inverse(aberrate(n)) = n', () => {
    const rand = rng(3);
    for (let i = 0; i < 2000; i++) {
      const phi = 3 * rand();
      const theta = 2 * Math.PI * rand();
      updateObserver(snapshotFromU(C * Math.sinh(phi) * Math.cos(theta), C * Math.sinh(phi) * Math.sin(theta)), 1);
      const obs = observer();
      const n = randomDirection(rand);
      const D = glslDopplerFactor(scale(n, 10 + 500 * rand()), obs);
      expect(D / dopplerFactor(obj(obs.beta), obj(n)) - 1).toBeCloseTo(0, 11);
      const nApp = normalize(glslAberrate(scale(n, 50), obs));
      const back = glslAberrateInverse(nApp, obs);
      expect(back.D / D - 1).toBeCloseTo(0, 9);
      expect(len(add(back.n, scale(n, -1)))).toBeLessThan(1e-9);
      const ref = aberrateInverse(obj(obs.beta), obj(nApp));
      expect(len(add(back.n, scale(arr(ref), -1)))).toBeLessThan(1e-12);
      expect(back.D / ref.D - 1).toBeCloseTo(0, 12);
    }
  });

  it('sol : point d’impact sur y = 0, distance bornée à uFogFar, carte des rues dans le repère du jeu', () => {
    const bounds = [-400, -300, 600, 1700];
    const eye = arr(toThree(120, 250, EYE_HEIGHT));
    const target = arr(toThree(140, 280, 0));
    const n = normalize(add(target, scale(eye, -1)));
    const { dist, uv } = glslGroundUv(eye, n, { eyeHeight: EYE_HEIGHT, fogFar: 600, bounds });
    expect(dist).toBeCloseTo(len(add(target, scale(eye, -1))), 9);
    expect(uv[0]).toBeCloseTo((140 + 400) / 1000, 12);
    expect(uv[1]).toBeCloseTo((280 + 300) / 2000, 12);
    // Rayon montant ou rasant : même cercle de rayon uFogFar (coordonnées continues à l'horizon).
    const up = glslGroundUv(eye, normalize([1, 0.2, 0]), { eyeHeight: EYE_HEIGHT, fogFar: 600, bounds });
    const grazing = glslGroundUv(eye, normalize([1, -1e-9, 0]), { eyeHeight: EYE_HEIGHT, fogFar: 600, bounds });
    expect(up.dist).toBe(600);
    expect(grazing.dist).toBe(600);
  });

  it('brouillard : 0 avant uFogNear, totalement opaque à uFogFar, raccord doux', () => {
    expect(glslFogFactor(50, 150, 600)).toBe(0);
    expect(glslFogFactor(150, 150, 600)).toBe(0);
    expect(glslFogFactor(375, 150, 600)).toBeCloseTo(0.5, 15);
    expect(glslFogFactor(600, 150, 600)).toBe(1);
    expect(glslFogFactor(900, 150, 600)).toBe(1);
  });
});

describe('LUT Doppler (dopplerLut.js) lue comme dans rel_doppler.glsl', () => {
  const texture = createDopplerLutTexture();
  const reference = buildDopplerLutData();
  const params = [texture.userData.lut.width, texture.userData.lut.log2Range, texture.userData.lut.height];

  it('DataTexture HalfFloat RGBA 257 × 7, LinearFilter, sans mipmaps, à envoyer', () => {
    expect(texture).toBeInstanceOf(DataTexture);
    expect(texture.type).toBe(HalfFloatType);
    expect(texture.format).toBe(RGBAFormat);
    expect(texture.minFilter).toBe(LinearFilter);
    expect(texture.magFilter).toBe(LinearFilter);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.image.width).toBe(LUT_SIZE);
    expect(texture.image.height).toBe(LUT_HEIGHT);
    expect(texture.image.data).toBeInstanceOf(Uint16Array);
    expect(texture.version).toBeGreaterThan(0); // needsUpdate
    expect(params).toEqual([LUT_SIZE, LUT_LOG2_RANGE, LUT_HEIGHT]);
  });

  it('demi-flottants arrondis au plus proche (égalité : pair), comme sampleLutLikeGpu le suppose', () => {
    const ulp = 2 ** -10;
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(1 + 0.75 * ulp))).toBe(1 + ulp);
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(1 + 0.25 * ulp))).toBe(1);
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(1 + 0.5 * ulp))).toBe(1);
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(1 + 1.5 * ulp))).toBe(1 + 2 * ulp);
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(-(1 + 0.75 * ulp)))).toBe(-(1 + ulp));
    expect(DataUtils.fromHalfFloat(toHalfFloatNearest(0.1))).toBeCloseTo(0.0999755859375, 15);
  });

  it('lecture GPU miroir (coordonnées u, v + filtrage linéaire) = spectrum.sampleLutLikeGpu', () => {
    const mirror = makeFragmentMirror(texture, params);
    const rand = rng(4);
    for (let i = 0; i < 400; i++) {
      const D = 2 ** (-5 + 10 * rand()); // déborde volontairement la plage (bornage)
      for (let row = 0; row < LUT_HEIGHT; row++) {
        const gpu = mirror.lutRow(D, row);
        const ref = sampleLutLikeGpu(reference, D, row);
        for (let j = 0; j < 3; j++) expect(Math.abs(gpu[j] - ref[j])).toBeLessThan(1e-9);
      }
    }
  });

  it('D = 1 tombe au centre du texel central : M(1) = [I | 0] exactement', () => {
    const mirror = makeFragmentMirror(texture, params);
    expect(mirror.lutU(1)).toBe(0.5);
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0], [0, 0, 0]];
    for (let k = 0; k < 5; k++) {
      expect(mirror.lutRow(1, k).map((v) => v + 0)).toEqual(identity[k]);
    }
  });
});

describe('chaîne de couleur des fragments (rel_doppler.glsl) = spectrum.perceivedColor', () => {
  // uExposure suit désormais l'observateur (adaptation) : on compare à l'arrêt (E = 1).
  beforeAll(() => updateObserver({ vx: 0, vy: 0, gamma: 1 }, 1));
  const texture = createDopplerLutTexture();
  const params = [LUT_SIZE, LUT_LOG2_RANGE, LUT_HEIGHT];
  const mirror = makeFragmentMirror(texture, params);
  const surfaces = [
    [0.6, 0.5, 0.4, 0.5, 0.3],
    [0.85, 0.08, 0.06, 0.6, 0.3],
    [0.08, 0.15, 0.75, 0.2, 0.9],
    [1, 1, 1, 1, 1],
    [0.15, 0.6, 0.12, 0, 0],
  ];

  it('gamut, projecteur, exposition, tone mapping : exactement la chaîne de perceivedColor', () => {
    for (const rho of surfaces) {
      for (const D of [0.05, 0.2, 0.5, 0.8, 1, 1.3, 1.7320508, 2.5, 4.3589, 8, 20]) {
        const M = colorMatrix(D);
        const c = [0, 1, 2].map((j) => rho.reduce((sum, r, k) => sum + r * M[k][j], 0));
        const gpu = mirror.finish(c, D);
        const ref = perceivedColor({ kind: 'surface', reflectance: rho }, D);
        for (let j = 0; j < 3; j++) expect(Math.abs(gpu[j] - ref[j])).toBeLessThan(1e-12);
      }
    }
    for (const [T, intensity] of [[2700, 1], [2700, 4], [6500, 1]]) {
      for (const D of [0.3, 0.7, 1, 1.5, 3, 6]) {
        const gpu = mirror.finish(scale(blackbodyColor(D, T), intensity), D);
        const ref = perceivedColor({ kind: 'blackbody', T, intensity }, D);
        for (let j = 0; j < 3; j++) expect(Math.abs(gpu[j] - ref[j])).toBeLessThan(1e-12);
      }
    }
  });

  it('avec la LUT (half float, 257 texels interpolés) : écart < 0,02 en linéaire', () => {
    // Budget d'interpolation de la LUT : pire cas ≈ 0,013 (façade verte sans IR, D ≈ 1,43).
    for (const rho of surfaces) {
      for (let i = 0; i <= 200; i++) {
        const D = 2 ** (-4.3 + (8.6 * i) / 200);
        const gpu = mirror.finish(mirror.surfaceColor(rho.slice(0, 3), rho.slice(3), D), D);
        const ref = perceivedColor({ kind: 'surface', reflectance: rho }, D);
        for (let j = 0; j < 3; j++) expect(Math.abs(gpu[j] - ref[j])).toBeLessThan(0.02);
      }
    }
    for (const [T, row] of [[2700, 5], [6500, 6]]) {
      for (const D of [0.3, 0.7, 1, 1.5, 3, 6]) {
        const gpu = mirror.finish(mirror.lutRow(D, row), D);
        const ref = perceivedColor({ kind: 'blackbody', T }, D);
        for (let j = 0; j < 3; j++) expect(Math.abs(gpu[j] - ref[j])).toBeLessThan(0.02);
      }
    }
  });

  it('vision classique : à k = 0 la chaîne relativiste est identique à REL_CLASSIC', () => {
    const classic = makeFragmentMirror(texture, params, { classic: true });
    updateObserver(snapshotFromU(150, 40), 0);
    const obs = observer();
    for (const rho of surfaces) {
      const D = glslDopplerFactor([3, -1, -25], obs);
      expect(D).toBe(1);
      const rel = mirror.finish(mirror.surfaceColor(rho.slice(0, 3), rho.slice(3), D), D);
      const cla = classic.finish(classic.surfaceColor(rho.slice(0, 3), rho.slice(3), 1), 1);
      expect(rel).toEqual(cla);
    }
  });

  it('tone mapping : identité sous le genou, maximum < 1, teinte conservée', () => {
    expect(mirror.toneMap([0.5, 0.2, 0.1], TONEMAP_KNEE)).toEqual([0.5, 0.2, 0.1]);
    const big = mirror.toneMap([6, 3, 1.5], TONEMAP_KNEE);
    expect(Math.max(...big)).toBeLessThan(1);
    expect(big[1] / big[0]).toBeCloseTo(0.5, 12);
    expect(big[2] / big[0]).toBeCloseTo(0.25, 12);
  });
});

describe('sources GLSL : le miroir correspond aux shaders', () => {
  const src = GLSL_SOURCES;

  it('reprend les mêmes expressions que le miroir JS', () => {
    expect(src.rel_vertex).toContain('highp float bn = dot(uBeta, rel) / max(r, 1e-6);');
    expect(src.rel_vertex).toContain('highp float D = uGamma * (1.0 + bn);');
    expect(src.rel_vertex).toContain('return (rel + (uG2 * bn + uGamma) * r * uBeta) / D;');
    expect(src.rel_vertex).toContain('mat3(viewMatrix) * rel');
    expect(src.rel_doppler).toContain('return uGamma * (1.0 + dot(uBeta, normalize(rel)));');
    expect(src.rel_doppler).toContain('clamp((log2(D) + uLutParams.y) / (2.0 * uLutParams.y), 0.0, 1.0);');
    expect(src.rel_doppler).toContain('return (x * (uLutParams.x - 1.0) + 0.5) / uLutParams.x;');
    expect(src.rel_doppler).toContain('(row + 0.5) / uLutParams.z');
    expect(src.rel_doppler).toContain('return min(pow(D, uBeamExp), uBeamMax);');
    expect(src.rel_doppler).toContain('knee + w * (1.0 - exp(-(m - knee) / w))');
    expect(src.rel_doppler).toContain('max(vec3(Y) + (c - vec3(Y)) * (Y / (Y - m)), 0.0)');
    expect(src.rel_doppler).toContain('vec3(0.2126, 0.7152, 0.0722)');
    expect(src.rel_doppler).toContain('relToneMap(relGamut(c) * (relBeam(D) * uExposure), uKnee)');
    expect(src.rel_fog).toContain('t * t * (3.0 - 2.0 * t)');
    expect(src['environment.frag']).toContain('D = 1.0 / (uGamma * (1.0 - bn));');
    expect(src['environment.frag']).toContain('return (nApp + (uG2 * bn - uGamma) * uBeta) * D;');
    expect(src['environment.frag']).toContain('min(uEyeHeight / max(down, 1e-6), uFogFar)');
    expect(src['environment.frag']).toContain('vec2(hitXZ.x, -hitXZ.y)');
    expect(src['environment.vert']).toContain('gl_Position = vec4(position.xy, 1.0, 1.0);');
  });

  it('environnement : aucune branche avant la lecture de la carte des rues', () => {
    const body = stripGlslComments(src['environment.frag']).split('void main()')[1];
    const beforeTexture = body.split('texture(uStreetMap')[0];
    expect(beforeTexture).not.toMatch(/\bif\b|\?|\bfor\b|\bwhile\b/);
  });

  it('chaque fragment finit par la sortie sRGB de three ; brouillard avant Doppler', () => {
    for (const name of ['surface.frag', 'emitter.frag', 'environment.frag', 'cockpit.frag']) {
      expect(src[name]).toMatch(/#include <colorspace_fragment>\s*}\s*$/);
    }
    const surface = src['surface.frag'];
    expect(surface.indexOf('relApplyFog')).toBeLessThan(surface.indexOf('relSurfaceColor'));
  });

  it('cockpit comobile hors de l’adaptation (uExposure), ciel dégagé lu dans sa ligne de LUT', () => {
    // Éclairé par la lumière projetée vers l'avant : l'adaptation le rendrait noir à 90 m/s.
    expect(stripGlslComments(src['cockpit.frag'])).not.toMatch(/uExposure/);
    const env = stripGlslComments(src['environment.frag']);
    expect(env).toMatch(/relLutRow\(D, uSkyClearRow\)/);
    expect(env).not.toMatch(/RAYLEIGH/);
  });

  it('en-tête d’attribution sur les seuls fichiers GLSL dérivés ; copie envoyée au GPU en ASCII', () => {
    const header = (kind, where) =>
      `/*! ${kind} d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, ${where} — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */`;
    expect(src.rel_vertex.startsWith(header('Adapté', 'relativity.shader:83-239'))).toBe(true);
    expect(src.rel_doppler.startsWith(header('Adapté', 'relativity.shader:299-379'))).toBe(true);
    expect(src['environment.frag'].startsWith(header('Inspiré', 'skybox.shader'))).toBe(true);
    const derived = ['rel_vertex', 'rel_doppler', 'environment.frag'];
    for (const [name, text] of Object.entries(src)) {
      if (!derived.includes(name)) expect(text).not.toContain('OpenRelativity');
      expect(stripGlslComments(text)).toMatch(/^[\x00-\x7F]*$/);
    }
    for (const shader of Object.values(SHADERS)) {
      expect(shader.vertexShader + shader.fragmentShader).not.toMatch(/\/\/|\/\*/);
    }
  });
});

describe('matériaux', () => {
  it('uniformes partagés PAR RÉFÉRENCE avec REL ; LUT posée à la première fabrique', () => {
    const materials = [createSurfaceMaterial(), createEmitterMaterial(), createEnvironmentMaterial(), createCockpitMaterial()];
    for (const m of materials) {
      for (const key of Object.keys(REL)) expect(m.uniforms[key]).toBe(REL[key]);
    }
    expect(REL.uLut.value).toBeInstanceOf(DataTexture);
    expect(REL.uLut.value.type).toBe(HalfFloatType);
    expect(REL.uLutParams.value.toArray()).toEqual([LUT_SIZE, LUT_LOG2_RANGE, LUT_HEIGHT, 0]);
  });

  it('tri des opaques : renderOrder puis r (cm entiers), résultat −1, 0 ou 1', () => {
    const item = (renderOrder, r) => ({ renderOrder, object: { userData: r === undefined ? {} : { r } } });
    const list = [item(1, 0), item(0, 12345), item(0, 870), item(-1, 0), item(0, 870), item(0)];
    const sorted = [...list].sort(opaqueSort);
    expect(sorted.map((x) => [x.renderOrder, x.object.userData.r ?? 0])).toEqual([
      [-1, 0], [0, 0], [0, 870], [0, 870], [0, 12345], [1, 0],
    ]);
    for (const a of list) for (const b of list) expect([-1, 0, 1]).toContain(opaqueSort(a, b));
  });

  it('variante classique : même objet d’uniformes, mêmes shaders, define REL_CLASSIC', () => {
    const surface = createSurfaceMaterial();
    const classic = createClassicVariant(surface);
    expect(classic).not.toBe(surface);
    expect(classic.uniforms).toBe(surface.uniforms);
    expect(classic.vertexShader).toBe(surface.vertexShader);
    expect(classic.fragmentShader).toBe(surface.fragmentShader);
    expect(classic.defines).toHaveProperty('REL_CLASSIC');
    expect(surface.defines).not.toHaveProperty('REL_CLASSIC');
    expect(classic.vertexColors).toBe(true);
    const env = createEnvironmentMaterial();
    const envClassic = createClassicVariant(env);
    expect(envClassic.depthWrite).toBe(false);
    expect(envClassic.depthFunc).toBe(LessEqualDepth);
    expect(envClassic.onBeforeRender).toBe(env.onBeforeRender);
  });

  it('passe d’environnement : triangle plein écran, renderOrder 1, sans écriture de profondeur', () => {
    const mesh = createEnvironmentMesh();
    expect(mesh.renderOrder).toBe(1);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.material.depthWrite).toBe(false);
    expect(mesh.material.depthFunc).toBe(LessEqualDepth);
    expect(Array.from(mesh.geometry.getAttribute('position').array)).toEqual([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
    // Les uniformes de caméra suivent la caméra juste avant le dessin.
    const camera = createCamera({ aspect: 932 / 430 });
    updateCamera(camera, { x: 10, y: 20, heading: 1 });
    mesh.material.onBeforeRender(null, null, camera, null, mesh, null);
    expect(mesh.material.uniforms.uInvProjection.value.equals(camera.projectionMatrixInverse)).toBe(true);
  });

  it('cockpit : un seul mesh, dessiné en premier, attributs color et aShade', () => {
    const cockpit = createCockpit();
    expect(cockpit.renderOrder).toBe(-1);
    expect(cockpit.material.depthWrite).toBe(true);
    const count = cockpit.geometry.getAttribute('position').count;
    expect(count).toBeGreaterThan(0);
    expect(cockpit.geometry.getAttribute('color').count).toBe(count);
    expect(cockpit.geometry.getAttribute('aShade').count).toBe(count);
  });
});

describe('caméra et carte des rues', () => {
  it('hFOV 90° en paysage (vFOV déduit de l’aspect), 90° vertical en portrait', () => {
    const aspect = 932 / 430; // iPhone 14 Pro Max en paysage
    const v = (verticalFov(aspect) * Math.PI) / 180;
    expect((2 * Math.atan(Math.tan(v / 2) * aspect) * 180) / Math.PI).toBeCloseTo(90, 12);
    expect(verticalFov(0.6)).toBe(90);
    const camera = createCamera({ aspect, visibility: 600 });
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBeGreaterThan(600);
  });

  it('updateCamera : œil en (x, EYE_HEIGHT, −y), regard selon le cap', () => {
    const camera = createCamera();
    for (const heading of [0, Math.PI / 2, 2.4, -1.1]) {
      updateCamera(camera, { x: 12, y: -40, heading });
      expect(arr(camera.position)).toEqual([12, EYE_HEIGHT, 40]);
      const forward = arr(camera.getWorldDirection(new Vector3()));
      const expected = arr(toThree(Math.cos(heading), Math.sin(heading)));
      expect(len(add(forward, scale(expected, -1)))).toBeLessThan(1e-12);
    }
  });

  it('carte des rues : résolution bornée (2 px/m, 4 096 px de côté, 4 Mtexels)', () => {
    expect(streetMapSize({ xmin: 0, ymin: 0, xmax: 500, ymax: 300 })).toEqual({ width: 1000, height: 600 });
    const avenue = streetMapSize({ xmin: -150, ymin: -200, xmax: 150, ymax: 4200 });
    expect(avenue.height).toBeLessThanOrEqual(4096);
    expect(avenue.width * avenue.height).toBeLessThanOrEqual(2048 * 2048 * 1.01);
    const district = streetMapSize({ xmin: 0, ymin: 0, xmax: 1300, ymax: 1300 });
    expect(district.width * district.height).toBeLessThanOrEqual(2048 * 2048 * 1.01);
  });
});
