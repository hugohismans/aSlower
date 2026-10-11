/**
 * Écrans des niveaux (jalon 3), dans le panneau #screen de index.html (même allure que l'écran
 * titre ; styles dans src/styles/base.css, section « Écrans des niveaux ») : sélection des
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

/** Bouton (≥ 48 px, classes .btn de base.css). */
function button(label, onClick, { primary = false, id, disabled = false } = {}) {
  return h(`button.btn${primary ? '.btn-primary' : ''}`, { type: 'button', onClick, 'data-action': id, disabled }, [label]);
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
     *   option : bascule d'une option (le spectromètre), à côté de « Menu »
     */
    showSelection({ levels, cText, total, onChoose, onBack, option }) {
      const cards = levels.map((l) =>
        h(
          'button.level-card',
          {
            type: 'button',
            disabled: l.locked,
            'data-level': l.id,
            'aria-label': `Niveau ${l.numero}, ${l.titre}. ${l.locked ? 'Verrouillé.' : l.starsLabel}`,
            onClick: () => onChoose(l.id),
          },
          [
            h('span.level-num', { text: l.locked ? `🔒 ${l.numero}` : String(l.numero) }),
            h('span.level-title', { text: l.titre }),
            h('span.level-notion', { text: l.notion }),
            h('span.level-stars', { 'aria-hidden': 'true', text: l.locked ? '' : l.stars }),
            l.note ? h('span.level-note', { text: l.note }) : null,
          ],
        ),
      );
      render('selection', [
        h('h2.notice-title', { text: 'Tournées' }),
        h('p.title-sub', { text: `${cText} · ${total}` }),
        h('div.level-list', {}, cards),
        h('div.title-actions', {}, [
          button('Menu', onBack, { id: 'menu' }),
          option
            ? h('button.btn.btn-preset', {
                type: 'button',
                'data-option': 'spectrometre',
                'aria-pressed': String(option.pressed),
                text: option.label,
                onClick: (event) => option.onToggle(/** @type {HTMLElement} */ (event.currentTarget)),
              })
            : null,
        ]),
      ]);
      /** @type {HTMLElement | null} */ (card.querySelector('.level-card:not([disabled])'))?.focus({ preventScroll: true });
    },

    /**
     * Briefing : objectif, clients et heures de la ville, batterie, notion.
     * @param {{numero: number, titre: string, notion: string, lines: string[],
     *          clients: {client: string, nom: string, when: string}[], battery: string,
     *          cText: string, hint: string, onGo: () => void, onBack: () => void}} o
     * @returns {{setBusy(text: string | null): void}}
     */
    showBriefing({ numero, titre, notion, lines, clients, battery, cText, hint, onGo, onBack }) {
      const go = button("C'est parti !", onGo, { primary: true, id: 'partir' });
      render('briefing', [
        h('p.brief-kicker', { text: `Niveau ${numero} · ${notion}` }),
        h('h2.notice-title', { text: titre }),
        h('div.brief-text', {}, lines.map((line) => h('p', { text: line }))),
        h(
          'ul.brief-clients',
          {},
          clients.map((c) => h('li', {}, [h('strong', { text: c.client }), ` — ${c.nom}`, c.when ? h('span.brief-when', { text: ` · ${c.when}` }) : null])),
        ),
        h('p.brief-meta', { text: `Batterie : ${battery} de ta montre · ${cText} · horaires à l'horloge de la ville` }),
        hint ? h('p.brief-hint', { text: `Indice : ${hint}` }) : null,
        h('div.title-actions', {}, [go, button('Niveaux', onBack, { id: 'niveaux' })]),
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
     *          records: string[], hasNext: boolean, onReplay: () => void, onNext: () => void,
     *          onQuit: () => void}} o
     */
    showResult({ titre, stars, starsCount, lines, figures, records, hasNext, onReplay, onNext, onQuit }) {
      render('bilan', [
        h('p.brief-kicker', { text: titre }),
        h('h2.notice-title', { text: 'Livré !' }),
        h('p.result-stars', { 'aria-label': `${starsCount} étoile${starsCount > 1 ? 's' : ''} sur 3`, text: stars }),
        h(
          'ul.result-lines',
          {},
          lines.map((l) => h(`li.${l.ok ? 'is-ok' : 'is-missing'}`, {}, [h('span.result-mark', { 'aria-hidden': 'true', text: l.ok ? '★' : '☆' }), h('strong', { text: `${l.name} ` }), l.detail])),
        ),
        h('div.result-figures', {}, figures.filter(Boolean).map((f) => h('p', { text: f }))),
        records.length ? h('p.result-records', { text: records.join(' · ') }) : null,
        h('div.title-actions', {}, [
          hasNext ? button('Niveau suivant', onNext, { primary: true, id: 'suivant' }) : null,
          button('Rejouer', onReplay, { primary: !hasNext, id: 'rejouer' }),
          button('Niveaux', onQuit, { id: 'niveaux' }),
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
        hint ? h('p.brief-hint', { text: `Indice : ${hint}` }) : null,
        h('div.title-actions', {}, [
          button('Recommencer', onRetry, { primary: true, id: 'recommencer' }),
          canSkip ? button('Passer ce niveau', onSkip, { id: 'passer' }) : null,
          button('Niveaux', onQuit, { id: 'niveaux' }),
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
