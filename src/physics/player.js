/*! Inspiré d'OpenRelativity (MIT Game Lab) — https://github.com/MITGameLab/OpenRelativity @35b806a1, GameState.cs:220-246 ; MovementScripts.cs:114-183 — Copyright (c) 2013 Massachusetts Institute of Technology — SPDX-License-Identifier: MIT — voir THIRD_PARTY_NOTICES.md — Modifications (c) 2026 Hugo Hismans */
/**
 * Véhicule du joueur (module pur : ni DOM, ni three).
 *
 * Idée reprise d'OpenRelativity : l'entrée ajoute une petite vitesse dans le référentiel
 * instantané du joueur, composée relativistement à la vitesse courante
 * (MovementScripts.cs:114-183), et le temps de la ville avance de Δτ·γ
 * (GameState.cs:220-246). Ici, sous forme exacte : état en vitesse propre u = γv,
 * segments hyperboliques (voir `hyperbolicSegment`) : exact et indépendant du découpage en
 * ligne droite et en virage pur, d'ordre 2 en virage avec poussée (voir plus bas).
 *
 * Constantes physiques : c et a sont ceux de la partie (réglage du joueur, physicsFor),
 * injectés à la création (`createPlayer({physics: {c, a}})`) et gardés dans l'état ; par
 * défaut, ceux du réglage par défaut (C = 30 m/s, A = 6 m/s²).
 *
 * Modèle « voiture arcade » (choix de l'auteur) :
 * - poussée et frein (|accélération propre| ≤ a) le long du cap ;
 * - la route fournit la force latérale, hors du budget du moteur : le virage fait tourner
 *   u et le cap à |u| constant, au taux dθ/dτ = −steer·TURN_RATE (steer > 0 : à droite) ;
 * - quand on roule, le cap suit la direction de u ; à l'arrêt, le volant fait pivoter le cap
 *   sur place à PIVOT_RATE, et la poussée part dans la direction du cap ;
 * - le frein (prioritaire sur la poussée) arrête exactement à v = 0 ;
 * - marche arrière lente (option `reverse` de createPlayer, jalon 3) : frein maintenu à
 *   l'arrêt pendant REVERSE_DELAY s de temps propre → recul le long de −cap, accélération
 *   propre brake·a, plafonné à REVERSE_MAX_BETA·c ; le cap reste celui du véhicule (u et le
 *   cap sont alors opposés), le volant est inversé comme en voiture (à droite : l'arrière
 *   part à droite, θ augmente) ; la poussée freine le recul (arrêt exact) puis repart en
 *   avant ; relâcher : roue libre en arrière. Sans l'option (défaut, jalon 1), le frein
 *   maintenu à l'arrêt laisse le véhicule immobile ;
 * - la rapidité ne dépasse jamais state.phiMax (ni PHI_MAX_LIMIT).
 *
 * Intégration d'un sous-pas h (schéma de Strang) : demi-rotation, segment hyperbolique
 * exact le long du cap, demi-rotation. Le déplacement du segment est multiplié par le
 * facteur de corde sin(Δθ/2)/(Δθ/2) : le pas est alors exact en ligne droite et en virage
 * pur (arc de cercle), et d'ordre 2 quand on pousse en tournant. Le temps propre, le temps
 * de la ville et |u| ne dépendent que du profil de rapidité : ils sont exacts dans tous les
 * cas. La précession de Thomas-Wigner n'est pas simulée (aucune orientation propre suivie).
 */
import {
  A,
  C,
  MAX_FRAME_DT,
  PHI_MAX_DEFAULT,
  PHI_MAX_LIMIT,
  PIVOT_RATE,
  REST_EPSILON,
  REVERSE_DELAY,
  REVERSE_MAX_BETA,
  SUBSTEP_MAX_DIST,
  SUBSTEP_MAX_DT,
  TURN_RATE,
} from './constants.js';
import { gammaFromU, hyperbolicSegment, rapidityFromU } from './relativity.js';

/**
 * @typedef {{x:number, y:number, ux:number, uy:number, hx:number, hy:number,
 *            tau:number, t:number, phiMax:number, c:number, a:number,
 *            reverse?: boolean, brakeHold?: number}} PlayerState
 * x, y : position (m) ; ux, uy : vitesse propre u = γv (m/s) ; hx, hy : cap unitaire ;
 * tau : temps propre (batterie, s) ; t : temps de la ville (s) ; phiMax : plafond de rapidité ;
 * c : vitesse de la lumière (m/s) et a : accélération propre maximale (m/s²) de la partie ;
 * reverse : marche arrière permise ; brakeHold : temps propre passé à l'arrêt frein maintenu (s).
 * En marche arrière, u est opposée au cap (u·h < 0).
 */

/** @typedef {{thrust?: number, brake?: number, steer?: number}} DriveCommand */

/** Constantes physiques par défaut (réglage par défaut). */
const DEFAULT_DRIVE_PHYSICS = Object.freeze({ c: C, a: A });

/**
 * Crée l'état du joueur, à l'arrêt.
 * @param {{x?: number, y?: number, heading?: number, phiMax?: number,
 *          physics?: {c: number, a: number}, reverse?: boolean}} [options]
 *   heading : cap en radians depuis +x vers +y (π/2 = nord) ; physics : constantes de la
 *   partie (`physicsFor(c)` convient ; défaut : c = C, a = A) ; reverse : marche arrière lente
 *   (frein maintenu à l'arrêt ; défaut false, comportement du jalon 1).
 * @returns {PlayerState}
 */
export function createPlayer({
  x = 0,
  y = 0,
  heading = Math.PI / 2,
  phiMax = PHI_MAX_DEFAULT,
  physics = DEFAULT_DRIVE_PHYSICS,
  reverse = false,
} = {}) {
  if (!(phiMax > 0 && phiMax <= PHI_MAX_LIMIT)) {
    throw new RangeError(`phiMax doit être dans ]0 ; ${PHI_MAX_LIMIT}] (reçu : ${phiMax})`);
  }
  const { c, a } = physics ?? DEFAULT_DRIVE_PHYSICS;
  if (!(c > 0 && Number.isFinite(c) && a > 0 && Number.isFinite(a))) {
    throw new RangeError(`physics : c et a positifs et finis attendus (reçu : c = ${c}, a = ${a})`);
  }
  return {
    x,
    y,
    ux: 0,
    uy: 0,
    hx: Math.cos(heading),
    hy: Math.sin(heading),
    tau: 0,
    t: 0,
    phiMax,
    c,
    a,
    reverse: Boolean(reverse),
    brakeHold: 0,
  };
}

/** Rapidité du plafond de la marche arrière : atanh(REVERSE_MAX_BETA). */
export const REVERSE_MAX_RAPIDITY = Math.atanh(REVERSE_MAX_BETA);

/**
 * Durée maximale d'un sous-pas : au plus SUBSTEP_MAX_DT et au plus SUBSTEP_MAX_DIST
 * parcourus. On divise par une borne supérieure de |u| sur le sous-pas : la rapidité
 * croît au plus de a·h/c, sans dépasser le plafond.
 * @param {PlayerState} s
 * @param {number} phiCap
 * @param {number} c
 * @param {number} a
 */
function maxSubstep(s, phiCap, c, a) {
  const phi0 = rapidityFromU(s.ux, s.uy, c);
  const phiBound = Math.min(phi0 + (a * SUBSTEP_MAX_DT) / c, Math.max(phi0, phiCap));
  return Math.min(SUBSTEP_MAX_DT, SUBSTEP_MAX_DIST / (c * Math.sinh(phiBound)));
}

/**
 * Tourne la vitesse propre et le cap de l'angle dont (cos, sin) sont donnés.
 * @param {PlayerState} s
 * @param {number} cos
 * @param {number} sin
 */
function rotateVelocityAndHeading(s, cos, sin) {
  const ux = s.ux;
  s.ux = cos * ux - sin * s.uy;
  s.uy = sin * ux + cos * s.uy;
  const hx = s.hx;
  s.hx = cos * hx - sin * s.hy;
  s.hy = sin * hx + cos * s.hy;
}

/**
 * Ramène le cap à l'unité : direction de u si l'on roule (direction opposée en marche
 * arrière, u·h < 0), sinon simple renormalisation.
 * Sous REST_EPSILON, la vitesse est remise exactement à zéro (résidu d'arrondi).
 * @param {PlayerState} s
 */
function settleHeading(s) {
  const U = Math.hypot(s.ux, s.uy);
  if (U > REST_EPSILON) {
    const sign = s.ux * s.hx + s.uy * s.hy < 0 ? -1 : 1;
    s.hx = (sign * s.ux) / U;
    s.hy = (sign * s.uy) / U;
    return;
  }
  s.ux = 0;
  s.uy = 0;
  const n = Math.hypot(s.hx, s.hy);
  s.hx /= n;
  s.hy /= n;
}

/**
 * Morceau « en mouvement » de durée h : demi-rotation, segment hyperbolique exact sous la
 * poussée propre `accel` (m/s², > 0 en avant, < 0 au frein) le long du cap, demi-rotation.
 * @param {PlayerState} s
 * @param {number} accel
 * @param {number} omega taux de virage dθ/dτ (rad/s)
 * @param {number} h
 * @param {number} c
 */
function movingPiece(s, accel, omega, h, c) {
  const half = 0.5 * omega * h;
  const cos = Math.cos(half);
  const sin = Math.sin(half);
  if (half !== 0) rotateVelocityAndHeading(s, cos, sin);
  const seg = hyperbolicSegment(s.ux, s.uy, accel * s.hx, accel * s.hy, h, c);
  // Facteur de corde : exact pour un arc de cercle à |u| constant (virage pur).
  const chord = half !== 0 ? sin / half : 1;
  s.x += chord * seg.dx;
  s.y += chord * seg.dy;
  s.t += seg.dt;
  s.tau += h;
  s.ux = seg.ux;
  s.uy = seg.uy;
  if (half !== 0) rotateVelocityAndHeading(s, cos, sin);
  settleHeading(s);
}

/**
 * Morceau « à l'arrêt » de durée h : le temps de la ville avance comme le temps propre
 * (Δt = h) et le volant fait pivoter le cap sur place.
 * @param {PlayerState} s
 * @param {number} steer
 * @param {number} h
 */
function restPiece(s, steer, h) {
  s.ux = 0;
  s.uy = 0;
  s.t += h;
  s.tau += h;
  if (steer !== 0) {
    const angle = -steer * PIVOT_RATE * h;
    rotateVelocityAndHeading(s, Math.cos(angle), Math.sin(angle));
  }
  settleHeading(s);
}

/**
 * Remet la rapidité exactement à φ le long du cap (fin d'une poussée plafonnée) ; en marche
 * arrière (sign = −1), le long de −cap.
 * @param {PlayerState} s
 * @param {number} phi
 * @param {number} c
 * @param {number} [sign]
 */
function setRapidity(s, phi, c, sign = 1) {
  const U = sign * c * Math.sinh(phi);
  s.ux = U * s.hx;
  s.uy = U * s.hy;
}

/**
 * Sous-pas en marche arrière (u opposée au cap) ou départ en arrière depuis l'arrêt.
 * Volant inversé (dθ/dτ = +steer·TURN_RATE) ; frein : recul accéléré (brake·a) jusqu'à
 * REVERSE_MAX_RAPIDITY ; poussée seule : freine le recul, arrêt exact, puis le reste du
 * sous-pas repart en avant ; ni l'un ni l'autre : roue libre en arrière.
 * @param {PlayerState} s
 * @param {number} thrust
 * @param {number} brake
 * @param {number} steer
 * @param {number} h
 * @param {number} phiCap
 * @param {number} c
 * @param {number} a
 */
function reverseSubstep(s, thrust, brake, steer, h, phiCap, c, a) {
  const omega = steer * TURN_RATE;
  const phi = rapidityFromU(s.ux, s.uy, c);
  if (brake > 0) {
    const accel = brake * a;
    const tauCap = ((REVERSE_MAX_RAPIDITY - phi) * c) / accel;
    if (tauCap >= h) {
      movingPiece(s, -accel, omega, h, c);
      return;
    }
    if (tauCap > 0) {
      movingPiece(s, -accel, omega, tauCap, c);
      setRapidity(s, REVERSE_MAX_RAPIDITY, c, -1);
    }
    movingPiece(s, 0, omega, h - Math.max(tauCap, 0), c);
    return;
  }
  if (thrust > 0) {
    const accel = thrust * a;
    const tauStop = (phi * c) / accel;
    if (tauStop >= h) {
      movingPiece(s, accel, omega, h, c);
      return;
    }
    movingPiece(s, accel, omega, tauStop, c);
    s.ux = 0; // arrêt exact, puis départ en avant pour le reste du sous-pas
    s.uy = 0;
    substep(s, thrust, 0, steer, h - tauStop, phiCap, c, a);
    return;
  }
  movingPiece(s, 0, omega, h, c);
}

/**
 * Un sous-pas de durée h (déjà borné par `maxSubstep`), découpé si le frein arrête le
 * véhicule ou si la poussée atteint le plafond pendant le sous-pas.
 * @param {PlayerState} s
 * @param {number} thrust 0..1
 * @param {number} brake 0..1
 * @param {number} steer −1..1
 * @param {number} h
 * @param {number} phiCap
 * @param {number} c
 * @param {number} a
 */
function substep(s, thrust, brake, steer, h, phiCap, c, a) {
  const atRest = Math.hypot(s.ux, s.uy) <= REST_EPSILON;
  const omega = -steer * TURN_RATE;
  if (!(brake > 0) || !atRest) s.brakeHold = 0;

  if (!atRest && s.ux * s.hx + s.uy * s.hy < 0) {
    reverseSubstep(s, thrust, brake, steer, h, phiCap, c, a);
    return;
  }

  if (brake > 0) {
    if (atRest) {
      if (!s.reverse) {
        restPiece(s, steer, h);
        return;
      }
      // Marche arrière : après REVERSE_DELAY s de frein maintenu à l'arrêt.
      const wait = REVERSE_DELAY - (s.brakeHold ?? 0);
      if (wait >= h) {
        s.brakeHold = (s.brakeHold ?? 0) + h;
        restPiece(s, steer, h);
        return;
      }
      if (wait > 0) restPiece(s, steer, wait);
      s.brakeHold = REVERSE_DELAY;
      reverseSubstep(s, thrust, brake, steer, h - Math.max(wait, 0), phiCap, c, a);
      return;
    }
    // Temps propre d'arrêt : la rapidité baisse au taux brake·a/c.
    const decel = brake * a;
    const tauStop = (rapidityFromU(s.ux, s.uy, c) * c) / decel;
    if (tauStop >= h) {
      movingPiece(s, -decel, omega, h, c);
      return;
    }
    movingPiece(s, -decel, omega, tauStop, c);
    restPiece(s, steer, h - tauStop); // arrêt exact (u = 0), le reste du sous-pas à l'arrêt
    s.brakeHold = h - tauStop; // le délai de la marche arrière part de l'arrêt
    return;
  }

  if (thrust > 0) {
    // À l'arrêt, la poussée part dans la direction du cap (u = 0, le cap est conservé).
    const accel = thrust * a;
    const tauCap = ((phiCap - rapidityFromU(s.ux, s.uy, c)) * c) / accel;
    if (tauCap >= h) {
      movingPiece(s, accel, omega, h, c);
      return;
    }
    if (tauCap > 0) {
      movingPiece(s, accel, omega, tauCap, c);
      setRapidity(s, phiCap, c);
    }
    // Plafond atteint : roue libre pour le reste du sous-pas.
    movingPiece(s, 0, omega, h - Math.max(tauCap, 0), c);
    return;
  }

  // Ni poussée ni frein : roue libre, ou pivot si l'on est à l'arrêt.
  if (atRest) restPiece(s, steer, h);
  else movingPiece(s, 0, omega, h, c);
}

/**
 * Borne x dans [lo, hi] ; une valeur absente ou invalide (NaN) vaut 0.
 * @param {number | undefined} x
 * @param {number} lo
 * @param {number} hi
 */
function clampInput(x, lo, hi) {
  if (typeof x !== 'number' || Number.isNaN(x)) return 0;
  return Math.min(Math.max(x, lo), hi);
}

/**
 * Avance le joueur de dtau secondes de temps propre (modifie et renvoie state).
 * Pas de plafond sur dtau : la durée est découpée en sous-pas internes ≤ SUBSTEP_MAX_DT et
 * ≤ SUBSTEP_MAX_DIST parcourus (le coût croît donc avec la distance parcourue).
 * @param {PlayerState} state
 * @param {DriveCommand} cmd thrust 0..1, brake 0..1 (prioritaire), steer −1..1 ; absent = 0
 * @param {number} dtau ≥ 0
 * @returns {PlayerState}
 */
export function step(state, cmd, dtau) {
  if (!(dtau >= 0 && Number.isFinite(dtau))) {
    throw new RangeError(`step : dtau doit être un nombre fini ≥ 0 (reçu : ${dtau})`);
  }
  const thrust = clampInput(cmd?.thrust, 0, 1);
  const brake = clampInput(cmd?.brake, 0, 1);
  const steer = clampInput(cmd?.steer, -1, 1);
  const phiCap = Math.min(state.phiMax, PHI_MAX_LIMIT);
  const c = state.c ?? C; // état créé sans constantes (ancien format) : réglage par défaut
  const a = state.a ?? A;

  // Plafond abaissé en cours de route : la rapidité est ramenée tout de suite au plafond.
  if (rapidityFromU(state.ux, state.uy, c) > phiCap) {
    settleHeading(state);
    setRapidity(state, phiCap, c);
  }

  let remaining = dtau;
  while (remaining > 0) {
    const h = Math.min(remaining, maxSubstep(state, phiCap, c, a));
    substep(state, thrust, brake, steer, h, phiCap, c, a);
    remaining -= h;
  }
  return state;
}

/**
 * Grandeurs dérivées de l'état, pour le rendu, le HUD et les règles.
 * c : vitesse de la lumière de la partie (m/s), pour le HUD (jauge, décimales près de c).
 * @param {PlayerState} state
 * @returns {{x: number, y: number, vx: number, vy: number, speed: number, beta: number,
 *            gamma: number, rapidity: number, tau: number, t: number, ux: number,
 *            uy: number, heading: number, hx: number, hy: number, c: number,
 *            reversing: boolean}}
 *   reversing : marche arrière (u opposée au cap ; heading reste le cap du véhicule).
 */
export function snapshot(state) {
  const { x, y, ux, uy, hx, hy, tau, t } = state;
  const c = state.c ?? C;
  const gamma = gammaFromU(ux, uy, c);
  const speed = Math.hypot(ux, uy) / gamma;
  return {
    x,
    y,
    vx: ux / gamma,
    vy: uy / gamma,
    speed,
    beta: speed / c,
    gamma,
    rapidity: rapidityFromU(ux, uy, c),
    tau,
    t,
    ux,
    uy,
    heading: Math.atan2(hy, hx),
    hx,
    hy,
    c,
    reversing: ux * hx + uy * hy < 0,
  };
}

/**
 * Temps propre à simuler pour une image : la durée réelle écoulée, bornée à
 * [0 ; MAX_FRAME_DT] (on ne simule pas un joueur absent). Valeur invalide → 0.
 * @param {number} dtReal secondes
 */
export function clampFrameDt(dtReal) {
  if (!(dtReal > 0)) return 0;
  return Math.min(dtReal, MAX_FRAME_DT);
}
