// Source de la dernière commande (src/input/controls.js, activeSource) : choisit la variante
// du texte des bulles (variable modeVolant).
import { describe, expect, it } from 'vitest';
import { activeSource } from '../src/input/controls.js';

const idle = { thrust: 0, brake: 0, steer: 0, classic: false };

describe('activeSource', () => {
  it('rien ne commande : null (la source précédente est gardée)', () => {
    expect(activeSource(idle, idle, 0, 'drag')).toBeNull();
    expect(activeSource(idle, idle, 0.1, 'tilt')).toBeNull(); // sous le seuil de 0,15
  });

  it('le clavier passe devant le tactile et l’inclinaison', () => {
    expect(activeSource({ ...idle, thrust: 1 }, { ...idle, thrust: 1 }, 0.8, 'tilt')).toBe('clavier');
    expect(activeSource({ ...idle, steer: -0.2 }, idle, 0, 'drag')).toBe('clavier');
    expect(activeSource({ ...idle, classic: true }, idle, 0, 'drag')).toBe('clavier');
  });

  it('tactile : accélérateur, frein, vision classique, volant glisser', () => {
    expect(activeSource(idle, { ...idle, thrust: 1 }, 0, 'drag')).toBe('tactile');
    expect(activeSource(idle, { ...idle, brake: 1 }, 0.5, 'tilt')).toBe('tactile');
    expect(activeSource(idle, { ...idle, classic: true }, 0, 'tilt')).toBe('tactile');
    expect(activeSource(idle, { ...idle, steer: 0.3 }, 0, 'drag')).toBe('tactile');
  });

  it('inclinaison : seulement en mode inclinaison, au-delà du seuil', () => {
    expect(activeSource(idle, idle, 0.4, 'tilt')).toBe('inclinaison');
    expect(activeSource(idle, idle, -0.4, 'tilt')).toBe('inclinaison');
    expect(activeSource(idle, idle, 0.4, 'drag')).toBeNull();
    // En mode inclinaison, un doigt sur la zone volant (masquée) ne compte pas.
    expect(activeSource(idle, { ...idle, steer: 0.5 }, 0, 'tilt')).toBeNull();
  });
});
