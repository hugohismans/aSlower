/**
 * Niveau en cours (jalon 3) : du JSON « coursier-niveau/1 » (schéma documenté dans
 * src/game/validate.js et docs/interfaces.md) à l'état de partie, et l'avancée d'une image.
 * Module pur (ni DOM, ni stockage, ni three) : utilisable par un script Node (bot, calibrage).
 *
 * Unités : les longueurs « de jeu » du JSON sont des expressions en L = 10·c m
 * ({fois, de?, plus?, …}, voir render/layout.js) ou des mètres (échelle humaine) ; les temps
 * (délais, batterie, « pas avant », maintien, coûts) sont des secondes, indépendants de c ;
 * les vitesses sont des fractions de c (β). `resolveLevel` remplace les expressions par des
 * mètres pour le c de la partie.
 *
 * Une image de jeu (main.js, bot.js) :
 *   const {events, snapshot} = advance(level, player, cmd, dtau);
 * avance le joueur avec collisions (bâtiments, portes fermées, bords de la carte), applique
 * l'étourdissement des chocs (τ et t), puis les règles (rules.update), puis les reprises.
 */
import { boundaryBoxes, boxesFromBuildings, boxFromCenter, createBoxIndex, PLAYER_RADIUS, stepWithCollisions } from '../physics/collisions.js';
import { createPlayer, snapshot } from '../physics/player.js';
import { expandScene, resolveSceneLengths, SCENE_SCHEMA } from '../render/layout.js';
import { update } from './rules.js';

/** Identifiant du schéma des niveaux. */
export const LEVEL_SCHEMA = 'coursier-niveau/1';
/** Rayon par défaut d'une zone de retrait ou de livraison (m, échelle humaine). */
export const DEFAULT_ZONE_RADIUS = 8;
/** Épaisseur d'une porte (m), le long du passage. */
export const DOOR_THICKNESS = 1;
/** Hauteur de la lampe au-dessus du haut de la porte, par défaut (m). */
export const DEFAULT_LAMP_ABOVE_DOOR = 1;
/**
 * Exclusions du décor (render/decorLayout.js) autour des lieux du niveau (m) : marge ajoutée
 * au rayon des zones de retrait et de livraison ; rayon autour des reprises et du départ ;
 * demi-largeur des couloirs le long des itinéraires du pilote (`parcours`) : au moins
 * DECOR_ROUTE_HALF_WIDTH, et DECOR_ROUTE_WIDTH_PER_L · L · β (le rayon de virage croît comme
 * L·β : à c = 100 m/s et β = 0,86, le pilote du Grand Boulevard s'écarte de 11 m de son axe).
 */
export const DECOR_ZONE_MARGIN = 4;
export const DECOR_POINT_RADIUS = 8;
export const DECOR_ROUTE_HALF_WIDTH = 4;
export const DECOR_ROUTE_WIDTH_PER_L = 0.014;

/**
 * Remplace toutes les expressions de longueur du niveau par leur valeur (m) pour l'unité L.
 * Les paramètres (`parametres`, à la racine) servent à la scène comme au jeu.
 * @param {any} json niveau « coursier-niveau/1 »
 * @param {number} lengthUnit L = 10·c (m)
 * @returns {any} copie résolue (sans `parametres`)
 */
export function resolveLevel(json, lengthUnit) {
  return resolveSceneLengths(json, lengthUnit);
}

/**
 * Lieux que le décor doit laisser libres (`decorExclusions` de la scène) : zones de retrait et
 * de livraison (rayon + DECOR_ZONE_MARGIN : le client se tient au bord de la zone), portes
 * (portée minimale + demi-largeur : le battant et l'approche), points de reprise et départ
 * (DECOR_POINT_RADIUS), et couloirs le long des itinéraires du pilote (parcours de référence
 * et naïf, demi-largeur selon DECOR_ROUTE_HALF_WIDTH et DECOR_ROUTE_WIDTH_PER_L) : tout ce
 * que le joueur doit voir ou atteindre.
 * @param {any} level niveau résolu (resolveLevel)
 * @param {number} [lengthUnit] L = 10·c (m) de la partie (couloirs des itinéraires rapides)
 * @returns {({pos: number[], rayon: number} | {de: number[], a: number[], rayon: number})[]}
 */
export function levelDecorExclusions(level, lengthUnit = 0) {
  const out = [];
  for (const p of level.colis ?? []) {
    for (const stop of [p.retrait, p.livraison]) {
      if (stop) out.push({ pos: stop.lieu, rayon: (stop.rayon ?? DEFAULT_ZONE_RADIUS) + DECOR_ZONE_MARGIN });
    }
  }
  for (const d of level.portes ?? []) out.push({ pos: d.pos, rayon: d.portee[0] + d.largeur / 2 });
  for (const r of level.reprises ?? []) out.push({ pos: r.pos, rayon: DECOR_POINT_RADIUS });
  out.push({ pos: level.depart.pos, rayon: DECOR_POINT_RADIUS });
  for (const name of ['reference', 'naif']) {
    let last = level.depart.pos;
    for (const s of level.parcours?.[name]?.etapes ?? []) {
      if (!s.aller) continue;
      out.push({ de: last, a: s.aller, rayon: Math.max(DECOR_ROUTE_HALF_WIDTH, DECOR_ROUTE_WIDTH_PER_L * lengthUnit * (s.beta ?? 0)) });
      last = s.aller;
    }
  }
  return out;
}

/**
 * Scène « coursier-scene/1 » d'un niveau RÉSOLU (pour expandScene et render/scene.js) :
 * la scène du niveau, avec le schéma, l'id et le départ du niveau, et les exclusions du décor
 * (celles de la scène, puis levelDecorExclusions).
 * @param {any} level niveau résolu (resolveLevel)
 * @param {number} [lengthUnit] L = 10·c (m) pour lequel le niveau a été résolu
 */
export function sceneOfLevel(level, lengthUnit) {
  return {
    schema: SCENE_SCHEMA,
    id: level.id,
    titre: level.titre,
    ...level.scene,
    depart: { pos: level.depart.pos, capDegres: level.depart.capDegres ?? 90 },
    decorExclusions: [...(level.scene.decorExclusions ?? []), ...levelDecorExclusions(level, lengthUnit)],
  };
}

/**
 * Obstacles du décor (troncs, bancs, colonnes, kiosques, tables, jardinières, potelets,
 * fontaines) : boîtes indulgentes de render/decorLayout.js, `kind` 'decor', `id` = sorte.
 * @param {{decor?: {kind: string, collision: {x0: number, y0: number, x1: number, y1: number} | null}[]}} scene
 *   scène développée (expandScene)
 */
export function decorBoxes(scene) {
  return (scene.decor ?? []).filter((d) => d.collision).map((d) => ({ ...d.collision, kind: 'decor', id: d.kind }));
}

/** Cap (rad) depuis des degrés « capDegres » (0 = est, 90 = nord, sens trigonométrique). */
export const headingFromDegrees = (deg) => ((deg ?? 90) / 180) * Math.PI;

/**
 * Boîte (obstacle) d'une porte fermée : `largeur` en travers du passage, DOOR_THICKNESS le long.
 * @param {{x: number, y: number, capDegres: number, largeur: number}} door
 * @param {string} id
 */
export function doorBox(door, id) {
  const alongX = Math.round(door.capDegres / 90) % 2 === 0; // passage est-ouest
  return alongX
    ? boxFromCenter(door.x, door.y, DOOR_THICKNESS, door.largeur, { kind: 'porte', id })
    : boxFromCenter(door.x, door.y, door.largeur, DOOR_THICKNESS, { kind: 'porte', id });
}

function makeStop(stop) {
  return {
    x: stop.lieu[0],
    y: stop.lieu[1],
    rayon: stop.rayon ?? DEFAULT_ZONE_RADIUS,
    pasAvant: stop.pasAvant ?? null,
    timer: 0,
    inZone: false,
    waiting: false,
    startedWaiting: false,
  };
}

/**
 * @typedef {object} LevelState  état d'une partie (modifié par rules.update et advance)
 * @property {string} id
 * @property {number} numero
 * @property {string} titre
 * @property {any} json niveau d'origine (non résolu)
 * @property {any} level niveau résolu pour ce c (mètres)
 * @property {{c: number, a: number, lengthUnit: number}} physics
 * @property {ReturnType<typeof expandScene>} scene scène développée (bâtiments, rues, limites…)
 * @property {any} sceneJson scène « coursier-scene/1 » du niveau (pour render/scene.createWorld)
 * @property {{x: number, y: number, heading: number, beta: number}} start
 * @property {number} tauMax batterie (s)
 * @property {number} phiMax
 * @property {{batterieMin: number, tVilleMax: number}} etoiles
 * @property {'enCours' | 'reussite' | 'echec'} status
 * @property {null | 'batterie'} raison
 * @property {null | {t: number, tau: number}} fin horloges à la réussite ou à l'échec
 * @property {number} tau dernières horloges vues par les règles
 * @property {number} t
 * @property {any[]} colis {id, client, nom, obligatoire, delai, etat: 'aRetirer' | 'aBord' |
 *   'livre', retrait (ou null), livraison : {x, y, rayon, pasAvant, timer, inZone, waiting},
 *   retireA, livreA : {t, tau} | null, enRetard}
 * @property {any[]} portes {id, nom, x, y, capDegres, largeur, hauteur, box, lampe: {x, y, z,
 *   kind, lambda, T, intensity, allumee}, teinte, portee: [min, max] (m), maintien, resteOuverte,
 *   reprise, ouverte, ouverteA, timer, inRange, vue (perceivedLamp ou null), history}
 * @property {any[]} reprises {id, x, y, heading, cout}
 * @property {number} chocs nombre de chocs
 * @property {number} reprisesFaites
 * @property {number} playerRadius
 * @property {import('../physics/collisions.js').BoxSource} obstacles bâtiments, décor, portes
 *   fermées et bords (requête dynamique)
 */

/**
 * Crée l'état de partie d'un niveau (JSON supposé valide : voir validate.js).
 * @param {any} json niveau « coursier-niveau/1 »
 * @param {{c: number, a: number, lengthUnit: number}} physics physicsFor(c) de la partie
 * @param {Record<string, {srgb: string, ir?: number, uv?: number}>} palette src/data/palette.json
 * @param {{decor?: {enabled?: boolean, density?: number, small?: boolean} | false}} [options]
 *   réglage d'exécution du décor (le même que le rendu : render/quality.decorOptions) ;
 *   défaut : décor complet (pilote de référence, validateur)
 * @returns {LevelState}
 */
export function createLevel(json, physics, palette, { decor } = {}) {
  if (!json || json.schema !== LEVEL_SCHEMA) {
    throw new Error(`Niveau : schéma « ${LEVEL_SCHEMA} » attendu (reçu : ${json?.schema})`);
  }
  const L = physics.lengthUnit;
  const level = resolveLevel(json, L);
  const sceneJson = sceneOfLevel(level, L);
  const scene = expandScene(sceneJson, palette, { lengthUnit: L, ...(decor === undefined ? {} : { decor }) });
  const buildingIndex = createBoxIndex([...boxesFromBuildings(scene.buildings), ...decorBoxes(scene)]);
  const walls = boundaryBoxes(scene.bounds);

  const colis = level.colis.map((p) => ({
    id: p.id,
    client: p.client,
    nom: p.nom ?? null,
    obligatoire: p.obligatoire,
    delai: p.delai ?? null,
    etat: p.retrait ? 'aRetirer' : 'aBord',
    retrait: p.retrait ? makeStop(p.retrait) : null,
    livraison: makeStop(p.livraison),
    retireA: null,
    livreA: null,
    enRetard: false,
  }));

  const portes = (level.portes ?? []).map((d) => {
    const door = { x: d.pos[0], y: d.pos[1], capDegres: d.capDegres, largeur: d.largeur };
    const lamp = d.lampe;
    return {
      id: d.id,
      nom: d.nom ?? null,
      ...door,
      hauteur: d.hauteur,
      box: doorBox(door, d.id),
      lampe: {
        x: door.x,
        y: door.y,
        z: lamp.hauteur ?? d.hauteur + DEFAULT_LAMP_ABOVE_DOOR,
        kind: lamp.raie !== undefined ? 'line' : 'blackbody',
        lambda: lamp.raie ?? null,
        T: lamp.corpsNoir ?? null,
        intensity: lamp.intensite ?? 1,
        allumee: lamp.allumee ?? null,
      },
      teinte: d.teinte,
      portee: [d.portee[0], d.portee[1]],
      maintien: d.maintien,
      resteOuverte: d.resteOuverte ?? null,
      reprise: d.reprise ?? null,
      ouverte: false,
      ouverteA: null,
      timer: 0,
      inRange: false,
      vue: null,
      history: [],
    };
  });

  const reprises = (level.reprises ?? []).map((r) => ({
    id: r.id,
    x: r.pos[0],
    y: r.pos[1],
    heading: headingFromDegrees(r.capDegres),
    cout: r.cout,
  }));

  /** @type {LevelState} */
  const state = {
    id: level.id,
    numero: level.numero,
    titre: level.titre,
    json,
    level,
    physics,
    scene,
    sceneJson,
    start: {
      x: level.depart.pos[0],
      y: level.depart.pos[1],
      heading: headingFromDegrees(level.depart.capDegres),
      beta: level.depart.beta ?? 0,
    },
    tauMax: level.batterie.tauMax,
    phiMax: level.phiMax,
    etoiles: { batterieMin: level.etoiles.batterieMin, tVilleMax: level.etoiles.tVilleMax },
    status: 'enCours',
    raison: null,
    fin: null,
    tau: 0,
    t: 0,
    colis,
    portes,
    reprises,
    chocs: 0,
    reprisesFaites: 0,
    playerRadius: PLAYER_RADIUS,
    obstacles: {
      query(xmin, ymin, xmax, ymax) {
        const out = buildingIndex.query(xmin, ymin, xmax, ymax);
        for (const w of walls) if (w.x0 <= xmax && w.x1 >= xmin && w.y0 <= ymax && w.y1 >= ymin) out.push(w);
        for (const p of portes) {
          const b = p.box;
          if (!p.ouverte && b.x0 <= xmax && b.x1 >= xmin && b.y0 <= ymax && b.y1 >= ymin) out.push(b);
        }
        return out;
      },
    },
  };
  return state;
}

/**
 * Joueur au départ du niveau (marche arrière permise ; départ lancé si depart.beta > 0).
 * @param {LevelState} level
 * @returns {import('../physics/player.js').PlayerState}
 */
export function createLevelPlayer(level) {
  const { x, y, heading, beta } = level.start;
  const player = createPlayer({ x, y, heading, phiMax: level.phiMax, physics: level.physics, reverse: true });
  if (beta > 0) {
    const U = (level.physics.c * beta) / Math.sqrt(1 - beta * beta); // |u| = γβc
    player.ux = U * player.hx;
    player.uy = U * player.hy;
  }
  return player;
}

/**
 * Applique une reprise au joueur : au repos au point de reprise, coût ajouté aux deux horloges
 * (la batterie reste égale à τ).
 * @param {import('../physics/player.js').PlayerState} player
 * @param {{x: number, y: number, heading: number, cout: number}} reprise
 */
export function applyReprise(player, reprise) {
  player.x = reprise.x;
  player.y = reprise.y;
  player.ux = 0;
  player.uy = 0;
  player.hx = Math.cos(reprise.heading);
  player.hy = Math.sin(reprise.heading);
  player.brakeHold = 0;
  player.tau += reprise.cout;
  player.t += reprise.cout;
}

/**
 * Une image de jeu : pas du joueur avec collisions, étourdissement des chocs (τ et t), règles,
 * reprises. Ne fait rien (sauf l'instantané) si la partie est finie.
 * @param {LevelState} level
 * @param {import('../physics/player.js').PlayerState} player
 * @param {import('../physics/player.js').DriveCommand} cmd
 * @param {number} dtau temps propre de l'image (s), déjà borné (clampFrameDt)
 * @returns {{events: import('./rules.js').GameEvent[], snapshot: ReturnType<typeof snapshot>}}
 */
export function advance(level, player, cmd, dtau) {
  if (level.status !== 'enCours') return { events: [], snapshot: snapshot(player) };
  const { hits } = stepWithCollisions(player, cmd, dtau, level.obstacles, { applyStun: false });
  const input = [];
  for (const hit of hits) {
    const door = hit.kind === 'porte' ? level.portes.find((p) => p.id === hit.id) : null;
    const stun = door && door.reprise ? 0 : hit.stun; // choc contre une porte à reprise : la reprise coûte
    player.tau += stun;
    player.t += stun;
    input.push({ type: 'choc', kind: hit.kind, id: hit.id, stun, gammaBefore: hit.gammaBefore, gammaAfter: hit.gammaAfter, x: hit.x, y: hit.y });
  }
  const result = update(level, snapshot(player), dtau, input);
  for (const ev of result.events) {
    if (ev.type === 'reprise') applyReprise(player, /** @type {any} */ (ev));
  }
  return { events: result.events, snapshot: snapshot(player) };
}
