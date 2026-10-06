import {
  type EntityDelta,
  type EntitySnapshot,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { SpriteDepthOrder } from '../../src/data/scene/depth-order.js';
import { collectSpriteScene, IncrementalScene, SceneItemMemo } from '../../src/data/scene/index.js';
import { ONE, type Viewport } from '../../src/index.js';
import { entity } from '../support/fixtures.js';

/**
 * A build that keeps its self-contained items across deltas and splices only the touched ones must
 * produce exactly the items, in exactly the order, a build from scratch gives.
 */

const VIEW: Viewport = { minX: -200, minY: -200, maxX: 900, maxY: 600 };
const SETTLER = { Settler: { tribe: 0 } };
const tree = (goodType: number) => ({ Resource: { goodType } });
const heap = (goodType: number, amount: number) => ({ Stockpile: { goodType, amount } });

function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
  const mirror = new SnapshotMirror();
  const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
  mirror.apply(packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched, removed: [], events: [] }));
  return mirror;
}

function advance(mirror: SnapshotMirror, touched: readonly EntityDelta[], removed: readonly number[] = []) {
  const lastTick = mirror.tick ?? 0;
  mirror.apply(
    packSnapshotDelta({
      tick: lastTick + 1,
      sequence: lastTick,
      rebuild: false,
      touched,
      removed,
      events: [],
    }),
  );
  return mirror.snapshot();
}

const moved = (id: number, x: number, y: number, extra: Record<string, unknown>): EntityDelta => ({
  id,
  components: { Position: { x: x * ONE, y: y * ONE }, ...extra },
  removed: [],
});

/** The refs a build from scratch draws, in order. */
function fromScratch(snapshot: WorldSnapshot): number[] {
  return collectSpriteScene(snapshot, { viewport: VIEW }).items.map((item) => item.ref);
}

describe('IncrementalScene', () => {
  it('splices touched self-contained items into the kept run, matching a build from scratch', () => {
    const mirror = mirrorOf([
      entity(1, 1, 1, SETTLER),
      entity(2, 3, 2, tree(1)),
      entity(3, 4, 4, tree(2)),
      entity(4, 2, 5, heap(3, 4)),
      entity(5, 5, 1, SETTLER),
      entity(6, 60, 60, tree(1)), // off view
    ]);
    const incremental = new IncrementalScene();
    const order = new SpriteDepthOrder();
    const memo = new SceneItemMemo();
    const build = (snapshot: WorldSnapshot) =>
      collectSpriteScene(snapshot, { viewport: VIEW }, order, memo, incremental).items.map((i) => i.ref);

    let snapshot = mirror.snapshot();
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
    expect(incremental.spliced).toBe(false);

    // Settlers walk past the trees; nothing self-contained changes.
    snapshot = advance(mirror, [moved(1, 3, 3, SETTLER), moved(5, 4, 5, SETTLER)]);
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
    expect(incremental.spliced).toBe(true);

    // A heap changes, a tree is felled, a new heap appears, a tree enters the view.
    snapshot = advance(
      mirror,
      [
        moved(4, 2, 5, heap(3, 9)),
        moved(7, 3, 3, heap(5, 1)),
        moved(6, 4, 3, tree(1)),
        moved(1, 2, 2, SETTLER),
      ],
      [3],
    );
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
    expect(incremental.spliced).toBe(true);
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
  });

  it('rebuilds the run from scratch when the view moves', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1))]);
    const incremental = new IncrementalScene();
    const snapshot = mirror.snapshot();
    collectSpriteScene(snapshot, { viewport: VIEW }, undefined, undefined, incremental);
    const next = advance(mirror, [moved(1, 2, 1, SETTLER)]);
    collectSpriteScene(
      next,
      { viewport: { ...VIEW, minX: VIEW.minX + 1 } },
      undefined,
      undefined,
      incremental,
    );
    expect(incremental.spliced).toBe(false);
  });
});
