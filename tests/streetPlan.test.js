// Plan du sol (render/streetPlan.js, pur) : carrefours, places, passages piétons, lignes
// d'arrêt, ligne axiale, pelouses, réglage ?solDetail, rapport ir/uv de la végétation.
import { describe, expect, it } from 'vitest';
import palette from '../src/data/palette.json';
import {
  CROSSWALK,
  GUTTER_WIDTH,
  STOP_LINE,
  crosswalkBarOffsets,
  findJunctions,
  groundDetailFor,
  irUvPerLuminance,
  isPlaza,
  normalizeGreens,
  normalizeTreePits,
  planStreets,
  signedArea,
} from '../src/render/streetPlan.js';

const street = (x0, y0, x1, y1, width = 18) => ({ from: { x: x0, y: y0 }, to: { x: x1, y: y1 }, width });

/** Carrefour en croix de deux rues de 18 m à l'origine. */
const cross = [street(0, -100, 0, 100), street(-100, 0, 100, 0)];

describe('streetPlan : carrefours et places', () => {
  it('isPlaza : chaussée d’au moins 40 m', () => {
    expect(isPlaza(street(0, 0, 0, 10, 18))).toBe(false);
    expect(isPlaza(street(0, 0, 0, 10, 40))).toBe(true);
    expect(isPlaza(street(0, 0, 0, 10, 194))).toBe(true);
  });

  it('croix : l’axe de chaque rue traverse la chaussée de l’autre sur 18 m', () => {
    const j = findJunctions(cross);
    expect(j[0]).toEqual([{ t0: 91, t1: 109, crossWidth: 18 }]);
    expect(j[1]).toEqual([{ t0: 91, t1: 109, crossWidth: 18 }]);
  });

  it('T : la rue qui finit sur l’axe de l’autre a un seul carrefour, à son bout', () => {
    const j = findJunctions([street(-100, 0, 100, 0), street(0, 0, 0, 100)]);
    expect(j[0]).toEqual([{ t0: 91, t1: 109, crossWidth: 18 }]);
    expect(j[1]).toEqual([{ t0: 0, t1: 9, crossWidth: 18 }]);
  });

  it('rues parallèles : pas de carrefour ; place dans l’axe : partie recouverte', () => {
    expect(findJunctions([street(0, 0, 0, 100), street(5, 0, 5, 100)])).toEqual([[], []]);
    // Avenue qui débouche dans l'axe d'une place de 130 m (bouts carrés : 65 m avant son début).
    const j = findJunctions([street(0, -40, 0, 320), street(0, 320, 0, 400, 130)]);
    expect(j[0]).toEqual([{ t0: 295, t1: 360, crossWidth: 130 }]);
  });

  it('rue qui finit DANS une place sans atteindre son axe', () => {
    const j = findJunctions([street(0, -100, 0, 210), street(-180, 226, 180, 226, 78)]);
    expect(j[0]).toEqual([{ t0: 287, t1: 310, crossWidth: 78 }]);
  });
});

describe('streetPlan : passages piétons, lignes d’arrêt, ligne axiale', () => {
  it('bandes du zébra : 1 m tous les 2 m, centrées, entre les caniveaux', () => {
    const offsets = crosswalkBarOffsets(18);
    expect(offsets).toEqual([-7, -5, -3, -1, 1, 3, 5, 7]);
    expect(offsets[offsets.length - 1] + CROSSWALK.bar / 2).toBeLessThanOrEqual(9 - GUTTER_WIDTH);
    expect(crosswalkBarOffsets(1)).toEqual([]);
  });

  it('croix : quatre passages en retrait du carrefour, perpendiculaires à leur rue', () => {
    const plan = planStreets(cross);
    expect(plan.plazas).toEqual([]);
    expect(plan.crosswalks).toHaveLength(4);
    const d = 9 + CROSSWALK.setback + CROSSWALK.length / 2; // 12 m du centre
    const centers = plan.crosswalks.map((c) => [c.center.x, c.center.y]).sort();
    expect(centers).toEqual([[-d, 0], [0, -d], [0, d], [d, 0]].sort());
    for (const cw of plan.crosswalks) {
      expect(cw.bars).toHaveLength(8);
      // Bande : 4 m le long de la rue, 1 m en travers.
      const [a, b, , e] = cw.bars[0];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(CROSSWALK.length, 12);
      expect(Math.hypot(e.x - a.x, e.y - a.y)).toBeCloseTo(CROSSWALK.bar, 12);
      // Le bras s'éloigne du carrefour.
      expect(cw.center.x * cw.along.x + cw.center.y * cw.along.y).toBeGreaterThan(0);
    }
  });

  it('lignes d’arrêt : avant le passage, sur la voie entrante (circulation à droite)', () => {
    const plan = planStreets(cross);
    expect(plan.stopLines).toHaveLength(4);
    const t = 9 + CROSSWALK.setback + CROSSWALK.length + STOP_LINE.gap + STOP_LINE.width / 2;
    // Bras nord : on y arrive en roulant vers le sud ; la voie de droite est à l'ouest (x < 0).
    const north = plan.stopLines.find((l) => l.from.y > 0 && l.from.x === 0);
    expect(north.from).toEqual({ x: 0, y: t });
    expect(north.to.x).toBeCloseTo(-(9 - GUTTER_WIDTH), 12);
    expect(north.to.y).toBeCloseTo(t, 12);
    // Bras est : on arrive vers l'ouest ; voie de droite au nord.
    const east = plan.stopLines.find((l) => l.from.x > 0);
    expect(east.to.y).toBeCloseTo(9 - GUTTER_WIDTH, 12);
  });

  it('ligne axiale : interrompue au carrefour, arrêtée avant les lignes d’arrêt', () => {
    const plan = planStreets(cross);
    const ns = plan.centerLines.filter((l) => l.from.x === 0 && l.to.x === 0);
    expect(ns).toHaveLength(2);
    const stop = 9 + CROSSWALK.setback + CROSSWALK.length + STOP_LINE.gap + STOP_LINE.width;
    for (const l of ns) {
      const near = Math.min(Math.abs(l.from.y), Math.abs(l.to.y));
      expect(near).toBeGreaterThan(stop);
    }
  });

  it('carrefours trop proches : ni passage ni ligne d’arrêt entre eux', () => {
    // Deux rues est-ouest à 20 m l'une de l'autre sur une rue nord-sud.
    const plan = planStreets([street(0, -100, 0, 100), street(-100, 0, 100, 0), street(-100, 20, 100, 20)]);
    const onNs = plan.crosswalks.filter((c) => c.street === 0);
    expect(onNs.map((c) => Math.sign(c.center.y))).toEqual([-1, 1]);
    expect(onNs.every((c) => c.center.y < 0 || c.center.y > 29)).toBe(true);
  });

  it('place : dallée sans marquage ; les rues qui y débouchent ont leur passage dehors', () => {
    const streets = [street(0, -100, 0, 210), street(-180, 226, 180, 226, 78)];
    const plan = planStreets(streets);
    expect(plan.plazas).toEqual([1]);
    expect(plan.crosswalks.every((c) => c.street === 0)).toBe(true);
    expect(plan.crosswalks).toHaveLength(1);
    const cw = plan.crosswalks[0];
    expect(cw.center.y).toBeCloseTo(226 - 39 - CROSSWALK.setback - CROSSWALK.length / 2, 12);
    expect(cw.along).toEqual({ x: -0, y: -1 });
    // Aucune ligne axiale dans la place.
    for (const l of plan.centerLines) expect(Math.max(l.from.y, l.to.y)).toBeLessThan(187);
  });
});

describe('streetPlan : pelouses, pieds d’arbres, réglages', () => {
  it('normalizeGreens : paires ou {x, y}, sens trigonométrique, polygones invalides ignorés', () => {
    const cw = [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 0 }]; // sens horaire
    const out = normalizeGreens([cw, [[0, 0], [2, 0], [2, 2]], [[0, 0], [1, 1]], [[0, 0], [1, 1], [2, 2]], null]);
    expect(out).toHaveLength(2);
    for (const p of out) expect(signedArea(p)).toBeGreaterThan(0);
    expect(normalizeGreens(undefined)).toEqual([]);
  });

  it('normalizeTreePits : rayon positif et coordonnées finies', () => {
    expect(normalizeTreePits([{ x: 1, y: 2, r: 0.8 }, { x: 1, y: 2, r: 0 }, { x: NaN, y: 0, r: 1 }])).toEqual([{ x: 1, y: 2, r: 0.8 }]);
    expect(normalizeTreePits()).toEqual([]);
  });

  it('groundDetailFor : ?solDetail=0 rend la carte d’avant ; profil lite allégé', () => {
    expect(groundDetailFor('')).toBe('full');
    expect(groundDetailFor('?solDetail=1')).toBe('full');
    expect(groundDetailFor('?bench&solDetail=0')).toBe('off');
    expect(groundDetailFor('', 'lite')).toBe('lite');
    expect(groundDetailFor('?solDetail=0', 'lite')).toBe('off');
  });

  it('irUvPerLuminance : la pelouse de la palette retrouve ir = 0,6 et uv = 0,05', () => {
    const veg = palette.vegetation;
    const [kir, kuv] = irUvPerLuminance(veg);
    const lin = (h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const s = veg.srgb.replace('#', '');
    const Y = 0.2126 * lin(s.slice(0, 2)) + 0.7152 * lin(s.slice(2, 4)) + 0.0722 * lin(s.slice(4, 6));
    expect(kir * Y).toBeCloseTo(veg.ir, 12);
    expect(kuv * Y).toBeCloseTo(veg.uv, 12);
    // Red edge : bien plus d'IR par unité de luminance que le sol minéral (0,9).
    expect(kir).toBeGreaterThan(2);
    expect(() => irUvPerLuminance({ srgb: 'vert' })).toThrow(RangeError);
  });
});
