/**
 * Étoiles d'une partie (jalon 3) : module pur.
 *
 * étoiles = 0 en cas d'échec ; sinon 1 + [batterie restante ≥ batterieMin]
 *                                       + [t_fin ≤ tVilleMax ET aucun colis livré en retard]
 * - ★ Livré : réussite (tous les colis obligatoires livrés, même en retard : décision 6) ;
 * - ★ Économe : batterie restante (τmax − τ_fin)/τmax ≥ batterieMin ;
 * - ★ Ponctuel : t_fin ≤ tVilleMax et chaque colis livré avant son délai (heure de la ville).
 * τ_fin et t_fin : horloges à la réussite (dernière livraison obligatoire). Le bilan dit
 * quelle étoile manque, chiffres à l'appui. Les aides ne coûtent jamais d'étoile.
 */
import { formatNumberFr } from './bubbles.js';

/**
 * @typedef {object} Score
 * @property {number} etoiles 0 à 3
 * @property {boolean} reussite
 * @property {string | null} raison raison de l'échec ('batterie'…), null sinon
 * @property {{ok: boolean, batterieRestante: number, seuil: number, tauFin: number, tauMax: number}} econome
 * @property {{ok: boolean, tFin: number, seuil: number, retards: {colis: string, client: string,
 *            t: number, delai: number}[]}} ponctuel
 * @property {('econome' | 'ponctuel')[]} manque étoiles manquées (après une réussite)
 * @property {string[]} messages bilan en français (une ligne par étoile manquée, ou l'échec)
 */

/**
 * Étoiles à partir de résultats bruts (utilisé par computeScore et le calibrage).
 * @param {{reussite: boolean, raison?: string | null, tauFin: number, tFin: number,
 *          retards?: {colis: string, client: string, t: number, delai: number}[]}} result
 * @param {{tauMax: number, etoiles: {batterieMin: number, tVilleMax: number}}} rules
 * @returns {Score}
 */
export function scoreResult(result, { tauMax, etoiles }) {
  const retards = result.retards ?? [];
  const batterieRestante = Math.max(0, (tauMax - result.tauFin) / tauMax);
  const econome = {
    ok: result.reussite && batterieRestante >= etoiles.batterieMin - 1e-12,
    batterieRestante,
    seuil: etoiles.batterieMin,
    tauFin: result.tauFin,
    tauMax,
  };
  const ponctuel = {
    ok: result.reussite && result.tFin <= etoiles.tVilleMax + 1e-12 && retards.length === 0,
    tFin: result.tFin,
    seuil: etoiles.tVilleMax,
    retards,
  };
  /** @type {Score['manque']} */
  const manque = [];
  const messages = [];
  if (!result.reussite) {
    if (result.raison === 'batterie') {
      messages.push(`Batterie vide ! Tu as vécu ${formatNumberFr(result.tauFin)} s, la ville ${formatNumberFr(result.tFin)} s.`);
    } else {
      messages.push('Livraison manquée.');
    }
    return { etoiles: 0, reussite: false, raison: result.raison ?? null, econome, ponctuel, manque, messages };
  }
  if (!econome.ok) {
    manque.push('econome');
    messages.push(
      `Batterie restante ${Math.floor(batterieRestante * 100)} % (objectif ≥ ${Math.round(etoiles.batterieMin * 100)} %).`,
    );
  }
  if (!ponctuel.ok) {
    manque.push('ponctuel');
    for (const r of retards) {
      messages.push(`${r.client} livré à t = ${formatNumberFr(r.t)} s : délai de ${formatNumberFr(r.delai, 0)} s dépassé.`);
    }
    if (result.tFin > etoiles.tVilleMax) {
      messages.push(`Fini à t = ${formatNumberFr(result.tFin)} s à l'horloge de la ville (objectif ≤ ${formatNumberFr(etoiles.tVilleMax, 0)} s).`);
    }
  }
  const etoilesCount = 1 + (econome.ok ? 1 : 0) + (ponctuel.ok ? 1 : 0);
  return { etoiles: etoilesCount, reussite: true, raison: null, econome, ponctuel, manque, messages };
}

/**
 * Étoiles d'une partie terminée (ou en cours : 0 étoile tant qu'elle n'a pas réussi).
 * @param {import('./level.js').LevelState} level
 * @returns {Score}
 */
export function computeScore(level) {
  const fin = level.fin ?? { t: level.t, tau: level.tau };
  const retards = level.colis
    .filter((p) => p.etat === 'livre' && p.enRetard)
    .map((p) => ({ colis: p.id, client: p.client, t: p.livreA.t, delai: p.delai }));
  return scoreResult(
    { reussite: level.status === 'reussite', raison: level.raison, tauFin: fin.tau, tFin: fin.t, retards },
    { tauMax: level.tauMax, etoiles: level.etoiles },
  );
}
