import { fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { computeSettlerBubbles } from '../src/view/projections/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * computeSettlerBubbles — the pure snapshot→bubble projection the render layer floats over a settler's
 * head. It reads the standing family state the sim drives: a woman's `ChildOrder` shows the `child`
 * bubble until the birth; a `Wedding` in progress shows the `partner` bubble on both partners until they
 * marry. The bubble anchors on the settler's own `Position`.
 */

const WOMAN = 5; // any adult job id — the projection keys on the components, not the trade
const MAN = 6;

/** An adult settler at tile `(x, y)` carrying exactly the given extra components. */
function settlerAt(id: number, jobType: number, x: number, y: number, extra: Record<string, unknown>): Ent {
  return {
    id,
    components: { Settler: { jobType }, Position: { x: fx.fromInt(x), y: fx.fromInt(y) }, ...extra },
  };
}

describe('computeSettlerBubbles', () => {
  it('floats a child bubble over a woman with a make-child order, at her position', () => {
    const snap = snapshotOf([settlerAt(1, WOMAN, 4, 7, { ChildOrder: { child: 'female' } })]);

    expect(computeSettlerBubbles(snap)).toEqual([
      { id: 1, x: fx.fromInt(4), y: fx.fromInt(7), kind: 'child' },
    ]);
  });

  it('floats a partner bubble over both settlers walking through a wedding', () => {
    const snap = snapshotOf([
      settlerAt(1, WOMAN, 4, 4, { Wedding: { partner: 2, kissing: false } }),
      settlerAt(2, MAN, 6, 4, { Wedding: { partner: 1, kissing: false } }),
    ]);

    const bubbles = computeSettlerBubbles(snap);
    expect(bubbles).toHaveLength(2);
    expect(bubbles.every((b) => b.kind === 'partner')).toBe(true);
    expect(bubbles.map((b) => b.id).sort()).toEqual([1, 2]);
  });

  it('shows nothing for an idle settler, and prefers the child bubble when both states hold', () => {
    const snap = snapshotOf([
      settlerAt(1, MAN, 3, 3, {}), // no family state
      settlerAt(2, WOMAN, 5, 5, { ChildOrder: { child: 'male' }, Wedding: { partner: 9, kissing: true } }),
    ]);

    expect(computeSettlerBubbles(snap)).toEqual([
      { id: 2, x: fx.fromInt(5), y: fx.fromInt(5), kind: 'child' },
    ]);
  });
});
