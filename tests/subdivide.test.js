// Tests de src/render/subdivide.js : niveaux, grille à pas maximal, maillage étanche,
// bandes « fermeture éclair ».
import { describe, expect, it } from 'vitest';
import {
  gridQuad,
  segmentCount,
  splitRange,
  subdivideQuad,
  uniqueSorted,
  zipperStrip,
} from '../src/render/subdivide.js';

const P = (x, y, z) => ({ x, y, z });
const vtx = (positions, i) => P(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
const sub = (a, b) => P(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a, b) => P(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a) => Math.hypot(a.x, a.y, a.z);

/** Normale (non normalisée) du triangle t. */
function triNormal(mesh, t) {
  const a = vtx(mesh.positions, mesh.indices[3 * t]);
  const b = vtx(mesh.positions, mesh.indices[3 * t + 1]);
  const c = vtx(mesh.positions, mesh.indices[3 * t + 2]);
  return cross(sub(b, a), sub(c, a));
}

describe('segmentCount et splitRange', () => {
  it('compte les segments de longueur ≤ pas, sans segment d\'arrondi', () => {
    expect(segmentCount(10, 1.5)).toBe(7);
    expect(segmentCount(15, 1.5)).toBe(10); // multiple exact : pas de 11e segment
    expect(segmentCount(0.2, 5)).toBe(1);
    expect(segmentCount(0, 5)).toBe(1);
    expect(() => segmentCount(10, 0)).toThrow();
  });

  it('garde les bornes et les coupures, avec des pas ≤ maxStep', () => {
    const levels = splitRange(0, 20, 5, [3, 11.5, 42, -1]);
    expect(levels[0]).toBe(0);
    expect(levels[levels.length - 1]).toBe(20);
    expect(levels).toContain(3);
    expect(levels).toContain(11.5);
    expect(levels).not.toContain(42);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThan(levels[i - 1]);
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(5 + 1e-12);
    }
    // [0, 3] en 1 part, [3, 11,5] en 2, [11,5, 20] en 2 : 6 niveaux.
    expect(levels).toHaveLength(6);
  });

  it('donne les mêmes niveaux sur un intervalle commun délimité par les mêmes coupures', () => {
    const a = splitRange(0, 10, 1.5, [3]);
    const b = splitRange(0, 24, 1.5, [3, 10]);
    expect(b.slice(0, a.length)).toEqual(a);
  });

  it('fusionne les valeurs presque égales', () => {
    expect(uniqueSorted([3, 1, 2, 1 + 1e-9, 3])).toEqual([1, 2, 3]);
  });
});

describe('subdivideQuad', () => {
  const p0 = P(0, 0, 0);
  const p1 = P(10, 0, 0);
  const p2 = P(10, 4, 0);
  const p3 = P(0, 4, 0);

  it('a le nombre de sommets et de triangles attendu', () => {
    const m = subdivideQuad(p0, p1, p2, p3, 1.5);
    // 10 m → 7 segments, 4 m → 3 segments : 8 × 4 sommets, 7 × 3 × 2 triangles.
    expect(m.positions).toBeInstanceOf(Float32Array);
    expect(m.indices).toBeInstanceOf(Uint32Array);
    expect(m.positions.length / 3).toBe(32);
    expect(m.indices.length / 3).toBe(42);
  });

  it('respecte le pas maximal le long des deux directions de la grille', () => {
    for (const step of [0.75, 1.5, 5, 15]) {
      const m = subdivideQuad(p0, p1, p2, p3, step);
      for (let t = 0; t < m.indices.length / 3; t++) {
        for (let e = 0; e < 3; e++) {
          const a = vtx(m.positions, m.indices[3 * t + e]);
          const b = vtx(m.positions, m.indices[3 * t + ((e + 1) % 3)]);
          expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(step + 1e-5);
          expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(step + 1e-5);
          expect(len(sub(a, b))).toBeLessThanOrEqual(Math.SQRT2 * step + 1e-5); // diagonales
        }
      }
    }
  });

  it('respecte le pas sur un quadrilatère quelconque (trapèze gauche)', () => {
    const q = [P(0, 0, 0), P(12, 0, 1), P(9, 7, 2), P(-1, 5, 0)];
    const step = 2;
    const m = subdivideQuad(...q, step);
    // Arêtes de la grille (pas les diagonales) : i → i + 1 et j → j + 1.
    const nu = segmentCount(Math.max(len(sub(q[1], q[0])), len(sub(q[2], q[3]))), step);
    const nv = segmentCount(Math.max(len(sub(q[3], q[0])), len(sub(q[2], q[1]))), step);
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const k = j * (nu + 1) + i;
        if (i < nu) expect(len(sub(vtx(m.positions, k + 1), vtx(m.positions, k)))).toBeLessThanOrEqual(step + 1e-5);
        if (j < nv) expect(len(sub(vtx(m.positions, k + nu + 1), vtx(m.positions, k)))).toBeLessThanOrEqual(step + 1e-5);
      }
    }
  });

  it('oriente les triangles comme p0 → p1 → p2 → p3 (anti-horaire vu de devant)', () => {
    const m = subdivideQuad(p0, p1, p2, p3, 1.5);
    for (let t = 0; t < m.indices.length / 3; t++) expect(triNormal(m, t).z).toBeGreaterThan(0);
  });

  it('forme une boîte étanche, sans jonction en T, orientée vers l\'extérieur', () => {
    // Boîte 7 × 5 × 4,5 m en 6 faces subdivisées indépendamment au même pas.
    const [x0, y0, z0, x1, y1, z1] = [0, 0, 0, 7, 5, 4.5];
    const faces = [
      [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], // y = y0, normale −y
      [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)], // x = x1, normale +x
      [P(x1, y1, z0), P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1)], // y = y1, normale +y
      [P(x0, y1, z0), P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1)], // x = x0, normale −x
      [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], // dessus, normale +z
      [P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), P(x0, y0, z0)], // dessous, normale −z
    ];
    const key = (p) => `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`;
    const directed = new Map();
    const center = P(3.5, 2.5, 2.25);
    let triangles = 0;
    for (const q of faces) {
      const m = subdivideQuad(...q, 1.5);
      for (let t = 0; t < m.indices.length / 3; t++) {
        triangles++;
        const v = [0, 1, 2].map((e) => vtx(m.positions, m.indices[3 * t + e]));
        // Normale vers l'extérieur.
        expect(dot(triNormal(m, t), sub(v[0], center))).toBeGreaterThan(0);
        for (let e = 0; e < 3; e++) {
          const k = `${key(v[e])}>${key(v[(e + 1) % 3])}`;
          directed.set(k, (directed.get(k) ?? 0) + 1);
        }
      }
    }
    // Étanche et orientable : chaque arête orientée apparaît une fois, et son inverse aussi.
    for (const [k, n] of directed) {
      expect(n).toBe(1);
      const [a, b] = k.split('>');
      expect(directed.get(`${b}>${a}`), `arête sans voisine ${k}`).toBe(1);
    }
    // Caractéristique d'Euler d'une sphère : V − E + F = 2.
    const vertices = new Set([...directed.keys()].map((k) => k.split('>')[0]));
    expect(vertices.size - directed.size / 2 + triangles).toBe(2);
  });

  it('gridQuad place les sommets aux paramètres demandés', () => {
    const m = gridQuad(p0, p1, p2, p3, [0, 0.25, 1], [0, 1]);
    expect(Array.from(m.positions.slice(0, 9))).toEqual([0, 0, 0, 2.5, 0, 0, 10, 0, 0]);
    expect(m.indices.length).toBe(12);
  });
});

describe('zipperStrip', () => {
  /** Triangles d'une bande entre une ligne gauche (u = 0) et une ligne droite (u = 1). */
  function strip(leftT, rightT) {
    const leftIdx = leftT.map((_, i) => i);
    const rightIdx = rightT.map((_, i) => leftT.length + i);
    const uv = [...leftT.map((t) => [0, t]), ...rightT.map((t) => [1, t])];
    const tris = [];
    zipperStrip(leftIdx, leftT, rightIdx, rightT, (a, b, c) => tris.push([a, b, c]));
    return { tris, uv };
  }
  const area = ([a, b, c], uv) =>
    ((uv[b][0] - uv[a][0]) * (uv[c][1] - uv[a][1]) - (uv[b][1] - uv[a][1]) * (uv[c][0] - uv[a][0])) / 2;

  it('raccorde deux lignes de tailles différentes sans trou ni recouvrement', () => {
    const leftT = [0, 1.5, 3, 4.5, 6];
    const rightT = [0, 3, 3.7, 6];
    const { tris, uv } = strip(leftT, rightT);
    expect(tris).toHaveLength(leftT.length - 1 + rightT.length - 1);
    let total = 0;
    for (const t of tris) {
      const a = area(t, uv);
      expect(a).toBeGreaterThan(0); // anti-horaire et non dégénéré
      total += a;
    }
    expect(total).toBeCloseTo(6, 12); // aire du rectangle 1 × 6
  });

  it('ne traverse jamais un niveau présent sur les deux lignes', () => {
    const leftT = [0, 1, 2.5, 4, 5];
    const rightT = [0, 2.5, 3, 5];
    const { tris, uv } = strip(leftT, rightT);
    for (const t of tris) {
      const ts = t.map((i) => uv[i][1]);
      const below = ts.every((v) => v <= 2.5);
      const above = ts.every((v) => v >= 2.5);
      expect(below || above).toBe(true);
    }
  });
});
