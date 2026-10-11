// Tests de src/physics/player.js : intégrateur exact, modèle « voiture arcade », plafond.
import { describe, expect, it } from 'vitest';
import { A, C, MAX_FRAME_DT, PHI_MAX_DEFAULT, PHI_MAX_LIMIT, PIVOT_RATE, TURN_RATE } from '../src/physics/constants.js';
import { clampFrameDt, createPlayer, snapshot, step } from '../src/physics/player.js';

/** Générateur pseudo-aléatoire à graine fixe (mulberry32) : tests reproductibles. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vérifie |actual − expected| ≤ tol. */
function expectNear(actual, expected, tol) {
  expect(Math.abs(actual - expected), `${actual} au lieu de ${expected}`).toBeLessThanOrEqual(tol);
}

/**
 * Applique la commande pendant `duration` secondes de temps propre, en images de `frame`
 * secondes (la dernière tronquée pour tomber juste). Appelle `onFrame` après chaque image.
 */
function drive(state, cmd, duration, frame = 1 / 60, onFrame = () => {}) {
  let done = 0;
  while (done < duration) {
    const h = Math.min(frame, duration - done);
    step(state, cmd, h);
    done += h;
    onFrame(state);
  }
  return state;
}

/** Joueur lancé vers l'est à la rapidité φ. */
function movingEast(phi, options = {}) {
  const s = createPlayer({ heading: 0, ...options });
  s.ux = C * Math.sinh(phi);
  return s;
}

/** Angle ramené dans ]−π ; π]. */
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Oracle exact : déplacement (x, y) d'un morceau à rapidité et cap affines en τ,
 * φ(s) = φ0 + k·s et θ(s) = θ0 + ω·s pour s ∈ [0, T] :
 *   z = C ∫ sinh φ(s)·e^{iθ(s)} ds
 *     = (C/2)·e^{iθ0}·[e^{φ0}(e^{(k+iω)T} − 1)/(k+iω) − e^{−φ0}(e^{(−k+iω)T} − 1)/(−k+iω)].
 * (k, ω) ≠ (0, 0) exigé (pour k = 0, passer un k minuscule, 1e-300).
 */
function arc(phi0, k, theta0, omega, T) {
  // ∫ e^{sign·(φ0 + k s)}·e^{iωs} ds, en (partie réelle, partie imaginaire)
  const term = (sign) => {
    const re = sign * k;
    const im = omega;
    const scale = Math.exp(sign * phi0);
    const er = Math.exp(re * T) * Math.cos(im * T) - 1;
    const ei = Math.exp(re * T) * Math.sin(im * T);
    const d = re * re + im * im;
    return [(scale * (er * re + ei * im)) / d, (scale * (ei * re - er * im)) / d];
  };
  const p = term(1);
  const m = term(-1);
  const zr = (C / 2) * (p[0] - m[0]);
  const zi = (C / 2) * (p[1] - m[1]);
  return { x: zr * Math.cos(theta0) - zi * Math.sin(theta0), y: zr * Math.sin(theta0) + zi * Math.cos(theta0) };
}

// Valeurs attendues après τ = 10 s de poussée pleine depuis l'arrêt (rapidité a·τ/c = 1).
const V_10 = 100 * Math.tanh(1); // 76,159416 m/s
const T_10 = 10 * Math.sinh(1); // 11,752012 s
const X_10 = 1000 * (Math.cosh(1) - 1); // 543,080635 m

describe('createPlayer et clampFrameDt', () => {
  it('crée un joueur à l’arrêt, cap nord par défaut', () => {
    const s = createPlayer();
    expect(s).toMatchObject({ x: 0, y: 0, ux: 0, uy: 0, tau: 0, t: 0, phiMax: PHI_MAX_DEFAULT });
    expectNear(s.hx, 0, 1e-15);
    expect(s.hy).toBe(1);
    const p = createPlayer({ x: 5, y: -3, heading: Math.PI, phiMax: 2 });
    expect(p.x).toBe(5);
    expect(p.y).toBe(-3);
    expect(p.hx).toBe(-1);
    expect(p.phiMax).toBe(2);
  });

  it('refuse un plafond hors de ]0 ; PHI_MAX_LIMIT]', () => {
    expect(() => createPlayer({ phiMax: 0 })).toThrow();
    expect(() => createPlayer({ phiMax: PHI_MAX_LIMIT + 0.01 })).toThrow();
    expect(() => createPlayer({ phiMax: NaN })).toThrow();
  });

  it('clampFrameDt borne la durée d’image à [0 ; MAX_FRAME_DT]', () => {
    expect(clampFrameDt(1 / 60)).toBe(1 / 60);
    expect(clampFrameDt(0)).toBe(0);
    expect(clampFrameDt(-0.02)).toBe(0);
    expect(clampFrameDt(0.5)).toBe(MAX_FRAME_DT);
    expect(clampFrameDt(10)).toBe(MAX_FRAME_DT);
    expect(clampFrameDt(Infinity)).toBe(MAX_FRAME_DT);
    expect(clampFrameDt(NaN)).toBe(0);
  });
});

describe('tests obligatoires : poussée pleine pendant τ = 10 s depuis l’arrêt', () => {
  it('les valeurs attendues sont bien celles du cahier des charges', () => {
    expectNear(V_10, 76.159416, 1e-6);
    expectNear(T_10, 11.752012, 1e-6);
    expectNear(X_10, 543.080635, 1e-6);
  });

  // Durées d'image aléatoires à graine fixe, la dernière tronquée : somme exactement 10 s.
  const randomFrames = () => {
    const r = rng(42);
    const frames = [];
    let total = 0;
    while (total < 10) {
      let h = 1 / 240 + r() * (MAX_FRAME_DT - 1 / 240);
      if (total + h > 10) h = 10 - total;
      frames.push(h);
      total += h;
    }
    expect(total).toBe(10);
    return frames;
  };

  const cases = [
    ['pas de 1/60 s', () => Array(600).fill(1 / 60)],
    ['pas de 1/30 s', () => Array(300).fill(1 / 30)],
    ['pas aléatoires (graine fixe)', randomFrames],
    ['un seul appel step(state, cmd, 10)', () => [10]],
  ];

  for (const [label, frames] of cases) {
    it(label, () => {
      const s = createPlayer({ heading: 0 });
      for (const h of frames()) step(s, { thrust: 1 }, h);
      const snap = snapshot(s);
      expectNear(snap.speed, V_10, 1e-6);
      expectNear(s.t, T_10, 1e-6);
      expectNear(s.x, X_10, 1e-5);
      expectNear(s.tau, 10, 1e-9);
      expect(s.y).toBe(0);
    });
  }
});

describe('step : entrées et cas limites', () => {
  it('dtau = 0 ne change rien ; dtau négatif ou non fini est refusé', () => {
    const s = movingEast(0.5);
    const before = { ...s };
    step(s, { thrust: 1 }, 0);
    expect(s).toEqual(before);
    expect(() => step(s, {}, -0.01)).toThrow();
    expect(() => step(s, {}, NaN)).toThrow();
    expect(() => step(s, {}, Infinity)).toThrow();
  });

  it('commande absente = roue libre ; valeurs hors bornes ramenées dans les bornes', () => {
    const a = movingEast(0.5);
    step(a, undefined, 1);
    expectNear(a.x, C * Math.sinh(0.5), 1e-9);
    expectNear(a.t, Math.cosh(0.5), 1e-12);
    const b = createPlayer({ heading: 0 });
    const c = createPlayer({ heading: 0 });
    step(b, { thrust: 3 }, 2);
    step(c, { thrust: 1 }, 2);
    expect(b).toEqual(c);
  });

  it('commandes NaN (gyroscope sans valeur) : traitées comme absentes', () => {
    const a = movingEast(0);
    const b = movingEast(0);
    a.ux = 50;
    b.ux = 50;
    expect(step(a, { thrust: NaN, brake: NaN, steer: NaN }, 1)).toEqual(step(b, {}, 1));
  });

  it('roue libre exacte : Δx = u·Δτ, Δt = γ·Δτ', () => {
    const s = movingEast(1);
    drive(s, {}, 5);
    expectNear(s.x, 5 * C * Math.sinh(1), 1e-9);
    expectNear(s.t, 5 * Math.cosh(1), 1e-12);
    expectNear(s.tau, 5, 1e-12);
  });

  it('à l’arrêt, la poussée part dans la direction du cap', () => {
    const heading = 2;
    const s = createPlayer({ heading });
    drive(s, { thrust: 1 }, 3);
    const d = Math.hypot(s.x, s.y);
    expectNear(d, 1000 * (Math.cosh(0.3) - 1), 1e-9);
    expectNear(s.x / d, Math.cos(heading), 1e-12);
    expectNear(s.y / d, Math.sin(heading), 1e-12);
    expectNear(snapshot(s).heading, heading, 1e-12);
  });

  it('poussée partielle : rapidité = thrust·a·τ/c', () => {
    const s = createPlayer({ heading: 0 });
    step(s, { thrust: 0.5 }, 4);
    expectNear(snapshot(s).rapidity, (0.5 * A * 4) / C, 1e-12);
  });

  it('à l’arrêt, le volant fait pivoter le cap sur place à PIVOT_RATE (steer > 0 : à droite)', () => {
    const s = createPlayer({ x: 7, y: 9, heading: 1 });
    drive(s, { steer: 1 }, 1);
    expectNear(snapshot(s).heading, 1 - PIVOT_RATE, 1e-12);
    expect(s.x).toBe(7);
    expect(s.y).toBe(9);
    expectNear(s.t, 1, 1e-12);
    expectNear(s.tau, 1, 1e-12);
    drive(s, { steer: -0.5, brake: 1 }, 2); // le frein n'empêche pas le pivot
    expectNear(snapshot(s).heading, 1 - PIVOT_RATE + PIVOT_RATE, 1e-12);
    expectNear(Math.hypot(s.hx, s.hy), 1, 1e-15);
  });
});

describe('frein', () => {
  const frameSets = [
    ['pas de 1/60 s', 1 / 60],
    ['pas de 0,1 s', 0.1],
    ['un seul appel de 12 s', 12],
  ];

  for (const [label, frame] of frameSets) {
    it(`depuis φ = 1 : arrêt à 543,080635 m, sans recul (${label})`, () => {
      const s = movingEast(1);
      let previousX = 0;
      drive(s, { brake: 1 }, 12, frame, (st) => {
        expect(st.x).toBeGreaterThanOrEqual(previousX); // jamais de recul
        expect(st.ux).toBeGreaterThanOrEqual(0);
        previousX = st.x;
      });
      expectNear(s.x, X_10, 1e-5);
      expect(s.ux).toBe(0); // arrêt exact
      expect(s.uy).toBe(0);
      expect(s.hx).toBe(1); // le cap est conservé
      // Freinage : τ = 10 s pour t = 10·sinh 1, puis 2 s à l'arrêt (Δt = Δτ).
      expectNear(s.tau, 12, 1e-9);
      expectNear(s.t, T_10 + 2, 1e-9);
    });
  }

  it('freiner à l’arrêt : on reste à l’arrêt, Δt = Δτ', () => {
    const s = createPlayer({ heading: 0 });
    drive(s, { brake: 1 }, 2);
    expect(s.x).toBe(0);
    expect(s.ux).toBe(0);
    expectNear(s.t, 2, 1e-12);
  });

  it('le frein est prioritaire sur la poussée', () => {
    const a = movingEast(1);
    const b = movingEast(1);
    drive(a, { brake: 1, thrust: 1 }, 3);
    drive(b, { brake: 1 }, 3);
    expect(a).toEqual(b);
    expectNear(snapshot(a).rapidity, 0.7, 1e-12);
  });

  it('freiner en tournant : le volant agit pendant le freinage, puis pivot après l’arrêt', () => {
    const s = movingEast(1);
    // Images de 0,07 s : l'arrêt (τ = 10 s) tombe au milieu d'une image.
    drive(s, { brake: 1, steer: 1 }, 12, 0.07);
    expect(s.ux).toBe(0); // arrêt exact
    expect(s.uy).toBe(0);
    expectNear(wrap(snapshot(s).heading - (-10 * TURN_RATE - 2 * PIVOT_RATE)), 0, 1e-9);
    expectNear(s.t, 10 * Math.sinh(1) + 2, 1e-9);
    const e = arc(1, -A / C, 0, -TURN_RATE, 10);
    expect(Math.hypot(s.x - e.x, s.y - e.y)).toBeLessThan(1e-3); // 0,23 mm mesurés
  });

  it('frein partiel : arrêt exact à (c²/(b·a))(cosh φ − 1)', () => {
    const s = movingEast(1);
    drive(s, { brake: 0.5 }, 21);
    expect(s.ux).toBe(0);
    expectNear(s.x, ((C * C) / (0.5 * A)) * (Math.cosh(1) - 1), 1e-5);
    expectNear(s.t, (C / (0.5 * A)) * Math.sinh(1) + 1, 1e-9);
  });

  it('accélérer 10 s puis freiner 10 s : 1 086,161270 m et t = 23,504024 s', () => {
    const s = createPlayer({ heading: 0 });
    drive(s, { thrust: 1 }, 10);
    drive(s, { brake: 1 }, 10);
    expectNear(s.x, 2 * X_10, 1e-5);
    expectNear(s.x, 1086.16127, 1e-5);
    expectNear(s.t, 2 * T_10, 1e-6);
    expectNear(s.t, 23.504024, 1e-6);
    expect(snapshot(s).speed).toBeLessThan(1e-9);
  });
});

describe('virage (modèle arcade)', () => {
  it('virage pur : |u| conservé à 1e-12, cap = û, cercle de rayon |u|/TURN_RATE', () => {
    const phi = 1;
    const s = movingEast(phi);
    const U = C * Math.sinh(phi);
    const R = U / TURN_RATE;
    const quarter = Math.PI / 2 / TURN_RATE;
    drive(s, { steer: 1 }, quarter, 1 / 60, (st) => {
      const u = Math.hypot(st.ux, st.uy);
      expectNear(u / U, 1, 1e-12);
      expectNear(st.hx, st.ux / u, 1e-12);
      expectNear(st.hy, st.uy / u, 1e-12);
    });
    // steer > 0 : à droite (sens horaire). Parti vers l'est de (0, 0), centre en (0, −R) :
    // après un quart de tour, on est en (R, −R) et l'on regarde vers le sud.
    expectNear(s.x, R, 1e-6);
    expectNear(s.y, -R, 1e-6);
    expectNear(snapshot(s).heading, -Math.PI / 2, 1e-12);
    expectNear(s.t, Math.cosh(phi) * quarter, 1e-9); // Δt = γ·Δτ
    // Trois quarts de plus (pas d'image irréguliers) : retour au point de départ.
    drive(s, { steer: 1 }, 3 * quarter, 0.07);
    expectNear(s.x, 0, 1e-6);
    expectNear(s.y, 0, 1e-6);
    expectNear(Math.hypot(s.ux, s.uy) / U, 1, 1e-12);
  });

  it('volant partiel : dθ/dτ = −steer·TURN_RATE', () => {
    const s = movingEast(0.4);
    drive(s, { steer: -0.25 }, 2);
    expectNear(snapshot(s).heading, 0.25 * TURN_RATE * 2, 1e-12);
  });

  it('pousser en tournant : horloges et |u| exacts, position d’ordre 2 (Strang)', () => {
    const run = (frame) => drive(createPlayer({ heading: 0 }), { thrust: 1, steer: 0.5 }, 10, frame);
    const a = run(1 / 60);
    const b = run(10);
    const c = run(0.1);
    // La rapidité ne dépend pas du virage : t, τ et |u| sont ceux de la ligne droite.
    for (const s of [a, b, c]) {
      expectNear(s.t, T_10, 1e-9);
      expectNear(snapshot(s).speed, V_10, 1e-9);
      expectNear(Math.hypot(s.hx - s.ux / Math.hypot(s.ux, s.uy), s.hy - s.uy / Math.hypot(s.ux, s.uy)), 0, 1e-12);
      expectNear(snapshot(s).heading, -0.5 * TURN_RATE * 10 + 2 * Math.PI, 1e-9);
    }
    // Les sous-pas internes (≤ 1/60 s, ≤ 1 m) rendent la position quasi indépendante des images.
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-3);
    expect(Math.hypot(c.x - b.x, c.y - b.y)).toBeLessThan(1e-3);
  });

  it('pousser en tournant depuis l’arrêt : position exacte (forme fermée) à 1 mm', () => {
    const s = drive(createPlayer({ heading: 0 }), { thrust: 1, steer: 0.5 }, 10);
    const e = arc(0, A / C, 0, -0.5 * TURN_RATE, 10);
    expect(Math.hypot(s.x - e.x, s.y - e.y)).toBeLessThan(1e-3); // 0,39 mm mesurés à 60 Hz
  });
});

describe('paradoxe des jumeaux : aller-retour de 1 000 m', () => {
  // Stratégie : pousser jusqu'à mi-chemin (500 m, rapidité acosh 1,5), freiner jusqu'à
  // l'arrêt à 1 000 m (on freine 0,5 s de plus que nécessaire : l'arrêt est exact, puis on
  // attend), demi-tour par pivot sur place (π/PIVOT_RATE secondes), puis même profil au
  // retour. Les temps passés à l'arrêt (1 s d'attente + pivot) s'ajoutent également à τ et
  // à t ; on les retire pour comparer aux valeurs du plan (τ = 38,497 s, t = 44,721 s),
  // dont la forme fermée est τ = 4·(c/a)·acosh 1,5 et t = 4·(c/a)·sinh(acosh 1,5).
  it('τ = 38,497 s et t = 44,721 s en mouvement, retour au départ', () => {
    const s = createPlayer({ heading: 0 });
    const phiHalf = Math.acosh(1.5);
    const tauHalf = (C / A) * phiHalf;
    const pivot = Math.PI / PIVOT_RATE;
    drive(s, { thrust: 1 }, tauHalf);
    expectNear(s.x, 500, 1e-6);
    drive(s, { brake: 1 }, tauHalf + 0.5);
    expectNear(s.x, 1000, 1e-6);
    expect(s.ux).toBe(0);
    drive(s, { steer: 1 }, pivot);
    expectNear(s.hx, -1, 1e-12);
    drive(s, { thrust: 1 }, tauHalf);
    drive(s, { brake: 1 }, tauHalf + 0.5);
    expectNear(s.x, 0, 1e-6);
    expectNear(s.y, 0, 1e-6);

    const atRest = 2 * 0.5 + pivot;
    const tauMoving = 4 * tauHalf;
    const tMoving = 4 * (C / A) * Math.sinh(phiHalf);
    expectNear(s.tau - atRest, tauMoving, 1e-9);
    expectNear(s.t - atRest, tMoving, 1e-9);
    expectNear(s.tau - atRest, 38.497, 1e-3);
    expectNear(s.t - atRest, 44.721, 1e-3);
    // L'écart des horloges ne dépend pas des arrêts : 6,2244 s.
    expectNear(s.t - s.tau, tMoving - tauMoving, 1e-9);
  });
});

describe('snapshot', () => {
  it('cohérence : |v| = |u|/γ, γ = 1/√(1 − v²/c²), φ, β, cap (relatif 1e-12)', () => {
    const r = rng(7);
    const s = createPlayer({ heading: 0.3 });
    for (let i = 0; i < 200; i++) {
      const cmd = { thrust: r(), brake: r() < 0.2 ? r() : 0, steer: 2 * r() - 1 };
      step(s, cmd, clampFrameDt(r() * 0.12));
      const snap = snapshot(s);
      const U = Math.hypot(s.ux, s.uy);
      expectNear(snap.speed, U / snap.gamma, 1e-12 * C);
      expectNear(Math.hypot(snap.vx, snap.vy), snap.speed, 1e-12 * C);
      expectNear(snap.gamma, 1 / Math.sqrt(1 - (snap.speed * snap.speed) / (C * C)), 1e-12 * snap.gamma);
      expectNear(snap.beta, snap.speed / C, 1e-15);
      expectNear(snap.rapidity, Math.asinh(U / C), 1e-12);
      expectNear(snap.heading, Math.atan2(s.hy, s.hx), 0);
      expect(snap).toMatchObject({ x: s.x, y: s.y, tau: s.tau, t: s.t, ux: s.ux, uy: s.uy, hx: s.hx, hy: s.hy });
      expect(snap.speed).toBeLessThan(C);
      expect(s.t).toBeGreaterThanOrEqual(s.tau); // la ville ne vieillit jamais moins que le joueur
    }
  });
});

describe('plafond de rapidité', () => {
  it('1 000 s de poussée : φ = phiMax (1e-12) et |v| = c·tanh(phiMax)', () => {
    const s = createPlayer({ heading: 0 });
    drive(s, { thrust: 1 }, 1000, MAX_FRAME_DT);
    const snap = snapshot(s);
    expectNear(snap.rapidity, PHI_MAX_DEFAULT, 1e-12);
    expectNear(snap.speed, C * Math.tanh(PHI_MAX_DEFAULT), 1e-9);
    expect(snap.speed).toBeLessThan(C);
  });

  it('plafond atteint au milieu d’un pas : découpe exacte, puis roue libre', () => {
    const phiMax = 0.5; // atteint à τ = 5 s
    for (const frame of [1 / 60, 0.1, 10]) {
      const s = createPlayer({ heading: 0, phiMax });
      drive(s, { thrust: 1 }, 10, frame);
      expectNear(snapshot(s).rapidity, phiMax, 1e-12);
      expectNear(s.x, 1000 * (Math.cosh(phiMax) - 1) + 5 * C * Math.sinh(phiMax), 1e-6);
      expectNear(s.t, 10 * Math.sinh(phiMax) + 5 * Math.cosh(phiMax), 1e-9);
    }
  });

  it('plafond franchi en tournant : le volant agit encore au plafond (φ, cap, horloges et position exacts)', () => {
    const phiMax = 0.5; // atteint à τ = 5 s
    for (const frame of [1 / 60, 0.1, 10]) {
      const s = drive(createPlayer({ heading: 0, phiMax }), { thrust: 1, steer: 1 }, 10, frame);
      expectNear(snapshot(s).rapidity, phiMax, 1e-12);
      expectNear(wrap(snapshot(s).heading + 10 * TURN_RATE), 0, 1e-9);
      expectNear(s.t, 10 * Math.sinh(phiMax) + 5 * Math.cosh(phiMax), 1e-9);
      const a = arc(0, A / C, 0, -TURN_RATE, 5);
      const b = arc(phiMax, 1e-300, -5 * TURN_RATE, -TURN_RATE, 5);
      expect(Math.hypot(s.x - a.x - b.x, s.y - a.y - b.y)).toBeLessThan(1e-3);
    }
  });

  it('plafond abaissé en route : la rapidité y est ramenée', () => {
    const s = movingEast(2);
    s.phiMax = 1;
    step(s, { thrust: 1 }, 0.5);
    expectNear(snapshot(s).rapidity, 1, 1e-12);
  });
});
