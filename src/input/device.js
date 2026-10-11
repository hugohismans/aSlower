/**
 * Appareil (jalon 2) : plein écran et écran maintenu allumé (Screen Wake Lock).
 *
 * - Plein écran : demandé au clic sur « Jouer » (geste utilisateur), APRÈS la demande de
 *   permission du capteur d'inclinaison (qui doit passer en premier sur iOS). L'API existe sur
 *   Android et sur ordinateur, pas sur iPhone (iPadOS seulement) : sans elle, rien ne se passe
 *   et aucune erreur n'est levée. Sur iPhone, l'ajout à l'écran d'accueil (manifeste,
 *   apple-mobile-web-app-capable) donne le plein écran. En plein écran, on tente aussi de
 *   verrouiller le paysage (Android) ; un refus est sans conséquence (le panneau « Tourne ton
 *   GSM » reste la règle).
 * - Wake Lock : pris pendant le jeu, relâché en pause, repris au retour. Le navigateur le
 *   relâche de lui-même quand la page est cachée (la partie est alors en pause). Tout est
 *   protégé (try/catch, promesses rattrapées) ; sans API, rien.
 *
 * Ce module n'utilise que le DOM ; le document et le navigateur sont injectables (tests).
 */

/**
 * Passe la page en plein écran si l'API existe et le permet.
 * @param {Document} [doc]
 * @returns {Promise<boolean>} vrai si la page est (ou était déjà) en plein écran
 */
export function enterFullscreen(doc = globalThis.document) {
  try {
    const d = /** @type {any} */ (doc);
    if (!d) return Promise.resolve(false);
    if (d.fullscreenElement || d.webkitFullscreenElement) return Promise.resolve(true);
    const el = d.documentElement;
    const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen;
    if (typeof request !== 'function' || d.fullscreenEnabled === false || d.webkitFullscreenEnabled === false) {
      return Promise.resolve(false);
    }
    return Promise.resolve(request.call(el, { navigationUI: 'hide' })).then(
      () => {
        lockLandscape(d.defaultView?.screen);
        return true;
      },
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Verrouille le paysage quand c'est permis (Android en plein écran) ; ignore tout refus. */
function lockLandscape(screen) {
  try {
    const result = screen?.orientation?.lock?.('landscape');
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    /* non permis : sans conséquence */
  }
}

/**
 * Écran maintenu allumé pendant le jeu.
 * @param {{nav?: any}} [options] nav : navigateur (défaut : navigator)
 * @returns {{acquire(): Promise<boolean>, release(): void, readonly active: boolean}}
 */
export function createWakeLock({ nav = globalThis.navigator } = {}) {
  /** Verrou obtenu (WakeLockSentinel), ou null. */
  let sentinel = null;
  /** Demande en cours. */
  let pending = null;
  /** Le jeu veut le verrou (une demande qui aboutit après release() est aussitôt rendue). */
  let wanted = false;

  function drop(lock) {
    try {
      const result = lock?.release?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      /* déjà relâché */
    }
  }

  return {
    /** Demande le verrou (sans effet s'il est déjà pris ou si l'API manque). */
    async acquire() {
      wanted = true;
      if (sentinel && !sentinel.released) return true;
      if (pending) return pending;
      if (!nav?.wakeLock || typeof nav.wakeLock.request !== 'function') return false;
      pending = (async () => {
        try {
          const lock = await nav.wakeLock.request('screen');
          if (!wanted) {
            drop(lock);
            return false;
          }
          sentinel = lock;
          lock.addEventListener?.('release', () => {
            if (sentinel === lock) sentinel = null;
          });
          return true;
        } catch {
          // Page cachée, économie d'énergie, politique de permissions : on joue sans.
          return false;
        } finally {
          pending = null;
        }
      })();
      return pending;
    },

    /** Rend le verrou (pause, fin de partie). */
    release() {
      wanted = false;
      const lock = sentinel;
      sentinel = null;
      drop(lock);
    },

    get active() {
      return Boolean(sentinel && !sentinel.released);
    },
  };
}
