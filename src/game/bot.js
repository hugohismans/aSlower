/**
 * Pilote de référence (jalon 3) : suit un itinéraire avec la VRAIE physique (player.step et
 * collisions, via level.advance) et les vraies règles. Module pur : sert aux tests (un niveau
 * est faisable : parcours de référence = 3 étoiles, parcours naïf < 3) et au calibrage
 * (scripts/calibrate.mjs), pour plusieurs valeurs de c.
 *
 * Itinéraire (`parcours.reference` / `parcours.naif` du niveau, ou objet passé) :
 *   {etapes: [
 *     {aller: [x, y], beta: 0.4, arret?: false, rayon?},  point de passage ; beta : croisière
 *        (fraction de c) ; arret : s'y arrêter puis rester ARRET_PAUSE s à l'arrêt (le temps de
 *        livrer) ; rayon : tolérance d'arrivée (m ; défaut 1,5 m à l'arrêt, 4 m sinon)
 *     {attendre: s},          rester à l'arrêt s secondes de temps propre
 *     {attendreJusqua: t}]}   rester à l'arrêt jusqu'à l'heure de la ville t
 * Longueurs : mètres ou expressions en L (comme le niveau).
 *
 * Conduite : cap vers le point (volant proportionnel ; pivot sur place à l'arrêt), rapidité
 * visée = min(croisière, courbe de freinage vers la rapidité voulue au point), suivie
 * exactement (poussée ou frein dosés pour l'atteindre dans l'image). Avant un virage de plus
 * de 20°, la vitesse au point est limitée à un rayon de BOT_TURN_RADIUS m (échelle humaine :
 * |u| = rayon × TURN_RATE).
 */
import { C_DEFAULT, physicsFor, TURN_RATE } from '../physics/constants.js';
import { resolveSceneLengths } from '../render/layout.js';
import { advance, createLevel, createLevelPlayer } from './level.js';
import { DELIVERY_HOLD } from './rules.js';
import { computeScore } from './score.js';

/** Pas de simulation du bot (s de temps propre). */
export const BOT_DT = 1 / 60;
/** Rayon de virage visé aux carrefours (m). */
export const BOT_TURN_RADIUS = 6;
/** Pause à l'arrêt après une étape « arret » (s de τ) : de quoi livrer. */
export const ARRET_PAUSE = DELIVERY_HOLD + 0.15;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);

/**
 * Pilote : renvoie une commande par image.
 * @param {{etapes: any[]}} route itinéraire RÉSOLU (mètres)
 * @param {{c: number, a: number}} physics
 * @param {{dt?: number, turnRadius?: number}} [options]
 * @returns {{command(snap: any): {thrust: number, brake: number, steer: number},
 *            readonly done: boolean, readonly index: number}}
 */
export function createBotDriver(route, physics, { dt = BOT_DT, turnRadius = BOT_TURN_RADIUS } = {}) {
  const { c, a } = physics;
  const steps = route.etapes;
  let index = 0;
  /** État de l'étape courante. */
  let phase = { started: false, tau0: 0, stopped: false, stopTau: 0, from: [0, 0] };
  const next = () => {
    index += 1;
    phase = { started: false, tau0: 0, stopped: false, stopTau: 0, from: [0, 0] };
  };
  const turnPhi = Math.asinh((turnRadius * TURN_RATE) / c);
  /** Plafonds de rapidité aux points (anticipation : voir limitPhi), pour l'étape `limitsAt`. */
  const limits = new Map();
  let limitsAt = -1;

  /** Rapidité voulue en passant le point i (0 si arrêt) ; from : début du tronçon. */
  function waypointPhi(i, cruisePhi, from) {
    const s = steps[i];
    if (s.arret) return 0;
    const n = steps[i + 1];
    if (!n || !n.aller) return 0; // dernière étape ou attente : s'arrêter
    const prev = i > 0 && steps[i - 1].aller ? steps[i - 1].aller : from;
    // En ligne droite : la croisière la plus lente des deux étapes (ralentir AVANT le point).
    const through = Math.min(cruisePhi, Math.atanh(Math.min(n.beta, 0.995)));
    const a1 = Math.atan2(s.aller[1] - prev[1], s.aller[0] - prev[0]);
    const a2 = Math.atan2(n.aller[1] - s.aller[1], n.aller[0] - s.aller[0]);
    return Math.abs(wrap(a2 - a1)) > (20 * Math.PI) / 180 ? Math.min(through, turnPhi) : through;
  }

  /**
   * Rapidité permise en passant le point i, en anticipant les points suivants : au plus
   * waypointPhi(i), et pas plus que ce qui permet, au frein plein, de ralentir jusqu'au plafond
   * du point suivant (cosh φ_i ≤ cosh φ_{i+1} + a·d/c², d = longueur du tronçon). Sans cela, un
   * long tronçon rapide suivi d'un virage serré arrive trop vite au virage (un seul point
   * d'avance ne suffit pas). Calcul récursif vers l'aval ; une étape d'attente impose l'arrêt.
   */
  function limitPhi(i, cruisePhi, from) {
    if (limitsAt !== index) {
      limits.clear(); // le plafond du point courant dépend du début du tronçon (phase.from)
      limitsAt = index;
    }
    const key = i;
    if (limits.has(key)) return /** @type {number} */ (limits.get(key));
    let phi = waypointPhi(i, cruisePhi, from);
    const n = steps[i + 1];
    if (phi > 0 && n && n.aller && i + 1 < steps.length) {
      const d = Math.hypot(n.aller[0] - steps[i].aller[0], n.aller[1] - steps[i].aller[1]);
      const nextPhi = limitPhi(i + 1, Math.atanh(Math.min(n.beta, 0.995)), steps[i].aller);
      phi = Math.min(phi, Math.acosh(Math.cosh(nextPhi) + (a * d) / (c * c)));
    }
    limits.set(key, phi);
    return phi;
  }

  /** Poussée ou frein dosés pour atteindre la rapidité phiTarget dans l'image. */
  function speedCommand(phi, phiTarget) {
    const rate = (a * dt) / c; // variation de rapidité d'une image à fond
    if (phi > phiTarget + 1e-9) return { thrust: 0, brake: clamp((phi - phiTarget) / rate, 0, 1) };
    if (phi < phiTarget - 1e-9) return { thrust: clamp((phiTarget - phi) / rate, 0, 1), brake: 0 };
    return { thrust: 0, brake: 0 };
  }

  return {
    get done() {
      return index >= steps.length;
    },
    get index() {
      return index;
    },
    command(snap) {
      for (let guard = 0; guard < 4 && index < steps.length; guard++) {
        const s = steps[index];
        if (!phase.started) {
          phase.started = true;
          phase.tau0 = snap.tau;
          phase.from = [snap.x, snap.y];
        }
        const moving = snap.speed > 1e-6 * c;
        if (s.attendre !== undefined || s.attendreJusqua !== undefined) {
          if (moving) return { thrust: 0, ...speedCommand(snap.rapidity, 0), steer: 0 };
          const over = s.attendre !== undefined ? snap.tau - phase.tau0 >= s.attendre : snap.t >= s.attendreJusqua;
          if (over) {
            next();
            continue;
          }
          return { thrust: 0, brake: 0, steer: 0 };
        }
        // Étape « aller ».
        const [tx, ty] = s.aller;
        const dx = tx - snap.x;
        const dy = ty - snap.y;
        const d = Math.hypot(dx, dy);
        const radius = s.rayon ?? (s.arret ? 1.5 : 4);
        if (phase.stopped) {
          if (moving) return { thrust: 0, ...speedCommand(snap.rapidity, 0), steer: 0 };
          if (snap.tau - phase.stopTau >= ARRET_PAUSE) {
            next();
            continue;
          }
          return { thrust: 0, brake: 0, steer: 0 };
        }
        const stopHere = s.arret || !steps[index + 1] || !steps[index + 1].aller;
        if (d <= radius) {
          if (stopHere) {
            phase.stopped = true;
            phase.stopTau = snap.tau;
            continue;
          }
          next();
          continue;
        }
        // Point de passage dépassé (à grande vitesse, on peut le frôler à plus de `radius`) :
        // on est au-delà de la perpendiculaire au tronçon, assez près de lui.
        if (!stopHere) {
          const prev = index > 0 && steps[index - 1].aller ? steps[index - 1].aller : phase.from;
          const sx = tx - prev[0];
          const sy = ty - prev[1];
          if (dx * sx + dy * sy < 0 && d < Math.max(4 * radius, 0.25 * Math.hypot(sx, sy))) {
            next();
            continue;
          }
        }
        const err = wrap(Math.atan2(dy, dx) - snap.heading);
        // Volant : proportionnel à l'écart de cap, plus l'anticipation « poursuite pure » (courbure
        // 2·sin(écart)/d du cercle qui passe par le point, × |u|/TURN_RATE) : sans elle, le
        // volant est en retard dans les virages larges pris vite (tour de place).
        const u = Math.hypot(snap.ux ?? 0, snap.uy ?? 0);
        const pursuit = ((2 * Math.sin(err)) / Math.max(d, 1)) * (u / TURN_RATE);
        const steer = clamp(-2.5 * err - pursuit, -1, 1);
        if (!moving && Math.abs(err) > 0.12) return { thrust: 0, brake: 0, steer: Math.sign(-err) || 0 };
        const cruisePhi = Math.atanh(Math.min(s.beta, 0.995));
        const phiW = limitPhi(index, cruisePhi, phase.from);
        const allow = Math.acosh(Math.cosh(phiW) + (a * Math.max(d - 0.5 * radius, 0)) / (c * c));
        let phiTarget = Math.min(cruisePhi, allow);
        if (Math.abs(err) > 0.5) phiTarget = Math.min(phiTarget, turnPhi);
        // Jamais tout à fait nul loin du point : on y arrive.
        if (d > radius) phiTarget = Math.max(phiTarget, Math.min(cruisePhi, Math.asinh(0.5 / c)));
        return { ...speedCommand(snap.rapidity, phiTarget), steer };
      }
      // Itinéraire fini : on s'arrête et on attend.
      return { thrust: 0, ...speedCommand(snap.rapidity, 0), steer: 0 };
    },
  };
}

/**
 * Joue un niveau avec le pilote.
 * @param {any} json niveau « coursier-niveau/1 »
 * @param {{c?: number, palette: Record<string, any>, route?: 'reference' | 'naif' | {etapes: any[]},
 *          dt?: number, maxTau?: number, onFrame?: (info: any) => void}} options
 *   route : nom d'un itinéraire du niveau (parcours) ou itinéraire (non résolu) ;
 *   maxTau : arrêt de la simulation (défaut : batterie + 5 s)
 * @returns {{status: string, score: import('./score.js').Score, tau: number, t: number,
 *            events: any[], frames: number, level: import('./level.js').LevelState,
 *            player: import('../physics/player.js').PlayerState, finished: boolean}}
 */
export function runBot(json, { c = C_DEFAULT, palette, route = 'reference', dt = BOT_DT, maxTau, onFrame } = /** @type {any} */ ({})) {
  const physics = physicsFor(c);
  const level = createLevel(json, physics, palette);
  const player = createLevelPlayer(level);
  const resolved =
    typeof route === 'string'
      ? level.level.parcours?.[route]
      : resolveSceneLengths(route, physics.lengthUnit);
  if (!resolved) throw new Error(`Niveau ${json.id} : pas d'itinéraire « ${route} » dans parcours`);
  const driver = createBotDriver(resolved, physics, { dt });
  const limit = maxTau ?? level.tauMax + 5;
  const events = [];
  let frames = 0;
  let snap = advance(level, player, {}, 0).snapshot;
  while (level.status === 'enCours' && player.tau < limit && frames < 1e6) {
    const cmd = driver.command(snap);
    const out = advance(level, player, cmd, dt);
    snap = out.snapshot;
    for (const e of out.events) if (e.type !== 'attente') events.push(e);
    frames += 1;
    onFrame?.({ snap, cmd, events: out.events, level, step: driver.index });
  }
  return {
    status: level.status,
    score: computeScore(level),
    tau: player.tau,
    t: player.t,
    events,
    frames,
    level,
    player,
    finished: level.status !== 'enCours',
  };
}
