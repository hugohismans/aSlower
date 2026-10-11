// Tests de src/game/progress.js : étoiles et records par niveau ET par c, déblocage,
// « passer », stockage sous aslower:v1:progression (valeurs abîmées ignorées).
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../src/game/bubbles.js';
import {
  canSkip,
  emptyProgress,
  isUnlocked,
  levelStats,
  loadProgress,
  PROGRESS_KEY,
  recordResult,
  recordSkip,
  sanitizeProgress,
  saveProgress,
  totalStars,
} from '../src/game/progress.js';
import { SKIP_AFTER_FAILURES } from '../src/game/states.js';
import { createSafeStore } from '../src/storage.js';

const IDS = ['n01-premier-jour', 'n02-grand-boulevard', 'n03-porte-verte'];
const win = (etoiles, batterieRestante, tFin) => ({ reussite: true, etoiles, batterieRestante, tFin });

describe('recordResult', () => {
  it('records par niveau et par c ; étoiles = meilleures tous c ; pur (pas de mutation)', () => {
    const p0 = emptyProgress();
    const { progress: p1, records: r1 } = recordResult(p0, IDS[0], 30, win(2, 0.4, 80));
    expect(p0).toEqual(emptyProgress());
    expect(r1).toEqual({ etoiles: true, batterie: false, tVille: false, premiereReussite: true });
    const { progress: p2, records: r2 } = recordResult(p1, IDS[0], 30, win(1, 0.5, 90));
    expect(r2).toEqual({ etoiles: false, batterie: true, tVille: false, premiereReussite: false });
    const { progress: p3 } = recordResult(p2, IDS[0], 100, win(3, 0.6, 70));
    expect(levelStats(p3, IDS[0], 30)).toMatchObject({ etoiles: 3, etoilesC: 2, meilleureBatterie: 0.5, meilleurTVille: 80, reussi: true });
    expect(levelStats(p3, IDS[0], 100)).toMatchObject({ etoilesC: 3, meilleurTVille: 70 });
    expect(levelStats(p3, IDS[0], 10)).toMatchObject({ etoiles: 3, etoilesC: 0, meilleureBatterie: null });
    expect(p3.niveaux[IDS[0]].parC['30'].reussites).toBe(2);
  });

  it('un Score de score.js convient (econome.batterieRestante, ponctuel.tFin)', () => {
    const score = { reussite: true, etoiles: 2, econome: { batterieRestante: 0.25 }, ponctuel: { tFin: 64 } };
    const { progress } = recordResult(emptyProgress(), IDS[1], 30, score);
    expect(levelStats(progress, IDS[1], 30)).toMatchObject({ meilleureBatterie: 0.25, meilleurTVille: 64 });
  });

  it('échecs comptés ; « passer » après SKIP_AFTER_FAILURES échecs, tant que le niveau n’est pas réussi', () => {
    let p = emptyProgress();
    for (let i = 0; i < SKIP_AFTER_FAILURES; i++) {
      expect(canSkip(p, IDS[0])).toBe(false);
      p = recordResult(p, IDS[0], 30, { reussite: false, etoiles: 0 }).progress;
    }
    expect(canSkip(p, IDS[0])).toBe(true);
    expect(levelStats(p, IDS[0]).echecs).toBe(SKIP_AFTER_FAILURES);
    const skipped = recordSkip(p, IDS[0]);
    expect(isUnlocked(skipped, IDS, IDS[1])).toBe(true);
    expect(levelStats(skipped, IDS[0]).etoiles).toBe(0);
    const won = recordResult(p, IDS[0], 30, win(1, 0.1, 100)).progress;
    expect(canSkip(won, IDS[0])).toBe(false);
  });
});

describe('déblocage', () => {
  it('le premier toujours ; le suivant après une réussite à n’importe quel c', () => {
    let p = emptyProgress();
    expect(IDS.map((id) => isUnlocked(p, IDS, id))).toEqual([true, false, false]);
    p = recordResult(p, IDS[0], 10, win(1, 0, 200)).progress;
    expect(IDS.map((id) => isUnlocked(p, IDS, id))).toEqual([true, true, false]);
    expect(isUnlocked(p, IDS, 'n42-inconnu')).toBe(false);
    expect(totalStars(p, IDS)).toBe(1);
  });
});

describe('stockage', () => {
  it(`clé ${PROGRESS_KEY} → aslower:v1:progression ; aller-retour`, () => {
    const backend = new Map();
    const fake = { getItem: (k) => backend.get(k) ?? null, setItem: (k, v) => backend.set(k, v), removeItem: (k) => backend.delete(k) };
    const store = createSafeStore(() => fake);
    const p = recordResult(emptyProgress(), IDS[0], 30, win(3, 0.5, 60)).progress;
    expect(saveProgress(p, store)).toBe(true);
    expect([...backend.keys()]).toEqual(['aslower:v1:progression']);
    expect(loadProgress(store)).toEqual(p);
  });

  it('valeur absente, abîmée ou d’une autre version : progression vide (ce qui est lisible est gardé)', () => {
    const store = createMemoryStore();
    expect(loadProgress(store)).toEqual(emptyProgress());
    store.set(PROGRESS_KEY, { version: 99, niveaux: { [IDS[0]]: { echecs: 1 } } });
    expect(loadProgress(store)).toEqual(emptyProgress());
    const dirty = sanitizeProgress({
      version: 1,
      niveaux: {
        [IDS[0]]: { echecs: 2, passe: 'oui', parC: { 30: { etoiles: 2, meilleureBatterie: 'x' }, abc: { etoiles: 1 }, 10: { etoiles: 7 } } },
        'pas-un-niveau': { echecs: 1 },
        [IDS[1]]: 'abîmé',
      },
    });
    expect(dirty).toEqual({
      version: 1,
      niveaux: { [IDS[0]]: { echecs: 2, passe: false, parC: { 30: { etoiles: 2, meilleureBatterie: null, meilleurTVille: null, reussites: 0 } } } },
    });
    const throwing = { get: () => { throw new Error('bloqué'); }, set: () => { throw new Error('plein'); } };
    expect(loadProgress(throwing)).toEqual(emptyProgress());
    expect(saveProgress(emptyProgress(), throwing)).toBe(false);
  });
});
