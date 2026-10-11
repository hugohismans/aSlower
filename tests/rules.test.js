// Tests de src/game/level.js et src/game/rules.js : état de partie, livraisons (zone,
// v ≤ 0,03·c pendant 0,5 s de τ, t ≥ pasAvant), retards (jamais un échec), portes à lampe
// (teinte PERÇUE, D par la géométrie réelle, état vu en t_e), chocs et reprises, batterie,
// ordre « livraisons avant échecs ». Niveau d'exemple : tests/fixtures/levels-valid/n99-exemple.json
// (à c = 30 : L = 300 m ; lettre à (0, 150), délai 30 s ; horloge à (0, 480), pas avant t = 60 s ;
// porte à (0, 300), lampe à 640 nm à 7 m, capteur de 12 à 45 m ; reprise « elan » à (0, 210)).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, physicsFor } from '../src/physics/constants.js';
import { snapshot } from '../src/physics/player.js';
import { lineColor } from '../src/physics/spectrum.js';
import { advance, applyReprise, createLevel, createLevelPlayer, doorBox, resolveLevel, sceneOfLevel } from '../src/game/level.js';
import { activeStops, DELIVERY_HOLD, DELIVERY_MAX_BETA, lampOnAt, perceivedLamp, seenClientPresent, seenDoorOpen, update } from '../src/game/rules.js';
import { computeScore } from '../src/game/score.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const palette = readJson('../src/data/palette.json');
const example = readJson('./fixtures/levels-valid/n99-exemple.json');
const near = (a, b, tol) => expect(Math.abs(a - b), `${a} au lieu de ${b}`).toBeLessThanOrEqual(tol);

/** Partie neuve à c donné. */
function setup(c = 30, json = example) {
  const physics = physicsFor(c);
  const level = createLevel(json, physics, palette);
  const player = createLevelPlayer(level);
  return { physics, level, player };
}

/** Pose le joueur (au repos ou lancé à β vers le nord). */
function place(player, x, y, beta = 0, heading = Math.PI / 2) {
  player.x = x;
  player.y = y;
  player.hx = Math.cos(heading);
  player.hy = Math.sin(heading);
  const U = (player.c * beta) / Math.sqrt(1 - beta * beta);
  player.ux = U * player.hx;
  player.uy = U * player.hy;
}

/** Avance de `duration` s de τ par images de dt ; renvoie tous les événements. */
function run(level, player, cmd, duration, dt = 1 / 60) {
  const events = [];
  for (let s = 0; s < duration - 1e-9; s += dt) events.push(...advance(level, player, cmd, Math.min(dt, duration - s)).events);
  return events;
}

describe('createLevel : du JSON (en L) à l’état de partie', () => {
  it.each([10, 30, 100])('longueurs résolues pour L = 10·c (c = %i)', (c) => {
    const { level, player } = setup(c);
    const L = 10 * c;
    expect(level.colis.map((p) => [p.id, p.livraison.y])).toEqual([
      ['lettre', 0.5 * L],
      ['horloge', 1.6 * L],
    ]);
    expect(level.portes[0]).toMatchObject({ id: 'porte-verte', x: 0, y: L, teinte: 'vert', maintien: 0.4, ouverte: false });
    expect(level.portes[0].portee).toEqual([12, Math.max(0.15 * L, 30)]);
    expect(level.portes[0].lampe).toMatchObject({ kind: 'line', lambda: 640, z: 7, intensity: 1 });
    expect(level.reprises[0]).toMatchObject({ id: 'elan', x: 0, y: 0.7 * L, cout: 3 });
    expect(level.scene.bounds.ymax).toBe(2 * L + 60);
    expect(level.tauMax).toBe(120); // les temps ne dépendent pas de c
    expect(level.colis[0].delai).toBe(30);
    expect(level.colis[1].livraison.pasAvant).toBe(60);
    expect(level.status).toBe('enCours');
    expect(level.colis.map((p) => p.etat)).toEqual(['aBord', 'aBord']); // sans retrait : à bord
    expect(player).toMatchObject({ x: 0, y: 10, ux: 0, uy: 0, reverse: true, c, a: c / 5, phiMax: 3 });
  });

  it('scène du niveau : schéma et départ ajoutés, sans parametres', () => {
    const resolved = resolveLevel(example, 300);
    expect(resolved.parametres).toBeUndefined();
    const scene = sceneOfLevel(resolved);
    expect(scene).toMatchObject({ schema: 'coursier-scene/1', id: 'n99-exemple', depart: { pos: [0, 10], capDegres: 90 } });
    expect(scene.rues[0].a).toEqual([0, 660]);
  });

  it('départ lancé (depart.beta) : vitesse le long du cap', () => {
    const json = { ...example, depart: { pos: [0, 10], capDegres: 90, beta: 0.5 } };
    const { player } = setup(30, json);
    const snap = snapshot(player);
    near(snap.beta, 0.5, 1e-12);
    near(snap.vy, 15, 1e-9);
  });

  it('porte fermée = obstacle ; ouverte, elle ne l’est plus', () => {
    const { level } = setup(30);
    const box = doorBox({ x: 0, y: 300, capDegres: 90, largeur: 80 }, 'p');
    expect(box).toMatchObject({ x0: -40, x1: 40, y0: 299.5, y1: 300.5, kind: 'porte' });
    expect(level.obstacles.query(-1, 295, 1, 305).some((b) => b.kind === 'porte')).toBe(true);
    level.portes[0].ouverte = true;
    expect(level.obstacles.query(-1, 295, 1, 305).some((b) => b.kind === 'porte')).toBe(false);
    expect(level.obstacles.query(-50, -50, -39, 1000).some((b) => b.kind === 'limite')).toBe(true);
  });
});

describe('livraisons', () => {
  it(`dans la zone, à l’arrêt, pendant ${DELIVERY_HOLD} s de τ : livré (pas avant)`, () => {
    const { level, player } = setup();
    place(player, 3, 150);
    let events = run(level, player, {}, DELIVERY_HOLD - 0.05);
    expect(events.filter((e) => e.type === 'livraison')).toHaveLength(0);
    events = run(level, player, {}, 0.1);
    const delivered = events.find((e) => e.type === 'livraison');
    expect(delivered).toMatchObject({ colis: 'lettre', client: 'M. Doppler', enRetard: false });
    expect(level.colis[0].etat).toBe('livre');
    expect(level.colis[0].livreA.tau).toBeGreaterThanOrEqual(DELIVERY_HOLD - 1e-9);
    expect(activeStops(level).map((s) => s.colis)).toEqual(['horloge']);
  });

  it(`trop vite (v > ${DELIVERY_MAX_BETA}·c) ou hors de la zone : rien`, () => {
    const { level, player } = setup();
    place(player, 0, 145, 0.031);
    // En roue libre à 0,93 m/s : traverse la zone (16 m) sans livrer.
    run(level, player, {}, 3);
    expect(level.colis[0].etat).toBe('aBord');
    place(player, 9, 150); // à 9 m du centre (rayon 8)
    run(level, player, {}, 2);
    expect(level.colis[0].etat).toBe('aBord');
  });

  it('juste sous 0,03·c : livré en roulant au pas', () => {
    const { level, player } = setup();
    place(player, 0, 145, 0.029);
    const events = run(level, player, {}, 1);
    expect(events.some((e) => e.type === 'livraison' && e.colis === 'lettre')).toBe(true);
  });

  it('client absent avant pasAvant : on attend dans la zone (événements « attente »), livré dès t = 60 s', () => {
    const { level, player } = setup();
    place(player, 0, 480);
    const events = run(level, player, {}, 59.8, 0.1);
    expect(events.filter((e) => e.type === 'attente')).toEqual([{ type: 'attente', colis: 'horloge', kind: 'livraison', pasAvant: 60 }]);
    expect(level.colis[1].etat).toBe('aBord');
    expect(level.colis[1].livraison.waiting).toBe(true);
    const later = run(level, player, {}, 1, 0.1);
    const done = later.find((e) => e.type === 'livraison');
    expect(done.colis).toBe('horloge');
    near(done.t, 60 + DELIVERY_HOLD, 0.11);
  });

  it('en retard : livré quand même (pas d’échec), enRetard, étoile « Ponctuel » perdue', () => {
    const { level, player } = setup();
    player.t = 31; // l'horloge de la ville a passé le délai de 30 s
    place(player, 0, 150);
    const events = run(level, player, {}, 1);
    expect(events.find((e) => e.type === 'livraison')).toMatchObject({ colis: 'lettre', enRetard: true, delai: 30 });
    expect(level.status).toBe('enCours');
    place(player, 0, 480);
    player.t = 70;
    run(level, player, {}, 1);
    expect(level.status).toBe('reussite');
    const score = computeScore(level);
    expect(score.reussite).toBe(true);
    expect(score.ponctuel.ok).toBe(false);
    expect(score.ponctuel.retards).toEqual([{ colis: 'lettre', client: 'M. Doppler', t: expect.any(Number), delai: 30 }]);
    expect(score.manque).toContain('ponctuel');
  });

  it('retrait puis livraison (colis avec retrait)', () => {
    const json = structuredClone(example);
    json.colis[0].retrait = { lieu: [0, 40], pasAvant: 5 };
    const { level, player } = setup(30, json);
    expect(level.colis[0].etat).toBe('aRetirer');
    expect(activeStops(level)[0]).toMatchObject({ colis: 'lettre', kind: 'retrait', y: 40, rayon: 8, pasAvant: 5 });
    place(player, 0, 150); // livrer avant d'avoir retiré : impossible
    run(level, player, {}, 1);
    expect(level.colis[0].etat).toBe('aRetirer');
    place(player, 0, 40);
    const events = run(level, player, {}, 5);
    expect(events.find((e) => e.type === 'retrait')).toMatchObject({ colis: 'lettre' });
    expect(events.find((e) => e.type === 'retrait').t).toBeGreaterThanOrEqual(5);
    expect(level.colis[0].etat).toBe('aBord');
  });
});

describe('porte à lampe : teinte perçue', () => {
  it('lampe vue de l’arrêt : rouge (640 nm, D = 1) ; lampe éteinte (allumee) : noire, vue en t_e', () => {
    const { level, player } = setup();
    place(player, 0, 270);
    const seen = perceivedLamp(level.portes[0].lampe, snapshot(player));
    expect(seen.hue).toBe('rouge');
    near(seen.D, 1, 1e-12);
    near(seen.lambdaObs, 640, 1e-9);
    near(seen.distance, Math.hypot(30, 7 - EYE_HEIGHT), 1e-12);
    near(seen.te, -seen.distance / 30, 1e-12);
    const lamp = { ...level.portes[0].lampe, allumee: [[0, 10]] };
    expect(lampOnAt(lamp, 5)).toBe(true);
    expect(lampOnAt(lamp, 10)).toBe(false);
    player.t = 10.5; // allumée jusqu'à 10 s, mais on voit encore l'image de t_e ≈ 9,5 s
    expect(perceivedLamp(lamp, snapshot(player)).hue).toBe('rouge');
    player.t = 12;
    expect(perceivedLamp(lamp, snapshot(player))).toMatchObject({ hue: 'noir', on: false });
  });

  it('D par la géométrie réelle : la hauteur de la lampe compte (de près, D baisse)', () => {
    const { level, player } = setup();
    const lamp = level.portes[0].lampe;
    place(player, 0, 255, 0.17); // 45 m
    const far = perceivedLamp(lamp, snapshot(player));
    place(player, 0, 299, 0.17); // 1 m : lampe presque au-dessus
    const close = perceivedLamp(lamp, snapshot(player));
    const g = 1 / Math.sqrt(1 - 0.17 * 0.17);
    near(far.D, g * (1 + (0.17 * 45) / Math.hypot(45, 5.4)), 1e-9);
    expect(close.D).toBeLessThan(far.D);
    expect(far.hue).toBe('vert');
    expect(close.hue).not.toBe('vert'); // sous la porte, l'angle ramène la lampe vers le rouge
  });

  it('teinte de la règle = classe de la raie vue (λ/D dans [510 ; 562] nm → vert)', () => {
    const { level, player } = setup();
    for (const beta of [0.05, 0.1, 0.14, 0.17, 0.2, 0.25, 0.35]) {
      place(player, 0, 260, beta);
      const seen = perceivedLamp(level.portes[0].lampe, snapshot(player));
      const lambda = 640 / seen.D;
      if (lambda > 515 && lambda < 557) expect(seen.hue).toBe('vert');
      if (lambda > 570 || lambda < 505) expect(seen.hue).not.toBe('vert');
      expect(lineColor(lambda).length).toBe(3);
    }
  });

  it.each([10, 30, 100])('à β = 0,17 dans la portée : s’ouvre après maintien (0,4 s de τ) (c = %i)', (c) => {
    const { level, player } = setup(c);
    const L = 10 * c;
    const door = level.portes[0];
    place(player, 0, L - door.portee[1] + 1, 0.17);
    const events = run(level, player, {}, 0.3);
    expect(events.some((e) => e.type === 'porte')).toBe(false);
    expect(door.vue.hue).toBe('vert');
    near(door.timer, 0.3, 1 / 60 + 1e-9);
    const more = run(level, player, {}, 0.2);
    const opened = more.find((e) => e.type === 'porte');
    expect(opened).toMatchObject({ porte: 'porte-verte', ouverte: true });
    expect(door.ouverte).toBe(true);
    // On passe la porte sans choc.
    run(level, player, {}, (door.portee[1] + 20) / (0.17 * c));
    expect(player.y).toBeGreaterThan(L + 10);
    expect(level.chocs).toBe(0);
  });

  it('vue depuis le joueur : la porte ouverte ne le paraît qu’après d/c (seenDoorOpen)', () => {
    const { level, player } = setup(10);
    const door = level.portes[0];
    door.history.push({ t: 5, ouverte: true });
    place(player, 0, 100 - 30); // à 30 m : 3 s de retard à c = 10
    player.t = 7;
    expect(seenDoorOpen(door, snapshot(player))).toBe(false);
    player.t = 8.01;
    expect(seenDoorOpen(door, snapshot(player))).toBe(true);
    const stop = level.colis[1].livraison; // pasAvant 60, à 160 m
    place(player, 0, 0);
    player.t = 70;
    expect(seenClientPresent(stop, snapshot(player))).toBe(false); // on voit t_e = 54 s
    player.t = 76.1;
    expect(seenClientPresent(stop, snapshot(player))).toBe(true);
    expect(seenClientPresent(level.colis[0].livraison, snapshot(player))).toBe(true);
  });

  it('trop vite : la lampe n’est jamais verte assez longtemps → choc → reprise (+3 s aux deux horloges, sans étourdissement)', () => {
    const { level, player } = setup();
    place(player, 0, 200, 0.6);
    const tauBefore = player.tau;
    const gapBefore = player.t - player.tau;
    let reprise = null;
    let tauAtReprise = 0;
    for (let i = 0; i < 600 && !reprise; i++) {
      const tau0 = player.tau;
      const out = advance(level, player, {}, 1 / 60);
      reprise = out.events.find((e) => e.type === 'reprise') ?? null;
      if (reprise) tauAtReprise = player.tau - tau0;
      expect(player.y).toBeLessThan(300);
    }
    expect(reprise).toMatchObject({ reprise: 'elan', cause: 'choc:porte-verte', cout: 3, x: 0, y: 210 });
    expect(player).toMatchObject({ x: 0, y: 210, ux: 0, uy: 0 });
    near(tauAtReprise, 1 / 60 + 3, 1e-9); // la reprise coûte 3 s, pas d'étourdissement en plus
    expect(level.reprisesFaites).toBe(1);
    expect(level.chocs).toBe(1);
    expect(player.tau - tauBefore).toBeGreaterThan(3);
    expect(player.t - player.tau).toBeGreaterThan(gapBefore); // l'écart vient du trajet, pas de la reprise
    expect(level.portes[0].ouverte).toBe(false);
  });

  it('à l’arrêt devant la porte : rouge, jamais ouverte', () => {
    const { level, player } = setup();
    place(player, 0, 280);
    run(level, player, {}, 3);
    expect(level.portes[0].ouverte).toBe(false);
    expect(level.portes[0].vue.hue).toBe('rouge');
  });

  it('resteOuverte : la porte se referme, mais jamais sur le joueur', () => {
    const json = structuredClone(example);
    json.portes[0].resteOuverte = 2;
    const { level, player } = setup(30, json);
    const door = level.portes[0];
    door.ouverte = true;
    door.ouverteA = 0;
    place(player, 0, 300); // sous la porte
    let events = run(level, player, {}, 3);
    expect(door.ouverte).toBe(true);
    place(player, 0, 330);
    events = run(level, player, {}, 0.1);
    expect(events.find((e) => e.type === 'porte')).toMatchObject({ ouverte: false });
    expect(door.history.map((h) => h.ouverte)).toEqual([false]);
  });
});

describe('chocs, batterie, ordre des règles', () => {
  it('choc contre un bâtiment : étourdissement κ·Δγ ajouté à τ ET t', () => {
    const { level, player } = setup();
    // Vers l'ouest, à travers la façade de la rangée ouest (x ≈ −12).
    place(player, 0, 28, 0.3, Math.PI);
    const events = run(level, player, {}, 2);
    const hit = events.find((e) => e.type === 'choc');
    expect(hit).toMatchObject({ kind: 'batiment' });
    near(hit.stun, 20 * (1 / Math.sqrt(1 - 0.09) - 1), 1e-6);
    expect(player.x).toBeGreaterThan(-12);
    expect(level.chocs).toBe(1);
  });

  it('batterie vide : échec (τ ≥ tauMax)', () => {
    const { level, player } = setup();
    player.tau = 119.95;
    player.t = 119.95;
    const events = run(level, player, {}, 0.1);
    expect(events.find((e) => e.type === 'echec')).toMatchObject({ raison: 'batterie' });
    expect(level.status).toBe('echec');
    expect(level.raison).toBe('batterie');
    expect(computeScore(level).etoiles).toBe(0);
    // Partie finie : plus rien ne bouge.
    const x = player.x;
    const out = advance(level, player, { thrust: 1 }, 1);
    expect(out.events).toEqual([]);
    expect(player.x).toBe(x);
  });

  it('livraisons avant échecs : la dernière livraison dans l’image où la batterie se vide gagne', () => {
    const { level, player } = setup();
    level.colis[0].etat = 'livre';
    level.colis[0].livreA = { t: 10, tau: 10 };
    place(player, 0, 480);
    // Images de 0,1 s : la 5e image finit la livraison (0,5 s) ET passe τ = 120 s.
    player.tau = 119.55;
    player.t = 119.55;
    const events = run(level, player, {}, 0.5, 0.1);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['livraison', 'reussite']));
    expect(events.some((e) => e.type === 'echec')).toBe(false);
    expect(level.status).toBe('reussite');
    expect(level.fin.tau).toBeGreaterThanOrEqual(120 - 1e-9);
  });

  it('update direct : un choc de porte sans reprise reste un simple choc', () => {
    const json = structuredClone(example);
    delete json.portes[0].reprise;
    const { level, player } = setup(30, json);
    const out = update(level, snapshot(player), 0, [{ type: 'choc', kind: 'porte', id: 'porte-verte', stun: 1 }]);
    expect(out.events.map((e) => e.type)).toEqual(['choc']);
    applyReprise(player, { x: 1, y: 2, heading: 0, cout: 4 });
    expect(player).toMatchObject({ x: 1, y: 2, ux: 0, uy: 0, hx: 1, tau: 4, t: 4 });
  });
});
