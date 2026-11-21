import { describe, expect, it } from 'vitest';
import { RIPPLE_SLOTS, SPLASH_SLOTS, WISP_SLOTS } from '../../../src/gpu/weather/ground-budget.js';
import { GroundReactions } from '../../../src/gpu/weather/ground-reactions.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

const VIEW = { minX: 0, minY: 0, width: 640, height: 360 };
const ACTIVITY = { rain: 1, snow: 1, sand: 0 };

/** Each visible group's first slot id and instance count, in paint order. */
function drawn(reactions: GroundReactions): (readonly [number, number] | null)[] {
  return reactions.meshes.map((mesh) => {
    if (!mesh.visible) return null;
    const ids = mesh.geometry.getBuffer('aSlot').data as Float32Array;
    return [ids[0] ?? -1, mesh.geometry.instanceCount] as const;
  });
}

describe('GroundReactions', () => {
  it('draws only the running slots of each group, under their own slot ids', () => {
    const reactions = new GroundReactions();
    reactions.draw(VIEW, { splashes: 40, ripples: 0, wisps: 7 }, ACTIVITY, 0, 0, 1);
    expect(drawn(reactions)).toEqual([[0, 40], null, [SPLASH_SLOTS + RIPPLE_SLOTS, 7]]);
    reactions.draw(
      VIEW,
      { splashes: SPLASH_SLOTS, ripples: RIPPLE_SLOTS, wisps: WISP_SLOTS },
      ACTIVITY,
      0,
      0,
      2,
    );
    expect(drawn(reactions)).toEqual([
      [0, SPLASH_SLOTS],
      [SPLASH_SLOTS, RIPPLE_SLOTS],
      [SPLASH_SLOTS + RIPPLE_SLOTS, WISP_SLOTS],
    ]);
    reactions.draw(VIEW, { splashes: 0, ripples: 0, wisps: 0 }, ACTIVITY, 0, 0, 3);
    expect(drawn(reactions)).toEqual([null, null, null]);
    reactions.destroy();
  });
});
