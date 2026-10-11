/**
 * Validation des niveaux « coursier-niveau/1 » (jalon 3). Module pur : reçoit des objets
 * simples (utilisable par un script Node), renvoie des messages « chemin JSON : raison ».
 *
 * ===========================================================================================
 * SCHÉMA « coursier-niveau/1 » (un fichier par niveau : src/levels/nNN-nom.json)
 * ===========================================================================================
 * Conventions : clés françaises camelCase sans accents, ids kebab-case ASCII. Repère du jeu
 * (x vers l'est, y vers le nord, mètres). UNITÉS :
 * - LONGUEUR : un nombre = mètres (échelle humaine : rues, îlots, rayons de zone, hauteurs) ;
 *   une EXPRESSION {fois, de?, plus?, min?, max?, arrondiSup?, arrondiInf?, puisPlus?} = en
 *   unités de L = c²/a = 10·c m (ou d'un paramètre ; render/layout.js). Toutes les distances
 *   « de jeu » (lieux de livraison, portées, départ…) s'écrivent en L, pour que le niveau
 *   garde le même sens pour tout c (10 à 100 m/s).
 * - TEMPS (s) : nombres seulement (délais, batterie, « pas avant », maintien, coûts) : ils ne
 *   dépendent pas de c (c/a = 10 s pour tout c). Temps de la ville t ou temps propre τ, selon
 *   le champ.
 * - VITESSE : fraction de c (β), nombre seulement.
 *
 * {
 *   "schema": "coursier-niveau/1",
 *   "id": "n01-premier-jour",        = nom du fichier sans .json ; ^n\d{2}-[a-z0-9]+(-[a-z0-9]+)*$
 *   "numero": 1,                     entier 1..99 = les deux chiffres de l'id
 *   "titre": "Premier jour",         texte
 *   "notion": "inertie, frein",      notion du jour (texte court, ≤ 60 caractères)
 *   "briefing": ["…", "…"],          1 à 4 lignes de ≤ 140 caractères
 *   "note": "…",                     facultatif : pour les auteurs
 *   "parametres": {"nom": longueur}, facultatif : longueurs nommées, utilisables partout
 *                                    ({"fois": 2, "de": "nom"}), évaluées dans l'ordre
 *   "scene": {…},                    la ville : format « coursier-scene/1 » (render/layout.js :
 *                                    graine, limites, visibilite, rues, rangees, batiments,
 *                                    lampadaires, titre?, description?) SANS schema, id,
 *                                    depart ni parametres (pris au niveau)
 *   "depart": {"pos": [x, y], "capDegres": 90, "beta": 0},   capDegres : 0 = est, 90 = nord ;
 *                                    beta facultatif : départ lancé (fraction de c, < tanh φmax)
 *   "batterie": {"tauMax": 150},     temps propre maximal (s) : τ ≥ tauMax = échec
 *   "phiMax": 3,                     plafond de rapidité, ]0 ; 3] (explicite)
 *   "colis": [{                      au moins un colis obligatoire
 *     "id": "pain", "client": "Boulangerie Planck", "nom": "Pain",   (nom facultatif)
 *     "retrait": {"lieu": [x, y], "rayon": 8, "pasAvant": 30},     facultatif (sinon à bord
 *                                    au départ) ; rayon (longueur, défaut 8 m) ; pasAvant :
 *                                    t ville (s) avant lequel le retrait est impossible
 *     "livraison": {"lieu": [x, y], "rayon": 8, "pasAvant": 40},   pasAvant : client absent
 *     "delai": 60,                   facultatif : t ville (s) ; un retard coûte l'étoile
 *                                    « Ponctuel », jamais la partie
 *     "obligatoire": true
 *   }],
 *   "portes": [{                     facultatif : portes à lampe (Doppler)
 *     "id": "porte-verte", "nom": "…",
 *     "pos": [x, y],                 centre (au sol) ; la lampe est au-dessus
 *     "capDegres": 90,               sens du passage : 0, 90, 180 ou 270
 *     "largeur": 18, "hauteur": 6,   en travers du passage ; hauteur du portail (m, > 0)
 *     "lampe": {"raie": 640 | "corpsNoir": 2700, "intensite": 1, "hauteur": 7,
 *               "allumee": [[0, 30], [60, 90]]},   raie (nm) OU corps noir (K) ; hauteur
 *                                    (défaut : porte + 1 m) ; allumee : intervalles [début,
 *                                    fin[ en t ville (défaut : toujours), vus en t_e = t − d/c
 *     "teinte": "vert",              teinte perçue requise (spectrum.classifyHue)
 *     "portee": [12, {"fois": 0.15, "min": 24}],  distance horizontale véhicule → porte où le
 *                                    capteur regarde : min ≥ 12 m, max − min ≥ 12 m
 *     "maintien": 0.4,               s de temps propre d'affilée avec la bonne teinte
 *     "resteOuverte": 20,            facultatif : refermeture après ce temps de ville (s)
 *     "reprise": "elan-1"            facultatif : reprise après un choc contre la porte fermée
 *   }],
 *   "reprises": [{"id": "elan-1", "pos": [x, y], "capDegres": 90, "cout": 3}],  coût (s)
 *                                    ajouté aux deux horloges ; on repart au repos
 *   "etoiles": {"batterieMin": 0.5, "tVilleMax": 90},   ★ Économe : batterie restante
 *                                    (fraction) ≥ batterieMin ; ★ Ponctuel : t fin ≤ tVilleMax
 *                                    et aucun retard
 *   "bulles": [{…}],                 facultatif : bulles du niveau (schéma des bulles,
 *                                    src/game/bubbles.js ; conditions de src/game/conditions.js)
 *   "indices": [{"apresEchecs": 1, "texte": "…", "aide": "repereFreinage"}],  facultatif ;
 *                                    aide ∈ AIDS ; jamais de coût en étoiles
 *   "parcours": {                    facultatif : itinéraires du bot (tests, calibrage)
 *     "reference": {"note": "…", "etapes": [
 *        {"aller": [x, y], "beta": 0.4, "arret": true, "rayon": 3},   point de passage (β de
 *                                    croisière ; arret : s'y arrêter ; rayon : tolérance m)
 *        {"attendre": 2},            s de temps propre, à l'arrêt
 *        {"attendreJusqua": 40}]},   jusqu'à t ville = 40 s, à l'arrêt
 *     "naif": {"etapes": […]}}       parcours « naïf » (doit faire moins de 3 étoiles)
 * }
 *
 * ===========================================================================================
 * Deux passes : (1) STRUCTURE (clés connues, types, bornes, nombres là où il faut des temps,
 * expressions bien formées) ; (2) SÉMANTIQUE, seulement si la structure est saine, pour chaque
 * c de `lightSpeeds` (10, 30 et 100 m/s par défaut) : id = nom du fichier, numéro, φmax ≤ 3,
 * scène développable (layout.js), aucune géométrie sous le sol (y = 0 en repère Three),
 * capteurs de porte ≥ 12 m, lieux dans la carte, hors des bâtiments et ATTEIGNABLES depuis le
 * départ (remplissage sur une grille de 1 m, portes ouvertes), références d'ids, délais…
 * Un message propre à certains c porte « (c = 10 m/s) ».
 */
import { C_DEFAULT, C_MAX, C_MIN, PHI_MAX_LIMIT, physicsFor } from '../physics/constants.js';
import { PLAYER_RADIUS } from '../physics/collisions.js';
import { expandScene } from '../render/layout.js';
import { BUBBLES_SCHEMA, validateBubbles } from './bubbles.js';
import { DEFAULT_ZONE_RADIUS, doorBox, LEVEL_SCHEMA, resolveLevel, sceneOfLevel } from './level.js';

/** Motif des ids de niveau (= noms de fichiers). */
export const LEVEL_ID_PATTERN = /^n\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/;
/** Motif des autres ids (colis, portes, reprises). */
export const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Distance minimale d'un capteur de porte, et plage minimale (m). */
export const MIN_SENSOR_DISTANCE = 12;
export const MIN_SENSOR_SPAN = 12;
/** Teintes qu'une porte peut demander (spectrum.classifyHue). */
export const HUES = Object.freeze(['rouge', 'orange', 'jaune', 'vert', 'cyan', 'bleu', 'violet', 'blanc', 'gris', 'noir']);
/** Aides que peut proposer un indice. */
export const AIDS = Object.freeze(['repereFreinage', 'zoneVitesse', 'horaire', 'fantome', 'diagramme', 'spectrometre']);
/** Valeurs de c pour lesquelles la sémantique est vérifiée. */
export const VALIDATION_LIGHT_SPEEDS = Object.freeze([C_MIN, C_DEFAULT, C_MAX]);
/** Temps maximal accepté (s). */
export const MAX_TIME = 3600;

const EXPRESSION_KEYS = ['fois', 'de', 'plus', 'min', 'max', 'arrondiSup', 'arrondiInf', 'puisPlus'];
const SCENE_KEYS = ['titre', 'description', 'graine', 'limites', 'visibilite', 'rues', 'rangees', 'batiments', 'lampadaires'];

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
/** Nombre en français, 1 décimale (« 6,0 »). */
const fr = (x) => x.toFixed(1).replace('.', ',');
/** Point en français : « (0,0 ; 500,0) ». */
const pt = (x, y) => `(${fr(x)} ; ${fr(y)})`;
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function show(x) {
  if (x === undefined) return 'rien';
  let text;
  try {
    text = JSON.stringify(x) ?? String(x);
  } catch {
    text = String(x);
  }
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

/**
 * Id d'un niveau d'après le nom (ou le chemin) de son fichier : « …/n01-premier-jour.json »
 * → « n01-premier-jour ».
 * @param {string} fileName
 */
export function levelIdFromFileName(fileName) {
  const base = String(fileName).split(/[\\/]/).pop() ?? '';
  return base.replace(/\.json$/i, '');
}

/* ------------------------------------------------------------------------- */
/* Passe 1 : structure                                                        */
/* ------------------------------------------------------------------------- */

/**
 * Petits vérificateurs : (valeur, chemin, err) → void ; err(chemin, raison).
 * @typedef {(v: any, p: string, err: (p: string, m: string) => void) => void} Check
 */

/** @returns {Check} */
const text = ({ max = Infinity } = {}) => (v, p, err) => {
  if (typeof v !== 'string' || v.trim() === '') return err(p, `texte non vide attendu, reçu ${show(v)}`);
  if ([...v].length > max) err(p, `${[...v].length} caractères, ${max} au plus`);
};
/** @returns {Check} */
const id = (pattern = ID_PATTERN) => (v, p, err) => {
  if (typeof v !== 'string' || !pattern.test(v)) err(p, `identifiant kebab-case ASCII attendu, reçu ${show(v)}`);
};
/** @returns {Check} */
const bool = () => (v, p, err) => {
  if (typeof v !== 'boolean') err(p, `true ou false attendu, reçu ${show(v)}`);
};
/** Nombre simple (pas d'expression), borné. @returns {Check} */
const number = ({ min = -Infinity, max = Infinity, minExclusive = false, integer = false, what = 'nombre' } = {}) => (v, p, err) => {
  if (isPlainObject(v) && hasOwn(v, 'fois')) return err(p, `${what} : nombre attendu, pas d'expression en L (seules les longueurs suivent c)`);
  if (!isNum(v)) return err(p, `${what} : nombre attendu, reçu ${show(v)}`);
  if (integer && !Number.isInteger(v)) err(p, `entier attendu, reçu ${v}`);
  if (v < min || (minExclusive && v === min) || v > max) {
    err(p, `${v} hors de ${minExclusive ? ']' : '['}${min} ; ${max}]`);
  }
};
/** Temps en secondes (indépendant de c). @returns {Check} */
const time = ({ min = 0, max = MAX_TIME, minExclusive = false } = {}) => number({ min, max, minExclusive, what: 'temps en secondes' });

/** Expression de longueur bien formée. */
function checkExpression(v, p, err) {
  for (const key of Object.keys(v)) {
    if (!EXPRESSION_KEYS.includes(key)) err(`${p}.${key}`, `clé inconnue dans une expression (permises : ${EXPRESSION_KEYS.join(', ')})`);
  }
  if (!isNum(v.fois)) err(`${p}.fois`, `nombre attendu, reçu ${show(v.fois)}`);
  if ('de' in v && (typeof v.de !== 'string' || v.de === '')) err(`${p}.de`, `nom de paramètre attendu (« L » par défaut), reçu ${show(v.de)}`);
  for (const key of ['plus', 'min', 'max', 'arrondiSup', 'arrondiInf', 'puisPlus']) {
    if (key in v && !isNum(v[key])) err(`${p}.${key}`, `nombre attendu, reçu ${show(v[key])}`);
  }
  for (const key of ['arrondiSup', 'arrondiInf']) if (key in v && isNum(v[key]) && v[key] <= 0) err(`${p}.${key}`, 'pas positif attendu');
}

/** Longueur : nombre (m) ou expression (en L). @returns {Check} */
const length = ({ positive = false } = {}) => (v, p, err) => {
  if (isPlainObject(v) && hasOwn(v, 'fois')) return checkExpression(v, p, err);
  if (!isNum(v)) return err(p, `longueur attendue : nombre (m) ou expression {fois, de?…} (en L), reçu ${show(v)}`);
  if (positive && !(v > 0)) err(p, `longueur positive attendue, reçu ${v}`);
};
/** Position [x, y] (longueurs). @returns {Check} */
const position = () => (v, p, err) => {
  if (!Array.isArray(v) || v.length !== 2) return err(p, `position [x, y] attendue, reçu ${show(v)}`);
  v.forEach((x, i) => length()(x, `${p}[${i}]`, err));
};
/** @returns {Check} */
const oneOf = (values) => (v, p, err) => {
  if (!values.includes(v)) err(p, `« ${show(v)} » inconnu (permis : ${values.join(', ')})`);
};
/** Liste. @returns {Check} */
const list = (item, { min = 0, max = Infinity } = {}) => (v, p, err) => {
  if (!Array.isArray(v)) return err(p, `liste attendue, reçu ${show(v)}`);
  if (v.length < min) err(p, `au moins ${min} élément${min > 1 ? 's' : ''} attendu${min > 1 ? 's' : ''}`);
  if (v.length > max) err(p, `au plus ${max} éléments`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, err));
};
/**
 * Objet : champs (nom → vérificateur ; « nom? » = facultatif) ; toute autre clé est refusée
 * (faute de frappe probable).
 * @param {Record<string, Check>} fields
 * @param {{label?: (v: any) => string}} [options] label : suffixe du chemin (id de l'élément)
 * @returns {Check}
 */
const object = (fields, { label } = {}) => (v, p, err) => {
  if (!isPlainObject(v)) return err(p, `objet attendu, reçu ${show(v)}`);
  const at = label && typeof v.id === 'string' ? `${p} (${v.id})` : p;
  const known = new Set();
  for (const [key, check] of Object.entries(fields)) {
    const optional = key.endsWith('?');
    const name = optional ? key.slice(0, -1) : key;
    known.add(name);
    if (!hasOwn(v, name)) {
      if (!optional) err(`${at}.${name}`, 'champ obligatoire manquant');
      continue;
    }
    check(v[name], `${at}.${name}`, err);
  }
  for (const key of Object.keys(v)) {
    if (!known.has(key)) err(`${at}.${key}`, `champ inconnu (faute de frappe ?) ; permis : ${[...known].join(', ')}`);
  }
};
/** Accepte tout (vérifié ailleurs). @returns {Check} */
const any = () => () => {};

/** Lampe d'une porte : raie OU corps noir. @type {Check} */
const lampCheck = (v, p, err) => {
  object({
    'raie?': number({ min: 100, max: 3000, what: 'longueur d’onde (nm)' }),
    'corpsNoir?': number({ min: 500, max: 50000, what: 'température (K)' }),
    'intensite?': number({ min: 0, max: 100, minExclusive: true }),
    'hauteur?': length(),
    'allumee?': list((iv, ip, e) => {
      if (!Array.isArray(iv) || iv.length !== 2) return e(ip, `intervalle [début, fin] (t ville, s) attendu, reçu ${show(iv)}`);
      iv.forEach((x, i) => time()(x, `${ip}[${i}]`, e));
      if (isNum(iv[0]) && isNum(iv[1]) && !(iv[1] > iv[0])) e(ip, 'fin après le début attendue');
    }),
  })(v, p, err);
  if (isPlainObject(v) && ('raie' in v) === ('corpsNoir' in v)) {
    err(p, 'donner soit « raie » (nm), soit « corpsNoir » (K), pas les deux ni aucun');
  }
};

const stopCheck = object({ lieu: position(), 'rayon?': length({ positive: true }), 'pasAvant?': time() });

const stepCheck = (v, p, err) => {
  if (!isPlainObject(v)) return err(p, `étape attendue, reçu ${show(v)}`);
  if ('aller' in v) {
    object({ aller: position(), beta: number({ min: 0, max: 0.995, minExclusive: true }), 'arret?': bool(), 'rayon?': length({ positive: true }) })(v, p, err);
  } else if ('attendre' in v) {
    object({ attendre: time() })(v, p, err);
  } else if ('attendreJusqua' in v) {
    object({ attendreJusqua: time() })(v, p, err);
  } else {
    err(p, 'étape inconnue (aller, attendre ou attendreJusqua)');
  }
};
const routeCheck = object({ 'note?': text(), etapes: list(stepCheck, { min: 1 }) });

/** Schéma de structure d'un niveau. */
const LEVEL_STRUCTURE = object({
  schema: oneOf([LEVEL_SCHEMA]),
  id: id(LEVEL_ID_PATTERN),
  numero: number({ min: 1, max: 99, integer: true }),
  titre: text({ max: 60 }),
  notion: text({ max: 60 }),
  briefing: list(text({ max: 140 }), { min: 1, max: 4 }),
  'note?': text(),
  'parametres?': (v, p, err) => {
    if (!isPlainObject(v)) return err(p, `objet {nom: longueur} attendu, reçu ${show(v)}`);
    for (const [k, x] of Object.entries(v)) {
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) err(`${p}.${k}`, 'nom de paramètre en camelCase attendu');
      if (k === 'L' || k === 'visibilite') err(`${p}.${k}`, 'nom réservé (L et visibilite sont prédéfinis)');
      length()(x, `${p}.${k}`, err);
    }
  },
  scene: (v, p, err) => {
    if (!isPlainObject(v)) return err(p, `scène attendue (format coursier-scene/1), reçu ${show(v)}`);
    for (const key of Object.keys(v)) {
      if (key === 'schema' || key === 'id') err(`${p}.${key}`, 'pris au niveau : ne pas le répéter dans la scène');
      else if (key === 'depart') err(`${p}.depart`, 'le départ se donne au niveau (« depart »), pas dans la scène');
      else if (key === 'parametres') err(`${p}.parametres`, 'les paramètres se donnent au niveau (« parametres »)');
      else if (!SCENE_KEYS.includes(key)) err(`${p}.${key}`, `champ inconnu (faute de frappe ?) ; permis : ${SCENE_KEYS.join(', ')}`);
    }
  },
  depart: object({ pos: position(), capDegres: number({ min: -360, max: 360 }), 'beta?': number({ min: 0, max: 0.995 }) }),
  batterie: object({ tauMax: time({ min: 0, minExclusive: true }) }),
  phiMax: number({ min: 0, max: PHI_MAX_LIMIT, minExclusive: true, what: 'plafond de rapidité φmax' }),
  colis: list(
    object(
      {
        id: id(),
        client: text({ max: 60 }),
        'nom?': text({ max: 60 }),
        'retrait?': stopCheck,
        livraison: stopCheck,
        'delai?': time({ min: 0, minExclusive: true }),
        obligatoire: bool(),
      },
      { label: true },
    ),
    { min: 1 },
  ),
  'portes?': list(
    object(
      {
        id: id(),
        'nom?': text({ max: 60 }),
        pos: position(),
        capDegres: oneOf([0, 90, 180, 270]),
        largeur: length({ positive: true }),
        hauteur: length({ positive: true }),
        lampe: lampCheck,
        teinte: oneOf(HUES),
        portee: (v, p, err) => {
          if (!Array.isArray(v) || v.length !== 2) return err(p, `[min, max] (longueurs) attendu, reçu ${show(v)}`);
          v.forEach((x, i) => length({ positive: true })(x, `${p}[${i}]`, err));
        },
        maintien: time({ max: 10 }),
        'resteOuverte?': time({ min: 0, minExclusive: true }),
        'reprise?': id(),
      },
      { label: true },
    ),
  ),
  'reprises?': list(object({ id: id(), pos: position(), capDegres: number({ min: -360, max: 360 }), cout: time({ max: 120 }) }, { label: true })),
  etoiles: object({
    batterieMin: number({ min: 0, max: 1, what: 'fraction de batterie' }),
    tVilleMax: time({ min: 0, minExclusive: true }),
  }),
  'bulles?': list(any(), { min: 1 }),
  'indices?': list(object({ apresEchecs: number({ min: 1, max: 20, integer: true }), texte: text({ max: 140 }), 'aide?': oneOf(AIDS) })),
  'parcours?': object({ reference: routeCheck, 'naif?': routeCheck }),
});

/* ------------------------------------------------------------------------- */
/* Passe 2 : sémantique                                                       */
/* ------------------------------------------------------------------------- */

/** Distance d'un point à une emprise {x, y, width, depth}. */
function distanceToBuilding(px, py, b) {
  const dx = Math.max(b.x - b.width / 2 - px, 0, px - b.x - b.width / 2);
  const dy = Math.max(b.y - b.depth / 2 - py, 0, py - b.y - b.depth / 2);
  return Math.hypot(dx, dy);
}

/**
 * Grille d'accessibilité : cases libres (centre à ≥ rayon du véhicule de tout bâtiment et
 * du bord), remplissage depuis le départ (4-voisinage). Les portes sont supposées ouvertes.
 * @param {{buildings: any[], bounds: {xmin: number, ymin: number, xmax: number, ymax: number}}} scene
 * @param {{x: number, y: number}} start
 * @param {number} radius
 */
export function reachabilityGrid(scene, start, radius = PLAYER_RADIUS) {
  const { xmin, ymin, xmax, ymax } = scene.bounds;
  const area = (xmax - xmin) * (ymax - ymin);
  const cell = Math.max(1, Math.sqrt(area / 4e6));
  const nx = Math.max(1, Math.ceil((xmax - xmin) / cell));
  const ny = Math.max(1, Math.ceil((ymax - ymin) / cell));
  const blocked = new Uint8Array(nx * ny);
  const cx = (i) => xmin + (i + 0.5) * cell;
  const cy = (j) => ymin + (j + 0.5) * cell;
  // Bords : centre à moins du rayon du bord.
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const x = cx(i);
      const y = cy(j);
      if (x - xmin < radius || xmax - x < radius || y - ymin < radius || ymax - y < radius) blocked[j * nx + i] = 1;
    }
  }
  for (const b of scene.buildings) {
    const x0 = b.x - b.width / 2 - radius;
    const x1 = b.x + b.width / 2 + radius;
    const y0 = b.y - b.depth / 2 - radius;
    const y1 = b.y + b.depth / 2 + radius;
    const i0 = Math.max(0, Math.ceil((x0 - xmin) / cell - 0.5));
    const i1 = Math.min(nx - 1, Math.floor((x1 - xmin) / cell - 0.5));
    const j0 = Math.max(0, Math.ceil((y0 - ymin) / cell - 0.5));
    const j1 = Math.min(ny - 1, Math.floor((y1 - ymin) / cell - 0.5));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * nx + i] = 1;
  }
  const reached = new Uint8Array(nx * ny);
  const cellOf = (x, y) => {
    const i = Math.floor((x - xmin) / cell);
    const j = Math.floor((y - ymin) / cell);
    return i >= 0 && i < nx && j >= 0 && j < ny ? j * nx + i : -1;
  };
  // Départ : la case libre la plus proche à moins d'une case.
  let seed = -1;
  let bestD = Infinity;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const k = cellOf(start.x + di * cell, start.y + dj * cell);
      if (k < 0 || blocked[k]) continue;
      const d = Math.hypot(cx(k % nx) - start.x, cy(Math.floor(k / nx)) - start.y);
      if (d < bestD) {
        bestD = d;
        seed = k;
      }
    }
  }
  if (seed >= 0) {
    const queue = new Int32Array(nx * ny);
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    reached[seed] = 1;
    while (head < tail) {
      const k = queue[head++];
      const i = k % nx;
      const j = (k - i) / nx;
      const visit = (q) => {
        if (!blocked[q] && !reached[q]) {
          reached[q] = 1;
          queue[tail++] = q;
        }
      };
      if (i > 0) visit(k - 1);
      if (i < nx - 1) visit(k + 1);
      if (j > 0) visit(k - nx);
      if (j < ny - 1) visit(k + nx);
    }
  }
  return {
    cell,
    startReached: seed >= 0,
    /** Une case atteinte dont le centre est à ≤ r du point (r ≥ une demi-case). */
    reachable(x, y, r = 0) {
      const rr = Math.max(r, cell);
      const i0 = Math.max(0, Math.floor((x - rr - xmin) / cell));
      const i1 = Math.min(nx - 1, Math.floor((x + rr - xmin) / cell));
      const j0 = Math.max(0, Math.floor((y - rr - ymin) / cell));
      const j1 = Math.min(ny - 1, Math.floor((y + rr - ymin) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (reached[j * nx + i] && Math.hypot(cx(i) - x, cy(j) - y) <= rr) return true;
        }
      }
      return false;
    },
  };
}

/**
 * Vérifications sémantiques pour une valeur de c. Lève une exception si la résolution des
 * longueurs ou le développement de la scène échouent (rattrapée par l'appelant).
 */
function semanticForC(json, c, palette, err, warn) {
  const physics = physicsFor(c);
  let level;
  try {
    level = resolveLevel(json, physics.lengthUnit);
  } catch (error) {
    err('', `longueurs : ${/** @type {Error} */ (error).message}`);
    return;
  }
  let scene;
  try {
    scene = expandScene(sceneOfLevel(level), palette, { lengthUnit: physics.lengthUnit });
  } catch (error) {
    err('scene', /** @type {Error} */ (error).message);
    return;
  }
  const { bounds, buildings } = scene;
  const inBounds = (x, y) => x >= bounds.xmin && x <= bounds.xmax && y >= bounds.ymin && y <= bounds.ymax;
  const insideBuilding = (x, y, margin = 0) => buildings.find((b) => distanceToBuilding(x, y, b) < margin + 1e-9);

  // Aucune géométrie sous le sol (y = 0 en repère Three, z = 0 du jeu).
  for (const b of buildings) {
    if (!(b.height > 0)) err('scene', `bâtiment de l'îlot ${b.blockId} : hauteur ${b.height} m (aucune géométrie sous le sol)`);
  }
  for (const l of scene.lamps) if (!(l.height >= 0)) err('scene.lampadaires', `hauteur ${l.height} m sous le sol`);

  const start = { x: level.depart.pos[0], y: level.depart.pos[1] };
  const grid = reachabilityGrid(scene, start);
  const pointCheck = (x, y, p, what, { zone = 0 } = {}) => {
    if (!inBounds(x, y)) {
      err(p, `${what} ${pt(x, y)} hors des limites de la carte`);
      return;
    }
    if (zone === 0) {
      // Un point (reprise) : le véhicule doit pouvoir s'y poser.
      const b = insideBuilding(x, y, PLAYER_RADIUS);
      if (b) {
        err(p, `${what} ${pt(x, y)} dans un bâtiment (îlot ${b.blockId}) ou à moins de ${fr(PLAYER_RADIUS)} m`);
        return;
      }
    }
    // Une zone : au moins un point de la zone doit être atteignable depuis le départ.
    if (grid.startReached && !grid.reachable(x, y, zone)) err(p, `${what} inaccessible depuis le départ (dans un bâtiment ou enclavé ?)`);
  };

  // Départ.
  if (!inBounds(start.x, start.y)) err('depart.pos', 'départ hors des limites de la carte');
  else if (insideBuilding(start.x, start.y, PLAYER_RADIUS)) err('depart.pos', 'départ dans un bâtiment ou à moins de 0,6 m');
  else if (!grid.startReached) err('depart.pos', 'départ sans case libre autour');
  if (level.depart.beta !== undefined && level.depart.beta >= Math.tanh(level.phiMax)) {
    err('depart.beta', `β = ${level.depart.beta} au-delà du plafond tanh(φmax) = ${Math.tanh(level.phiMax).toFixed(4)}`);
  }

  // Colis.
  level.colis.forEach((p, i) => {
    const at = `colis[${i}] (${p.id})`;
    for (const kind of ['retrait', 'livraison']) {
      const stop = p[kind];
      if (!stop) continue;
      const r = stop.rayon ?? DEFAULT_ZONE_RADIUS;
      if (!(r > 0)) err(`${at}.${kind}.rayon`, `rayon positif attendu (${r} m)`);
      pointCheck(stop.lieu[0], stop.lieu[1], `${at}.${kind}.lieu`, `zone de ${kind}`, { zone: Math.max(r, 0) });
    }
  });

  // Portes.
  (level.portes ?? []).forEach((d, i) => {
    const at = `portes[${i}] (${d.id})`;
    const [lo, hi] = d.portee;
    if (lo < MIN_SENSOR_DISTANCE) err(`${at}.portee[0]`, `capteur à ${lo} m : au moins ${MIN_SENSOR_DISTANCE} m (sous la porte, l'angle fausse la teinte)`);
    if (hi - lo < MIN_SENSOR_SPAN) err(`${at}.portee`, `plage de ${fr(hi - lo)} m : au moins ${MIN_SENSOR_SPAN} m (utiliser {"fois": …, "min": …})`);
    if (hi > scene.visibility.default) warn(`${at}.portee[1]`, `${hi} m au-delà de la visibilité (${scene.visibility.default} m) : la lampe doit rester dessinée`);
    if (!(d.hauteur > 0)) err(`${at}.hauteur`, 'hauteur positive attendue (aucune géométrie sous le sol)');
    if (!(d.largeur > 0)) err(`${at}.largeur`, 'largeur positive attendue');
    const lampZ = d.lampe.hauteur ?? d.hauteur + 1;
    if (!(lampZ >= 0)) err(`${at}.lampe.hauteur`, `lampe à ${lampZ} m : sous le sol`);
    if (!inBounds(d.pos[0], d.pos[1])) err(`${at}.pos`, 'porte hors des limites de la carte');
    else if (insideBuilding(d.pos[0], d.pos[1])) err(`${at}.pos`, 'porte dans un bâtiment');
    const box = doorBox({ x: d.pos[0], y: d.pos[1], capDegres: d.capDegres, largeur: d.largeur }, d.id);
    if (Math.hypot(start.x - Math.min(Math.max(start.x, box.x0), box.x1), start.y - Math.min(Math.max(start.y, box.y0), box.y1)) < PLAYER_RADIUS) {
      err(`${at}.pos`, 'la porte fermée recouvre le départ');
    }
  });

  // Reprises.
  (level.reprises ?? []).forEach((r, i) => pointCheck(r.pos[0], r.pos[1], `reprises[${i}] (${r.id}).pos`, 'point de reprise'));

  // Parcours du bot : points de passage dans la carte.
  for (const name of ['reference', 'naif']) {
    const route = level.parcours?.[name];
    if (!route) continue;
    route.etapes.forEach((s, i) => {
      if (s.aller && !inBounds(s.aller[0], s.aller[1])) err(`parcours.${name}.etapes[${i}].aller`, 'point hors des limites de la carte');
    });
  }
}

/**
 * Valide un niveau. Passe 1 (structure) puis, si elle est saine, passe 2 (sémantique) pour
 * chaque c de `lightSpeeds`.
 * @param {unknown} json contenu du fichier
 * @param {{fileName?: string, palette: Record<string, any>, lightSpeeds?: readonly number[],
 *          globalBubbleIds?: Iterable<string>}} options
 *   fileName : nom ou chemin du fichier (vérifie id = nom) ; palette : src/data/palette.json ;
 *   globalBubbleIds : ids des bulles globales (src/data/bubbles.json), interdits au niveau
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 *   messages « chemin JSON : raison », préfixés par le nom du fichier s'il est donné
 */
export function validateLevel(json, { fileName, palette, lightSpeeds = VALIDATION_LIGHT_SPEEDS, globalBubbleIds = [] } = /** @type {any} */ ({})) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const prefix = fileName ? `${levelIdFromFileName(fileName)}.json › ` : '';
  const fmt = (p, m) => `${prefix}${p ? `${p} : ` : ''}${m}`;
  const err = (p, m) => errors.push(fmt(p, m));

  // Passe 1 : structure.
  LEVEL_STRUCTURE(json, '', (p, m) => err(p.replace(/^\./, ''), m));
  const doc = /** @type {any} */ (json);
  if (isPlainObject(doc) && Array.isArray(doc.bulles) && doc.bulles.length > 0) {
    for (const e of validateBubbles({ schema: BUBBLES_SCHEMA, bulles: doc.bulles })) errors.push(`${prefix}${e}`);
  }
  if (errors.length) return { ok: false, errors, warnings };

  // Identité.
  if (fileName !== undefined) {
    const expected = levelIdFromFileName(fileName);
    if (doc.id !== expected) err('id', `« ${doc.id} » au lieu du nom de fichier « ${expected} »`);
  }
  if (Number(doc.id.slice(1, 3)) !== doc.numero) err('numero', `${doc.numero} au lieu de ${Number(doc.id.slice(1, 3))} (les deux chiffres de l'id)`);
  if (!(doc.phiMax <= PHI_MAX_LIMIT)) err('phiMax', `φmax = ${doc.phiMax} > ${PHI_MAX_LIMIT}`);

  // Ids uniques et références.
  const owners = new Map();
  const note = (value, p) => {
    if (owners.has(value)) err(p, `id « ${value} » déjà utilisé (${owners.get(value)})`);
    else owners.set(value, p);
  };
  doc.colis.forEach((p, i) => note(p.id, `colis[${i}].id`));
  (doc.portes ?? []).forEach((p, i) => note(p.id, `portes[${i}].id`));
  (doc.reprises ?? []).forEach((p, i) => note(p.id, `reprises[${i}].id`));
  const repriseIds = new Set((doc.reprises ?? []).map((r) => r.id));
  (doc.portes ?? []).forEach((d, i) => {
    if (d.reprise !== undefined && !repriseIds.has(d.reprise)) {
      err(`portes[${i}] (${d.id}).reprise`, `reprise « ${d.reprise} » inconnue (connues : ${[...repriseIds].join(', ') || 'aucune'})`);
    }
  });
  const globalIds = new Set(globalBubbleIds);
  (doc.bulles ?? []).forEach((b, i) => {
    if (globalIds.has(b.id)) err(`bulles[${i}] (${b.id}).id`, 'id déjà pris par une bulle globale (src/data/bubbles.json)');
  });

  // Colis, délais, étoiles.
  if (!doc.colis.some((p) => p.obligatoire)) err('colis', 'au moins un colis obligatoire attendu');
  doc.colis.forEach((p, i) => {
    const at = `colis[${i}] (${p.id})`;
    if (p.delai !== undefined) {
      if (p.livraison.pasAvant !== undefined && p.livraison.pasAvant >= p.delai) {
        err(`${at}.livraison.pasAvant`, `client absent jusqu'à t = ${p.livraison.pasAvant} s, délai ${p.delai} s : impossible d'être à l'heure`);
      }
      if (p.retrait?.pasAvant !== undefined && p.retrait.pasAvant >= p.delai) {
        err(`${at}.retrait.pasAvant`, `retrait possible à t = ${p.retrait.pasAvant} s, délai ${p.delai} s : impossible d'être à l'heure`);
      }
    }
  });
  if (doc.etoiles.batterieMin === 0) warnings.push(fmt('etoiles.batterieMin', '0 : étoile « Économe » gratuite'));
  if (doc.etoiles.batterieMin >= 1) err('etoiles.batterieMin', 'au moins une fraction < 1 attendue (étoile impossible)');

  // Indices : apresEchecs croissants.
  (doc.indices ?? []).forEach((h, i, all) => {
    if (i > 0 && h.apresEchecs < all[i - 1].apresEchecs) err(`indices[${i}].apresEchecs`, 'indices rangés par apresEchecs croissant attendus');
  });

  // Passe 2 : pour chaque c.
  /** @type {Map<string, number[]>} */
  const perC = new Map();
  /** @type {Map<string, number[]>} */
  const warnPerC = new Map();
  const speeds = [...lightSpeeds];
  for (const c of speeds) {
    semanticForC(
      doc,
      c,
      palette,
      (p, m) => {
        const key = p ? `${p} : ${m}` : m;
        perC.set(key, [...(perC.get(key) ?? []), c]);
      },
      (p, m) => {
        const key = p ? `${p} : ${m}` : m;
        warnPerC.set(key, [...(warnPerC.get(key) ?? []), c]);
      },
    );
  }
  const suffix = (cs) => (cs.length === speeds.length ? '' : ` (c = ${cs.join(', ')} m/s)`);
  for (const [m, cs] of perC) errors.push(`${prefix}${m}${suffix(cs)}`);
  for (const [m, cs] of warnPerC) warnings.push(`${prefix}${m}${suffix(cs)}`);
  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Comme validateLevel, mais lève une Error qui liste les erreurs (au plus `max`).
 * @param {unknown} json
 * @param {Parameters<typeof validateLevel>[1]} options
 * @param {number} [max]
 */
export function assertValidLevel(json, options, max = 10) {
  const { errors } = validateLevel(json, options);
  if (errors.length) {
    const more = errors.length > max ? `\n- … et ${errors.length - max} autre(s)` : '';
    throw new Error(`Niveau invalide :\n- ${errors.slice(0, max).join('\n- ')}${more}`);
  }
}
