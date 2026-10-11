/**
 * Réglages du joueur : vitesse de la lumière c (entier de C_MIN à C_MAX m/s).
 *
 * - Mémorisés par storage.js sous la clé `aslower:v1:reglages` → {c} ;
 * - paramètre d'URL `?c=n`, prioritaire (tests automatisés, liens partagés), jamais mémorisé ;
 * - valeur non entière ou illisible : refusée, avec un message ; entière hors de la plage :
 *   ramenée dans la plage, avec un message.
 *
 * Les constantes physiques de la partie en découlent : physicsFor(c) (constants.js).
 */
import { C_DEFAULT, C_MAX, C_MIN } from '../physics/constants.js';
import { local } from '../storage.js';

/** Clé de stockage des réglages (sans le préfixe, ajouté par storage.js). */
export const SETTINGS_KEY = 'reglages';

/** Préréglages proposés sur l'écran titre (m/s). */
export const LIGHT_SPEED_PRESETS = Object.freeze([10, 30, 50, 100]);

/**
 * Lit une vitesse de la lumière proposée (texte d'un champ, paramètre d'URL ou nombre).
 * @param {unknown} raw
 * @returns {{c: number | null, message: string}} c = null si la valeur est refusée
 *   (non numérique ou non entière) ; message vide si la valeur est acceptée telle quelle.
 */
export function parseLightSpeed(raw) {
  const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim().replace(',', '.');
  const range = `un entier de ${C_MIN} à ${C_MAX} m/s`;
  if (text === '') return { c: null, message: `Indique ${range}.` };
  const n = Number(text);
  if (!Number.isFinite(n)) return { c: null, message: `« ${text} » n'est pas un nombre : indique ${range}.` };
  if (!Number.isInteger(n)) return { c: null, message: `c doit être un nombre entier (${text.replace('.', ',')} refusé) : indique ${range}.` };
  if (n < C_MIN) return { c: C_MIN, message: `${n} m/s est trop bas : c ramenée à ${C_MIN} m/s.` };
  if (n > C_MAX) return { c: C_MAX, message: `${n} m/s est trop haut : c ramenée à ${C_MAX} m/s.` };
  return { c: n, message: '' };
}

/** Vrai pour une vitesse de la lumière permise. */
export function isValidLightSpeed(c) {
  return Number.isInteger(c) && c >= C_MIN && c <= C_MAX;
}

/**
 * Réglages mémorisés (valeur abîmée ou absente : réglage par défaut).
 * @param {{get(key: string, fallback?: any): any}} [store]
 * @returns {{c: number}}
 */
export function loadSettings(store = local) {
  const saved = store.get(SETTINGS_KEY, null);
  const c = saved && typeof saved === 'object' ? saved.c : undefined;
  return { c: isValidLightSpeed(c) ? c : C_DEFAULT };
}

/**
 * Mémorise les réglages.
 * @param {{c: number}} settings
 * @param {{set(key: string, value: any): boolean}} [store]
 * @returns {boolean} vrai si l'écriture est durable (faux : gardée en mémoire pour la page)
 */
export function saveSettings(settings, store = local) {
  if (!isValidLightSpeed(settings?.c)) throw new RangeError(`Réglage de c invalide : ${settings?.c}`);
  return store.set(SETTINGS_KEY, { c: settings.c });
}

/**
 * Vitesse de la lumière au démarrage : `?c=n` (prioritaire), sinon le réglage mémorisé, sinon
 * C_DEFAULT. Un `?c=` refusé retombe sur le réglage mémorisé, avec un message.
 * @param {string} search `window.location.search`
 * @param {{get(key: string, fallback?: any): any}} [store]
 * @returns {{c: number, source: 'url' | 'reglage', message: string}}
 */
export function initialLightSpeed(search, store = local) {
  const saved = loadSettings(store).c;
  const params = new URLSearchParams(search);
  if (!params.has('c')) return { c: saved, source: 'reglage', message: '' };
  const { c, message } = parseLightSpeed(params.get('c'));
  if (c === null) return { c: saved, source: 'reglage', message: `Paramètre ?c= ignoré. ${message}` };
  return { c, source: 'url', message };
}
