/**
 * Qualité de rendu : rapport de pixels (DPR), antialiasing et garde-fou de démarrage.
 *
 * - DPR par défaut : min(devicePixelRatio, 2), plafonné pour ne pas dépasser MAX_PIXELS
 *   pixels physiques (iPhone 14 Pro Max en paysage : 932 × 430 px CSS à DPR 2 ≈ 1,6 Mpx).
 * - `?dpr=` dans l'URL impose le DPR (mesures, captures).
 * - Garde-fou : un drapeau `gl-boot` est posé par armBootGuard() juste avant de créer le
 *   renderer (pas à l'ouverture de la page : quitter l'écran titre n'est pas un plantage),
 *   en stockage local ET de session (storage.js, clés préfixées « aslower:v1: »), et retiré
 *   par confirmBoot() une fois les premières images affichées, ou si la page est cachée ou
 *   fermée. S'il est encore là au démarrage suivant, la page a planté pendant le démarrage :
 *   - 1er plantage : profil « lite » (DPR 0,75, sans MSAA), mémorisé dans `gl-tier` pendant
 *     LITE_TTL_MS (3 jours), puis retour au profil normal ;
 *   - 2e plantage d'affilée : quality.unstable (crashes ≥ 2) → écran « WebGL instable » avec
 *     un bouton Réessayer. Jamais de coupure définitive : un jeu n'a pas de repli sans WebGL.
 */
import { local, session } from '../storage.js';

/** Plafond de pixels physiques du canevas. */
export const MAX_PIXELS = 2.2e6;
/** Plafond du DPR par défaut. */
export const DPR_MAX = 2;
/** DPR du profil « lite » (après un plantage au démarrage). */
export const DPR_LITE = 0.75;
/** Bornes du DPR imposé par `?dpr=`. */
const DPR_OVERRIDE_MIN = 0.25;
const DPR_OVERRIDE_MAX = 4;

const KEY_BOOT = 'gl-boot';
const KEY_CRASH = 'gl-crash';
const KEY_TIER = 'gl-tier';

/** Durée du profil « lite » après un plantage (ms) : 3 jours, puis nouvel essai normal. */
export const LITE_TTL_MS = 3 * 24 * 3600 * 1000;

/**
 * @typedef {object} Quality
 * @property {'default' | 'lite'} tier profil
 * @property {boolean} antialias MSAA (fixé à la création du contexte)
 * @property {number} dpr DPR visé, avant plafond de pixels
 * @property {number | null} dprOverride DPR imposé par `?dpr=` (sans plafond)
 * @property {number} maxPixels plafond de pixels physiques
 * @property {number} crashes plantages au démarrage consécutifs
 * @property {boolean} unstable deux plantages d'affilée ou plus (« WebGL instable »)
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
 * DPR à appliquer pour un canevas de cssWidth × cssHeight px CSS.
 * @param {Quality} quality
 * @param {number} cssWidth
 * @param {number} cssHeight
 */
export function resolvePixelRatio(quality, cssWidth, cssHeight) {
  if (quality.dprOverride !== null) return quality.dprOverride;
  return capDpr(quality.dpr, cssWidth, cssHeight, quality.maxPixels);
}

/**
 * Garde-fou, lecture seule : constate un éventuel plantage du démarrage précédent
 * (drapeau resté posé) et lit le profil mémorisé. Ne pose pas de drapeau.
 * @param {number} [now] horodatage (ms), pour les tests
 * @returns {{crashes: number, tier: 'default' | 'lite'}}
 */
export function startBootGuard(now = Date.now()) {
  const pending = Boolean(local.get(KEY_BOOT, false) || session.get(KEY_BOOT, false));
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
  local.set(KEY_BOOT, true);
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
 * Qualité de cette session (à appeler UNE fois, avant de créer le renderer : elle
 * déclenche le garde-fou de démarrage).
 * @param {{search?: string, deviceDpr?: number}} [options]
 * @returns {Quality}
 */
export function createQuality({ search, deviceDpr } = {}) {
  const hasWindow = typeof window !== 'undefined';
  const query = search ?? (hasWindow ? window.location.search : '');
  const device = deviceDpr ?? (hasWindow ? window.devicePixelRatio || 1 : 1);
  const { crashes, tier } = startBootGuard();
  return {
    tier,
    antialias: tier !== 'lite',
    dpr: tier === 'lite' ? DPR_LITE : Math.min(device, DPR_MAX),
    dprOverride: parseDprOverride(query),
    maxPixels: MAX_PIXELS,
    crashes,
    unstable: crashes >= 2,
  };
}

function clearBootFlag() {
  local.remove(KEY_BOOT);
  session.remove(KEY_BOOT);
}
