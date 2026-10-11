// Tests de src/game/bubbles.js (moteur « une seule fois », textes, variables du jeu) et de
// src/data/bubbles.json (validation, longueur des textes, conditions en β).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BUBBLES_KEY,
  BUBBLES_SCHEMA,
  DEFAULT_DURATION_S,
  MAX_QUEUE,
  MAX_TEXT_LENGTH,
  MIN_GAP_MS,
  QUEUE_TTL_MS,
  chooseText,
  createBubbleEngine,
  createBubbleVariables,
  createMemoryStore,
  facadeAhead,
  formatNumberFr,
  interpolate,
  validateBubbles,
} from '../src/game/bubbles.js';
import { VARIABLES, conditionReferences } from '../src/game/conditions.js';
import { physicsFor } from '../src/physics/constants.js';
import { createPlayer, snapshot, step } from '../src/physics/player.js';
import { createSafeStore } from '../src/storage.js';
import bubblesJson from '../src/data/bubbles.json';

/** Espaces insécables → espaces ordinaires, pour lire les attentes. */
const plain = (s) => s.replace(/[  ]/g, ' ');

/** Stockage sûr au-dessus d'un faux localStorage (Map), dont on peut lire les clés. */
function fakeStore() {
  const map = new Map();
  const backend = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
  return { map, store: createSafeStore(() => backend) };
}

/**
 * Moteur avec horloge simulée : `run(vars, seconds)` avance par pas de 1/60 s (temps propre
 * = temps réel de jeu, comme dans main.js) et note les apparitions.
 */
function harness(bulles, { store = createMemoryStore() } = {}) {
  const clock = { ms: 0 };
  const engine = createBubbleEngine({ definitions: { schema: BUBBLES_SCHEMA, bulles }, store, now: () => clock.ms });
  const shown = [];
  const events = [];
  engine.onShow((b) => {
    events.push(b);
    if (b) shown.push({ ...b, atMs: clock.ms });
  });
  const run = (vars, seconds, dt = 1 / 60) => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i += 1) {
      clock.ms += dt * 1000;
      engine.update(typeof vars === 'function' ? vars(clock.ms) : vars, dt);
    }
  };
  return { engine, clock, shown, events, run, store };
}

const when = (cond) => cond;
const beta = (op, val) => ({ var: 'beta', op, val });

describe('textes', () => {
  it('formatNumberFr : virgule, 1 décimale tronquée, milliers, signe moins', () => {
    expect(formatNumberFr(1.5)).toBe('1,5');
    expect(formatNumberFr(2)).toBe('2,0');
    expect(formatNumberFr(1.99)).toBe('1,9'); // jamais arrondi vers le haut
    expect(formatNumberFr(0.3)).toBe('0,3'); // 0,3 × 10 = 2,9999999999999996
    expect(formatNumberFr(0)).toBe('0,0');
    expect(formatNumberFr(-3.25)).toBe('−3,2');
    expect(plain(formatNumberFr(1234.56))).toBe('1 234,5');
    expect(formatNumberFr(30, 0)).toBe('30');
    expect(formatNumberFr(NaN)).toBe('—');
    expect(formatNumberFr(Infinity)).toBe('—');
    expect(formatNumberFr(undefined)).toBe('—');
  });

  it('interpolate : {gamma}, {ecart} à 1 décimale, {c} entier, variable absente', () => {
    const vars = { gamma: 2.537, ecart: 3.14159, c: 30 };
    expect(interpolate('La ville va ×{gamma} plus vite que toi', vars)).toBe('La ville va ×2,5 plus vite que toi');
    expect(interpolate('{ecart} s de plus, c = {c} m/s', vars)).toBe('3,1 s de plus, c = 30 m/s');
    expect(interpolate('{vitessePropre} m', {})).toBe('— m');
    expect(interpolate('sans variable', vars)).toBe('sans variable');
  });

  it('chooseText : variante du mode de direction, sinon texte', () => {
    const def = { texte: 'T', texteDesktop: 'K', texteTilt: 'I', texteDrag: 'G' };
    expect(chooseText(def, 'clavier')).toBe('K');
    expect(chooseText(def, 'tilt')).toBe('I');
    expect(chooseText(def, 'drag')).toBe('G');
    expect(chooseText(def, undefined)).toBe('T');
    expect(chooseText({ texte: 'T' }, 'clavier')).toBe('T');
    expect(chooseText({ texte: 'T' }, 'tilt')).toBe('T');
  });
});

describe('moteur : une seule fois', () => {
  it('montre une bulle quand sa condition est vraie, 5 s, puis plus jamais', () => {
    const h = harness([{ id: 'a', texte: 'A', quand: beta('>', 0.1) }]);
    h.run({ beta: 0.05 }, 2);
    expect(h.shown).toHaveLength(0);
    h.run({ beta: 0.2 }, 0.1);
    expect(h.engine.current()).toEqual({ id: 'a', text: 'A', blocking: false, durationMs: DEFAULT_DURATION_S * 1000 });
    expect(h.engine.seen('a')).toBe(true);
    h.run({ beta: 0.2 }, 4.8);
    expect(h.engine.current()?.id).toBe('a');
    h.run({ beta: 0.2 }, 0.3);
    expect(h.engine.current()).toBeNull();
    expect(h.events.at(-1)).toBeNull(); // abonnés prévenus de la disparition
    h.run({ beta: 0.2 }, 60);
    expect(h.shown.map((b) => b.id)).toEqual(['a']);
  });

  it('mémorise les bulles vues dans le stockage (aslower:v1:bulles) et les relit', () => {
    const { map, store } = fakeStore();
    const defs = [
      { id: 'a', texte: 'A', quand: beta('>', 0.1) },
      { id: 'b', texte: 'B', quand: beta('>', 0.5) },
    ];
    const first = harness(defs, { store });
    first.run({ beta: 0.2 }, 1);
    expect(JSON.parse(map.get(`aslower:v1:${BUBBLES_KEY}`))).toEqual({ vues: ['a'] });

    const second = harness(defs, { store }); // nouvelle page, même profil
    expect(second.engine.seen('a')).toBe(true);
    second.run({ beta: 0.9 }, 20);
    expect(second.shown.map((b) => b.id)).toEqual(['b']);
    expect(JSON.parse(map.get('aslower:v1:bulles')).vues.sort()).toEqual(['a', 'b']);
  });

  it('valeur stockée abîmée ou d’un autre format : aucune bulle vue ; liste nue acceptée', () => {
    const defs = [{ id: 'a', texte: 'A', quand: beta('>', 0.1) }];
    for (const raw of ['{abîmé', '42', '{"vues": "a"}', 'null']) {
      const { map, store } = fakeStore();
      map.set('aslower:v1:bulles', raw);
      expect(harness(defs, { store }).engine.seen('a')).toBe(false);
    }
    const { map, store } = fakeStore();
    map.set('aslower:v1:bulles', '["a", 3]');
    expect(harness(defs, { store }).engine.seen('a')).toBe(true);
  });

  it('stockage qui lève : le jeu continue (mémoire de la page)', () => {
    const broken = { get: () => { throw new Error('x'); }, set: () => { throw new Error('x'); }, remove: () => { throw new Error('x'); } };
    const h = harness([{ id: 'a', texte: 'A', quand: beta('>', 0.1) }], { store: broken });
    h.run({ beta: 0.2 }, 1);
    expect(h.engine.seen('a')).toBe(true);
    expect(() => h.engine.reset()).not.toThrow();
  });
});

describe('moteur : rythme, file, fermeture', () => {
  const three = [
    { id: 'a', texte: 'A', quand: beta('>', 0.1) },
    { id: 'b', texte: 'B', quand: beta('>', 0.1) },
    { id: 'c', texte: 'C', quand: beta('>', 0.1) },
  ];

  it('une seule bulle visible et au moins 8 s entre deux apparitions', () => {
    const h = harness(three);
    h.run({ beta: 0.2 }, 30);
    expect(h.shown.map((b) => b.id)).toEqual(['a', 'b', 'c']);
    for (let i = 1; i < h.shown.length; i += 1) {
      expect(h.shown[i].atMs - h.shown[i - 1].atMs).toBeGreaterThanOrEqual(MIN_GAP_MS);
      expect(h.shown[i].atMs - h.shown[i - 1].atMs).toBeLessThan(MIN_GAP_MS + 300);
    }
    // Jamais deux bulles à la fois : apparitions et disparitions alternent.
    const kinds = h.events.map((b) => (b ? 'show' : 'hide'));
    expect(kinds).toEqual(['show', 'hide', 'show', 'hide', 'show', 'hide']);
  });

  it('file de 2 au plus : les bulles en trop sont oubliées, non vues', () => {
    const defs = ['a', 'b', 'c', 'd'].map((id) => ({ id, texte: id, quand: { evenement: 'depart' } }));
    const h = harness(defs);
    h.engine.emit('depart'); // un seul déclenchement, pour toutes
    h.run({}, 40);
    expect(MAX_QUEUE).toBe(2);
    expect(h.shown.map((b) => b.id)).toEqual(['a', 'b', 'c']); // a visible, b et c en file, d oubliée
    expect(h.engine.seen('d')).toBe(false);
  });

  it('priorité : une bulle prioritaire passe devant et chasse la plus faible', () => {
    const defs = [
      ...['a', 'b', 'c'].map((id) => ({ id, texte: id, quand: { evenement: 'depart' } })),
      { id: 'urgent', texte: 'U', priorite: 2, quand: { evenement: 'depart' } },
    ];
    const h = harness(defs);
    h.engine.emit('depart');
    h.run({}, 40);
    expect(h.shown.map((b) => b.id)).toEqual(['urgent', 'a', 'b']);
  });

  it('une bulle qui attend plus de 20 s est oubliée, puis peut revenir', () => {
    const defs = [
      { id: 'a', texte: 'A', bloquante: true, quand: beta('>', 0.1) },
      { id: 'b', texte: 'B', quand: { evenement: 'frein' } },
      { id: 'c', texte: 'C', quand: { var: 'relache' } },
    ];
    const h = harness(defs);
    h.run({ beta: 0.2 }, 0.5); // a, bloquante, reste affichée
    h.engine.emit('frein');
    h.run({ beta: 0.2, relache: true }, QUEUE_TTL_MS / 1000 + 1);
    h.engine.dismiss();
    h.run({ beta: 0.2, relache: true }, 30);
    // b (événement unique) a expiré dans la file ; c (condition durable) est revenue.
    expect(h.shown.map((x) => x.id)).toEqual(['a', 'c']);
    expect(h.engine.seen('b')).toBe(false);
  });

  it('toucher pour fermer : dismiss, puis 8 s depuis l’apparition précédente', () => {
    const h = harness(three);
    h.run({ beta: 0.2 }, 1);
    expect(h.engine.dismiss()).toBe(true);
    expect(h.engine.current()).toBeNull();
    expect(h.events.at(-1)).toBeNull();
    expect(h.engine.dismiss()).toBe(false);
    h.run({ beta: 0.2 }, 6.5);
    expect(h.shown).toHaveLength(1);
    h.run({ beta: 0.2 }, 1);
    expect(h.shown.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('bulle bloquante : reste jusqu’au toucher, puis 1 s de vide au moins', () => {
    const h = harness([
      { id: 'tuto', texte: 'Tuto', bloquante: true, quand: beta('>', 0.1) },
      { id: 'b', texte: 'B', quand: beta('>', 0.1) },
    ]);
    h.run({ beta: 0.2 }, 20);
    expect(h.engine.current()).toMatchObject({ id: 'tuto', blocking: true });
    h.engine.dismiss();
    h.run({ beta: 0.2 }, 0.9);
    expect(h.engine.current()).toBeNull();
    h.run({ beta: 0.2 }, 0.3);
    expect(h.engine.current()?.id).toBe('b');
  });

  it('durée propre à une bulle (duree)', () => {
    const h = harness([{ id: 'a', texte: 'A', duree: 2, quand: beta('>', 0.1) }]);
    h.run({ beta: 0.2 }, 1.9);
    expect(h.engine.current()?.durationMs).toBe(2000);
    h.run({ beta: 0.2 }, 0.3);
    expect(h.engine.current()).toBeNull();
  });
});

describe('moteur : évaluation', () => {
  it('5 Hz au plus ; « pendant » mesuré avec le dt cumulé (temps propre)', () => {
    const h = harness([{ id: 'a', texte: 'A', quand: { pendant: { cond: beta('>', 0.1), s: 1 } } }]);
    const evaluate = vi.spyOn(h.engine, 'update');
    h.run({ beta: 0.2 }, 0.99);
    expect(h.shown).toHaveLength(0);
    h.run({ beta: 0.2 }, 0.25);
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0].atMs).toBeGreaterThanOrEqual(1000);
    expect(h.shown[0].atMs).toBeLessThanOrEqual(1250);
    expect(evaluate).toHaveBeenCalled();
  });

  it('appelé à chaque image (60 i/s), le moteur n’évalue que 5 fois par seconde', () => {
    const h = harness([{ id: 'a', texte: 'A', quand: beta('>', 0.5) }]);
    let reads = 0;
    const vars = {
      get beta() {
        reads += 1;
        return 0.1;
      },
    };
    h.run(vars, 2);
    expect(reads).toBeGreaterThanOrEqual(9);
    expect(reads).toBeLessThanOrEqual(11);
  });

  it('événements de vars.evenements ou de emit, gardés jusqu’à l’évaluation suivante', () => {
    const h = harness([
      { id: 'a', texte: 'A', quand: { evenement: 'butee' } },
      { id: 'b', texte: 'B', quand: { evenement: 'frein' } },
    ]);
    h.run({}, 0.5); // première évaluation faite
    h.engine.update({ evenements: ['butee'] }, 1 / 60); // entre deux évaluations
    h.run({}, 0.3);
    expect(h.shown.map((x) => x.id)).toEqual(['a']);
    h.engine.emit('frein');
    h.run({}, 0.3);
    h.run({}, 10);
    expect(h.shown.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('un événement passé n’est plus vrai à l’évaluation suivante', () => {
    const h = harness([{ id: 'a', texte: 'A', quand: { tous: [{ evenement: 'frein' }, beta('>', 0.5)] } }]);
    h.engine.emit('frein');
    h.run({ beta: 0.1 }, 0.5);
    h.run({ beta: 0.9 }, 2);
    expect(h.shown).toHaveLength(0);
  });

  it('apres : la seconde bulle attend que la première ait été montrée', () => {
    const h = harness([
      { id: 'vision', texte: 'V', quand: { tous: [{ apres: 'doppler' }, beta('>', 0.25)] } },
      { id: 'doppler', texte: 'D', quand: beta('>', 0.15) },
    ]);
    h.run({ beta: 0.3 }, 20);
    expect(h.shown.map((b) => b.id)).toEqual(['doppler', 'vision']);
  });

  it('texte interpolé en français et variante du mode de direction, au moment de l’affichage', () => {
    const defs = [
      {
        id: 'gamma',
        texte: 'La ville va ×{gamma} plus vite que toi (c = {c}, écart {ecart} s).',
        texteDesktop: 'Clavier : ×{gamma}',
        texteTilt: 'Inclinaison : ×{gamma}',
        quand: { var: 'gamma', op: '>=', val: 1.5 },
      },
    ];
    const at = (modeVolant) => {
      const h = harness(defs);
      h.run({ gamma: 1.537, c: 30, ecart: 2.96, modeVolant }, 0.5);
      return h.shown[0].text;
    };
    expect(at('drag')).toBe('La ville va ×1,5 plus vite que toi (c = 30, écart 2,9 s).');
    expect(at('clavier')).toBe('Clavier : ×1,5');
    expect(at('tilt')).toBe('Inclinaison : ×1,5');
  });
});

describe('moteur : reset, clearPending, list, abonnements', () => {
  const defs = [
    { id: 'a', texte: 'A', quand: beta('>', 0.1) },
    { id: 'b', texte: 'B', quand: beta('>', 0.9) },
  ];

  it('reset (« Revoir les bulles ») : oublie tout, stockage compris, et ferme la bulle', () => {
    const { map, store } = fakeStore();
    const h = harness(defs, { store });
    h.run({ beta: 0.2 }, 1);
    expect(h.engine.current()?.id).toBe('a');
    h.engine.reset();
    expect(h.engine.current()).toBeNull();
    expect(h.events.at(-1)).toBeNull();
    expect(h.engine.seen('a')).toBe(false);
    expect(map.has('aslower:v1:bulles')).toBe(false);
    h.run({ beta: 0.2 }, 0.5); // pas d'attente de 8 s après un reset
    expect(h.shown.map((b) => b.id)).toEqual(['a', 'a']);
  });

  it('clearPending (nouvelle partie) : ferme et vide la file, garde les bulles vues', () => {
    const h = harness([...defs, { id: 'c', texte: 'C', quand: beta('>', 0.1) }]);
    h.run({ beta: 0.2 }, 1);
    h.engine.clearPending();
    expect(h.engine.current()).toBeNull();
    expect(h.engine.seen('a')).toBe(true);
    h.run({ beta: 0.2 }, 10);
    expect(h.shown.map((b) => b.id)).toEqual(['a', 'c']);
  });

  it('list : ordre du fichier, état vu, texte par défaut', () => {
    const h = harness(defs);
    h.run({ beta: 0.2 }, 1);
    expect(h.engine.list()).toEqual([
      { id: 'a', seen: true, text: 'A' },
      { id: 'b', seen: false, text: 'B' },
    ]);
  });

  it('désabonnement ; un abonné qui lève n’arrête pas le moteur', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const clock = { ms: 0 };
    const engine = createBubbleEngine({ definitions: defs, now: () => clock.ms }); // liste nue acceptée
    const cb = vi.fn();
    const off = engine.onShow(cb);
    engine.onShow(() => {
      throw new Error('affichage');
    });
    off();
    expect(() => engine.update({ beta: 0.2 }, 0.1)).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
    expect(engine.current()?.id).toBe('a');
    expect(error).toHaveBeenCalled();
  });

  it('définitions invalides : erreur qui liste les problèmes', () => {
    expect(() => createBubbleEngine({ definitions: [{ id: 'A b', texte: '', quand: { var: 'v', op: '>', val: 1 } }] })).toThrow(
      /Bulles invalides :\n- bulles\[0\] \(A b\)\.id : .*\n- bulles\[0\] \(A b\)\.texte : texte non vide.*\n- bulles\[0\] \(A b\)\.quand\.var : variable « v » inconnue/,
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateBubbles', () => {
  const ok = { id: 'ok', texte: 'Texte', quand: beta('>', 0.1) };
  const errorsFor = (bubble) => validateBubbles({ schema: BUBBLES_SCHEMA, bulles: [ok, bubble] });
  const one = (bubble, pattern) => {
    const errors = errorsFor(bubble);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(pattern);
  };

  it('structure générale', () => {
    expect(validateBubbles(null)[0]).toMatch(/objet JSON attendu/);
    expect(validateBubbles({ schema: 'autre', bulles: [ok] })[0]).toMatch(/^schema : « coursier-bulles\/1 » attendu/);
    expect(validateBubbles({ schema: BUBBLES_SCHEMA, bulles: [] })[0]).toMatch(/^bulles : liste non vide/);
    expect(validateBubbles({ schema: BUBBLES_SCHEMA, bulles: [ok], extra: 1 })[0]).toMatch(/^racine : clé inconnue « extra »/);
    expect(validateBubbles({ schema: BUBBLES_SCHEMA, bulles: [ok] })).toEqual([]);
  });

  it('messages précis par bulle', () => {
    one({ ...ok, id: 'ok' }, /^bulles\[1\] \(ok\)\.id : « ok » en double/);
    one({ ...ok, id: 'Vitesse_Propre' }, /^bulles\[1\] \(Vitesse_Propre\)\.id : identifiant kebab-case/);
    one({ id: 'x', quand: ok.quand }, /bulles\[1\] \(x\)\.texte : manquant/);
    one({ id: 'x', texte: 'T' }, /\.quand : déclencheur manquant/);
    one({ ...ok, id: 'x', texte: 'a'.repeat(MAX_TEXT_LENGTH + 1) }, /\.texte : 101 caractères, 100 au plus/);
    one({ ...ok, id: 'x', texteTilt: '  ' }, /\.texteTilt : texte non vide attendu/);
    one({ ...ok, id: 'x', texte: '×{gama}' }, /\.texte : variable \{gama\} inconnue/);
    one({ ...ok, id: 'x', texteDesktop: 'mode {modeVolant}' }, /\.texteDesktop : variable \{modeVolant\} non numérique/);
    one({ ...ok, id: 'x', texte: 'un {gamma' }, /accolade isolée/);
    one({ ...ok, id: 'x', texte: 'T', couleur: 'bleu' }, /clé inconnue « couleur »/);
    one({ ...ok, id: 'x', priorite: 'haute' }, /\.priorite : nombre attendu/);
    one({ ...ok, id: 'x', bloquante: 'oui' }, /\.bloquante : true ou false attendu/);
    one({ ...ok, id: 'x', duree: 0 }, /\.duree : secondes d'affichage attendues \(1 à 60\)/);
    one({ ...ok, id: 'x', note: 3 }, /\.note : texte attendu/);
    one({ ...ok, id: 'x', quand: { apres: 'x' } }, /« apres » cite la bulle elle-même/);
    one({ ...ok, id: 'x', quand: { apres: 'inconnue' } }, /bulles\[1\] \(x\)\.quand\.apres : bulle « inconnue » inconnue/);
    one({ ...ok, id: 'x', quand: { tous: [beta('=>', 1)] } }, /^bulles\[1\] \(x\)\.quand\.tous\[0\]\.op : opérateur « => » inconnu/);
    one('texte', /^bulles\[1\] : objet attendu/);
  });
});

describe('src/data/bubbles.json', () => {
  const bulles = bubblesJson.bulles;
  const byId = Object.fromEntries(bulles.map((b) => [b.id, b]));

  it('est valide', () => {
    expect(validateBubbles(bubblesJson)).toEqual([]);
    expect(() => createBubbleEngine({ definitions: bubblesJson })).not.toThrow();
  });

  it('contient les bulles du jalon 2', () => {
    expect(bulles.map((b) => b.id).sort()).toEqual(
      [
        'accel', 'inertie', 'frein', 'tourner', 'doppler', 'vision', 'aberration', 'projecteur', 'invisible', 'retro',
        'deux-horloges', 'ecart', 'gamma', 'vitesse-propre', 'asymptote', 'attente',
      ].sort(),
    );
    expect(bulles.some((b) => b.bloquante)).toBe(false); // pas de tutoriel au J2
  });

  it('textes du cahier des charges', () => {
    expect(plain(byId.doppler.texte)).toContain("Les murs bleuissent devant toi : c'est l'effet Doppler");
    expect(byId.gamma.texte).toContain('La ville va ×{gamma} plus vite que toi');
  });

  it('chaque texte tient en 100 caractères, même avec des valeurs extrêmes', () => {
    // φ ≤ 3 : γ ≤ cosh 3 ≈ 10,07 ; γv ≤ c·sinh 3 ≈ 1 002 m/s à c = 100 ; écart très long.
    const worst = { gamma: 10.07, vitessePropre: 1001.8, ecart: 9999.9, c: 100, beta: 0.995, tau: 9999.9, t: 9999.9 };
    for (const b of bulles) {
      for (const key of ['texte', 'texteDesktop', 'texteTilt', 'texteDrag']) {
        if (!b[key]) continue;
        const text = interpolate(b[key], worst);
        expect([...text].length, `${b.id}.${key} : ${text}`).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
        expect(text, `${b.id}.${key}`).not.toMatch(/—/);
      }
    }
  });

  it('typographie : espace insécable avant « : ! ? ; », tutoiement', () => {
    for (const b of bulles) {
      for (const key of ['texte', 'texteDesktop', 'texteTilt', 'texteDrag']) {
        if (!b[key]) continue;
        expect(b[key], `${b.id}.${key}`).not.toMatch(/ [:!?;]/);
        expect(b[key], `${b.id}.${key}`).not.toMatch(/\bvous\b/i);
      }
    }
  });

  it('les gestes tactiles ont une variante clavier', () => {
    for (const b of bulles) {
      if (/doigt|pouce|👁|bouton|écran|GSM/.test(b.texte)) expect(b.texteDesktop, b.id).toBeTruthy();
    }
  });

  it('conditions en β, jamais en m/s ni en mètres absolus (c est un réglage)', () => {
    const absolute = ['speed', 'vitessePropre', 'distanceFreinage', 'distanceDevant'];
    for (const b of bulles) {
      const refs = conditionReferences(b.quand);
      for (const name of absolute) expect(refs.variables.has(name), `${b.id} utilise ${name}`).toBe(false);
    }
  });

  it('les bulles d’effets visuels exigent la vision relativiste (k > 0,99)', () => {
    for (const id of ['doppler', 'vision', 'projecteur', 'invisible', 'aberration', 'retro']) {
      expect(conditionReferences(byId[id].quand).variables.has('k'), id).toBe(true);
    }
  });
});

describe('createBubbleVariables', () => {
  const snap = (over = {}) => ({ beta: 0, gamma: 1, speed: 0, c: 30, tau: 10, t: 12, ...over });

  it('variables dérivées et mémoire du départ', () => {
    const tracker = createBubbleVariables();
    const v0 = tracker.compute({ snapshot: snap(), command: {}, modeVolant: 'clavier' });
    expect(v0).toMatchObject({ depuisDebut: 0, ecart: 2, relache: true, accelere: false, dejaParti: false, modeVolant: 'clavier', k: 1 });
    expect(v0.margeFreinage).toBe(Infinity);
    expect(v0.evenements).toEqual([]);

    const b = 0.6;
    const g = 1 / Math.sqrt(1 - b * b);
    const v1 = tracker.compute({ snapshot: snap({ beta: b, gamma: g, speed: b * 30, tau: 13 }), command: { thrust: 1 }, distanceDevant: 100 });
    expect(v1.depuisDebut).toBe(3);
    expect(v1.dejaParti).toBe(true);
    expect(v1.evenements).toEqual(['depart']);
    expect(v1.vitessePropre).toBeCloseTo(g * b * 30, 12);
    expect(v1.distanceFreinage).toBeCloseTo(300 * (g - 1), 9); // (c²/a)(γ − 1), a = c/10
    expect(v1.margeFreinage).toBeCloseTo(100 / (300 * (g - 1)), 9);
    expect(v1.facadeDevant).toBe(false);
    expect(v1.regardArriere).toBe(false);

    const v2 = tracker.compute({ snapshot: snap({ beta: b, gamma: g, speed: 18 }), command: { brake: 1, thrust: 1, steer: -0.5 } });
    expect(v2).toMatchObject({ freine: true, accelere: false, relache: false, tourne: true, dejaTourne: true });
    expect(v2.evenements).toEqual(['relache', 'frein']);

    const v3 = tracker.compute({ snapshot: snap(), command: { classic: true }, butee: true, regardArriere: true });
    expect(v3.evenements).toEqual(['visionClassique', 'regardArriere', 'butee']);
    expect(v3.dejaTourne).toBe(true);
    tracker.reset();
    expect(tracker.compute({ snapshot: snap({ tau: 50 }) })).toMatchObject({ depuisDebut: 0, dejaParti: false, dejaTourne: false });
  });
});

describe('createBubbleVariables : variables des niveaux (jalon 3)', () => {
  const snap = (over = {}) => ({ beta: 0, gamma: 1, speed: 0, c: 30, tau: 10, t: 12, ...over });

  it('valeurs neutres en conduite libre', () => {
    const v = createBubbleVariables().compute({ snapshot: snap() });
    expect(v).toMatchObject({
      enNiveau: false,
      distanceArret: Infinity,
      margeArret: Infinity,
      arretDerriere: false,
      dansZone: false,
      attendClient: false,
      porteProche: false,
      teintePorte: 'aucune',
      teinteVoulue: false,
      batterie: 1,
      margeDelai: Infinity,
      colisLivres: 0,
    });
  });

  it('variables et événements de la partie (main.js les calcule)', () => {
    const b = 0.5;
    const g = 1 / Math.sqrt(1 - b * b);
    const v = createBubbleVariables().compute({
      snapshot: snap({ beta: b, gamma: g, speed: 15 }),
      niveau: { distanceArret: 60, porteProche: true, teintePorte: 'vert', teinteVoulue: true, batterie: 0.4, margeDelai: 12, colisLivres: 1, evenements: ['livraison', 'porteOuverte'] },
    });
    expect(v.enNiveau).toBe(true);
    expect(v.margeArret).toBeCloseTo(60 / (300 * (g - 1)), 9);
    expect(v).toMatchObject({ porteProche: true, teintePorte: 'vert', teinteVoulue: true, batterie: 0.4, margeDelai: 12, colisLivres: 1 });
    expect(v.evenements).toEqual(['livraison', 'porteOuverte']);
    // Les bulles des niveaux citent ces variables et événements (validées par le schéma).
    for (const name of ['margeArret', 'arretDerriere', 'attendClient', 'porteProche', 'teintePorte', 'teinteVoulue', 'batterie', 'margeDelai', 'colisLivres']) {
      expect(VARIABLES).toHaveProperty(name);
    }
  });
});

describe('facadeAhead', () => {
  const wall = { x: 0, y: 200, width: 40, depth: 10 }; // façade au nord, à 195 m

  it('touche une façade dans l’axe, à portée, dans le cône de ±20°', () => {
    expect(facadeAhead([wall], 0, 0, 0, 1)).toBe(true);
    expect(facadeAhead([wall], 0, 0, 0, -1)).toBe(false); // derrière
    expect(facadeAhead([wall], 0, 0, 0, 1, { range: 150 })).toBe(false); // trop loin
    expect(facadeAhead([{ ...wall, x: 120 }], 0, 0, 0, 1)).toBe(false); // à 31° du cap
    expect(facadeAhead([{ ...wall, x: 80 }], 0, 0, 0, 1)).toBe(true); // à 18°, bord à 60 m de l'axe
    expect(facadeAhead([], 0, 0, 0, 1)).toBe(false);
    expect(facadeAhead([wall], 0, 0, 0, 0)).toBe(false);
  });
});

describe('scénario : départ à fond sur l’avenue (c = 30, clavier)', () => {
  it('les bulles arrivent une par une, espacées, dans l’ordre pédagogique', () => {
    const physics = physicsFor(30);
    const player = createPlayer({ physics });
    const tracker = createBubbleVariables();
    const clock = { ms: 0 };
    const engine = createBubbleEngine({ definitions: bubblesJson, now: () => clock.ms });
    const shown = [];
    engine.onShow((b) => b && shown.push({ id: b.id, text: b.text, at: clock.ms / 1000, beta: snapshot(player).beta }));
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 60; i += 1) {
      const cmd = { thrust: 1, brake: 0, steer: 0 };
      step(player, cmd, dt);
      clock.ms += dt * 1000;
      const vars = tracker.compute({ snapshot: snapshot(player), command: cmd, k: 1, modeVolant: 'clavier', facadeDevant: true, a: physics.a });
      engine.update(vars, dt);
    }
    const ids = shown.map((b) => b.id);
    expect(ids.slice(0, 3)).toEqual(['doppler', 'vision', 'deux-horloges']); // priorités du fichier
    expect(ids).toContain('doppler');
    expect(ids).not.toContain('accel'); // parti tout de suite
    expect(ids).not.toContain('retro'); // pas de coup d'œil arrière au J2
    expect(ids.indexOf('vision')).toBeGreaterThan(ids.indexOf('doppler'));
    for (let i = 1; i < shown.length; i += 1) expect(shown[i].at - shown[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP_MS / 1000);
    expect(new Set(ids).size).toBe(ids.length);
    const vision = shown.find((b) => b.id === 'vision');
    expect(vision.text).toMatch(/^Maintiens C /); // variante clavier
    const gamma = shown.find((b) => b.id === 'gamma');
    if (gamma) expect(gamma.text).toMatch(/^La ville va ×\d+,\d plus vite que toi/);
  });
});
