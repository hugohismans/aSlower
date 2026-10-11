// Tests de src/hud/format.js : horloges, écart, phrase γ (hystérésis), vitesse tronquée, jauge.
import { describe, expect, it } from 'vitest';
import { C, PHI_MAX_DEFAULT } from '../src/physics/constants.js';
import {
  createGammaPhrase,
  formatClock,
  formatGap,
  formatSpeed,
  gapState,
  gaugeFraction,
} from '../src/hud/format.js';

/** Remplace l'espace fine insécable par une espace ordinaire, pour lire les attentes. */
const plain = (s) => s.replace(/\u202f/g, ' ');

describe('formatClock', () => {
  it('écrit m:ss,d en tronquant les dixièmes', () => {
    expect(formatClock(0)).toBe('0:00,0');
    expect(formatClock(65.3)).toBe('1:05,3');
    expect(formatClock(59.96)).toBe('0:59,9'); // jamais « 0:60,0 »
    expect(formatClock(61.25)).toBe('1:01,2');
    expect(formatClock(11.752012)).toBe('0:11,7'); // t du test obligatoire
    expect(formatClock(5.9)).toBe('0:05,9'); // 5,9 × 10 = 59,000000000000007
    expect(formatClock(3600)).toBe('60:00,0'); // minutes sans plafond
  });

  it('ramène les valeurs négatives ou invalides à zéro', () => {
    expect(formatClock(-3)).toBe('0:00,0');
    expect(formatClock(NaN)).toBe('0:00,0');
    expect(formatClock(undefined)).toBe('0:00,0');
  });
});

describe('formatGap', () => {
  it('écrit un écart signé en dixièmes tronqués', () => {
    expect(plain(formatGap(8.34))).toBe('+8,3 s');
    expect(plain(formatGap(0))).toBe('+0,0 s');
    expect(plain(formatGap(-1e-12))).toBe('+0,0 s'); // bruit de soustraction
    expect(plain(formatGap(99.95))).toBe('+99,9 s');
  });

  it('passe aux secondes entières à partir de 100 s', () => {
    expect(plain(formatGap(100))).toBe('+100 s');
    expect(plain(formatGap(216.7))).toBe('+216 s');
    expect(plain(formatGap(1234.5))).toBe('+1 234 s');
  });

  it('utilise une espace fine insécable avant l’unité', () => {
    expect(formatGap(8.34)).toBe('+8,3\u202fs');
  });
});

describe('createGammaPhrase', () => {
  it('suit la formulation du cahier des charges', () => {
    const phrase = createGammaPhrase();
    expect(phrase(1)).toBe('Toi et la ville, même rythme');
    expect(plain(createGammaPhrase()(1.048))).toBe('La ville va 5 % plus vite que toi');
    expect(plain(createGammaPhrase()(1.15))).toBe('La ville va 15 % plus vite que toi');
    expect(createGammaPhrase()(1.54)).toBe('La ville va ×1,5 plus vite que toi');
    expect(createGammaPhrase()(2.04)).toBe('La ville va ×2 plus vite que toi');
    expect(createGammaPhrase()(4.1)).toBe('La ville va ×4 plus vite que toi');
    expect(createGammaPhrase()(4.6)).toBe('La ville va ×4,5 plus vite que toi');
    expect(createGammaPhrase()(4.8)).toBe('La ville va ×5 plus vite que toi');
    expect(createGammaPhrase()(10.07)).toBe('La ville va ×10 plus vite que toi');
  });

  it('dit « même rythme » sous 1,01 et traite les valeurs invalides comme γ = 1', () => {
    expect(createGammaPhrase()(1.009)).toBe('Toi et la ville, même rythme');
    expect(createGammaPhrase()(NaN)).toBe('Toi et la ville, même rythme');
    expect(plain(createGammaPhrase()(1.01))).toBe('La ville va 1 % plus vite que toi');
  });

  it('applique une hystérésis de 0,6 pas autour de la valeur affichée', () => {
    const phrase = createGammaPhrase();
    expect(phrase(2.04)).toBe('La ville va ×2 plus vite que toi');
    expect(phrase(2.27)).toBe('La ville va ×2 plus vite que toi'); // 2,27 − 2 ≤ 0,3 : reste ×2
    expect(phrase(2.32)).toBe('La ville va ×2,5 plus vite que toi');
    expect(phrase(2.23)).toBe('La ville va ×2,5 plus vite que toi'); // ne rebascule pas tout de suite
    expect(phrase(2.19)).toBe('La ville va ×2 plus vite que toi');
    // Régime entier : pas de 1, seuil à 0,6.
    expect(phrase(6)).toBe('La ville va ×6 plus vite que toi');
    expect(phrase(6.55)).toBe('La ville va ×6 plus vite que toi');
    expect(phrase(6.65)).toBe('La ville va ×7 plus vite que toi');
    // Régime en % : pas de 0,01, seuil à 0,006.
    expect(plain(phrase(1.2))).toBe('La ville va 20 % plus vite que toi');
    expect(plain(phrase(1.205))).toBe('La ville va 20 % plus vite que toi');
    expect(plain(phrase(1.207))).toBe('La ville va 21 % plus vite que toi');
  });

  it('ne dit jamais « ×1,0 », « ×N,0 » ni « 0 % », à la montée comme à la descente', () => {
    const phrase = createGammaPhrase();
    // Montée puis descente lentes avec un bruit déterministe, de γ = 1 à 12.
    const values = [];
    for (let i = 0; i <= 4000; i++) values.push(1 + (11 * i) / 4000);
    for (let i = 4000; i >= 0; i--) values.push(1 + (11 * i) / 4000);
    for (const [i, g] of values.entries()) {
      const text = phrase(g + 0.02 * Math.sin(i * 1.7));
      expect(text).not.toMatch(/×1(?![,\d])|,0 plus|×\d+,0|(?<!\d)0\s%/);
      expect(text).not.toMatch(/×1,0/);
    }
  });

  it('ne change pas de libellé quand γ oscille autour d’une frontière', () => {
    const phrase = createGammaPhrase();
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(phrase(2.25 + 0.05 * Math.sin(i))); // 2,2 à 2,3
    expect(seen.size).toBe(1);
  });
});

describe('formatSpeed', () => {
  it('affiche des m/s entiers loin de c (troncature)', () => {
    expect(plain(formatSpeed(0))).toBe('0 m/s');
    expect(plain(formatSpeed(76.159416))).toBe('76 m/s'); // c·tanh(1)
    expect(plain(formatSpeed(98.99))).toBe('98 m/s');
    expect(plain(formatSpeed(-2))).toBe('0 m/s');
  });

  it('ajoute des décimales près de c, jusqu’à 99,5 avec φ_max = 3', () => {
    const vMax = C * Math.tanh(PHI_MAX_DEFAULT); // 99,5055 m/s
    expect(plain(formatSpeed(99.3, 3))).toBe('99,3 m/s');
    expect(plain(formatSpeed(vMax, PHI_MAX_DEFAULT))).toBe('99,5 m/s'); // tronqué, pas 99,51
    expect(plain(formatSpeed(vMax))).toBe('99,5 m/s'); // φ_max par défaut
  });

  it('lie le nombre de décimales à φ_max', () => {
    // φ_max = 2,06 (γ ≈ 4) : v_max = 96,8 m/s, affichage entier.
    expect(plain(formatSpeed(C * Math.tanh(2.06), 2.06))).toBe('96 m/s');
    // Un φ_max plus grand montrerait plus de 9 (hypothétique : PHI_MAX_LIMIT = 3).
    expect(plain(formatSpeed(99.95, 5))).toBe('99,95 m/s');
    expect(plain(formatSpeed(99.991, 5))).toBe('99,991 m/s');
  });

  it('n’affiche jamais 100 m/s', () => {
    for (const v of [99.99, 99.9999999, 100, 120]) {
      for (const phi of [1, 2, 3]) expect(plain(formatSpeed(v, phi))).not.toMatch(/^100/);
    }
  });
});

describe('gaugeFraction', () => {
  it('est linéaire en v, bornée à [0, 1], avec le mur à c', () => {
    expect(gaugeFraction(0)).toBe(0);
    expect(gaugeFraction(50)).toBeCloseTo(0.5, 12);
    expect(gaugeFraction(76.159416)).toBeCloseTo(0.76159416, 12);
    expect(gaugeFraction(C)).toBe(1);
    expect(gaugeFraction(150)).toBe(1);
    expect(gaugeFraction(-5)).toBe(0);
    expect(gaugeFraction(NaN)).toBe(0);
  });

  it('reste strictement sous 1 au plafond φ_max', () => {
    expect(gaugeFraction(C * Math.tanh(PHI_MAX_DEFAULT))).toBeLessThan(1);
  });
});

describe('gapState', () => {
  it('passe au rouge au-dessus de 1,02 et revient au gris sous 1,01', () => {
    expect(gapState('', 1, 0)).toBe('zero');
    expect(gapState('zero', 1.015, 0.01)).toBe('zero'); // dans la bande : pas de rouge
    expect(gapState('zero', 1.021, 0.2)).toBe('growing');
    expect(gapState('growing', 1.015, 3)).toBe('growing'); // hystérésis
    expect(gapState('growing', 1.009, 3)).toBe('steady');
    expect(gapState('steady', 1.015, 3)).toBe('steady');
  });
});
