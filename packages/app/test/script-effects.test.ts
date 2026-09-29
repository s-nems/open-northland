import { describe, expect, it } from 'vitest';
import { createScriptEffects } from '../src/view/script-effects.js';

describe('createScriptEffects', () => {
  it("shakes for the quake's duration and no longer", () => {
    const effects = createScriptEffects();
    expect(effects.jitter(0)).toBeNull();
    effects.startEarthquake(2, 1000);
    const early = effects.jitter(1500);
    expect(early).not.toBeNull();
    expect(Math.abs(early?.dx ?? 0)).toBeLessThanOrEqual(6);
    expect(effects.jitter(2999)).not.toBeNull();
    expect(effects.jitter(3000)).toBeNull();
  });
});
