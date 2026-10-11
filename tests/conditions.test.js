// Tests de src/game/conditions.js : langage des déclencheurs (sans eval), « pendant » en temps
// propre, événements, « apres », validation avec messages précis.
import { describe, expect, it } from 'vitest';
import {
  EVENTS,
  MAX_DEPTH,
  OPERATORS,
  VARIABLES,
  compileCondition,
  conditionReferences,
  evaluateCondition,
  validateCondition,
} from '../src/game/conditions.js';

const ctx = (vars, extra = {}) => ({ vars, ...extra });

describe('comparaisons', () => {
  it('six opérateurs sur les nombres', () => {
    const at = (op, val, beta = 0.2) => evaluateCondition({ var: 'beta', op, val }, ctx({ beta }));
    expect(OPERATORS).toEqual(['<', '<=', '==', '!=', '>', '>=']);
    expect(at('>', 0.15)).toBe(true);
    expect(at('>', 0.2)).toBe(false);
    expect(at('>=', 0.2)).toBe(true);
    expect(at('<', 0.2)).toBe(false);
    expect(at('<=', 0.2)).toBe(true);
    expect(at('==', 0.2)).toBe(true);
    expect(at('!=', 0.2)).toBe(false);
    expect(at('!=', 0.3)).toBe(true);
  });

  it('booléens (forme courte) et textes', () => {
    expect(evaluateCondition({ var: 'relache' }, ctx({ relache: true }))).toBe(true);
    expect(evaluateCondition({ var: 'relache' }, ctx({ relache: false }))).toBe(false);
    expect(evaluateCondition({ var: 'relache', op: '==', val: false }, ctx({ relache: false }))).toBe(true);
    expect(evaluateCondition({ var: 'modeVolant', op: '==', val: 'tilt' }, ctx({ modeVolant: 'tilt' }))).toBe(true);
    expect(evaluateCondition({ var: 'modeVolant', op: '!=', val: 'tilt' }, ctx({ modeVolant: 'drag' }))).toBe(true);
  });

  it('variable absente, NaN ou d’un autre type : toujours faux (même avec !=)', () => {
    expect(evaluateCondition({ var: 'beta', op: '>', val: 0 }, ctx({}))).toBe(false);
    expect(evaluateCondition({ var: 'beta', op: '!=', val: 0 }, ctx({}))).toBe(false);
    expect(evaluateCondition({ var: 'beta', op: '<', val: 1 }, ctx({ beta: NaN }))).toBe(false);
    expect(evaluateCondition({ var: 'beta', op: '<', val: 1 }, ctx({ beta: '0.5' }))).toBe(false);
    expect(evaluateCondition({ var: 'relache' }, ctx({ relache: 1 }))).toBe(false);
    expect(evaluateCondition({ var: 'beta', op: '>', val: 0 }, null)).toBe(false);
  });

  it('Infinity se compare (margeFreinage à l’arrêt)', () => {
    expect(evaluateCondition({ var: 'margeFreinage', op: '<', val: 2 }, ctx({ margeFreinage: Infinity }))).toBe(false);
    expect(evaluateCondition({ var: 'margeFreinage', op: '>', val: 2 }, ctx({ margeFreinage: Infinity }))).toBe(true);
  });
});

describe('combinateurs', () => {
  const vars = { beta: 0.5, relache: true, freine: false };
  it('tous, un, non', () => {
    const yes = { var: 'relache' };
    const no = { var: 'freine' };
    expect(evaluateCondition({ tous: [yes, { var: 'beta', op: '>', val: 0.4 }] }, ctx(vars))).toBe(true);
    expect(evaluateCondition({ tous: [yes, no] }, ctx(vars))).toBe(false);
    expect(evaluateCondition({ un: [no, yes] }, ctx(vars))).toBe(true);
    expect(evaluateCondition({ un: [no, no] }, ctx(vars))).toBe(false);
    expect(evaluateCondition({ non: no }, ctx(vars))).toBe(true);
    expect(evaluateCondition({ non: { tous: [yes, { non: no }] } }, ctx(vars))).toBe(false);
  });

  it('evenement : vrai si signalé depuis l’évaluation précédente', () => {
    const cond = { evenement: 'butee' };
    expect(evaluateCondition(cond, ctx({}, { events: new Set(['butee']) }))).toBe(true);
    expect(evaluateCondition(cond, ctx({}, { events: new Set(['frein']) }))).toBe(false);
    expect(evaluateCondition(cond, ctx({}))).toBe(false);
  });

  it('apres : vrai si la bulle a déjà été montrée', () => {
    const cond = { apres: 'doppler' };
    expect(evaluateCondition(cond, ctx({}, { seen: (id) => id === 'doppler' }))).toBe(true);
    expect(evaluateCondition(cond, ctx({}, { seen: () => false }))).toBe(false);
    expect(evaluateCondition(cond, ctx({}))).toBe(false);
  });
});

describe('pendant (temps propre)', () => {
  const cond = { pendant: { cond: { var: 'beta', op: '>', val: 0.15 }, s: 1 } };

  it('vrai après s secondes continues de dt, compté à partir de la première évaluation vraie', () => {
    const c = compileCondition(cond);
    expect(c.evaluate(ctx({ beta: 0.2 }), 0.2)).toBe(false); // départ du chronomètre (0 s)
    for (let i = 0; i < 4; i += 1) expect(c.evaluate(ctx({ beta: 0.2 }), 0.2)).toBe(false); // 0,8 s
    expect(c.evaluate(ctx({ beta: 0.2 }), 0.2)).toBe(true); // 1,0 s
    expect(c.evaluate(ctx({ beta: 0.2 }), 0.2)).toBe(true);
  });

  it('une interruption remet le chronomètre à zéro ; reset() aussi', () => {
    const c = compileCondition(cond);
    c.evaluate(ctx({ beta: 0.2 }), 0);
    c.evaluate(ctx({ beta: 0.2 }), 0.9);
    expect(c.evaluate(ctx({ beta: 0.1 }), 0.05)).toBe(false);
    c.evaluate(ctx({ beta: 0.2 }), 0.2);
    expect(c.evaluate(ctx({ beta: 0.2 }), 0.9)).toBe(false);
    expect(c.evaluate(ctx({ beta: 0.2 }), 0.1)).toBe(true);
    c.reset();
    expect(c.evaluate(ctx({ beta: 0.2 }), 5)).toBe(false); // repart de 0
    expect(c.evaluate(ctx({ beta: 0.2 }), 5)).toBe(true);
  });

  it('s = 0 : vrai dès la première évaluation vraie ; dt négatif ou NaN ignoré', () => {
    expect(evaluateCondition({ pendant: { cond: { var: 'relache' }, s: 0 } }, ctx({ relache: true }))).toBe(true);
    const c = compileCondition(cond);
    c.evaluate(ctx({ beta: 0.2 }), 0);
    expect(c.evaluate(ctx({ beta: 0.2 }), -5)).toBe(false);
    expect(c.evaluate(ctx({ beta: 0.2 }), NaN)).toBe(false);
  });

  it('pas de court-circuit : le chronomètre d’une branche tourne même si sa voisine est fausse', () => {
    const c = compileCondition({ tous: [{ var: 'relache' }, cond] });
    c.evaluate(ctx({ relache: false, beta: 0.2 }), 0);
    c.evaluate(ctx({ relache: false, beta: 0.2 }), 0.6);
    expect(c.evaluate(ctx({ relache: false, beta: 0.2 }), 0.6)).toBe(false);
    expect(c.evaluate(ctx({ relache: true, beta: 0.2 }), 0.1)).toBe(true); // 1,3 s de β > 0,15
    const u = compileCondition({ un: [{ var: 'relache' }, cond] });
    u.evaluate(ctx({ relache: true, beta: 0.2 }), 0);
    u.evaluate(ctx({ relache: true, beta: 0.2 }), 1);
    expect(u.evaluate(ctx({ relache: false, beta: 0.2 }), 0.1)).toBe(true);
  });

  it('chaque pendant a son propre chronomètre', () => {
    const c = compileCondition({
      tous: [
        { pendant: { cond: { var: 'beta', op: '>', val: 0.1 }, s: 1 } },
        { pendant: { cond: { var: 'relache' }, s: 2 } },
      ],
    });
    c.evaluate(ctx({ beta: 0.2, relache: false }), 0);
    c.evaluate(ctx({ beta: 0.2, relache: true }), 1);
    expect(c.evaluate(ctx({ beta: 0.2, relache: true }), 1)).toBe(false); // relâché depuis 1 s
    expect(c.evaluate(ctx({ beta: 0.2, relache: true }), 1)).toBe(true);
  });
});

describe('validation', () => {
  const errorsOf = (cond, options) => validateCondition(cond, options);
  const one = (cond, pattern, options) => {
    const errors = errorsOf(cond, options);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(pattern);
  };

  it('accepte les conditions correctes', () => {
    expect(
      errorsOf({
        tous: [
          { pendant: { cond: { var: 'beta', op: '>', val: 0.15 }, s: 1 } },
          { var: 'facadeDevant' },
          { un: [{ evenement: 'butee' }, { non: { var: 'freine' } }] },
          { var: 'modeVolant', op: '==', val: 'clavier' },
          { apres: 'doppler' },
        ],
      }),
    ).toEqual([]);
  });

  it('messages avec le chemin JSON', () => {
    one({ var: 'beta', op: '=>', val: 0.1 }, /^quand\.op : opérateur « => » inconnu \(attendus : <, <=, ==, !=, >, >=\)$/);
    const two = errorsOf({ tous: [{ var: 'beta' }, { var: 'vitesse', op: '>', val: 3 }] });
    expect(two).toHaveLength(2);
    expect(two[0]).toMatch(/^quand\.tous\[0\] : « beta » n'est pas booléenne/);
    expect(two[1]).toMatch(/^quand\.tous\[1\]\.var : variable « vitesse » inconnue/);
    one({ var: 'beta', op: '>', val: '0.1' }, /quand\.op : « > » ne compare que des nombres/);
    one({ var: 'beta', op: '==', val: true }, /quand\.val : « beta » est de type nombre, reçu true/);
    one({ var: 'modeVolant', op: '==', val: 'souris' }, /n'est pas une valeur de « modeVolant » \(permises : tilt, drag, clavier\)/);
    one({ var: 'beta', op: '>' }, /val manquant/);
    one({ var: 'beta', op: '>', val: Infinity }, /nombre fini attendu/);
    one({ var: 'beta', op: '>', val: 0.1, unite: 'c' }, /clé inconnue « unite » dans une comparaison/);
    one({ tous: [] }, /quand\.tous : liste non vide/);
    one({ un: 'beta' }, /quand\.un : liste non vide/);
    one({ tous: [{ var: 'relache' }], un: [{ var: 'relache' }] }, /une seule clé par condition, reçu « tous, un »/);
    one({ quand: true }, /clé inconnue « quand »/);
    one({}, /condition vide/);
    one(null, /une condition doit être un objet JSON, reçu null/);
    one([{ var: 'relache' }], /une condition doit être un objet JSON/);
    one('beta > 0.1', /une condition doit être un objet JSON/);
  });

  it('pendant, evenement, apres', () => {
    one({ pendant: { cond: { var: 'relache' } } }, /quand\.pendant\.s : durée en secondes/);
    one({ pendant: { cond: { var: 'relache' }, s: -1 } }, /quand\.pendant\.s/);
    one({ pendant: { s: 1 } }, /quand\.pendant\.cond : condition manquante/);
    one({ pendant: { cond: { var: 'relache' }, s: 1, ms: 3 } }, /clé inconnue « ms »/);
    one({ pendant: { cond: { var: 'x' }, s: 1 } }, /quand\.pendant\.cond\.var : variable « x » inconnue/);
    one({ evenement: 'explosion' }, /événement « explosion » inconnu \(connus : depart, /);
    one({ evenement: 3 }, /nom d'événement attendu/);
    one({ apres: 'nulle-part' }, /quand\.apres : bulle « nulle-part » inconnue/, { bubbleIds: ['doppler'] });
    expect(errorsOf({ apres: 'nulle-part' })).toEqual([]); // ids non vérifiés sans liste
  });

  it('noms libres si les tables sont null ; chemin personnalisé', () => {
    expect(errorsOf({ var: 'vitesse', op: '>', val: 3 }, { variables: null })).toEqual([]);
    expect(errorsOf({ evenement: 'explosion' }, { events: null })).toEqual([]);
    expect(errorsOf({ var: 'beta', op: '~', val: 1 }, { path: 'bulles[2].quand' })[0]).toMatch(/^bulles\[2\]\.quand\.op/);
  });

  it('profondeur bornée', () => {
    let deep = { var: 'relache' };
    for (let i = 0; i <= MAX_DEPTH; i += 1) deep = { non: deep };
    expect(errorsOf(deep).join('\n')).toMatch(/trop imbriquée/);
  });

  it('compileCondition refuse une condition invalide avec tous les messages', () => {
    expect(() => compileCondition({ tous: [{ var: 'beta', op: '=>', val: 1 }, { evenement: 'x' }] })).toThrow(
      /Condition invalide :\n- quand\.tous\[0\]\.op .*\n- quand\.tous\[1\]\.evenement/,
    );
  });

  it('jamais d’eval : une chaîne de code n’est pas une condition', () => {
    expect(() => compileCondition('globalThis.pwned = true')).toThrow(/objet JSON/);
    expect(globalThis.pwned).toBeUndefined();
  });
});

describe('tables de référence', () => {
  it('chaque variable a un type, une description et un calcul ; les valeurs de texte sont listées', () => {
    for (const [name, spec] of Object.entries(VARIABLES)) {
      expect(['number', 'boolean', 'string'], name).toContain(spec.type);
      expect(spec.description.length, name).toBeGreaterThan(5);
      expect(spec.calcul.length, name).toBeGreaterThan(2);
      if (spec.type === 'string') expect(spec.valeurs?.length, name).toBeGreaterThan(0);
    }
    for (const name of ['beta', 'gamma', 'speed', 'c', 'tau', 't', 'ecart', 'depuisDebut', 'k', 'relache', 'freine',
      'accelere', 'distanceFreinage', 'regardArriere', 'facadeDevant', 'modeVolant']) {
      expect(VARIABLES).toHaveProperty(name);
    }
    expect(Object.keys(EVENTS)).toEqual(expect.arrayContaining(['depart', 'relache', 'frein', 'butee']));
  });

  it('conditionReferences', () => {
    const refs = conditionReferences({
      tous: [{ var: 'beta', op: '>', val: 0 }, { pendant: { cond: { var: 'relache' }, s: 1 } }, { un: [{ evenement: 'frein' }, { non: { apres: 'doppler' } }] }],
    });
    expect([...refs.variables]).toEqual(['beta', 'relache']);
    expect([...refs.events]).toEqual(['frein']);
    expect([...refs.bubbles]).toEqual(['doppler']);
  });
});
