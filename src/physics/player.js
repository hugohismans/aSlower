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
 * Modèle « voiture arcade » (choix de l'auteur) :
 * - poussée et frein (|a| ≤ A = 10 m/s², en accélération propre) le long du cap ;
 * - la route fournit la force latérale, hors du budget du moteur : le virage fait tourner
 *   u et le cap à |u| constant, au taux dθ/dτ = −steer·TURN_RATE (steer > 0 : à droite) ;
 * - quand on roule, le cap suit la direction de u ; à l'arrêt, le volant fait pivoter le cap
 *   sur place à PIVOT_RATE, et la poussée part dans la direction du cap ;
 * - le frein (prioritaire sur la poussée) arrête exactement à v = 0, sans marche arrière ;
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
  SUBSTEP_MAX_DIST,
  SUBSTEP_MAX_DT,
  TURN_RATE,
} from './constants.js';
import { gammaFromU, hyperbolicSegment, rapidityFromU } from './relativity.js';

/**
 * @typedef {{x:number, y:number, ux:number, uy:number, hx:number, hy:number,
 *            tau:number, t:number, phiMax:number}} PlayerState
 * x, y : position (m) ; ux, uy : vitesse propre u = γv (m/s) ; hx, hy : cap unitaire ;
 * tau : temps propre (batterie, s) ; t : temps de la ville (s) ; phiMax : plafond de rapidité.
 */

/** @typedef {{thrust?: number, brake?: number, steer?: number}} DriveCommand */

/**
 * Crée l'état du joueur, à l'arrêt.
 * @param {{x?: number, y?: number, heading?: number, phiMax?: number}} [options]
 *   heading : cap en radians depuis +x vers +y (π/2 = nord).
 * @returns {PlayerState}
 */
export function createPlayer({ x = 0, y = 0, heading = Math.PI / 2, phiMax = PHI_MAX_DEFAULT } = {}) {
  if (!(phiMax > 0 && phiMax <= PHI_MAX_LIMIT)) {
    throw new RangeError(`phiMax doit être dans ]0 ; ${PHI_MAX_LIMIT}] (reçu : ${phiMax})`);
  }
  return { x, y, ux: 0, uy: 0, hx: Math.cos(heading), hy: Math.sin(heading), tau: 0, t: 0, phiMax };
}

/**
 * Durée maximale d'un sous-pas : au plus SUBSTEP_MAX_DT et au plus SUBSTEP_MAX_DIST
 * parcourus. On divise par une borne supérieure de |u| sur le sous-pas : la rapidité
 * croît au plus de A·h/c, sans dépasser le plafond.
 * @param {PlayerState} s
 * @param {number} phiCap
 */
function maxSubstep(s, phiCap) {
  const phi0 = rapidityFromU(s.ux, s.uy);
  const phiBound = Math.min(phi0 + (A * SUBSTEP_MAX_DT) / C, Math.max(phi0, phiCap));
  return Math.min(SUBSTEP_MAX_DT, SUBSTEP_MAX_DIST / (C * Math.sinh(phiBound)));
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
 * Ramène le cap à l'unité : direction de u si l'on roule, sinon simple renormalisation.
 * Sous REST_EPSILON, la vitesse est remise exactement à zéro (résidu d'arrondi).
 * @param {PlayerState} s
 */
function settleHeading(s) {
  const U = Math.hypot(s.ux, s.uy);
  if (U > REST_EPSILON) {
    s.hx = s.ux / U;
    s.hy = s.uy / U;
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
 */
function movingPiece(s, accel, omega, h) {
  const half = 0.5 * omega * h;
  const cos = Math.cos(half);
  const sin = Math.sin(half);
  if (half !== 0) rotateVelocityAndHeading(s, cos, sin);
  const seg = hyperbolicSegment(s.ux, s.uy, accel * s.hx, accel * s.hy, h);
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
 * Remet la rapidité exactement à φ le long du cap (fin d'une poussée plafonnée).
 * @param {PlayerState} s
 * @param {number} phi
 */
function setRapidity(s, phi) {
  const U = C * Math.sinh(phi);
  s.ux = U * s.hx;
  s.uy = U * s.hy;
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
 */
function substep(s, thrust, brake, steer, h, phiCap) {
  const atRest = Math.hypot(s.ux, s.uy) <= REST_EPSILON;
  const omega = -steer * TURN_RATE;

  if (brake > 0) {
    if (atRest) {
      restPiece(s, steer, h);
      return;
    }
    // Temps propre d'arrêt : la rapidité baisse au taux brake·A/c.
    const decel = brake * A;
    const tauStop = (rapidityFromU(s.ux, s.uy) * C) / decel;
    if (tauStop >= h) {
      movingPiece(s, -decel, omega, h);
      return;
    }
    movingPiece(s, -decel, omega, tauStop);
    restPiece(s, steer, h - tauStop); // arrêt exact (u = 0), le reste du sous-pas à l'arrêt
    return;
  }

  if (thrust > 0) {
    // À l'arrêt, la poussée part dans la direction du cap (u = 0, le cap est conservé).
    const accel = thrust * A;
    const tauCap = ((phiCap - rapidityFromU(s.ux, s.uy)) * C) / accel;
    if (tauCap >= h) {
      movingPiece(s, accel, omega, h);
      return;
    }
    if (tauCap > 0) {
      movingPiece(s, accel, omega, tauCap);
      setRapidity(s, phiCap);
    }
    // Plafond atteint : roue libre pour le reste du sous-pas.
    movingPiece(s, 0, omega, h - Math.max(tauCap, 0));
    return;
  }

  // Ni poussée ni frein : roue libre, ou pivot si l'on est à l'arrêt.
  if (atRest) restPiece(s, steer, h);
  else movingPiece(s, 0, omega, h);
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

  // Plafond abaissé en cours de route : la rapidité est ramenée tout de suite au plafond.
  if (rapidityFromU(state.ux, state.uy) > phiCap) {
    settleHeading(state);
    setRapidity(state, phiCap);
  }

  let remaining = dtau;
  while (remaining > 0) {
    const h = Math.min(remaining, maxSubstep(state, phiCap));
    substep(state, thrust, brake, steer, h, phiCap);
    remaining -= h;
  }
  return state;
}

/**
 * Grandeurs dérivées de l'état, pour le rendu, le HUD et les règles.
 * @param {PlayerState} state
 * @returns {{x: number, y: number, vx: number, vy: number, speed: number, beta: number,
 *            gamma: number, rapidity: number, tau: number, t: number, ux: number,
 *            uy: number, heading: number, hx: number, hy: number}}
 */
export function snapshot(state) {
  const { x, y, ux, uy, hx, hy, tau, t } = state;
  const gamma = gammaFromU(ux, uy);
  const speed = Math.hypot(ux, uy) / gamma;
  return {
    x,
    y,
    vx: ux / gamma,
    vy: uy / gamma,
    speed,
    beta: speed / C,
    gamma,
    rapidity: rapidityFromU(ux, uy),
    tau,
    t,
    ux,
    uy,
    heading: Math.atan2(hy, hx),
    hx,
    hy,
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
