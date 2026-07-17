import { describe, expect, it } from 'vitest';
import { MAP_BOOT_PHASES } from '../src/entries/map.js';
import { SCENE_BOOT_PHASES } from '../src/entries/scene.js';
import { messages } from '../src/i18n/index.js';
import { BOOT_PHASES, bootFraction } from '../src/view/boot-progress.js';

/** The real step lists the playable entries drive the card with — not a copy that could drift from them. */
const ENTRY_PHASES = [
  { entry: 'map', phases: MAP_BOOT_PHASES },
  { entry: 'scene', phases: SCENE_BOOT_PHASES },
] as const;

describe('boot progress', () => {
  for (const { entry, phases } of ENTRY_PHASES) {
    it(`advances the ${entry} bar monotonically, starting empty and never reaching full early`, () => {
      const fractions = phases.map((phase) => bootFraction(phases, phase));
      expect(fractions[0]).toBe(0);
      for (const [previous, next] of fractions.slice(0, -1).map((f, i) => [f, fractions[i + 1]])) {
        expect(next).toBeGreaterThan(previous as number);
      }
      expect(Math.max(...fractions)).toBeLessThan(1);
    });

    it(`only reports ${entry} steps the card has a label for`, () => {
      for (const phase of phases) {
        expect(BOOT_PHASES).toContain(phase);
      }
    });
  }

  it('reads a step the entry does not run as empty rather than throwing', () => {
    expect(bootFraction(SCENE_BOOT_PHASES, 'minimap')).toBe(0);
  });

  it('has a label in both locales for every boot step', () => {
    for (const phase of BOOT_PHASES) {
      expect(messages('pol').loading[phase]).toBeTruthy();
      expect(messages('eng').loading[phase]).toBeTruthy();
    }
  });
});
