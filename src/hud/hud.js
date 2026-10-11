/**
 * HUD en HTML/CSS par-dessus le canvas (styles : src/hud/hud.css).
 *
 * - Deux horloges côte à côte : « Ta montre » (τ, la batterie) et « Horloge de la
 *   ville » (t, les délais), avec la pastille d'écart t − τ : rouge pleine avec ▲
 *   quand γ > 1,02 (l'écart se creuse), grise sous 1,01.
 * - Phrase γ en langage simple (« La ville va ×4 plus vite que toi »).
 * - Jauge de vitesse linéaire avec un mur hachuré à c (vitesse de la lumière de la partie,
 *   réglage du joueur, lue dans snapshot.c) : à poussée constante, l'aiguille ralentit en
 *   approchant du mur (l'asymptote). Sous la jauge, le rappel « c = 30 m/s ».
 *
 * Performances : textes rafraîchis à 12 Hz et écrits seulement s'ils changent ;
 * jauge déplacée par `transform` (composition seule) ; AUCUNE lecture de mise en
 * page (getBoundingClientRect, offsetWidth…) dans la boucle.
 */
import { C_DEFAULT, PHI_MAX_DEFAULT } from '../physics/constants.js';
import {
  createGammaPhrase,
  formatClock,
  formatGap,
  formatLightSpeed,
  formatSpeed,
  gapState,
  gaugeFraction,
} from './format.js';

/** Période de rafraîchissement des textes (ms) : 12 Hz. */
const TEXT_PERIOD_MS = 1000 / 12;

/** Plus petit déplacement de l'aiguille qui vaut une écriture de style (fraction de la jauge). */
const GAUGE_EPSILON = 0.0005;

/** Graduations de la jauge (% de c : 50, 90 et 99 %, soit 15, 27 et 29,7 m/s à c = 30), avant le mur. */
const GAUGE_TICKS = [50, 90, 99];

/** Balisage du HUD, injecté une fois dans le conteneur. */
const TEMPLATE = `
  <div class="hud-top">
    <section class="hud-panel hud-clocks" aria-label="Horloges">
      <div class="hud-clock">
        <span class="hud-label">Ta montre</span>
        <span class="hud-value" role="timer" data-ref="tau">0:00,0</span>
      </div>
      <span class="hud-gap" data-ref="gap" data-state="zero">+0,0\u202fs</span>
      <div class="hud-clock">
        <span class="hud-label">Horloge de la ville</span>
        <span class="hud-value" role="timer" data-ref="t">0:00,0</span>
      </div>
      <p class="hud-gamma" data-ref="gamma">Toi et la ville, même rythme</p>
    </section>
    <section class="hud-panel hud-speed" aria-label="Vitesse">
      <div class="hud-speed-head">
        <span class="hud-label">Vitesse</span>
        <span class="hud-speed-value" data-ref="speed">0\u202fm/s</span>
      </div>
      <div class="gauge" aria-hidden="true">
        <div class="gauge-track">
          <div class="gauge-bar">
            <div class="gauge-fill"></div>
            <div class="gauge-cover" data-ref="cover"></div>
            ${GAUGE_TICKS.map((v) => `<i class="gauge-tick" style="left:${v}%"></i>`).join('')}
          </div>
          <div class="gauge-rail" data-ref="needle"><i class="gauge-needle"></i></div>
        </div>
        <div class="gauge-wall"><span>c</span></div>
      </div>
      <p class="hud-c" data-ref="c">c\u202f=\u202f30\u202fm/s</p>
    </section>
  </div>
  <div class="hud-badge" data-ref="classic" hidden>Vision classique</div>
  <div class="hud-fps" data-ref="fps" hidden></div>
`;

/**
 * @param {HTMLElement} rootElement conteneur du HUD (#hud de index.html)
 * @param {{phiMax?: number}} [options] plafond de rapidité du joueur (décimales de la
 *   vitesse) ; `snapshot.phiMax`, s'il est fourni, l'emporte. La vitesse de la lumière est
 *   lue à chaque image dans `snapshot.c` (celle de la partie).
 * @returns {{update(snapshot: object, extra?: {k?: number, fps?: number}): void,
 *            show(): void, hide(): void}}
 */
export function createHud(rootElement, { phiMax = PHI_MAX_DEFAULT } = {}) {
  rootElement.classList.add('hud');
  rootElement.innerHTML = TEMPLATE;

  const ref = (name) => /** @type {HTMLElement} */ (rootElement.querySelector(`[data-ref="${name}"]`));
  const el = {
    tau: ref('tau'),
    t: ref('t'),
    gap: ref('gap'),
    gamma: ref('gamma'),
    speed: ref('speed'),
    cover: ref('cover'),
    needle: ref('needle'),
    classic: ref('classic'),
    fps: ref('fps'),
    c: ref('c'),
  };

  /** Dernier texte écrit par élément : on n'écrit que ce qui change. */
  const lastText = new Map();
  function writeText(name, text) {
    if (lastText.get(name) === text) return;
    lastText.set(name, text);
    el[name].textContent = text;
  }

  const phrase = createGammaPhrase();
  let lastTextTime = -Infinity;
  let lastGauge = -1;
  let gapStateNow = 'zero';
  let classicShown = false;
  let fpsShown = false;

  return {
    /**
     * @param {{speed: number, gamma: number, tau: number, t: number, c: number, phiMax?: number}} snapshot
     *   instantané du joueur (physics/player.js → snapshot ; c : vitesse de la lumière)
     * @param {{k?: number, fps?: number}} [extra] k ∈ [0, 1] (1 = effets relativistes,
     *   0 = vision classique) ; fps affiché seulement s'il est fourni
     */
    update(snapshot, { k = 1, fps } = {}) {
      // Jauge : à chaque image, par transform (le cache et l'aiguille glissent de f × largeur).
      const c = snapshot.c > 0 ? snapshot.c : C_DEFAULT;
      const f = gaugeFraction(snapshot.speed, c);
      if (Math.abs(f - lastGauge) > GAUGE_EPSILON) {
        lastGauge = f;
        const shift = `translate3d(${(f * 100).toFixed(2)}%, 0, 0)`;
        el.cover.style.transform = shift;
        el.needle.style.transform = shift;
      }

      // Badge « Vision classique » : dès que les effets sont atténués.
      const classic = k < 0.999;
      if (classic !== classicShown) {
        classicShown = classic;
        el.classic.hidden = !classic;
      }

      // Textes : 12 Hz au plus.
      const now = performance.now();
      if (now - lastTextTime < TEXT_PERIOD_MS) return;
      lastTextTime = now;

      // Dixièmes tronqués de chaque horloge : l'écart affiché est exactement la
      // différence des deux horloges affichées.
      const tauTenths = Math.floor(Math.max(0, snapshot.tau) * 10 + 1e-9);
      const tTenths = Math.floor(Math.max(0, snapshot.t) * 10 + 1e-9);
      const gap = (tTenths - tauTenths) / 10;
      writeText('tau', formatClock(snapshot.tau));
      writeText('t', formatClock(snapshot.t));
      writeText('gap', formatGap(gap));
      writeText('gamma', phrase(snapshot.gamma));
      writeText('speed', formatSpeed(snapshot.speed, snapshot.phiMax ?? phiMax, c));
      writeText('c', formatLightSpeed(c));

      const state = gapState(gapStateNow, snapshot.gamma, gap);
      if (state !== gapStateNow) {
        gapStateNow = state;
        el.gap.dataset.state = state; // classe visuelle changée seulement aux transitions
      }

      const showFps = Number.isFinite(fps);
      if (showFps !== fpsShown) {
        fpsShown = showFps;
        el.fps.hidden = !showFps;
      }
      if (showFps) writeText('fps', `${Math.round(fps)}\u202fi/s`);
    },

    show() {
      rootElement.hidden = false;
    },

    hide() {
      rootElement.hidden = true;
    },
  };
}
