// Appareil (src/input/device.js) : plein écran sans erreur quand l'API manque (iPhone),
// Wake Lock pris, relâché et repris, sans erreur quand il est refusé ou absent.
import { describe, expect, it, vi } from 'vitest';
import { createWakeLock, enterFullscreen } from '../src/input/device.js';

/** Faux WakeLockSentinel. */
function fakeSentinel() {
  const listeners = [];
  const s = {
    released: false,
    release: vi.fn(async () => {
      s.released = true;
      for (const fn of listeners) fn();
    }),
    addEventListener: (type, fn) => type === 'release' && listeners.push(fn),
  };
  return s;
}

describe('enterFullscreen', () => {
  it('sans API (iPhone) : faux, sans erreur', async () => {
    expect(await enterFullscreen(/** @type {any} */ ({ documentElement: {} }))).toBe(false);
    expect(await enterFullscreen(/** @type {any} */ (null))).toBe(false);
    const disabled = { fullscreenEnabled: false, documentElement: { requestFullscreen: vi.fn() } };
    expect(await enterFullscreen(/** @type {any} */ (disabled))).toBe(false);
    expect(disabled.documentElement.requestFullscreen).not.toHaveBeenCalled();
  });

  it('avec API : demande le plein écran, puis tente de verrouiller le paysage', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('non permis')));
    const el = { requestFullscreen: vi.fn(() => Promise.resolve()) };
    const doc = { fullscreenEnabled: true, documentElement: el, defaultView: { screen: { orientation: { lock } } } };
    expect(await enterFullscreen(/** @type {any} */ (doc))).toBe(true);
    expect(el.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(lock).toHaveBeenCalledWith('landscape');
  });

  it('refus ou exception : faux ; déjà en plein écran : vrai sans redemander', async () => {
    const refused = { documentElement: { requestFullscreen: () => Promise.reject(new Error('geste')) } };
    expect(await enterFullscreen(/** @type {any} */ (refused))).toBe(false);
    const throwing = {
      documentElement: {
        requestFullscreen: () => {
          throw new TypeError('x');
        },
      },
    };
    expect(await enterFullscreen(/** @type {any} */ (throwing))).toBe(false);
    const request = vi.fn();
    expect(await enterFullscreen(/** @type {any} */ ({ fullscreenElement: {}, documentElement: { requestFullscreen: request } }))).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('createWakeLock', () => {
  it('sans API : rien, sans erreur', async () => {
    const lock = createWakeLock({ nav: {} });
    expect(await lock.acquire()).toBe(false);
    lock.release();
    expect(lock.active).toBe(false);
  });

  it('pris pendant le jeu, relâché en pause, repris au retour', async () => {
    const sentinels = [];
    const nav = { wakeLock: { request: vi.fn(async () => sentinels[sentinels.push(fakeSentinel()) - 1]) } };
    const lock = createWakeLock({ nav });
    expect(await lock.acquire()).toBe(true);
    expect(lock.active).toBe(true);
    expect(await lock.acquire()).toBe(true); // déjà pris : pas de nouvelle demande
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(1);
    lock.release();
    expect(sentinels[0].release).toHaveBeenCalled();
    expect(lock.active).toBe(false);
    expect(await lock.acquire()).toBe(true);
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('relâché par le navigateur (page cachée) : redemandé au retour', async () => {
    const sentinels = [];
    const nav = { wakeLock: { request: vi.fn(async () => sentinels[sentinels.push(fakeSentinel()) - 1]) } };
    const lock = createWakeLock({ nav });
    await lock.acquire();
    await sentinels[0].release(); // le navigateur le relâche
    expect(lock.active).toBe(false);
    expect(await lock.acquire()).toBe(true);
    expect(nav.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('refus (NotAllowedError) : faux, sans erreur', async () => {
    const nav = { wakeLock: { request: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) } };
    const lock = createWakeLock({ nav });
    expect(await lock.acquire()).toBe(false);
    expect(lock.active).toBe(false);
  });

  it('release() pendant la demande : le verrou obtenu est aussitôt rendu', async () => {
    const s = fakeSentinel();
    let resolve;
    const nav = { wakeLock: { request: vi.fn(() => new Promise((r) => (resolve = r))) } };
    const lock = createWakeLock({ nav });
    const pending = lock.acquire();
    lock.release();
    resolve(s);
    expect(await pending).toBe(false);
    expect(s.release).toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });
});
