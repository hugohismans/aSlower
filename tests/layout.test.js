// Tests de src/render/layout.js (développement des scènes) et de src/render/cityMesher.js
// (îlots maillés) sur les deux scènes de développement et sur des scènes minimales.
// Les scènes sont paramétriques : leurs longueurs de jeu suivent L = c²/a = 10·c m ; elles
// sont développées pour c = 10, 30 (défaut) et 100 m/s.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blackbodyRow, LENGTH_UNIT, physicsFor } from '../src/physics/constants.js';
import { AO_HEIGHT, buildCity, hexToLinearRgb, ROOF_STEP } from '../src/render/cityMesher.js';
import {
  expandScene,
  footprint,
  footprintsTouch,
  overlapArea,
  resolveSceneLengths,
  SCENE_SCHEMA,
  visibilityFor,
} from '../src/render/layout.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const palette = readJson('../src/data/palette.json');
const avenue = readJson('../src/data/scenes/avenue-test.json');
const quartier = readJson('../src/data/scenes/quartier-test.json');
const RAINBOW = ['rouge', 'orange', 'jaune', 'vert', 'cyan', 'bleu', 'violet'];

/** Scène minimale à compléter. */
const tinyScene = (extra) => ({ schema: SCENE_SCHEMA, id: 'mini', graine: 1, ...extra });

/** Regroupe les bâtiments par îlot. */
function byBlock(buildings) {
  const blocks = new Map();
  for (const b of buildings) {
    if (!blocks.has(b.blockId)) blocks.set(b.blockId, []);
    blocks.get(b.blockId).push(b);
  }
  return blocks;
}

/** Vérifie qu'aucun bâtiment n'en chevauche un autre et que deux îlots ne se touchent pas. */
function checkNoOverlap(buildings) {
  const boxes = buildings.map(footprint);
  const order = boxes.map((_, i) => i).sort((i, j) => boxes[i].x0 - boxes[j].x0);
  const errors = [];
  for (let a = 0; a < order.length; a++) {
    for (let c = a + 1; c < order.length; c++) {
      const bi = boxes[order[a]];
      const bj = boxes[order[c]];
      if (bj.x0 > bi.x1 + 1e-6) break;
      const p = buildings[order[a]];
      const q = buildings[order[c]];
      if (overlapArea(bi, bj) !== 0) errors.push(`chevauchement ${p.blockId} / ${q.blockId}`);
      else if (footprintsTouch(bi, bj) && p.blockId !== q.blockId) errors.push(`îlots en contact ${p.blockId} / ${q.blockId}`);
    }
  }
  expect(errors).toEqual([]);
}

/** Longueur couverte par des intervalles (fusionnés). */
function coveredLength(spans) {
  let total = 0;
  let lo = -Infinity;
  let hi = -Infinity;
  for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
    if (a > hi) {
      if (hi > lo) total += hi - lo;
      lo = a;
      hi = b;
    } else hi = Math.max(hi, b);
  }
  if (hi > lo) total += hi - lo;
  return total;
}

describe('palette', () => {
  it('a des clés kebab-case, des sRGB « #rrggbb » et des IR/UV dans [0, 1]', () => {
    for (const [name, c] of Object.entries(palette)) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(c.srgb).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(c.ir).toBeGreaterThanOrEqual(0);
      expect(c.ir).toBeLessThanOrEqual(1);
      expect(c.uv).toBeGreaterThanOrEqual(0);
      expect(c.uv).toBeLessThanOrEqual(1);
    }
    for (const name of [...RAINBOW, 'creme', 'gris', 'ardoise', 'trottoir', 'chaussee', 'panneau-ir', 'panneau-uv']) {
      expect(palette[name], name).toBeDefined();
    }
  });

  it('range les façades dans l\'ordre de l\'arc-en-ciel, avec du proche IR varié', () => {
    expect(RAINBOW.map((n) => palette[n].srgb)).toEqual(['#E8371E', '#F28A1A', '#F5C71A', '#34B04A', '#1FB5C9', '#3557E0', '#8A3FD1']);
    for (const n of RAINBOW) {
      // pigments réels : ≈ 0,05 (noir de carbone) à 0,6-0,85 (oxydes de fer, blanc de titane)
      expect(palette[n].ir).toBeGreaterThanOrEqual(0.05);
      expect(palette[n].ir).toBeLessThanOrEqual(0.85);
      expect(palette[n].uv).toBeGreaterThanOrEqual(0.1);
      expect(palette[n].uv).toBeLessThanOrEqual(0.3);
    }
    expect(palette.vegetation.ir).toBeCloseTo(0.6, 10);
  });

  it('a des panneaux sombres visibles seulement par Doppler (IR devant, UV en s\'éloignant)', () => {
    const luminance = (hex) => {
      const [r, g, b] = hexToLinearRgb(hex);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(luminance(palette['panneau-ir'].srgb)).toBeLessThan(0.02);
    expect(luminance(palette['panneau-uv'].srgb)).toBeLessThan(0.02);
    expect([palette['panneau-ir'].ir, palette['panneau-ir'].uv]).toEqual([1, 0]);
    expect([palette['panneau-uv'].ir, palette['panneau-uv'].uv]).toEqual([0, 1]);
  });
});

/** Réglages de c essayés : minimum, défaut, maximum (L = 10·c m). */
const LIGHT_SPEEDS = [10, 30, 100];

describe('visibilité par défaut : clamp(1,2·L, 300, 600), lite = 0,7 × défaut', () => {
  it('vaut 300/210 m à c = 10, 360/252 m à c = 30, 600/420 m à c ≥ 50', () => {
    expect(visibilityFor(100)).toEqual({ lite: 210, default: 300 });
    expect(visibilityFor(LENGTH_UNIT)).toEqual({ lite: 252, default: 360 });
    expect(visibilityFor(500)).toEqual({ lite: 420, default: 600 });
    expect(visibilityFor(1000)).toEqual({ lite: 420, default: 600 });
  });
});

describe.each(LIGHT_SPEEDS)('expandScene : avenue de test à c = %i m/s', (c) => {
  const L = physicsFor(c).lengthUnit;
  const layout = expandScene(avenue, palette, { lengthUnit: L });
  /** Îlots par côté : de y = 0 jusqu'à la place (4·L − 80), îlots de 56 m tous les 80 m. */
  const n = Math.floor(L / 20) - 1;

  it('est déterministe (graine) et dépend de la graine', () => {
    expect(expandScene(avenue, palette, { lengthUnit: L })).toEqual(layout);
    const other = expandScene({ ...avenue, graine: avenue.graine + 1 }, palette, { lengthUnit: L });
    expect(other.buildings.map((b) => b.height)).not.toEqual(layout.buildings.map((b) => b.height));
  });

  it('donne le départ, la visibilité et les limites (fin de carte à 4·L + 60 m)', () => {
    expect(layout.lengthUnit).toBe(L);
    expect(layout.start).toEqual({ x: 0, y: 20, heading: Math.PI / 2 });
    expect(layout.visibility).toEqual(visibilityFor(L));
    expect(layout.bounds).toEqual({ xmin: -160, ymin: -100, xmax: 160, ymax: 4 * L + 60 });
    for (const b of layout.buildings) {
      const f = footprint(b);
      expect(f.x0).toBeGreaterThanOrEqual(layout.bounds.xmin);
      expect(f.x1).toBeLessThanOrEqual(layout.bounds.xmax);
      expect(f.y0).toBeGreaterThanOrEqual(layout.bounds.ymin);
      expect(f.y1).toBeLessThanOrEqual(layout.bounds.ymax);
    }
  });

  it('mesure 4·L : avenue jusqu’à 4·L − 80 m, place jusqu’à 4·L ; 1,5·L + 1,5·L + L de marge depuis le départ', () => {
    const avenueStreet = layout.streets.find((s) => s.width === 18 && s.from.x === 0);
    expect(avenueStreet.from.y).toBe(-40);
    expect(avenueStreet.to.y).toBe(4 * L - 80);
    expect(layout.streets.some((s) => s.width === 130 && s.from.y === 4 * L - 80 && s.to.y === 4 * L)).toBe(true);
    // Poussée jusqu'à γ = 2,5 puis frein : 2 × (c²/a)(γ − 1) = 3·L ; il reste L avant la place.
    expect(20 + 3 * L).toBeLessThanOrEqual(4 * L - 80);
  });

  it('borde l’avenue d’environ 6 bâtiments de 8 à 30 m par îlot, sans chevauchement', () => {
    const rows = layout.buildings.filter((b) => /^(ouest|est)-\d+$/.test(b.blockId));
    expect(rows.length).toBeGreaterThanOrEqual(2 * n * 2.6);
    expect(rows.length).toBeLessThanOrEqual(2 * n * 3.3);
    for (const b of rows) {
      expect(b.height).toBeGreaterThanOrEqual(8);
      expect(b.height).toBeLessThanOrEqual(30);
    }
    expect(Math.max(...rows.map((b) => footprint(b).y1))).toBe(80 * (n - 1) + 56);
    expect(80 * (n - 1) + 56).toBeGreaterThan(4 * L - 80 - 80);
    checkNoOverlap(layout.buildings);
  });

  it('remplit chaque îlot de bâtiments mitoyens alignés sur l\'avenue (îlots entiers)', () => {
    const blocks = byBlock(layout.buildings);
    for (const side of ['ouest', 'est']) {
      expect(blocks.has(`${side}-${n}`)).toBe(false);
      for (let j = 0; j < n; j++) {
        const list = blocks.get(`${side}-${j}`);
        expect(list, `${side}-${j}`).toBeDefined();
        const boxes = list.map(footprint).sort((a, b) => a.y0 - b.y0);
        const front = side === 'ouest' ? -12 : 12;
        let y = 80 * j;
        for (const f of boxes) {
          expect(f.y0).toBe(y); // mitoyens : chaque bâtiment commence où finit le précédent
          if (side === 'ouest') expect(f.x1).toBe(front);
          else expect(f.x0).toBe(front);
          expect(Math.min(f.x0, f.x1)).toBeGreaterThanOrEqual(side === 'ouest' ? -68 : 12);
          expect(Math.max(f.x0, f.x1)).toBeLessThanOrEqual(side === 'ouest' ? -12 : 68);
          y = f.y1;
        }
        expect(y).toBe(80 * j + 56);
      }
    }
  });

  it('colore les façades dans l\'ordre de l\'arc-en-ciel le long de l\'avenue', () => {
    for (const side of ['ouest', 'est']) {
      const list = layout.buildings.filter((b) => b.blockId.startsWith(`${side}-`)).sort((a, b) => a.y - b.y);
      list.forEach((b, i) => expect(b.color).toBe(palette[RAINBOW[i % 7]].srgb));
    }
  });

  it('place les lampadaires 2 700 K tous les 40 m des deux côtés, à 6 m (échelle humaine)', () => {
    const lamps = layout.lamps.filter((l) => Math.abs(l.x) < 12);
    // Avenue de −40 à 4·L − 80 m : lampadaires à 20, 60, 100… m de son début.
    expect(lamps.length).toBe(2 * (Math.floor((4 * L - 60) / 40) + 1));
    for (const l of layout.lamps) {
      expect(l.height).toBe(6);
      expect(l.temperature).toBe(2700);
      expect(l.intensity).toBe(1);
    }
    const west = lamps.filter((l) => l.x < 0).map((l) => l.y).sort((a, b) => a - b);
    expect(lamps.filter((l) => l.x > 0)).toHaveLength(west.length);
    for (let i = 1; i < west.length; i++) expect(west[i] - west[i - 1]).toBeCloseTo(40, 9);
    for (const l of lamps) expect(Math.abs(l.x)).toBeCloseTo(10.5, 9);
  });

  it('pose 4 panneaux IR et 3 UV le long de l\'avenue, une place et une butée au bout', () => {
    const ir = layout.buildings.filter((b) => b.ir === 1);
    const uv = layout.buildings.filter((b) => b.uv === 1);
    expect(ir).toHaveLength(4);
    expect(uv).toHaveLength(3);
    for (const p of [...ir, ...uv]) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(4 * L - 80);
    }
    const butee = layout.buildings.find((b) => b.blockId === 'butee');
    expect(footprint(butee).y0).toBe(4 * L);
    expect(footprint(butee).x0).toBeLessThanOrEqual(-12);
    expect(footprint(butee).x1).toBeGreaterThanOrEqual(12);
    // La place (y ∈ [4·L − 80, 4·L]) est libre de bâtiments.
    for (const b of layout.buildings) {
      const f = footprint(b);
      expect(f.y1 <= 4 * L - 80 || f.y0 >= 4 * L).toBe(true);
    }
    expect(layout.streets.filter((s) => s.from.y === s.to.y)).toHaveLength(n); // transversales
  });
});

describe.each(LIGHT_SPEEDS)('expandScene : quartier de test à c = %i m/s', (c) => {
  const L = physicsFor(c).lengthUnit;
  const layout = expandScene(quartier, palette, { lengthUnit: L });
  const vis = visibilityFor(L);
  /** Demi-côté : visibilité + 12 m, arrondi aux 80 m supérieurs ; m × m îlots. */
  const H = Math.ceil((vis.default + 12) / 80) * 80;
  const m = H / 40;

  it('contient le disque de visibilité autour du départ : m × m îlots, sans chevauchement', () => {
    expect(H).toBe({ 10: 320, 30: 400, 100: 640 }[c]);
    const blocks = byBlock(layout.buildings);
    expect(blocks.size).toBe(m * m);
    expect(layout.bounds).toEqual({ xmin: -H - 20, ymin: -H - 20, xmax: H + 20, ymax: H + 20 });
    // Bâtiments jusqu'à H − 12 du centre (dernière façade) : au-delà de la visibilité.
    expect(H - 12).toBeGreaterThanOrEqual(vis.default);
    expect(Math.max(...layout.buildings.map((b) => footprint(b).x1))).toBe(H - 12);
    expect(2 * H).toBeGreaterThanOrEqual(Math.max(400, 1.25 * L));
    expect(layout.start).toEqual({ x: 0, y: 0, heading: Math.PI / 2 });
    expect(layout.visibility).toEqual(vis);
    expect(layout.streets).toHaveLength(2 * (m + 1));
    // Une rue nord-sud passe par x = 0 (parcours de ?bench).
    expect(layout.streets.some((s) => s.from.x === 0 && s.to.x === 0)).toBe(true);
    checkNoOverlap(layout.buildings);
  });

  it('ferme chaque îlot : ses quatre côtés sont entièrement bâtis', () => {
    for (const [id, list] of byBlock(layout.buildings)) {
      const [, r, i] = id.split('-').map(Number);
      const x0 = -H + 12 + 80 * i;
      const y0 = -H + 12 + 80 * r;
      const x1 = x0 + 56;
      const y1 = y0 + 56;
      const boxes = list.map(footprint);
      for (const f of boxes) {
        expect(f.x0).toBeGreaterThanOrEqual(x0);
        expect(f.x1).toBeLessThanOrEqual(x1);
        expect(f.y0).toBeGreaterThanOrEqual(y0);
        expect(f.y1).toBeLessThanOrEqual(y1);
      }
      expect(coveredLength(boxes.filter((f) => f.y0 === y0).map((f) => [f.x0, f.x1]))).toBe(56);
      expect(coveredLength(boxes.filter((f) => f.y1 === y1).map((f) => [f.x0, f.x1]))).toBe(56);
      expect(coveredLength(boxes.filter((f) => f.x0 === x0).map((f) => [f.y0, f.y1]))).toBe(56);
      expect(coveredLength(boxes.filter((f) => f.x1 === x1).map((f) => [f.y0, f.y1]))).toBe(56);
    }
  });
});

describe('longueurs de jeu : expressions en L', () => {
  it('évalue fois, de, plus, min, max, arrondis et paramètres dans l’ordre', () => {
    const scene = {
      parametres: { V: { fois: 1, de: 'visibilite' }, H: { fois: 1, de: 'V', plus: 12, arrondiSup: 80 } },
      a: { fois: 4, plus: -80 },
      b: [{ fois: 0.05, plus: -1, arrondiInf: 1 }, 7],
      c: { fois: 1.2, min: 300, max: 600 },
      d: { fois: 0.72, arrondiInf: 80, puisPlus: 40 },
      e: { fois: 0.025, de: 'H' },
      f: { nom: 'texte', de: [1, 2] },
    };
    expect(resolveSceneLengths(scene, 300)).toEqual({
      a: 1120,
      b: [14, 7],
      c: 360,
      d: 200,
      e: 10,
      f: { nom: 'texte', de: [1, 2] },
    });
    expect(resolveSceneLengths(scene, 310).b[0]).toBe(14); // 14,5 → arrondi inférieur
    expect(resolveSceneLengths(scene, 1000).c).toBe(600);
    expect(resolveSceneLengths(scene, 100).c).toBe(300);
  });

  it('refuse un paramètre inconnu, une clé inconnue, un L invalide', () => {
    expect(() => resolveSceneLengths({ a: { fois: 1, de: 'X' } }, 300)).toThrow(/X/);
    expect(() => resolveSceneLengths({ a: { fois: 1, fios: 2 } }, 300)).toThrow(/fios/);
    expect(() => resolveSceneLengths({ parametres: { L: { fois: 2 } } }, 300)).toThrow(/L/);
    expect(() => resolveSceneLengths({}, 0)).toThrow();
    expect(() => expandScene(tinyScene({ rues: [{ de: [0, 0], a: [10, 0], largeur: 8, repeter: { nombre: { fois: 0.005 }, pas: [0, 20] } }] }), palette)).toThrow(/nombre/);
  });
});

describe('expandScene : règles et erreurs', () => {
  it('fusionne en un seul îlot des bâtiments qui se touchent', () => {
    const scene = tinyScene({
      batiments: [
        { id: 'a', pos: [0, 0], taille: [10, 10], hauteur: 10, couleur: 'rouge' },
        { id: 'b', pos: [10, 0], taille: [10, 10], hauteur: 20, couleur: 'vert' },
        { id: 'c', pos: [40, 0], taille: [10, 10], hauteur: 20, couleur: 'bleu' },
      ],
      rangees: [
        // Îlots collés (pas = taille) : la rangée entière devient un seul îlot.
        { id: 'r', coin: [0, 100], ilot: [20, 20], nombre: 3, pas: [20, 0], facades: ['sud'], largeurs: [5, 8], profondeurs: [5, 6], hauteurs: [8, 9] },
      ],
    });
    const layout = expandScene(scene, palette);
    const blocks = byBlock(layout.buildings);
    expect(new Set(layout.buildings.filter((b) => b.y < 50).map((b) => b.blockId))).toEqual(new Set(['a', 'c']));
    expect(new Set(layout.buildings.filter((b) => b.y > 50).map((b) => b.blockId))).toEqual(new Set(['r-0']));
    expect(blocks.size).toBe(3);
  });

  it('accepte une couleur hexadécimale et des surcharges IR/UV', () => {
    const layout = expandScene(
      tinyScene({ batiments: [{ id: 'a', pos: [0, 0], taille: [4, 4], hauteur: 5, couleur: '#102030', ir: 0.9 }] }),
      palette,
    );
    expect(layout.buildings[0]).toMatchObject({ color: '#102030', ir: 0.9, uv: 0.15, blockId: 'a' });
  });

  it('refuse un schéma inconnu, une couleur absente, une rue inconnue, un chevauchement', () => {
    expect(() => expandScene({ ...tinyScene({}), schema: 'autre/1' }, palette)).toThrow(/schéma/);
    expect(() =>
      expandScene(tinyScene({ batiments: [{ pos: [0, 0], taille: [4, 4], hauteur: 5, couleur: 'rose' }] }), palette),
    ).toThrow(/rose/);
    expect(() => expandScene(tinyScene({ lampadaires: [{ rue: 'nulle-part', pas: 40 }] }), palette)).toThrow(/nulle-part/);
    expect(() =>
      expandScene(
        tinyScene({ rues: [{ id: 'r', de: [0, 0], a: [0, 100], largeur: 20 }], lampadaires: [{ rue: 'r', pas: 40, temperature: 3000 }] }),
        palette,
      ),
    ).toThrow(/3000/);
    expect(() =>
      expandScene(
        tinyScene({
          batiments: [
            { id: 'a', pos: [0, 0], taille: [10, 10], hauteur: 5, couleur: 'gris' },
            { id: 'b', pos: [5, 5], taille: [10, 10], hauteur: 5, couleur: 'gris' },
          ],
        }),
        palette,
      ),
    ).toThrow(/chevauchent/);
  });
});

/* ------------------------------------------------------------------------- */
/* Maillage des îlots                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Contrôle complet d'une géométrie d'îlot : repère Three, pas, attributs, murs sans
 * jonction en T (toute arête non horizontale d'un mur est partagée par exactement
 * deux triangles), orientation vers l'extérieur et absence de murs mitoyens cachés.
 */
function checkChunkGeometry(geometry, boxes, step, colors) {
  const pos = geometry.attributes.position.array;
  const col = geometry.attributes.color.array;
  const spec = geometry.attributes.aSpec.array;
  const idx = geometry.index.array;
  expect(geometry.attributes.position.itemSize).toBe(3);
  expect(geometry.attributes.color.itemSize).toBe(3);
  expect(geometry.attributes.aSpec.itemSize).toBe(3);
  // Les anomalies sont collectées puis vérifiées d'un coup (un expect par sommet serait lent).
  const errors = [];
  const fail = (message) => {
    if (errors.length < 10) errors.push(message);
  };
  // Repère du jeu depuis le repère Three : x = X, y = −Z, z = Y.
  const game = (i) => ({ x: pos[3 * i], y: -pos[3 * i + 2], z: pos[3 * i + 1] });
  const inside = (p, tol) =>
    boxes.some((b) => p.x >= b.x0 - tol && p.x <= b.x1 + tol && p.y >= b.y0 - tol && p.y <= b.y1 + tol && p.z >= -tol && p.z <= b.h + tol);
  const hmax = Math.max(...boxes.map((b) => b.h));

  for (let i = 0; i < pos.length / 3; i++) {
    const p = game(i);
    if (p.z < 0 || p.z > hmax + 1e-4) fail(`sommet ${i} hors hauteur : z = ${p.z}`); // aucune géométrie sous le sol
    if (!inside(p, 1e-3)) fail(`sommet ${i} hors des bâtiments : ${JSON.stringify(p)}`);
    const c = [col[3 * i], col[3 * i + 1], col[3 * i + 2]];
    if (!colors.some((k) => k.every((v, j) => Math.abs(v - c[j]) < 1e-6))) fail(`couleur ${c} hors palette`);
    if (!(spec[3 * i + 2] >= 0.5 && spec[3 * i + 2] <= 1)) fail(`ombrage ${spec[3 * i + 2]}`);
  }

  const key = (p) => `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const v = [game(idx[t]), game(idx[t + 1]), game(idx[t + 2])];
    const e1 = { x: v[1].x - v[0].x, y: v[1].y - v[0].y, z: v[1].z - v[0].z };
    const e2 = { x: v[2].x - v[0].x, y: v[2].y - v[0].y, z: v[2].z - v[0].z };
    const n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
    const ln = Math.hypot(n.x, n.y, n.z);
    if (!(ln > 0)) {
      fail(`triangle ${t / 3} dégénéré`);
      continue;
    }
    const nn = { x: n.x / ln, y: n.y / ln, z: n.z / ln };
    const roof = Math.abs(nn.z) > 0.999;
    if (roof && nn.z < 0) fail(`toit ${t / 3} tourné vers le bas`);
    if (!roof && Math.abs(nn.z) >= 1e-3) fail(`mur ${t / 3} non vertical`);
    // Orientation : juste devant la face, on est dehors ; juste derrière, dedans.
    const c = { x: (v[0].x + v[1].x + v[2].x) / 3, y: (v[0].y + v[1].y + v[2].y) / 3, z: (v[0].z + v[1].z + v[2].z) / 3 };
    const ahead = { x: c.x + 0.05 * nn.x, y: c.y + 0.05 * nn.y, z: c.z + 0.05 * nn.z };
    const behind = { x: c.x - 0.05 * nn.x, y: c.y - 0.05 * nn.y, z: c.z - 0.05 * nn.z };
    if (inside(ahead, -1e-3)) fail(`triangle ${t / 3} tourné vers l'intérieur ou mur mitoyen caché`);
    if (!inside(behind, 1e-3)) fail(`triangle ${t / 3} sans bâtiment derrière lui`);
    // Pas de la grille (toits : max(s, ROOF_STEP)).
    const limit = (roof ? Math.max(step, ROOF_STEP) : step) + 1e-3;
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      if (Math.abs(a.z - b.z) > limit) fail(`arête verticale de ${Math.abs(a.z - b.z)} m > ${limit}`);
      if (Math.hypot(a.x - b.x, a.y - b.y) > (roof ? Math.SQRT2 * limit : limit)) fail(`arête horizontale trop longue`);
      if (roof || Math.abs(a.z - b.z) < 1e-4) continue; // arêtes horizontales : bords haut/bas
      const ka = key(a);
      const kb = key(b);
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const [k, count] of edges) if (count !== 2) fail(`arête non conforme ${k} (${count} triangles)`);
  expect(errors).toEqual([]);
}

/** Boîtes (repère du jeu) et couleurs linéaires des bâtiments d'un îlot. */
function blockBoxes(layout, id) {
  return layout.buildings
    .filter((b) => b.blockId === id)
    .map((b) => {
      const f = footprint(b);
      return { x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, h: b.height };
    });
}

describe('cityMesher', () => {
  const colors = Object.values(palette).map((c) => hexToLinearRgb(c.srgb));

  it('fait un chunk par îlot, avec émetteurs, rues, départ, visibilité et limites', () => {
    const city = buildCity(avenue, palette);
    const layout = expandScene(avenue, palette);
    const blocks = byBlock(layout.buildings);
    expect(city.chunks.map((c) => c.id).sort()).toEqual([...blocks.keys()].sort());
    expect(city.chunks.reduce((s, c) => s + c.buildingCount, 0)).toBe(layout.buildings.length);
    expect(city.streets).toEqual(layout.streets);
    expect(city.start).toEqual(layout.start);
    expect(city.visibility).toEqual(visibilityFor(LENGTH_UNIT));
    expect(city.bounds).toEqual(layout.bounds);
    expect(city.lengthUnit).toBe(LENGTH_UNIT);
    // Unité de longueur de la partie transmise à expandScene (c = 100 : avenue de 4 km).
    const big = buildCity(avenue, palette, { lengthUnit: 1000 });
    expect(big.bounds.ymax).toBe(4060);
    expect(big.chunks.length).toBeGreaterThan(city.chunks.length);

    const em = city.emitters;
    expect(em.attributes.aEmit.itemSize).toBe(2);
    expect(em.attributes.position.count).toBe(24 * layout.lamps.length);
    expect(em.index.count).toBe(36 * layout.lamps.length);
    const emit = em.attributes.aEmit.array;
    for (let i = 0; i < emit.length; i += 2) {
      expect(emit[i]).toBe(blackbodyRow(2700));
      expect(emit[i + 1]).toBe(1);
    }
    for (let i = 1; i < em.attributes.position.array.length; i += 3) {
      expect(Math.abs(em.attributes.position.array[i] - 6)).toBeLessThanOrEqual(0.25 + 1e-6);
    }
  });

  it('donne la distance au bâtiment le plus proche et une sphère englobante', () => {
    const city = buildCity(avenue, palette);
    const chunk = city.chunks.find((c) => c.id === 'ouest-0');
    expect(chunk.nearestDistance(0, 20)).toBe(12); // façade sur l'avenue à x = −12
    const layout = expandScene(avenue, palette);
    const first = layout.buildings.find((b) => b.blockId === 'ouest-0');
    expect(chunk.nearestDistance(first.x, first.y)).toBe(0); // à l'intérieur d'un bâtiment
    expect(chunk.nearestDistance(-40, -10)).toBeCloseTo(Math.hypot(-40 - footprint(first).x0, 10), 9);
    for (const b of layout.buildings.filter((x) => x.blockId === 'ouest-0')) {
      const f = footprint(b);
      for (const [x, y, z] of [[f.x0, f.y0, 0], [f.x1, f.y1, b.height]]) {
        expect(Math.hypot(x - chunk.center.x, y - chunk.center.y, z - chunk.center.z)).toBeLessThanOrEqual(chunk.radius + 1e-9);
      }
    }
  });

  it('crée les LOD à la demande, les garde en cache et respecte les pas', () => {
    const city = buildCity(avenue, palette, { lodSteps: [1.5, 5, 15] });
    const chunk = city.chunks[0];
    const g0 = chunk.lod(0);
    expect(chunk.lod(0)).toBe(g0);
    expect(chunk.lod(9)).toBe(chunk.lod(2)); // borné au plus grossier
    expect(g0.userData.step).toBe(1.5);
    const tri = [0, 1, 2].map((k) => chunk.lod(k).index.count / 3);
    expect(tri[0]).toBeGreaterThan(tri[1]);
    expect(tri[1]).toBeGreaterThan(tri[2]);
    expect(() => buildCity(avenue, palette, { lodSteps: [5, 1.5] })).toThrow(/lodSteps/);
  });

  it('libère un LOD (dispose) et le remaille au besoin', () => {
    const city = buildCity(avenue, palette, { lodSteps: [1.5, 5, 15] });
    const chunk = city.chunks[0];
    const g0 = chunk.lod(0);
    let disposed = 0;
    g0.addEventListener('dispose', () => disposed++);
    const g1 = chunk.lod(1);
    chunk.release(0);
    expect(disposed).toBe(1);
    const again = chunk.lod(0);
    expect(again).not.toBe(g0);
    expect(again.index.count).toBe(g0.index.count);
    expect(chunk.lod(1)).toBe(g1); // les autres LOD sont gardés
    chunk.release(2); // jamais maillé : sans effet
    expect(chunk.lod(1)).toBe(g1);
  });

  it('maille les îlots de l\'avenue sans jonction en T, vers l\'extérieur, à tous les LOD', () => {
    const city = buildCity(avenue, palette);
    const layout = expandScene(avenue, palette);
    const sample = ['ouest-0', 'est-0', 'ouest-7', 'est-13', 'depot', 'butee', 'panneau-ir-1', 'panneau-uv-1'];
    for (const id of sample) {
      const chunk = city.chunks.find((c) => c.id === id);
      for (const [k, step] of [1.5, 5, 15].entries()) checkChunkGeometry(chunk.lod(k), blockBoxes(layout, id), step, colors);
    }
  });

  it('maille les îlots fermés du quartier (murs mitoyens, angles) sans jonction en T', () => {
    const city = buildCity(quartier, palette);
    const layout = expandScene(quartier, palette);
    // c = 30 : 10 × 10 îlots (coin, milieu, coin opposé).
    for (const id of ['quartier-0-0', 'quartier-4-5', 'quartier-9-9']) {
      const chunk = city.chunks.find((c) => c.id === id);
      for (const [k, step] of [1.5, 5, 15].entries()) checkChunkGeometry(chunk.lod(k), blockBoxes(layout, id), step, colors);
    }
  });

  it('cuit l\'ombrage par orientation et assombrit le pied des murs', () => {
    const city = buildCity(
      tinyScene({ batiments: [{ id: 'a', pos: [0, 0], taille: [10, 8], hauteur: 12, couleur: 'vert' }] }),
      palette,
    );
    const g = city.chunks[0].lod(1);
    const pos = g.attributes.position.array;
    const spec = g.attributes.aSpec.array;
    const idx = g.index.array;
    const seen = new Map();
    // Face de chaque triangle d'après sa normale (repère Three : X = x, Y = z, Z = −y).
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]].map((i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const face = n[1] > 0 ? 'toit' : n[2] > 0 ? 'sud' : n[2] < 0 ? 'nord' : n[0] > 0 ? 'est' : 'ouest';
      for (const i of [idx[t], idx[t + 1], idx[t + 2]]) {
        if (pos[3 * i + 1] >= AO_HEIGHT) seen.set(face, spec[3 * i + 2]);
      }
    }
    for (let i = 0; i < pos.length / 3; i++) {
      if (pos[3 * i + 1] === 0) expect(spec[3 * i + 2]).toBeLessThan(0.86 * 0.86); // pied assombri
      expect(spec[3 * i]).toBeCloseTo(palette.vert.ir, 6);
      expect(spec[3 * i + 1]).toBeCloseTo(palette.vert.uv, 6);
    }
    expect(seen.get('toit')).toBeCloseTo(1, 6);
    const order = ['sud', 'ouest', 'est', 'nord'].map((f) => seen.get(f));
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]);
  });

  it('omet les murs mitoyens cachés et garde la partie qui dépasse', () => {
    // Deux bâtiments collés : le plus haut montre son mur mitoyen au-dessus du plus bas.
    const city = buildCity(
      tinyScene({
        batiments: [
          { id: 'a', pos: [0, 0], taille: [10, 10], hauteur: 9, couleur: 'rouge' },
          { id: 'b', pos: [10, 0], taille: [10, 10], hauteur: 21, couleur: 'bleu' },
        ],
      }),
      palette,
    );
    expect(city.chunks).toHaveLength(1);
    const g = city.chunks[0].lod(0);
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    let exposed = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const xs = [0, 1, 2].map((e) => pos[3 * idx[t + e]]);
      const zs = [0, 1, 2].map((e) => pos[3 * idx[t + e] + 1]);
      if (xs.every((x) => x === 5)) {
        // Plan mitoyen x = 5 : seulement le mur de b, au-dessus du toit de a.
        expect(Math.min(...zs)).toBeGreaterThanOrEqual(9);
        exposed++;
      }
    }
    expect(exposed).toBeGreaterThan(0);
  });
});

describe('hauteur minimale des bâtiments', () => {
  it("refuse un bâtiment ou une rangée plus bas que l'œil + 1 m", async () => {
    const { MIN_BUILDING_HEIGHT } = await import('../src/render/layout.js');
    const { EYE_HEIGHT } = await import('../src/physics/constants.js');
    expect(MIN_BUILDING_HEIGHT).toBeGreaterThanOrEqual(EYE_HEIGHT + 1);
    const low = { ...avenue, batiments: [...avenue.batiments, { id: 'kiosque', pos: [0, 200], taille: [4, 4], hauteur: 1, couleur: 'jaune' }] };
    expect(() => expandScene(low, palette)).toThrow(/kiosque.*hauteur/);
    const lowRow = { ...avenue, rangees: avenue.rangees.map((r, i) => (i === 0 ? { ...r, hauteurs: [1, 30] } : r)) };
    expect(() => expandScene(lowRow, palette)).toThrow(/hauteurs/);
    for (const b of expandScene(avenue, palette).buildings) expect(b.height).toBeGreaterThanOrEqual(MIN_BUILDING_HEIGHT);
  });
});
