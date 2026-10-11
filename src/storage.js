/**
 * Stockage sûr (seul module qui touche localStorage et sessionStorage).
 *
 * - Toutes les clés sont préfixées par « aslower:v1: » : l'origine
 *   hugohismans.github.io est partagée avec le portfolio (clés hh-*).
 * - Valeurs sérialisées en JSON.
 * - try/catch partout : stockage absent (Node, iframe sandbox), bloqué (cookies
 *   refusés : l'accès lui-même lève SecurityError), plein (QuotaExceededError) ou
 *   valeur abîmée. Dans ces cas, repli en mémoire pour la durée de la page.
 *
 * Contrat (docs/interfaces.md) : `local` et `session` exposent
 * get(key, fallback), set(key, value) et remove(key) ; les clés passées sont
 * SANS préfixe.
 *
 * Ce module n'importe rien (règle d'imports du contrat). Le préfixe ci-dessous
 * doit rester égal à STORAGE_PREFIX (src/physics/constants.js) : c'est vérifié
 * par tests/storage.test.js.
 */

const PREFIX = 'aslower:v1:';

/**
 * Ce dont on a besoin d'un Storage du navigateur (permet aussi des faux en test).
 * @typedef {{getItem(key: string): (string | null), setItem(key: string, value: string): void,
 *            removeItem(key: string): void}} StorageLike
 */

/**
 * @typedef {object} SafeStore
 * @property {(key: string, fallback?: any) => any} get valeur désérialisée, ou fallback
 * @property {(key: string, value: any) => boolean} set vrai si la valeur est écrite
 *   durablement, faux si elle n'est gardée qu'en mémoire
 * @property {(key: string) => void} remove
 */

/** Texte JSON → valeur ; texte abîmé → `undefined`. */
function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Fabrique un stockage sûr au-dessus d'un Storage du navigateur.
 * Exportée pour les tests ; le jeu utilise `local` et `session`.
 * @param {() => (StorageLike | undefined | null)} getBackend relu à chaque appel
 *   (l'accès peut lever, et la disponibilité peut changer)
 * @returns {SafeStore}
 */
export function createSafeStore(getBackend) {
  /**
   * Repli en mémoire : clé sans préfixe → texte JSON. Ne contient que les
   * écritures que le stockage a refusées ; elles sont donc les plus récentes.
   */
  const memory = new Map();

  /** Le Storage du navigateur, ou null s'il est absent ou inaccessible. */
  function backend() {
    try {
      const store = getBackend();
      return store && typeof store.getItem === 'function' ? store : null;
    } catch {
      return null;
    }
  }

  function get(key, fallback = null) {
    let text = memory.get(key);
    if (text === undefined) {
      const store = backend();
      try {
        text = store ? store.getItem(PREFIX + key) : null;
      } catch {
        text = null;
      }
    }
    if (text == null) return fallback;
    const value = parse(text);
    return value === undefined ? fallback : value;
  }

  function remove(key) {
    memory.delete(key);
    const store = backend();
    try {
      if (store) store.removeItem(PREFIX + key);
    } catch {
      /* stockage bloqué : rien d'autre à faire */
    }
  }

  function set(key, value) {
    if (value === undefined) {
      remove(key); // JSON n'a pas de « undefined » : écrire undefined = effacer
      return true;
    }
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      return false; // valeur non sérialisable (cycle) : on n'écrit rien
    }
    const store = backend();
    try {
      if (store) {
        store.setItem(PREFIX + key, text);
        memory.delete(key);
        return true;
      }
    } catch {
      /* quota dépassé ou stockage bloqué : repli en mémoire ci-dessous */
    }
    memory.set(key, text);
    return false;
  }

  return { get, set, remove };
}

/** Stockage durable (localStorage), préfixé, avec repli en mémoire. */
export const local = createSafeStore(() => globalThis.localStorage);

/** Stockage de l'onglet (sessionStorage), préfixé, avec repli en mémoire. */
export const session = createSafeStore(() => globalThis.sessionStorage);
