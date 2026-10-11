import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLoop } from '../src/loop.js';

/** requestAnimationFrame et document simulés : les images sont lancées à la main. */
function fakeBrowser() {
  let pending = null;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} });
  return {
    tick(now) {
      const cb = pending;
      pending = null;
      cb?.(now);
    },
    get pending() {
      return pending !== null;
    },
  };
}

describe('createLoop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prévient onError une seule fois et s'arrête quand une image lève une exception", () => {
    const browser = fakeBrowser();
    const onError = vi.fn();
    let calls = 0;
    const loop = createLoop(
      () => {
        calls += 1;
        if (calls === 2) throw new Error('erreur ponctuelle');
      },
      { onError },
    );
    loop.start();
    browser.tick(0);
    expect(() => browser.tick(16)).toThrow('erreur ponctuelle');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
    expect(browser.pending).toBe(false);
    loop.dispose();
  });
});
