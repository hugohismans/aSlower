/**
 * Règles d'une partie (jalon 3) : livraisons, retraits, portes à lampe, reprises, batterie,
 * réussite. Module pur (ni DOM, ni stockage, ni three) ; l'état de partie vient de
 * `createLevel` (src/game/level.js) et `update` le fait évoluer.
 *
 * Ordre dans une image (docs/conception.md §2) : le joueur avance (collisions comprises, dans
 * level.advance), puis `update` : retraits et livraisons D'ABORD, puis portes, chocs et
 * reprises, puis réussite, et seulement ensuite les échecs. Une livraison qui aboutit dans
 * l'image où la batterie se vide gagne donc.
 *
 * - Retrait / livraison : dans la zone (distance horizontale au lieu ≤ rayon), à
 *   v ≤ DELIVERY_MAX_BETA·c, pendant DELIVERY_HOLD s de temps propre d'affilée, et t ≥ pasAvant
 *   (heure de la ville, sur place : le client est là). Attendre dans la zone avant pasAvant
 *   est permis : la livraison se fait dès que la ville atteint pasAvant. Un retard (t > délai)
 *   n'est JAMAIS un échec (décision 6) : il coûte l'étoile « Ponctuel » (score.js).
 * - Porte à lampe : s'ouvre si la teinte PERÇUE de sa lampe est la teinte demandée pendant
 *   `maintien` s de temps propre d'affilée, le véhicule étant à une distance horizontale de la
 *   porte comprise dans `portee`. Teinte perçue = classifyHue(perceivedColor(lampe, D,
 *   {exposure: adaptationExposure(e^φ)})), D = γ(1 + β·n) par la géométrie réelle (œil à
 *   EYE_HEIGHT, lampe à sa hauteur), état de la lampe (allumée ou non) vu à
 *   t_e = t − d/c (emissionTimeStatic). Ouverte, elle le reste (ou `resteOuverte` s de ville).
 * - Choc contre une porte fermée qui a une reprise : reprise (le joueur repart au repos au
 *   point de reprise ; `cout` s ajoutées aux deux horloges, appliquées par level.applyReprise).
 * - Échec : batterie vide (τ ≥ tauMax). (Le flash du niveau 5 viendra ici, après la batterie.)
 * - Réussite : tous les colis obligatoires livrés (même en retard).
 */
import { EYE_HEIGHT } from '../physics/constants.js';
import { emissionTimeStatic } from '../physics/relativity.js';
import { adaptationExposure, classifyHue, perceivedColor } from '../physics/spectrum.js';

/** Vitesse maximale pour livrer ou retirer, en fraction de c (0,9 m/s à c = 30). */
export const DELIVERY_MAX_BETA = 0.03;
/** Temps propre à passer dans la zone, assez lent, pour livrer ou retirer (s). */
export const DELIVERY_HOLD = 0.5;

/**
 * @typedef {{x: number, y: number, vx: number, vy: number, ux: number, uy: number,
 *            speed: number, beta: number, gamma: number, rapidity: number, tau: number,
 *            t: number, c: number}} RulesSnapshot  (sous-ensemble de player.snapshot)
 */

/**
 * @typedef {object} GameEvent  événement produit par `update` (ou reçu : `choc`) ;
 *   'attente' : émis quand le joueur se met à attendre dans une zone avant pasAvant (une fois
 *   par attente ; l'état courant est dans stop.waiting)
 * @property {string} type 'retrait' | 'livraison' | 'attente' | 'porte' | 'choc' | 'reprise'
 *   | 'reussite' | 'echec'
 */

/**
 * La lampe est-elle allumée à l'heure de la ville `te` ? (`allumee` : liste d'intervalles
 * [début, fin[ en t ; absente : toujours allumée.)
 * @param {{allumee?: number[][] | null}} lamp
 * @param {number} te
 */
export function lampOnAt(lamp, te) {
  if (!lamp.allumee) return true;
  return lamp.allumee.some(([from, to]) => te >= from && te < to);
}

/**
 * Lampe d'une porte telle que le joueur la voit maintenant.
 * @param {{x: number, y: number, z: number, kind: 'line' | 'blackbody', lambda?: number,
 *          T?: number, intensity: number, allumee?: number[][] | null}} lamp
 * @param {RulesSnapshot} snap
 * @returns {{hue: string, D: number, te: number, on: boolean, rgb: number[], distance: number,
 *            lambdaObs: number | null}}
 *   D : facteur Doppler (géométrie réelle) ; te : heure de la ville de l'image vue ;
 *   lambdaObs : longueur d'onde vue (lampe à raie), pour le spectromètre
 */
export function perceivedLamp(lamp, snap) {
  const c = snap.c;
  const dx = lamp.x - snap.x;
  const dy = lamp.y - snap.y;
  const dz = lamp.z - EYE_HEIGHT;
  const distance = Math.hypot(dx, dy, dz);
  // D = γ(1 + β·n) = γ + (u·n)/c, avec u = γv (précis jusqu'au plafond de rapidité).
  const D = distance > 0 ? snap.gamma + (snap.ux * dx + snap.uy * dy) / (c * distance) : snap.gamma;
  const te = emissionTimeStatic(snap.t, distance, c);
  const on = lampOnAt(lamp, te);
  const lambdaObs = lamp.kind === 'line' ? /** @type {number} */ (lamp.lambda) / D : null;
  if (!on) return { hue: 'noir', D, te, on, rgb: [0, 0, 0], distance, lambdaObs };
  /** @type {import('../physics/spectrum.js').LightSource} */
  const source =
    lamp.kind === 'line'
      ? { kind: 'line', lambda: /** @type {number} */ (lamp.lambda), intensity: lamp.intensity }
      : { kind: 'blackbody', T: /** @type {number} */ (lamp.T), intensity: lamp.intensity };
  const exposure = adaptationExposure(Math.exp(snap.rapidity));
  const rgb = perceivedColor(source, D, { exposure });
  return { hue: classifyHue(rgb), D, te, on, rgb, distance, lambdaObs };
}

/**
 * Porte vue ouverte depuis la position du joueur (rendu) : son état à t_e = t − d/c.
 * @param {{x: number, y: number, history: {t: number, ouverte: boolean}[]}} door
 * @param {{x: number, y: number, t: number, c: number}} snap
 */
export function seenDoorOpen(door, snap) {
  const te = emissionTimeStatic(snap.t, Math.hypot(door.x - snap.x, door.y - snap.y), snap.c);
  let open = false;
  for (const h of door.history) if (h.t <= te) open = h.ouverte;
  return open;
}

/**
 * Client vu présent (rendu, HUD) : présent si pasAvant est absent ou si t_e ≥ pasAvant,
 * t_e = t − d/c étant l'heure de la ville de l'image qu'on reçoit du lieu.
 * @param {{x: number, y: number, pasAvant: number | null}} stop
 * @param {{x: number, y: number, t: number, c: number}} snap
 */
export function seenClientPresent(stop, snap) {
  if (stop.pasAvant === null || stop.pasAvant === undefined) return true;
  const te = emissionTimeStatic(snap.t, Math.hypot(stop.x - snap.x, stop.y - snap.y), snap.c);
  return te >= stop.pasAvant;
}

/**
 * Arrêts actifs (à faire maintenant) : retraits des colis à retirer, livraisons des colis à
 * bord, dans l'ordre du fichier.
 * @param {any} level état de partie (createLevel)
 * @returns {{colis: string, client: string, kind: 'retrait' | 'livraison', x: number, y: number,
 *            rayon: number, pasAvant: number | null, delai: number | null, obligatoire: boolean}[]}
 */
export function activeStops(level) {
  const out = [];
  for (const p of level.colis) {
    const stop = p.etat === 'aRetirer' ? p.retrait : p.etat === 'aBord' ? p.livraison : null;
    if (!stop) continue;
    out.push({
      colis: p.id,
      client: p.client,
      kind: p.etat === 'aRetirer' ? 'retrait' : 'livraison',
      x: stop.x,
      y: stop.y,
      rayon: stop.rayon,
      pasAvant: stop.pasAvant,
      delai: p.etat === 'aBord' ? p.delai : null,
      obligatoire: p.obligatoire,
    });
  }
  return out;
}

/** Arrêt (retrait ou livraison) : progression du chronomètre de la zone. */
function updateStop(stop, snap, dt, slow) {
  const inZone = Math.hypot(snap.x - stop.x, snap.y - stop.y) <= stop.rayon;
  const open = stop.pasAvant === null || snap.t >= stop.pasAvant;
  const wasWaiting = stop.waiting;
  stop.inZone = inZone;
  stop.waiting = inZone && slow && !open;
  stop.startedWaiting = stop.waiting && !wasWaiting;
  if (inZone && slow && open) stop.timer += dt;
  else stop.timer = 0;
  return stop.timer >= DELIVERY_HOLD - 1e-9;
}

/** Distance du centre du joueur à la boîte d'une porte. */
function distanceToDoorBox(door, snap) {
  const b = door.box;
  return Math.hypot(Math.max(b.x0 - snap.x, 0, snap.x - b.x1), Math.max(b.y0 - snap.y, 0, snap.y - b.y1));
}

/**
 * Fait évoluer l'état de partie d'une image (modifie `level`).
 * @param {any} level état de partie (createLevel)
 * @param {RulesSnapshot} snap instantané du joueur APRÈS son pas (et ses collisions)
 * @param {number} dt temps propre de l'image (s)
 * @param {GameEvent[]} [events] événements de l'image : {type: 'choc', kind, id, stun,
 *   gammaBefore, gammaAfter} (level.advance)
 * @returns {{events: GameEvent[], status: 'enCours' | 'reussite' | 'echec'}}
 */
export function update(level, snap, dt, events = []) {
  /** @type {GameEvent[]} */
  const out = [];
  if (level.status !== 'enCours') return { events: out, status: level.status };
  level.tau = snap.tau;
  level.t = snap.t;
  const slow = snap.speed <= DELIVERY_MAX_BETA * snap.c;

  // 1. Retraits et livraisons (avant tout échec).
  for (const p of level.colis) {
    if (p.etat === 'aRetirer') {
      const done = updateStop(p.retrait, snap, dt, slow);
      if (p.retrait.startedWaiting) out.push({ type: 'attente', colis: p.id, kind: 'retrait', pasAvant: p.retrait.pasAvant });
      if (done) {
        p.etat = 'aBord';
        p.retireA = { t: snap.t, tau: snap.tau };
        out.push({ type: 'retrait', colis: p.id, client: p.client, t: snap.t, tau: snap.tau });
      }
    } else if (p.etat === 'aBord') {
      const done = updateStop(p.livraison, snap, dt, slow);
      if (p.livraison.startedWaiting) out.push({ type: 'attente', colis: p.id, kind: 'livraison', pasAvant: p.livraison.pasAvant });
      if (done) {
        p.etat = 'livre';
        p.livreA = { t: snap.t, tau: snap.tau };
        p.enRetard = p.delai !== null && snap.t > p.delai;
        out.push({ type: 'livraison', colis: p.id, client: p.client, t: snap.t, tau: snap.tau, enRetard: p.enRetard, delai: p.delai });
      }
    }
  }

  // 2. Portes à lampe.
  for (const door of level.portes) {
    if (door.ouverte) {
      if (door.resteOuverte !== null && snap.t >= door.ouverteA + door.resteOuverte && distanceToDoorBox(door, snap) > level.playerRadius) {
        door.ouverte = false;
        door.timer = 0;
        door.history.push({ t: snap.t, ouverte: false });
        out.push({ type: 'porte', porte: door.id, ouverte: false, t: snap.t });
      }
      continue;
    }
    const d = Math.hypot(snap.x - door.x, snap.y - door.y);
    door.inRange = d >= door.portee[0] && d <= door.portee[1];
    if (d > door.portee[1] + 50 && door.timer === 0) {
      door.vue = null; // trop loin : rien à évaluer
      continue;
    }
    const seen = perceivedLamp(door.lampe, snap);
    door.vue = seen;
    if (door.inRange && seen.hue === door.teinte) door.timer += dt;
    else door.timer = 0;
    if (door.timer >= door.maintien - 1e-9) {
      door.ouverte = true;
      door.ouverteA = snap.t;
      door.history.push({ t: snap.t, ouverte: true });
      out.push({ type: 'porte', porte: door.id, ouverte: true, t: snap.t, tau: snap.tau });
    }
  }

  // 3. Chocs (reçus de level.advance) et reprises.
  let reprise = null;
  for (const ev of events) {
    if (ev.type !== 'choc') continue;
    level.chocs += 1;
    out.push(ev);
    if (ev.kind === 'porte' && !reprise) {
      const door = level.portes.find((p) => p.id === ev.id);
      const target = door && door.reprise ? level.reprises.find((r) => r.id === door.reprise) : null;
      if (target) reprise = { type: 'reprise', reprise: target.id, cause: `choc:${door.id}`, x: target.x, y: target.y, heading: target.heading, cout: target.cout };
    }
  }

  // 4. Réussite : tous les colis obligatoires livrés (même en retard).
  if (level.colis.every((p) => !p.obligatoire || p.etat === 'livre')) {
    level.status = 'reussite';
    level.fin = { t: snap.t, tau: snap.tau };
    out.push({ type: 'reussite', t: snap.t, tau: snap.tau });
    return { events: out, status: level.status };
  }

  if (reprise) {
    level.reprisesFaites += 1;
    out.push(reprise);
  }

  // 5. Échecs (après les livraisons) : batterie vide.
  const tau = snap.tau + (reprise ? reprise.cout : 0);
  if (tau >= level.tauMax) {
    level.status = 'echec';
    level.raison = 'batterie';
    level.fin = { t: snap.t + (reprise ? reprise.cout : 0), tau };
    out.push({ type: 'echec', raison: 'batterie', t: level.fin.t, tau });
  }
  return { events: out, status: level.status };
}
