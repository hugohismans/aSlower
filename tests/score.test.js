// Tests de src/game/score.js : étoiles = 0 si échec ; sinon 1 + [batterie restante ≥ batterieMin]
// + [t_fin ≤ tVilleMax et aucun retard] ; le bilan dit quelle étoile manque, chiffres à l'appui.
import { describe, expect, it } from 'vitest';
import { scoreResult } from '../src/game/score.js';

const rules = { tauMax: 100, etoiles: { batterieMin: 0.3, tVilleMax: 60 } };
const late = { colis: 'lettre', client: 'M. Doppler', t: 42.37, delai: 40 };

describe('scoreResult', () => {
  it('échec : 0 étoile, message de batterie', () => {
    const s = scoreResult({ reussite: false, raison: 'batterie', tauFin: 100, tFin: 112.5 }, rules);
    expect(s.etoiles).toBe(0);
    expect(s.reussite).toBe(false);
    expect(s.raison).toBe('batterie');
    expect(s.messages[0]).toBe('Batterie vide ! Tu as vécu 100,0 s, la ville 112,5 s.');
    expect(s.manque).toEqual([]);
  });

  it('tout tenu : 3 étoiles, aucun message', () => {
    const s = scoreResult({ reussite: true, tauFin: 50, tFin: 55 }, rules);
    expect(s.etoiles).toBe(3);
    expect(s.econome).toMatchObject({ ok: true, batterieRestante: 0.5, seuil: 0.3 });
    expect(s.ponctuel).toMatchObject({ ok: true, tFin: 55, seuil: 60, retards: [] });
    expect(s.messages).toEqual([]);
  });

  it('seuils inclusifs : batterie restante = batterieMin et t_fin = tVilleMax donnent les étoiles', () => {
    expect(scoreResult({ reussite: true, tauFin: 70, tFin: 60 }, rules).etoiles).toBe(3);
  });

  it('batterie trop basse : ★★, il manque « Économe », chiffres à l’appui', () => {
    const s = scoreResult({ reussite: true, tauFin: 73, tFin: 55 }, rules);
    expect(s.etoiles).toBe(2);
    expect(s.manque).toEqual(['econome']);
    expect(s.messages).toEqual(['Batterie restante 27 % (objectif ≥ 30 %).']);
  });

  it('un seul retard suffit à perdre « Ponctuel », même fini tôt', () => {
    const s = scoreResult({ reussite: true, tauFin: 50, tFin: 55, retards: [late] }, rules);
    expect(s.etoiles).toBe(2);
    expect(s.manque).toEqual(['ponctuel']);
    expect(s.messages).toEqual(['M. Doppler livré à t = 42,3 s : délai de 40 s dépassé.']);
  });

  it('fini trop tard à l’horloge de la ville et batterie basse : ★ seulement', () => {
    const s = scoreResult({ reussite: true, tauFin: 90, tFin: 95.06 }, rules);
    expect(s.etoiles).toBe(1);
    expect(s.manque).toEqual(['econome', 'ponctuel']);
    expect(s.messages).toEqual([
      'Batterie restante 10 % (objectif ≥ 30 %).',
      "Fini à t = 95,0 s à l'horloge de la ville (objectif ≤ 60 s).",
    ]);
  });
});
