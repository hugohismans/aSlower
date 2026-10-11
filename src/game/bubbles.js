/**
 * Bulles pédagogiques « une seule fois » (J2) : moteur sans DOM. L'affichage est dans
 * src/hud/bubbles.js, les textes et déclencheurs dans src/data/bubbles.json, le langage des
 * déclencheurs dans src/game/conditions.js.
 *
 * Module pur, sauf le stockage, INJECTÉ (`store` : {get, set, remove}, en pratique `local` de
 * src/storage.js, qui fait le try/catch et le repli en mémoire). Les bulles vues sont
 * mémorisées sous la clé `bulles` (→ `aslower:v1:bulles`), valeur {vues: [ids]}.
 *
 * Schéma de src/data/bubbles.json (« coursier-bulles/1 ») :
 * {
 *   "schema": "coursier-bulles/1",
 *   "description": "…",                     facultatif
 *   "bulles": [{
 *     "id": "doppler",                       kebab-case ASCII, unique
 *     "texte": "…",                          texte par défaut (tactile), ≤ 100 caractères
 *     "texteDesktop": "…",                   facultatif : variante clavier (modeVolant 'clavier')
 *     "texteTilt": "…",                      facultatif : variante inclinaison ('tilt')
 *     "texteDrag": "…",                      facultatif : variante glisser ('drag')
 *     "quand": {condition},                  déclencheur (src/game/conditions.js)
 *     "priorite": 0,                         facultatif : plus grand = passe devant dans la file
 *     "bloquante": false,                    facultatif : reste jusqu'au toucher (tutoriel,
 *                                            horloges gelées par l'intégrateur) ; aucune hors tutoriel
 *     "duree": 5,                            facultatif : secondes d'affichage (1 à 60)
 *     "note": "…"                            facultatif : explication pour les auteurs
 *   }]
 * }
 * Les textes peuvent citer une variable numérique entre accolades ({gamma}, {ecart}, {c}…),
 * remplacée à l'affichage par sa valeur en français : virgule décimale, 1 décimale tronquée
 * (« 1,5 »), sans décimale pour c (« 30 »), milliers séparés par une espace fine.
 *
 * Règles du moteur (docs/conception.md §5) :
 * - conditions évaluées à 5 Hz au plus (update peut être appelé à chaque image) ;
 * - une seule bulle visible ; file d'attente de 2 au plus (priorité, puis ordre d'arrivée ;
 *   une bulle qui attend plus de 20 s est oubliée, non vue, et pourra revenir) ;
 * - au moins 8 s entre deux apparitions (et 1 s de vide après une fermeture) ;
 * - 5 s d'affichage, ou toucher pour fermer (dismiss) ;
 * - chaque bulle n'est montrée qu'une fois par profil (mémorisée dès son apparition).
 */
import { EVENTS, VARIABLES, compileCondition, conditionReferences, validateCondition } from './conditions.js';

/** Clé de stockage (sans le préfixe aslower:v1:, ajouté par storage.js). */
export const BUBBLES_KEY = 'bulles';
/** Identifiant du schéma de src/data/bubbles.json. */
export const BUBBLES_SCHEMA = 'coursier-bulles/1';
/** Période d'évaluation des conditions (ms) : 5 Hz. */
export const EVAL_PERIOD_MS = 200;
/** Écart minimal entre deux apparitions (ms). */
export const MIN_GAP_MS = 8000;
/** Vide minimal après la fermeture d'une bulle (ms). */
export const MIN_BLANK_MS = 1000;
/** Durée d'affichage par défaut (s). */
export const DEFAULT_DURATION_S = 5;
/** Longueur de la file d'attente. */
export const MAX_QUEUE = 2;
/** Au-delà, une bulle en attente est oubliée (ms) : son contexte est passé. */
export const QUEUE_TTL_MS = 20000;
/** Longueur maximale d'un texte (caractères, après interpolation). */
export const MAX_TEXT_LENGTH = 100;

/** Espace fine insécable (U+202F) : séparateur de milliers. */
const NNBSP = ' ';
/** Signe moins typographique (U+2212). */
const MINUS = '−';

const BUBBLE_KEYS = ['id', 'texte', 'texteDesktop', 'texteTilt', 'texteDrag', 'quand', 'priorite', 'bloquante', 'duree', 'note'];
const TEXT_KEYS = ['texte', 'texteDesktop', 'texteTilt', 'texteDrag'];
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const length = (text) => [...text].length;

/* ------------------------------------------------------------------------- */
/* Textes : nombres en français, interpolation, variantes                     */
/* ------------------------------------------------------------------------- */

/**
 * Nombre → texte français : virgule décimale, `decimals` décimales TRONQUÉES (comme le HUD :
 * jamais arrondi vers le haut), milliers séparés par une espace fine, signe moins U+2212.
 * Valeur non finie → « — ».
 * @param {number} x
 * @param {number} [decimals]
 */
export function formatNumberFr(x, decimals = 1) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—';
  const scale = 10 ** decimals;
  const scaled = Math.floor(Math.abs(x) * scale + 1e-9);
  if (scaled === 0) return decimals > 0 ? `0,${'0'.repeat(decimals)}` : '0';
  const whole = Math.floor(scaled / scale);
  const fraction = String(scaled % scale).padStart(decimals, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP);
  return `${x < 0 ? MINUS : ''}${grouped}${decimals > 0 ? `,${fraction}` : ''}`;
}

/**
 * Remplace {nom} par la valeur formatée de la variable (1 décimale ; 0 pour les variables
 * `entier`, comme c). Variable absente → « — ».
 * @param {string} template
 * @param {Record<string, any>} vars
 * @param {Record<string, {entier?: boolean}>} [variables]
 */
export function interpolate(template, vars, variables = VARIABLES) {
  return template.replace(PLACEHOLDER, (_, name) => formatNumberFr(vars?.[name], variables[name]?.entier ? 0 : 1));
}

/**
 * Texte d'une bulle pour le mode de direction en usage (variante, sinon `texte`).
 * @param {{texte: string, texteDesktop?: string, texteTilt?: string, texteDrag?: string}} def
 * @param {string} [modeVolant] 'clavier' | 'tilt' | 'drag'
 */
export function chooseText(def, modeVolant) {
  if (modeVolant === 'clavier') return def.texteDesktop ?? def.texte;
  if (modeVolant === 'tilt') return def.texteTilt ?? def.texte;
  if (modeVolant === 'drag') return def.texteDrag ?? def.texte;
  return def.texte;
}

/* ------------------------------------------------------------------------- */
/* Validation de bubbles.json                                                 */
/* ------------------------------------------------------------------------- */

function show(x) {
  if (x === undefined) return 'rien';
  const text = JSON.stringify(x) ?? String(x);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

/** Erreurs d'un texte de bulle (longueur, accolades, variables citées). */
function checkText(text, at, errors) {
  if (typeof text !== 'string' || text.trim() === '') {
    errors.push(`${at} : texte non vide attendu, reçu ${show(text)}`);
    return;
  }
  if (length(text) > MAX_TEXT_LENGTH) {
    errors.push(`${at} : ${length(text)} caractères, ${MAX_TEXT_LENGTH} au plus`);
  }
  for (const [, name] of text.matchAll(PLACEHOLDER)) {
    const spec = VARIABLES[name];
    if (!spec || !Object.prototype.hasOwnProperty.call(VARIABLES, name)) errors.push(`${at} : variable {${name}} inconnue`);
    else if (spec.type !== 'number') errors.push(`${at} : variable {${name}} non numérique (seuls les nombres s'affichent)`);
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) {
    errors.push(`${at} : accolade isolée (une variable s'écrit {nom})`);
  }
}

/**
 * Vérifie le contenu de src/data/bubbles.json ; renvoie la liste des erreurs (vide si valide),
 * chacune préfixée par son chemin JSON (« bulles[3] (doppler).quand.tous[0].op : … »).
 * @param {unknown} json
 * @returns {string[]}
 */
export function validateBubbles(json) {
  if (!isPlainObject(json)) return [`bulles : objet JSON attendu, reçu ${show(json)}`];
  const doc = /** @type {any} */ (json);
  const errors = [];
  const extraTop = Object.keys(json).filter((k) => !['schema', 'description', 'bulles'].includes(k));
  if (extraTop.length) errors.push(`racine : clé inconnue « ${extraTop.join(', ')} » (attendues : schema, description, bulles)`);
  if (doc.schema !== BUBBLES_SCHEMA) errors.push(`schema : « ${BUBBLES_SCHEMA} » attendu, reçu ${show(doc.schema)}`);
  if (!Array.isArray(doc.bulles) || doc.bulles.length === 0) {
    errors.push(`bulles : liste non vide attendue, reçu ${show(doc.bulles)}`);
    return errors;
  }

  const ids = doc.bulles.filter((b) => isPlainObject(b) && typeof b.id === 'string').map((b) => b.id);
  const seen = new Set();
  doc.bulles.forEach((b, i) => {
    const at = isPlainObject(b) && typeof b.id === 'string' ? `bulles[${i}] (${b.id})` : `bulles[${i}]`;
    if (!isPlainObject(b)) {
      errors.push(`${at} : objet attendu, reçu ${show(b)}`);
      return;
    }
    const extra = Object.keys(b).filter((k) => !BUBBLE_KEYS.includes(k));
    if (extra.length) errors.push(`${at} : clé inconnue « ${extra.join(', ')} » (permises : ${BUBBLE_KEYS.join(', ')})`);

    if (typeof b.id !== 'string' || !ID_PATTERN.test(b.id)) {
      errors.push(`${at}.id : identifiant kebab-case ASCII attendu (« vitesse-propre »), reçu ${show(b.id)}`);
    } else if (seen.has(b.id)) {
      errors.push(`${at}.id : « ${b.id} » en double`);
    } else {
      seen.add(b.id);
    }

    if (!('texte' in b)) errors.push(`${at}.texte : manquant`);
    for (const key of TEXT_KEYS) if (key in b) checkText(b[key], `${at}.${key}`, errors);

    if (!('quand' in b)) {
      errors.push(`${at}.quand : déclencheur manquant`);
    } else {
      const condErrors = validateCondition(b.quand, { path: `${at}.quand`, variables: VARIABLES, events: EVENTS, bubbleIds: ids });
      errors.push(...condErrors);
      if (condErrors.length === 0 && conditionReferences(b.quand).bubbles.has(b.id)) {
        errors.push(`${at}.quand : « apres » cite la bulle elle-même (elle ne se déclencherait jamais)`);
      }
    }

    if ('priorite' in b && (typeof b.priorite !== 'number' || !Number.isFinite(b.priorite))) {
      errors.push(`${at}.priorite : nombre attendu, reçu ${show(b.priorite)}`);
    }
    if ('bloquante' in b && typeof b.bloquante !== 'boolean') {
      errors.push(`${at}.bloquante : true ou false attendu, reçu ${show(b.bloquante)}`);
    }
    if ('duree' in b && (typeof b.duree !== 'number' || !(b.duree >= 1 && b.duree <= 60))) {
      errors.push(`${at}.duree : secondes d'affichage attendues (1 à 60), reçu ${show(b.duree)}`);
    }
    if ('note' in b && typeof b.note !== 'string') errors.push(`${at}.note : texte attendu, reçu ${show(b.note)}`);
  });
  return errors;
}

/* ------------------------------------------------------------------------- */
/* Moteur                                                                     */
/* ------------------------------------------------------------------------- */

/** Stockage en mémoire (défaut, et tests) : mêmes méthodes que storage.js. */
export function createMemoryStore() {
  const map = new Map();
  return {
    get: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    set: (key, value) => {
      map.set(key, JSON.stringify(value));
      return true;
    },
    remove: (key) => void map.delete(key),
  };
}

/** Ids mémorisés (valeur abîmée ou d'un autre format : aucun). */
function loadSeen(store, key) {
  let value;
  try {
    value = store.get(key, null);
  } catch {
    value = null;
  }
  const list = Array.isArray(value) ? value : isPlainObject(value) && Array.isArray(value.vues) ? value.vues : [];
  return list.filter((id) => typeof id === 'string');
}

/**
 * Bulle affichée, telle que la reçoivent les abonnés de onShow.
 * @typedef {{id: string, text: string, blocking: boolean, durationMs: number}} ShownBubble
 */

/**
 * @typedef {object} BubbleEngine
 * @property {(vars: Record<string, any>, dt?: number) => void} update variables du jeu
 *   (VARIABLES ; `vars.evenements` : liste facultative d'événements de l'image) et dt = temps
 *   propre écoulé depuis l'appel précédent (s). À appeler à chaque image de jeu (pas en pause) :
 *   les conditions sont évaluées à 5 Hz au plus.
 * @property {(name: string) => void} emit signale un événement (EVENTS) pour l'évaluation suivante
 * @property {(cb: (bubble: ShownBubble | null) => void) => () => void} onShow abonnement :
 *   cb(bulle) à l'apparition, cb(null) à la disparition ; renvoie le désabonnement
 * @property {() => boolean} dismiss ferme la bulle visible (toucher) ; faux s'il n'y en avait pas
 * @property {() => ShownBubble | null} current bulle visible
 * @property {(id: string) => boolean} seen bulle déjà montrée à ce profil
 * @property {() => void} reset « Revoir les bulles » : oublie les bulles vues (stockage compris),
 *   ferme la bulle visible, vide la file, remet les chronomètres à zéro
 * @property {() => void} clearPending nouvelle partie : ferme la bulle visible, vide la file et
 *   remet les chronomètres à zéro, sans oublier les bulles vues
 * @property {() => {id: string, seen: boolean, text: string}[]} list toutes les bulles, dans
 *   l'ordre du fichier (écran Options)
 */

/**
 * @param {{definitions: unknown, store?: {get(key: string, fallback?: any): any,
 *          set(key: string, value: any): any, remove(key: string): void},
 *          now?: () => number, key?: string}} options
 *   definitions : contenu de bubbles.json (ou directement la liste `bulles`) ;
 *   store : stockage sûr (`local` de storage.js) ; défaut : en mémoire ;
 *   now : horloge en ms des durées d'affichage et des écarts. Elle doit s'arrêter pendant la
 *   pause (temps réel de jeu cumulé), sinon une bulle expire pendant le menu.
 * @returns {BubbleEngine}
 */
export function createBubbleEngine({ definitions, store = createMemoryStore(), now = () => Date.now(), key = BUBBLES_KEY } = /** @type {any} */ ({})) {
  const json = Array.isArray(definitions) ? { schema: BUBBLES_SCHEMA, bulles: definitions } : definitions;
  const errors = validateBubbles(json);
  if (errors.length) throw new Error(`Bulles invalides :\n- ${errors.join('\n- ')}`);

  const bubbles = /** @type {any} */ (json).bulles;
  const ids = bubbles.map((b) => b.id);
  const defs = bubbles.map((b, order) => ({
    def: b,
    id: b.id,
    order,
    priority: b.priorite ?? 0,
    condition: compileCondition(b.quand, { variables: VARIABLES, events: EVENTS, bubbleIds: ids }),
  }));

  const seenIds = new Set(loadSeen(store, key));
  /** @type {{entry: (typeof defs)[number], at: number}[]} */
  let queue = [];
  /** @type {(ShownBubble & {until: number}) | null} */
  let visible = null;
  let lastShownAt = -Infinity;
  let lastHiddenAt = -Infinity;
  let lastEvalAt = -Infinity;
  let dtSinceEval = 0;
  /** @type {Record<string, any>} */
  let lastVars = {};
  const events = new Set();
  const listeners = new Set();

  const ctx = {
    get vars() {
      return lastVars;
    },
    events,
    seen: (id) => seenIds.has(id),
  };

  function notify(payload) {
    for (const cb of [...listeners]) {
      try {
        cb(payload);
      } catch (error) {
        console.error(error); // un défaut d'affichage n'arrête pas le jeu
      }
    }
  }

  function save() {
    try {
      store.set(key, { vues: [...seenIds] });
    } catch {
      /* stockage défaillant : la mémoire de la page suffit */
    }
  }

  function publicBubble() {
    if (!visible) return null;
    const { id, text, blocking, durationMs } = visible;
    return { id, text, blocking, durationMs };
  }

  function hide(at) {
    if (!visible) return false;
    visible = null;
    lastHiddenAt = at;
    notify(null);
    return true;
  }

  /** Ordre de la file : priorité décroissante, puis arrivée, puis ordre du fichier. */
  const byPriority = (p, q) => q.entry.priority - p.entry.priority || p.at - q.at || p.entry.order - q.entry.order;

  /**
   * Évalue les conditions des bulles non vues. Les bulles déclenchées rejoignent la file, triée ;
   * la première s'affiche si c'est permis ; au-delà de MAX_QUEUE en attente, les plus faibles
   * (priorité basse, puis arrivée récente) sont oubliées, NON vues : elles reviendront si leur
   * condition tient encore.
   */
  function evaluate(at) {
    const fresh = [];
    for (const entry of defs) {
      if (seenIds.has(entry.id)) continue;
      // Pas de court-circuit : chaque condition est évaluée (chronomètres des « pendant »).
      const triggered = entry.condition.evaluate(ctx, dtSinceEval);
      if (triggered && !queue.some((q) => q.entry === entry)) fresh.push({ entry, at });
    }
    if (fresh.length === 0) return;
    queue = [...queue, ...fresh].sort(byPriority);
    showNext(at);
    queue = queue.slice(0, MAX_QUEUE);
  }

  function showNext(at) {
    queue = queue.filter((q) => at - q.at <= QUEUE_TTL_MS);
    if (visible || queue.length === 0) return;
    if (at - lastShownAt < MIN_GAP_MS || at - lastHiddenAt < MIN_BLANK_MS) return;
    const { entry } = /** @type {(typeof queue)[number]} */ (queue.shift());
    const blocking = entry.def.bloquante === true;
    const durationMs = (entry.def.duree ?? DEFAULT_DURATION_S) * 1000;
    const text = interpolate(chooseText(entry.def, lastVars.modeVolant), lastVars);
    seenIds.add(entry.id);
    save();
    lastShownAt = at;
    visible = { id: entry.id, text, blocking, durationMs, until: blocking ? Infinity : at + durationMs };
    notify(publicBubble());
  }

  function clearPending() {
    hide(now());
    queue = [];
    for (const entry of defs) entry.condition.reset();
    events.clear();
    dtSinceEval = 0;
    lastEvalAt = -Infinity;
  }

  return {
    update(vars, dt = 0) {
      lastVars = isPlainObject(vars) ? vars : {};
      if (Array.isArray(lastVars.evenements)) for (const name of lastVars.evenements) events.add(name);
      if (Number.isFinite(dt) && dt > 0) dtSinceEval += dt;
      const at = now();
      if (visible && at >= visible.until) hide(at);
      if (at - lastEvalAt >= EVAL_PERIOD_MS) {
        evaluate(at);
        lastEvalAt = at;
        dtSinceEval = 0;
        events.clear();
      }
      showNext(at);
    },

    emit(name) {
      events.add(name);
    },

    onShow(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    dismiss() {
      return hide(now());
    },

    current: publicBubble,

    seen(id) {
      return seenIds.has(id);
    },

    reset() {
      seenIds.clear();
      try {
        store.remove(key);
      } catch {
        /* rien d'autre à faire */
      }
      clearPending();
      lastShownAt = -Infinity;
      lastHiddenAt = -Infinity;
    },

    clearPending,

    list() {
      return defs.map((entry) => ({ id: entry.id, seen: seenIds.has(entry.id), text: entry.def.texte }));
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Variables du jeu                                                           */
/* ------------------------------------------------------------------------- */

/** Seuil du volant au-delà duquel on « tourne ». */
const STEER_THRESHOLD = 0.15;
/** En dessous de ce β, relâcher la poussée n'est pas un événement « relache ». */
const RELEASE_MIN_BETA = 0.01;

/**
/**
 * @typedef {object} LevelBubbleInput variables d'une partie de niveau (main.js les calcule à
 *   partir de l'état de partie, voir hud/levelFormat.js et game/rules.js)
 * @property {number} [distanceArret] m
 * @property {boolean} [arretDerriere]
 * @property {boolean} [dansZone]
 * @property {boolean} [attendClient]
 * @property {boolean} [porteProche]
 * @property {string} [teintePorte]
 * @property {boolean} [teinteVoulue]
 * @property {number} [batterie] fraction restante
 * @property {number} [margeDelai] s
 * @property {number} [colisLivres]
 * @property {string[]} [evenements] événements de l'image (livraison, retrait, choc, reprise,
 *   porteOuverte, attente)
 */

/**
 * Calcule, à chaque image, les variables et événements des bulles (VARIABLES, EVENTS) à partir
 * de l'état du jeu. Garde ce qui demande une mémoire : τ au départ, dejaParti, dejaTourne,
 * fronts des commandes. Le résultat se passe tel quel à engine.update(vars, dt).
 * @returns {{compute(input: {
 *     snapshot: {beta: number, gamma: number, speed: number, c: number, tau: number, t: number},
 *     command?: {thrust?: number, brake?: number, steer?: number, classic?: boolean},
 *     k?: number, a?: number, modeVolant?: 'tilt' | 'drag' | 'clavier',
 *     distanceDevant?: number, facadeDevant?: boolean, regardArriere?: boolean, butee?: boolean,
 *     niveau?: LevelBubbleInput | null
 *   }): Record<string, any>, reset(): void}}
 *   command : commande appliquée (après la butée douce) ; a : accélération propre maximale
 *   (défaut c/10) ; butee : vrai quand la butée douce freine à la place du joueur ;
 *   niveau : variables de la partie de niveau (jalon 3), absentes en conduite libre (valeurs
 *   neutres : enNiveau faux, distances infinies, batterie 1, teintePorte « aucune »).
 */
export function createBubbleVariables() {
  let startTau = null;
  let started = false;
  let turned = false;
  let prev = { thrust: false, brake: false, classic: false, back: false, butee: false };

  return {
    compute({
      snapshot: s,
      command = {},
      k = 1,
      a,
      modeVolant = 'drag',
      distanceDevant = Infinity,
      facadeDevant = false,
      regardArriere = false,
      butee = false,
      niveau = null,
    }) {
      if (startTau === null) startTau = s.tau;
      const brake = (command.brake ?? 0) > 0;
      const thrust = !brake && (command.thrust ?? 0) > 0;
      const turning = Math.abs(command.steer ?? 0) > STEER_THRESHOLD;
      const classic = Boolean(command.classic);

      const evenements = [];
      if (thrust && !started) evenements.push('depart');
      if (prev.thrust && !thrust && s.beta > RELEASE_MIN_BETA) evenements.push('relache');
      if (brake && !prev.brake) evenements.push('frein');
      if (classic && !prev.classic) evenements.push('visionClassique');
      if (regardArriere && !prev.back) evenements.push('regardArriere');
      if (butee && !prev.butee) evenements.push('butee');
      prev = { thrust, brake, classic, back: regardArriere, butee };
      if (thrust) started = true;
      if (turning) turned = true;

      // Distance d'arrêt au frein plein (c²/a)(γ − 1) = (c²/a)(γβ)²/(γ + 1), sans annulation.
      const accel = a > 0 ? a : s.c / 10;
      const gb = s.gamma * s.beta;
      const distanceFreinage = ((s.c * s.c) / accel) * ((gb * gb) / (s.gamma + 1));
      const lv = niveau ?? {};
      const distanceArret = Number.isFinite(lv.distanceArret) ? /** @type {number} */ (lv.distanceArret) : Infinity;
      if (Array.isArray(lv.evenements)) for (const name of lv.evenements) evenements.push(name);

      return {
        beta: s.beta,
        gamma: s.gamma,
        speed: s.speed,
        c: s.c,
        tau: s.tau,
        t: s.t,
        ecart: s.t - s.tau,
        depuisDebut: s.tau - startTau,
        k,
        vitessePropre: s.gamma * s.speed,
        distanceFreinage,
        distanceDevant,
        margeFreinage: distanceFreinage > 0 ? distanceDevant / distanceFreinage : Infinity,
        accelere: thrust,
        freine: brake,
        relache: !thrust && !brake,
        tourne: turning,
        dejaParti: started,
        dejaTourne: turned,
        regardArriere,
        facadeDevant,
        modeVolant,
        enNiveau: niveau !== null,
        distanceArret,
        margeArret: distanceFreinage > 0 ? distanceArret / distanceFreinage : Infinity,
        arretDerriere: Boolean(lv.arretDerriere),
        dansZone: Boolean(lv.dansZone),
        attendClient: Boolean(lv.attendClient),
        porteProche: Boolean(lv.porteProche),
        teintePorte: typeof lv.teintePorte === 'string' ? lv.teintePorte : 'aucune',
        teinteVoulue: Boolean(lv.teinteVoulue),
        batterie: Number.isFinite(lv.batterie) ? lv.batterie : 1,
        margeDelai: Number.isFinite(lv.margeDelai) ? lv.margeDelai : Infinity,
        colisLivres: Number.isFinite(lv.colisLivres) ? lv.colisLivres : 0,
        evenements,
      };
    },

    reset() {
      startTau = null;
      started = false;
      turned = false;
      prev = { thrust: false, brake: false, classic: false, back: false, butee: false };
    },
  };
}

/**
 * Y a-t-il une façade dans l'axe ? Lance `rays` rayons dans un cône de ±halfAngleDeg autour
 * du cap (hx, hy) depuis (x, y), contre les emprises au sol des bâtiments (x, y = centre ;
 * width le long de x, depth le long de y : render/layout.js). Vrai si l'un touche à moins de
 * `range` m. Coût : rays × bâtiments proches ; à appeler à 5 Hz.
 * @param {{x: number, y: number, width: number, depth: number}[]} buildings
 * @param {number} x
 * @param {number} y
 * @param {number} hx
 * @param {number} hy
 * @param {{range?: number, halfAngleDeg?: number, rays?: number}} [options]
 */
export function facadeAhead(buildings, x, y, hx, hy, { range = 300, halfAngleDeg = 20, rays = 5 } = {}) {
  const norm = Math.hypot(hx, hy);
  if (!(norm > 0) || !buildings?.length) return false;
  const half = (halfAngleDeg * Math.PI) / 180;
  const dirs = [];
  for (let i = 0; i < rays; i += 1) {
    const angle = rays === 1 ? 0 : -half + (2 * half * i) / (rays - 1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    dirs.push([(hx * cos - hy * sin) / norm, (hx * sin + hy * cos) / norm]);
  }
  for (const b of buildings) {
    const hw = b.width / 2;
    const hd = b.depth / 2;
    if (Math.hypot(b.x - x, b.y - y) > range + hw + hd) continue;
    for (const [dx, dy] of dirs) {
      // Méthode des dalles : intervalle [tmin, tmax] du rayon dans le rectangle.
      let tmin = 0;
      let tmax = range;
      for (const [o, d, lo, hi] of [
        [x, dx, b.x - hw, b.x + hw],
        [y, dy, b.y - hd, b.y + hd],
      ]) {
        if (Math.abs(d) < 1e-12) {
          if (o < lo || o > hi) tmax = -1;
        } else {
          const t1 = (lo - o) / d;
          const t2 = (hi - o) / d;
          tmin = Math.max(tmin, Math.min(t1, t2));
          tmax = Math.min(tmax, Math.max(t1, t2));
        }
      }
      if (tmin <= tmax) return true;
    }
  }
  return false;
}
