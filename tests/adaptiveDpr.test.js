// DPR adaptatif (src/render/adaptiveDpr.js) : baisse sur l'intervalle moyen de 90 images,
// remontée sur 10 s d'images rapides et de CPU bas, planchers, plafond, garde-fous.
import { describe, expect, it } from 'vitest';
import {
  DOWN_WINDOW_FRAMES,
  DPR_FLOOR_LITE,
  RAISE_COOLDOWN_MS,
  UP_WINDOW_MS,
  WARMUP_FRAMES,
  createAdaptiveDpr,
} from '../src/render/adaptiveDpr.js';

/** Passe n images identiques ; renvoie les changements de DPR (dans l'ordre). */
function feed(ctrl, n, frameMs, cpuMs = 2) {
  const changes = [];
  for (let i = 0; i < n; i += 1) {
    const next = ctrl.sample(frameMs, cpuMs);
    if (next !== null) changes.push(next);
  }
  return changes;
}

/** Nombre d'images pour couvrir la fenêtre de remontée à un intervalle donné. */
const upFrames = (frameMs) => Math.ceil(UP_WINDOW_MS / frameMs);

describe('createAdaptiveDpr', () => {
  it('part du DPR du profil et le garde à 60 i/s réguliers', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    expect(ctrl.dpr).toBe(2);
    expect(feed(ctrl, 3000, 16.7)).toEqual([]);
    expect(ctrl.dpr).toBe(2);
  });

  it('baisse de 0,25 quand la moyenne des 90 images dépasse 18,5 ms', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    // Préchauffage ignoré, puis exactement 90 images à 20 ms : une baisse à la 90e.
    expect(feed(ctrl, WARMUP_FRAMES + DOWN_WINDOW_FRAMES - 1, 20)).toEqual([]);
    expect(ctrl.sample(20, 2)).toBe(1.75);
    expect(ctrl.changes).toBe(1);
  });

  it('ne baisse pas à 18,4 ms de moyenne, même avec quelques accrocs', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    feed(ctrl, WARMUP_FRAMES, 16.7);
    // 86 images à 16,7 ms et 4 à 40 ms : moyenne ≈ 17,7 ms.
    const changes = [];
    for (let k = 0; k < 20; k += 1) {
      changes.push(...feed(ctrl, 86, 16.7), ...feed(ctrl, 4, 40));
    }
    expect(changes).toEqual([]);
  });

  it('descend palier par palier jusqu’au plancher 1, puis plus rien', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    const changes = feed(ctrl, 2000, 33);
    expect(changes).toEqual([1.75, 1.5, 1.25, 1]);
    expect(ctrl.dpr).toBe(1);
    expect(feed(ctrl, 2000, 33)).toEqual([]);
  });

  it('plancher 0,75 en profil « lite »', () => {
    const ctrl = createAdaptiveDpr({ max: 1.5, min: DPR_FLOOR_LITE });
    expect(feed(ctrl, 3000, 40)).toEqual([1.25, 1, 0.75]);
  });

  it('profil déjà au plancher (DPR 1, ou lite 0,75) : jamais de changement', () => {
    for (const [max, min] of [
      [1, 1],
      [0.75, 0.75],
      [0.75, 1], // plancher ramené au plafond
    ]) {
      const ctrl = createAdaptiveDpr({ max, min });
      expect(ctrl.min).toBe(max);
      expect(feed(ctrl, 3000, 50)).toEqual([]);
      expect(feed(ctrl, 3000, 16.7, 1)).toEqual([]);
    }
  });

  it('remonte après 10 s d’images rapides et de CPU bas, pas avant la fin du délai après une baisse', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    expect(feed(ctrl, WARMUP_FRAMES + DOWN_WINDOW_FRAMES, 25)).toEqual([1.75]);
    // Délai de 30 s après la baisse : les fenêtres de 10 s qui s'y terminent ne comptent pas.
    const quiet = feed(ctrl, WARMUP_FRAMES + Math.floor((RAISE_COOLDOWN_MS - 1000) / 16.7), 16.7, 3);
    expect(quiet).toEqual([]);
    const later = feed(ctrl, upFrames(16.7) * 2, 16.7, 3);
    expect(later).toEqual([2]);
    expect(ctrl.dpr).toBe(2);
    // Au plafond : plus de remontée.
    expect(feed(ctrl, upFrames(16.7) * 3, 16.7, 1)).toEqual([]);
  });

  it('ne remonte pas si plus de 2 % des images dépassent 17,5 ms', () => {
    const ctrl = createAdaptiveDpr({ max: 2, initial: 1.5 });
    feed(ctrl, WARMUP_FRAMES, 16.7);
    const changes = [];
    for (let k = 0; k < 400; k += 1) changes.push(...feed(ctrl, 30, 16.7, 2), ...feed(ctrl, 1, 18, 2)); // 3,2 % lentes
    expect(changes).toEqual([]);
    expect(ctrl.dpr).toBe(1.5);
  });

  it('ne remonte pas si le temps CPU n’est pas bas', () => {
    const ctrl = createAdaptiveDpr({ max: 2, initial: 1.5 });
    expect(feed(ctrl, WARMUP_FRAMES + upFrames(16.7) * 4, 16.7, 12)).toEqual([]);
    expect(ctrl.dpr).toBe(1.5);
  });

  it('ignore les valeurs invalides ; un accroc isolé, même très long, ne fait pas baisser', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    feed(ctrl, WARMUP_FRAMES, 16.7);
    for (const bad of [0, -5, NaN]) expect(ctrl.sample(bad, 1)).toBeNull();
    expect(ctrl.sample(5000, 1)).toBeNull(); // plafonné à 100 ms
    expect(feed(ctrl, 500, 16.7)).toEqual([]);
    expect(ctrl.dpr).toBe(2);
  });

  it('un appareil très lent (5 i/s) baisse aussi', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    expect(feed(ctrl, WARMUP_FRAMES + DOWN_WINDOW_FRAMES, 200)).toEqual([1.75]);
  });

  it('reset() oublie les mesures : une demi-fenêtre lente puis une reprise ne baisse pas', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    feed(ctrl, WARMUP_FRAMES + 60, 30);
    ctrl.reset();
    expect(feed(ctrl, WARMUP_FRAMES + 60, 30)).toEqual([]);
    expect(ctrl.dpr).toBe(2);
  });

  it('plafond de pixels non entier : paliers au quart, puis le plafond exact', () => {
    const ctrl = createAdaptiveDpr({ max: 1.83 });
    expect(feed(ctrl, WARMUP_FRAMES + DOWN_WINDOW_FRAMES, 30)).toEqual([1.5]);
    const ups = feed(ctrl, WARMUP_FRAMES + Math.ceil(RAISE_COOLDOWN_MS / 16.7) + upFrames(16.7) * 6, 16.7, 1);
    expect(ups).toEqual([1.75, 1.83]);
  });

  it('setMax : suit le plafond tant qu’aucune baisse n’a eu lieu, sinon ramène sous le plafond', () => {
    const ctrl = createAdaptiveDpr({ max: 2 });
    expect(ctrl.setMax(1.6)).toBe(1.6);
    expect(ctrl.setMax(2)).toBe(2);
    feed(ctrl, WARMUP_FRAMES + DOWN_WINDOW_FRAMES, 30); // 1,75
    expect(ctrl.setMax(2.5)).toBe(1.75);
    expect(ctrl.setMax(1.2)).toBe(1.2);
    expect(ctrl.max).toBe(1.2);
  });

  it('refuse un plafond invalide', () => {
    expect(() => createAdaptiveDpr({ max: 0 })).toThrow(RangeError);
    expect(() => createAdaptiveDpr(/** @type {any} */ ({}))).toThrow(RangeError);
  });
});
