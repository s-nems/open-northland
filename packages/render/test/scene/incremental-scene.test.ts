import {
  type EntityDelta,
  type EntitySnapshot,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { SpriteDepthOrder } from '../../src/data/scene/depth-order.js';
import {
  collectSpriteScene,
  IncrementalScene,
  SceneItemMemo,
  type SpriteDrawItem,
} from '../../src/data/scene/index.js';
import type { SpriteSceneOptions } from '../../src/data/scene/sprite-scene.js';
import { ONE, type Viewport } from '../../src/index.js';
import { entity, ghostSourceOf } from '../support/fixtures.js';

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

/** One build loop's builds of its options, and the same build from scratch to compare item by item. */
function buildLoop(): {
  incremental: IncrementalScene;
  build: (snapshot: WorldSnapshot, options?: SpriteSceneOptions) => SpriteDrawItem[];
  scratch: (snapshot: WorldSnapshot, options?: SpriteSceneOptions) => SpriteDrawItem[];
} {
  const incremental = new IncrementalScene();
  const order = new SpriteDepthOrder();
  const memo = new SceneItemMemo();
  return {
    incremental,
    build: (snapshot, options = {}) =>
      collectSpriteScene(snapshot, { viewport: VIEW, ...options }, order, memo, incremental).items,
    scratch: (snapshot, options = {}) => collectSpriteScene(snapshot, { viewport: VIEW, ...options }).items,
  };
}

/** A fog cull hiding the tiles of `hidden` (`x,y` of the floored tile). */
function fogHiding(hidden: readonly string[]): (tileX: number, tileY: number) => boolean {
  const set = new Set(hidden);
  return (x, y) => !set.has(`${Math.floor(x)},${Math.floor(y)}`);
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

  it('splices items field for field equal to a build from scratch', () => {
    const mirror = mirrorOf([
      entity(1, 1, 1, SETTLER),
      entity(2, 3, 2, tree(1)),
      entity(4, 2, 5, heap(3, 4)),
    ]);
    const { incremental, build, scratch } = buildLoop();
    build(mirror.snapshot());
    let snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    expect(build(snapshot)).toEqual(scratch(snapshot));
    snapshot = advance(mirror, [moved(4, 2, 5, heap(3, 9))]);
    expect(build(snapshot)).toEqual(scratch(snapshot));
    expect(incremental.spliced).toBe(true);
  });

  it('switches a felled tree to its stump within one delta', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1))]);
    const { incremental, build, scratch } = buildLoop();
    build(mirror.snapshot());
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]));
    const felled: EntityDelta = { id: 2, components: { Stump: { goodType: 1 } }, removed: ['Resource'] };
    const snapshot = advance(mirror, [felled]);
    const items = build(snapshot);
    expect(incremental.spliced).toBe(true);
    expect(items.find((item) => item.ref === 2)?.kind).toBe('stump');
    expect(items).toEqual(scratch(snapshot));
  });

  it('rebuilds the run when the fog cull answers otherwise', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const { incremental, build, scratch } = buildLoop();
    const clear = { fogVisible: fogHiding([]), fogEpoch: 1 };
    build(mirror.snapshot(), clear);
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]), clear);
    expect(incremental.spliced).toBe(true);
    const fogged = { fogVisible: fogHiding(['3,2']), fogEpoch: 2 };
    const snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    const items = build(snapshot, fogged);
    expect(incremental.spliced).toBe(false);
    expect(items.map((item) => item.ref)).not.toContain(2);
    expect(items).toEqual(scratch(snapshot, fogged));
  });

  it('rebuilds the run when the static layer takes fewer entities from the same set', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const { incremental, build, scratch } = buildLoop();
    const staticRefs = new Set([2]);
    build(mirror.snapshot(), { staticRefs });
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]), { staticRefs });
    staticRefs.delete(2);
    const snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    const items = build(snapshot, { staticRefs });
    expect(incremental.spliced).toBe(false);
    expect(items.map((item) => item.ref)).toContain(2);
    expect(items).toEqual(scratch(snapshot, { staticRefs }));
  });

  it('rebuilds the run when a presentation withholds an entity', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const { incremental, build, scratch } = buildLoop();
    build(mirror.snapshot());
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]));
    const withheld = { withheldRefs: new Set([3]) };
    const snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    const items = build(snapshot, withheld);
    expect(incremental.spliced).toBe(false);
    expect(items.map((item) => item.ref)).not.toContain(3);
    expect(items).toEqual(scratch(snapshot, withheld));
  });

  it('matches a build from scratch across a mirror rebuild', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const { build, scratch } = buildLoop();
    build(mirror.snapshot());
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]));
    const lastTick = mirror.tick ?? 0;
    const rebuilt = [entity(1, 2, 2, SETTLER), entity(2, 3, 2, tree(1)), entity(4, 5, 3, heap(1, 2))];
    mirror.apply(
      packSnapshotDelta({
        tick: lastTick + 1,
        sequence: lastTick,
        rebuild: true,
        touched: rebuilt.map((e) => ({ id: e.id, components: e.components, removed: [] })),
        removed: [],
        events: [],
      }),
    );
    let snapshot = mirror.snapshot();
    expect(build(snapshot)).toEqual(scratch(snapshot));
    snapshot = advance(mirror, [moved(1, 3, 3, SETTLER)]);
    expect(build(snapshot)).toEqual(scratch(snapshot));
  });

  it('draws the fog ghosts on a spliced build as from scratch', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1))]);
    const { incremental, build, scratch } = buildLoop();
    const ghosts = { ghosts: ghostSourceOf([{ ref: 90, kind: 'building', tileX: 5, tileY: 4, typeId: 7 }]) };
    build(mirror.snapshot(), ghosts);
    const snapshot = advance(mirror, [moved(1, 2, 1, SETTLER)]);
    const items = build(snapshot, ghosts);
    expect(incremental.spliced).toBe(true);
    expect(items.map((item) => item.ref)).toContain(90);
    expect(items).toEqual(scratch(snapshot, ghosts));
  });
});
