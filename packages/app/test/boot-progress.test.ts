import { describe, expect, it } from 'vitest';
import { messages } from '../src/i18n/index.js';
import { BOOT_PHASES, type BootPhase, bootFraction } from '../src/view/boot-progress.js';

/** A representative entry step list — the `?map=` one, the longest of the two playable entries. */
const PHASES = [
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'objects',
  'world',
  'minimap',
  'hud',
] as const satisfies readonly BootPhase[];

describe('boot progress', () => {
  it('advances the bar monotonically across an entry step list, starting empty', () => {
    const fractions = PHASES.map((phase) => bootFraction(PHASES, phase));
    expect(fractions[0]).toBe(0);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1] as number);
      expect(fractions[i]).toBeLessThan(1);
    }
  });

  it('reads a step the entry does not run as empty rather than throwing', () => {
    const sceneSteps = ['graphics', 'content'] as const satisfies readonly BootPhase[];
    expect(bootFraction(sceneSteps, 'minimap')).toBe(0);
  });

  it('has a label in both locales for every boot step', () => {
    for (const phase of BOOT_PHASES) {
      expect(messages('pol').loading[phase]).toBeTruthy();
      expect(messages('eng').loading[phase]).toBeTruthy();
    }
  });
});
