import { describe, expect, it } from 'vitest';
import { collectSpriteScene, type SpriteScene } from '../../src/data/scene/index.js';
import { buildSpriteScene, ONE, tileToScreen } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/** `liveRefs` is a membership view, so exact-set assertions probe it over the fixture's id universe. */
const liveOf = (scene: SpriteScene, ids: readonly number[]): number[] =>
  ids.filter((id) => scene.liveRefs.has(id));

describe('collectSpriteScene - the single-pass draw list + liveness set', () => {
  // Collecting `liveRefs` after the cull would destroy and re-mint every off-screen sprite on each scroll.
  it('keeps a culled entity in liveRefs while dropping it from items', () => {
    const near = tileToScreen(1, 1);
    const viewport = { minX: near.x - 10, maxX: near.x + 10, minY: near.y - 10, maxY: near.y + 10 };
    const scene = collectSpriteScene(
      snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } }), entity(2, 40, 40, { Settler: { tribe: 0 } })]),
      { viewport },
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect(liveOf(scene, [1, 2])).toEqual([1, 2]);
  });

  it('excludes non-drawable entities from BOTH items and liveRefs (they were never pooled)', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }),
        entity(2, 1, 1, {}), // a Position with no drawable marker
      ]),
    );
    expect(scene.items.map((d) => d.ref)).toEqual([1]);
    expect(liveOf(scene, [1, 2])).toEqual([1]);
  });

  // A virgin map resource is drawn by the retained static object layer, so the pool must neither draw
  // nor pool it until first touch releases the ref.
  it('skips staticRefs entities from both items and liveRefs, and draws them once released', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Resource: { goodType: 1 } }),
      entity(2, 2, 1, { Resource: { goodType: 1 } }),
    ]);
    const withStatic = collectSpriteScene(snapshot, { staticRefs: new Set([1]) });
    expect(withStatic.items.map((d) => d.ref)).toEqual([2]);
    expect(liveOf(withStatic, [1, 2])).toEqual([2]);
    const released = collectSpriteScene(snapshot, { staticRefs: new Set() });
    expect(released.items.map((d) => d.ref)).toEqual([1, 2]);
  });

  // The original's carrier vanishes into the house for an exchange with a completed store (observation),
  // so it is kept pooled but not drawn for the atomic's duration. A pile, flag, or site is not enterable.
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
        // deposits into the completed building
        entity(1, 2, 2, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 10 } } }),
        // lifts from the completed building
        entity(2, 2, 2, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 } },
        }),
        // delivers to the construction site
        entity(3, 4, 4, { Settler: { tribe: 0 }, CurrentAtomic: { effect: { kind: 'pileup', store: 11 } } }),
        // lifts from the loose ground pile
        entity(4, 6, 6, {
          Settler: { tribe: 0 },
          CurrentAtomic: { effect: { kind: 'pickup', from: 12, goodType: 1, amount: 1 } },
        }),
      ]),
    );
    const drawnSettlers = scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref);
    expect(drawnSettlers.sort()).toEqual([3, 4]);
    expect(liveOf(scene, [1, 2, 3, 4, 10, 11, 12])).toEqual([1, 2, 3, 4, 10, 11, 12]);
  });

  it('hides a settler RESTING inside its workplace (waiting between chores), keeping it live', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
        entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 } }),
        entity(2, 3, 3, { Settler: { tribe: 0 } }),
      ]),
    );
    expect(scene.items.filter((d) => d.kind === 'settler').map((d) => d.ref)).toEqual([2]);
    expect(liveOf(scene, [1, 2, 10])).toEqual([1, 2, 10]);
  });

  it('keepIndoorSettlers keeps the indoor settlers, forcing away a lingering gait/swing', () => {
    // Each indoor settler carries state the forcing must override, not a bare settler that would read
    // idle anyway: a stale PathFollow reads `moving`, and a live pickup atomic reads `acting` and drags
    // its atomicId/elapsed along.
    const entities = [
      entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
      entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 }, PathFollow: {} }),
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
    // `frozen` lets the caller read indoor state off the item instead of differencing two builds.
    expect(drawn.every((d) => d.frozen === true)).toBe(true);
  });

  // Narrowing the snapshot instead would blind the whole-snapshot pre-scans: no buildings (nothing reads
  // as indoor) and no action targets (nothing faces its work). It stays a `buildSpriteScene` option
  // because it also narrows `liveRefs`, which a reconcile would read as deaths.
  describe('onlyRefs narrows the emit while the pre-scans still read the whole snapshot', () => {
    const storeScene = snapshotOf([
      entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
      entity(1, 2, 2, {
        Settler: { tribe: 0 },
        CurrentAtomic: { effect: { kind: 'pickup', from: 10, goodType: 1, amount: 1 } },
      }),
      entity(2, 3, 3, { Settler: { tribe: 0 } }),
    ]);

    it('resolves the store worker as indoor - the store is not among the emitted refs', () => {
      const items = buildSpriteScene(storeScene, { keepIndoorSettlers: true, onlyRefs: new Set([1]) });
      expect(items.map((d) => d.ref)).toEqual([1]);
      expect(items[0]?.frozen).toBe(true);
    });

    it('faces a harvester at the node it works - the node is not among the emitted refs', () => {
      // The woodcutter at odd row (1,1) chops the tree one column east (2,1), which is block 4; its
      // lingering path points west, so a stale-facing regression reads block 1.
      const items = buildSpriteScene(
        snapshotOf([
          entity(1, 1, 1, {
            Settler: { tribe: 0 },
            CurrentAtomic: { atomicId: 24, elapsed: 3, targetEntity: 2, targetTile: null },
            PathFollow: { waypoints: [{ x: 0 * ONE, y: 1 * ONE }], index: 0 },
          }),
          entity(2, 2, 1, { Resource: { goodType: 1, remaining: 3 } }),
        ]),
        { onlyRefs: new Set([1]) },
      );
      expect(items.map((d) => d.ref)).toEqual([1]);
      expect(items[0]?.facing).toBe(4);
    });
  });

  it('maps an owned item’s team-colour slot through playerColourOf, leaving an unowned one alone', () => {
    const scene = collectSpriteScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 }, Owner: { player: 3 } }),
        entity(2, 2, 1, { Settler: { tribe: 0 } }),
      ]),
      { playerColourOf: (player) => player + 10 },
    );
    expect(scene.items.find((d) => d.ref === 1)?.player).toBe(13);
    expect(scene.items.find((d) => d.ref === 2)?.player).toBeUndefined();
  });

  // `portraitOnly` tells the pool to hide the item on the main map and draw it only in the portrait's
  // second render.
  it('portraitRef force-draws its off-screen subject, tagged portraitOnly (not frozen)', () => {
    const near = tileToScreen(1, 1);
    const viewport = { minX: near.x - 10, maxX: near.x + 10, minY: near.y - 10, maxY: near.y + 10 };
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Settler: { tribe: 0 } }),
      entity(2, 40, 40, { Settler: { tribe: 0 } }),
    ]);
    // Control: the far settler is culled without the force.
    expect(collectSpriteScene(snapshot, { viewport }).items.map((d) => d.ref)).toEqual([1]);
    const forced = collectSpriteScene(snapshot, { viewport, portraitRef: 2 });
    const far = forced.items.find((d) => d.ref === 2);
    expect(far?.portraitOnly).toBe(true);
    expect(far?.frozen).toBeUndefined(); // outdoors, so it still animates in the cutout
  });

  it('portraitRef keeps its indoor subject, tagged portraitOnly + frozen (a still standing pose)', () => {
    const snapshot = snapshotOf([
      entity(10, 2, 2, { Building: { buildingType: 1, tribe: 1, built: ONE, level: 0 } }),
      entity(1, 2, 2, { Settler: { tribe: 0 }, Resting: { at: 10 } }), // waiting inside its workplace
    ]);
    // Control: the indoor settler is normally hidden.
    expect(collectSpriteScene(snapshot).items.some((d) => d.ref === 1)).toBe(false);
    const forced = collectSpriteScene(snapshot, { portraitRef: 1 });
    const subject = forced.items.find((d) => d.ref === 1);
    expect(subject?.portraitOnly).toBe(true);
    expect(subject?.frozen).toBe(true);
    expect(subject?.state).toBe('idle');
  });
});
