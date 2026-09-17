import { describe, expect, it } from 'vitest';
import { resolveCraftFxDraw } from '../../src/data/sprites/layered.js';
import type { CraftFxBinding } from '../../src/data/sprites/layered-bindings.js';
import { drawItem } from '../support/fixtures.js';

/** The `ls_smoke` fire and smoke loops an in-house program stages, keyed by the names it uses. */
const binding: CraftFxBinding = {
  byName: {
    'fx fire small': { layer: 'ls_smoke.fire', frames: [172, 173, 174] },
    'fx smoke': { layer: 'ls_smoke.smoke', frames: [0] },
  },
};

describe('resolveCraftFxDraw - a staged effect’s loop frame', () => {
  it('loops one frame per tick through the named record’s frames in its own family', () => {
    const fire = drawItem('craftfx', { fxName: 'fx fire small' });
    expect(resolveCraftFxDraw(binding, fire, 0)).toEqual({ layer: 'ls_smoke.fire', bob: 172 });
    expect(resolveCraftFxDraw(binding, fire, 2)).toEqual({ layer: 'ls_smoke.fire', bob: 174 });
    expect(resolveCraftFxDraw(binding, fire, 3)).toEqual({ layer: 'ls_smoke.fire', bob: 172 });
    // A one-frame loop is a still at any tick.
    expect(resolveCraftFxDraw(binding, drawItem('craftfx', { fxName: 'fx smoke' }), 7)).toEqual({
      layer: 'ls_smoke.smoke',
      bob: 0,
    });
  });

  it('draws nothing bound for an unknown effect, a nameless item or no binding (the placeholder path)', () => {
    expect(resolveCraftFxDraw(binding, drawItem('craftfx', { fxName: 'fx wave' }), 0)).toBeNull();
    expect(resolveCraftFxDraw(binding, drawItem('craftfx'), 0)).toBeNull();
    expect(resolveCraftFxDraw(undefined, drawItem('craftfx', { fxName: 'fx smoke' }), 0)).toBeNull();
  });
});
