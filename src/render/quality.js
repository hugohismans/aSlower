/**
 * Qualité de rendu : rapport de pixels (DPR), antialiasing et garde-fou de démarrage.
 *
 * - DPR par défaut : min(devicePixelRatio, 2), plafonné pour ne pas dépasser MAX_PIXELS
 *   pixels physiques (iPhone 14 Pro Max en paysage : 932 × 430 px CSS à DPR 2 ≈ 1,6 Mpx).
 * - Décor statique (mobilier, platanes : render/decorLayout.js) : `?decor=0` le coupe (mesures) ;
 *   le profil « lite » en garde DECOR_LITE_DENSITY, sans les petits objets (champ decor). Le
 *   même réglage sert au rendu et aux collisions du niveau : on ne heurte que ce qu'on voit.
 * - `?dpr=` dans l'URL impose le DPR (mesures, captures) ; sinon, en jeu, le DPR adaptatif
 *   (adaptiveDpr.js, piloté par main.js) peut l'abaisser par paliers (champ adaptiveDpr) ; `?qualite=normale` oublie les
 *   plantages mémorisés et le profil « lite ».
 * - Garde-fou : un drapeau `gl-boot` est posé par armBootGuard() juste avant de créer le
 *   renderer (pas à l'ouverture de la page : quitter l'écran titre n'est pas un plantage),
 *   en stockage de session (storage.js, clés préfixées « aslower:v1: »), et retiré
 *   par confirmBoot() une fois les premières images affichées, ou si la page est cachée ou
 *   fermée. S'il est encore là au démarrage suivant, la page a planté pendant le démarrage :
 *   - 1er plantage : profil « lite » (DPR 0,75, sans MSAA), mémorisé dans `gl-tier` pendant
 *     LITE_TTL_MS (3 jours), puis retour au profil normal ;
 *   - 2e plantage d'affilée : quality.unstable (crashes ≥ 2) → écran « WebGL instable » avec
 *     un bouton Réessayer. Jamais de coupure définitive : un jeu n'a pas de repli sans WebGL.
 */
import { local, session } from '../storage.js';
import { facadeDetail } from './facades.js';

/** Plafond de pixels physiques du canevas. */
export const MAX_PIXELS = 2.2e6;
/** Plafond du DPR par défaut. */
export const DPR_MAX = 2;
/** DPR du profil « lite » (après un plantage au démarrage). */
export const DPR_LITE = 0.75;
/** Fraction du décor gardée par le profil « lite » (sans les petits objets). */
export const DECOR_LITE_DENSITY = 0.6;
/** Bornes du DPR imposé par `?dpr=`. */
const DPR_OVERRIDE_MIN = 0.25;
const DPR_OVERRIDE_MAX = 4;

// Clés « v2 » : les états des versions précédentes (drapeau posé dès l'écran titre,
// profil « lite » sans échéance) ne sont plus lus, et sont effacés au chargement.
const KEY_BOOT = 'gl-boot-v2';
const KEY_CRASH = 'gl-crash-v2';
const KEY_TIER = 'gl-tier-v2';
const LEGACY_KEYS = ['gl-boot', 'gl-crash', 'gl-tier'];

/** Durée du profil « lite » après un plantage (ms) : 3 jours, puis nouvel essai normal. */
export const LITE_TTL_MS = 3 * 24 * 3600 * 1000;

/**
 * @typedef {object} Quality
 * @property {'default' | 'lite'} tier profil
 * @property {boolean} antialias MSAA (fixé à la création du contexte)
 * @property {number} dpr DPR visé, avant plafond de pixels
 * @property {number | null} dprOverride DPR imposé par `?dpr=` (sans plafond)
 * @property {number} maxPixels plafond de pixels physiques
 * @property {number | null} adaptiveDpr DPR choisi par le DPR adaptatif (render/adaptiveDpr.js,
 *   écrit par main.js), plafonné par le DPR du profil ; null : DPR du profil
 * @property {{enabled: boolean, density: number, small: boolean}} decor réglage d'exécution du
 *   décor (layout.expandScene, option decor) : `?decor=0`, profil « lite »
 * @property {number} crashes plantages au démarrage consécutifs
 * @property {boolean} unstable deux plantages d'affilée ou plus (« WebGL instable »)
 * @property {0 | 1 | 2} facades détail des motifs de façade : `?facades=0|1|2`, sinon 1
 *   (simplifiés : ni volets, ni balcons, ni joints) en « lite » et 2 (complets) sinon
 */

/**
 * Lit `?dpr=` dans une chaîne de requête ; null si absent ou invalide.
 * @param {string} search ex. location.search
 * @returns {number | null}
 */
export function parseDprOverride(search) {
  const raw = new URLSearchParams(search).get('dpr');
  if (raw === null || raw.trim() === '') return null;
  const dpr = Number(raw.replace(',', '.'));
  if (!Number.isFinite(dpr) || dpr <= 0) return null;
  return Math.min(Math.max(dpr, DPR_OVERRIDE_MIN), DPR_OVERRIDE_MAX);
}

/**
 * Réglage d'exécution du décor : `?decor=0` (ou `non`, `false`) le coupe ; le profil « lite »
 * garde DECOR_LITE_DENSITY du décor, sans les petits objets.
 * @param {string} search ex. location.search
 * @param {'default' | 'lite'} tier
 * @returns {{enabled: boolean, density: number, small: boolean}}
 */
export function decorOptions(search, tier) {
  const raw = new URLSearchParams(search).get('decor');
  const enabled = raw === null || !['0', 'non', 'false'].includes(raw.trim().toLowerCase());
  return tier === 'lite' ? { enabled, density: DECOR_LITE_DENSITY, small: false } : { enabled, density: 1, small: true };
}

/**
 * Plafonne un DPR pour que le canevas ne dépasse pas `maxPixels` pixels physiques.
 * @param {number} dpr
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {number} [maxPixels]
 */
export function capDpr(dpr, cssWidth, cssHeight, maxPixels = MAX_PIXELS) {
  const area = Math.max(cssWidth, 1) * Math.max(cssHeight, 1);
  return Math.min(dpr, Math.sqrt(maxPixels / area));
}

/**
 * DPR du profil pour un canevas de cssWidth × cssHeight px CSS : `?dpr=` s'il est imposé,
 * sinon le DPR visé plafonné en pixels. C'est le plafond du DPR adaptatif.
 * @param {Quality} quality
 * @param {number} cssWidth
 * @param {number} cssHeight
 */
export function profilePixelRatio(quality, cssWidth, cssHeight) {
  if (quality.dprOverride !== null) return quality.dprOverride;
  return capDpr(quality.dpr, cssWidth, cssHeight, quality.maxPixels);
}

/**
 * DPR à appliquer pour un canevas de cssWidth × cssHeight px CSS : celui du profil, abaissé
 * par le DPR adaptatif s'il y en a un (jamais avec `?dpr=`).
 * @param {Quality} quality
 * @param {number} cssWidth
 * @param {number} cssHeight
 */
export function resolvePixelRatio(quality, cssWidth, cssHeight) {
  const profile = profilePixelRatio(quality, cssWidth, cssHeight);
  if (quality.dprOverride !== null || !(quality.adaptiveDpr > 0)) return profile;
  return Math.min(profile, quality.adaptiveDpr);
}

/**
 * Garde-fou, lecture seule : constate un éventuel plantage du démarrage précédent
 * (drapeau resté posé) et lit le profil mémorisé. Ne pose pas de drapeau.
 * @param {number} [now] horodatage (ms), pour les tests
 * @returns {{crashes: number, tier: 'default' | 'lite'}}
 */
export function startBootGuard(now = Date.now()) {
  for (const key of LEGACY_KEYS) {
    local.remove(key);
    session.remove(key);
  }
  // Drapeau en stockage de SESSION seulement : après un vrai plantage, iOS recharge la page
  // dans le même onglet (la session survit) ; un onglet ou un navigateur intégré fermé
  // sur l'écran titre, lui, n'en laisse aucune trace.
  const pending = Boolean(session.get(KEY_BOOT, false));
  let crashes = Number(local.get(KEY_CRASH, 0)) || 0;
  if (pending) {
    crashes += 1;
    local.set(KEY_CRASH, crashes);
    local.set(KEY_TIER, { tier: 'lite', until: now + LITE_TTL_MS });
    clearBootFlag();
  }
  const saved = local.get(KEY_TIER, null);
  // Ancien format (chaîne 'lite' sans échéance) ou échéance passée : profil normal.
  const lite = saved && typeof saved === 'object' && saved.tier === 'lite' && Number(saved.until) > now;
  if (saved && !lite) local.remove(KEY_TIER);
  return { crashes, tier: lite ? 'lite' : 'default' };
}

/**
 * Pose le drapeau de démarrage juste avant la création du renderer et des shaders.
 * Le drapeau est retiré par confirmBoot(), ou quand la page est cachée ou fermée
 * (ce n'est pas un plantage du démarrage).
 */
export function armBootGuard() {
  session.set(KEY_BOOT, true);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', clearBootFlag, { once: true });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') clearBootFlag();
    });
  }
}

/** Démarrage réussi (premières images affichées) : retire le drapeau, remet le compteur à 0. */
export function confirmBoot() {
  clearBootFlag();
  local.set(KEY_CRASH, 0);
}

/**
 * Oublie les plantages et le profil « lite » mémorisés (paramètre d'URL `?qualite=normale`).
 */
export function resetBootGuard() {
  local.remove(KEY_CRASH);
  local.remove(KEY_TIER);
  session.remove(KEY_BOOT);
}

/**
 * Qualité de cette session (à appeler UNE fois, avant de créer le renderer : elle
 * déclenche le garde-fou de démarrage).
 * @param {{search?: string, deviceDpr?: number}} [options]
 * @returns {Quality}
 */
export function createQuality({ search, deviceDpr } = {}) {
  const hasWindow = typeof window !== 'undefined';
  const query = search ?? (hasWindow ? window.location.search : '');
  const device = deviceDpr ?? (hasWindow ? window.devicePixelRatio || 1 : 1);
  if (new URLSearchParams(query).get('qualite') === 'normale') resetBootGuard();
  const { crashes, tier } = startBootGuard();
  return {
    tier,
    antialias: tier !== 'lite',
    dpr: tier === 'lite' ? DPR_LITE : Math.min(device, DPR_MAX),
    dprOverride: parseDprOverride(query),
    maxPixels: MAX_PIXELS,
    adaptiveDpr: null,
    decor: decorOptions(query, tier),
    crashes,
    unstable: crashes >= 2,
    facades: facadeDetail(query, tier),
  };
}

function clearBootFlag() {
  session.remove(KEY_BOOT);
}
