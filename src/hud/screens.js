/**
 * Écrans des niveaux (jalon 3), dans le panneau #screen de index.html (même allure que l'accueil ;
 * styles dans src/styles/menus.css, section « Écrans des niveaux ») : sélection des
 * niveaux, briefing, bilan, échec ; et le décompte 3-2-1 (#countdown), par-dessus la vue.
 *
 * Le module ne décide de rien : main.js (machine à états game/states.js) appelle show…() avec
 * des textes déjà formés (hud/levelFormat.js) et des rappels ; chaque bouton est une cible
 * d'au moins 48 px, utilisable au clavier (Tab, Entrée) avec un focus visible ; le bouton
 * principal reçoit le focus.
 */

/**
 * Petit constructeur d'éléments : tag.classe, attributs, enfants (textes ou nœuds).
 * @param {string} spec « tag » ou « tag.classe1.classe2 »
 * @param {Record<string, any>} [attrs]
 * @param {(Node | string | null | undefined | false)[]} [children]
 */
function h(spec, attrs = {}, children = []) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag);
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'onClick') node.addEventListener('click', v);
    else if (k === 'text') node.textContent = v;
    else if (k in node && typeof v !== 'string') /** @type {any} */ (node)[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Bouton (≥ 48 px, classes .btn de styles/menus.css) ; `back` : chevron de retour.
 * @param {string} label
 * @param {(event: Event) => void} onClick
 * @param {{primary?: boolean, id?: string, disabled?: boolean, back?: boolean}} [options]
 * @returns {HTMLButtonElement}
 */
function button(label, onClick, { primary = false, id = undefined, disabled = false, back = false } = {}) {
  return /** @type {HTMLButtonElement} */ (h(`button.btn${primary ? '.btn-primary' : ''}${back ? '.btn-back' : ''}`, { type: 'button', onClick, 'data-action': id, disabled }, [label]));
}

/** Étoiles « ★★☆ » en signes séparés (pleines en jaune, vides en gris) ; décoratives. */
function starsNode(text, spec = 'span.stars') {
  return h(spec, { 'aria-hidden': 'true' }, [...text].map((ch) => h(`span.star${ch === '★' ? '.is-on' : ''}`, { text: ch })));
}

/** Cadenas (SVG, décoratif). */
function lockIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'level-lock');
  svg.innerHTML = '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>';
  return svg;
}

/**
 * @param {HTMLElement} root section #screen
 * @param {HTMLElement} countdownRoot élément #countdown
 */
export function createScreens(root, countdownRoot) {
  const card = /** @type {HTMLElement} */ (root.querySelector('.screen-card'));

  /** Remplace le contenu, affiche, met le focus sur le bouton principal. */
  function render(variant, nodes) {
    card.replaceChildren(...nodes.filter(Boolean));
    root.dataset.variant = variant;
    root.hidden = false;
    root.scrollTop = 0;
    /** @type {HTMLElement | null} */ (card.querySelector('.btn-primary:not([disabled])') ?? card.querySelector('button:not([disabled])'))?.focus({
      preventScroll: true,
    });
  }

  return {
    /**
     * Sélection des niveaux : une carte par niveau (numéro, titre, notion, étoiles, verrou).
     * @param {{levels: {id: string, numero: number, titre: string, notion: string,
     *          stars: string, starsLabel: string, locked: boolean, note: string}[],
     *          cText: string, total: string, onChoose: (id: string) => void, onBack: () => void,
     *          option?: {label: string, pressed: boolean, onToggle: (button: HTMLElement) => void}}} o
     *   option : bascule d'une option (le spectromètre), en pied d'écran
     */
    showSelection({ levels, cText, total, onChoose, onBack, option }) {
      const cards = levels.map((l) =>
        h(
          `button.level-card${l.locked ? '.is-locked' : ''}`,
          {
            type: 'button',
            disabled: l.locked,
            'data-level': l.id,
            'aria-label': `Niveau ${l.numero}, ${l.titre} : ${l.notion}. ${l.locked ? 'Verrouillé.' : l.starsLabel}${l.note && !l.locked ? ` ${l.note}` : ''}`,
            onClick: () => onChoose(l.id),
          },
          [
            h('span.level-top', {}, [
              h('span.level-num', { 'aria-hidden': 'true' }, [l.locked ? lockIcon() : String(l.numero)]),
              l.locked ? h('span.level-locked', { text: 'Verrouillé' }) : starsNode(l.stars, 'span.stars.level-stars'),
            ]),
            h('span.level-title', { text: l.titre }),
            h('span.level-notion', { text: l.notion }),
            l.note ? h('span.level-note', { text: l.note }) : null,
            l.locked ? null : h('span.level-go', { 'aria-hidden': 'true', text: l.stars.includes('★') ? 'Rejouer' : 'Commencer' }),
          ],
        ),
      );
      render('selection', [
        h('header.screen-head', {}, [
          button('Menu', onBack, { id: 'menu', back: true }),
          h('div.screen-head-title', {}, [h('p.brief-kicker', { text: 'Photon Express' }), h('h2.notice-title', { text: 'Tournées' })]),
          h('p.screen-head-meta', {}, [h('span.chip.chip-stars', {}, [h('span', { 'aria-hidden': 'true', text: '★ ' }), total]), h('span.chip', { text: cText })]),
        ]),
        h('div.level-list', {}, cards),
        option
          ? h('footer.screen-foot', {}, [
              h('button.btn.btn-preset', {
                type: 'button',
                'data-option': 'spectrometre',
                'aria-pressed': String(option.pressed),
                text: option.label,
                onClick: (event) => option.onToggle(/** @type {HTMLElement} */ (event.currentTarget)),
              }),
              h('p.screen-foot-note', { text: `Étoiles et records comptés à ${cText}.` }),
            ])
          : null,
      ]);
      /** @type {HTMLElement | null} */ (card.querySelector('.level-card:not([disabled])'))?.focus({ preventScroll: true });
    },

    /**
     * Briefing : objectif, clients et heures de la ville, batterie, notion, commandes.
     * @param {{numero: number, titre: string, notion: string, lines: string[],
     *          clients: {client: string, nom: string, when: string}[], battery: string,
     *          cText: string, hint: string, controls?: string, onGo: () => void, onBack: () => void}} o
     * @returns {{setBusy(text: string | null): void}}
     */
    showBriefing({ numero, titre, notion, lines, clients, battery, cText, hint, controls = '', onGo, onBack }) {
      const go = button("C'est parti !", onGo, { primary: true, id: 'partir' });
      const timed = clients.some((c) => c.when);
      render('briefing', [
        h('div.brief', {}, [
          h('div.brief-main', {}, [
            h('p.brief-kicker', {}, [h('span.brief-num', { text: `Niveau ${numero}` }), ` · ${notion}`]),
            h('h2.notice-title', { text: titre }),
            h('div.brief-text', {}, lines.map((line) => h('p', { text: line }))),
            controls ? h('p.brief-controls', { text: controls }) : null,
          ]),
          h('div.brief-aside', {}, [
          h('div.brief-side', {}, [
            h('h3.side-title', { text: 'Livraisons' }),
            h(
              'ol.brief-clients',
              {},
              clients.map((c, i) =>
                h('li', {}, [
                  h('span.client-num', { 'aria-hidden': 'true', text: String(i + 1) }),
                  h('span.client-body', {}, [
                    h('strong', { text: c.client }),
                    h('span.client-what', { text: ` — ${c.nom}` }),
                    c.when ? h('span.brief-when', { text: c.when }) : null,
                  ]),
                ]),
              ),
            ),
            h('dl.brief-facts', {}, [
              h('div', {}, [h('dt', { text: 'Batterie' }), h('dd', { text: `${battery} de ta montre` })]),
              h('div', {}, [h('dt', { text: 'Lumière' }), h('dd', { text: cText })]),
              timed ? h('div', {}, [h('dt', { text: 'Horaires' }), h('dd', { text: "à l'horloge de la ville" })]) : null,
            ]),
            hint ? h('p.brief-hint', {}, [h('strong', { text: 'Indice : ' }), hint]) : null,
          ]),
          h('div.title-actions.brief-actions', {}, [go, button('Niveaux', onBack, { id: 'niveaux', back: true })]),
          ]),
        ]),
      ]);
      return {
        setBusy(text) {
          go.disabled = Boolean(text);
          go.textContent = text || "C'est parti !";
        },
      };
    },

    /**
     * Bilan d'une réussite.
     * @param {{titre: string, stars: string, starsCount: number,
     *          lines: {name: string, ok: boolean, detail: string}[], figures: string[],
     *          stats?: {label: string, value: string}[],
     *          records: string[], hasNext: boolean, onReplay: () => void, onNext: () => void,
     *          onQuit: () => void}} o
     *   stats : chiffres en tuiles (montre, ville, écart) ; figures : phrases sous les tuiles
     */
    showResult({ titre, stars, starsCount, lines, figures, stats = [], records, hasNext, onReplay, onNext, onQuit }) {
      render('bilan', [
        h('div.result', {}, [
          h('div.result-hero', {}, [
            h('p.brief-kicker', { text: titre }),
            h('h2.notice-title', { text: 'Livré !' }),
            h('p.result-stars', { role: 'img', 'aria-label': `${starsCount} étoile${starsCount > 1 ? 's' : ''} sur 3` }, [starsNode(stars)]),
            records.length ? h('p.result-records', { text: records.join(' · ') }) : null,
          ]),
          h('div.result-detail', {}, [
            h(
              'ul.result-lines',
              {},
              lines.map((l) =>
                h(`li.${l.ok ? 'is-ok' : 'is-missing'}`, {}, [
                  h('span.result-mark', { 'aria-hidden': 'true', text: l.ok ? '★' : '☆' }),
                  h('span', {}, [h('strong', { text: `${l.name} ` }), h('span.result-why', { text: l.detail })]),
                ]),
              ),
            ),
            stats.length
              ? h(
                  'dl.result-stats',
                  {},
                  stats.map((st) => h('div', {}, [h('dt', { text: st.label }), h('dd', { text: st.value })])),
                )
              : null,
            h('div.result-figures', {}, figures.filter(Boolean).map((f) => h('p', { text: f }))),
          ]),
        ]),
        h('div.title-actions', {}, [
          hasNext ? button('Niveau suivant', onNext, { primary: true, id: 'suivant' }) : null,
          button('Rejouer', onReplay, { primary: !hasNext, id: 'rejouer' }),
          button('Niveaux', onQuit, { id: 'niveaux', back: true }),
        ]),
      ]);
    },

    /**
     * Échec : raison, indice gradué, Recommencer ; « Passer » après assez d'échecs.
     * @param {{titre: string, reason: string, hint: string, canSkip: boolean,
     *          onRetry: () => void, onSkip: () => void, onQuit: () => void}} o
     */
    showFailure({ titre, reason, hint, canSkip, onRetry, onSkip, onQuit }) {
      render('echec', [
        h('p.brief-kicker', { text: titre }),
        h('h2.notice-title', { text: 'Raté…' }),
        h('p.title-sub', { text: reason }),
        hint ? h('p.brief-hint', {}, [h('strong', { text: 'Indice : ' }), hint]) : null,
        h('div.title-actions', {}, [
          button('Recommencer', onRetry, { primary: true, id: 'recommencer' }),
          canSkip ? button('Passer ce niveau', onSkip, { id: 'passer' }) : null,
          button('Niveaux', onQuit, { id: 'niveaux', back: true }),
        ]),
      ]);
    },

    hide() {
      if (root.contains(document.activeElement)) /** @type {HTMLElement} */ (document.activeElement).blur();
      root.hidden = true;
    },

    /** Décompte (« 3 », « 2 », « 1 », « Partez ! ») ou message court (reprise), par-dessus la vue. */
    showCountdown(text, { small = false } = {}) {
      if (countdownRoot.textContent !== text) countdownRoot.textContent = text;
      countdownRoot.dataset.size = small ? 'petit' : 'grand';
      countdownRoot.hidden = false;
    },

    hideCountdown() {
      countdownRoot.hidden = true;
    },
  };
}
