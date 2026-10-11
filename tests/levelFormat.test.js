// Tests de src/hud/levelFormat.js (pur) : HUD de niveau (batterie, distance, heures de la
// ville), indicateur du prochain arrêt (direction APPARENTE : aberration), fenêtre de vitesse
// d'une lampe (même chaîne que la règle des portes), spectromètre, bilan, indices.
import { describe, expect, it } from 'vitest';
import { perceivedLamp } from '../src/game/rules.js';
import {
  activeAids,
  batteryFraction,
  batteryLevel,
  brakingDistance,
  counterfactualBattery,
  failureText,
  formatBattery,
  formatClockShort,
  formatDistance,
  formatStars,
  frNumber,
  headOnHue,
  hintFor,
  hueSpeedWindow,
  resultFigures,
  spectrometerReading,
  starLines,
  stopIndicator,
  stopTiming,
} from '../src/hud/levelFormat.js';
import { aberrate } from '../src/physics/relativity.js';

const NB = ' ';

/** Instantané minimal d'un joueur qui roule au cap θ à β (c = 30). */
function snap({ x = 0, y = 0, heading = Math.PI / 2, beta = 0, c = 30, t = 0, tau = 0 } = {}) {
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const hx = Math.cos(heading);
  const hy = Math.sin(heading);
  return {
    x, y, hx, hy, heading, beta, gamma, c, t, tau,
    vx: beta * c * hx, vy: beta * c * hy, speed: beta * c,
    ux: gamma * beta * c * hx, uy: gamma * beta * c * hy, rapidity: Math.atanh(beta),
  };
}

describe('formats du HUD de niveau', () => {
  it('nombres, heures courtes, distances, étoiles', () => {
    expect(frNumber(12.56, 1)).toBe('12,5');
    expect(frNumber(-3.2, 0)).toBe('−3');
    expect(formatClockShort(90)).toBe('1:30');
    expect(formatClockShort(45.9)).toBe('0:45');
    expect(formatClockShort(-1)).toBe('0:00');
    expect(formatDistance(126.8)).toBe(`126${NB}m`);
    expect(formatDistance(1234)).toBe(`1,2${NB}km`);
    expect(formatDistance(NaN)).toBe('—');
    expect(formatStars(2)).toBe('★★☆');
    expect(formatStars(0)).toBe('☆☆☆');
  });

  it('batterie = τ restant : fraction, niveau, texte tronqué', () => {
    expect(batteryFraction(30, 120)).toBeCloseTo(0.75, 12);
    expect(batteryFraction(200, 120)).toBe(0);
    expect(batteryLevel(0.5)).toBe('ok');
    expect(batteryLevel(0.2)).toBe('bas');
    expect(batteryLevel(0.05)).toBe('critique');
    expect(formatBattery(54.7, 120)).toBe(`65${NB}s`);
    expect(formatBattery(130, 120)).toBe(`0${NB}s`);
  });

  it('heure de la ville qui compte : absent, délai, retard', () => {
    expect(stopTiming({ kind: 'livraison', pasAvant: 90, delai: 115 }, 70)).toEqual({ text: `absent jusqu'à 1:30 · encore 20${NB}s`, state: 'absent' });
    expect(stopTiming({ kind: 'retrait', pasAvant: 30, delai: null }, 10).text).toMatch(/^pas prêt jusqu'à 0:30/);
    expect(stopTiming({ kind: 'livraison', pasAvant: null, delai: 45 }, 33.2)).toEqual({ text: `avant 0:45 · encore 11${NB}s`, state: 'delai' });
    expect(stopTiming({ kind: 'livraison', pasAvant: null, delai: 45 }, 50)).toEqual({ text: 'en retard (délai 0:45)', state: 'retard' });
    expect(stopTiming({ kind: 'livraison', pasAvant: null, delai: null }, 50)).toEqual({ text: '', state: 'libre' });
  });

  it('distance de freinage (c²/a)(γ − 1)', () => {
    const s = snap({ beta: 0.5 });
    expect(brakingDistance(s, 3)).toBeCloseTo(300 * (s.gamma - 1), 9);
    expect(brakingDistance(snap(), 3)).toBe(0);
  });
});

describe('indicateur du prochain arrêt', () => {
  it('à l’arrêt : direction vraie (droite = angle positif), distance dans la ville', () => {
    const north = snap();
    expect(stopIndicator(north, { x: 0, y: 100 }).angle).toBeCloseTo(0, 12);
    const right = stopIndicator(north, { x: 100, y: 100, rayon: 8 });
    expect(right.angle).toBeCloseTo(Math.PI / 4, 12); // à droite, devant
    expect(right.distance).toBeCloseTo(Math.hypot(100, 100), 12);
    expect(right.behind).toBe(false);
    const left = stopIndicator(north, { x: -10, y: -10 });
    expect(left.angle).toBeCloseTo((-3 * Math.PI) / 4, 12);
    expect(left.behind).toBe(true);
    expect(stopIndicator(north, { x: 3, y: 4, rayon: 8 }).inZone).toBe(true);
  });

  it('en roulant : la flèche montre la direction APPARENTE (aberration vers l’avant), pas la vraie', () => {
    const s = snap({ beta: 0.6 });
    const stop = { x: 100, y: 0 }; // à 90° à droite
    const ind = stopIndicator(s, stop);
    expect(ind.worldAngle).toBeCloseTo(Math.PI / 2, 12);
    const expected = aberrate({ x: 0, y: 0.6, z: 0 }, { x: 1, y: 0, z: 0 });
    expect(ind.angle).toBeCloseTo(Math.atan2(expected.x, expected.y), 12); // cos θ' = β : 53,1°
    expect(ind.angle).toBeLessThan(ind.worldAngle);
    // Vision classique (k = 0) : direction vraie.
    expect(stopIndicator(s, stop, { k: 0 }).angle).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('lampes : fenêtre de vitesse et spectromètre (même chaîne que la règle)', () => {
  const red = { kind: 'line', lambda: 640, intensity: 1, z: 7, x: 0, y: 0, allumee: null };
  const ir = { ...red, lambda: 900 };

  it('teinte vue de face = celle de rules.perceivedLamp, dans l’axe', () => {
    for (const beta of [0, 0.1, 0.17, 0.3, 0.48, 0.7]) {
      for (const lamp of [red, ir]) {
        const s = { ...snap({ y: -30, beta }), t: 100 };
        expect(headOnHue(lamp, beta, 30), `${lamp.lambda} nm, β = ${beta}`).toBe(perceivedLamp(lamp, s).hue);
      }
    }
  });

  it('fenêtres « vert » : 640 nm ≈ β 0,13–0,23 ; 900 nm ≈ β 0,44–0,52 (conception §6)', () => {
    const w1 = /** @type {{min: number, max: number}} */ (hueSpeedWindow(red, 'vert', { distance: 30 }));
    expect(w1.min).toBeGreaterThan(0.125);
    expect(w1.min).toBeLessThan(0.14);
    expect(w1.max).toBeGreaterThan(0.215);
    expect(w1.max).toBeLessThan(0.235);
    const w2 = /** @type {{min: number, max: number}} */ (hueSpeedWindow(ir, 'vert', { distance: 30 }));
    expect(w2.min).toBeGreaterThan(0.43);
    expect(w2.min).toBeLessThan(0.455);
    expect(w2.max).toBeGreaterThan(0.505);
    expect(w2.max).toBeLessThan(0.53);
    expect(hueSpeedWindow(red, 'turquoise')).toBeNull();
  });

  it('spectromètre : teinte en mots, ✓ si demandée, longueur d’onde vue et domaine', () => {
    expect(spectrometerReading({ hue: 'vert', D: 1.2, on: true, lambdaObs: 533.4 }, red, 'vert')).toEqual({ text: `vert ✓ 533${NB}nm`, ok: true });
    expect(spectrometerReading({ hue: 'noir', D: 1, on: true, lambdaObs: 900 }, ir, 'vert')).toEqual({ text: `noir ✗ 900${NB}nm (infrarouge)`, ok: false });
    expect(spectrometerReading({ hue: 'noir', D: 2, on: true, lambdaObs: 320 }, red, 'vert').text).toMatch(/ultraviolet/);
    expect(spectrometerReading({ hue: 'blanc', D: 2, on: true, lambdaObs: null }, { kind: 'blackbody', T: 2700 }, 'blanc').text).toBe(`blanc ✓ 5400${NB}K`);
    expect(spectrometerReading({ hue: 'noir', D: 1, on: false, lambdaObs: 640 }, red, 'vert')).toEqual({ text: 'éteinte ✗', ok: false });
  });
});

describe('bilan, échec, indices', () => {
  const score = {
    reussite: true,
    raison: null,
    econome: { ok: false, batterieRestante: 0.27, seuil: 0.3, tauFin: 65.7, tauMax: 90 },
    ponctuel: { ok: false, tFin: 93.1, seuil: 115, retards: [{ colis: 'contrat', client: 'Hôtel Lorentz', t: 56.3, delai: 45 }] },
  };

  it('lignes d’étoiles chiffrées', () => {
    const lines = starLines(score);
    expect(lines.map((l) => [l.name, l.ok])).toEqual([
      ['Livré', true],
      ['Économe', false],
      ['Ponctuel', false],
    ]);
    expect(lines[1].detail).toBe(`Batterie restante 27${NB}% (objectif ≥ 30${NB}%).`);
    expect(lines[2].detail).toBe('Hôtel Lorentz livré à 0:56, délai 0:45 : en retard.');
    const late = starLines({ ...score, ponctuel: { ok: false, tFin: 130, seuil: 115, retards: [] } });
    expect(late[2].detail).toBe("Fini à 2:10 à l'horloge de la ville : objectif ≤ 1:55.");
  });

  it('chiffres du bilan et ligne contrefactuelle à 0,2 c', () => {
    expect(counterfactualBattery(300, 30, 0.2)).toBeCloseTo((300 / 6) * Math.sqrt(1 - 0.04), 12);
    expect(counterfactualBattery(0, 30)).toBe(0);
    const f = resultFigures({ tauFin: 33.04, tFin: 35.21, tauMax: 150, distance: 330, c: 30 });
    expect(f.montre).toBe('Ta montre : 0:33,0');
    expect(f.ville).toBe('Horloge de la ville : 0:35,2');
    expect(f.ecart).toBe(`Écart : +2,1${NB}s pour la ville`);
    expect(f.batterie).toBe(`Batterie restante : 77${NB}% (116${NB}s)`);
    expect(f.contrefactuel).toBe(`À 0,2${NB}c (6${NB}m/s), ces 330${NB}m t'auraient coûté ≈ 53${NB}s de batterie (toi : 33${NB}s).`);
  });

  it('échec : raison chiffrée', () => {
    expect(failureText({ raison: 'batterie', econome: { tauFin: 120 }, ponctuel: { tFin: 125.4 } })).toBe(
      `Batterie vide ! Ta montre a tourné 120${NB}s, l'horloge de la ville 125${NB}s.`,
    );
    expect(failureText({ raison: null, econome: { tauFin: 1 }, ponctuel: { tFin: 1 } })).toBe('Livraison manquée.');
  });

  it('indices gradués et aides débloquées', () => {
    const indices = [
      { apresEchecs: 1, texte: 'un' },
      { apresEchecs: 2, texte: 'deux', aide: 'zoneVitesse' },
      { apresEchecs: 3, texte: 'trois', aide: 'spectrometre' },
    ];
    expect(hintFor(indices, 0)).toBeNull();
    expect(hintFor(indices, 2)?.texte).toBe('deux');
    expect(hintFor(indices, 9)?.texte).toBe('trois');
    expect([...activeAids(indices, 2)]).toEqual(['zoneVitesse']);
    expect([...activeAids(indices, 3)].sort()).toEqual(['spectrometre', 'zoneVitesse']);
    expect(hintFor(undefined, 3)).toBeNull();
  });
});
