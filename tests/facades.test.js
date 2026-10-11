// Façades procédurales : choix du style (render/facades.js), attribut aFacade écrit par
// render/cityMesher.js (meshBlock, buildCity), constantes GLSL des matériaux générées depuis la
// palette, chunk rel_facade (anticrénelage, pas de boucle ni de texture) et matériau des surfaces.
import { describe, expect, it } from 'vitest';
import { ShaderChunk } from 'three';
import palette from '../src/data/palette.json';
import avenue from '../src/data/scenes/avenue-test.json';
import quartier from '../src/data/scenes/quartier-test.json';
import { buildCity, hexToLinearRgb, meshBlock, srgbToLinear } from '../src/render/cityMesher.js';
import {
  decodeFacade,
  encodeFacade,
  FACADE_HEIGHT_STEP,
  FACADE_MATERIALS,
  FACADE_MIN_SIZE,
  FACADE_SEEDS,
  FACADE_STYLE,
  facadeDetail,
  facadeGlslConstants,
  facadeMaterial,
  facadeStyle,
  HAUSSMANN_MIN_HEIGHT,
} from '../src/render/facades.js';
import { expandScene, footprint } from '../src/render/layout.js';
import { createClassicVariant, createSurfaceMaterial } from '../src/render/materials.js';
import { GLSL_SOURCES, SHADERS, setFacadePalette, stripGlslComments } from '../src/render/shaders/index.js';

/** Bâtiment de test (repère du jeu). */
const box = (x0, y0, x1, y1, h, extra = {}) => ({ x0, y0, x1, y1, h, rgb: [0.5, 0.2, 0.1], ir: 0.4, uv: 0.1, ...extra });

/**
 * Sommets d'un maillage dans le repère du jeu avec leur aFacade.
 * @returns {{x: number, y: number, z: number, style: number, u: number, fz: number, W: number}[]}
 */
function vertices(m) {
  const out = [];
  for (let i = 0; i < m.vertexCount; i++) {
    out.push({
      x: m.positions[3 * i],
      y: -m.positions[3 * i + 2],
      z: m.positions[3 * i + 1],
      style: m.facades[4 * i],
      u: m.facades[4 * i + 1],
      fz: m.facades[4 * i + 2],
      W: m.facades[4 * i + 3],
    });
  }
  return out;
}

/** Sommets d'un mur donné par l'orientation de ses triangles (normale dans le repère du jeu). */
function wallVertices(m, normal) {
  const ids = new Set();
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((i) => [
      m.positions[3 * i],
      -m.positions[3 * i + 2],
      m.positions[3 * i + 1],
    ]);
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (n.every((v, k) => Math.abs(v / len - normal[k]) < 1e-6)) for (let e = 0; e < 3; e++) ids.add(m.indices[t + e]);
  }
  const all = vertices(m);
  return [...ids].map((i) => all[i]);
}

describe('facades.js : style, graine et codage', () => {
  it('style déterministe, haussmannien seulement assez haut, sans motif pour les panneaux', () => {
    const f = { x0: -12, y0: 40, x1: 6, y1: 58 };
    expect(facadeStyle(f, 20)).toEqual(facadeStyle({ ...f }, 20));
    expect(facadeStyle({ x0: 0, y0: 0, x1: 2.5, y1: 0.5 }, 6)).toEqual({ style: 0, seed: 0 });
    expect(facadeStyle({ x0: 0, y0: 0, x1: FACADE_MIN_SIZE - 0.5, y1: 30 }, 20).style).toBe(0);
    const counts = new Map();
    const seeds = new Set();
    for (let i = 0; i < 400; i++) {
      const g = { x0: i * 17.5, y0: (i % 7) * 3, x1: i * 17.5 + 15 + (i % 5), y1: (i % 7) * 3 + 14 };
      const high = facadeStyle(g, 25);
      const low = facadeStyle(g, HAUSSMANN_MIN_HEIGHT - 1);
      expect(low.style).not.toBe(FACADE_STYLE.haussmannien);
      expect(low.style).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(high.seed) && high.seed >= 0 && high.seed < FACADE_SEEDS).toBe(true);
      counts.set(high.style, (counts.get(high.style) ?? 0) + 1);
      seeds.add(high.seed);
    }
    // Les quatre styles sont présents, l'haussmannien domine (≈ 40 %), les graines varient.
    for (const s of [1, 2, 3, 4]) expect(counts.get(s)).toBeGreaterThan(30);
    expect(counts.get(1)).toBeGreaterThan(120);
    expect(seeds.size).toBe(FACADE_SEEDS);
  });

  it('aFacade.x = style + code/2¹⁶ : exact en float32, décodé comme le shader', () => {
    for (const [style, h, seed] of [[1, 24, 0], [2, 8, 31], [3, 30.5, 17], [4, 3, 5], [1, 511.75, 31]]) {
      const x = encodeFacade(style, h, seed);
      expect(Math.fround(x)).toBe(x);
      expect(Math.floor(x)).toBe(style);
      expect(decodeFacade(Math.fround(x))).toEqual({ style, height: h, seed });
    }
    expect(decodeFacade(encodeFacade(2, 12.3, 3)).height).toBeCloseTo(12.25, 9); // pas de 0,25 m
    expect(FACADE_HEIGHT_STEP).toBe(0.25);
    expect(encodeFacade(0, 20, 4)).toBe(0);
  });

  it('niveau de détail : ?facades=0|1|2, sinon selon le profil', () => {
    expect(facadeDetail('', 'default')).toBe(2);
    expect(facadeDetail('', 'lite')).toBe(1);
    expect(facadeDetail('?facades=0', 'default')).toBe(0);
    expect(facadeDetail('?bench&facades=1', 'default')).toBe(1);
    expect(facadeDetail('?facades=2', 'lite')).toBe(2);
    expect(facadeDetail('?facades=oui', 'lite')).toBe(1);
  });
});

describe('matériaux de façade : palette et constantes GLSL', () => {
  it('palette.json porte les matériaux de façade (couleurs de la spécification, ir et uv)', () => {
    const expected = {
      'facade-verre': '#2B3440',
      'facade-pierre': '#D8D0BF',
      'facade-ardoise': '#4F5560',
      'facade-fer': '#2A2A2C',
      'facade-volet-sauge': '#6F8F6A',
      'facade-volet-gris': '#6D7F8C',
    };
    for (const [name, srgb] of Object.entries(expected)) expect(palette[name].srgb).toBe(srgb);
    expect(palette['facade-verre'].ir).toBe(0.05);
    expect(palette['facade-verre'].uv).toBe(0.04);
    for (const name of Object.values(FACADE_MATERIALS)) {
      const m = facadeMaterial(palette, name);
      expect(m.rgb).toEqual(hexToLinearRgb(palette[name].srgb));
      expect(m.ir).toBe(palette[name].ir);
      expect(m.uv).toBe(palette[name].uv);
    }
    expect(() => facadeMaterial({}, 'facade-verre')).toThrow(/facade-verre/);
  });

  it('constantes GLSL synchronisées avec la palette (srgb → linéaire, ir, uv)', () => {
    const glsl = facadeGlslConstants(palette);
    expect(glsl).toMatch(/^[\x00-\x7F]*$/);
    for (const [constant, name] of Object.entries(FACADE_MATERIALS)) {
      const rgb = new RegExp(`const vec3 FAC_${constant} = vec3\\(([^)]*)\\);`).exec(glsl);
      const iu = new RegExp(`const vec2 FAC_${constant}_IU = vec2\\(([^)]*)\\);`).exec(glsl);
      expect(rgb, constant).not.toBeNull();
      expect(iu, constant).not.toBeNull();
      const hex = palette[name].srgb;
      const lin = [1, 3, 5].map((k) => srgbToLinear(parseInt(hex.slice(k, k + 2), 16) / 255));
      rgb[1].split(',').map(Number).forEach((v, k) => expect(v).toBeCloseTo(lin[k], 6));
      expect(iu[1].split(',').map(Number)).toEqual([palette[name].ir, palette[name].uv]);
      for (const literal of [...rgb[1].split(','), ...iu[1].split(',')]) expect(literal.trim()).toMatch(/\./);
    }
  });

  it('setFacadePalette pose le chunk rel_facade (constantes puis texte sans commentaires)', () => {
    const constants = setFacadePalette(palette);
    expect(ShaderChunk.rel_facade.startsWith(constants)).toBe(true);
    expect(ShaderChunk.rel_facade).toContain('void relFacade(');
    expect(ShaderChunk.rel_facade).not.toMatch(/\/\/|\/\*/);
    expect(ShaderChunk.rel_facade).toMatch(/^[\x00-\x7F]*$/);
  });
});

describe('cityMesher : attribut aFacade', () => {
  it('mur simple : u depuis le bord gauche vu de dehors, z du sommet, W = longueur du mur', () => {
    const b = box(10, 20, 28, 34, 15, { style: 2, seed: 7 });
    const m = meshBlock([b], 1.5);
    const code = encodeFacade(2, 15, 7);
    const faces = [
      { normal: [0, -1, 0], W: 18, u: (v) => v.x - 10 }, // sud : gauche = ouest
      { normal: [1, 0, 0], W: 14, u: (v) => v.y - 20 }, // est : gauche = sud
      { normal: [0, 1, 0], W: 18, u: (v) => 28 - v.x }, // nord (sens inversé) : gauche = est
      { normal: [-1, 0, 0], W: 14, u: (v) => 34 - v.y }, // ouest (sens inversé) : gauche = nord
    ];
    for (const face of faces) {
      const vs = wallVertices(m, face.normal);
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) {
        expect(v.style).toBe(Math.fround(code));
        expect(v.u).toBeCloseTo(face.u(v), 5);
        expect(v.fz).toBeCloseTo(v.z, 5);
        expect(v.W).toBe(face.W);
      }
      expect(Math.min(...vs.map((v) => v.u))).toBeCloseTo(0, 6);
      expect(Math.max(...vs.map((v) => v.u))).toBeCloseTo(face.W, 5);
    }
  });

  it('toits sans motif (style 0) ; bâtiment sans style : aucun motif', () => {
    const m = meshBlock([box(0, 0, 20, 20, 12, { style: 1, seed: 3 })], 5);
    const roof = wallVertices(m, [0, 0, 1]);
    expect(roof.length).toBeGreaterThan(0);
    for (const v of roof) {
      expect(v.style).toBe(0);
      expect(v.u).toBe(0);
      expect(v.W).toBe(0);
    }
    const plain = meshBlock([box(0, 0, 20, 20, 12)], 5);
    expect(plain.facades.length).toBe(4 * plain.vertexCount);
    for (let i = 0; i < plain.vertexCount; i++) expect(plain.facades[4 * i]).toBe(0);
  });

  it('mur touché par un voisin (mitoyen, pignon au-dessus d\'un voisin bas) : sans motif', () => {
    const a = box(0, 0, 10, 10, 9, { style: 2, seed: 1 });
    const b = box(10, 0, 20, 10, 21, { style: 3, seed: 2 });
    const m = meshBlock([a, b], 1.5);
    // Plan x = 10 : seule la partie du mur ouest de b au-dessus de a est maillée, sans motif.
    const gable = wallVertices(m, [-1, 0, 0]).filter((v) => Math.abs(v.x - 10) < 1e-9);
    expect(gable.length).toBeGreaterThan(0);
    for (const v of gable) expect(v.style).toBe(0);
    // Façades libres : leur style.
    for (const v of wallVertices(m, [0, -1, 0]).filter((w) => w.x !== 10)) {
      expect(v.style).toBe(Math.fround(v.x < 10 ? encodeFacade(2, 9, 1) : encodeFacade(3, 21, 2)));
    }
  });

  it('buildCity : aFacade sur chaque LOD, styles déterministes, panneaux sans motif', () => {
    const city = buildCity(avenue, palette);
    const again = buildCity(avenue, palette);
    const layout = expandScene(avenue, palette);
    for (const id of ['ouest-0', 'est-3', 'butee', 'panneau-ir-1']) {
      const chunk = city.chunks.find((c) => c.id === id);
      for (const k of [0, 1, 2]) {
        const g = chunk.lod(k);
        expect(g.attributes.aFacade.itemSize).toBe(4);
        expect(g.attributes.aFacade.count).toBe(g.attributes.position.count);
        expect(Array.from(g.attributes.aFacade.array)).toEqual(Array.from(again.chunks.find((c) => c.id === id).lod(k).attributes.aFacade.array));
      }
    }
    const panel = city.chunks.find((c) => c.id === 'panneau-ir-1').lod(0).attributes.aFacade.array;
    for (let i = 0; i < panel.length; i += 4) expect(panel[i]).toBe(0);
    // Toutes les façades de l'avenue ont un style (sauf panneaux) ; plusieurs styles par îlot.
    const styles = new Set();
    for (const b of layout.buildings) {
      const s = facadeStyle(footprint(b), b.height).style;
      if (Math.min(b.width, b.depth) >= FACADE_MIN_SIZE) expect(s).toBeGreaterThanOrEqual(1);
      styles.add(s);
    }
    expect(styles).toEqual(new Set([0, 1, 2, 3, 4]));
    const q = expandScene(quartier, palette);
    const perBlock = new Map();
    for (const b of q.buildings) {
      if (!perBlock.has(b.blockId)) perBlock.set(b.blockId, new Set());
      perBlock.get(b.blockId).add(facadeStyle(footprint(b), b.height).style);
    }
    const varied = [...perBlock.values()].filter((s) => s.size >= 2).length;
    expect(varied / perBlock.size).toBeGreaterThan(0.8);
  });
});

describe('shader rel_facade', () => {
  const src = stripGlslComments(GLSL_SOURCES.rel_facade);

  it('anticrénelage : empreinte du pixel par fwidth, avant tout branchement ; ni boucle ni texture', () => {
    expect(src).toMatch(/fwidth\(u\)/);
    expect(src).toMatch(/fwidth\(z\)/);
    const body = src.split('void relFacade(')[1];
    const firstBranch = body.search(/\bif\s*\(/);
    expect(body.indexOf('fwidth(u)')).toBeLessThan(firstBranch);
    expect(body.indexOf('fwidth(z)')).toBeLessThan(firstBranch);
    expect(src.split('void relFacade(')[1].match(/fwidth/g)).toHaveLength(2);
    expect(src).not.toMatch(/\bfor\b|\bwhile\b|texture\(/);
    // Créneau filtré : intégrale exacte sur la boîte du pixel.
    expect(src).toContain('return floor(x) * (b - a) + clamp(fract(x), a, b) - a;');
    expect(src).toMatch(/#if FACADES > 0/);
    expect(src).toMatch(/#if FACADES > 1/);
  });

  it('décodage du style miroir de facades.decodeFacade', () => {
    expect(src).toContain('float code = floor((fac.x - style) * 65536.0 + 0.5);');
    expect(src).toContain('float hq = floor(code / 32.0);');
    expect(src).toContain('float H = 0.25 * hq;');
  });

  it('surface : motif puis ombrage, AVANT le brouillard et le Doppler ; (style, W) en flat', () => {
    const frag = GLSL_SOURCES['surface.frag'];
    expect(frag).toContain('#include <rel_facade>');
    expect(frag.indexOf('relFacade(')).toBeLessThan(frag.indexOf('relApplyFog'));
    expect(frag.indexOf('relFacade(')).toBeLessThan(frag.indexOf('relSurfaceColor'));
    const vert = GLSL_SOURCES['surface.vert'];
    expect(vert).toContain('attribute vec4 aFacade;');
    expect(vert).toMatch(/flat varying highp vec2 vFacade;/);
    expect(SHADERS.surface.fragmentShader).toMatch(/flat varying highp vec2 vFacade;/);
  });

  it('matériau des surfaces : define FACADES, aFacade par défaut (0, 0, 0, 0), variante classique identique', () => {
    const full = createSurfaceMaterial();
    expect(full.defines.FACADES).toBe(2);
    expect(createSurfaceMaterial({ facades: 0 }).defines.FACADES).toBe(0);
    const lite = createSurfaceMaterial({ facades: 1, palette });
    expect(lite.defines.FACADES).toBe(1);
    expect(full.defaultAttributeValues.aFacade).toEqual([0, 0, 0, 0]);
    const classic = createClassicVariant(lite);
    expect(classic.defines).toMatchObject({ FACADES: 1, REL_CLASSIC: '' });
    expect(classic.defaultAttributeValues.aFacade).toEqual([0, 0, 0, 0]);
    expect(classic.fragmentShader).toBe(lite.fragmentShader);
  });
});
