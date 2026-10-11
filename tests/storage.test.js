// Tests de src/storage.js : préfixe, valeurs JSON, repli en mémoire (stockage absent ou qui lève).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_PREFIX } from '../src/physics/constants.js';
import { createSafeStore, local, session } from '../src/storage.js';

/** Faux Storage du navigateur (Map), qui enregistre les clés écrites. */
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

/** Faux Storage dont chaque méthode lève (stockage bloqué). */
function throwingStorage() {
  const fail = () => {
    throw new Error('SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('préfixe', () => {
  it('préfixe chaque clé par STORAGE_PREFIX', () => {
    const backend = fakeStorage();
    const store = createSafeStore(() => backend);
    store.set('bulles', { doppler: 1 });
    expect([...backend.map.keys()]).toEqual([`${STORAGE_PREFIX}bulles`]);
    expect(STORAGE_PREFIX).toBe('aslower:v1:');
  });

  it('ne lit pas une clé non préfixée (ex. clés hh-* du portfolio)', () => {
    const backend = fakeStorage();
    backend.map.set('hh-motion', '"reduce"');
    expect(createSafeStore(() => backend).get('hh-motion', 'absent')).toBe('absent');
  });

  it('local et session écrivent dans localStorage et sessionStorage', () => {
    const l = fakeStorage();
    const s = fakeStorage();
    vi.stubGlobal('localStorage', l);
    vi.stubGlobal('sessionStorage', s);
    local.set('gl-tier', 'lite');
    session.set('gl-boot', true);
    expect(l.map.get(`${STORAGE_PREFIX}gl-tier`)).toBe('"lite"');
    expect(s.map.get(`${STORAGE_PREFIX}gl-boot`)).toBe('true');
    expect(local.get('gl-tier')).toBe('lite');
    expect(session.get('gl-boot')).toBe(true);
    local.remove('gl-tier');
    expect(l.map.size).toBe(0);
    expect(local.get('gl-tier', 'default')).toBe('default');
  });
});

describe('valeurs JSON', () => {
  it('relit chaque type JSON à l’identique', () => {
    const backend = fakeStorage();
    const store = createSafeStore(() => backend);
    const values = { n: 3.25, s: 'texte', b: false, z: null, a: [1, 'deux', { trois: 3 }], o: { x: 1, y: [2] } };
    for (const [k, v] of Object.entries(values)) {
      expect(store.set(k, v)).toBe(true);
      expect(store.get(k, 'défaut')).toEqual(v);
    }
  });

  it('rend le défaut pour une clé absente ou une valeur abîmée', () => {
    const backend = fakeStorage();
    const store = createSafeStore(() => backend);
    expect(store.get('absente', 42)).toBe(42);
    expect(store.get('absente')).toBe(null);
    backend.map.set(`${STORAGE_PREFIX}abimee`, '{pas du JSON');
    expect(store.get('abimee', 'défaut')).toBe('défaut');
  });

  it('écrire undefined efface la clé ; une valeur cyclique est refusée', () => {
    const backend = fakeStorage();
    const store = createSafeStore(() => backend);
    store.set('k', 1);
    store.set('k', undefined);
    expect(backend.map.size).toBe(0);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(store.set('c', cyclic)).toBe(false);
    expect(store.get('c', 'aucune')).toBe('aucune');
  });
});

describe('repli en mémoire', () => {
  it('fonctionne sans localStorage (Node, iframe sandbox)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(local.set('reglages', { mode: 'drag' })).toBe(false);
    expect(local.get('reglages')).toEqual({ mode: 'drag' });
    local.remove('reglages');
    expect(local.get('reglages', 'aucun')).toBe('aucun');
  });

  it('fonctionne quand l’accès à localStorage lève (cookies bloqués)', () => {
    const store = createSafeStore(() => {
      throw new Error('SecurityError');
    });
    expect(store.set('progression', [1, 2])).toBe(false);
    expect(store.get('progression')).toEqual([1, 2]);
    store.remove('progression');
    expect(store.get('progression', 'vide')).toBe('vide');
  });

  it('fonctionne quand chaque méthode du stockage lève', () => {
    const store = createSafeStore(() => throwingStorage());
    expect(store.set('bulles', { a: 1 })).toBe(false);
    expect(store.get('bulles')).toEqual({ a: 1 });
    expect(() => store.remove('bulles')).not.toThrow();
    expect(store.get('bulles', 'vide')).toBe('vide');
  });

  it('garde en mémoire une écriture refusée (quota) et la préfère à l’ancienne valeur', () => {
    const backend = fakeStorage();
    const store = createSafeStore(() => backend);
    store.set('score', 1);
    backend.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(store.set('score', 2)).toBe(false);
    expect(backend.map.get(`${STORAGE_PREFIX}score`)).toBe('1'); // ancienne valeur sur disque
    expect(store.get('score')).toBe(2); // la plus récente gagne
  });

  it('les méthodes restent utilisables détachées de l’objet', () => {
    const backend = fakeStorage();
    const { get, set, remove } = createSafeStore(() => backend);
    set('k', 'v');
    expect(get('k')).toBe('v');
    remove('k');
    expect(get('k', 'x')).toBe('x');
  });
});
