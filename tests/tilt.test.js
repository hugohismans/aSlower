// Direction par inclinaison : capteur (src/input/tilt.js) et mode « tilt » des commandes
// (src/input/controls.js), avec une fausse fenêtre, de faux événements et une horloge simulée.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CALIBRATION_MS, DETECTION_TIMEOUT_MS, RECALIBRATE_DELAY_MS, createTilt } from '../src/input/tilt.js';
import { createControls } from '../src/input/controls.js';

/* ------------------------------------------------------------------------- */
/* Faux navigateur                                                            */
/* ------------------------------------------------------------------------- */

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn({ type, preventDefault() {}, ...event });
  }
}

/**
 * Fenêtre simulée : horloge et minuteries manuelles (advance), écran orientable.
 * @param {{permission?: 'granted' | 'denied' | 'throw' | 'none', secure?: boolean, api?: boolean, angle?: number}} [o]
 */
function createFakeWindow({ permission = 'none', secure = true, api = true, angle = 90 } = {}) {
  const win = new FakeTarget();
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  win.now = () => clock;
  win.setTimeout = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, at: clock + Math.max(0, ms) });
    return id;
  };
  win.clearTimeout = (id) => timers.delete(id);
  /** Avance l'horloge de `ms`, en exécutant les minuteries échues dans l'ordre. */
  win.advance = (ms) => {
    const end = clock + ms;
    for (;;) {
      let due = null;
      for (const [id, t] of timers) if (t.at <= end && (!due || t.at < due[1].at)) due = [id, t];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].fn();
    }
    clock = end;
  };
  win.isSecureContext = secure;
  const orientation = new FakeTarget();
  orientation.angle = angle;
  win.screen = { orientation };
  win.requestCalls = 0;
  if (api) {
    const DOE = function DeviceOrientationEvent() {};
    if (permission !== 'none') {
      DOE.requestPermission = () => {
        win.requestCalls += 1;
        if (permission === 'throw') throw new Error('NotAllowedError');
        return Promise.resolve(permission);
      };
    }
    win.DeviceOrientationEvent = DOE;
  }
  /** Envoie un événement deviceorientation. */
  win.orient = (beta, gamma, alpha = 0) => win.dispatch('deviceorientation', { alpha, beta, gamma });
  return win;
}

/* Tenues du GSM (comme tests/tiltMath.test.js) → (β, γ) du navigateur. */
const D = Math.PI / 180;
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * B[k][j], 0)));
const Rx = (t) => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const Rz = (t) => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
const LANDSCAPE = {
  90: [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
  270: [[0, 1, 0], [0, 0, -1], [-1, 0, 0]],
};
/** (β, γ) d'un GSM en paysage `screen`, basculé de `pitch`°, penché de `wheel`° vers la droite. */
function pose(screen, pitch, wheel) {
  const R = mul(mul(Rx(-pitch * D), LANDSCAPE[screen]), Rz(-wheel * D));
  if (Math.abs(R[2][2]) < 1e-12) return [Math.atan2(R[2][1], R[2][0]) / D, -90];
  const g = Math.atan(-R[2][0] / R[2][2]);
  return [Math.atan2(R[2][1], R[2][2] / Math.cos(g)) / D, g / D];
}

/** Capteur branché sur une fausse fenêtre ; states = suite des états annoncés. */
function setup(options) {
  const win = createFakeWindow(options);
  const states = [];
  const tilt = createTilt({ win, now: win.now, onState: (s) => states.push(s) });
  return { win, tilt, states };
}

/** Démarre un capteur Android et le rend actif, GSM tenu en paysage 90, basculé de 30°. */
function activeTilt(options) {
  const ctx = setup(options);
  ctx.tilt.requestPermission();
  ctx.tilt.start();
  ctx.win.orient(...pose(90, 30, 0));
  return ctx;
}

/* ------------------------------------------------------------------------- */
/* Permission et détection                                                    */
/* ------------------------------------------------------------------------- */

describe('createTilt : permission', () => {
  it('état initial « inconnu », volant nul', () => {
    const { tilt } = setup();
    expect(tilt.state).toBe('inconnu');
    expect(tilt.read()).toBe(0);
  });

  it('iOS, accordée : requestPermission appelée synchroniquement, puis actif au premier événement', async () => {
    const { win, tilt, states } = setup({ permission: 'granted' });
    const promise = tilt.requestPermission();
    expect(win.requestCalls).toBe(1); // dans le même tour : le geste utilisateur est encore valable
    expect(tilt.state).toBe('demande');
    await expect(promise).resolves.toBe('accorde');
    expect(tilt.start()).toBe(true);
    win.orient(...pose(90, 30, 0));
    expect(tilt.state).toBe('actif');
    expect(states).toEqual(['demande', 'actif']);
  });

  it('iOS, refusée : « refuse », start() sans effet', async () => {
    const { win, tilt, states } = setup({ permission: 'denied' });
    await expect(tilt.requestPermission()).resolves.toBe('refuse');
    expect(tilt.state).toBe('refuse');
    expect(tilt.start()).toBe(false);
    expect(win.count('deviceorientation')).toBe(0);
    win.advance(DETECTION_TIMEOUT_MS * 2);
    expect(tilt.state).toBe('refuse');
    expect(states).toEqual(['demande', 'refuse']);
  });

  it('iOS, appel hors geste (exception) : « refuse »', async () => {
    const { tilt } = setup({ permission: 'throw' });
    await expect(tilt.requestPermission()).resolves.toBe('refuse');
    expect(tilt.state).toBe('refuse');
  });

  it('iOS : nouvel essai accordé après un refus', async () => {
    const { win, tilt } = setup({ permission: 'denied' });
    await tilt.requestPermission();
    win.DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
    await expect(tilt.requestPermission()).resolves.toBe('accorde');
    expect(tilt.start()).toBe(true);
    win.orient(...pose(90, 30, 0));
    expect(tilt.state).toBe('actif');
  });

  it('Android / ordinateur : pas de permission, résolue tout de suite', async () => {
    const { tilt } = setup({ permission: 'none' });
    await expect(tilt.requestPermission()).resolves.toBe('accorde');
    expect(tilt.state).toBe('demande');
  });

  it('API absente : « indisponible »', async () => {
    const { tilt } = setup({ api: false });
    await expect(tilt.requestPermission()).resolves.toBe('indisponible');
    expect(tilt.state).toBe('indisponible');
    expect(tilt.start()).toBe(false);
  });

  it('page non sécurisée (HTTP) : « indisponible », sans demander la permission', async () => {
    const { win, tilt } = setup({ permission: 'granted', secure: false });
    await expect(tilt.requestPermission()).resolves.toBe('indisponible');
    expect(win.requestCalls).toBe(0);
    expect(tilt.state).toBe('indisponible');
  });
});

describe('createTilt : détection d\'absence', () => {
  it('aucun événement en 1 s après start() : « indisponible »', () => {
    const { win, tilt, states } = setup();
    tilt.start();
    expect(tilt.state).toBe('demande');
    win.advance(DETECTION_TIMEOUT_MS - 1);
    expect(tilt.state).toBe('demande');
    win.advance(1);
    expect(tilt.state).toBe('indisponible');
    expect(states).toEqual(['demande', 'indisponible']);
  });

  it('événements nuls seulement (Chrome sur ordinateur) : « indisponible »', () => {
    const { win, tilt } = setup();
    tilt.start();
    win.dispatch('deviceorientation', { alpha: null, beta: null, gamma: null });
    win.advance(DETECTION_TIMEOUT_MS);
    expect(tilt.state).toBe('indisponible');
  });

  it('un vrai événement juste avant 1 s : « actif », et le reste', () => {
    const { win, tilt } = setup();
    tilt.start();
    win.advance(DETECTION_TIMEOUT_MS - 10);
    win.orient(...pose(90, 30, 0));
    win.advance(DETECTION_TIMEOUT_MS * 3);
    expect(tilt.state).toBe('actif');
  });

  it('nouvel essai après « indisponible » : nouvelle attente d\'une seconde', () => {
    const { win, tilt } = setup();
    tilt.start();
    win.advance(DETECTION_TIMEOUT_MS);
    expect(tilt.state).toBe('indisponible');
    tilt.requestPermission();
    tilt.start();
    expect(tilt.state).toBe('demande');
    win.orient(...pose(270, 20, 0));
    expect(tilt.state).toBe('actif');
  });

  it('stop() retire les écouteurs et remet le volant à 0', () => {
    const { win, tilt } = activeTilt();
    expect(win.count('deviceorientation')).toBe(1);
    tilt.stop();
    expect(win.count('deviceorientation')).toBe(0);
    expect(win.screen.orientation.count('change')).toBe(0);
    expect(tilt.read()).toBe(0);
  });
});

/* ------------------------------------------------------------------------- */
/* Volant : signe, calibrage, lissage                                         */
/* ------------------------------------------------------------------------- */

/** Lit le volant pendant `ms` à 60 Hz ; renvoie la dernière valeur. */
function readFor(win, tilt, ms) {
  let s = tilt.read();
  for (let t = 0; t < ms; t += 1000 / 60) {
    win.advance(1000 / 60);
    s = tilt.read();
  }
  return s;
}

describe('createTilt : volant', () => {
  it('pencher vers la droite = steer > 0, dans les deux paysages', () => {
    for (const screen of [90, 270]) {
      const { win, tilt } = setup({ angle: screen });
      tilt.start();
      win.orient(...pose(screen, 30, 15));
      expect(readFor(win, tilt, 500)).toBeGreaterThan(0.4);
      win.orient(...pose(screen, 30, -15));
      expect(readFor(win, tilt, 500)).toBeLessThan(-0.4);
    }
  });

  it('iOS : window.orientation = −90 (sans screen.orientation) traité comme 270', () => {
    const { win, tilt } = setup();
    win.screen = {};
    win.orientation = -90;
    tilt.start();
    win.orient(...pose(270, 30, 40));
    expect(readFor(win, tilt, 500)).toBeCloseTo(1, 3);
  });

  it('calibrage : moyenne des angles reçus pendant ≈ 0,5 s', async () => {
    const { win, tilt } = activeTilt();
    const done = tilt.calibrate();
    for (let t = 0; t < CALIBRATION_MS; t += 50) {
      win.orient(...pose(90, 30, t < CALIBRATION_MS / 2 ? 8 : 12)); // le joueur tient son GSM penché de ≈ 10°
      win.advance(50);
    }
    const neutral = await done;
    expect(neutral).toBeGreaterThan(9);
    expect(neutral).toBeLessThan(11);
    expect(tilt.neutral).toBe(neutral);
    // Tenu à sa position neutre : volant nul ; 25° de plus : plein braquage.
    win.orient(...pose(90, 30, neutral));
    expect(readFor(win, tilt, 300)).toBe(0);
    win.orient(...pose(90, 30, neutral + 26));
    expect(readFor(win, tilt, 1000)).toBeCloseTo(1, 4);
  });

  it('calibrage sans événement : neutre inchangé', async () => {
    const { win, tilt } = setup();
    const done = tilt.calibrate();
    win.advance(CALIBRATION_MS);
    await expect(done).resolves.toBe(0);
  });

  it('zone morte de 3° autour du neutre', () => {
    const { win, tilt } = activeTilt();
    win.orient(...pose(90, 30, 2.5));
    expect(readFor(win, tilt, 300)).toBe(0);
    win.orient(...pose(90, 30, -2.5));
    expect(readFor(win, tilt, 300)).toBe(0);
  });

  it('lissage du premier ordre de 60 ms, calculé à la lecture (pas dans l\'événement)', () => {
    const { win, tilt } = activeTilt();
    expect(tilt.read()).toBe(0);
    win.orient(...pose(90, 30, 40)); // cible : plein braquage
    // L'événement seul ne change rien : c'est la lecture qui avance le filtre.
    expect(tilt.debugInfo().steer).toBe(0);
    win.advance(60);
    expect(tilt.read()).toBeCloseTo(1 - Math.exp(-1), 9);
    win.advance(60);
    expect(tilt.read()).toBeCloseTo(1 - Math.exp(-2), 9);
    // Une longue pause entre deux lectures est plafonnée (pas de saut incohérent).
    win.advance(5000);
    const s = tilt.read();
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThan(1 - Math.exp(-2));
  });

  it('recalibrage automatique 300 ms après un changement d\'orientation de l\'écran', async () => {
    const { win, tilt } = activeTilt();
    win.screen.orientation.angle = 270;
    win.orient(...pose(270, 30, 6));
    win.screen.orientation.dispatch('change');
    win.advance(RECALIBRATE_DELAY_MS + CALIBRATION_MS + 1);
    await Promise.resolve();
    expect(tilt.neutral).toBeCloseTo(6, 6);
  });

  it('debugInfo : valeurs brutes et calculées', () => {
    const { win, tilt } = activeTilt();
    win.orient(...pose(90, 30, 12));
    win.advance(16);
    tilt.read();
    const info = tilt.debugInfo();
    expect(info.state).toBe('actif');
    expect(info.screenAngle).toBe(90);
    expect(info.angle).toBeCloseTo(12, 6);
    expect(info.target).toBeGreaterThan(0);
    expect(Number.isFinite(info.beta) && Number.isFinite(info.gamma)).toBe(true);
  });
});

/* ------------------------------------------------------------------------- */
/* Commandes : mode « tilt »                                                  */
/* ------------------------------------------------------------------------- */

/** Faux élément du DOM (zones et boutons de #controls). */
function fakeElement(rect = { left: 0, right: 0, top: 0, bottom: 0 }) {
  const el = new FakeTarget();
  el.dataset = {};
  el.style = {};
  el.hidden = false;
  el.setPointerCapture = () => {};
  el.getBoundingClientRect = () => rect;
  el.querySelector = () => null;
  return el;
}

function fakeControlsRoot() {
  const parts = {
    steer: fakeElement(),
    thrust: fakeElement(),
    brake: fakeElement({ left: 24, right: 112, top: 280, bottom: 368 }),
    classic: fakeElement(),
  };
  const root = fakeElement();
  root.querySelector = (selector) => {
    const m = /data-control="(\w+)"/.exec(selector);
    return m ? parts[m[1]] ?? null : null;
  };
  return { root, parts };
}

const down = (el, id) => el.dispatch('pointerdown', { pointerId: id, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
const move = (el, id, x) => el.dispatch('pointermove', { pointerId: id, clientX: x, clientY: 100 });

describe('createControls : mode inclinaison', () => {
  let win;
  beforeEach(() => {
    win = createFakeWindow();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', Object.assign(new FakeTarget(), { visibilityState: 'visible' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mode glisser par défaut, inchangé : le volant vient du doigt', () => {
    const { root, parts } = fakeControlsRoot();
    const controls = createControls(root);
    expect(controls.getMode()).toBe('drag');
    expect(root.dataset.mode).toBe('drag');
    down(parts.steer, 1);
    move(parts.steer, 1, 128); // +28 px = demi-braquage
    expect(controls.read().steer).toBeCloseTo(0.5, 9);
    controls.dispose();
  });

  it('mode inclinaison : volant du capteur, doigt sur la zone volant ignoré', () => {
    const { tilt } = (() => {
      const t = createTilt({ win, now: win.now });
      t.start();
      win.orient(...pose(90, 30, 40));
      return { tilt: t };
    })();
    const { root, parts } = fakeControlsRoot();
    const controls = createControls(root, { tilt });
    expect(controls.setMode('tilt')).toBe('tilt');
    expect(root.dataset.mode).toBe('tilt');
    down(parts.steer, 1);
    move(parts.steer, 1, 44); // vers la gauche : ignoré
    let steer = controls.read().steer;
    for (let i = 0; i < 30; i += 1) {
      win.advance(1000 / 60);
      steer = controls.read().steer;
    }
    expect(steer).toBeGreaterThan(0.99);
    controls.dispose();
  });

  it('mode inclinaison : frein (bouton) prioritaire, accélérateur à droite', () => {
    const tilt = createTilt({ win, now: win.now });
    tilt.start();
    win.orient(...pose(90, 30, 0));
    const { root, parts } = fakeControlsRoot();
    const controls = createControls(root, { mode: 'tilt', tilt });
    expect(controls.getMode()).toBe('tilt');
    down(parts.thrust, 1);
    expect(controls.read()).toMatchObject({ thrust: 1, brake: 0 });
    down(parts.brake, 2);
    expect(controls.read()).toMatchObject({ thrust: 0, brake: 1 });
    controls.dispose();
  });

  it('le clavier reste actif en mode inclinaison', () => {
    const tilt = createTilt({ win, now: win.now });
    tilt.start();
    win.orient(...pose(90, 30, 0));
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { mode: 'tilt', tilt });
    win.dispatch('keydown', { code: 'Space', target: null });
    expect(controls.read().brake).toBe(1);
    win.dispatch('keyup', { code: 'Space' });
    win.dispatch('keydown', { code: 'ArrowUp', target: null });
    expect(controls.read().thrust).toBe(1);
    controls.dispose();
  });

  it('repli automatique en glisser si le capteur devient indisponible, annoncé une fois', () => {
    const tilt = createTilt({ win, now: win.now });
    const onFallback = vi.fn();
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { tilt, onFallback });
    tilt.start();
    controls.setMode('tilt');
    expect(controls.getMode()).toBe('tilt');
    win.advance(DETECTION_TIMEOUT_MS);
    expect(tilt.state).toBe('indisponible');
    expect(controls.getMode()).toBe('drag');
    expect(root.dataset.mode).toBe('drag');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith('indisponible');
    controls.dispose();
  });

  it('repli automatique si la permission est refusée', async () => {
    const w = createFakeWindow({ permission: 'denied' });
    const tilt = createTilt({ win: w, now: w.now });
    const onFallback = vi.fn();
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { mode: 'tilt', tilt, onFallback });
    await tilt.requestPermission();
    expect(controls.getMode()).toBe('drag');
    expect(onFallback).toHaveBeenCalledWith('refuse');
    // Demander à nouveau l'inclinaison avec un capteur refusé : repli immédiat.
    expect(controls.setMode('tilt')).toBe('drag');
    expect(onFallback).toHaveBeenCalledTimes(2);
    controls.dispose();
  });

  it('mode inclinaison sans capteur : glisser, et onFallback(« indisponible »)', () => {
    const onFallback = vi.fn();
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { mode: 'tilt', onFallback });
    expect(controls.getMode()).toBe('drag');
    expect(onFallback).toHaveBeenCalledWith('indisponible');
    controls.dispose();
  });

  it('en glisser, une panne du capteur ne déclenche aucune annonce', () => {
    const tilt = createTilt({ win, now: win.now });
    const onFallback = vi.fn();
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { tilt, onFallback });
    tilt.start();
    win.advance(DETECTION_TIMEOUT_MS);
    expect(onFallback).not.toHaveBeenCalled();
    controls.dispose();
  });

  it('mode inconnu : RangeError', () => {
    const { root } = fakeControlsRoot();
    const controls = createControls(root);
    expect(() => controls.setMode('gyro')).toThrow(RangeError);
    controls.dispose();
  });

  it('dispose() retire l\'observateur du capteur', () => {
    const tilt = createTilt({ win, now: win.now });
    const onFallback = vi.fn();
    const { root } = fakeControlsRoot();
    const controls = createControls(root, { tilt, onFallback });
    tilt.start();
    controls.setMode('tilt');
    controls.dispose();
    win.advance(DETECTION_TIMEOUT_MS);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
