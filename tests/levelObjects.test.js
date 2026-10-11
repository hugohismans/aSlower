// Tests de src/render/levelObjects.js (géométries des éléments de niveau et mise à jour de
// l'état VU) : faces orientées vers l'extérieur (le matériau des façades n'en dessine qu'une),
// rien sous le sol, anneau à la bonne taille, client placé hors des bâtiments, couleur de la
// lampe = exactement celle passée (calculée par la règle), battants qui coulissent.
import { MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { blackbodyRow } from '../src/physics/constants.js';
import {
  BEACON_HEIGHT,
  beaconGeometry,
  clientGeometry,
  clientSpot,
  createLevelObjects,
  doorLeafGeometry,
  lampGeometry,
  RING_HEIGHT,
  RING_WIDTH,
  ringGeometry,
} from '../src/render/levelObjects.js';

/** Sommets (repère Three) d'une géométrie indexée, par triangle. */
function triangles(geometry) {
  const p = geometry.getAttribute('position').array;
  const idx = geometry.getIndex().array;
  const v = (i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  const out = [];
  for (let k = 0; k < idx.length; k += 3) out.push([v(idx[k]), v(idx[k + 1]), v(idx[k + 2])]);
  return out;
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Chaque triangle d'une boîte convexe regarde vers l'extérieur (normale · (centroïde − centre) > 0). */
function allOutward(geometry, center) {
  return triangles(geometry).every(([a, b, c]) => {
    const n = cross(sub(b, a), sub(c, a));
    const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    return dot(n, sub(g, center)) > 0;
  });
}

describe('géométries des éléments de niveau', () => {
  it('anneau au sol : couronne de rayon r ± largeur/2, vue de dessus, corps noir de la zone', () => {
    const g = ringGeometry(10, -20, 8, { temperature: 6500 });
    const p = g.getAttribute('position').array;
    for (let i = 0; i < p.length; i += 3) {
      const r = Math.hypot(p[i] - 10, -p[i + 2] - -20);
      expect(r).toBeGreaterThanOrEqual(8 - RING_WIDTH / 2 - 1e-5);
      expect(r).toBeLessThanOrEqual(8 + RING_WIDTH / 2 + 1e-5);
      expect(p[i + 1]).toBeCloseTo(RING_HEIGHT, 6);
    }
    // Normales vers le haut (+Y Three).
    expect(triangles(g).every(([a, b, c]) => cross(sub(b, a), sub(c, a))[1] > 0)).toBe(true);
    expect(g.getAttribute('aEmit').array[0]).toBe(blackbodyRow(6500));
  });

  it('balise, client, battant, lampe : faces vers l’extérieur, rien sous le sol', () => {
    const beacon = beaconGeometry(3, 4, { temperature: 2700 });
    expect(allOutward(beacon, [3, BEACON_HEIGHT / 2, -4])).toBe(true);
    expect(beacon.getAttribute('aEmit').array[0]).toBe(blackbodyRow(2700));
    const leaf = doorLeafGeometry(24, 6, 1);
    expect(allOutward(leaf, [6, 3, 0])).toBe(true);
    expect(allOutward(lampGeometry(0, 100, 7), [0, 7, -100])).toBe(true);
    for (const g of [beacon, leaf, clientGeometry(1, 2, '#E8371E'), lampGeometry(0, 0, 7)]) {
      const p = g.getAttribute('position').array;
      for (let i = 1; i < p.length; i += 3) expect(p[i]).toBeGreaterThanOrEqual(0);
    }
    // Le client porte les attributs des façades (réflectances et ombrage).
    const client = clientGeometry(1, 2, '#E8371E');
    expect(client.getAttribute('color').count).toBe(client.getAttribute('position').count);
    expect(client.getAttribute('aSpec').count).toBe(client.getAttribute('position').count);
  });

  it('le client se tient au bord de la zone, du côté de la façade la plus proche, hors du bâtiment', () => {
    const building = { x: 30, y: 0, width: 20, depth: 40 }; // façade ouest à x = 20
    const spot = clientSpot({ x: 0, y: 0, rayon: 8 }, [building]);
    expect(spot.y).toBe(0);
    expect(spot.x).toBeCloseTo(9.5, 9);
    const tight = clientSpot({ x: 15, y: 0, rayon: 8 }, [building]); // façade à 5 m
    expect(tight.x).toBeLessThan(20 - 0.5);
    expect(clientSpot({ x: 0, y: 0, rayon: 8 }, []).x).toBeCloseTo(9.5, 9);
  });
});

describe('createLevelObjects : état vu', () => {
  const pair = () => ({ rel: new MeshBasicMaterial(), classic: new MeshBasicMaterial() });
  const view = {
    stops: [{ key: 'pain:livraison', kind: 'livraison', x: 0, y: 90, rayon: 8 }],
    doors: [{ id: 'porte', x: 0, y: 120, capDegres: 90, largeur: 80, hauteur: 6, lampZ: 7 }],
    buildings: [],
  };

  it('arrêt actif, client vu présent ou non ; couleur de lampe = celle de la règle ; battants', () => {
    const materials = { surface: pair(), emitter: pair() };
    const objects = createLevelObjects(view, materials);
    const byName = (n) => objects.group.children.find((m) => m.name === n);
    const rgb = [0.12, 0.61, 0.08];
    objects.update({ stops: { 'pain:livraison': { active: true, present: false } }, doors: { porte: { open: false, lampRgb: rgb } } }, { x: 0, y: 0, z: 1.6 }, 0);
    expect(byName('zone:pain:livraison').visible).toBe(true);
    expect(byName('balise:pain:livraison').visible).toBe(true);
    expect(byName('client:pain:livraison').visible).toBe(false); // client absent (vu à t_e)
    const lamp = byName('lampe:porte');
    expect(lamp.material.uniforms.uLampColor.value.toArray()).toEqual(rgb);
    const left = byName('porte:porte:gauche');
    const right = byName('porte:porte:droite');
    expect(left.position.x).toBeCloseTo(0, 9);
    // Porte vue ouverte : en DOOR_OPEN_S, chaque battant glisse d'une demi-largeur vers l'extérieur.
    for (let i = 0; i < 10; i++) objects.update({ stops: {}, doors: { porte: { open: true, lampRgb: rgb } } }, { x: 0, y: 0, z: 1.6 }, 0.1);
    expect(left.position.x).toBeCloseTo(-40, 9);
    expect(right.position.x).toBeCloseTo(40, 9);
    expect(left.position.z).toBeCloseTo(-120, 9);
    // Arrêt fait : zone, balise et client disparaissent.
    objects.update({ stops: { 'pain:livraison': { active: false, present: true } }, doors: {} }, { x: 0, y: 0, z: 1.6 }, 0);
    expect(byName('zone:pain:livraison').visible).toBe(false);
    expect(byName('client:pain:livraison').visible).toBe(false);
    // Vision classique : variantes des matériaux partagés ; la lampe garde le même uniforme.
    objects.setClassic(true);
    expect(byName('zone:pain:livraison').material).toBe(materials.emitter.classic);
    expect(left.material).toBe(materials.surface.classic);
    expect(lamp.material.uniforms.uLampColor.value.toArray()).toEqual(rgb);
    expect(lamp.material.defines.REL_CLASSIC).toBe('');
    expect(objects.ownMaterials).toHaveLength(2);
    objects.dispose();
  });

  it('passage est-ouest (0°) : la porte s’étend le long de y', () => {
    const objects = createLevelObjects({ stops: [], doors: [{ ...view.doors[0], capDegres: 0 }], buildings: [] }, { surface: pair(), emitter: pair() });
    const right = objects.group.children.find((m) => m.name === 'porte:porte:droite');
    for (let i = 0; i < 10; i++) objects.update({ stops: {}, doors: { porte: { open: true, lampRgb: [0, 0, 0] } } }, { x: 0, y: 0, z: 1.6 }, 0.1);
    // Le battant « droit » (x local > 0) part vers +y du jeu, soit −Z de Three.
    expect(right.position.x).toBeCloseTo(0, 9);
    expect(right.position.z).toBeCloseTo(-120 - 40, 9);
    objects.dispose();
  });
});
