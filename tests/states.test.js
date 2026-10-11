// Tests de src/game/states.js : table déclarative des transitions, gardes, machine à états.
import { describe, expect, it } from 'vitest';
import {
  checkTransitions,
  clocksRunning,
  createStateMachine,
  nextState,
  SKIP_AFTER_FAILURES,
  STATES,
  TRANSITIONS,
} from '../src/game/states.js';

describe('table des transitions', () => {
  it('saine : états connus, cibles connues, tout atteignable, aucun cul-de-sac', () => {
    expect(checkTransitions()).toEqual([]);
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATES].sort());
    expect(STATES).toEqual(['chargement', 'menu', 'selection', 'briefing', 'decompte', 'enCours', 'pause', 'reprise', 'bilan', 'echec']);
  });

  it('checkTransitions repère une cible inconnue et un état inatteignable', () => {
    const broken = { ...TRANSITIONS, menu: { jouer: 'nulle-part' } };
    const errors = checkTransitions(broken);
    expect(errors.some((e) => e.includes('menu.jouer → « nulle-part »'))).toBe(true);
    expect(errors.some((e) => e.includes('inatteignable'))).toBe(true);
  });

  it('seul enCours fait tourner les horloges', () => {
    expect(STATES.filter(clocksRunning)).toEqual(['enCours']);
  });

  it('nextState : transition absente → null', () => {
    expect(nextState('menu', 'jouer')).toBe('selection');
    expect(nextState('menu', 'reussite')).toBeNull();
    expect(nextState('inconnu', 'jouer')).toBeNull();
  });
});

describe('machine à états', () => {
  it('parcours complet : chargement → … → bilan → niveau suivant', () => {
    const changes = [];
    const m = createStateMachine({ onChange: (to, from, event) => changes.push(`${from}-${event}->${to}`) });
    expect(m.state).toBe('chargement');
    for (const e of ['pret', 'jouer', 'choisir', 'partir', 'fini']) expect(m.send(e)).not.toBeNull();
    expect(m.state).toBe('enCours');
    expect(m.send('pause')).toBe('pause');
    expect(m.send('reprendre')).toBe('decompte'); // décompte d'une seconde
    m.send('fini');
    expect(m.send('reprise')).toBe('reprise');
    expect(m.send('fini')).toBe('decompte');
    m.send('fini');
    expect(m.send('reussite')).toBe('bilan');
    expect(m.send('suivant', { niveauSuivant: true })).toBe('briefing');
    expect(changes[0]).toBe('chargement-pret->menu');
    expect(m.history.at(-1)).toBe('briefing');
  });

  it('événement refusé : null, état inchangé, onChange non appelé', () => {
    let calls = 0;
    const m = createStateMachine({ initial: 'menu', onChange: () => (calls += 1) });
    expect(m.send('reussite')).toBeNull();
    expect(m.state).toBe('menu');
    expect(calls).toBe(0);
    expect(m.can('jouer')).toBe(true);
    expect(m.events()).toEqual(['jouer']);
  });

  it('onglet caché (cache) : pause depuis le jeu, le décompte et la reprise', () => {
    for (const from of ['enCours', 'decompte', 'reprise']) {
      const m = createStateMachine({ initial: from });
      expect(m.send('cache')).toBe('pause');
    }
  });

  it(`« passer » seulement après ${SKIP_AFTER_FAILURES} échecs ; « suivant » seulement s’il y a un niveau suivant`, () => {
    const m = createStateMachine({ initial: 'echec' });
    expect(m.can('passer', { echecs: SKIP_AFTER_FAILURES - 1 })).toBe(false);
    expect(m.send('passer', { echecs: SKIP_AFTER_FAILURES - 1 })).toBeNull();
    expect(m.events({ echecs: 0 })).toEqual(['recommencer', 'quitter']);
    expect(m.send('passer', { echecs: SKIP_AFTER_FAILURES })).toBe('briefing');
    const b = createStateMachine({ initial: 'bilan' });
    expect(b.can('suivant', { niveauSuivant: false })).toBe(false);
    expect(b.send('rejouer')).toBe('decompte');
  });

  it('état initial inconnu : erreur', () => {
    expect(() => createStateMachine({ initial: 'nulle-part' })).toThrow();
  });
});
