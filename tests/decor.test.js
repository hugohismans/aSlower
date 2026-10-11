// Tests du décor statique (mobilier urbain et végétation) : placement (render/decorLayout.js),
// maillage (render/decorMesher.js), fusion dans les îlots (render/cityMesher.js), obstacles et
// exclusions des niveaux (game/level.js), réglage d'exécution (render/quality.decorOptions).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { physicsFor } from '../src/physics/constants.js';
import { createLevel, levelDecorExclusions, resolveLevel, sceneOfLevel } from '../src/game/level.js';
import { LEVEL_FILES } from '../src/levels/index.js';
import { AO_HEIGHT, AO_STRENGTH, buildCity, decorStyle, FACE_SHADE, mergeChunkMeshes } from '../src/render/cityMesher.js';
import {
  CORNER_CLEARANCE_LOW,
  CORNER_CLEARANCE_TALL,
  DECOR_KINDS,
  decorSettings,
  filterDecor,
  normalizeExclusions,
  PLACE_MIN_WIDTH,
  placeDecor,
  SIDEWALK_WIDTH,
  TREE_LAMP_CLEARANCE,
} from '../src/render/decorLayout.js';
import { DECOR_MATERIALS, DECOR_STEP, decorFaceShade, drawnAtLod, meshDecor } from '../src/render/decorMesher.js';
import { expandScene, footprint, SCENE_SCHEMA } from '../src/render/layout.js';
import { decorOptions, DECOR_LITE_DENSITY } from '../src/render/quality.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const palette = readJson('../src/data/palette.json');
const avenue = readJson('../src/data/scenes/avenue-test.json');
const quartier = readJson('../src/data/scenes/quartier-test.json');
const example = readJson('./fixtures/levels-valid/n99-exemple.json');
const style = decorStyle(palette);

/** Scènes éprouvées : scènes de développement et niveaux (scène du niveau, exclusions comprises). */
function scenesFor(c) {
  const L = 10 * c;
  const list = [
    { name: 'avenue-test', scene: avenue },
    { name: 'quartier-test', scene: quartier },
  ];
  for (const { id, json } of [...LEVEL_FILES, { id: 'n99-exemple', json: example }]) {
    list.push({ name: id, scene: sceneOfLevel(resolveLevel(json, L), L) });
  }
  return list.map(({ name, scene }) => ({ name, scene, layout: expandScene(scene, palette, { lengthUnit: L }) }));
}

/** Chaussée (rectangle orienté prolongé d'une demi-largeur) : distance d'un point. */
function wayDistance(s, px, py) {
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const hw = s.width / 2;
  const a = (px - s.from.x) * ux + (py - s.from.y) * uy;
  const b = -(px - s.from.x) * uy + (py - s.from.y) * ux;
  return Math.hypot(Math.max(-hw - a, 0, a - len - hw), Math.max(Math.abs(b) - hw, 0));
}
const parallel = (s, t) => {
  const a = [s.to.x - s.from.x, s.to.y - s.from.y];
  const b = [t.to.x - t.from.x, t.to.y - t.from.y];
  return Math.abs(a[0] * b[1] - a[1] * b[0]) < 1e-6 * Math.hypot(...a) * Math.hypot(...b);
};
const boxesOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('placement du décor (decorLayout.js)', () => {
  for (const c of [10, 30, 100]) {
    it(`respecte les règles sur les scènes et les niveaux (c = ${c})`, () => {
      for (const { name, layout } of scenesFor(c)) {
        const { decor, streets, buildings, lamps, bounds } = layout;
        const rects = buildings.map(footprint);
        const errors = [];
        const fail = (m) => errors.length < 8 && errors.push(`${name} : ${m}`);
        for (const d of decor) {
          const spec = DECOR_KINDS[d.kind];
          const at = `${d.kind} (${d.x.toFixed(1)}, ${d.y.toFixed(1)})`;
          if (!spec) fail(`sorte inconnue ${d.kind}`);
          if (d.x < bounds.xmin || d.x > bounds.xmax || d.y < bounds.ymin || d.y > bounds.ymax) fail(`${at} hors des limites`);
          // Jamais dans un bâtiment (boîte de collision), jamais sur une chaussée hors des places.
          if (d.collision && rects.some((r) => boxesOverlap(r, d.collision))) fail(`${at} dans un bâtiment`);
          const inPlace = streets.some((s) => s.width >= PLACE_MIN_WIDTH && wayDistance(s, d.x, d.y) === 0);
          if (d.kind !== 'store' && !inPlace) {
            for (const s of streets) if (wayDistance(s, d.x, d.y) < spec.across) fail(`${at} sur une chaussée`);
            // Sur un trottoir : à moins de SIDEWALK_WIDTH du bord de la chaussée la plus proche.
            const host = streets.reduce((best, s) => (wayDistance(s, d.x, d.y) < wayDistance(best, d.x, d.y) ? s : best));
            if (wayDistance(host, d.x, d.y) > SIDEWALK_WIDTH) fail(`${at} hors du trottoir`);
            // Loin des carrefours : chaussées qui croisent celle du trottoir.
            const clearance = spec.low ? CORNER_CLEARANCE_LOW : CORNER_CLEARANCE_TALL;
            for (const s of streets) {
              if (!parallel(s, host) && wayDistance(s, d.x, d.y) < clearance + spec.across - 1e-6) fail(`${at} près d'un carrefour`);
            }
          }
          if (d.kind === 'platane') {
            for (const l of lamps) if (Math.hypot(l.x - d.x, l.y - d.y) < TREE_LAMP_CLEARANCE) fail(`${at} sur un lampadaire`);
          }
          if (!d.blockId) fail(`${at} sans îlot`);
          for (const k of ['x0', 'y0', 'x1', 'y1']) if (!Number.isFinite(d.extent[k])) fail(`${at} emprise invalide`);
        }
        // Deux objets ne se chevauchent pas (disques d'occupation).
        const solid = decor.filter((d) => DECOR_KINDS[d.kind].foot > 0);
        for (let i = 0; i < solid.length; i++) {
          for (let j = i + 1; j < solid.length; j++) {
            const a = solid[i];
            const b = solid[j];
            if (Math.abs(a.x - b.x) > 10 || Math.abs(a.y - b.y) > 10) continue;
            const foot = (d) => (d.kind === 'fontaine' ? d.radius + 0.3 : DECOR_KINDS[d.kind].foot);
            if (Math.hypot(a.x - b.x, a.y - b.y) < foot(a) + foot(b) - 1e-6) fail(`${a.kind} et ${b.kind} se chevauchent`);
          }
        }
        expect(errors).toEqual([]);
      }
    });
  }

  it('est déterministe, dépend de la graine et peuple les scènes de développement', () => {
    const a = expandScene(avenue, palette).decor;
    expect(expandScene(avenue, palette).decor).toEqual(a);
    expect(expandScene({ ...avenue, graine: avenue.graine + 1 }, palette).decor).not.toEqual(a);
    const kinds = new Set([...a, ...expandScene(quartier, palette).decor].map((d) => d.kind));
    for (const k of ['platane', 'banc', 'colonne', 'kiosque', 'parasol', 'store', 'jardiniere', 'potelet', 'fontaine']) expect(kinds).toContain(k);
    // La fontaine de la place du bout de l'avenue, loin des bâtiments.
    const f = a.find((d) => d.kind === 'fontaine');
    expect(f).toBeDefined();
    for (const b of expandScene(avenue, palette).buildings) {
      const r = footprint(b);
      expect(Math.hypot(Math.max(r.x0 - f.x, 0, f.x - r.x1), Math.max(r.y0 - f.y, 0, f.y - r.y1))).toBeGreaterThan(10);
    }
  });

  it("platanes d'alignement : pas de 10 à 11 m, en quinconce avec les lampadaires", () => {
    const layout = expandScene(avenue, palette);
    // Trottoir est de l'avenue (x = 10,3 m), première rangée d'îlots.
    const trees = layout.decor.filter((d) => d.kind === 'platane' && Math.abs(d.x - 10.3) < 0.01 && d.y < 60).map((d) => d.y);
    expect(trees.length).toBeGreaterThanOrEqual(3);
    trees.sort((p, q) => p - q);
    for (let i = 1; i < trees.length; i++) {
      const gap = trees[i] - trees[i - 1];
      expect(gap / Math.round(gap / 10.5)).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(gap / Math.round(gap / 10.5)).toBeLessThanOrEqual(11 + 1e-9);
    }
    // Lampadaire de ce trottoir à y = 20 : à mi-distance de deux arbres.
    const lamp = layout.lamps.find((l) => l.x > 0 && Math.abs(l.y - 20) < 1e-9);
    const below = Math.max(...trees.filter((y) => y < lamp.y));
    const above = Math.min(...trees.filter((y) => y > lamp.y));
    expect(Math.abs(lamp.y - below - (above - lamp.y))).toBeLessThan(1e-6);
  });

  it('évite les exclusions (disques et couloirs) et le départ', () => {
    const scene = {
      ...quartier,
      decorExclusions: [
        { pos: [0, 40], rayon: 25 },
        { de: [-80, -200], a: [-80, 200], rayon: 15 },
      ],
    };
    const decor = expandScene(scene, palette).decor;
    expect(decor.length).toBeGreaterThan(100);
    for (const d of decor) {
      expect(Math.hypot(d.x, d.y - 40)).toBeGreaterThanOrEqual(25);
      if (d.y > -200 && d.y < 200) expect(Math.abs(d.x + 80)).toBeGreaterThanOrEqual(15);
      expect(Math.hypot(d.x, d.y)).toBeGreaterThanOrEqual(6); // départ en (0, 0)
    }
    expect(() => normalizeExclusions([{ pos: [0, 0] }])).toThrow(/rayon/);
    expect(() => normalizeExclusions([{ rayon: 2 }])).toThrow(/pos/);
    expect(normalizeExclusions([{ de: [0, 1], a: [2, 3], rayon: 4 }])).toEqual([{ ax: 0, ay: 1, bx: 2, by: 3, r: 4 }]);
  });

  it('réglages : clé decor de la scène, décor coupé, profil « lite » = sous-ensemble sans petits objets', () => {
    const full = expandScene(quartier, palette).decor;
    expect(expandScene({ ...quartier, decor: { actif: false } }, palette).decor).toEqual([]);
    expect(expandScene(quartier, palette, { decor: false }).decor).toEqual([]);
    expect(expandScene(quartier, palette, { decor: { enabled: false } }).decor).toEqual([]);
    const lite = expandScene(quartier, palette, { decor: { density: DECOR_LITE_DENSITY, small: false } }).decor;
    const key = (d) => `${d.kind}@${d.x},${d.y}`;
    const all = new Set(full.map(key));
    expect(lite.length).toBeGreaterThan(0.3 * full.length);
    expect(lite.length).toBeLessThan(0.8 * full.length);
    for (const d of lite) {
      expect(all.has(key(d))).toBe(true);
      expect(d.small).toBe(false);
    }
    const sparse = expandScene({ ...quartier, decor: { densite: 0.3 } }, palette).decor;
    expect(sparse.length).toBeLessThan(0.6 * full.length);
    expect(() => expandScene({ ...quartier, decor: { densite: -1 } }, palette)).toThrow(/densite/);
    expect(() => decorSettings({ actif: 'oui' })).toThrow(/actif/);
    expect(decorSettings(undefined, undefined)).toEqual({ enabled: true, density: 1, keep: 1, small: true });
    expect(filterDecor(full, { enabled: true, keep: 1, small: true })).toEqual(full);
  });

  it('rattache chaque objet au bâtiment le plus proche, ou à une case de décor seul', () => {
    const layout = expandScene(quartier, palette);
    for (const d of layout.decor.slice(0, 200)) {
      let best = null;
      for (const b of layout.buildings) {
        const r = footprint(b);
        const dist = Math.hypot(Math.max(r.x0 - d.x, 0, d.x - r.x1), Math.max(r.y0 - d.y, 0, d.y - r.y1));
        if (!best || dist < best.dist - 1e-9) best = { dist, blockId: b.blockId };
      }
      expect(d.blockId).toBe(best.blockId);
    }
    // Sans bâtiment : chunk de décor seul.
    const lone = placeDecor(
      { buildings: [], streets: [{ from: { x: 0, y: 0 }, to: { x: 0, y: 100 }, width: 60 }], lamps: [], bounds: { xmin: -100, ymin: -100, xmax: 100, ymax: 200 } },
      { seed: 3 },
    );
    expect(lone.map((d) => d.kind)).toContain('fontaine');
    for (const d of lone) expect(d.blockId).toMatch(/^decor:/);
  });
});

describe('maillage du décor (decorMesher.js)', () => {
  const sample = new Map();
  for (const d of [...expandScene(avenue, palette).decor, ...expandScene(quartier, palette).decor]) {
    if (!sample.has(d.kind)) sample.set(d.kind, d);
  }

  it('ombrage cuit : celui des façades pour une face alignée, toit en haut, dessous sombre', () => {
    expect(decorFaceShade(0, -1, 0, FACE_SHADE)).toBeCloseTo(FACE_SHADE.south, 12);
    expect(decorFaceShade(1, 0, 0, FACE_SHADE)).toBeCloseTo(FACE_SHADE.east, 12);
    expect(decorFaceShade(0, 1, 0, FACE_SHADE)).toBeCloseTo(FACE_SHADE.north, 12);
    expect(decorFaceShade(-1, 0, 0, FACE_SHADE)).toBeCloseTo(FACE_SHADE.west, 12);
    expect(decorFaceShade(0, 0, 1, FACE_SHADE)).toBeCloseTo(FACE_SHADE.roof, 12);
    expect(decorFaceShade(0, 0, -1, FACE_SHADE)).toBeLessThan(FACE_SHADE.north);
    const sw = decorFaceShade(-Math.SQRT1_2, -Math.SQRT1_2, 0, FACE_SHADE);
    expect(sw).toBeCloseTo((FACE_SHADE.south + FACE_SHADE.west) / 2, 12);
  });

  it('chaque sorte, à chaque LOD : attributs complets, aFacade nul, dans son emprise, au-dessus du sol, faces vers l’extérieur', () => {
    expect(sample.size).toBe(Object.keys(DECOR_KINDS).length);
    for (const [kind, item] of sample) {
      const counts = [];
      for (const lod of [0, 1, 2]) {
        const m = meshDecor([item], lod, style);
        counts.push(m.triangleCount);
        expect(m.positions.length).toBe(3 * m.vertexCount);
        expect(m.colors.length).toBe(3 * m.vertexCount);
        expect(m.specs.length).toBe(3 * m.vertexCount);
        expect(m.facades.length).toBe(4 * m.vertexCount);
        expect(m.facades.every((v) => v === 0)).toBe(true);
        expect(m.indices.length).toBe(3 * m.triangleCount);
        if (!drawnAtLod(item, lod)) {
          expect(m.triangleCount, `${kind} LOD ${lod}`).toBe(0);
          continue;
        }
        expect(m.triangleCount, `${kind} LOD ${lod}`).toBeGreaterThan(0);
        let volume = 0;
        for (let i = 0; i < m.vertexCount; i++) {
          const x = m.positions[3 * i];
          const z = m.positions[3 * i + 1];
          const y = -m.positions[3 * i + 2];
          expect(z, `${kind} : sous le sol`).toBeGreaterThanOrEqual(-1e-6);
          expect(z, `${kind} : trop haut`).toBeLessThanOrEqual(item.height + 1.5);
          expect(x).toBeGreaterThanOrEqual(item.extent.x0 - 0.05);
          expect(x).toBeLessThanOrEqual(item.extent.x1 + 0.05);
          expect(y).toBeGreaterThanOrEqual(item.extent.y0 - 0.05);
          expect(y).toBeLessThanOrEqual(item.extent.y1 + 0.05);
          for (let k = 0; k < 3; k++) expect(Number.isFinite(m.colors[3 * i + k] + m.specs[3 * i + k])).toBe(true);
          expect(m.specs[3 * i + 2]).toBeGreaterThan(0.3);
          expect(m.specs[3 * i + 2]).toBeLessThanOrEqual(1);
        }
        // Volume orienté (repère Three) > 0 : faces tournées vers l'extérieur.
        for (let t = 0; t < m.indices.length; t += 3) {
          const p = [0, 1, 2].map((e) => {
            const v = m.indices[t + e];
            return [m.positions[3 * v] - item.x, m.positions[3 * v + 1], m.positions[3 * v + 2] + item.y];
          });
          volume += p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0]);
        }
        expect(volume, `${kind} LOD ${lod}`).toBeGreaterThan(0);
      }
      // Moins de triangles quand on s'éloigne.
      expect(counts[1]).toBeLessThanOrEqual(counts[0]);
      expect(counts[2]).toBeLessThanOrEqual(counts[1]);
    }
    // Platane : 60 à 160 triangles de près, ≤ 30 de loin ; potelets et tables seulement au LOD 0.
    const tree = meshDecor([sample.get('platane')], 0, style).triangleCount;
    expect(tree).toBeGreaterThanOrEqual(60);
    expect(tree).toBeLessThanOrEqual(160);
    expect(meshDecor([sample.get('platane')], 2, style).triangleCount).toBeLessThanOrEqual(30);
    expect(drawnAtLod({ kind: 'potelet' }, 1)).toBe(false);
    expect(drawnAtLod({ kind: 'banc' }, 2)).toBe(false);
  });

  it('feuillage « vegetation » (red edge, ir ≈ 0,6) à teintes variées ; arêtes ≤ 1,5 m sur les grandes faces au LOD 0', () => {
    const veg = style.materials.vegetation;
    const m = meshDecor([sample.get('platane')], 0, style);
    const leafIr = [];
    for (let i = 0; i < m.vertexCount; i++) {
      // Feuillage : vert dominant.
      if (m.colors[3 * i + 1] > m.colors[3 * i] * 1.2 && m.colors[3 * i + 1] > m.colors[3 * i + 2] * 1.2) leafIr.push(m.specs[3 * i]);
    }
    expect(leafIr.length).toBeGreaterThan(50);
    for (const ir of leafIr) expect(Math.abs(ir - veg.ir)).toBeLessThan(0.1);
    expect(new Set(leafIr.map((v) => v.toFixed(4))).size).toBeGreaterThan(0); // une teinte par arbre au moins
    // Kiosque et eau de la fontaine : arêtes ≤ DECOR_STEP (+ diagonales) au LOD 0.
    for (const kind of ['kiosque', 'fontaine']) {
      const k = meshDecor([sample.get(kind)], 0, style);
      for (let t = 0; t < k.indices.length; t += 3) {
        const p = [0, 1, 2].map((e) => {
          const v = k.indices[t + e];
          return [k.positions[3 * v], k.positions[3 * v + 1], k.positions[3 * v + 2]];
        });
        for (let e = 0; e < 3; e++) {
          const a = p[e];
          const b = p[(e + 1) % 3];
          expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), kind).toBeLessThanOrEqual(DECOR_STEP * Math.SQRT2 + 0.05);
        }
      }
    }
    for (const name of DECOR_MATERIALS) expect(palette[name], name).toBeDefined();
  });

  it('un arbre garde sa teinte et sa taille d’un LOD à l’autre (pas de saut au changement de LOD)', () => {
    const tree = sample.get('platane');
    const stats = [0, 1, 2].map((lod) => {
      const m = meshDecor([tree], lod, style);
      let g = 0;
      let n = 0;
      let top = 0;
      for (let i = 0; i < m.vertexCount; i++) {
        top = Math.max(top, m.positions[3 * i + 1]);
        if (m.colors[3 * i + 1] > 1.2 * m.colors[3 * i]) {
          g += m.colors[3 * i + 1];
          n++;
        }
      }
      return { green: g / n, top };
    });
    for (const s of stats.slice(1)) {
      expect(Math.abs(s.green / stats[0].green - 1)).toBeLessThan(0.06);
      expect(Math.abs(s.top - stats[0].top)).toBeLessThan(1.2);
    }
  });
});

describe('fusion dans les îlots (cityMesher.js)', () => {
  it('concatène murs et décor : indices décalés, aFacade nul faute de mieux, recopié sinon', () => {
    const walls = {
      positions: new Float32Array(9),
      colors: new Float32Array(9).fill(0.5),
      specs: new Float32Array(9).fill(1),
      indices: new Uint16Array([0, 1, 2]),
      vertexCount: 3,
      triangleCount: 1,
    };
    const decor = { ...walls, facades: new Float32Array(12), indices: new Uint32Array([2, 1, 0]) };
    const m = mergeChunkMeshes(walls, decor);
    expect(Array.from(m.indices)).toEqual([0, 1, 2, 5, 4, 3]);
    expect(m.indices).toBeInstanceOf(Uint16Array);
    expect(m.facades.length).toBe(24);
    expect(m.facades.every((v) => v === 0)).toBe(true);
    expect([m.wallTriangles, m.decorTriangles, m.triangleCount]).toEqual([1, 1, 2]);
    const styled = mergeChunkMeshes({ ...walls, facades: new Float32Array(12).fill(2) }, decor);
    expect(Array.from(styled.facades.slice(0, 12))).toEqual(new Array(12).fill(2));
    expect(Array.from(styled.facades.slice(12))).toEqual(new Array(12).fill(0));
    expect(mergeChunkMeshes(null, decor).triangleCount).toBe(1);
  });

  it('un seul BufferGeometry par LOD avec murs et décor ; emprises du décor dans la distance et la sphère', () => {
    const city = buildCity(avenue, palette);
    const bare = buildCity(avenue, palette, { decor: false });
    expect(city.decor.length).toBeGreaterThan(0);
    expect(bare.decor).toEqual([]);
    const chunk = city.chunks.find((c) => c.decorCount > 0 && c.buildingCount > 0);
    const twin = bare.chunks.find((c) => c.id === chunk.id);
    for (const lod of [0, 1, 2]) {
      const g = chunk.lod(lod);
      expect(g.attributes.aFacade.itemSize).toBe(4);
      expect(g.attributes.aFacade.count).toBe(g.attributes.position.count);
      expect(g.userData.wallTriangles).toBe(twin.lod(lod).userData.triangles);
      expect(g.userData.triangles).toBe(g.userData.wallTriangles + g.userData.decorTriangles);
      expect(g.index.count).toBe(3 * g.userData.triangles);
    }
    expect(chunk.lod(0).userData.decorTriangles).toBeGreaterThan(0);
    const items = city.decor.filter((d) => d.blockId === chunk.id);
    expect(items.length).toBe(chunk.decorCount);
    for (const d of items) {
      expect(chunk.nearestDistance(d.x, d.y)).toBe(0);
      for (const [x, y] of [[d.extent.x0, d.extent.y0], [d.extent.x1, d.extent.y1]]) {
        expect(Math.hypot(x - chunk.center.x, y - chunk.center.y, d.height - chunk.center.z)).toBeLessThanOrEqual(chunk.radius + 1e-6);
      }
    }
    // Sans bâtiment autour : chunk de décor seul.
    const lone = buildCity(
      { schema: SCENE_SCHEMA, id: 'place', graine: 2, limites: { min: [-100, -100], max: [100, 200] }, rues: [{ id: 'p', de: [0, 0], a: [0, 100], largeur: 60 }] },
      palette,
    );
    expect(lone.chunks.length).toBeGreaterThan(0);
    for (const c of lone.chunks) {
      expect(c.buildingCount).toBe(0);
      expect(c.lod(0).userData.decorTriangles).toBeGreaterThan(0);
    }
  });
});

describe('décor des niveaux (game/level.js) et réglage d’exécution (quality.decorOptions)', () => {
  it('exclusions : zones (+ 4 m), portes, reprises, départ et couloirs des itinéraires', () => {
    const L = 300;
    const level = resolveLevel(example, L);
    const ex = levelDecorExclusions(level, L);
    expect(ex).toContainEqual({ pos: level.colis[0].livraison.lieu, rayon: (level.colis[0].livraison.rayon ?? 8) + 4 });
    const door = level.portes[0];
    expect(ex).toContainEqual({ pos: door.pos, rayon: door.portee[0] + door.largeur / 2 });
    expect(ex).toContainEqual({ pos: level.depart.pos, rayon: 8 });
    expect(ex.some((e) => e.de && e.a)).toBe(true);
    expect(sceneOfLevel(level, L).decorExclusions).toEqual(ex);
  });

  it('les objets solides deviennent des obstacles « decor » ; décor coupé : aucun', () => {
    const physics = physicsFor(30);
    const json = LEVEL_FILES[0].json;
    const level = createLevel(json, physics, palette);
    const solid = level.scene.decor.filter((d) => d.collision);
    expect(solid.length).toBeGreaterThan(0);
    const d = solid[0];
    const hits = level.obstacles.query(d.collision.x0, d.collision.y0, d.collision.x1, d.collision.y1);
    expect(hits.some((b) => b.kind === 'decor' && b.id === d.kind)).toBe(true);
    // Boîtes indulgentes : tronc de 0,5 m.
    const tree = solid.find((x) => x.kind === 'platane');
    expect(tree.collision.x1 - tree.collision.x0).toBeCloseTo(0.5, 9);
    const bare = createLevel(json, physics, palette, { decor: false });
    expect(bare.scene.decor).toEqual([]);
    const lite = createLevel(json, physics, palette, { decor: decorOptions('', 'lite') });
    expect(lite.scene.decor.length).toBeLessThan(level.scene.decor.length);
  });

  it('?decor=0 coupe le décor ; le profil « lite » en garde une part, sans petits objets', () => {
    expect(decorOptions('', 'default')).toEqual({ enabled: true, density: 1, small: true });
    expect(decorOptions('?decor=0', 'default').enabled).toBe(false);
    expect(decorOptions('?decor=non', 'lite').enabled).toBe(false);
    expect(decorOptions('?decor=1', 'default').enabled).toBe(true);
    expect(decorOptions('', 'lite')).toEqual({ enabled: true, density: DECOR_LITE_DENSITY, small: false });
  });
});
