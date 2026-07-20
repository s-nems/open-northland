import { fx, ONE, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { computeSettlerBubbles } from '../src/view/projections/index.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * computeSettlerBubbles — the pure snapshot→bubble projection the render layer floats over a settler's
 * head. It reads the standing family state the sim drives (a woman's `ChildOrder` shows the `child`
 * bubble until the birth; a `Wedding` in progress shows the `partner` bubble on both partners until they
 * marry) and the pressing needs (hunger/fatigue at the sim's satisfy thresholds show the `hungry`/`sleepy`
 * bubble). The bubble anchors on the settler's own `Position`.
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

  it('shows no hungry bubble at the EAT threshold — a settler that far along just goes and eats', () => {
    const sated = fx.div(ONE, fx.fromInt(2)); // below the ¾·ONE sleep trigger — no sleepy bubble
    const snap = snapshotOf([
      {
        // Over the eat trigger, so the drive is already taking it to a meal. This is the case that
        // used to light up half the map.
        id: 1,
        components: {
          Settler: { jobType: MAN, hunger: systems.HUNGER_EAT_THRESHOLD, fatigue: sated },
          Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
        },
      },
      {
        // Still climbing well past the eat trigger — it has been looking for food and not finding it.
        id: 2,
        components: {
          Settler: { jobType: MAN, hunger: systems.HUNGER_BUBBLE_THRESHOLD, fatigue: sated },
          Position: { x: fx.fromInt(2), y: fx.fromInt(1) },
        },
      },
    ]);

    expect(computeSettlerBubbles(snap).map((b) => [b.id, b.kind])).toEqual([[2, 'hungry']]);
  });

  it('keeps both bubble triggers above their drive triggers, so acting always comes first', () => {
    expect(systems.HUNGER_BUBBLE_THRESHOLD).toBeGreaterThan(systems.HUNGER_EAT_THRESHOLD);
    expect(systems.FATIGUE_BUBBLE_THRESHOLD).toBeGreaterThan(systems.FATIGUE_SLEEP_THRESHOLD);
  });

  it('shows no sleepy bubble at the SLEEP threshold — a settler that far along just goes to bed', () => {
    const snap = snapshotOf([
      {
        id: 1,
        components: {
          Settler: {
            jobType: MAN,
            hunger: fx.div(ONE, fx.fromInt(2)),
            fatigue: systems.FATIGUE_SLEEP_THRESHOLD,
          },
          Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
        },
      },
    ]);

    expect(computeSettlerBubbles(snap)).toEqual([]);
  });

  it('shows the sleepy bubble only past its own famine-style threshold, and hunger outranks it', () => {
    const sated = fx.div(ONE, fx.fromInt(2));
    const snap = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { jobType: MAN, hunger: sated, fatigue: systems.FATIGUE_BUBBLE_THRESHOLD },
          Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
        },
      },
      {
        // Starving AND exhausted: hunger wins, like the planner's eat-before-sleep rung order.
        id: 2,
        components: {
          Settler: { jobType: MAN, hunger: ONE, fatigue: ONE },
          Position: { x: fx.fromInt(2), y: fx.fromInt(1) },
        },
      },
      {
        id: 3,
        components: {
          Settler: { jobType: MAN, hunger: sated, fatigue: sated },
          Position: { x: fx.fromInt(3), y: fx.fromInt(1) },
        },
      },
    ]);

    expect(computeSettlerBubbles(snap).map((b) => [b.id, b.kind])).toEqual([
      [1, 'sleepy'],
      [2, 'hungry'],
    ]);
  });

  it('a family bubble outranks a pressing need bubble', () => {
    const snap = snapshotOf([
      {
        id: 1,
        components: {
          Settler: { jobType: WOMAN, hunger: ONE, fatigue: ONE },
          Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
          Wedding: { partner: 2, kissing: false },
        },
      },
    ]);

    expect(computeSettlerBubbles(snap).map((b) => b.kind)).toEqual(['partner']);
  });
});
