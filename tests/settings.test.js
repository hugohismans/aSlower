// Tests du réglage de la vitesse de la lumière : physicsFor (src/physics/constants.js) et
// src/game/settings.js (lecture d'une saisie, ?c=, stockage `aslower:v1:reglages`).
import { describe, expect, it } from 'vitest';
import {
  A,
  C,
  C_DEFAULT,
  C_MAX,
  C_MIN,
  DEFAULT_PHYSICS,
  LENGTH_UNIT,
  STORAGE_PREFIX,
  TIME_UNIT,
  physicsFor,
} from '../src/physics/constants.js';
import {
  LIGHT_SPEED_PRESETS,
  SETTINGS_KEY,
  initialLightSpeed,
  isValidLightSpeed,
  loadSettings,
  parseLightSpeed,
  saveSettings,
} from '../src/game/settings.js';
import { createSafeStore } from '../src/storage.js';

/** Stockage sûr au-dessus d'un faux Storage (Map), dont on peut lire les clés écrites. */
function fakeStore() {
  const map = new Map();
  const backend = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
  return { map, store: createSafeStore(() => backend) };
}

describe('physicsFor', () => {
  it('plage 10–100 m/s, défaut 30, c/a = 10 s', () => {
    expect([C_MIN, C_DEFAULT, C_MAX, TIME_UNIT]).toEqual([10, 30, 100, 10]);
    expect(DEFAULT_PHYSICS).toEqual({ c: 30, a: 3, lengthUnit: 300 });
    expect([C, A, LENGTH_UNIT]).toEqual([30, 3, 300]);
  });

  it('a = c/10 et L = c²/a = 10·c pour chaque entier de la plage', () => {
    for (let c = C_MIN; c <= C_MAX; c++) {
      const p = physicsFor(c);
      expect(p.c).toBe(c);
      expect(p.a).toBe(c / 10);
      expect(p.lengthUnit).toBe(10 * c);
      expect(p.c / p.a).toBeCloseTo(TIME_UNIT, 12);
      expect((p.c * p.c) / p.a).toBeCloseTo(p.lengthUnit, 9);
      expect(Object.isFrozen(p)).toBe(true);
    }
    expect(physicsFor(100)).toEqual({ c: 100, a: 10, lengthUnit: 1000 }); // cahier des charges
  });

  it('refuse un c hors plage ou non entier (RangeError)', () => {
    for (const bad of [9, 101, 0, -30, 30.5, NaN, Infinity, '30', null, undefined]) {
      expect(() => physicsFor(/** @type {any} */ (bad)), String(bad)).toThrow(RangeError);
    }
  });
});

describe('parseLightSpeed', () => {
  it('accepte un entier de la plage (texte ou nombre, espaces tolérés)', () => {
    expect(parseLightSpeed('30')).toEqual({ c: 30, message: '' });
    expect(parseLightSpeed(' 57 ')).toEqual({ c: 57, message: '' });
    expect(parseLightSpeed(100)).toEqual({ c: 100, message: '' });
    expect(parseLightSpeed('10')).toEqual({ c: 10, message: '' });
  });

  it('ramène un entier hors plage dans la plage, avec un message', () => {
    const low = parseLightSpeed('3');
    expect(low.c).toBe(10);
    expect(low.message).toMatch(/ramenée à 10/);
    const high = parseLightSpeed(300);
    expect(high.c).toBe(100);
    expect(high.message).toMatch(/ramenée à 100/);
  });

  it('refuse une valeur non entière ou illisible, avec un message', () => {
    for (const bad of ['30,5', '12.25', 'abc', '', '   ', null, undefined, NaN]) {
      const res = parseLightSpeed(bad);
      expect(res.c, String(bad)).toBeNull();
      expect(res.message.length).toBeGreaterThan(0);
    }
  });

  it('isValidLightSpeed et préréglages', () => {
    expect(LIGHT_SPEED_PRESETS).toEqual([10, 30, 50, 100]);
    for (const p of LIGHT_SPEED_PRESETS) expect(isValidLightSpeed(p)).toBe(true);
    expect(isValidLightSpeed(9)).toBe(false);
    expect(isValidLightSpeed(30.5)).toBe(false);
  });
});

describe('stockage du réglage (aslower:v1:reglages → {c})', () => {
  it('mémorise et relit c sous la clé préfixée', () => {
    const { map, store } = fakeStore();
    expect(loadSettings(store)).toEqual({ c: C_DEFAULT }); // rien de mémorisé
    expect(saveSettings({ c: 57 }, store)).toBe(true);
    expect([...map.keys()]).toEqual([`${STORAGE_PREFIX}${SETTINGS_KEY}`]);
    expect(SETTINGS_KEY).toBe('reglages');
    expect(JSON.parse(map.get('aslower:v1:reglages'))).toEqual({ c: 57 });
    expect(loadSettings(store)).toEqual({ c: 57 });
  });

  it('valeur mémorisée abîmée ou hors plage : réglage par défaut ; écriture invalide refusée', () => {
    const { map, store } = fakeStore();
    for (const text of ['{"c": 7}', '{"c": 30.5}', '"30"', 'pas du JSON', '{}', 'null']) {
      map.set('aslower:v1:reglages', text);
      expect(loadSettings(store), text).toEqual({ c: C_DEFAULT });
    }
    expect(() => saveSettings({ c: 5 }, store)).toThrow(RangeError);
  });

  it('?c= est prioritaire et jamais mémorisé ; ?c= refusé retombe sur le réglage', () => {
    const { map, store } = fakeStore();
    saveSettings({ c: 50 }, store);
    expect(initialLightSpeed('', store)).toEqual({ c: 50, source: 'reglage', message: '' });
    expect(initialLightSpeed('?c=100&bench', store)).toEqual({ c: 100, source: 'url', message: '' });
    const clamped = initialLightSpeed('?c=500', store);
    expect(clamped.c).toBe(100);
    expect(clamped.source).toBe('url');
    expect(clamped.message).toMatch(/ramenée/);
    const refused = initialLightSpeed('?c=vite', store);
    expect(refused.c).toBe(50);
    expect(refused.source).toBe('reglage');
    expect(refused.message).toMatch(/ignoré/);
    expect(JSON.parse(map.get('aslower:v1:reglages'))).toEqual({ c: 50 }); // inchangé
  });
});
