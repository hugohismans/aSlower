// Garde-fou de démarrage (render/quality.js) : un plantage n'est constaté que si le
// démarrage du rendu a été armé, et le profil « lite » expire.
import { beforeEach, describe, expect, it } from 'vitest';
import { local, session } from '../src/storage.js';
import {
  armBootGuard,
  confirmBoot,
  createQuality,
  LITE_TTL_MS,
  profilePixelRatio,
  resolvePixelRatio,
  startBootGuard,
} from '../src/render/quality.js';

const T0 = 1_000_000_000_000;

beforeEach(() => {
  for (const key of ['gl-boot', 'gl-crash', 'gl-tier', 'gl-boot-v2', 'gl-crash-v2', 'gl-tier-v2']) {
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

  it('états des versions précédentes ignorés et effacés', () => {
    local.set('gl-tier', 'lite');
    local.set('gl-boot', true);
    session.set('gl-boot', true);
    local.set('gl-crash', 1);
    expect(startBootGuard(T0)).toEqual({ crashes: 0, tier: 'default' });
    expect(local.get('gl-tier', null)).toBe(null);
    expect(local.get('gl-boot', null)).toBe(null);
  });

  it('un drapeau resté seulement en stockage local (onglet fermé) ne compte pas', () => {
    local.set('gl-boot-v2', true);
    expect(startBootGuard(T0).crashes).toBe(0);
  });

  it('?qualite=normale oublie le profil « lite »', () => {
    armBootGuard();
    expect(startBootGuard(T0).tier).toBe('lite');
    const q = createQuality({ search: '?qualite=normale', deviceDpr: 3 });
    expect(q.tier).toBe('default');
    expect(q.dpr).toBe(2);
  });

  it('createQuality : DPR 2 au plus sans plantage', () => {
    const q = createQuality({ search: '', deviceDpr: 3 });
    expect(q.tier).toBe('default');
    expect(q.dpr).toBe(2);
  });
});

describe('DPR appliqué (profil, DPR adaptatif, ?dpr=)', () => {
  it('sans DPR adaptatif : celui du profil, plafonné en pixels', () => {
    const q = createQuality({ search: '', deviceDpr: 3 });
    expect(q.adaptiveDpr).toBeNull();
    expect(resolvePixelRatio(q, 932, 430)).toBe(2); // 1,6 Mpx < 2,2 Mpx
    expect(resolvePixelRatio(q, 1366, 1024)).toBeCloseTo(Math.sqrt(2.2e6 / (1366 * 1024)), 12);
  });

  it('le DPR adaptatif abaisse le DPR, sans jamais dépasser celui du profil', () => {
    const q = createQuality({ search: '', deviceDpr: 3 });
    q.adaptiveDpr = 1.25;
    expect(resolvePixelRatio(q, 932, 430)).toBe(1.25);
    expect(profilePixelRatio(q, 932, 430)).toBe(2);
    q.adaptiveDpr = 3;
    expect(resolvePixelRatio(q, 932, 430)).toBe(2);
  });

  it('?dpr= l’emporte sur le DPR adaptatif', () => {
    const q = createQuality({ search: '?dpr=1.5', deviceDpr: 3 });
    q.adaptiveDpr = 1;
    expect(resolvePixelRatio(q, 932, 430)).toBe(1.5);
  });

  it('façades : complètes par défaut, simplifiées en « lite », coupées par ?facades=0', () => {
    expect(createQuality({ search: '', deviceDpr: 2 }).facades).toBe(2);
    expect(createQuality({ search: '?facades=0', deviceDpr: 2 }).facades).toBe(0);
    armBootGuard(); // plantage au démarrage précédent : profil « lite »
    const lite = createQuality({ search: '', deviceDpr: 2 });
    expect(lite.tier).toBe('lite');
    expect(lite.facades).toBe(1);
  });
});
