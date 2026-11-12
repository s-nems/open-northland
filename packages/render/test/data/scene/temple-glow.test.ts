import { describe, expect, it } from 'vitest';
import {
  TEMPLE_MOTES,
  type TempleMote,
  templeAuraPhases,
  templeMote,
} from '../../../src/data/scene/temple-glow.js';

const SEED = 7;
const HOURS_IN = 36000;

describe('temple aura clock', () => {
  it('keeps every phase wrapped hours into a game', () => {
    const phases = templeAuraPhases(HOURS_IN, SEED, { wave: 0, sway: 0, rays: 0 });
    expect(phases.wave).toBeGreaterThanOrEqual(0);
    expect(phases.wave).toBeLessThan(1);
    expect(phases.sway).toBeLessThan(2 * Math.PI);
    expect(phases.rays).toBeLessThan(2 * Math.PI);
  });

  it('keeps each mote on the front of the wall line, dark as it leaves and as it ends', () => {
    const mote: TempleMote = { across: 0, before: 0, rise: 0, alpha: 0, size: 0 };
    for (let index = 0; index < TEMPLE_MOTES; index++) {
      for (let seconds = 0; seconds < 20; seconds += 0.37) {
        templeMote(seconds, SEED, index, mote);
        expect(mote.before).toBeGreaterThanOrEqual(0);
        expect(mote.before).toBeLessThanOrEqual(1);
        expect(mote.alpha).toBeLessThanOrEqual(Math.sin(Math.PI * mote.rise) ** 2 + 1e-9);
      }
    }
  });
});
