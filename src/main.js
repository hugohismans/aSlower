/**
 * Point d'entrée du jeu : menu principal → niveaux (sélection, briefing, décompte, partie,
 * bilan ou échec) ou conduite libre (l'avenue de test) ; monde, caméra, commandes, HUD et
 * boucle d'images.
 *
 * Paramètres d'URL (docs/interfaces.md) :
 * - ?scene=avenue-test (par défaut) | quartier-test : scène de la conduite libre ;
 * - ?diag : panneau de diagnostic #diag (touche E ou case « Passe ciel/sol » : couper la
 *   passe d'environnement pour mesurer son coût) ;
 * - ?bench : parcours de mesure automatique en conduite libre, sans entrée (voir createBench),
 *   avec #diag ; résultat affiché dans #diag et exposé dans window.__benchResult ;
 * - ?sansciel (avec ?diag ou ?bench) : passe ciel/sol coupée dès la première image ;
 * - ?dpr= : rapport de pixels imposé (render/quality.js ; coupe le DPR adaptatif) ;
 * - ?c=n : vitesse de la lumière (entier de 10 à 100 m/s), prioritaire sur le réglage mémorisé
 *   (game/settings.js) et jamais mémorisée ;
 * - ?debug : panneau de l'inclinaison (hud/tiltDebug.js : α, β, γ, angle, neutre, volant) ;
 * - ?autopilote[=reference|naif] : en niveau, le pilote de référence (game/bot.js) conduit à
 *   la place du joueur, sur l'itinéraire `parcours` du niveau (défaut : reference), à pas fixes
 *   de 1/60 s ; pour les tests automatisés et les démonstrations. Sans effet sans ce paramètre.
 *
 * Machine à états des niveaux (game/states.js) : chargement → menu → selection → briefing →
 * decompte → enCours ⇄ pause / reprise → bilan | echec. Les écrans sont rendus par
 * hud/screens.js ; les horloges ne tournent qu'en « enCours » (décompte de 3 s au départ,
 * d'1 s après une pause ou une reprise ; calibrage du volant d'inclinaison pendant le décompte).
 * La conduite libre garde le fonctionnement du jalon 2 (butée douce, pas de collision).
 *
 * Vitesse de la lumière : réglage du joueur (menu, ou « Changer c » dans le menu pause, qui
 * redémarre la partie). Toute la partie lit ses constantes dans physicsFor(c) : joueur, scène
 * (longueurs en L = c²/a), niveau, butée, ?bench ; le HUD et le rendu lisent snapshot.c. La
 * progression (game/progress.js) est gardée par niveau et par c.
 *
 * Direction tactile (jalon 2) : inclinaison du GSM (input/tilt.js) ou glisser, réglage
 * « Direction » du menu et du menu pause, mémorisé (aslower:v1:commandes) ; par défaut
 * l'inclinaison sur écran tactile. La permission du capteur est demandée EN PREMIER dans le
 * geste qui lance la partie (« C'est parti », « Conduite libre » : exigé par iOS), puis le
 * plein écran (Android), puis le chargement. Repli automatique en glisser, annoncé (aria-live).
 *
 * Une image de niveau : commandes (ou pilote) → level.advance (player.step, collisions,
 * règles, reprises ; dτ ≤ 0,1 s) → événements (états, messages, bulles) → vision classique (k)
 * → bulles globales et du niveau → world.update + updateLevel (zones, clients et portes VUS à
 * t_e, couleur des lampes par la chaîne de la règle) → caméra → rendu → HUD et HUD de niveau
 * (12 Hz) → #diag → DPR adaptatif. Conduite libre : commandes → butée douce → player.step → …
 *
 * Pauses (horloges gelées, horloge des bulles comprise, écran plus maintenu allumé) : Échap
 * ou P, onglet caché, panneau « Tourne ton GSM », perte du contexte WebGL.
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
import { formatClock, formatGap, formatKmh, formatLightSpeed } from './hud/format.js';
import { createLevelHud } from './hud/levelHud.js';
import {
  activeAids,
  batteryFraction,
  batteryLevel,
  brakingDistance,
  failureText,
  formatBattery,
  formatClockShort,
  formatDistance,
  formatStars,
  hintFor,
  hueSpeedWindow,
  resultFigures,
  spectrometerReading,
  starLines,
  stopIndicator,
  stopTiming,
} from './hud/levelFormat.js';
import { createLightSpeedControl } from './hud/lightSpeed.js';
import { createScreens } from './hud/screens.js';
import { createSettingsPanel } from './hud/settingsPanel.js';
import { createSky } from './hud/sky.js';
import { createTiltDebug, tiltDebugFromUrl } from './hud/tiltDebug.js';
import { BUBBLES_SCHEMA, createBubbleEngine, createBubbleVariables, facadeAhead } from './game/bubbles.js';
import { BOT_DT, createBotDriver } from './game/bot.js';
import { advance, createLevel, createLevelPlayer } from './game/level.js';
import { canSkip, isUnlocked, levelStats, loadProgress, recordResult, recordSkip, saveProgress, totalStars } from './game/progress.js';
import { activeStops, perceivedLamp, seenClientPresent, seenDoorOpen } from './game/rules.js';
import { computeScore } from './game/score.js';
import {
  LIGHT_SPEED_PRESETS,
  initialLightSpeed,
  loadControlMode,
  loadOptions,
  parseLightSpeed,
  saveControlMode,
  saveOptions,
  saveSettings,
} from './game/settings.js';
import { createStateMachine } from './game/states.js';
import { LEVEL_FILES, LEVEL_IDS, levelJson } from './levels/index.js';
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
/* Niveaux : constantes                                                       */
/* ------------------------------------------------------------------------- */

/** Décomptes (s) : au départ d'une partie, puis après une pause ou une reprise. */
const COUNTDOWN_START_S = 3;
const COUNTDOWN_RESUME_S = 1;
/** Durée d'affichage de « Partez ! » (s) et du message de reprise (s). */
const GO_TEXT_S = 0.6;
const REPRISE_MESSAGE_S = 1.6;
/** Messages courts du jeu (livraison, porte…) : durée d'affichage (ms). */
const TOAST_EVENT_MS = 2200;
/** Un choc plus court que ceci (s d'étourdissement) n'est pas annoncé. */
const STUN_TOAST_MIN_S = 0.3;
/** Spectromètre : lampes vues dans ±60° devant, à moins de 3 × la fin de la portée de la porte. */
const SPECTRO_HALF_ANGLE = Math.PI / 3;
const SPECTRO_RANGE = 3;
/** Bulle « dépassé » : arrêt derrière, à moins de cette distance (m). */
const BEHIND_MAX_M = 60;

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
  freeDrive: /** @type {HTMLButtonElement} */ ($('free-drive')),
  openCredits: $('open-credits'),
  openSettings: $('open-settings'),
  openTheory: /** @type {HTMLAnchorElement} */ ($('open-theory')),
  settings: /** @type {HTMLDialogElement} */ ($('settings')),
  settingsSpectro: $('settings-spectro'),
  settingsBubbles: $('settings-bubbles'),
  homeStars: $('home-stars'),
  homeC: $('home-c'),
  homeCInline: $('home-c-inline'),
  playSub: $('play-sub'),
  sky: /** @type {HTMLCanvasElement} */ ($('sky')),
  skyReadout: $('sky-readout'),
  credits: /** @type {HTMLDialogElement} */ ($('credits')),
  diag: $('diag'),
  notice: $('notice'),
  noticeTitle: $('notice-title'),
  noticeText: $('notice-text'),
  noticeContent: $('notice-content'),
  noticeActions: $('notice-actions'),
  lightSpeed: $('light-speed'),
  direction: $('direction'),
  helpIos: $('help-ios'),
  screen: $('screen'),
  countdown: $('countdown'),
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
/** ?autopilote[=reference|naif] : itinéraire du pilote de référence en niveau, ou null. */
const autopilotRoute = params.has('autopilote') ? params.get('autopilote') || 'reference' : null;

/** Écran tactile : direction par inclinaison par défaut, réglage Direction, plein écran. */
const touchDevice = window.matchMedia('(any-pointer: coarse)').matches;

// Vitesse de la lumière de la prochaine partie : ?c= (prioritaire), sinon le réglage mémorisé.
const startLight = initialLightSpeed(window.location.search);
if (startLight.message) console.warn(startLight.message);
/** Réglage de c choisi au menu (ou au menu pause) pour la prochaine partie. */
let chosenC = startLight.c;

/** Mémorise le réglage (pas une valeur venue de ?c= tant que le joueur n'y touche pas). */
function chooseLightSpeed(c) {
  chosenC = c;
  saveSettings({ c });
  refreshHome();
}

// Garde-fou de démarrage (lecture) : à appeler une fois, avant de créer le renderer.
const quality = createQuality();

/**
 * État de la boucle : 'title' (menus et écrans, rien à dessiner) → 'loading' → 'countdown'
 * (vue dessinée, horloges arrêtées) → 'playing' ⇄ 'paused' ; 'frozen' (bilan, échec, message
 * de reprise : dernière image gardée) ; 'lost' (contexte WebGL perdu) ; 'done' (fin de ?bench) ;
 * 'error'.
 */
let mode = 'title';
/** Partie en cours : 'libre' (conduite libre) ou 'niveau' ; null au menu. */
let flow = null;
/** Renderer et partie (créés au premier lancement ; la partie est refaite à chaque niveau). */
let game = null;
/** Intervalle moyen entre images (s), pour les i/s du HUD en ?diag. */
let averageDt = NaN;

/** Réglages Direction de l'écran titre et du menu pause (ce dernier, recréé à chaque ouverture). */
let titleDirection = null;
let pauseDirection = null;

/** Progression mémorisée (aslower:v1:progression), par niveau et par c. */
let progress = loadProgress();
/** Options (aslower:v1:options) : spectromètre. */
let options = loadOptions();
/** Niveau choisi (id) pour le briefing et la partie. */
let selectedLevelId = null;

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
  if (mode === 'playing' || mode === 'countdown') showToast(text, TOAST_FALLBACK_MS, { announce: false });
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

/**
 * Calibrage (≈ 0,5 s) quand l'inclinaison répond, en jeu ou pendant le décompte : la position
 * tenue devient « tout droit ».
 */
function maybeCalibrate() {
  if (!calibrationPending || (mode !== 'playing' && mode !== 'countdown') || controls.getMode() !== 'tilt' || tilt.state !== 'actif') return;
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
  if (game?.session && (mode === 'playing' || mode === 'paused')) controls.setMode(next);
  refreshDirection();
}

/** Mode affiché par les réglages Direction : celui en usage, ou le repli. */
function shownDirection() {
  if (game?.session && mode !== 'title') return controls.getMode();
  if (!touchDevice) return 'drag';
  return preferredMode === 'tilt' && tiltFallback ? 'drag' : preferredMode;
}

/** Met à jour les réglages Direction (accueil, pause) et « Recentrer le volant ». */
function refreshDirection() {
  const shown = shownDirection();
  const message = tiltFallback && wantsTilt() ? TILT_FALLBACK_TEXTS[tiltFallback] : '';
  for (const control of [titleDirection, pauseDirection]) {
    if (!control) continue;
    control.setValue(shown);
    control.setMessage(message);
    control.setRetry(Boolean(message));
  }
  const recenter = /** @type {HTMLElement | null} */ (dom.noticeActions.querySelector('[data-action="recentrer"]'));
  if (recenter) recenter.hidden = !canRecenter();
}

/** « Recentrer le volant » n'a de sens qu'en inclinaison, capteur actif. */
function canRecenter() {
  return controls.getMode() === 'tilt' && tilt.state === 'actif';
}

/* --- HUD, bulles, écrans, Crédits, #diag ------------------------------------------ */

const hud = createHud(dom.hud, { phiMax: PHI_MAX_DEFAULT });
const levelHud = createLevelHud(dom.hud);
levelHud.hide();
const screens = createScreens(dom.screen, dom.countdown);

/** Horloge réelle de jeu (ms) : avance seulement en jeu, s'arrête en pause (durées des bulles). */
let playClockMs = 0;
// Après createHud (qui remplit #hud) : la bulle se place sous les horloges.
const bubbleView = createBubbleView(dom.hud, { announcer, onDismiss: () => bubbles.dismiss() });
/**
 * Moteur de bulles : bulles globales (src/data/bubbles.json) et, en niveau, celles du niveau
 * (ids distincts, vérifiés par le validateur). Refait à chaque partie (vues gardées).
 * @param {any} [levelDef] JSON du niveau
 */
function makeBubbleEngine(levelDef = null) {
  const bulles = [...bubblesJson.bulles, ...(levelDef?.bulles ?? [])];
  return createBubbleEngine({ definitions: { schema: BUBBLES_SCHEMA, bulles }, store: local, now: () => playClockMs });
}
let bubbles = makeBubbleEngine();
let unsubscribeBubbles = bubbles.onShow((b) => (b ? bubbleView.show(b) : bubbleView.hide()));
/** Change le moteur de bulles (nouvelle partie : bulles du niveau). */
function useBubbleEngine(levelDef) {
  unsubscribeBubbles();
  bubbleView.hide();
  bubbles = makeBubbleEngine(levelDef);
  unsubscribeBubbles = bubbles.onShow((b) => (b ? bubbleView.show(b) : bubbleView.hide()));
}
const bubbleVars = createBubbleVariables();

// Messages courts du jeu (calibrage, repli, livraisons) : même allure qu'une bulle, hors du
// moteur de bulles. Sans annonceur : showToast annonce lui-même, sauf si l'appelant l'a fait.
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
const settingsPanel = createSettingsPanel(dom.settings);
dom.openSettings.addEventListener('click', () => settingsPanel.open());
// Page « Théorie » (theorie/), servie à côté du jeu (« /aSlower/theorie/ » sur GitHub Pages).
dom.openTheory.href = `${import.meta.env.BASE_URL}theorie/`;
/** Ciel animé des menus (accueil, sélection, briefing) ; jamais en ?bench. */
const sky = benchMode ? null : createSky(dom.sky, { readout: dom.skyReadout });
const diag = diagMode ? createDiag(dom.diag) : null;
diag?.show();
const tiltDebug = tiltDebugFromUrl(window.location.search) ? createTiltDebug(document.body) : null;
if (tiltDebug) {
  tiltDebug.show();
  // Panneau ?debug : mis à jour à chaque image, écran titre et pause compris.
  const debugTick = () => {
    tiltDebug.update({ ...tilt.debugInfo(), mode: game?.session ? controls.getMode() : `${preferredMode}, titre` });
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

/** Accueil : étoiles gagnées (tous niveaux, meilleur c) et vitesse de la lumière choisie. */
function refreshHome() {
  const total = totalStars(progress, LEVEL_IDS);
  const max = 3 * LEVEL_IDS.length;
  dom.homeStars.textContent = `${total} étoile${total > 1 ? 's' : ''} sur ${max}`;
  dom.homeC.textContent = `${formatLightSpeed(chosenC)} ≈ ${formatKmh(chosenC)}`;
  dom.homeCInline.textContent = `${chosenC}\u00a0m/s`;
  dom.playSub.textContent = `${LEVEL_IDS.length} tournées · ${total}\u202f/\u202f${max} ★`;
}
refreshHome();

// Réglages → Aides : spectromètre (même bascule que la sélection et la pause), bulles.
dom.settingsSpectro.textContent = spectroLabel();
dom.settingsSpectro.setAttribute('aria-pressed', String(options.spectrometre));
dom.settingsSpectro.addEventListener('click', () => {
  toggleSpectro();
  settingsPanel.setStatus(options.spectrometre ? 'Spectromètre : la teinte des lampes s’affichera en mots.' : 'Spectromètre coupé.');
});
dom.settingsBubbles.addEventListener('click', () => {
  bubbles.reset();
  settingsPanel.setStatus("Bulles d'aide remises à zéro : elles reviendront pendant la partie.");
});
sky?.show();

/** Option « Spectromètre » (sélection des niveaux et pause) : bouton bascule (aria-pressed). */
function spectroLabel() {
  return `Spectromètre : ${options.spectrometre ? 'oui' : 'non'}`;
}
/** Bascule l'option (sélection des niveaux, menu pause) et met à jour ses boutons. */
function toggleSpectro() {
  options = { ...options, spectrometre: !options.spectrometre };
  saveOptions(options);
  for (const b of document.querySelectorAll('[data-option="spectrometre"]')) {
    b.textContent = spectroLabel();
    b.setAttribute('aria-pressed', String(options.spectrometre));
  }
}

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
    ...actions.map(({ label, primary = false, onClick, id, hidden = false, pressed }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = primary ? 'btn btn-primary' : 'btn';
      button.textContent = label;
      if (id) button.dataset.action = id;
      if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
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

/** Panneau « Le jeu s'est arrêté » après une erreur de préparation. */
function showFatal(text) {
  mode = 'error';
  showNotice({
    title: "Le jeu s'est arrêté",
    text,
    actions: [{ label: 'Recharger', primary: true, onClick: () => window.location.reload() }],
  });
}

/* --- Machine à états des niveaux ---------------------------------------------- */

const sm = createStateMachine({ onChange: onStateChange });

/**
 * Effets d'un changement d'état (game/states.js) : écrans, HUD, décompte, boucle.
 * @param {string} to
 * @param {string} from
 * @param {string} event
 */
function onStateChange(to, from, event) {
  if (to !== 'pause') hideNotice();
  // « Partez ! » reste affiché un instant au début de la partie (frame le retire).
  if (to !== 'decompte' && to !== 'enCours') screens.hideCountdown();
  switch (to) {
    case 'menu':
      leaveGameView();
      screens.hide();
      refreshHome();
      dom.title.hidden = false;
      // Au chargement sur écran tactile, pas de focus (son anneau n'aide qu'au clavier).
      if (!(touchDevice && from === 'chargement')) dom.play.focus({ preventScroll: true });
      break;
    case 'selection':
      leaveGameView();
      dom.title.hidden = true;
      showSelection();
      break;
    case 'briefing':
      leaveGameView();
      dom.title.hidden = true;
      showBriefing();
      break;
    case 'decompte':
      screens.hide();
      sky?.hide();
      startCountdown(from === 'pause' && event === 'reprendre' ? COUNTDOWN_RESUME_S : from === 'reprise' ? COUNTDOWN_RESUME_S : COUNTDOWN_START_S);
      break;
    case 'enCours':
      if (!(game?.countdown?.go > 0)) screens.hideCountdown();
      enterPlaying();
      break;
    case 'pause':
      mode = 'paused';
      controls.setEnabled(false);
      wakeLock.release();
      screens.hideCountdown();
      showPauseNotice();
      break;
    case 'reprise':
      mode = 'frozen';
      controls.setEnabled(false);
      screens.showCountdown(game.repriseText ?? 'Reprise', { small: true });
      game.repriseTimer = REPRISE_MESSAGE_S;
      break;
    case 'bilan':
      mode = 'frozen';
      controls.setEnabled(false);
      wakeLock.release();
      showResult();
      break;
    case 'echec':
      mode = 'frozen';
      controls.setEnabled(false);
      wakeLock.release();
      showFailure();
      break;
    default:
      break;
  }
  refreshDirection();
}

/** Hors de la vue de jeu (menus, sélection, briefing) : HUD masqué, commandes coupées, ciel. */
function leaveGameView() {
  if (mode !== 'loading') mode = 'title';
  sky?.show();
  controls.setEnabled(false);
  wakeLock.release();
  hud.hide();
  levelHud.hide();
  hideToast();
  bubbleView.hide();
}

/** Niveau suivant (id) dans l'ordre des numéros, ou null. */
function nextLevelId(id) {
  const i = LEVEL_IDS.indexOf(id);
  return i >= 0 && i + 1 < LEVEL_IDS.length ? LEVEL_IDS[i + 1] : null;
}

/** Sélection des niveaux : étoiles à ce c (et meilleures tous c), verrous. */
function showSelection() {
  const levels = LEVEL_FILES.map(({ id, json }) => {
    const stats = levelStats(progress, id, chosenC);
    const locked = !isUnlocked(progress, LEVEL_IDS, id);
    const here = stats.etoilesC ?? 0;
    let note = '';
    if (locked) note = 'Termine le niveau précédent pour le débloquer.';
    else if (stats.passe && !stats.reussi) note = 'Passé (sans étoile).';
    else if (stats.etoiles > here) note = `Meilleur : ${formatStars(stats.etoiles)} à un autre c.`;
    return {
      id,
      numero: json.numero,
      titre: json.titre,
      notion: json.notion,
      stars: formatStars(here),
      starsLabel: `${here} étoile${here > 1 ? 's' : ''} sur 3 à c = ${chosenC} m/s.`,
      locked,
      note,
    };
  });
  const total = totalStars(progress, LEVEL_IDS);
  screens.showSelection({
    levels,
    cText: formatLightSpeed(chosenC),
    total: `${total} étoile${total > 1 ? 's' : ''} sur ${3 * LEVEL_IDS.length}`,
    onChoose: (id) => {
      selectedLevelId = id;
      sm.send('choisir');
    },
    onBack: () => sm.send('retour'),
    option: { label: spectroLabel(), pressed: options.spectrometre, onToggle: toggleSpectro },
  });
}

/** Clients du briefing, avec les heures de la ville qui comptent. */
function briefingClients(json) {
  return json.colis.map((p) => {
    const when = [];
    if (p.retrait?.pasAvant !== undefined) when.push(`prêt à ${formatClockShort(p.retrait.pasAvant)}`);
    if (p.livraison.pasAvant !== undefined) when.push(`absent avant ${formatClockShort(p.livraison.pasAvant)}`);
    if (p.delai !== undefined) when.push(`avant ${formatClockShort(p.delai)}`);
    return { client: p.client, nom: p.nom ?? 'colis', when: when.join(', ') };
  });
}

/** Rappel des commandes du briefing : celles de l'appareil (et de la direction choisie). */
function controlsHelp() {
  if (!touchDevice) return 'Clavier : ↑ accélérer · ← → tourner · Espace freiner · C vision classique · Échap pause';
  return shownDirection() === 'tilt'
    ? 'Penche ton GSM pour tourner · Maintiens à droite pour accélérer · Frein en bas à gauche · 👁 vision classique'
    : 'Glisse à gauche pour tourner · Maintiens à droite pour accélérer · Frein en bas · 👁 vision classique';
}

/** Échecs mémorisés sur un niveau (tous c). */
const failuresOf = (id) => progress.niveaux[id]?.echecs ?? 0;

/** Briefing du niveau choisi ; « C'est parti » est le geste qui lance la partie. */
function showBriefing() {
  const json = levelJson(selectedLevelId);
  if (!json) {
    sm.send('retour');
    return;
  }
  const hint = hintFor(json.indices, failuresOf(json.id));
  const view = screens.showBriefing({
    numero: json.numero,
    titre: json.titre,
    notion: json.notion,
    lines: json.briefing,
    clients: briefingClients(json),
    battery: `${json.batterie.tauMax} s`,
    cText: formatLightSpeed(chosenC),
    hint: hint ? hint.texte : '',
    controls: controlsHelp(),
    onGo: () => onGoClick(view),
    onBack: () => sm.send('retour'),
  });
}

/**
 * « C'est parti ! » (geste) : permission d'inclinaison EN PREMIER (iOS), plein écran, puis
 * chargement du niveau, puis décompte.
 * @param {{setBusy(text: string | null): void}} view
 */
function onGoClick(view) {
  if (mode === 'loading' || sm.state !== 'briefing') return;
  if (wantsTilt()) requestTilt();
  if (touchDevice) enterFullscreen();
  view.setBusy('Préparation…');
  startLevel(selectedLevelId, chosenC).then((ok) => {
    view.setBusy(null);
    if (ok && sm.state === 'briefing') sm.send('partir');
  });
}

/* --- Décompte ----------------------------------------------------------------- */

/**
 * Décompte de `seconds` s (vue dessinée, horloges arrêtées) ; calibrage du volant
 * d'inclinaison pendant ce temps (au départ d'une partie).
 * @param {number} seconds
 */
function startCountdown(seconds) {
  mode = 'countdown';
  controls.setEnabled(false);
  hud.show();
  if (flow === 'niveau') levelHud.show();
  dom.title.hidden = true;
  sky?.hide();
  game.countdown = { remaining: seconds, go: 0 };
  screens.showCountdown(String(Math.ceil(seconds)));
  if (seconds >= COUNTDOWN_START_S && controls.getMode() === 'tilt') calibrationPending = true;
  maybeCalibrate();
  if (!loop.running) loop.start();
}

/* --- Pause ---------------------------------------------------------------- */

/** Pause demandée (Échap, onglet caché, portrait) : niveau → machine à états ; libre → menu. */
function pause(reason = 'pause') {
  if (benchMode) return;
  if (flow === 'niveau') {
    if (sm.can(reason)) sm.send(reason);
    return;
  }
  if (mode !== 'playing') return;
  mode = 'paused';
  controls.setEnabled(false);
  wakeLock.release();
  showPauseNotice();
}

/**
 * Menu pause : Reprendre ; Recentrer le volant (inclinaison active) ; Direction (écran
 * tactile) ; Spectromètre ; Changer c ; Revoir les bulles ; Recommencer ; Quitter le niveau
 * (niveau) ou Menu principal (conduite libre) ; Crédits. Tout au clavier (Tab, Entrée, Échap
 * ou P pour reprendre) et au toucher (cibles ≥ 48 px).
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
  const inLevel = flow === 'niveau';
  const where = inLevel ? `${game.level.titre} · ` : '';
  showNotice({
    title: 'Pause',
    text: `${where}Les deux horloges sont arrêtées (${formatLightSpeed(game.physics.c)}).${keys}`,
    content,
    variant: 'pause',
    actions: [
      { label: 'Reprendre', primary: true, onClick: onResumeClick },
      { label: 'Recentrer le volant', id: 'recentrer', hidden: !canRecenter(), onClick: recenterWheel },
      { label: spectroLabel(), id: 'spectrometre', pressed: options.spectrometre, onClick: toggleSpectroInPause },
      { label: 'Changer c', id: 'changer-c', onClick: showLightSpeedNotice },
      { label: 'Revoir les bulles', id: 'revoir-bulles', onClick: replayBubbles },
      { label: 'Recommencer', id: 'recommencer', onClick: () => (inLevel ? restartLevelFromPause(game.physics.c) : restartGame(game.physics.c, 'Recommencer')) },
      inLevel
        ? { label: 'Quitter le niveau', id: 'quitter', onClick: () => sm.send('quitter') }
        : { label: 'Menu principal', id: 'menu', onClick: leaveFreeDrive },
      { label: 'Crédits', id: 'credits', onClick: () => credits.open() },
    ],
  });
  const spectro = dom.noticeActions.querySelector('[data-action="spectrometre"]');
  spectro?.setAttribute('data-option', 'spectrometre');
  pauseDirection = direction;
  refreshDirection();
}

/** Bascule du spectromètre depuis le menu pause. */
function toggleSpectroInPause() {
  toggleSpectro();
  setPauseStatus(options.spectrometre ? 'Spectromètre : la teinte des lampes s’affiche en mots.' : 'Spectromètre coupé.');
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
  const restartLabel = (c) => `Redémarrer avec c = ${c} m/s`;
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
    text: flow === 'niveau' ? 'Le niveau recommence au départ avec la nouvelle vitesse de la lumière.' : 'La partie recommence au départ avec la nouvelle vitesse de la lumière.',
    content: control.element,
    actions: [
      {
        label: restartLabel(proposed),
        primary: true,
        onClick: () => {
          chooseLightSpeed(proposed);
          titleLightSpeed.setValue(proposed);
          if (flow === 'niveau') restartLevelFromPause(proposed);
          else restartGame(proposed, 'Changer c');
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
  if (flow === 'niveau') {
    sm.send('reprendre'); // → décompte d'une seconde
    return;
  }
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
  if (document.visibilityState === 'hidden') pause('cache');
});
portrait.addEventListener('change', (event) => {
  if (event.matches) pause('cache');
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
 * Vue statique d'un niveau pour le rendu (render/levelObjects.js) : zones, portes, emprises.
 * @param {import('./game/level.js').LevelState} level
 */
function levelView(level) {
  const stops = [];
  for (const p of level.colis) {
    if (p.retrait) stops.push({ key: `${p.id}:retrait`, kind: 'retrait', x: p.retrait.x, y: p.retrait.y, rayon: p.retrait.rayon });
    stops.push({ key: `${p.id}:livraison`, kind: 'livraison', x: p.livraison.x, y: p.livraison.y, rayon: p.livraison.rayon });
  }
  const doors = level.portes.map((d) => ({ id: d.id, x: d.x, y: d.y, capDegres: d.capDegres, largeur: d.largeur, hauteur: d.hauteur, lampZ: d.lampe.z }));
  return { stops, doors, buildings: level.scene.buildings };
}

/**
 * Partie pour la vitesse de la lumière c : constantes physiques, monde (scène développée pour
 * L = c²/a), caméra, joueur ; en niveau, l'état de partie (game/level.js) et ses objets ; en
 * conduite libre, la butée et ?bench ; préchauffage des programmes.
 * @param {import('three').WebGLRenderer} renderer
 * @param {{sceneJson?: any, levelDef?: any}} what scène de conduite libre, ou niveau (JSON)
 * @param {number} c
 */
async function createSession(renderer, { sceneJson = null, levelDef = null }, c) {
  const physics = physicsFor(c);
  const level = levelDef ? createLevel(levelDef, physics, palette) : null;
  const world = createWorld(renderer, level ? level.sceneJson : sceneJson, palette, {
    tier: quality.tier,
    physics,
    level: level ? levelView(level) : null,
  });
  const { width, height } = viewportSize();
  const camera = createCamera({ aspect: width / height, visibility: world.visibilityFar });
  resizeRenderer(renderer, quality, camera);

  const limits = level ? null : drivableLimits(world.streets, world.bounds, SOFT_STOP_MARGIN);
  const player = level ? createLevelPlayer(level) : createPlayer({ x: world.start.x, y: world.start.y, heading: world.start.heading, physics });
  const bench = !level && benchMode ? createBench(sceneId, player, limits) : null;

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
  if (level) world.updateLevel(levelRenderState(level, first, 1), first, 0);
  updateCamera(camera, first);
  await world.warmup(camera);
  return {
    physics,
    world,
    camera,
    player,
    limits,
    bench,
    level,
    levelDef,
    driver: level ? makeDriver(level, physics) : null,
    lastSnapshot: first,
    facade: false,
    facadeTimer: Infinity,
    odometer: 0,
    aids: level ? activeAids(levelDef.indices, failuresOf(levelDef.id)) : new Set(),
    speedZones: new Map(),
    countdown: null,
    repriseTimer: 0,
    repriseText: null,
    finished: false,
  };
}

/** Pilote de ?autopilote pour ce niveau (game/bot.js), ou null. */
function makeDriver(level, physics) {
  if (!autopilotRoute) return null;
  const route = level.level.parcours?.[autopilotRoute];
  if (!route) {
    console.warn(`?autopilote : pas d'itinéraire « ${autopilotRoute} » dans ${level.id}.`);
    return null;
  }
  return createBotDriver(route, physics);
}

/** Informations de la partie pour #diag. */
function sessionInfo(g) {
  return {
    'vitesse de la lumière': `${formatLightSpeed(g.physics.c)} (a = ${String(g.physics.a).replace('.', ',')} m/s², L = ${g.physics.lengthUnit} m)`,
    visibilite: `${g.world.visibilityFar} m`,
    ...(g.level ? { niveau: g.level.id } : {}),
  };
}

/**
 * Renderer (une fois) et ses écouteurs : perte de contexte, redimensionnement, #diag.
 * @returns {Promise<any>} objet de jeu {renderer, …, session}
 */
async function ensureGame() {
  if (game) return game;
  const renderer = createRenderer(dom.canvas, quality);
  if (adaptiveAllowed) {
    const { width, height } = viewportSize();
    adaptive = createAdaptiveDpr({
      max: profilePixelRatio(quality, width, height),
      min: quality.tier === 'lite' ? DPR_FLOOR_LITE : DPR_FLOOR,
    });
  }
  const g = { renderer, session: false, k: 1, frames: 0, environment: !params.has('sansciel'), pendingDpr: null, key: null };
  game = g;

  if (diag) {
    const gl = renderer.getContext();
    diag.setInfo({ ...readGlInfo(gl), profile: quality.tier, scene: sceneId });
    // ?sansciel : passe ciel/sol coupée dès la première image (mesure de son coût par différence).
    const setEnvironment = (on) => {
      g.environment = on;
      if (g.session) g.world.setEnvironmentEnabled(on);
    };
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
      if (mode === 'playing' || mode === 'paused' || mode === 'countdown') {
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
      if (g.session) await g.world.warmup(g.camera); // three a tout réinitialisé
      if (mode !== 'lost') {
        hideNotice();
        return;
      }
      mode = 'playing';
      if (benchMode) hideNotice();
      else if (flow === 'niveau') {
        hideNotice();
        if (sm.can('cache')) sm.send('cache');
        else mode = 'frozen';
      } else pause(); // le joueur reprend quand il est prêt
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
    if (!g.session) return;
    resizeRenderer(renderer, quality, g.camera);
    if (diag) diag.setInfo(displayInfo(g));
    // Image figée (pause, bilan…) : le redimensionnement a effacé le canevas, on la redessine.
    if (mode === 'paused' || mode === 'done' || mode === 'frozen') g.world.render(g.camera);
  });

  return g;
}

/**
 * Remplace la partie du jeu (le renderer est gardé ; l'ancien monde est libéré).
 * @param {{sceneJson?: any, levelDef?: any}} what
 * @param {number} c
 */
async function replaceSession(what, c) {
  const g = await ensureGame();
  if (g.session) {
    g.world.dispose();
    g.session = false;
  }
  Object.assign(g, await createSession(g.renderer, what, c), { k: 1, session: true, key: what.levelDef ? `${what.levelDef.id}@${c}` : `libre:${sceneId}@${c}` });
  g.world.setEnvironmentEnabled(g.environment);
  if (diag) diag.setInfo({ ...displayInfo(g), ...sessionInfo(g) });
  return g;
}

/** Remet le niveau en cours au départ (même monde : même c). */
function resetLevelState() {
  const g = game;
  const level = createLevel(g.levelDef, g.physics, palette);
  const player = createLevelPlayer(level);
  const first = snapshot(player);
  Object.assign(g, {
    level,
    player,
    driver: makeDriver(level, g.physics),
    lastSnapshot: first,
    odometer: 0,
    facade: false,
    facadeTimer: Infinity,
    aids: activeAids(g.levelDef.indices, failuresOf(g.levelDef.id)),
    speedZones: new Map(),
    finished: false,
    k: 1,
  });
  g.world.update(first, 1, 0);
  g.world.updateLevel(levelRenderState(level, first, 1), first, 0);
  updateCamera(g.camera, first);
  hud.setSpeedZone(null);
  resetPartyMessages();
}

/** Nouvelle partie : bulles (file vidée, vues gardées), messages, horloge des bulles. */
function resetPartyMessages() {
  bubbles.clearPending();
  bubbleVars.reset();
  hideToast();
}

/**
 * Prépare un niveau pour c (renderer créé au besoin ; monde refait si le niveau ou c change).
 * @param {string} id
 * @param {number} c
 * @returns {Promise<boolean>} vrai si la partie est prête
 */
async function startLevel(id, c) {
  const json = levelJson(id);
  if (!json) return false;
  const previous = mode;
  mode = 'loading';
  await nextPaint();
  try {
    if (!game) armBootGuard(); // le démarrage « risqué » commence ici (contexte WebGL, shaders)
    if (game?.session && game.key === `${id}@${c}`) resetLevelState();
    else await replaceSession({ levelDef: json }, c);
  } catch (error) {
    console.error(error);
    mode = previous === 'loading' ? 'title' : previous;
    showFatal('Impossible de préparer le niveau (WebGL2 indisponible ?). Recharge la page pour reprendre.');
    return false;
  }
  flow = 'niveau';
  useBubbleEngine(json);
  resetPartyMessages();
  controls.setMode(wantsTilt() ? 'tilt' : 'drag');
  hud.update(game.lastSnapshot, { k: 1 });
  hud.setSpeedZone(null);
  mode = 'title'; // le décompte (machine à états) prend la suite
  return true;
}

/** Recommencer le niveau (bilan, échec, pause), éventuellement avec un autre c. */
async function restartLevel(c) {
  if (!game?.levelDef) return false;
  return startLevel(game.levelDef.id, c);
}

/** Menu pause → « Recommencer » ou « Changer c » en niveau : nouvelle partie puis décompte. */
async function restartLevelFromPause(c) {
  if (mode !== 'paused') return;
  showNotice({ title: 'Recommencer', text: `Préparation du niveau pour ${formatLightSpeed(c)}…` });
  const ok = await restartLevel(c);
  if (ok) sm.send('recommencer');
}

/**
 * Menu pause → « Recommencer », ou « Changer c » → « Redémarrer » (conduite libre) : nouvelle
 * partie au départ, avec la vitesse de la lumière c. Les bulles déjà vues le restent.
 * @param {number} c
 * @param {string} [title] titre du panneau d'attente
 */
async function restartGame(c, title = 'Changer c') {
  if (mode !== 'paused' || !game) return;
  mode = 'loading';
  showNotice({ title, text: `Préparation de la ville pour ${formatLightSpeed(c)}…` });
  await nextPaint();
  try {
    const sceneJson = (await SCENES[sceneId]()).default;
    await replaceSession({ sceneJson }, c);
  } catch (error) {
    console.error(error);
    showFatal('Impossible de préparer la nouvelle partie. Recharge la page pour reprendre.');
    return;
  }
  resetPartyMessages();
  hud.update(game.lastSnapshot, { k: 1 });
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

/* --- Conduite libre ------------------------------------------------------------ */

/**
 * Clic sur « Conduite libre » (geste utilisateur). Dans cet ordre : permission du capteur
 * d'inclinaison (EN PREMIER, synchrone : iOS vérifie le geste à l'appel), plein écran (écran
 * tactile, si l'API existe), puis le chargement (dont l'await ferait perdre le geste).
 */
function onFreeDriveClick() {
  if (mode !== 'title' || sm.state !== 'menu') return;
  if (wantsTilt()) requestTilt();
  if (touchDevice) enterFullscreen();
  startFreeDrive();
}

/** Chargement puis départ de la conduite libre (ou démarrage automatique de ?bench). */
async function startFreeDrive() {
  if (mode !== 'title') return;
  mode = 'loading';
  hideNotice();
  const label = /** @type {HTMLElement} */ (dom.freeDrive.querySelector('.menu-label') ?? dom.freeDrive);
  const text = label.textContent;
  dom.freeDrive.disabled = true;
  dom.freeDrive.setAttribute('aria-busy', 'true');
  label.textContent = 'Chargement…';
  dom.freeDrive.blur(); // sinon Espace (frein) pourrait « recliquer » le bouton
  await nextPaint();
  try {
    if (!game) armBootGuard(); // le démarrage « risqué » commence ici (contexte WebGL, shaders)
    const sceneJson = (await SCENES[sceneId]()).default;
    await replaceSession({ sceneJson }, chosenC);
  } catch (error) {
    console.error(error);
    dom.title.hidden = true;
    showFatal('Ce navigateur ne permet pas le rendu 3D nécessaire (WebGL2). Essaie un navigateur récent, ou recharge la page.');
    return;
  } finally {
    dom.freeDrive.disabled = false;
    dom.freeDrive.removeAttribute('aria-busy');
    label.textContent = text;
  }
  flow = 'libre';
  useBubbleEngine(null);
  resetPartyMessages();
  dom.title.hidden = true;
  sky?.hide();
  hud.show();
  levelHud.hide();
  hud.setSpeedZone(null);
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
  if (!loop.running) loop.start();
}

/** Conduite libre → « Menu principal » (menu pause). */
function leaveFreeDrive() {
  flow = null;
  hideNotice();
  leaveGameView();
  refreshHome();
  dom.title.hidden = false;
  dom.play.focus({ preventScroll: true });
}

dom.freeDrive.addEventListener('click', onFreeDriveClick);
dom.play.addEventListener('click', () => {
  if (mode === 'title' && sm.state === 'menu') sm.send('jouer');
});

/* --- Fin de partie : bilan, échec ---------------------------------------------- */

/** Partie finie (réussite ou batterie vide) : score, progression, état. */
function finishLevel() {
  const g = game;
  if (g.finished) return;
  g.finished = true;
  const score = computeScore(g.level);
  const { progress: next, records } = recordResult(progress, g.level.id, g.physics.c, score);
  progress = next;
  saveProgress(progress);
  g.result = { score, records };
  sm.send(score.reussite ? 'reussite' : 'echec');
}

/** Écran de bilan (réussite). */
function showResult() {
  const g = game;
  const { score, records } = g.result;
  const f = resultFigures({ tauFin: score.econome.tauFin, tFin: score.ponctuel.tFin, tauMax: g.level.tauMax, distance: g.odometer, c: g.physics.c });
  const recordTexts = [];
  if (records.premiereReussite) recordTexts.push('Première réussite !');
  else if (records.etoiles) recordTexts.push("Record d'étoiles à ce c !");
  if (records.batterie) recordTexts.push('Record de batterie');
  if (records.tVille) recordTexts.push("Record à l'horloge de la ville");
  const nextId = nextLevelId(g.level.id);
  screens.showResult({
    titre: `Niveau ${g.level.numero} · ${g.level.titre} · ${formatLightSpeed(g.physics.c)}`,
    stars: formatStars(score.etoiles),
    starsCount: score.etoiles,
    lines: starLines(score),
    stats: [
      { label: 'Ta montre', value: formatClock(score.econome.tauFin) },
      { label: 'Horloge de la ville', value: formatClock(score.ponctuel.tFin) },
      { label: 'Écart', value: formatGap(Math.max(0, score.ponctuel.tFin - score.econome.tauFin)) },
    ],
    figures: [f.batterie, f.contrefactuel],
    records: recordTexts,
    hasNext: Boolean(nextId),
    onReplay: () => replayFrom('rejouer'),
    onNext: () => {
      selectedLevelId = nextId;
      sm.send('suivant', { niveauSuivant: Boolean(nextId) });
    },
    onQuit: () => sm.send('quitter'),
  });
  announcer.announce(`Livré ! ${score.etoiles} étoile${score.etoiles > 1 ? 's' : ''} sur 3.`);
}

/** Écran d'échec : raison, indice gradué, Recommencer ; « Passer » après assez d'échecs. */
function showFailure() {
  const g = game;
  const { score } = g.result;
  const echecs = failuresOf(g.level.id);
  const hint = hintFor(g.levelDef.indices, echecs);
  const nextId = nextLevelId(g.level.id);
  const skip = canSkip(progress, g.level.id) && Boolean(nextId) && sm.can('passer', { echecs, niveauSuivant: Boolean(nextId) });
  screens.showFailure({
    titre: `Niveau ${g.level.numero} · ${g.level.titre}`,
    reason: failureText(score),
    hint: hint ? hint.texte : '',
    canSkip: skip,
    onRetry: () => replayFrom('recommencer'),
    onSkip: () => {
      progress = recordSkip(progress, g.level.id);
      saveProgress(progress);
      selectedLevelId = nextId;
      sm.send('passer', { echecs, niveauSuivant: Boolean(nextId) });
    },
    onQuit: () => sm.send('quitter'),
  });
  announcer.announce(failureText(score));
}

/** Bilan « Rejouer » ou échec « Recommencer » : même niveau, même c, décompte. */
async function replayFrom(event) {
  if (!game?.levelDef || mode === 'loading') return;
  const ok = await restartLevel(chosenC);
  if (ok) sm.send(event);
}

/* --- ?diag, ?bench, ?debug, ?autopilote : état en lecture seule ------------------- */

if (diag || tiltDebug || autopilotRoute) {
  /** @type {any} */ (window).__coursier = {
    get mode() {
      return mode;
    },
    /** État de la machine des niveaux (game/states.js) et partie en cours. */
    get etat() {
      return sm.state;
    },
    get flow() {
      return flow;
    },
    get k() {
      return game?.session ? game.k : null;
    },
    /** Vitesse de la lumière de la partie en cours (ou du réglage, avant de jouer). */
    get c() {
      return game?.session ? game.physics.c : chosenC;
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
    snapshot: () => (game?.session ? { ...game.lastSnapshot } : null),
    stats: () => (game?.session ? game.world.stats() : null),
    /** Partie de niveau : statut, horloges, colis, portes (teinte vue), chocs, reprises. */
    niveau: () => {
      const l = game?.session ? game.level : null;
      if (!l) return null;
      return {
        id: l.id,
        status: l.status,
        tau: l.tau,
        t: l.t,
        colis: l.colis.map((p) => ({ id: p.id, etat: p.etat, enRetard: p.enRetard })),
        portes: l.portes.map((d) => ({ id: d.id, ouverte: d.ouverte, teinte: d.vue?.hue ?? null, inRange: d.inRange })),
        chocs: l.chocs,
        reprises: l.reprisesFaites,
        odometer: game.odometer,
      };
    },
    /** Progression mémorisée. */
    progression: () => JSON.parse(JSON.stringify(progress)),
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
 * Instantané « effectif » de la vision : β_eff = k·β (vision classique : k = 0, aucun
 * décalage). À k = 1, c'est l'instantané lui-même (la couleur des lampes est alors exactement
 * celle que juge la règle).
 */
function effectiveSnapshot(snap, k) {
  if (k >= 1) return snap;
  const beta = k * snap.beta;
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const scale = snap.speed > 0 ? (gamma * beta * snap.c) / Math.hypot(snap.ux, snap.uy) : 0;
  return { ...snap, beta, gamma, rapidity: Math.atanh(beta), ux: snap.ux * scale, uy: snap.uy * scale, vx: snap.vx * k, vy: snap.vy * k, speed: snap.speed * k };
}

/**
 * État VU des objets du niveau (render/levelObjects.js) : arrêts actifs, clients vus présents
 * (t_e), portes vues ouvertes (t_e), couleur perçue des lampes (même chaîne que la règle).
 * @param {import('./game/level.js').LevelState} level
 * @param {any} snap
 * @param {number} k
 */
function levelRenderState(level, snap, k) {
  const stops = {};
  for (const p of level.colis) {
    if (p.retrait) stops[`${p.id}:retrait`] = { active: p.etat === 'aRetirer', present: seenClientPresent(p.retrait, snap) };
    stops[`${p.id}:livraison`] = { active: p.etat === 'aBord', present: seenClientPresent(p.livraison, snap) };
  }
  const eff = effectiveSnapshot(snap, k);
  const doors = {};
  for (const d of level.portes) doors[d.id] = { open: seenDoorOpen(d, snap), lampRgb: perceivedLamp(d.lampe, eff).rgb };
  return { stops, doors };
}

/** Porte fermée la plus proche du joueur (ou null), avec sa distance horizontale. */
function nearestClosedDoor(level, snap) {
  let best = null;
  for (const d of level.portes) {
    if (d.ouverte) continue;
    const dist = Math.hypot(d.x - snap.x, d.y - snap.y);
    if (!best || dist < best.dist) best = { door: d, dist };
  }
  return best;
}

/**
 * Bulles pédagogiques : variables de l'image (commande appliquée, butée, façade dans l'axe à
 * 5 Hz, variables du niveau…), puis le moteur (conditions évaluées à 5 Hz).
 * @param {any} snap
 * @param {{thrust?: number, brake?: number, steer?: number}} cmd commande appliquée
 * @param {ReturnType<typeof controls.read>} input commande du joueur
 * @param {number} dt temps propre simulé (s)
 * @param {number} dtReal
 * @param {{distanceDevant: number, butee: boolean, niveau: any}} extra
 */
function updateBubbles(snap, cmd, input, dt, dtReal, { distanceDevant, butee, niveau }) {
  const { world } = game;
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
      distanceDevant,
      facadeDevant: game.facade,
      butee,
      niveau,
    }),
    dt,
  );
}

/**
 * Une image de conduite libre : butée douce, pas exact, ?bench.
 * @returns {{snap: any, cmd: any}}
 */
function stepFree(input, dt, dtReal) {
  const { player, bench } = game;
  if (bench) return { snap: bench.advance(), cmd: null };
  const cmd = softStopCommand(player, input, game.limits);
  step(player, cmd, dt);
  keepInside(player, game.limits);
  const snap = snapshot(player);
  playClockMs += dtReal * 1000;
  return { snap, cmd };
}

/**
 * Une image de niveau : pilote (?autopilote, pas fixes de BOT_DT) ou commandes, puis
 * level.advance (collisions, règles, reprises) ; événements de partie.
 * @returns {{snap: any, cmd: any, events: any[]}}
 */
function stepLevel(input, dt, dtReal) {
  const g = game;
  const { level, player } = g;
  const events = [];
  let snap = g.lastSnapshot;
  let cmd = { thrust: input.thrust, brake: input.brake, steer: input.steer };
  const before = { x: player.x, y: player.y };
  let teleported = false;
  if (g.driver) {
    let remaining = dt;
    while (remaining > 1e-9 && level.status === 'enCours') {
      const h = Math.min(BOT_DT, remaining);
      cmd = g.driver.command(snap);
      const out = advance(level, player, cmd, h);
      snap = out.snapshot;
      events.push(...out.events);
      remaining -= h;
    }
  } else {
    const out = advance(level, player, cmd, dt);
    snap = out.snapshot;
    events.push(...out.events);
  }
  teleported = events.some((e) => e.type === 'reprise');
  if (!teleported) g.odometer += Math.hypot(player.x - before.x, player.y - before.y);
  playClockMs += dtReal * 1000;
  return { snap, cmd, events };
}

/** Messages et transitions des événements de partie. Renvoie les événements des bulles. */
function handleLevelEvents(events) {
  const bubbleEvents = [];
  let finished = false;
  for (const e of events) {
    switch (e.type) {
      case 'livraison':
        bubbleEvents.push('livraison');
        showToast(e.enRetard ? `Livré : ${e.client}, en retard.` : `Livré : ${e.client} ✓`, TOAST_EVENT_MS);
        break;
      case 'retrait':
        bubbleEvents.push('retrait');
        showToast(`Colis retiré chez ${e.client}.`, TOAST_EVENT_MS);
        break;
      case 'attente':
        bubbleEvents.push('attente');
        break;
      case 'porte':
        if (e.ouverte) {
          bubbleEvents.push('porteOuverte');
          showToast('La porte s’ouvre !', TOAST_EVENT_MS);
        }
        break;
      case 'choc':
        bubbleEvents.push('choc');
        if (e.stun >= STUN_TOAST_MIN_S) showToast(`Choc ! +${e.stun.toFixed(1).replace('.', ',')} s aux deux horloges.`, TOAST_EVENT_MS);
        break;
      case 'reprise':
        bubbleEvents.push('reprise');
        game.repriseText = `Porte fermée : choc ! Tu repars de la ligne d'élan (+${String(e.cout).replace('.', ',')} s).`;
        break;
      case 'reussite':
      case 'echec':
        finished = true;
        break;
      default:
        break;
    }
  }
  return { bubbleEvents, finished, reprise: events.some((e) => e.type === 'reprise') };
}

/**
 * Données du HUD de niveau et des bulles du niveau pour l'image.
 * @param {any} snap
 * @param {string[]} bubbleEvents
 */
function levelInfo(snap, bubbleEvents) {
  const g = game;
  const { level } = g;
  const stops = activeStops(level);
  const nextStop = stops[0] ?? null;
  const frac = batteryFraction(snap.tau, level.tauMax);
  const done = level.colis.filter((p) => p.etat === 'livre').length;
  const info = {
    battery: { text: formatBattery(snap.tau, level.tauMax), fraction: frac, level: batteryLevel(frac) },
    colis: { done, total: level.colis.length },
    next: null,
    brake: '',
    spectro: null,
  };
  const niveau = {
    batterie: frac,
    colisLivres: done,
    evenements: bubbleEvents,
    attendClient: level.colis.some((p) => (p.etat === 'aBord' && p.livraison.waiting) || (p.etat === 'aRetirer' && p.retrait?.waiting)),
  };
  let distanceDevant = Infinity;
  if (nextStop) {
    const ind = stopIndicator(snap, nextStop, { k: g.k });
    info.next = {
      client: nextStop.client,
      verb: nextStop.kind === 'retrait' ? 'Retirer' : 'Livrer',
      distance: formatDistance(ind.distance),
      angle: ind.angle,
      behind: ind.behind,
      inZone: ind.inZone,
      timing: stopTiming(nextStop, snap.t),
    };
    if (g.aids.has('repereFreinage')) {
      info.brake = `Freinage : ${formatDistance(brakingDistance(snap, g.physics.a))} · client : ${formatDistance(ind.distance)}`;
    }
    Object.assign(niveau, {
      distanceArret: ind.distance,
      dansZone: ind.inZone,
      arretDerriere: ind.behind && !ind.inZone && ind.distance <= BEHIND_MAX_M,
      margeDelai: nextStop.delai !== null ? nextStop.delai - snap.t : Infinity,
    });
    // Bulle « frein » des niveaux : le prochain arrêt, s'il est devant.
    if (Math.abs(ind.worldAngle) < Math.PI / 6) distanceDevant = ind.distance;
  }
  const near = nearestClosedDoor(level, snap);
  let zone = null;
  if (near && near.dist <= SPECTRO_RANGE * near.door.portee[1]) {
    const d = near.door;
    const view = d.vue ?? perceivedLamp(d.lampe, snap);
    if (near.dist <= 2 * d.portee[1]) {
      niveau.porteProche = true;
      niveau.teintePorte = view.hue;
      niveau.teinteVoulue = view.hue === d.teinte;
    }
    const ahead = Math.abs(stopIndicator(snap, d, { k: 1 }).worldAngle) < SPECTRO_HALF_ANGLE;
    if ((options.spectrometre || g.aids.has('spectrometre')) && ahead) info.spectro = spectrometerReading(view, d.lampe, d.teinte);
    if (g.aids.has('zoneVitesse')) {
      if (!g.speedZones.has(d.id)) {
        const mid = (d.portee[0] + d.portee[1]) / 2;
        g.speedZones.set(d.id, hueSpeedWindow(d.lampe, d.teinte, { distance: mid }));
      }
      zone = g.speedZones.get(d.id);
    }
  }
  hud.setSpeedZone(zone);
  return { info, niveau, distanceDevant };
}

/**
 * @param {number} dtReal temps réel écoulé (s)
 * @param {number} dt temps propre à simuler (s), plafonné à MAX_FRAME_DT
 */
function frame(dtReal, dt) {
  const input = controls.read();
  if (input.pause && !benchMode) {
    if (mode === 'playing' || mode === 'countdown') pause();
    else if (mode === 'paused') resume();
  }
  if (!game?.session) return;
  if (mode === 'frozen') {
    // Message de reprise : la vue reste figée, puis décompte d'une seconde.
    if (sm.state === 'reprise') {
      game.repriseTimer -= dtReal;
      if (game.repriseTimer <= 0) sm.send('fini');
    }
    return;
  }
  if (mode !== 'playing' && mode !== 'countdown') return;
  const { world, camera, bench, renderer } = game;
  if (mode === 'playing' && game.countdown?.go > 0) {
    game.countdown.go -= dtReal;
    if (game.countdown.go <= 0) screens.hideCountdown();
  }

  // DPR adaptatif décidé à l'image précédente : appliqué avant le rendu (pas d'image effacée).
  if (game.pendingDpr !== null) {
    quality.adaptiveDpr = game.pendingDpr;
    game.pendingDpr = null;
    resizeRenderer(renderer, quality, camera);
    if (diag) diag.setInfo(displayInfo(game));
  }

  // Simulation (rien pendant le décompte : horloges arrêtées).
  const t0 = performance.now();
  let snap = game.lastSnapshot;
  let cmd = null;
  let levelStep = null;
  if (mode === 'countdown') {
    tickCountdown(dtReal);
  } else if (flow === 'niveau') {
    levelStep = stepLevel(input, dt, dtReal);
    snap = levelStep.snap;
    cmd = levelStep.cmd;
  } else {
    ({ snap, cmd } = stepFree(input, dt, dtReal));
  }
  game.k = nextK(game.k, !bench && input.classic && mode === 'playing', dtReal);

  // Événements de partie, HUD de niveau, bulles.
  let handled = null;
  if (flow === 'niveau') {
    handled = levelStep ? handleLevelEvents(levelStep.events) : { bubbleEvents: [], finished: false, reprise: false };
    const { info, niveau, distanceDevant } = levelInfo(snap, handled.bubbleEvents);
    levelHud.update(info);
    if (cmd) updateBubbles(snap, cmd, input, dt, dtReal, { distanceDevant, butee: false, niveau });
  } else if (cmd) {
    const { player, limits } = game;
    updateBubbles(snap, cmd, input, dt, dtReal, {
      distanceDevant: exitDistance(player.x, player.y, player.hx, player.hy, limits),
      butee: cmd !== input,
      niveau: null,
    });
  }

  world.update(snap, game.k, dtReal);
  if (flow === 'niveau') world.updateLevel(levelRenderState(game.level, snap, game.k), snap, dtReal);
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

  // Transitions de fin d'image (après le rendu : l'image du choc ou de la livraison reste).
  if (handled?.finished) finishLevel();
  else if (handled?.reprise && sm.can('reprise')) sm.send('reprise');
}

/** Décompte : « 3 », « 2 », « 1 », puis « Partez ! » et départ. */
function tickCountdown(dtReal) {
  const cd = game.countdown;
  if (!cd) return;
  if (cd.remaining > 0) {
    cd.remaining -= dtReal;
    if (cd.remaining > 0) {
      screens.showCountdown(String(Math.ceil(cd.remaining - 1e-9)));
      return;
    }
    screens.showCountdown('Partez !');
    cd.go = GO_TEXT_S;
    if (sm.state === 'decompte') sm.send('fini'); // les horloges partent tout de suite
    else if (flow === 'libre') enterPlaying();
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

sm.send('pret'); // chargement → menu
if (benchMode) {
  startFreeDrive();
} else if (quality.unstable) {
  showNotice({
    title: 'WebGL instable',
    text: "Le jeu s'est interrompu deux fois au démarrage. Il repart en mode allégé (moins de pixels, sans anticrénelage).",
    actions: [{ label: 'Continuer', primary: true, onClick: hideNotice }],
  });
}
