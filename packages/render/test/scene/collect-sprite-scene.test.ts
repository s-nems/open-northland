import { describe, expect, it } from 'vitest';
import { collectSpriteScene } from '../../src/data/scene/index.js';
import { ONE, tileToScreen } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** Unit tests for {@link collectSpriteScene} — the single-pass draw list + pre-cull liveness set the
 *  retained pool reconciles against (viewport / fog / static-ref culling, ghost adoption). */

describe('collectSpriteScene — the single-pass draw list + liveness set', () => {
  // The retained pool's destroy-vs-cull rule hangs on this invariant: a viewport-CULLED entity must
  // still be in `liveRefs` (alive, kept pooled for when it scrolls back) while absent from `items`
  // (not drawn). If `liveRefs` were ever collected after the cull, every off-screen sprite would be
  // destroyed and re-minted on each scroll — the churn the retained pool exists to prevent.
  it('keeps a culled entity in liveRefs while dropping it from items', () => {
    const near = tileToScreen(1, 1);
    // A viewport framing only the near settler's anchor; the far one (way off to the right) is culled.
    const viewport = { minX: near.x - 10, maxX: near.x + 10, minY: near.y - 10, maxY: near.y + 10 };
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }), // framed
        entity(2, 40, 40, { Settler: { tribe: 0 } }), // far off-screen — culled, still alive
      ]),
      { viewport },
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect([...scene.liveRefs].sort()).toEqual([1, 2]);
  });

  it('excludes non-drawable entities from BOTH items and liveRefs (they were never pooled)', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }),
        entity(2, 1, 1, {}), // a Position with no drawable marker (e.g. a pure mover)
      ]),
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect([...scene.liveRefs]).toEqual([1]);
  });

  // The `?map=` static→dynamic handover rule: a virgin map resource is drawn by the RETAINED static
  // object layer, so the pool must see it in NEITHER items (not drawn twice) NOR liveRefs (never
  // pooled). Releasing the ref (first-touch) makes the same entity draw normally on the next frame.
  it('skips staticRefs entities from both items and liveRefs, and draws them once released', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Resource: { goodType: 1 } }), // statically drawn (virgin map node)
      entity(2, 2, 1, { Resource: { goodType: 1 } }), // pool-drawn (admin spawn / handed over)
    ]);
    const withStatic = collectSpriteScene(snapshot, { staticRefs: new Set([1]) });
    expect(withStatic.items.map((d) => d.ref)).toEqual([2]);
    expect([...withStatic.liveRefs]).toEqual([2]);
    const released = collectSpriteScene(snapshot, { staticRefs: new Set() });
    expect(released.items.map((d) => d.ref)).toEqual([1, 2]);
  });

  // A settler exchanging goods with a completed BUILDING store (a pileup deposit / a pickup lift) has
  // walked INSIDE for the exchange (the original's carrier vanishes into the house — observed), so it
  // is kept alive/pooled but NOT drawn for the atomic's duration. A ground pile / flag / construction
  // site is not enterable — those exchanges keep the settler visible.
  it('hides a settler mid-exchange inside a completed building, but not at a ground pile or a site', () => {
    const building = entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } });
    const site = entity(11, 4, 4, {
      Building: { buildingType: 1, tribe: 1, built: ONE / 2, level: 0 },
      UnderConstruction: {},
    });
    const pile = entity(12, 6, 6, { Stockpile: { amounts: [[1, 2]] } });
    const scene = collectSpriteScene(
      snapshotOf([
        building,
        site,
        pile,
        // Depositing INTO the completed building — inside, not drawn.
        entity(1, 2, 2, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 10 } } }),
        // Lifting FROM the completed building — inside too (the fetch enters the same way).
        entity(2, 2, 2, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 } },
        }),
        // Delivering to a CONSTRUCTION SITE — no house to enter yet; stays visible.
        entity(3, 4, 4, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 11 } } }),
        // Lifting from a loose GROUND PILE — stays visible.
        entity(4, 6, 6, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 12, goodType: 1, amount: 1 } },
        }),
      ]),
    );
    const drawnSettlers = scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref);
    expect(drawnSettlers.sort()).toEqual([3, 4]); // the two inside (1, 2) are not drawn…
    expect([...scene.liveRefs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12]); // …but stay live
  });

  it('hides a settler RESTING inside its workplace (waiting between chores), keeping it live', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
        entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 } }), // waiting inside — not drawn
        entity(2, 3, 3, { Settler: { tribe: 0 } }), // an ordinary settler stays visible
      ]),
    );
    expect(scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref)).toEqual([2]);
    expect([...scene.liveRefs].sort((a, b) => a - b)).toEqual([1, 2, 10]);
  });

  // The details panel's worker field opts INTO drawing a building's indoor occupants: `keepIndoorSettlers`
  // turns the suppressed resting / mid-exchange settlers back into draw items, FORCED to the `idle`
  // standing pose (no stale gait, no orphan action swing) so they stand in the panel instead of vanishing.
  it('keepIndoorSettlers keeps the indoor settlers, forcing away a lingering gait/swing', () => {
    // Each indoor settler carries state the forcing must OVERRIDE — not a bare settler that would read
    // idle anyway: a stale PathFollow (would read `moving`) and a live pickup atomic (would read `acting`
    // and drag its atomicId/elapsed along). So the assertions below fail if the `!indoorSettler` guards
    // that force idle are dropped.
    const entities = [
      entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
      // Resting inside its workplace, still holding the path from the tick it stepped in — kept, forced idle.
      entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 }, PathFollow: {} }),
      // Mid-exchange inside the completed store, mid-atomic — kept, forced idle; its atomicId/elapsed must
      // NOT ride along (the pose is a plain stand, not a truncated pickup stoop).
      entity(2, 2, 2, {
        Settler: { tribe: 0 },
        CurrentAtomic: {
          atomicId: 22,
          elapsed: 6,
          effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 },
        },
      }),
    ];
    const drawn = collectSpriteScene(snapshotOf(entities), {
      keepIndoorSettlers: true,
    }).items.filter((d) => d.kind === 'settler');
    expect(drawn.map((d) => d.ref).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(drawn.every((d) => d.state === 'idle')).toBe(true);
    expect(drawn.every((d) => d.atomicId === undefined && d.elapsed === undefined)).toBe(true);
  });
});
