/**
 * Point d'entrée du jeu : écran titre → « Jouer » (geste utilisateur) → monde, caméra,
 * commandes, HUD et boucle d'images.
 *
 * Paramètres d'URL (docs/interfaces.md) :
 * - ?scene=avenue-test (par défaut) | quartier-test : scène de src/data/scenes/ ;
 * - ?diag : panneau de diagnostic #diag (touche E ou case « Passe ciel/sol » : couper la
 *   passe d'environnement pour mesurer son coût) ;
 * - ?bench : parcours de mesure automatique, sans entrée (voir createBench), avec #diag ;
 *   résultat affiché dans #diag et exposé dans window.__benchResult ;
 * - ?sansciel (avec ?diag ou ?bench) : passe ciel/sol coupée dès la première image ;
 * - ?dpr= : rapport de pixels imposé (render/quality.js ; coupe le DPR adaptatif) ;
 * - ?c=n : vitesse de la lumière (entier de 10 à 100 m/s), prioritaire sur le réglage mémorisé
 *   (game/settings.js) et jamais mémorisée ;
 * - ?debug : panneau de l'inclinaison (hud/tiltDebug.js : α, β, γ, angle, neutre, volant).
 *
 * Vitesse de la lumière : réglage du joueur (écran titre, ou « Changer c » dans le menu pause,
 * qui redémarre la partie). Toute la partie lit ses constantes dans physicsFor(c) : joueur,
 * scène (longueurs en L = c²/a), butée, ?bench ; le HUD et le rendu lisent snapshot.c.
 *
 * Direction tactile (jalon 2) : inclinaison du GSM (input/tilt.js) ou glisser, réglage
 * « Direction » de l'écran titre et du menu pause, mémorisé (aslower:v1:commandes) ; par
 * défaut l'inclinaison sur écran tactile. La permission du capteur est demandée EN PREMIER
 * dans le clic « Jouer » (geste exigé par iOS), puis le plein écran (Android), puis le
 * chargement. Repli automatique en glisser, annoncé (aria-live) ; calibrage quand le capteur
 * répond en jeu ; « Recentrer le volant » au menu pause.
 *
 * Une image (plan §2) : commandes → butée douce → player.step (dτ ≤ 0,1 s) → vision
 * classique (k) → bulles (game/bubbles.js, conditions à 5 Hz) → world.update (observateur,
 * coupe, LOD) → caméra → world.render → HUD (12 Hz) → #diag → DPR adaptatif
 * (render/adaptiveDpr.js, appliqué à l'image suivante, avant le rendu).
 *
 * Pauses (horloges gelées, horloge des bulles comprise, écran plus maintenu allumé) : Échap
 * ou P, onglet caché, panneau « Tourne ton GSM » (portrait sur écran tactile : paysage
 * strictement imposé), perte du contexte WebGL (recompilation et préchauffage à la
 * restauration ; « Recharger » si elle tarde). Menu pause : Reprendre, Recentrer le volant,
 * Direction, Changer c, Revoir les bulles, Recommencer, Crédits.
 */
import { PHI_MAX_DEFAULT, physicsFor } from './physics/constants.js';
import { createPlayer, snapshot, step } from './physics/player.js';
import { createCamera, updateCamera } from './render/camera.js';
import { createAdaptiveDpr, DPR_FLOOR, DPR_FLOOR_LITE } from './render/adaptiveDpr.js';
import { armBootGuard, confirmBoot, createQuality, profilePixelRatio } from './render/quality.js';
import { createRenderer, observeViewport, resizeRenderer, viewportSize, watchContextLoss } from './render/renderer.js';
import { createWorld } from './render/scene.js';
import { createControls } from './input/controls.js';
import { createWakeLock, enterFullscreen } from './input/device.js';
import { CALIBRATION_MS, createTilt } from './input/tilt.js';
import { createAnnouncer } from './hud/announcer.js';
import { createBubbleView } from './hud/bubbles.js';
import { createCredits } from './hud/credits.js';
import { createDiag, diagModeFromUrl, readGlInfo } from './hud/diag.js';
import { createDirectionControl } from './hud/direction.js';
import { createHud } from './hud/hud.js';
import { formatLightSpeed } from './hud/format.js';
import { createLightSpeedControl } from './hud/lightSpeed.js';
import { createTiltDebug, tiltDebugFromUrl } from './hud/tiltDebug.js';
import { createBubbleEngine, createBubbleVariables, facadeAhead } from './game/bubbles.js';
import {
  LIGHT_SPEED_PRESETS,
  initialLightSpeed,
  loadControlMode,
  parseLightSpeed,
  saveControlMode,
  saveSettings,
} from './game/settings.js';
import { createLoop } from './loop.js';
import { local } from './storage.js';
import bubblesJson from './data/bubbles.json';
import palette from './data/palette.json';

/** Scènes de développement (chargées à la demande : un fichier par scène dans le build). */
const SCENES = {
  'avenue-test': () => import('./data/scenes/avenue-test.json'),
  'quartier-test': () => import('./data/scenes/quartier-test.json'),
};
const DEFAULT_SCENE = 'avenue-test';

/** Durée de la transition de la vision classique (s) ; instantanée avec prefers-reduced-motion. */
const CLASSIC_TRANSITION_S = 0.15;

/** Butée douce : marge aux bords de la zone roulable (m) et seuil de freinage automatique. */
const SOFT_STOP_MARGIN = 3;
const SOFT_STOP_RATIO = 0.9;
/** Contre le bord, une vitesse propre restante plus petite (m/s) est un arrêt. */
const SLIDE_MIN_SPEED = 1e-6;

/** Repli de l'inclinaison en glisser : textes annoncés (aria-live) et affichés. */
const TILT_FALLBACK_TEXTS = Object.freeze({
  refuse:
    "Inclinaison refusée : direction au doigt (glisser). Sur iPhone, iOS ne repose la question qu'après un rechargement de la page.",
  indisponible: "Pas de capteur d'inclinaison : direction au doigt (glisser).",
});
/** Message du calibrage (≈ 0,5 s : la position tenue devient « tout droit »). */
const CALIBRATION_TEXT = 'Tiens ton GSM comme un volant…';
/** Durées d'affichage des messages courts (ms). */
const CALIBRATION_TOAST_MS = 900;
const TOAST_FALLBACK_MS = 6000;
/** Période du test « façade dans l'axe » des bulles (s) : 5 Hz. */
const FACADE_PERIOD_S = 0.2;

/** Démarrage confirmé (garde-fou de quality.js) après ce nombre d'images affichées. */
const BOOT_CONFIRM_FRAMES = 30;

/** Délai sans restauration du contexte WebGL avant de proposer « Recharger » (ms). */
const CONTEXT_RESTORE_TIMEOUT_MS = 5000;

/** ?bench : pas de temps fixe par image (s), donc la même suite d'images sur tout appareil. */
const BENCH_DT = 1 / 60;
/** Avenue : poussée pleine jusqu'à ce γ, puis freinage jusqu'à l'arrêt. */
const BENCH_AVENUE_GAMMA = 2.5;
/**
 * Quartier : caméra scriptée le long de la rue x = 0, β de 0 à betaMax en rampS, puis holdS ;
 * départ à y = startL·L (L = c²/a). Parcours : (betaMax/2·rampS + betaMax·holdS)·c ≈ 1,2·L,
 * de −0,6·L à +0,6·L, dans le quartier (demi-côté ≥ visibilité + 12 m ≥ 0,65·L).
 */
const BENCH_QUARTIER = Object.freeze({ x: 0, startL: -0.6, betaMax: 0.92, rampS: 16, holdS: 5 });

/* ------------------------------------------------------------------------- */
/* Butée douce : empêche de sortir de la carte, sans pénalité                 */
/* ------------------------------------------------------------------------- */

/**
 * Zone roulable : rectangle englobant des chaussées, dans les limites de la carte, réduit de
 * `margin`. Sur l'avenue de test, son bord nord est la façade de l'hôtel de ville.
 * @param {{from: {x: number, y: number}, to: {x: number, y: number}, width: number}[]} streets
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} bounds
 * @param {number} margin
 */
function drivableLimits(streets, bounds, margin) {
  let box = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
  for (const s of streets) {
    const len = Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) || 1;
    const px = (-(s.to.y - s.from.y) / len) * (s.width / 2);
    const py = ((s.to.x - s.from.x) / len) * (s.width / 2);
    for (const p of [s.from, s.to]) {
      for (const sign of [-1, 1]) {
        box.xmin = Math.min(box.xmin, p.x + sign * px);
        box.xmax = Math.max(box.xmax, p.x + sign * px);
        box.ymin = Math.min(box.ymin, p.y + sign * py);
        box.ymax = Math.max(box.ymax, p.y + sign * py);
      }
    }
  }
  if (!(box.xmin < box.xmax && box.ymin < box.ymax)) box = { ...bounds };
  return {
    xmin: Math.max(box.xmin, bounds.xmin) + margin,
    ymin: Math.max(box.ymin, bounds.ymin) + margin,
    xmax: Math.min(box.xmax, bounds.xmax) - margin,
    ymax: Math.min(box.ymax, bounds.ymax) - margin,
  };
}

/**
 * Distance (m) du point (x, y) au bord du rectangle, le long de la direction unitaire (dx, dy).
 * 0 si le point est dehors et s'éloigne.
 */
function exitDistance(x, y, dx, dy, limits) {
  const tx = dx > 0 ? (limits.xmax - x) / dx : dx < 0 ? (limits.xmin - x) / dx : Infinity;
  const ty = dy > 0 ? (limits.ymax - y) / dy : dy < 0 ? (limits.ymin - y) / dy : Infinity;
  return Math.max(0, Math.min(tx, ty));
}

/**
 * Freinage automatique quand le bord de la zone roulable approche : si la distance d'arrêt
 * au frein plein, (c²/a)(γ − 1) (exacte, avec c et a de la partie), atteint SOFT_STOP_RATIO
 * de la distance au bord le long de la vitesse, le frein remplace la poussée. Le moteur suffit
 * (a = c/10) : l'arrêt est doux, sans pénalité, et la physique reste exacte.
 * @param {import('./physics/player.js').PlayerState} player
 * @param {{thrust?: number, brake?: number, steer?: number}} cmd
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} limits
 */
function softStopCommand(player, cmd, limits) {
  const u = Math.hypot(player.ux, player.uy);
  if (u === 0) return cmd;
  const d = exitDistance(player.x, player.y, player.ux / u, player.uy / u, limits);
  const { c, a } = player;
  const u2 = (u * u) / (c * c);
  const stopping = (((c * c) / a) * u2) / (Math.sqrt(1 + u2) + 1); // (c²/a)(γ − 1), sans annulation
  if (stopping < SOFT_STOP_RATIO * d) return cmd;
  return { thrust: 0, brake: 1, steer: cmd.steer };
}

/**
 * Dernier rempart (virage serré vers un bord tout proche) : ramène le joueur dans la zone
 * et annule la composante sortante de sa vitesse propre ; le cap suit la vitesse restante.
 * @param {import('./physics/player.js').PlayerState} player
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} limits
 */
function keepInside(player, limits) {
  let hit = false;
  if (player.x < limits.xmin || player.x > limits.xmax) {
    player.x = Math.min(Math.max(player.x, limits.xmin), limits.xmax);
    if ((player.x === limits.xmin && player.ux < 0) || (player.x === limits.xmax && player.ux > 0)) player.ux = 0;
    hit = true;
  }
  if (player.y < limits.ymin || player.y > limits.ymax) {
    player.y = Math.min(Math.max(player.y, limits.ymin), limits.ymax);
    if ((player.y === limits.ymin && player.uy < 0) || (player.y === limits.ymax && player.uy > 0)) player.uy = 0;
    hit = true;
  }
  if (!hit) return;
  const u = Math.hypot(player.ux, player.uy);
  if (u < SLIDE_MIN_SPEED) {
    // Arrêt contre le bord : on garde le cap. (Un reste d'arrondi, comme cos(π/2)·|u|,
    // deviendrait sinon le nouveau cap et ferait glisser le joueur le long du bord.)
    player.ux = 0;
    player.uy = 0;
  } else {
    player.hx = player.ux / u;
    player.hy = player.uy / u;
  }
}

/* ------------------------------------------------------------------------- */
/* ?bench : parcours de mesure déterministe                                   */
/* ------------------------------------------------------------------------- */

/** Quantile p ∈ [0, 1] d'une liste de nombres (copie triée). */
function quantile(values, p) {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))];
}

/** Résumé {p50, p95, p99, max, mean} arrondi au centième de ms. */
function summary(values) {
  const round = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : NaN;
  return {
    p50: round(quantile(values, 0.5)),
    p95: round(quantile(values, 0.95)),
    p99: round(quantile(values, 0.99)),
    max: round(values.length ? Math.max(...values) : NaN),
    mean: round(mean),
  };
}

/**
 * Parcours de mesure, sans entrée utilisateur ; un pas fixe de BENCH_DT par image.
 * - quartier-test : caméra scriptée le long de la rue x = 0 vers le nord, β imposé de 0 à
 *   0,92 (sans physique : la scène est trop petite pour accélérer), v = β·c de la partie ;
 * - autres scènes (avenue-test) : physique réelle, poussée pleine jusqu'à γ ≈ 2,5 puis
 *   freinage jusqu'à l'arrêt.
 * @param {string} sceneId
 * @param {import('./physics/player.js').PlayerState} player
 * @param {{xmin: number, ymin: number, xmax: number, ymax: number}} limits
 */
function createBench(sceneId, player, limits) {
  const scripted = sceneId === 'quartier-test';
  let phase = 'poussee';
  let elapsed = 0;
  let done = false;
  const { c, a } = player;
  const lengthUnit = (c * c) / a;
  // Caméra scriptée : état propre (x, y, τ, t).
  const cam = { x: BENCH_QUARTIER.x, y: BENCH_QUARTIER.startL * lengthUnit, tau: 0, t: 0 };

  const samples = { frame: [], render: [], update: [] };
  let frames = 0;
  let callsMax = 0;
  let trianglesMax = 0;
  let chunksMax = 0;
  let generated = 0;
  let environmentFrames = 0;
  let maxGamma = 1;
  let maxBeta = 0;
  let startedAt = NaN;
  let lastSnap = null;

  /** Instantané de la caméra scriptée (mêmes champs que player.snapshot). */
  function scriptedSnapshot() {
    elapsed += BENCH_DT;
    const { betaMax, rampS, holdS } = BENCH_QUARTIER;
    const beta = betaMax * Math.min(1, elapsed / rampS);
    const gamma = 1 / Math.sqrt(1 - beta * beta);
    const speed = beta * c;
    cam.y += speed * BENCH_DT;
    cam.t += BENCH_DT;
    cam.tau += BENCH_DT / gamma;
    done = elapsed >= rampS + holdS - 1e-9;
    return {
      x: cam.x, y: cam.y, vx: 0, vy: speed, speed, beta, gamma, rapidity: Math.atanh(beta),
      tau: cam.tau, t: cam.t, ux: 0, uy: gamma * speed, heading: Math.PI / 2, hx: 0, hy: 1, c,
    };
  }

  /** Physique réelle : poussée jusqu'à γ = BENCH_AVENUE_GAMMA, puis frein jusqu'à l'arrêt. */
  function drivenSnapshot() {
    elapsed += BENCH_DT;
    if (phase === 'poussee' && snapshot(player).gamma >= BENCH_AVENUE_GAMMA) phase = 'frein';
    const cmd = phase === 'poussee' ? { thrust: 1, brake: 0, steer: 0 } : { thrust: 0, brake: 1, steer: 0 };
    step(player, softStopCommand(player, cmd, limits), BENCH_DT);
    keepInside(player, limits);
    const snap = snapshot(player);
    done = phase === 'frein' && snap.speed === 0;
    return snap;
  }

  return {
    scripted,
    get done() {
      return done;
    },
    /** Instantané de l'image suivante. */
    advance() {
      lastSnap = scripted ? scriptedSnapshot() : drivenSnapshot();
      maxGamma = Math.max(maxGamma, lastSnap.gamma);
      maxBeta = Math.max(maxBeta, lastSnap.beta);
      return lastSnap;
    },
    /** Mesures d'une image (la première, sans intervalle significatif, est exclue des temps). */
    record({ dtMs, renderMs, updateMs, stats, environment }) {
      frames += 1;
      if (frames === 1) {
        startedAt = performance.now();
      } else {
        samples.frame.push(dtMs);
        samples.render.push(renderMs);
        samples.update.push(updateMs);
      }
      callsMax = Math.max(callsMax, stats.calls);
      trianglesMax = Math.max(trianglesMax, stats.triangles);
      chunksMax = Math.max(chunksMax, stats.visibleChunks);
      generated += stats.generated;
      if (environment) environmentFrames += 1;
    },
    /** Résultat final (objet JSON). */
    result(extra) {
      const durationS = (performance.now() - startedAt) / 1000;
      const round = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n;
      return {
        scene: sceneId,
        c,
        lengthUnit,
        parcours: scripted ? 'camera scriptee, beta 0 -> 0,92' : 'physique, poussee jusqu a gamma 2,5 puis frein',
        frames,
        durationS: round(durationS, 2),
        simulatedS: round(elapsed, 3),
        fps: round((frames - 1) / durationS, 1),
        frameMs: summary(samples.frame),
        renderCpuMs: summary(samples.render),
        updateCpuMs: summary(samples.update),
        drawCallsMax: callsMax,
        trianglesMax,
        visibleChunksMax: chunksMax,
        lodGenerated: generated,
        environmentPass: environmentFrames === frames ? 'on' : environmentFrames === 0 ? 'off' : 'mixte',
        maxBeta: round(maxBeta, 4),
        maxGamma: round(maxGamma, 4),
        final: lastSnap && {
          x: round(lastSnap.x, 2),
          y: round(lastSnap.y, 2),
          speed: round(lastSnap.speed, 4),
          tau: round(lastSnap.tau, 3),
          t: round(lastSnap.t, 3),
        },
        ...extra,
      };
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Page                                                                       */
/* ------------------------------------------------------------------------- */

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const dom = {
  canvas: /** @type {HTMLCanvasElement} */ ($('jeu')),
  controls: $('controls'),
  hud: $('hud'),
  title: $('title'),
  play: /** @type {HTMLButtonElement} */ ($('play')),
  openCredits: $('open-credits'),
  credits: /** @type {HTMLDialogElement} */ ($('credits')),
  diag: $('diag'),
  notice: $('notice'),
  noticeTitle: $('notice-title'),
  noticeText: $('notice-text'),
  noticeContent: $('notice-content'),
  noticeActions: $('notice-actions'),
  lightSpeed: $('light-speed'),
  direction: $('direction'),
  helpTilt: $('help-tilt'),
  helpDrag: $('help-drag'),
  helpIos: $('help-ios'),
};

// Safari iOS ignore user-scalable=no : pas de pincement, sur toute la page (titre, pause, Crédits).
document.addEventListener('gesturestart', (event) => event.preventDefault());

const params = new URLSearchParams(window.location.search);
const requestedScene = params.get('scene');
const sceneId = requestedScene && requestedScene in SCENES ? requestedScene : DEFAULT_SCENE;
if (requestedScene && !(requestedScene in SCENES)) {
  console.warn(`Scène « ${requestedScene} » inconnue : ${DEFAULT_SCENE} chargée.`);
}
const diagMode = diagModeFromUrl(window.location.search);
const benchMode = diagMode === 'bench';

/** Écran tactile : direction par inclinaison par défaut, réglage Direction, plein écran. */
const touchDevice = window.matchMedia('(any-pointer: coarse)').matches;

// Vitesse de la lumière de la prochaine partie : ?c= (prioritaire), sinon le réglage mémorisé.
const startLight = initialLightSpeed(window.location.search);
if (startLight.message) console.warn(startLight.message);
/** Réglage de c choisi sur l'écran titre (ou au menu pause) pour la prochaine partie. */
let chosenC = startLight.c;

/** Mémorise le réglage (pas une valeur venue de ?c= tant que le joueur n'y touche pas). */
function chooseLightSpeed(c) {
  chosenC = c;
  saveSettings({ c });
}

// Garde-fou de démarrage (lecture) : à appeler une fois, avant de créer le renderer.
const quality = createQuality();

/**
 * État de la page : 'title' → 'loading' → 'playing' ⇄ 'paused' ; 'lost' (contexte WebGL
 * perdu) ; 'done' (fin de ?bench) ; 'error'.
 */
let mode = 'title';
/** Jeu en cours (créé au clic sur « Jouer »). */
let game = null;
/** Intervalle moyen entre images (s), pour les i/s du HUD en ?diag. */
let averageDt = NaN;

/** Réglages Direction de l'écran titre et du menu pause (ce dernier, recréé à chaque ouverture). */
let titleDirection = null;
let pauseDirection = null;

/* --- Annonces, inclinaison, commandes ------------------------------------------ */

// Région aria-live (hors du HUD, qui est masqué hors du jeu) : bulles, replis, recentrage.
const announcer = createAnnouncer(document.body);

/** Direction tactile préférée (mémorisée : aslower:v1:commandes). Sans écran tactile : glisser. */
let preferredMode = loadControlMode({ touch: touchDevice });
/** L'inclinaison est-elle voulue ? (jamais sans écran tactile : pas de réglage Direction.) */
const wantsTilt = () => touchDevice && preferredMode === 'tilt';
/** Dernier repli de l'inclinaison ('refuse' | 'indisponible'), ou null : message et « Réessayer ». */
let tiltFallback = null;
/** Calibrer dès que l'inclinaison répond en jeu (après une demande, ou un passage en inclinaison). */
let calibrationPending = false;
/** Annoncer un échec de l'inclinaison choisie sur l'écran titre (pas à « Jouer » : le jeu l'annonce). */
let announceTitleFailure = false;

const tilt = createTilt();
const controls = createControls(dom.controls, { mode: 'drag', tilt, onFallback: onTiltFallback });
controls.setEnabled(false); // écran titre : Espace et flèches gardent leur rôle habituel

/**
 * Demande la permission du capteur et démarre son écoute. À appeler EN PREMIER dans un
 * gestionnaire `click` (geste utilisateur : iOS le vérifie à l'appel, aucun await avant).
 */
function requestTilt() {
  tiltFallback = null;
  calibrationPending = true;
  tilt.requestPermission().then((result) => {
    if (result === 'accorde') tilt.start();
  });
}

/** Repli automatique en glisser (controls.js) : annoncé (aria-live), et affiché en jeu. */
function onTiltFallback(reason) {
  tiltFallback = reason;
  const text = TILT_FALLBACK_TEXTS[reason] ?? TILT_FALLBACK_TEXTS.indisponible;
  announcer.announce(text);
  if (mode === 'playing') showToast(text, TOAST_FALLBACK_MS, { announce: false });
  refreshDirection();
}

tilt.subscribe((state) => {
  if (state === 'actif') {
    tiltFallback = null;
    maybeCalibrate();
  } else if ((state === 'refuse' || state === 'indisponible') && wantsTilt()) {
    tiltFallback = state;
    if (announceTitleFailure && mode === 'title') announcer.announce(TILT_FALLBACK_TEXTS[state]);
    announceTitleFailure = false;
  }
  refreshDirection();
});

/** Calibrage (≈ 0,5 s) quand l'inclinaison répond, en jeu : la position tenue devient « tout droit ». */
function maybeCalibrate() {
  if (!calibrationPending || mode !== 'playing' || controls.getMode() !== 'tilt' || tilt.state !== 'actif') return;
  calibrationPending = false;
  showToast(CALIBRATION_TEXT, CALIBRATION_TOAST_MS);
  tilt.calibrate(CALIBRATION_MS);
}

/** Le joueur choisit la direction (écran titre ou menu pause) : geste utilisateur. */
function chooseDirection(next) {
  if (next === 'tilt') requestTilt(); // EN PREMIER (iOS)
  preferredMode = next;
  saveControlMode(next);
  if (next === 'drag') {
    tiltFallback = null;
    tilt.stop(); // plus d'écoute du capteur
  }
  if (mode === 'title') announceTitleFailure = next === 'tilt';
  if (game && (mode === 'playing' || mode === 'paused')) controls.setMode(next);
  refreshDirection();
}

/** Mode affiché par les réglages Direction : celui en usage, ou le repli. */
function shownDirection() {
  if (game && mode !== 'title') return controls.getMode();
  if (!touchDevice) return 'drag';
  return preferredMode === 'tilt' && tiltFallback ? 'drag' : preferredMode;
}

/** Met à jour les réglages Direction (titre, pause), l'aide du titre et « Recentrer le volant ». */
function refreshDirection() {
  const shown = shownDirection();
  const message = tiltFallback && wantsTilt() ? TILT_FALLBACK_TEXTS[tiltFallback] : '';
  for (const control of [titleDirection, pauseDirection]) {
    if (!control) continue;
    control.setValue(shown);
    control.setMessage(message);
    control.setRetry(Boolean(message));
  }
  dom.helpTilt.hidden = shown !== 'tilt';
  dom.helpDrag.hidden = shown === 'tilt';
  const recenter = /** @type {HTMLElement | null} */ (dom.noticeActions.querySelector('[data-action="recentrer"]'));
  if (recenter) recenter.hidden = !canRecenter();
}

/** « Recentrer le volant » n'a de sens qu'en inclinaison, capteur actif. */
function canRecenter() {
  return controls.getMode() === 'tilt' && tilt.state === 'actif';
}

/* --- HUD, bulles, Crédits, #diag -------------------------------------------- */

const hud = createHud(dom.hud, { phiMax: PHI_MAX_DEFAULT });

/** Horloge réelle de jeu (ms) : avance seulement en jeu, s'arrête en pause (durées des bulles). */
let playClockMs = 0;
const bubbles = createBubbleEngine({ definitions: bubblesJson, store: local, now: () => playClockMs });
// Après createHud (qui remplit #hud) : la bulle se place sous les horloges.
const bubbleView = createBubbleView(dom.hud, { announcer, onDismiss: () => bubbles.dismiss() });
bubbles.onShow((b) => (b ? bubbleView.show(b) : bubbleView.hide()));
const bubbleVars = createBubbleVariables();

// Messages courts du jeu (calibrage, repli) : même allure qu'une bulle, hors du moteur de bulles.
// Sans annonceur : showToast annonce lui-même, sauf si l'appelant l'a déjà fait.
const toast = createBubbleView(dom.hud, { onDismiss: () => hideToast() });
toast.element.classList.add('bubble-toast');
let toastTimer = 0;
/** Affiche un message court pendant `ms` ; announce : faux si l'appelant l'a déjà annoncé. */
function showToast(text, ms, { announce = true } = {}) {
  clearTimeout(toastTimer);
  toast.show({ id: 'message', text, blocking: false });
  if (announce) announcer.announce(text);
  toastTimer = window.setTimeout(hideToast, ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  toast.hide();
}

const credits = createCredits(/** @type {HTMLDialogElement} */ (dom.credits));
dom.openCredits.addEventListener('click', () => credits.open());
const diag = diagMode ? createDiag(dom.diag) : null;
diag?.show();
const tiltDebug = tiltDebugFromUrl(window.location.search) ? createTiltDebug(document.body) : null;
if (tiltDebug) {
  tiltDebug.show();
  // Panneau ?debug : mis à jour à chaque image, écran titre et pause compris.
  const debugTick = () => {
    tiltDebug.update({ ...tilt.debugInfo(), mode: game ? controls.getMode() : `${preferredMode}, titre` });
    requestAnimationFrame(debugTick);
  };
  requestAnimationFrame(debugTick);
}

/* --- Écran titre ------------------------------------------------------------ */

const titleLightSpeed = createLightSpeedControl(dom.lightSpeed, {
  value: chosenC,
  presets: LIGHT_SPEED_PRESETS,
  parse: parseLightSpeed,
  onChange: chooseLightSpeed,
});
if (startLight.message) titleLightSpeed.setMessage(startLight.message);

// Réglage Direction de l'écran titre (écran tactile seulement : masqué ailleurs par la feuille).
titleDirection = createDirectionControl(dom.direction, { value: shownDirection(), onChange: chooseDirection });

// iPhone hors écran d'accueil : le plein écran passe par « Sur l'écran d'accueil ».
const ios = /iPhone|iPod/.test(navigator.userAgent);
const standalone =
  /** @type {any} */ (navigator).standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
dom.helpIos.hidden = !(ios && !standalone);
refreshDirection();

/** Portrait sur écran tactile : même requête que le panneau #rotate de base.css. */
const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Écran maintenu allumé pendant le jeu (relâché en pause). */
const wakeLock = createWakeLock();

/** DPR adaptatif (créé avec le renderer) ; jamais en ?bench ni avec ?dpr=. */
let adaptive = null;
const adaptiveAllowed = !benchMode && quality.dprOverride === null;

const loop = createLoop(frame, {
  // Exception dans une image : la boucle s'est arrêtée ; sans console sur GSM, on le dit.
  onError: () => {
    mode = 'error';
    controls.setEnabled(false);
    wakeLock.release();
    hud.hide();
    showNotice({
      title: "Le jeu s'est arrêté",
      text: 'Une erreur inattendue a interrompu le jeu. Recharge la page pour reprendre.',
      actions: [{ label: 'Recharger', primary: true, onClick: () => window.location.reload() }],
    });
  },
});

/**
 * Affiche le panneau générique (#notice) avec ses boutons (et, au besoin, un contenu).
 * `variant` ('pause'…) ajuste la mise en page ; `id` d'une action → data-action du bouton.
 */
function showNotice({ title, text, actions = [], content = null, variant = '' }) {
  dom.noticeTitle.textContent = title;
  dom.noticeText.textContent = text;
  dom.notice.dataset.variant = variant;
  if (content) dom.noticeContent.replaceChildren(content);
  else dom.noticeContent.replaceChildren();
  if (variant !== 'pause') pauseDirection = null;
  dom.noticeActions.replaceChildren(
    ...actions.map(({ label, primary = false, onClick, id, hidden = false }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'btn btn-primary' : 'btn';
      button.textContent = label;
      if (id) button.dataset.action = id;
      button.hidden = hidden;
      button.addEventListener('click', onClick);
      return button;
    }),
  );
  dom.notice.hidden = false;
  /** @type {HTMLElement | null} */ (dom.noticeActions.querySelector('.btn-primary'))?.focus({ preventScroll: true });
}

function hideNotice() {
  if (dom.notice.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
  dom.notice.hidden = true;
  pauseDirection = null;
}

/** Un tour du navigateur (le temps d'afficher « Chargement… »). */
function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/* --- Pause ---------------------------------------------------------------- */

function pause() {
  if (mode !== 'playing' || benchMode) return;
  mode = 'paused';
  controls.setEnabled(false);
  wakeLock.release();
  showPauseNotice();
}

/**
 * Menu pause : Reprendre ; Recentrer le volant (inclinaison active) ; Direction (écran
 * tactile) ; Changer c ; Revoir les bulles ; Recommencer ; Crédits. Tout au clavier (Tab,
 * Entrée, Échap ou P pour reprendre) et au toucher (cibles ≥ 48 px).
 * @param {string} [status] message affiché (et lu) sous les réglages
 */
function showPauseNotice(status = '') {
  const content = document.createElement('div');
  content.className = 'pause-content';
  let direction = null;
  if (touchDevice) {
    const holder = document.createElement('div');
    direction = createDirectionControl(holder, { value: shownDirection(), onChange: chooseDirection });
    content.append(holder);
  }
  const statusLine = document.createElement('p');
  statusLine.className = 'pause-status';
  statusLine.setAttribute('role', 'status');
  statusLine.textContent = status;
  content.append(statusLine);
  const keys = touchDevice ? '' : ' Échap ou P pour reprendre.';
  showNotice({
    title: 'Pause',
    text: `Les deux horloges sont arrêtées (${formatLightSpeed(game.physics.c)}).${keys}`,
    content,
    variant: 'pause',
    actions: [
      { label: 'Reprendre', primary: true, onClick: onResumeClick },
      { label: 'Recentrer le volant', id: 'recentrer', hidden: !canRecenter(), onClick: recenterWheel },
      { label: 'Changer c', id: 'changer-c', onClick: showLightSpeedNotice },
      { label: 'Revoir les bulles', id: 'revoir-bulles', onClick: replayBubbles },
      { label: 'Recommencer', id: 'recommencer', onClick: () => restartGame(game.physics.c, 'Recommencer') },
      { label: 'Crédits', id: 'credits', onClick: () => credits.open() },
    ],
  });
  pauseDirection = direction;
  refreshDirection();
}

/** Message du menu pause (région role="status" : lu par les lecteurs d'écran). */
function setPauseStatus(text) {
  const line = dom.noticeContent.querySelector('.pause-status');
  if (line) line.textContent = text;
}

/** Menu pause → « Recentrer le volant » : la position actuelle du GSM devient « tout droit ». */
function recenterWheel() {
  if (!canRecenter()) return;
  setPauseStatus('Garde ton GSM comme un volant, tout droit…');
  tilt.calibrate(CALIBRATION_MS).then(() => {
    if (mode === 'paused') setPauseStatus('Volant recentré.');
  });
}

/** Menu pause → « Revoir les bulles » : les bulles d'aide déjà vues reviendront. */
function replayBubbles() {
  bubbles.reset();
  setPauseStatus("Bulles d'aide remises à zéro : elles reviendront pendant la partie.");
}

/** Menu pause → « Changer c » : le réglage, puis « Redémarrer » (nouvelle partie) ou retour. */
function showLightSpeedNotice() {
  if (mode !== 'paused') return;
  const holder = document.createElement('div');
  let proposed = game.physics.c;
  const restartLabel = (c) => `Redémarrer avec c = ${c} m/s`;
  const control = createLightSpeedControl(holder, {
    value: proposed,
    presets: LIGHT_SPEED_PRESETS,
    parse: parseLightSpeed,
    onChange: (c) => {
      proposed = c;
      const button = dom.noticeActions.querySelector('.btn-primary');
      if (button) button.textContent = restartLabel(c);
    },
  });
  showNotice({
    title: 'Changer c',
    text: 'La partie recommence au départ avec la nouvelle vitesse de la lumière.',
    content: control.element,
    actions: [
      {
        label: restartLabel(proposed),
        primary: true,
        onClick: () => {
          chooseLightSpeed(proposed);
          titleLightSpeed.setValue(proposed);
          restartGame(proposed, 'Changer c');
        },
      },
      { label: 'Annuler', onClick: () => showPauseNotice() },
    ],
  });
}

/** « Reprendre » touché ou cliqué (geste) : le plein écran quitté est redemandé. */
function onResumeClick() {
  if (touchDevice && !portrait.matches) enterFullscreen();
  resume();
}

function resume() {
  if (mode !== 'paused' || portrait.matches) return;
  hideNotice();
  enterPlaying();
}

/** Passage en jeu (départ, reprise, nouvelle partie) : commandes, écran allumé, mesures. */
function enterPlaying() {
  mode = 'playing';
  controls.setEnabled(true);
  wakeLock.acquire();
  adaptive?.reset();
  maybeCalibrate();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pause();
});
portrait.addEventListener('change', (event) => {
  if (event.matches) pause();
});

/** Fenêtre en portrait sur un écran en paysage : « Agrandis la fenêtre » au lieu de « Tourne ton GSM ». */
function updateWindowShape() {
  const landscapeScreen = window.screen.orientation?.type.startsWith('landscape') ?? false;
  document.documentElement.dataset.fenetre = portrait.matches && landscapeScreen ? 'etroite' : '';
}
updateWindowShape();
portrait.addEventListener('change', updateWindowShape);
window.screen.orientation?.addEventListener('change', updateWindowShape);

/* --- Création du jeu ------------------------------------------------------- */

/**
 * Partie pour la vitesse de la lumière c : constantes physiques, monde (scène développée pour
 * L = c²/a), caméra, joueur, butée, ?bench ; préchauffage des programmes.
 * @param {import('three').WebGLRenderer} renderer
 * @param {any} sceneJson
 * @param {number} c
 */
async function createSession(renderer, sceneJson, c) {
  const physics = physicsFor(c);
  const world = createWorld(renderer, sceneJson, palette, { tier: quality.tier, physics });
  const { width, height } = viewportSize();
  const camera = createCamera({ aspect: width / height, visibility: world.visibilityFar });
  resizeRenderer(renderer, quality, camera);

  const limits = drivableLimits(world.streets, world.bounds, SOFT_STOP_MARGIN);
  const player = createPlayer({ x: world.start.x, y: world.start.y, heading: world.start.heading, physics });
  const bench = benchMode ? createBench(sceneId, player, limits) : null;

  // Première image : îlots visibles maillés (sans budget), puis compilation de tous les
  // programmes (variantes « vision classique » comprises) et deux rendus.
  const first = bench?.scripted
    ? {
        ...snapshot(player),
        x: BENCH_QUARTIER.x,
        y: BENCH_QUARTIER.startL * physics.lengthUnit,
        heading: Math.PI / 2,
      }
    : snapshot(player);
  world.update(first, 1, 0);
  updateCamera(camera, first);
  await world.warmup(camera);
  return { physics, world, camera, player, limits, bench, lastSnapshot: first, facade: false, facadeTimer: Infinity };
}

/** Informations de la partie pour #diag. */
function sessionInfo(g) {
  return {
    'vitesse de la lumière': `${formatLightSpeed(g.physics.c)} (a = ${String(g.physics.a).replace('.', ',')} m/s², L = ${g.physics.lengthUnit} m)`,
    visibilite: `${g.world.visibilityFar} m`,
  };
}

/** Renderer, première partie et écouteurs (perte de contexte, redimensionnement, #diag). */
async function createGame() {
  const sceneJson = (await SCENES[sceneId]()).default;
  const renderer = createRenderer(dom.canvas, quality);
  if (adaptiveAllowed) {
    const { width, height } = viewportSize();
    adaptive = createAdaptiveDpr({
      max: profilePixelRatio(quality, width, height),
      min: quality.tier === 'lite' ? DPR_FLOOR_LITE : DPR_FLOOR,
    });
  }
  const session = await createSession(renderer, sceneJson, chosenC);

  const g = { renderer, sceneJson, ...session, k: 1, frames: 0, environment: true, pendingDpr: null };

  if (diag) {
    const gl = renderer.getContext();
    diag.setInfo({ ...readGlInfo(gl), ...displayInfo(g), profile: quality.tier, scene: sceneId, ...sessionInfo(g) });
    // ?sansciel : passe ciel/sol coupée dès la première image (mesure de son coût par différence).
    const setEnvironment = (on) => {
      g.environment = on;
      g.world.setEnvironmentEnabled(on);
    };
    setEnvironment(!params.has('sansciel'));
    diag.addToggle('Passe ciel/sol (E)', g.environment, setEnvironment);
    window.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyE' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      /** @type {HTMLInputElement | null} */ (dom.diag.querySelector('.diag-toggles input'))?.click();
    });
  }

  watchContextLoss(renderer, {
    timeoutMs: CONTEXT_RESTORE_TIMEOUT_MS,
    // Après une erreur (mode 'error'), le panneau « Le jeu s'est arrêté » reste affiché.
    onLost: () => {
      if (mode === 'error') return;
      if (mode === 'playing' || mode === 'paused') {
        mode = 'lost';
        controls.setEnabled(false);
        wakeLock.release();
      }
      showNotice({
        title: 'Affichage interrompu',
        text: "Le navigateur a repris la carte graphique au jeu. L'affichage revient dans un instant…",
      });
    },
    onRestored: async () => {
      if (mode === 'error') return;
      showNotice({ title: 'Affichage interrompu', text: "Préparation de l'affichage…" });
      await g.world.warmup(g.camera); // three a tout réinitialisé : recompilation, données renvoyées
      if (mode !== 'lost') {
        hideNotice();
        return;
      }
      mode = 'playing';
      if (benchMode) hideNotice();
      else pause(); // le joueur reprend quand il est prêt
    },
    onRestoreTimeout: () => {
      if (mode === 'error') return;
      showNotice({
        title: 'Affichage interrompu',
        text: "Le navigateur n'a pas rendu la carte graphique au jeu. Recharge la page pour reprendre.",
        actions: [{ label: 'Recharger', primary: true, onClick: () => window.location.reload() }],
      });
    },
  });

  observeViewport(() => {
    if (adaptive) {
      const { width, height } = viewportSize();
      adaptive.setMax(profilePixelRatio(quality, width, height));
      quality.adaptiveDpr = adaptive.dpr;
      g.pendingDpr = null;
    }
    resizeRenderer(renderer, quality, g.camera);
    if (diag) diag.setInfo(displayInfo(g));
    // En pause, le redimensionnement a effacé le canevas : on redessine l'image figée.
    if (mode === 'paused' || mode === 'done') g.world.render(g.camera);
  });

  return g;
}

/**
 * Menu pause → « Recommencer », ou « Changer c » → « Redémarrer » : nouvelle partie au
 * départ, avec la vitesse de la lumière c (le renderer, les commandes et le HUD sont gardés ;
 * le monde est refait, car la scène dépend de L = c²/a). Les bulles déjà vues le restent ;
 * celle affichée et la file d'attente sont oubliées.
 * @param {number} c
 * @param {string} [title] titre du panneau d'attente
 */
async function restartGame(c, title = 'Changer c') {
  if (mode !== 'paused' || !game) return;
  mode = 'loading';
  showNotice({ title, text: `Préparation de la ville pour ${formatLightSpeed(c)}…` });
  await nextPaint();
  const g = game;
  try {
    g.world.dispose();
    Object.assign(g, await createSession(g.renderer, g.sceneJson, c), { k: 1 });
    g.world.setEnvironmentEnabled(g.environment);
  } catch (error) {
    console.error(error);
    mode = 'error';
    showNotice({
      title: "Le jeu s'est arrêté",
      text: 'Impossible de préparer la nouvelle partie. Recharge la page pour reprendre.',
      actions: [{ label: 'Recharger', primary: true, onClick: () => window.location.reload() }],
    });
    return;
  }
  bubbles.clearPending();
  bubbleVars.reset();
  hideToast();
  if (diag) diag.setInfo(sessionInfo(g));
  hud.update(g.lastSnapshot, { k: 1 });
  hideNotice();
  enterPlaying();
  if (portrait.matches) pause();
}

/** DPR et taille du canevas, pour #diag. */
function displayInfo(g) {
  const canvas = g.renderer.domElement;
  const range = adaptive
    ? ` · adaptatif ${adaptive.min.toFixed(2)}–${adaptive.max.toFixed(2)}`
    : benchMode
      ? ' · fixe (?bench)'
      : quality.dprOverride !== null
        ? ' · imposé (?dpr=)'
        : '';
  return { dpr: `${g.renderer.getPixelRatio().toFixed(2)} (${canvas.width}×${canvas.height} px)${range}` };
}

/**
 * Clic sur « Jouer » (geste utilisateur). Dans cet ordre : permission du capteur
 * d'inclinaison (EN PREMIER, synchrone : iOS vérifie le geste à l'appel), plein écran (écran
 * tactile, si l'API existe), puis le chargement (dont l'await ferait perdre le geste).
 */
function onPlayClick() {
  if (mode !== 'title') return;
  if (wantsTilt()) requestTilt();
  if (touchDevice) enterFullscreen();
  startGame();
}

/** Chargement puis départ (après « Jouer », ou démarrage automatique de ?bench). */
async function startGame() {
  if (mode !== 'title') return;
  mode = 'loading';
  hideNotice();
  dom.play.disabled = true;
  dom.play.textContent = 'Chargement…';
  dom.play.blur(); // sinon Espace (frein) pourrait « recliquer » le bouton
  await nextPaint();
  try {
    armBootGuard(); // le démarrage « risqué » commence ici (contexte WebGL, shaders)
    game = await createGame();
  } catch (error) {
    console.error(error);
    mode = 'error';
    dom.title.hidden = true;
    showNotice({
      title: 'Impossible de lancer le jeu',
      text: 'Ce navigateur ne permet pas le rendu 3D nécessaire (WebGL2). Essaie un navigateur récent, ou recharge la page.',
      actions: [{ label: 'Recharger', primary: true, onClick: () => window.location.reload() }],
    });
    return;
  }
  dom.title.hidden = true;
  hud.show();
  if (benchMode) {
    mode = 'playing';
    wakeLock.acquire(); // mesure sur GSM : l'écran ne doit pas s'éteindre
  } else {
    mode = 'playing'; // avant setMode : un repli immédiat (permission déjà refusée) s'affiche en jeu
    controls.setMode(wantsTilt() ? 'tilt' : 'drag');
    enterPlaying();
    if (portrait.matches) pause();
  }
  refreshDirection();
  loop.start();
}

dom.play.addEventListener('click', onPlayClick);

// ?diag, ?bench et ?debug : lecture seule de l'état, pour les mesures et les tests automatisés.
if (diag || tiltDebug) {
  /** @type {any} */ (window).__coursier = {
    get mode() {
      return mode;
    },
    get k() {
      return game ? game.k : null;
    },
    /** Vitesse de la lumière de la partie en cours (ou du réglage, avant « Jouer »). */
    get c() {
      return game ? game.physics.c : chosenC;
    },
    /** Direction tactile en usage ('tilt' | 'drag') et état du capteur d'inclinaison. */
    get controlMode() {
      return controls.getMode();
    },
    get tiltState() {
      return tilt.state;
    },
    /** Angle neutre du volant d'inclinaison (degrés, calibrage). */
    get tiltNeutral() {
      return tilt.neutral;
    },
    /** Bulle affichée ({id, text}) ou null. */
    get bubble() {
      return bubbles.current();
    },
    /** DPR appliqué au canevas. */
    get dpr() {
      return game ? game.renderer.getPixelRatio() : null;
    },
    snapshot: () => (game ? { ...game.lastSnapshot } : null),
    stats: () => (game ? game.world.stats() : null),
  };
}

/* --- Une image ------------------------------------------------------------- */

/** k suit le bouton « vision classique » : 150 ms de transition, ou instantané. */
function nextK(k, classicHeld, dtReal) {
  const target = classicHeld ? 0 : 1;
  if (reducedMotion.matches) return target;
  const delta = dtReal / CLASSIC_TRANSITION_S;
  return k < target ? Math.min(target, k + delta) : Math.max(target, k - delta);
}

/**
 * Bulles pédagogiques : variables de l'image (commande appliquée, butée, façade dans l'axe à
 * 5 Hz…), puis le moteur (conditions évaluées à 5 Hz).
 * @param {any} snap
 * @param {{thrust?: number, brake?: number, steer?: number}} cmd commande appliquée
 * @param {ReturnType<typeof controls.read>} input commande du joueur
 * @param {number} dt temps propre simulé (s)
 * @param {number} dtReal
 */
function updateBubbles(snap, cmd, input, dt, dtReal) {
  const { player, limits, world } = game;
  game.facadeTimer += dtReal;
  if (game.facadeTimer >= FACADE_PERIOD_S) {
    game.facadeTimer = 0;
    game.facade = facadeAhead(world.buildings, snap.x, snap.y, snap.hx, snap.hy);
  }
  bubbles.update(
    bubbleVars.compute({
      snapshot: snap,
      command: { ...cmd, classic: input.classic },
      k: game.k,
      a: game.physics.a,
      modeVolant: input.lastSource === 'clavier' ? 'clavier' : controls.getMode(),
      distanceDevant: exitDistance(player.x, player.y, player.hx, player.hy, limits),
      facadeDevant: game.facade,
      butee: cmd !== input,
    }),
    dt,
  );
}

/**
 * @param {number} dtReal temps réel écoulé (s)
 * @param {number} dt temps propre à simuler (s), plafonné à MAX_FRAME_DT
 */
function frame(dtReal, dt) {
  const input = controls.read();
  if (input.pause && !benchMode) {
    if (mode === 'playing') pause();
    else if (mode === 'paused') resume();
  }
  if (mode !== 'playing' || !game) return;
  const { world, camera, player, bench, renderer } = game;

  // DPR adaptatif décidé à l'image précédente : appliqué avant le rendu (pas d'image effacée).
  if (game.pendingDpr !== null) {
    quality.adaptiveDpr = game.pendingDpr;
    game.pendingDpr = null;
    resizeRenderer(renderer, quality, camera);
    if (diag) diag.setInfo(displayInfo(game));
  }

  // Simulation.
  const t0 = performance.now();
  let snap;
  let cmd = null;
  if (bench) {
    snap = bench.advance();
  } else {
    cmd = softStopCommand(player, input, game.limits);
    step(player, cmd, dt);
    keepInside(player, game.limits);
    snap = snapshot(player);
    playClockMs += dtReal * 1000;
  }
  game.k = nextK(game.k, !bench && input.classic, dtReal);
  if (cmd) updateBubbles(snap, cmd, input, dt, dtReal);
  world.update(snap, game.k, dtReal);
  updateCamera(camera, snap);
  const t1 = performance.now();

  // Rendu.
  world.render(camera);
  const t2 = performance.now();
  const stats = world.stats();

  // Interface.
  if (dtReal > 0) averageDt = Number.isFinite(averageDt) ? averageDt + 0.05 * (dtReal - averageDt) : dtReal;
  hud.update(snap, { k: game.k, fps: diag ? 1 / averageDt : undefined });
  diag?.frame({ dtMs: dtReal * 1000, cpuMs: t2 - t1, calls: stats.calls, triangles: stats.triangles });

  // DPR adaptatif : une mesure par image (intervalle, CPU de step + render).
  if (adaptive) {
    const next = adaptive.sample(dtReal * 1000, t2 - t0);
    if (next !== null) game.pendingDpr = next;
  }

  game.lastSnapshot = snap;
  game.frames += 1;
  if (game.frames === BOOT_CONFIRM_FRAMES) confirmBoot();

  if (bench) {
    bench.record({ dtMs: dtReal * 1000, renderMs: t2 - t1, updateMs: t1 - t0, stats, environment: game.environment });
    if (bench.done) finishBench();
  }
}

/** Fin de ?bench : résultats dans #diag et dans window.__benchResult. */
function finishBench() {
  const { renderer, bench } = game;
  loop.stop();
  mode = 'done';
  wakeLock.release();
  if (game.frames < BOOT_CONFIRM_FRAMES) confirmBoot();
  const gl = renderer.getContext();
  const canvas = renderer.domElement;
  const result = bench.result({
    dpr: renderer.getPixelRatio(),
    canvas: [canvas.width, canvas.height],
    tier: quality.tier,
    gpu: readGlInfo(gl).renderer,
    userAgent: navigator.userAgent,
  });
  /** @type {any} */ (window).__benchResult = result;
  // Résultats lisibles sur GSM : le HUD s'efface et #diag monte en haut, sur toute la largeur.
  hud.hide();
  dom.diag.classList.add('diag-results');
  const ms = (s) => `p50 ${s.p50} · p95 ${s.p95} · max ${s.max} ms`;
  const f = result.frameMs;
  diag?.setInfo({
    'Bench terminé': `${result.scene}, ${result.frames} images en ${result.durationS} s, ciel/sol ${result.environmentPass}`,
    'Bench image': `p50 ${f.p50} ms (${Math.round(1000 / f.p50)} i/s) · p95 ${f.p95} · max ${f.max} ms`,
    'Bench CPU rendu': ms(result.renderCpuMs),
    'Bench CPU simulation': ms(result.updateCpuMs),
    'Bench appels max': result.drawCallsMax,
    'Bench triangles max': `${(result.trianglesMax / 1000).toFixed(1)} k`,
  });
  console.info(`[bench] ${JSON.stringify(result)}`);
}

/* --- Démarrage ------------------------------------------------------------- */

if (benchMode) {
  startGame();
} else if (quality.unstable) {
  showNotice({
    title: 'WebGL instable',
    text: "Le jeu s'est interrompu deux fois au démarrage. Il repart en mode allégé (moins de pixels, sans anticrénelage).",
    actions: [{ label: 'Réessayer', primary: true, onClick: onPlayClick }],
  });
}
