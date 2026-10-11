/**
 * HUD de niveau (jalon 3), par-dessus le HUD des horloges (src/hud/hud.js) ; styles dans
 * src/hud/hud.css (section « Niveau »). Ne capte aucun toucher.
 *
 * - En haut à gauche des horloges : la BATTERIE (= τ restant : « 65 s » et une jauge qui se
 *   vide avec ta montre, orange sous 25 %, rouge sous 10 %, avec le texte en plus de la
 *   couleur) et les colis livrés (« Colis 1/2 »).
 * - En bas, à gauche du centre (hors de la pédale de frein du mode glisser et du frein du mode
 *   inclinaison) : l'indicateur du prochain arrêt, flèche qui pointe vers sa direction
 *   APPARENTE (hud/levelFormat.stopIndicator) et distance dans la ville ; puis le client et
 *   l'heure de la ville qui compte (délai ou « pas avant ») ; l'aide « repère de freinage »
 *   (distance d'arrêt) ; le spectromètre (teinte perçue de la lampe visée).
 *
 * Textes écrits à 12 Hz au plus et seulement s'ils changent ; la flèche et la jauge bougent par
 * `transform` ; aucune lecture de mise en page dans la boucle.
 */

/** Période de rafraîchissement des textes (ms) : 12 Hz. */
const TEXT_PERIOD_MS = 1000 / 12;

/**
 * @typedef {object} LevelHudInfo
 * @property {{text: string, fraction: number, level: 'ok' | 'bas' | 'critique'}} battery
 * @property {{done: number, total: number}} colis
 * @property {null | {client: string, verb: string, distance: string, angle: number,
 *            behind: boolean, inZone: boolean, timing: {text: string, state: string}}} next
 *   prochain arrêt (null : tout est livré)
 * @property {string} [brake] aide « repère de freinage » (texte), ou ''
 * @property {null | {text: string, ok: boolean}} [spectro] spectromètre, ou null
 */

/**
 * @param {HTMLElement} hudRoot #hud, déjà rempli par createHud (le panneau batterie se place au
 *   début de .hud-top)
 * @returns {{update(info: LevelHudInfo): void, show(): void, hide(): void, element: HTMLElement}}
 */
export function createLevelHud(hudRoot) {
  const top = hudRoot.querySelector('.hud-top');
  const panel = document.createElement('section');
  panel.className = 'hud-panel hud-level';
  panel.setAttribute('aria-label', 'Batterie et colis');
  panel.innerHTML = `
    <div class="hud-level-head">
      <span class="hud-label">Batterie</span>
      <span class="hud-level-value" data-ref="battery">—</span>
    </div>
    <div class="battery" aria-hidden="true"><div class="battery-fill" data-ref="fill"></div></div>
    <p class="hud-level-colis" data-ref="colis">Colis 0/0</p>`;
  if (top) top.prepend(panel);
  else hudRoot.prepend(panel);

  const next = document.createElement('section');
  next.className = 'hud-panel hud-next';
  next.setAttribute('aria-label', 'Prochain arrêt');
  next.innerHTML = `
    <div class="hud-next-row">
      <span class="hud-arrow" aria-hidden="true"><i data-ref="arrow"></i></span>
      <span class="hud-next-main" data-ref="main"></span>
    </div>
    <p class="hud-next-line" data-ref="timing"></p>
    <p class="hud-next-line hud-next-brake" data-ref="brake" hidden></p>
    <p class="hud-next-line hud-spectro" data-ref="spectro" hidden></p>`;
  hudRoot.append(next);

  const ref = (root, name) => /** @type {HTMLElement} */ (root.querySelector(`[data-ref="${name}"]`));
  const el = {
    battery: ref(panel, 'battery'),
    fill: ref(panel, 'fill'),
    colis: ref(panel, 'colis'),
    arrow: ref(next, 'arrow'),
    main: ref(next, 'main'),
    timing: ref(next, 'timing'),
    brake: ref(next, 'brake'),
    spectro: ref(next, 'spectro'),
  };
  const lastText = new Map();
  const write = (name, text) => {
    if (lastText.get(name) === text) return;
    lastText.set(name, text);
    el[name].textContent = text;
  };
  const lastAttr = new Map();
  const setData = (node, key, value) => {
    const id = `${key}:${node.dataset.ref ?? node.className}`;
    if (lastAttr.get(id) === value) return;
    lastAttr.set(id, value);
    node.dataset[key] = value;
  };
  const shown = new Map();
  const toggle = (node, on) => {
    if (shown.get(node) === on) return;
    shown.set(node, on);
    node.hidden = !on;
  };

  let lastTextTime = -Infinity;
  let lastFill = -1;
  let lastAngle = NaN;

  return {
    element: panel,

    /** @param {LevelHudInfo} info */
    update(info) {
      // Jauge et flèche : à chaque image (transform seulement).
      const f = Math.round(info.battery.fraction * 1000) / 1000;
      if (f !== lastFill) {
        lastFill = f;
        el.fill.style.transform = `scaleX(${f})`;
      }
      if (info.next) {
        const a = Math.round((info.next.angle * 180) / Math.PI);
        if (a !== lastAngle) {
          lastAngle = a;
          el.arrow.style.transform = `rotate(${a}deg)`;
        }
      }

      const now = performance.now();
      if (now - lastTextTime < TEXT_PERIOD_MS) return;
      lastTextTime = now;

      write('battery', info.battery.text);
      setData(el.fill, 'level', info.battery.level);
      setData(panel, 'level', info.battery.level);
      write('colis', `Colis ${info.colis.done}/${info.colis.total}`);
      toggle(next, Boolean(info.next));
      if (info.next) {
        const n = info.next;
        write('main', n.inZone ? `${n.verb} : ${n.client} · ici` : `${n.client} · ${n.distance}`);
        write('timing', n.timing.text);
        setData(el.timing, 'state', n.timing.state);
        toggle(el.timing, Boolean(n.timing.text));
        setData(next, 'zone', n.inZone ? 'oui' : 'non');
      }
      toggle(el.brake, Boolean(info.brake));
      if (info.brake) write('brake', info.brake);
      toggle(el.spectro, Boolean(info.spectro));
      if (info.spectro) {
        write('spectro', `Spectromètre : ${info.spectro.text}`);
        setData(el.spectro, 'ok', info.spectro.ok ? 'oui' : 'non');
      }
    },

    show() {
      panel.hidden = false;
      shown.delete(next);
    },

    hide() {
      panel.hidden = true;
      next.hidden = true;
      shown.set(next, false);
    },
  };
}
