/**
 * Progression du joueur (jalon 3) : étoiles, records et déblocages, mémorisés sous
 * `aslower:v1:progression` par storage.js (try/catch, repli en mémoire). Les fonctions de
 * calcul sont pures (elles renvoient une NOUVELLE progression) ; seuls loadProgress et
 * saveProgress touchent le stockage, injectable (`store`, défaut : `local`).
 *
 * Les records sont gardés PAR NIVEAU ET PAR VALEUR DE c (la vitesse de la lumière est un
 * réglage du joueur : un niveau n'a pas la même difficulté à c = 10 et à c = 100). Les étoiles
 * d'un niveau (sélection, déblocage) sont les meilleures, tous c confondus.
 *
 * Format (version 1) :
 * {
 *   "version": 1,
 *   "niveaux": {
 *     "n01-premier-jour": {
 *       "echecs": 2,              échecs cumulés (tous c) ; « passer » dès SKIP_AFTER_FAILURES
 *       "passe": false,           niveau passé sans réussite (débloque le suivant, 0 étoile)
 *       "parC": {"30": {"etoiles": 3, "meilleureBatterie": 0.62, "meilleurTVille": 41.2,
 *                       "reussites": 2}}
 *     }
 *   }
 * }
 * Déblocage : le premier niveau l'est toujours ; le niveau i l'est si le niveau i − 1 est
 * réussi (au moins une étoile, à n'importe quel c) ou passé.
 */
import { local } from '../storage.js';
import { SKIP_AFTER_FAILURES } from './states.js';

/** Clé de stockage (sans le préfixe aslower:v1:). */
export const PROGRESS_KEY = 'progression';
export const PROGRESS_VERSION = 1;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Progression vide. */
export function emptyProgress() {
  return { version: PROGRESS_VERSION, niveaux: {} };
}

/**
 * Progression nettoyée (valeur abîmée, d'une autre version ou d'un autre format : ce qui est
 * lisible est gardé, le reste ignoré).
 * @param {unknown} raw
 */
export function sanitizeProgress(raw) {
  const out = emptyProgress();
  if (!isPlainObject(raw) || /** @type {any} */ (raw).version !== PROGRESS_VERSION) return out;
  const niveaux = /** @type {any} */ (raw).niveaux;
  if (!isPlainObject(niveaux)) return out;
  for (const [id, entry] of Object.entries(niveaux)) {
    if (!isPlainObject(entry) || !/^n\d{2}-[a-z0-9-]+$/.test(id)) continue;
    const clean = { echecs: 0, passe: false, parC: {} };
    if (Number.isInteger(entry.echecs) && entry.echecs >= 0) clean.echecs = entry.echecs;
    clean.passe = entry.passe === true;
    if (isPlainObject(entry.parC)) {
      for (const [c, rec] of Object.entries(entry.parC)) {
        if (!/^\d{1,3}$/.test(c) || !isPlainObject(rec)) continue;
        if (!(Number.isInteger(rec.etoiles) && rec.etoiles >= 0 && rec.etoiles <= 3)) continue;
        clean.parC[c] = {
          etoiles: rec.etoiles,
          meilleureBatterie: isNum(rec.meilleureBatterie) ? rec.meilleureBatterie : null,
          meilleurTVille: isNum(rec.meilleurTVille) ? rec.meilleurTVille : null,
          reussites: Number.isInteger(rec.reussites) && rec.reussites >= 0 ? rec.reussites : 0,
        };
      }
    }
    out.niveaux[id] = clean;
  }
  return out;
}

/**
 * @param {{get(key: string, fallback?: any): any}} [store]
 */
export function loadProgress(store = local) {
  let raw;
  try {
    raw = store.get(PROGRESS_KEY, null);
  } catch {
    raw = null;
  }
  return sanitizeProgress(raw);
}

/**
 * @param {ReturnType<typeof emptyProgress>} progress
 * @param {{set(key: string, value: any): any}} [store]
 * @returns {boolean} vrai si écrit durablement (faux : gardé en mémoire seulement)
 */
export function saveProgress(progress, store = local) {
  try {
    return store.set(PROGRESS_KEY, progress) !== false;
  } catch {
    return false;
  }
}

/** Copie profonde (données JSON). */
const clone = (p) => JSON.parse(JSON.stringify(p));

function entryOf(progress, levelId) {
  return progress.niveaux[levelId] ?? { echecs: 0, passe: false, parC: {} };
}

/**
 * Enregistre une partie terminée. Pure : renvoie une nouvelle progression et les records
 * battus (pour le bilan).
 * @param {ReturnType<typeof emptyProgress>} progress
 * @param {string} levelId
 * @param {number} c vitesse de la lumière de la partie
 * @param {{reussite: boolean, etoiles: number, batterieRestante?: number, tFin?: number}} result
 *   (un Score de score.js convient : batterieRestante et tFin sont lus dans econome / ponctuel)
 * @returns {{progress: ReturnType<typeof emptyProgress>, records: {etoiles: boolean,
 *            batterie: boolean, tVille: boolean, premiereReussite: boolean}}}
 */
export function recordResult(progress, levelId, c, result) {
  const next = clone(progress);
  const entry = clone(entryOf(progress, levelId));
  const records = { etoiles: false, batterie: false, tVille: false, premiereReussite: false };
  const r = /** @type {any} */ (result);
  if (!r.reussite) {
    entry.echecs += 1;
    next.niveaux[levelId] = entry;
    return { progress: next, records };
  }
  const battery = r.batterieRestante ?? r.econome?.batterieRestante ?? null;
  const tFin = r.tFin ?? r.ponctuel?.tFin ?? null;
  const key = String(c);
  const before = entry.parC[key] ?? { etoiles: 0, meilleureBatterie: null, meilleurTVille: null, reussites: 0 };
  records.premiereReussite = !levelSucceeded(progress, levelId);
  const rec = { ...before, reussites: before.reussites + 1 };
  if (r.etoiles > before.etoiles) {
    rec.etoiles = r.etoiles;
    records.etoiles = true;
  }
  if (isNum(battery) && (before.meilleureBatterie === null || battery > before.meilleureBatterie)) {
    rec.meilleureBatterie = battery;
    records.batterie = before.reussites > 0;
  }
  if (isNum(tFin) && (before.meilleurTVille === null || tFin < before.meilleurTVille)) {
    rec.meilleurTVille = tFin;
    records.tVille = before.reussites > 0;
  }
  entry.parC[key] = rec;
  next.niveaux[levelId] = entry;
  return { progress: next, records };
}

/**
 * « Passer » le niveau (après SKIP_AFTER_FAILURES échecs) : débloque le suivant, 0 étoile.
 * @param {ReturnType<typeof emptyProgress>} progress
 * @param {string} levelId
 */
export function recordSkip(progress, levelId) {
  const next = clone(progress);
  next.niveaux[levelId] = { ...clone(entryOf(progress, levelId)), passe: true };
  return next;
}

/** Le niveau a-t-il été réussi (à n'importe quel c) ? */
export function levelSucceeded(progress, levelId) {
  const entry = progress.niveaux[levelId];
  return Boolean(entry && Object.values(entry.parC).some((r) => r.etoiles > 0));
}

/** « Passer » est-il proposé ? (pas encore réussi, au moins SKIP_AFTER_FAILURES échecs) */
export function canSkip(progress, levelId) {
  const entry = progress.niveaux[levelId];
  return Boolean(entry && !levelSucceeded(progress, levelId) && entry.echecs >= SKIP_AFTER_FAILURES);
}

/**
 * Niveau débloqué ? Le premier toujours ; sinon le précédent réussi ou passé.
 * @param {ReturnType<typeof emptyProgress>} progress
 * @param {readonly string[]} levelIds ids dans l'ordre des numéros
 * @param {string} levelId
 */
export function isUnlocked(progress, levelIds, levelId) {
  const i = levelIds.indexOf(levelId);
  if (i < 0) return false;
  if (i === 0) return true;
  const prev = levelIds[i - 1];
  return levelSucceeded(progress, prev) || progress.niveaux[prev]?.passe === true;
}

/**
 * Résumé d'un niveau pour la sélection et le bilan.
 * @param {ReturnType<typeof emptyProgress>} progress
 * @param {string} levelId
 * @param {number} [c] si donné : records à ce c (les étoiles restent les meilleures tous c)
 * @returns {{etoiles: number, etoilesC: number | null, meilleureBatterie: number | null,
 *            meilleurTVille: number | null, echecs: number, passe: boolean, reussi: boolean}}
 */
export function levelStats(progress, levelId, c) {
  const entry = progress.niveaux[levelId];
  const all = entry ? Object.values(entry.parC) : [];
  const atC = entry && c !== undefined ? entry.parC[String(c)] ?? null : null;
  return {
    etoiles: all.reduce((m, r) => Math.max(m, r.etoiles), 0),
    etoilesC: atC ? atC.etoiles : c !== undefined ? 0 : null,
    meilleureBatterie: atC ? atC.meilleureBatterie : null,
    meilleurTVille: atC ? atC.meilleurTVille : null,
    echecs: entry?.echecs ?? 0,
    passe: entry?.passe ?? false,
    reussi: levelSucceeded(progress, levelId),
  };
}

/** Somme des meilleures étoiles des niveaux donnés. */
export function totalStars(progress, levelIds) {
  return levelIds.reduce((sum, id) => sum + levelStats(progress, id).etoiles, 0);
}
