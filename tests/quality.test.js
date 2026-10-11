// Garde-fou de démarrage (render/quality.js) : un plantage n'est constaté que si le
// démarrage du rendu a été armé, et le profil « lite » expire.
import { beforeEach, describe, expect, it } from 'vitest';
import { local, session } from '../src/storage.js';
import { armBootGuard, confirmBoot, createQuality, LITE_TTL_MS, startBootGuard } from '../src/render/quality.js';

const T0 = 1_000_000_000_000;

beforeEach(() => {
  for (const key of ['gl-boot', 'gl-crash', 'gl-tier']) {
    local.remove(key);
    session.remove(key);
  }
});

describe('garde-fou de démarrage', () => {
  it("quitter l'écran titre sans lancer le rendu n'est pas un plantage", () => {
    startBootGuard(T0); // ouverture de la page
    expect(startBootGuard(T0 + 1000)).toEqual({ crashes: 0, tier: 'default' });
  });

  it('un démarrage armé puis confirmé ne compte pas', () => {
    startBootGuard(T0);
    armBootGuard();
    confirmBoot();
    expect(startBootGuard(T0 + 1000)).toEqual({ crashes: 0, tier: 'default' });
  });

  it('un démarrage armé non confirmé passe en « lite » pendant 3 jours, puis revient au normal', () => {
    armBootGuard();
    expect(startBootGuard(T0)).toEqual({ crashes: 1, tier: 'lite' });
    expect(startBootGuard(T0 + LITE_TTL_MS - 1).tier).toBe('lite');
    expect(startBootGuard(T0 + LITE_TTL_MS + 1).tier).toBe('default');
  });

  it('deux plantages d’affilée rendent le WebGL instable ; une réussite remet le compteur à 0', () => {
    armBootGuard();
    startBootGuard(T0);
    armBootGuard();
    expect(startBootGuard(T0).crashes).toBe(2);
    armBootGuard();
    confirmBoot();
    expect(startBootGuard(T0).crashes).toBe(0);
  });

  it('ancien format (« lite » sans échéance) : profil normal', () => {
    local.set('gl-tier', 'lite');
    expect(startBootGuard(T0).tier).toBe('default');
    expect(local.get('gl-tier', null)).toBe(null);
  });

  it('createQuality : DPR 2 au plus sans plantage', () => {
    const q = createQuality({ search: '', deviceDpr: 3 });
    expect(q.tier).toBe('default');
    expect(q.dpr).toBe(2);
  });
});
