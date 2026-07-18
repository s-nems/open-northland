import { describe, expect, it } from 'vitest';
import { readBerryBushLevel } from '../../src/data/scene/snapshot-readers/index.js';

/** Unit tests for {@link readBerryBushLevel} — the `BerryBush.stage` → draw-level map the three-frame bush
 *  binding (bare, flowering, ripe) indexes by. */

describe('readBerryBushLevel — stage → draw level (1 bare, 2 flowering, 3 ripe)', () => {
  it('maps each growth stage to its 1-based level', () => {
    expect(readBerryBushLevel({ BerryBush: { stage: 'bare' } })).toBe(1);
    expect(readBerryBushLevel({ BerryBush: { stage: 'flowering' } })).toBe(2);
    expect(readBerryBushLevel({ BerryBush: { stage: 'ripe' } })).toBe(3);
  });

  it('returns undefined for a missing or malformed component (the binding draws its default frame)', () => {
    expect(readBerryBushLevel({})).toBeUndefined(); // no BerryBush
    expect(readBerryBushLevel({ BerryBush: {} })).toBeUndefined(); // no stage
    expect(readBerryBushLevel({ BerryBush: { stage: 42 } })).toBeUndefined(); // stage not a string
    expect(readBerryBushLevel({ BerryBush: { stage: 'sprouting' } })).toBeUndefined(); // unknown stage
  });
});
