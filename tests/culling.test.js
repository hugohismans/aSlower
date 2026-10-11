// Tests de src/render/culling.js : coupe des îlots à la distance de visibilité.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCity } from '../src/render/cityMesher.js';
import { chunkDistance, isChunkVisible } from '../src/render/culling.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const palette = readJson('../src/data/palette.json');

/** Îlot factice : un rectangle [x0, x1] × [y0, y1]. */
function rectChunk(x0, y0, x1, y1) {
  return {
    center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: 10 },
    radius: Math.hypot((x1 - x0) / 2, (y1 - y0) / 2, 10),
    nearestDistance: (px, py) => Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)),
  };
}

describe('isChunkVisible', () => {
  const eye = { x: 0, y: 0, z: 1.6 };

  it('coupe exactement à la distance de visibilité (point le plus proche)', () => {
    const chunk = rectChunk(100, -20, 156, 36); // point le plus proche à 100 m
    expect(chunkDistance(chunk, eye)).toBe(100);
    expect(isChunkVisible(chunk, eye, 100)).toBe(true);
    expect(isChunkVisible(chunk, eye, 99.99)).toBe(false);
    expect(isChunkVisible(chunk, eye, 600)).toBe(true);
  });

  it('garde l\'îlot qui contient la caméra', () => {
    expect(isChunkVisible(rectChunk(-10, -10, 10, 10), eye, 1)).toBe(true);
  });

  it('ne dépend pas de la direction (le culling relativiste ne coupe pas derrière)', () => {
    for (const [x, y] of [[300, 0], [-300, 0], [0, 300], [0, -300], [212, -212]]) {
      const chunk = rectChunk(x - 1, y - 1, x + 1, y + 1);
      expect(isChunkVisible(chunk, eye, 400)).toBe(true);
      expect(isChunkVisible(chunk, eye, 250)).toBe(false);
    }
  });

  it('se rabat sur la sphère englobante sans nearestDistance', () => {
    const chunk = { center: { x: 500, y: 0, z: 0 }, radius: 50 };
    expect(chunkDistance(chunk, { x: 0, y: 0, z: 0 })).toBe(450);
    expect(isChunkVisible(chunk, { x: 0, y: 0, z: 0 }, 450)).toBe(true);
    expect(isChunkVisible(chunk, { x: 0, y: 0, z: 0 }, 449)).toBe(false);
  });

  it('sur l\'avenue de test : ne garde que les îlots à moins de la visibilité', () => {
    const city = buildCity(readJson('../src/data/scenes/avenue-test.json'), palette);
    const start = { x: city.start.x, y: city.start.y, z: 1.6 };
    for (const far of [city.visibility.lite, city.visibility.default]) {
      const visible = city.chunks.filter((c) => isChunkVisible(c, start, far));
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.length).toBeLessThan(city.chunks.length);
      // Au plus 42 îlots visibles sur l'avenue (plan, §4 Culling).
      expect(visible.length).toBeLessThanOrEqual(42);
      for (const c of city.chunks) {
        // Chaque îlot gardé a au moins un bâtiment à moins de `far` ; chaque îlot coupé n'en a aucun.
        expect(isChunkVisible(c, start, far)).toBe(c.nearestDistance(start.x, start.y) <= far);
        expect(c.nearestDistance(start.x, start.y)).toBeGreaterThanOrEqual(
          Math.hypot(c.center.x - start.x, c.center.y - start.y) - c.radius - 1e-9,
        );
      }
    }
  });
});
