import { describe, expect, it } from 'vitest';
import { depthKey, TILE_HALF_H, TILE_HALF_W } from '../../src/data/projection/index.js';
import { SHADOW_DEPTH_EPS, SIGN_DEPTH_EPS, screenDepth, spriteDepth } from '../../src/data/scene/depth.js';
import type { DrawKind } from '../../src/data/scene/index.js';

const ALL_KINDS = [
  'tile',
  'building',
  'settler',
  'fish',
  'resource',
  'berrybush',
  'chest',
  'stockpile',
  'stump',
  'grounddrop',
  'signpost',
  'projectile',
] as const satisfies readonly DrawKind[];
// A DrawKind missing from the tuple above makes _MissingKind non-never and fails to compile here, so
// the pairwise matrix stays exhaustive.
type _MissingKind = Exclude<DrawKind, (typeof ALL_KINDS)[number]>;
const _allKindsListed: [_MissingKind] extends [never] ? true : _MissingKind = true;
void _allKindsListed;

/** A very large map's tile columns; real maps are a few hundred (the oracle ROW_STRIDE bound). */
const MAX_MAP_TILE_COLS = 1024;
/** The x-tiebreak's worst case: the feet-anchor |x| of such a map's rightmost stagger-shifted column. */
const MAX_MAP_SCREEN_X = (2 * MAX_MAP_TILE_COLS + 1) * TILE_HALF_W;

describe('same-anchor depth keys', () => {
  it('orders every kind pair (and the delivery flag) identically in the oracle and the live painter', () => {
    const variants: readonly { kind: DrawKind; isFlag: boolean }[] = [
      ...ALL_KINDS.map((kind) => ({ kind, isFlag: false })),
      { kind: 'stockpile', isFlag: true },
    ];
    for (const a of variants) {
      for (const b of variants) {
        const oracle = Math.sign(spriteDepth(5, 7, a.kind, a.isFlag) - spriteDepth(5, 7, b.kind, b.isFlag));
        const live = Math.sign(
          screenDepth(340, 133, a.kind, a.isFlag) - screenDepth(340, 133, b.kind, b.isFlag),
        );
        expect(live, `${a.kind}${a.isFlag ? '+flag' : ''} vs ${b.kind}${b.isFlag ? '+flag' : ''}`).toBe(
          oracle,
        );
      }
    }
  });

  it('keeps the flagged stockpile below a settler at the same anchor in both keys', () => {
    expect(spriteDepth(5, 7, 'stockpile', true)).toBeLessThan(spriteDepth(5, 7, 'settler'));
    expect(screenDepth(340, 133, 'stockpile', true)).toBeLessThan(screenDepth(340, 133, 'settler'));
  });

  it('keeps the whole kind bias under one tile column (oracle) and one row step (live painter)', () => {
    // 'projectile' carries the largest bias, 'tile' the zero one, so their gap is the whole bias span.
    expect(spriteDepth(5, 7, 'projectile') - spriteDepth(5, 7, 'tile')).toBeLessThan(1);
    expect(screenDepth(340, 133, 'projectile') - screenDepth(340, 133, 'tile')).toBeLessThan(TILE_HALF_H);
  });

  it('sizes the shadow epsilon above the x-tiebreak so a caster/shadow pair cannot interleave', () => {
    const worstTiebreak = depthKey(MAX_MAP_SCREEN_X, 0) - depthKey(0, 0);
    expect(SHADOW_DEPTH_EPS).toBeGreaterThan(worstTiebreak);
  });

  it('sizes the shadow epsilon below one kind-bias step so a shadow never drops behind an earlier kind', () => {
    const oneKindStep = screenDepth(0, 0, 'building') - screenDepth(0, 0, 'resource');
    expect(SHADOW_DEPTH_EPS).toBeLessThan(oneKindStep);
  });

  it('sizes the sign epsilon to clear a building yet stay under the next kind up', () => {
    // A door-badge chain keys off its own building, so it must clear both the house and the x-tiebreak
    // that could tie them, while staying under 'stockpile' so heaps, flags and settlers paint over it.
    const worstTiebreak = depthKey(MAX_MAP_SCREEN_X, 0) - depthKey(0, 0);
    const oneKindStep = screenDepth(0, 0, 'stockpile') - screenDepth(0, 0, 'building');
    expect(SIGN_DEPTH_EPS).toBeGreaterThan(worstTiebreak);
    expect(SIGN_DEPTH_EPS).toBeLessThan(oneKindStep);
  });
});
