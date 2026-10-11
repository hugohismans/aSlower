// Tests des niveaux (jalon 3) : validateur « coursier-niveau/1 » (deux passes, messages
// « chemin JSON : raison »), fixtures invalides, niveaux du jeu (src/levels/, glob de
// src/levels/index.js) et faisabilité par le pilote de référence (src/game/bot.js) :
// parcours de référence = 3 étoiles, parcours naïf < 3, pour c = 10, 30 et 100 m/s.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBotDriver, runBot } from '../src/game/bot.js';
import { LEVEL_SCHEMA } from '../src/game/level.js';
import {
  HUES,
  levelIdFromFileName,
  reachabilityGrid,
  VALIDATION_LIGHT_SPEEDS,
  validateLevel,
  assertValidLevel,
} from '../src/game/validate.js';
import { LEVEL_FILES, LEVEL_IDS, levelIdFromPath, levelJson } from '../src/levels/index.js';
import { physicsFor } from '../src/physics/constants.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const palette = readJson('../src/data/palette.json');
const globalBubbleIds = readJson('../src/data/bubbles.json').bulles.map((b) => b.id);
const example = readJson('./fixtures/levels-valid/n99-exemple.json');
const INVALID_DIR = new URL('./fixtures/levels-invalid/', import.meta.url);
const expected = readJson('./fixtures/levels-invalid/attendu.json').attendus;
const invalidFiles = readdirSync(INVALID_DIR).filter((f) => f.endsWith('.json') && f !== 'attendu.json').sort();

/** Niveaux à éprouver : ceux du jeu et le niveau d'exemple. */
const PLAYABLE = [...LEVEL_FILES.map((l) => ({ fileName: l.fileName, json: l.json })), { fileName: 'n99-exemple.json', json: example }];

describe('validateur : niveau d’exemple', () => {
  it('n99-exemple est valide pour c = 10, 30 et 100, sans avertissement', () => {
    expect(VALIDATION_LIGHT_SPEEDS).toEqual([10, 30, 100]);
    const r = validateLevel(example, { fileName: 'n99-exemple.json', palette, globalBubbleIds });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(example.schema).toBe(LEVEL_SCHEMA);
  });

  it('id = nom de fichier (chemin et extension ignorés)', () => {
    expect(levelIdFromFileName('src/levels/n01-premier-jour.json')).toBe('n01-premier-jour');
    expect(levelIdFromFileName('C:\\x\\n02-a.json')).toBe('n02-a');
    const r = validateLevel(example, { fileName: 'tests/n98-exemple.json', palette });
    expect(r.errors).toContain('n98-exemple.json › id : « n99-exemple » au lieu du nom de fichier « n98-exemple »');
  });

  it('les messages ont la forme « fichier › chemin JSON : raison »', () => {
    const bad = structuredClone(example);
    bad.colis[0].livraison.rayon = 'large';
    bad.portes[0].teinte = 'turquoise';
    const { errors } = validateLevel(bad, { fileName: 'n99-exemple.json', palette });
    expect(errors).toContain('n99-exemple.json › colis[0] (lettre).livraison.rayon : longueur attendue : nombre (m) ou expression {fois, de?…} (en L), reçu "large"');
    expect(errors.some((e) => e.startsWith('n99-exemple.json › portes[0] (porte-verte).teinte : « "turquoise" » inconnu'))).toBe(true);
    expect(HUES).toContain('vert');
  });

  it('passe 2 seulement si la structure est saine ; erreurs propres à certains c signalées', () => {
    const bad = structuredClone(example);
    bad.batterie = {}; // erreur de structure : la passe 2 n'a pas lieu
    bad.colis[0].livraison.lieu = [0, 1e6]; // (serait hors de la carte)
    expect(validateLevel(bad, { palette }).errors).toEqual(['batterie.tauMax : champ obligatoire manquant']);
    const only10 = structuredClone(example);
    only10.colis[0].livraison.lieu = [0, 300]; // hors carte à c = 10 (y max 260 m) seulement
    expect(validateLevel(only10, { palette }).errors).toEqual([
      'colis[0] (lettre).livraison.lieu : zone de livraison (0,0 ; 300,0) hors des limites de la carte (c = 10 m/s)',
    ]);
  });

  it('bulle du niveau : même id qu’une bulle globale refusé ; assertValidLevel lève', () => {
    const bad = structuredClone(example);
    bad.bulles[0].id = 'doppler';
    const { errors } = validateLevel(bad, { palette, globalBubbleIds });
    expect(errors).toContain('bulles[0] (doppler).id : id déjà pris par une bulle globale (src/data/bubbles.json)');
    expect(() => assertValidLevel(bad, { palette, globalBubbleIds })).toThrow(/Niveau invalide/);
    expect(() => assertValidLevel(example, { palette, globalBubbleIds })).not.toThrow();
  });

  it('accessibilité : grille de 1 m, départ relié aux zones ouvertes', () => {
    const scene = {
      bounds: { xmin: 0, ymin: 0, xmax: 50, ymax: 20 },
      buildings: [{ x: 25, y: 10, width: 2, depth: 20, blockId: 'mur' }], // mur de part en part
    };
    const grid = reachabilityGrid(scene, { x: 5, y: 10 });
    expect(grid.cell).toBe(1);
    expect(grid.reachable(10, 10)).toBe(true);
    expect(grid.reachable(40, 10)).toBe(false);
    expect(grid.reachable(40, 10, 18)).toBe(true); // une zone de 18 m déborde de l'autre côté du mur
  });
});

describe('fixtures invalides (tests/fixtures/levels-invalid/)', () => {
  it('chaque fixture a son message attendu', () => {
    expect(invalidFiles.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(expected).sort()).toEqual(invalidFiles);
  });

  for (const file of invalidFiles) {
    it(`${file} : ${expected[file]}`, () => {
      const json = JSON.parse(readFileSync(new URL(file, INVALID_DIR), 'utf8'));
      const { ok, errors } = validateLevel(json, { fileName: file, palette, globalBubbleIds });
      expect(ok).toBe(false);
      expect(errors.some((e) => e.startsWith(`${file} › `) && e.includes(expected[file])), errors.join('\n')).toBe(true);
    });
  }
});

describe('niveaux du jeu (src/levels/index.js)', () => {
  it('glob ./n[0-9][0-9]-*.json : ids = noms de fichiers, triés', () => {
    expect(levelIdFromPath('./n01-premier-jour.json')).toBe('n01-premier-jour');
    expect([...LEVEL_IDS]).toEqual([...LEVEL_IDS].sort());
    for (const l of LEVEL_FILES) expect(levelJson(l.id)).toBe(l.json);
    expect(levelJson('n00-absent')).toBeNull();
  });

  for (const { fileName, json } of LEVEL_FILES) {
    it(`${fileName} est valide (c = 10, 30, 100)`, () => {
      const r = validateLevel(json, { fileName, palette, globalBubbleIds });
      expect(r.errors).toEqual([]);
    });
  }

  it('numéros consécutifs à partir de 1', () => {
    LEVEL_FILES.forEach((l, i) => expect(l.json.numero).toBe(i + 1));
  });
});

describe('pilote de référence : faisabilité et étoiles', () => {
  for (const { fileName, json } of PLAYABLE) {
    if (!json.parcours?.reference) continue;
    for (const c of [10, 30, 100]) {
      it(`${fileName}, c = ${c} : référence ★★★${json.parcours.naif ? ', naïf < 3' : ''}`, () => {
        const ref = runBot(json, { c, palette, route: 'reference' });
        expect(ref.status, ref.score.messages.join(' ')).toBe('reussite');
        expect(ref.score.etoiles, ref.score.messages.join(' ')).toBe(3);
        if (json.parcours.naif) {
          const naive = runBot(json, { c, palette, route: 'naif' });
          expect(naive.score.etoiles).toBeLessThan(3);
        }
      });
    }
  }

  it('n99 : livraisons et porte dans l’ordre, les horloges suivent la vraie physique', () => {
    const r = runBot(example, { c: 30, palette });
    expect(r.events.filter((e) => ['livraison', 'porte', 'reussite'].includes(e.type)).map((e) => e.colis ?? e.porte ?? e.type)).toEqual([
      'lettre',
      'porte-verte',
      'horloge',
      'reussite',
    ]);
    expect(r.level.chocs).toBe(0);
    expect(r.t).toBeGreaterThan(r.tau); // t − τ > 0 dès qu'on a roulé
    expect(r.t).toBeGreaterThanOrEqual(60); // client absent jusqu'à t = 60 s
  });

  it('foncer à travers la porte : choc, reprise, mais la partie continue', () => {
    const rush = {
      etapes: [
        { aller: [0, { fois: 0.5 }], beta: 0.6, arret: true },
        { aller: [0, { fois: 1.6 }], beta: 0.6, arret: true },
      ],
    };
    const r = runBot(example, { c: 30, palette, route: rush, maxTau: 40 });
    expect(r.events.some((e) => e.type === 'reprise' && e.cause === 'choc:porte-verte')).toBe(true);
    expect(r.level.status).toBe('enCours');
  });

  it('le pilote seul : arrêt sur un point, pivot à l’arrêt, attente jusqu’à une heure de la ville', () => {
    const physics = physicsFor(30);
    const driver = createBotDriver({ etapes: [{ aller: [-50, 0], beta: 0.3, arret: true }, { attendreJusqua: 5 }] }, physics);
    // Au repos, cap au nord, point à l'ouest : pivot à gauche (steer < 0), sans poussée.
    const cmd = driver.command({ x: 0, y: 0, heading: Math.PI / 2, speed: 0, rapidity: 0, tau: 0, t: 0 });
    expect(cmd).toEqual({ thrust: 0, brake: 0, steer: -1 });
    expect(driver.done).toBe(false);
  });
});
