/**
 * Machine à états de l'application (jalon 3) : table DÉCLARATIVE des transitions, module pur.
 * L'affichage (écrans HTML, body[data-etat]) et les effets (horloges, chargement) sont
 * branchés par main.js sur `onChange`.
 *
 *   chargement ─pret→ menu ─jouer→ selection ─choisir→ briefing ─partir→ decompte ─fini→ enCours
 *   enCours ─pause|cache→ pause ─reprendre→ decompte (1 s) ; pause ─recommencer→ decompte
 *   enCours ─reprise→ reprise ─fini→ decompte ; enCours ─reussite→ bilan ; ─echec→ echec
 *   bilan ─rejouer→ decompte | ─suivant→ briefing | ─quitter→ selection
 *   echec ─recommencer→ decompte | ─passer→ briefing (après SKIP_AFTER_FAILURES échecs)
 *
 * « cache » = visibilitychange (onglet caché). « partir » (Briefing → « C'est parti ») est un
 * geste de l'utilisateur : main.js y demande la permission d'inclinaison (iOS). Les horloges
 * ne tournent qu'en « enCours » (clocksRunning) ; elles démarrent à la fin du décompte.
 */

/** États, dans l'ordre du parcours. */
export const STATES = Object.freeze([
  'chargement',
  'menu',
  'selection',
  'briefing',
  'decompte',
  'enCours',
  'pause',
  'reprise',
  'bilan',
  'echec',
]);

/** Nombre d'échecs sur un niveau à partir duquel « passer » est proposé. */
export const SKIP_AFTER_FAILURES = 4;

/** Table des transitions : état → {événement: état suivant}. */
export const TRANSITIONS = Object.freeze({
  chargement: Object.freeze({ pret: 'menu' }),
  menu: Object.freeze({ jouer: 'selection' }),
  selection: Object.freeze({ choisir: 'briefing', retour: 'menu' }),
  briefing: Object.freeze({ partir: 'decompte', retour: 'selection' }),
  decompte: Object.freeze({ fini: 'enCours', pause: 'pause', cache: 'pause', quitter: 'selection' }),
  enCours: Object.freeze({ pause: 'pause', cache: 'pause', reussite: 'bilan', echec: 'echec', reprise: 'reprise' }),
  reprise: Object.freeze({ fini: 'decompte', cache: 'pause' }),
  pause: Object.freeze({ reprendre: 'decompte', recommencer: 'decompte', quitter: 'selection' }),
  bilan: Object.freeze({ rejouer: 'decompte', suivant: 'briefing', quitter: 'selection' }),
  echec: Object.freeze({ recommencer: 'decompte', passer: 'briefing', quitter: 'selection' }),
});

/**
 * Gardes : `état.événement` → prédicat du contexte passé à send (transition refusée si faux).
 * @type {Readonly<Record<string, (ctx: any) => boolean>>}
 */
export const GUARDS = Object.freeze({
  'echec.passer': (ctx) => (ctx?.echecs ?? 0) >= SKIP_AFTER_FAILURES && ctx?.niveauSuivant !== false,
  'bilan.suivant': (ctx) => ctx?.niveauSuivant !== false,
});

/** Les horloges du jeu tournent-elles dans cet état ? */
export function clocksRunning(state) {
  return state === 'enCours';
}

/**
 * État suivant, ou null si la transition n'existe pas ou si sa garde la refuse.
 * @param {string} state
 * @param {string} event
 * @param {any} [ctx]
 * @param {{transitions?: Record<string, Record<string, string>>, guards?: Record<string, (ctx: any) => boolean>}} [table]
 * @returns {string | null}
 */
export function nextState(state, event, ctx, { transitions = TRANSITIONS, guards = GUARDS } = {}) {
  const row = transitions[state];
  if (!row || !Object.prototype.hasOwnProperty.call(row, event)) return null;
  const guard = guards[`${state}.${event}`];
  if (guard && !guard(ctx)) return null;
  return row[event];
}

/**
 * Vérifie une table : états connus, cibles connues, tout état atteignable depuis
 * `chargement`. → liste d'erreurs (vide si la table est saine).
 * @param {Record<string, Record<string, string>>} [transitions]
 * @param {readonly string[]} [states]
 */
export function checkTransitions(transitions = TRANSITIONS, states = STATES) {
  const errors = [];
  for (const [from, row] of Object.entries(transitions)) {
    if (!states.includes(from)) errors.push(`état « ${from} » inconnu`);
    for (const [event, to] of Object.entries(row)) {
      if (!states.includes(to)) errors.push(`${from}.${event} → « ${to} » : état inconnu`);
    }
  }
  const seen = new Set(['chargement']);
  const todo = ['chargement'];
  while (todo.length) {
    const s = /** @type {string} */ (todo.pop());
    for (const to of Object.values(transitions[s] ?? {})) {
      if (!seen.has(to)) {
        seen.add(to);
        todo.push(to);
      }
    }
  }
  for (const s of states) {
    if (!seen.has(s)) errors.push(`état « ${s} » inatteignable depuis chargement`);
    if (!transitions[s] || Object.keys(transitions[s]).length === 0) errors.push(`état « ${s} » sans sortie`);
  }
  return errors;
}

/**
 * Machine à états.
 * @param {{initial?: string, onChange?: (to: string, from: string, event: string) => void,
 *          transitions?: Record<string, Record<string, string>>,
 *          guards?: Record<string, (ctx: any) => boolean>}} [options]
 * @returns {{readonly state: string, send(event: string, ctx?: any): string | null,
 *            can(event: string, ctx?: any): boolean, events(ctx?: any): string[],
 *            readonly history: string[]}}
 *   send : nouvel état, ou null (refusée : l'état ne change pas, onChange n'est pas appelé)
 */
export function createStateMachine({ initial = 'chargement', onChange, transitions = TRANSITIONS, guards = GUARDS } = {}) {
  if (!transitions[initial]) throw new Error(`État initial « ${initial} » inconnu`);
  let state = initial;
  const history = [initial];
  return {
    get state() {
      return state;
    },
    get history() {
      return history.slice();
    },
    send(event, ctx) {
      const to = nextState(state, event, ctx, { transitions, guards });
      if (to === null) return null;
      const from = state;
      state = to;
      history.push(to);
      if (history.length > 100) history.shift();
      onChange?.(to, from, event);
      return to;
    },
    can(event, ctx) {
      return nextState(state, event, ctx, { transitions, guards }) !== null;
    },
    events(ctx) {
      return Object.keys(transitions[state] ?? {}).filter((e) => nextState(state, e, ctx, { transitions, guards }) !== null);
    },
  };
}
