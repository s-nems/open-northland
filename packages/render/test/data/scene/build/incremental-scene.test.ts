import {
  type EntityDelta,
  type EntitySnapshot,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { SpriteDepthOrder } from '../../../../src/data/scene/build/depth-order.js';
import type { SpriteSceneOptions } from '../../../../src/data/scene/build/sprite-scene.js';
import {
  collectSpriteScene,
  IncrementalScene,
  SceneItemMemo,
  type SpriteDrawItem,
} from '../../../../src/data/scene/index.js';
import { ONE, tileToScreen, type Viewport } from '../../../../src/index.js';
import { entity, ghostSourceOf } from '../../../support/fixtures.js';

/**
 * A build that keeps its self-contained items across deltas and splices only the touched ones must
 * produce exactly the items, in exactly the order, a build from scratch gives.
 */

const VIEW: Viewport = { minX: -200, minY: -200, maxX: 900, maxY: 600 };
/** Screen px a widened view reaches past the entity it is widened to. */
const MARGIN = 50;
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
        moved(1, 2, 2, SETTLER),
        moved(4, 2, 5, heap(3, 9)),
        moved(6, 4, 3, tree(1)),
        moved(7, 3, 3, heap(5, 1)),
      ],
      [3],
    );
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
    expect(incremental.spliced).toBe(true);
    expect(build(snapshot)).toEqual(fromScratch(snapshot));
  });

  it('splices while portraits frame subjects on and off the view, as a build from scratch draws them', () => {
    const mirror = mirrorOf([
      entity(1, 1, 1, SETTLER),
      entity(2, 3, 2, tree(1)),
      entity(3, 4, 4, tree(2)),
      entity(5, 60, 60, SETTLER), // off view, the settler panel's subject
      entity(6, 70, 60, tree(1)), // off view, an inset's subject
    ]);
    const { incremental, build, scratch } = buildLoop();
    const framing: SpriteSceneOptions = { portraitRef: 5, insetRefs: [3, 6] };
    const drawn = (items: readonly SpriteDrawItem[]) => items.map((i) => [i.ref, i.portraitOnly === true]);
    let snapshot = mirror.snapshot();
    expect(drawn(build(snapshot, framing))).toEqual(drawn(scratch(snapshot, framing)));
    // A walker passes, then the framed trees change and the panel's subject walks into view.
    snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    expect(drawn(build(snapshot, framing))).toEqual(drawn(scratch(snapshot, framing)));
    expect(incremental.spliced).toBe(true);
    snapshot = advance(mirror, [moved(3, 4, 4, tree(3)), moved(5, 2, 4, SETTLER), moved(6, 70, 60, tree(2))]);
    expect(drawn(build(snapshot, framing))).toEqual(drawn(scratch(snapshot, framing)));
    expect(incremental.spliced).toBe(true);
    // A pan whose uncovered strip brings the inset's tree in draws it once.
    const far = tileToScreen(70, 60);
    const panned = { ...framing, viewport: { ...VIEW, maxX: far.x + MARGIN, maxY: far.y + MARGIN } };
    expect(drawn(build(snapshot, panned))).toEqual(drawn(scratch(snapshot, panned)));
    expect(incremental.spliced).toBe(true);
    // Closing the portraits hands the inset's tree back to the run.
    snapshot = advance(mirror, [moved(1, 3, 3, SETTLER)]);
    expect(drawn(build(snapshot))).toEqual(drawn(scratch(snapshot)));
    snapshot = advance(mirror, [moved(1, 2, 3, SETTLER)]);
    expect(drawn(build(snapshot))).toEqual(drawn(scratch(snapshot)));
    expect(incremental.spliced).toBe(true);
  });

  it('splices across a pan or zoom, keeping the run under the new view', () => {
    const forest: EntitySnapshot[] = [];
    let id = 1;
    for (let x = 0; x < 30; x += 2) for (let y = 0; y < 60; y += 3) forest.push(entity(id++, x, y, tree(1)));
    forest.push(entity(id++, 5, 5, SETTLER), entity(id++, 20, 40, heap(3, 4)));
    const mirror = mirrorOf(forest);
    const { incremental, build, scratch } = buildLoop();
    const views: Viewport[] = [
      VIEW,
      { minX: -150, minY: -200, maxX: 950, maxY: 600 }, // right
      { minX: -170, minY: -120, maxX: 930, maxY: 680 }, // left and down
      { minX: 0, minY: 0, maxX: 500, maxY: 400 }, // zoom in
      { minX: -400, minY: -300, maxX: 1400, maxY: 1000 }, // zoom out
    ];
    let snapshot = mirror.snapshot();
    build(snapshot);
    for (const viewport of views) {
      expect(build(snapshot, { viewport })).toEqual(scratch(snapshot, { viewport }));
      expect(incremental.spliced).toBe(true);
    }
    // A delta while the view moves: a tree in the uncovered strip is felled as it comes into view.
    snapshot = advance(mirror, [{ id: 2, components: { Stump: { goodType: 1 } }, removed: ['Resource'] }]);
    const panned = { viewport: { minX: -300, minY: -200, maxX: 800, maxY: 600 } };
    expect(build(snapshot, panned)).toEqual(scratch(snapshot, panned));
    expect(incremental.spliced).toBe(true);
  });

  it('keeps the other kinds across a pan over the same snapshot as from scratch', () => {
    const town: EntitySnapshot[] = [];
    let id = 1;
    for (let x = 0; x < 30; x += 3) {
      for (let y = 0; y < 60; y += 4) {
        town.push(entity(id++, x, y, SETTLER), entity(id++, x + 1, y + 1, tree(1)));
      }
    }
    town.push(
      entity(id++, 6, 8, { Signpost: { links: [id] }, Owner: { player: 1 } }),
      entity(id++, 10, 8, { Signpost: { links: [id - 2] }, Owner: { player: 1 } }),
      entity(id++, 12, 14, {
        Vehicle: { vehicleType: 2, tribe: 1, task: 'none', facing: 0, passengers: [null], vehicles: [] },
      }),
    );
    const mirror = mirrorOf(town);
    const incremental = new IncrementalScene();
    const order = new SpriteDepthOrder();
    const memo = new SceneItemMemo();
    const ghosts = ghostSourceOf([{ ref: 900, kind: 'building', tileX: 9, tileY: 12, typeId: 7 }]);
    const options = (viewport: Viewport): SpriteSceneOptions => ({ viewport, ghosts });
    const snapshot = mirror.snapshot();
    collectSpriteScene(snapshot, options(VIEW), order, memo, incremental);
    const views: Viewport[] = [
      { minX: -150, minY: -200, maxX: 950, maxY: 600 },
      { minX: -170, minY: -120, maxX: 930, maxY: 680 },
      { minX: 300, minY: 200, maxX: 800, maxY: 600 },
      { minX: -400, minY: -300, maxX: 1400, maxY: 1000 },
      { minX: 200, minY: 100, maxX: 1300, maxY: 900 },
      VIEW,
    ];
    for (const viewport of views) {
      const scene = collectSpriteScene(snapshot, options(viewport), order, memo, incremental);
      expect(incremental.spliced).toBe(true);
      expect(scene.items).toEqual(collectSpriteScene(snapshot, options(viewport)).items);
      for (const item of scene.items) expect(scene.liveRefs.has(item.ref)).toBe(true);
    }
    expect(collectSpriteScene(snapshot, options(VIEW)).items.some((item) => item.ref < 0)).toBe(true);
  });

  it('refreshes a retained flag when only its holder changes owner or releases it', () => {
    const mirror = mirrorOf([
      entity(1, 1, 1, { DeliveryFlag: {} }),
      entity(2, 2, 1, { Settler: {}, Owner: { player: 2 }, WorkFlag: { flag: 1 } }),
    ]);
    const { build, scratch } = buildLoop();
    const options = { playerColourOf: (player: number) => player + 3 };
    expect(build(mirror.snapshot(), options).find((item) => item.ref === 1)?.player).toBe(5);
    let snapshot = advance(mirror, [{ id: 2, components: { Owner: { player: 4 } }, removed: [] }]);
    expect(build(snapshot, options).find((item) => item.ref === 1)?.player).toBe(7);
    expect(build(snapshot, options)).toEqual(scratch(snapshot, options));
    snapshot = advance(mirror, [{ id: 2, components: {}, removed: ['WorkFlag'] }]);
    expect(build(snapshot, options).find((item) => item.ref === 1)?.player).toBeUndefined();
  });

  it('keeps every self-contained kind across pans as a build from scratch draws it', () => {
    const kinds: readonly Record<string, unknown>[] = [
      tree(1),
      { Stump: { goodType: 1 } },
      { BerryBush: { berries: 3 } },
      { Chest: {} },
      heap(3, 4),
      { GroundDrop: {}, Stockpile: { goodType: 2, amount: 1 } },
      { FishSwarm: { count: 5 } },
      { DeliveryFlag: {} },
    ];
    const statics: EntitySnapshot[] = [];
    let id = 1;
    for (let x = 0; x < 30; x++) {
      for (let y = 0; y < 50; y += 3) statics.push(entity(id, x, y, kinds[id++ % kinds.length] ?? {}));
    }
    const mirror = mirrorOf(statics);
    const { incremental, build, scratch } = buildLoop();
    const snapshot = mirror.snapshot();
    build(snapshot);
    const views: Viewport[] = [
      { minX: -100, minY: -150, maxX: 1000, maxY: 650 },
      { minX: 37, minY: 11, maxX: 1137, maxY: 811 },
      { minX: 500, minY: 400, maxX: 1300, maxY: 1100 },
      { minX: -300, minY: -300, maxX: 2200, maxY: 2000 },
    ];
    const drawnKinds = new Set<string>();
    for (const viewport of views) {
      const items = build(snapshot, { viewport });
      expect(incremental.spliced).toBe(true);
      expect(items).toEqual(scratch(snapshot, { viewport }));
      for (const item of items) drawnKinds.add(item.kind);
    }
    expect([...drawnKinds].sort()).toEqual(
      ['berrybush', 'chest', 'fish', 'grounddrop', 'resource', 'stockpile', 'stump'].sort(),
    );
  });

  it('releases the kept items a pan leaves behind', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 1, 2, tree(1)), entity(3, 10, 4, tree(2))]);
    const incremental = new IncrementalScene();
    const snapshot = mirror.snapshot();
    const left = { minX: -200, minY: -200, maxX: 300, maxY: 600 };
    collectSpriteScene(snapshot, { viewport: left }, undefined, undefined, incremental);
    const scene = collectSpriteScene(
      snapshot,
      { viewport: { ...left, minX: 200, maxX: 900 } },
      undefined,
      undefined,
      incremental,
    );
    expect(incremental.spliced).toBe(true);
    expect(scene.items.map((item) => item.ref)).toEqual([3]);
    expect([...(scene.releasedStatics ?? [])]).toEqual([2]);
  });

  it('rebuilds the run from scratch when the view jumps clear of the last one', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1))]);
    const incremental = new IncrementalScene();
    const snapshot = mirror.snapshot();
    collectSpriteScene(snapshot, { viewport: VIEW }, undefined, undefined, incremental);
    const next = advance(mirror, [moved(1, 2, 1, SETTLER)]);
    collectSpriteScene(
      next,
      { viewport: { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 } },
      undefined,
      undefined,
      incremental,
    );
    expect(incremental.spliced).toBe(false);
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

  it('splices the entities a presentation withholds and hands back', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const { incremental, build, scratch } = buildLoop();
    build(mirror.snapshot());
    build(advance(mirror, [moved(1, 2, 1, SETTLER)]));
    const withheld = { withheldRefs: new Set([3]) };
    let snapshot = advance(mirror, [moved(1, 2, 2, SETTLER)]);
    let scene = build(snapshot, withheld);
    expect(incremental.spliced).toBe(true);
    expect(scene.map((item) => item.ref)).not.toContain(3);
    expect(scene).toEqual(scratch(snapshot, withheld));
    const swapped = { withheldRefs: new Set([2]) };
    snapshot = advance(mirror, [moved(1, 3, 3, SETTLER)]);
    scene = build(snapshot, swapped);
    expect(incremental.spliced).toBe(true);
    expect(scene.map((item) => item.ref)).toContain(3);
    expect(scene.map((item) => item.ref)).not.toContain(2);
    expect(scene).toEqual(scratch(snapshot, swapped));
  });

  it('names the entities a withheld set gained or lost among the released statics', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 3, 2, tree(1)), entity(3, 4, 4, tree(2))]);
    const incremental = new IncrementalScene();
    const options = (withheldRefs?: ReadonlySet<number>) => ({ viewport: VIEW, withheldRefs });
    collectSpriteScene(mirror.snapshot(), options(new Set([2])), undefined, undefined, incremental);
    const scene = collectSpriteScene(
      advance(mirror, [moved(1, 2, 1, SETTLER)]),
      options(new Set([3])),
      undefined,
      undefined,
      incremental,
    );
    expect(incremental.spliced).toBe(true);
    expect([...(scene.releasedStatics ?? [])].sort()).toEqual([2, 3]);
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
