import { describe, expect, it } from 'vitest';
import { templeAuraPhases } from '../../../src/data/scene/temple-glow.js';

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
});
