/**
 * DPR adaptatif (docs/conception.md §4, « Caméra, performances et robustesse ») : logique
 * pure, sans DOM ni three (testée dans tests/adaptiveDpr.test.js). main.js lui passe une
 * mesure par image de jeu et applique le DPR qu'elle renvoie (render/quality.js,
 * renderer.js).
 *
 * Recalé sur 60 i/s (rAF limité à 60 Hz sur l'iPhone de test) :
 * - BAISSE de 0,25 quand l'intervalle MOYEN entre images dépasse 18,5 ms sur les 90 dernières
 *   images (≈ 1,5 s), jusqu'au plancher (1, ou 0,75 en profil « lite ») ;
 * - REMONTÉE de 0,25 (jusqu'au DPR du profil) sur un autre critère, puisqu'à 60 Hz
 *   l'intervalle ne descend jamais sous 16,7 ms : pendant au moins 10 s, au moins 98 % des
 *   images à ≤ 17,5 ms ET un temps CPU (step + render) bas : 95 % des images à ≤ 8 ms ;
 * - après chaque changement, les fenêtres repartent de zéro (le nouveau DPR est jugé sur ses
 *   propres images) ; après une baisse, pas de remontée avant 30 s (pas d'oscillation entre
 *   deux paliers) ;
 * - les premières images après un départ ou une reprise (préchauffage, caches) ne comptent
 *   pas ; un intervalle est plafonné à 100 ms (un accroc isolé ne pèse pas plus de ≈ 1 ms sur
 *   la moyenne de 90 images, mais un appareil qui ne tient que 5 i/s baisse quand même).
 *   Les pauses ne produisent pas de mesures (main.js n'en passe qu'en jeu) et la boucle repart
 *   d'un intervalle nul au retour d'un onglet caché.
 *
 * Jamais avec `?bench` (mesure à DPR fixe) ni avec `?dpr=` (DPR imposé) : c'est à main.js
 * de ne pas créer le contrôleur dans ces cas.
 */

/** Pas d'un changement de DPR. */
export const DPR_STEP = 0.25;
/** Plancher du DPR (profil normal). */
export const DPR_FLOOR = 1;
/** Plancher du DPR en profil « lite ». */
export const DPR_FLOOR_LITE = 0.75;
/** Fenêtre de la baisse (images). */
export const DOWN_WINDOW_FRAMES = 90;
/** Intervalle moyen au-delà duquel on baisse (ms). */
export const DOWN_MEAN_MS = 18.5;
/** Durée d'observation avant une remontée (ms). */
export const UP_WINDOW_MS = 10000;
/** Une image « rapide » pour la remontée : intervalle ≤ 17,5 ms. */
export const UP_FRAME_MS = 17.5;
/** Part minimale d'images rapides pour remonter. */
export const UP_FAST_RATIO = 0.98;
/** Temps CPU « bas » (step + render) pour remonter (ms). */
export const UP_CPU_MS = 8;
/** Part minimale d'images au CPU bas pour remonter. */
export const UP_CPU_RATIO = 0.95;
/** Après une baisse, pas de remontée pendant cette durée (ms de jeu mesurées). */
export const RAISE_COOLDOWN_MS = 30000;
/** Images ignorées après un départ, une reprise ou un changement de DPR. */
export const WARMUP_FRAMES = 30;
/** Plafond d'un intervalle mesuré (ms). */
export const SAMPLE_CAP_MS = 100;

/** Palier au quart le plus proche (un plafond de pixels donne des DPR comme 1,83). */
const quarter = (x) => Math.round(x * 4) / 4;

/**
 * @param {{max: number, min?: number, initial?: number}} options
 *   max : DPR du profil (plafond de pixels compris) ; min : plancher (DPR_FLOOR, ou
 *   DPR_FLOOR_LITE en « lite ») ; ramené à max s'il le dépasse ; initial : DPR de départ
 *   (défaut : max)
 * @returns {{
 *   sample(frameMs: number, cpuMs?: number): number | null,
 *   reset(): void, setMax(max: number): number,
 *   readonly dpr: number, readonly max: number, readonly min: number,
 *   readonly changes: number
 * }}
 *   sample : une mesure par image (intervalle depuis l'image précédente et temps CPU, en ms) ;
 *   renvoie le nouveau DPR s'il change, sinon null ;
 *   reset : oublie les mesures (départ, reprise après une pause) sans changer le DPR ;
 *   setMax : nouveau plafond (redimensionnement) ; renvoie le DPR courant, ramené sous le plafond
 */
export function createAdaptiveDpr({ max, min = DPR_FLOOR, initial } = /** @type {any} */ ({})) {
  if (!(max > 0)) throw new RangeError(`DPR maximal invalide : ${max}`);
  let ceiling = max;
  let floor = Math.min(min, ceiling);
  let dpr = Math.min(ceiling, Math.max(floor, initial ?? ceiling));
  let changes = 0;

  // Fenêtre de la baisse : anneau des 90 derniers intervalles et leur somme.
  const ring = new Float64Array(DOWN_WINDOW_FRAMES);
  let ringHead = 0;
  let ringFilled = 0;
  let ringSum = 0;
  // Fenêtre de la remontée : durée cumulée, nombre d'images, images rapides, CPU bas.
  let upMs = 0;
  let upFrames = 0;
  let upFast = 0;
  let upCpuLow = 0;
  let warmup = WARMUP_FRAMES;
  let cooldownMs = 0;

  function clearWindows() {
    ringHead = 0;
    ringFilled = 0;
    ringSum = 0;
    upMs = 0;
    upFrames = 0;
    upFast = 0;
    upCpuLow = 0;
    warmup = WARMUP_FRAMES;
  }

  function change(next) {
    dpr = next;
    changes += 1;
    clearWindows();
    return dpr;
  }

  return {
    sample(rawFrameMs, cpuMs = 0) {
      if (!(rawFrameMs > 0)) return null;
      const frameMs = Math.min(rawFrameMs, SAMPLE_CAP_MS);
      if (warmup > 0) {
        warmup -= 1;
        return null;
      }
      if (cooldownMs > 0) cooldownMs = Math.max(0, cooldownMs - frameMs);

      // Baisse : moyenne glissante sur 90 images.
      if (ringFilled === DOWN_WINDOW_FRAMES) ringSum -= ring[ringHead];
      ring[ringHead] = frameMs;
      ringSum += frameMs;
      ringHead = (ringHead + 1) % DOWN_WINDOW_FRAMES;
      ringFilled = Math.min(ringFilled + 1, DOWN_WINDOW_FRAMES);
      if (ringFilled === DOWN_WINDOW_FRAMES && ringSum / DOWN_WINDOW_FRAMES > DOWN_MEAN_MS) {
        if (dpr - floor < 1e-9) {
          clearWindows(); // déjà au plancher : on observe une nouvelle fenêtre
          return null;
        }
        cooldownMs = RAISE_COOLDOWN_MS;
        return change(Math.max(floor, quarter(dpr - DPR_STEP)));
      }

      // Remontée : 10 s presque toutes rapides, CPU bas.
      if (ceiling - dpr < 1e-9) return null;
      upMs += frameMs;
      upFrames += 1;
      if (frameMs <= UP_FRAME_MS) upFast += 1;
      if (Number.isFinite(cpuMs) && cpuMs <= UP_CPU_MS) upCpuLow += 1;
      if (upMs < UP_WINDOW_MS) return null;
      const ok = upFast >= UP_FAST_RATIO * upFrames && upCpuLow >= UP_CPU_RATIO * upFrames && cooldownMs === 0;
      // Fenêtre suivante : on repart de zéro (fenêtres de 10 s consécutives).
      upMs = 0;
      upFrames = 0;
      upFast = 0;
      upCpuLow = 0;
      if (!ok) return null;
      return change(Math.min(ceiling, quarter(dpr + DPR_STEP)));
    },

    reset() {
      clearWindows();
    },

    setMax(next) {
      if (!(next > 0)) return dpr;
      const atCeiling = ceiling - dpr < 1e-9; // jamais baissé : suit le nouveau plafond
      ceiling = next;
      floor = Math.min(min, ceiling);
      if (atCeiling || dpr > ceiling) dpr = ceiling;
      if (dpr < floor) dpr = floor;
      return dpr;
    },

    get dpr() {
      return dpr;
    },
    get max() {
      return ceiling;
    },
    get min() {
      return floor;
    },
    /** Nombre de changements de DPR depuis la création (diagnostic). */
    get changes() {
      return changes;
    },
  };
}
