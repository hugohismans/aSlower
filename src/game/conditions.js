/**
 * Langage des conditions (déclencheurs des bulles, plus tard des niveaux) : JSON déclaratif,
 * évalué SANS eval ni Function. Module pur : ni DOM, ni stockage, ni three.
 *
 * Grammaire (une condition est un objet JSON) :
 * - comparaison  {var: 'beta', op: '>', val: 0.15}
 *     op ∈ <, <=, ==, !=, >, >= ; nombres : les six opérateurs ; booléens et textes : == et !=.
 * - variable booléenne seule  {var: 'relache'}  (équivaut à {var, op: '==', val: true})
 * - tous     {tous: [c1, c2, …]}      vrai si toutes le sont (liste non vide)
 * - un       {un: [c1, c2, …]}        vrai si l'une l'est (liste non vide)
 * - non      {non: c}
 * - pendant  {pendant: {cond: c, s: 1}}  vrai si c est vraie sans interruption depuis au moins
 *            s secondes de TEMPS PROPRE (τ, la montre du joueur ; le dt passé à evaluate).
 *            Le chronomètre part de 0 à la première évaluation où c est vraie : s = 0 rend la
 *            condition vraie dès cette évaluation.
 * - evenement  {evenement: 'relache'}  vrai si l'événement a eu lieu depuis l'évaluation
 *            précédente (ctx.events).
 * - apres    {apres: 'doppler'}  vrai si la bulle « doppler » a déjà été montrée (ctx.seen).
 *
 * Évaluation : toutes les branches sont évaluées à chaque appel (pas de court-circuit), pour
 * que chaque « pendant » mesure sa durée même quand une branche voisine est fausse. Une
 * variable absente du contexte (undefined, null) ou NaN rend la comparaison
 * fausse, quel que soit l'opérateur, comme une valeur d'un autre type que val (pas de
 * conversion : '5' n'est pas 5).
 *
 * Les vitesses se comparent en fractions de c (β), jamais en m/s absolus : c est un réglage
 * du joueur (10 à 100 m/s). Les distances (distanceFreinage, distanceDevant) servent aux
 * rapports (margeFreinage) ou à l'affichage.
 */

/** Opérateurs de comparaison. */
export const OPERATORS = Object.freeze(['<', '<=', '==', '!=', '>', '>=']);

/** Profondeur maximale d'imbrication d'une condition (garde-fou contre un JSON aberrant). */
export const MAX_DEPTH = 16;

/** Plus longue durée acceptée par « pendant » (s de temps propre). */
export const MAX_PENDANT_S = 3600;

/**
 * Variables que le jeu fournit au moteur de bulles à chaque mise à jour. Le tableau sert à la
 * validation (nom, type, valeurs permises) et à l'interpolation des textes ({gamma}…).
 * `entier` : valeur affichée sans décimale. `calcul` : comment l'intégrateur l'obtient
 * (voir aussi createBubbleVariables, src/game/bubbles.js, qui les calcule toutes).
 * @type {Readonly<Record<string, {type: 'number' | 'boolean' | 'string', valeurs?: readonly string[],
 *   entier?: boolean, description: string, calcul: string}>>}
 */
export const VARIABLES = Object.freeze({
  beta: { type: 'number', description: 'v/c, vitesse en fraction de c', calcul: 'snapshot.beta' },
  gamma: { type: 'number', description: 'facteur de Lorentz γ', calcul: 'snapshot.gamma' },
  speed: { type: 'number', description: 'vitesse v (m/s) ; pour l’affichage, pas pour les conditions', calcul: 'snapshot.speed' },
  c: { type: 'number', entier: true, description: 'vitesse de la lumière de la partie (m/s)', calcul: 'snapshot.c' },
  tau: { type: 'number', description: 'ta montre τ (s)', calcul: 'snapshot.tau' },
  t: { type: 'number', description: 'horloge de la ville t (s)', calcul: 'snapshot.t' },
  ecart: { type: 'number', description: 'écart des horloges t − τ (s)', calcul: 'snapshot.t − snapshot.tau' },
  depuisDebut: { type: 'number', description: 'τ écoulé depuis le départ de la partie (s)', calcul: 'snapshot.tau − τ au départ' },
  k: { type: 'number', description: 'vision : 1 relativiste, 0 classique', calcul: 'game.k (main.js, nextK)' },
  vitessePropre: { type: 'number', description: 'γv : mètres de ville par seconde de ta montre (m/s)', calcul: 'snapshot.gamma × snapshot.speed' },
  distanceFreinage: { type: 'number', description: 'distance d’arrêt au frein plein (m)', calcul: '(c²/a)(γ − 1), a = c/10' },
  distanceDevant: { type: 'number', description: 'distance au bord de la zone roulable, le long du cap (m)', calcul: 'exitDistance(x, y, hx, hy, limits) de main.js' },
  margeFreinage: { type: 'number', description: 'distanceDevant ÷ distanceFreinage (Infinity à l’arrêt)', calcul: 'distanceDevant / distanceFreinage' },
  accelere: { type: 'boolean', description: 'poussée appliquée', calcul: 'commande.thrust > 0 (après la butée douce)' },
  freine: { type: 'boolean', description: 'frein appliqué (par le joueur ou la butée)', calcul: 'commande.brake > 0' },
  relache: { type: 'boolean', description: 'ni poussée ni frein', calcul: '!accelere && !freine' },
  tourne: { type: 'boolean', description: 'volant tourné', calcul: '|commande.steer| > 0,15' },
  dejaParti: { type: 'boolean', description: 'le joueur a déjà accéléré depuis le départ', calcul: 'mémorisé à la première poussée' },
  dejaTourne: { type: 'boolean', description: 'le joueur a déjà tourné depuis le départ', calcul: 'mémorisé au premier virage' },
  regardArriere: { type: 'boolean', description: 'coup d’œil arrière maintenu (débloqué en J3 ; false avant)', calcul: 'false' },
  facadeDevant: { type: 'boolean', description: 'une façade dans l’axe (±20°) à moins de 300 m', calcul: 'facadeAhead(buildings, …) ou true en ville' },
  modeVolant: {
    type: 'string',
    valeurs: Object.freeze(['tilt', 'drag', 'clavier']),
    description: 'commande de direction en usage (choisit la variante du texte)',
    calcul: "'clavier' si la dernière commande vient du clavier, sinon le mode tactile",
  },
});

/**
 * Événements ponctuels (signalés à l'évaluation qui suit, puis oubliés).
 * @type {Readonly<Record<string, string>>}
 */
export const EVENTS = Object.freeze({
  depart: 'première poussée depuis le départ de la partie',
  relache: 'la poussée vient d’être relâchée (en roulant)',
  frein: 'le frein vient d’être enfoncé',
  butee: 'la butée douce freine à la place du joueur (bord de la zone roulable)',
  visionClassique: 'le bouton vision classique vient d’être enfoncé',
  regardArriere: 'le coup d’œil arrière vient de commencer (J3)',
});

const NODE_KEYS = ['tous', 'un', 'non', 'pendant', 'evenement', 'apres'];

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Valeur JSON courte pour un message d'erreur. */
function show(x) {
  if (x === undefined) return 'rien';
  try {
    const text = JSON.stringify(x);
    return text.length > 40 ? `${text.slice(0, 37)}…` : text;
  } catch {
    return String(x);
  }
}

/**
 * Vérifie une condition et renvoie la liste des erreurs (vide si elle est valide).
 * Chaque message commence par le chemin JSON (`quand.tous[1].op : …`).
 * @param {unknown} cond
 * @param {{path?: string, variables?: Record<string, any> | null, events?: Record<string, any> | null,
 *          bubbleIds?: Iterable<string> | null}} [options]
 *   variables / events : tables de référence (null : noms non vérifiés) ;
 *   bubbleIds : ids permis pour « apres » (null : non vérifiés)
 * @returns {string[]}
 */
export function validateCondition(cond, { path = 'quand', variables = VARIABLES, events = EVENTS, bubbleIds = null } = {}) {
  const errors = [];
  const ids = bubbleIds ? new Set(bubbleIds) : null;

  const walk = (node, at, depth) => {
    if (depth > MAX_DEPTH) {
      errors.push(`${at} : condition trop imbriquée (plus de ${MAX_DEPTH} niveaux)`);
      return;
    }
    if (!isPlainObject(node)) {
      errors.push(`${at} : une condition doit être un objet JSON, reçu ${show(node)}`);
      return;
    }
    const keys = Object.keys(node);
    if ('var' in node) {
      checkComparison(node, at, keys);
      return;
    }
    const kind = keys.filter((k) => NODE_KEYS.includes(k));
    if (keys.length !== 1 || kind.length !== 1) {
      const extra = keys.filter((k) => !NODE_KEYS.includes(k));
      if (extra.length && kind.length === 0) {
        errors.push(`${at} : clé inconnue « ${extra.join(', ')} » (attendues : var, ${NODE_KEYS.join(', ')})`);
      } else if (keys.length === 0) {
        errors.push(`${at} : condition vide (attendues : var, ${NODE_KEYS.join(', ')})`);
      } else {
        errors.push(`${at} : une seule clé par condition, reçu « ${keys.join(', ')} »`);
      }
      return;
    }
    const key = kind[0];
    const value = node[key];
    switch (key) {
      case 'tous':
      case 'un':
        if (!Array.isArray(value) || value.length === 0) {
          errors.push(`${at}.${key} : liste non vide de conditions attendue, reçu ${show(value)}`);
          return;
        }
        value.forEach((child, i) => walk(child, `${at}.${key}[${i}]`, depth + 1));
        return;
      case 'non':
        walk(value, `${at}.non`, depth + 1);
        return;
      case 'pendant': {
        if (!isPlainObject(value)) {
          errors.push(`${at}.pendant : objet {cond, s} attendu, reçu ${show(value)}`);
          return;
        }
        const extra = Object.keys(value).filter((k) => k !== 'cond' && k !== 's');
        if (extra.length) errors.push(`${at}.pendant : clé inconnue « ${extra.join(', ')} » (attendues : cond, s)`);
        const s = value.s;
        if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > MAX_PENDANT_S) {
          errors.push(`${at}.pendant.s : durée en secondes de temps propre attendue (0 à ${MAX_PENDANT_S}), reçu ${show(s)}`);
        }
        if (!('cond' in value)) errors.push(`${at}.pendant.cond : condition manquante`);
        else walk(value.cond, `${at}.pendant.cond`, depth + 1);
        return;
      }
      case 'evenement':
        if (typeof value !== 'string' || value === '') {
          errors.push(`${at}.evenement : nom d'événement attendu, reçu ${show(value)}`);
        } else if (events && !(value in events)) {
          errors.push(`${at}.evenement : événement « ${value} » inconnu (connus : ${Object.keys(events).join(', ')})`);
        }
        return;
      case 'apres':
        if (typeof value !== 'string' || value === '') {
          errors.push(`${at}.apres : id de bulle attendu, reçu ${show(value)}`);
        } else if (ids && !ids.has(value)) {
          errors.push(`${at}.apres : bulle « ${value} » inconnue`);
        }
        return;
      default:
        return;
    }
  };

  const checkComparison = (node, at, keys) => {
    const extra = keys.filter((k) => k !== 'var' && k !== 'op' && k !== 'val');
    if (extra.length) errors.push(`${at} : clé inconnue « ${extra.join(', ')} » dans une comparaison (attendues : var, op, val)`);
    const name = node.var;
    if (typeof name !== 'string' || name === '') {
      errors.push(`${at}.var : nom de variable attendu, reçu ${show(name)}`);
      return;
    }
    const spec = variables ? variables[name] : null;
    if (variables && !Object.prototype.hasOwnProperty.call(variables, name)) {
      errors.push(`${at}.var : variable « ${name} » inconnue (connues : ${Object.keys(variables).join(', ')})`);
      return;
    }
    const hasOp = 'op' in node;
    const hasVal = 'val' in node;
    if (!hasOp && !hasVal) {
      if (spec && spec.type !== 'boolean') {
        errors.push(`${at} : « ${name} » n'est pas booléenne ; ajouter op et val`);
      }
      return;
    }
    if (!hasOp || !hasVal) {
      errors.push(`${at} : ${hasOp ? 'val' : 'op'} manquant (une comparaison a op et val, ou ni l'un ni l'autre pour un booléen)`);
      return;
    }
    const { op, val } = node;
    if (!OPERATORS.includes(op)) {
      errors.push(`${at}.op : opérateur « ${op} » inconnu (attendus : ${OPERATORS.join(', ')})`);
      return;
    }
    const valType = typeof val;
    if (valType === 'number' && !Number.isFinite(val)) {
      errors.push(`${at}.val : nombre fini attendu, reçu ${show(val)}`);
      return;
    }
    if (valType !== 'number' && valType !== 'boolean' && valType !== 'string') {
      errors.push(`${at}.val : nombre, booléen ou texte attendu, reçu ${show(val)}`);
      return;
    }
    if (valType !== 'number' && op !== '==' && op !== '!=') {
      errors.push(`${at}.op : « ${op} » ne compare que des nombres (val = ${show(val)} : utiliser == ou !=)`);
      return;
    }
    if (spec) {
      if (spec.type !== valType) {
        errors.push(`${at}.val : « ${name} » est de type ${typeName(spec.type)}, reçu ${show(val)}`);
        return;
      }
      if (spec.valeurs && !spec.valeurs.includes(val)) {
        errors.push(`${at}.val : « ${val} » n'est pas une valeur de « ${name} » (permises : ${spec.valeurs.join(', ')})`);
      }
    }
  };

  walk(cond, path, 0);
  return errors;
}

function typeName(type) {
  return type === 'number' ? 'nombre' : type === 'boolean' ? 'booléen' : 'texte';
}

/**
 * Contexte d'évaluation.
 * @typedef {object} ConditionContext
 * @property {Record<string, any>} vars variables du jeu (VARIABLES)
 * @property {{has(name: string): boolean}} [events] événements depuis l'évaluation précédente
 * @property {(id: string) => boolean} [seen] bulle déjà montrée (pour « apres »)
 */

/**
 * @typedef {{evaluate(ctx: ConditionContext, dt?: number): boolean, reset(): void}} CompiledCondition
 */

/**
 * Compare deux valeurs, sans conversion de type : fausse si la variable manque, n'a pas le
 * type de val ou vaut NaN. ±Infinity se compare (margeFreinage à l'arrêt vaut Infinity).
 */
function compare(value, op, val) {
  if (typeof value !== typeof val || Number.isNaN(value)) return false;
  switch (op) {
    case '<':
      return value < val;
    case '<=':
      return value <= val;
    case '>':
      return value > val;
    case '>=':
      return value >= val;
    case '==':
      return value === val;
    case '!=':
      return value !== val;
    default:
      return false;
  }
}

/**
 * Compile une condition valide en un évaluateur avec état (chronomètres des « pendant »).
 * Lève une Error qui liste les erreurs de validateCondition si la condition est invalide.
 * @param {unknown} cond
 * @param {Parameters<typeof validateCondition>[1]} [options] mêmes options que validateCondition
 * @returns {CompiledCondition}
 */
export function compileCondition(cond, options = {}) {
  const errors = validateCondition(cond, options);
  if (errors.length) throw new Error(`Condition invalide :\n- ${errors.join('\n- ')}`);

  /** Remises à zéro des chronomètres. */
  const resets = [];

  /** @returns {(ctx: ConditionContext, dt: number) => boolean} */
  const build = (node) => {
    if ('var' in node) {
      const { var: name } = node;
      const op = 'op' in node ? node.op : '==';
      const val = 'val' in node ? node.val : true;
      return (ctx) => compare(ctx.vars?.[name], op, val);
    }
    if ('tous' in node) {
      const parts = node.tous.map(build);
      return (ctx, dt) => {
        let all = true;
        for (const part of parts) if (!part(ctx, dt)) all = false; // pas de court-circuit
        return all;
      };
    }
    if ('un' in node) {
      const parts = node.un.map(build);
      return (ctx, dt) => {
        let any = false;
        for (const part of parts) if (part(ctx, dt)) any = true;
        return any;
      };
    }
    if ('non' in node) {
      const inner = build(node.non);
      return (ctx, dt) => !inner(ctx, dt);
    }
    if ('pendant' in node) {
      const inner = build(node.pendant.cond);
      const seconds = node.pendant.s;
      const timer = { running: false, elapsed: 0 };
      resets.push(() => {
        timer.running = false;
        timer.elapsed = 0;
      });
      return (ctx, dt) => {
        if (!inner(ctx, dt)) {
          timer.running = false;
          timer.elapsed = 0;
          return false;
        }
        if (timer.running) timer.elapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
        timer.running = true;
        return timer.elapsed >= seconds - 1e-9;
      };
    }
    if ('evenement' in node) {
      const name = node.evenement;
      return (ctx) => Boolean(ctx.events?.has(name));
    }
    const id = node.apres;
    return (ctx) => Boolean(ctx.seen?.(id));
  };

  const root = build(cond);
  return {
    evaluate(ctx, dt = 0) {
      return root(ctx ?? { vars: {} }, dt);
    },
    reset() {
      for (const r of resets) r();
    },
  };
}

/**
 * Évaluation sans état (pratique pour un test ou une condition sans « pendant » ; un
 * « pendant » n'y est vrai que si s = 0).
 * @param {unknown} cond
 * @param {ConditionContext} ctx
 * @returns {boolean}
 */
export function evaluateCondition(cond, ctx) {
  return compileCondition(cond, { variables: null, events: null }).evaluate(ctx, 0);
}

/**
 * Noms référencés par une condition valide (variables, événements, bulles de « apres »).
 * @param {any} cond
 * @returns {{variables: Set<string>, events: Set<string>, bubbles: Set<string>}}
 */
export function conditionReferences(cond) {
  const refs = { variables: new Set(), events: new Set(), bubbles: new Set() };
  const walk = (node) => {
    if (!isPlainObject(node)) return;
    if (typeof node.var === 'string') refs.variables.add(node.var);
    if (Array.isArray(node.tous)) node.tous.forEach(walk);
    if (Array.isArray(node.un)) node.un.forEach(walk);
    if ('non' in node) walk(node.non);
    if (isPlainObject(node.pendant)) walk(node.pendant.cond);
    if (typeof node.evenement === 'string') refs.events.add(node.evenement);
    if (typeof node.apres === 'string') refs.bubbles.add(node.apres);
  };
  walk(cond);
  return refs;
}
