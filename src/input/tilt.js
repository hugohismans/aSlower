/**
 * Direction par inclinaison du GSM (gyroscope, `deviceorientation`), jalon 2.
 *
 * Cycle de vie :
 * 1. `requestPermission()` EN PREMIER et SYNCHRONIQUEMENT dans le gestionnaire `click` du
 *    bouton « Jouer » (aucun `await` avant : iOS vérifie le geste utilisateur au moment de
 *    l'appel de `DeviceOrientationEvent.requestPermission`). Android et ordinateur : pas de
 *    permission, la promesse se résout tout de suite.
 * 2. `start()` : écoute les événements ; faute d'un événement non nul dans la seconde,
 *    l'état passe à 'indisponible' (ordinateur sans capteur, iOS sans permission…).
 * 3. `calibrate()` pendant le décompte : angle neutre = moyenne sur ≈ 0,5 s.
 * 4. `read()` une fois par image : volant lissé (≈ 60 ms). L'événement ne fait que noter
 *    les dernières valeurs ; tout le calcul est fait à la lecture.
 *
 * États (`state`) :
 * - 'inconnu'      : rien demandé encore ;
 * - 'demande'      : permission en cours de demande, ou en attente du premier événement ;
 * - 'actif'        : des événements arrivent, le volant répond ;
 * - 'refuse'       : permission refusée (iOS) ; iOS peut ne plus reposer la question avant
 *                    un rechargement de la page ;
 * - 'indisponible' : pas d'API, page non sécurisée (HTTPS requis), ou aucun événement
 *                    non nul en 1 s après start().
 *
 * Ce module n'utilise que le DOM ; la fenêtre et l'horloge sont injectables (tests).
 */
import {
  isValidOrientation,
  meanAngle,
  normalizeScreenAngle,
  smoothToward,
  steerFromAngle,
  steeringAngleDetail,
} from './tiltMath.js';

/** Délai sans événement non nul après start() avant de déclarer le capteur indisponible (ms). */
export const DETECTION_TIMEOUT_MS = 1000;
/** Durée par défaut du calibrage (ms). */
export const CALIBRATION_MS = 500;
/** Recalibrage automatique après un changement d'orientation de l'écran (ms). */
export const RECALIBRATE_DELAY_MS = 300;
/** Plafond de la durée entre deux lectures pour le lissage (s). */
const MAX_READ_DT = 0.1;

/** @typedef {'inconnu' | 'demande' | 'actif' | 'refuse' | 'indisponible'} TiltState */

/**
 * @param {{
 *   onState?: (state: TiltState, previous: TiltState) => void,
 *   win?: any,
 *   now?: () => number,
 *   autoRecalibrate?: boolean,
 * }} [options]
 *   onState : appelé à chaque changement d'état ;
 *   win : fenêtre (défaut : window) ; doit fournir addEventListener, removeEventListener,
 *         setTimeout, clearTimeout, et si possible DeviceOrientationEvent, isSecureContext, screen ;
 *   now : horloge en ms (défaut : performance.now) ;
 *   autoRecalibrate : recalibrer 300 ms après un changement d'orientation de l'écran.
 */
export function createTilt({
  onState,
  win = globalThis.window,
  now = () => globalThis.performance.now(),
  autoRecalibrate = true,
} = {}) {
  /** @type {TiltState} */
  let state = 'inconnu';
  const listeners = new Set();
  if (onState) listeners.add(onState);

  /** Dernières valeurs reçues (null tant qu'aucun événement non nul). */
  let last = null;
  let neutral = 0;
  let smoothed = 0;
  let lastReadAt = null;
  let lastSteerTarget = 0;
  let lastDetail = null;
  let listening = false;
  let detectionTimer = null;
  let recalibrateTimer = null;
  /** Calibrage en cours : {samples, timer, resolve}. */
  let calibration = null;

  const hasApi = () => Boolean(win) && 'DeviceOrientationEvent' in win && win.isSecureContext !== false;

  function setState(next) {
    if (next === state) return;
    const previous = state;
    state = next;
    for (const fn of [...listeners]) {
      try {
        fn(next, previous);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Angle de l'écran actuel : screen.orientation.angle, sinon window.orientation (iOS < 16.4). */
  function screenAngle() {
    const angle = win?.screen?.orientation?.angle ?? win?.orientation ?? 0;
    return normalizeScreenAngle(angle);
  }

  function currentAngle() {
    if (!last) return NaN;
    lastDetail = steeringAngleDetail(last, screenAngle());
    return lastDetail.angle;
  }

  function onOrientation(event) {
    if (!isValidOrientation(event)) return; // événement « vide » (ordinateur sans capteur)
    last = { alpha: Number.isFinite(event.alpha) ? event.alpha : null, beta: event.beta, gamma: event.gamma };
    if (detectionTimer !== null) {
      win.clearTimeout(detectionTimer);
      detectionTimer = null;
    }
    if (state !== 'actif') setState('actif');
    if (calibration) calibration.samples.push(currentAngle());
  }

  function onScreenChange() {
    if (!autoRecalibrate || state !== 'actif') return;
    if (recalibrateTimer !== null) win.clearTimeout(recalibrateTimer);
    recalibrateTimer = win.setTimeout(() => {
      recalibrateTimer = null;
      calibrate();
    }, RECALIBRATE_DELAY_MS);
  }

  function addScreenListener() {
    const orientation = win.screen?.orientation;
    if (orientation && typeof orientation.addEventListener === 'function') {
      orientation.addEventListener('change', onScreenChange);
      return () => orientation.removeEventListener('change', onScreenChange);
    }
    win.addEventListener('orientationchange', onScreenChange);
    return () => win.removeEventListener('orientationchange', onScreenChange);
  }
  let removeScreenListener = null;

  function finishCalibration() {
    if (!calibration) return;
    const { samples, resolve, timer } = calibration;
    calibration = null;
    if (timer !== null) win.clearTimeout(timer);
    const mean = meanAngle(samples);
    if (Number.isFinite(mean)) neutral = mean;
    smoothed = 0; // pas de coup de volant au changement de neutre
    resolve(neutral);
  }

  /**
   * Calibrage : l'angle neutre devient la moyenne des angles reçus pendant `durationMs`
   * (le dernier angle connu compte aussi). Sans aucun angle, le neutre est inchangé.
   * @param {number} [durationMs]
   * @returns {Promise<number>} angle neutre (degrés)
   */
  function calibrate(durationMs = CALIBRATION_MS) {
    if (calibration) finishCalibration();
    return new Promise((resolve) => {
      const first = currentAngle();
      calibration = { samples: Number.isFinite(first) ? [first] : [], resolve, timer: null };
      if (durationMs <= 0) {
        finishCalibration();
        return;
      }
      calibration.timer = win.setTimeout(finishCalibration, durationMs);
    });
  }

  /** Arrête l'écoute ; l'état est gardé (sauf une attente en cours), le volant revient à 0. */
  function stop() {
    if (listening) {
      win.removeEventListener('deviceorientation', onOrientation);
      removeScreenListener?.();
      removeScreenListener = null;
      listening = false;
    }
    for (const timer of [detectionTimer, recalibrateTimer]) if (timer !== null) win.clearTimeout(timer);
    detectionTimer = null;
    recalibrateTimer = null;
    if (calibration) finishCalibration();
    if (state === 'demande') setState('inconnu');
    smoothed = 0;
    lastReadAt = null;
  }

  return {
    /** @returns {TiltState} */
    get state() {
      return state;
    },

    /** Angle neutre actuel (degrés). */
    get neutral() {
      return neutral;
    },

    /**
     * Demande la permission du capteur. À appeler EN PREMIER, synchroniquement, dans un
     * gestionnaire `click` (pas pointerdown : il n'active pas la page sur iOS).
     * @returns {Promise<'accorde' | 'refuse' | 'indisponible'>}
     */
    requestPermission() {
      if (!hasApi()) {
        setState('indisponible');
        return Promise.resolve('indisponible');
      }
      const DOE = win.DeviceOrientationEvent;
      if (typeof DOE.requestPermission !== 'function') {
        // Android, ordinateur : pas de permission ; start() vérifiera qu'un événement arrive.
        if (state !== 'actif') setState('demande');
        return Promise.resolve('accorde');
      }
      let request;
      try {
        request = Promise.resolve(DOE.requestPermission()); // appel synchrone, dans le geste
      } catch (error) {
        request = Promise.reject(error);
      }
      if (state !== 'actif') setState('demande');
      return request.then(
        (result) => {
          if (result === 'granted') return 'accorde';
          setState('refuse');
          return 'refuse';
        },
        () => {
          // NotAllowedError (appel hors d'un geste) ou refus : on se replie.
          setState('refuse');
          return 'refuse';
        },
      );
    },

    /**
     * Commence l'écoute. Sans événement non nul dans DETECTION_TIMEOUT_MS : 'indisponible'.
     * Sans effet si l'API manque ou si la permission a été refusée.
     * @returns {boolean} vrai si l'écoute a commencé (ou continuait déjà)
     */
    start() {
      if (!hasApi()) {
        setState('indisponible');
        return false;
      }
      if (state === 'refuse') return false;
      if (!listening) {
        listening = true;
        win.addEventListener('deviceorientation', onOrientation);
        removeScreenListener = addScreenListener();
      }
      if (state !== 'actif' && detectionTimer === null) {
        // Nouvelle attente (premier départ, ou nouvel essai après 'indisponible').
        setState('demande');
        detectionTimer = win.setTimeout(() => {
          detectionTimer = null;
          if (state !== 'actif') setState('indisponible');
        }, DETECTION_TIMEOUT_MS);
      }
      return true;
    },

    stop,

    calibrate,

    /**
     * Volant lissé pour cette image, ∈ [−1, 1] (0 si le capteur n'est pas actif).
     * @returns {number}
     */
    read() {
      const t = now();
      const dt = lastReadAt === null ? 0 : Math.min(Math.max(0, (t - lastReadAt) / 1000), MAX_READ_DT);
      lastReadAt = t;
      if (state !== 'actif' || !listening || !last) {
        smoothed = 0;
        lastSteerTarget = 0;
        return 0;
      }
      lastSteerTarget = steerFromAngle(currentAngle(), neutral);
      smoothed = smoothToward(smoothed, lastSteerTarget, dt);
      return Math.max(-1, Math.min(1, smoothed));
    },

    /**
     * Valeurs brutes et calculées, pour le panneau ?debug (hud/tiltDebug.js).
     * @returns {{state: TiltState, alpha: number | null, beta: number | null, gamma: number | null,
     *   screenAngle: number, angle: number, held: number, neutral: number, target: number, steer: number}}
     */
    debugInfo() {
      const angle = currentAngle();
      return {
        state,
        alpha: last ? last.alpha : null,
        beta: last ? last.beta : null,
        gamma: last ? last.gamma : null,
        screenAngle: screenAngle(),
        angle,
        held: lastDetail && last ? lastDetail.held : NaN,
        neutral,
        target: lastSteerTarget,
        steer: smoothed,
      };
    },

    /**
     * Ajoute un observateur des changements d'état (en plus de onState).
     * @param {(state: TiltState, previous: TiltState) => void} fn
     * @returns {() => void} retire l'observateur
     */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    dispose() {
      stop();
      listeners.clear();
    },
  };
}
