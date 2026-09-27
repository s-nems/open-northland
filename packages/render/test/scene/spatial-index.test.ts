import type { GfxInHouseProgram } from '@open-northland/data';
import {
  components,
  type EntityDelta,
  type EntitySnapshot,
  positionOfNode,
  SnapshotMirror,
  TILE_BUCKET_SIZE,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { isVisible } from '../../src/data/projection/index.js';
import { collectSpriteScene } from '../../src/data/scene/index.js';
import type { SpriteSceneOptions } from '../../src/data/scene/sprite-scene.js';
import { ONE, TILE_HALF_W, tileToScreen, type Viewport } from '../../src/index.js';
import { entity, ghostSourceOf, snapshotOf } from '../support/fixtures.js';

/**
 * A viewport build reads the snapshot's position index instead of walking every entity. These specs
 * hold it to the full walk: the same items as the no-viewport build culled by the same box.
 */

/** Half the side of the box {@link viewportAt} frames around one anchor, in px. */
const FRAME_HALF_PX = 10;

/** A viewport framing just the anchor of tile `(x, y)`, the same ±10 px box the culling specs use. */
function viewportAt(x: number, y: number): Viewport {
  const anchor = tileToScreen(x, y);
  return {
    minX: anchor.x - FRAME_HALF_PX,
    maxX: anchor.x + FRAME_HALF_PX,
    minY: anchor.y - FRAME_HALF_PX,
    maxY: anchor.y + FRAME_HALF_PX,
  };
}

/** The no-viewport build's items whose anchor the viewport keeps: what the indexed build must emit. */
function culledWalk(snapshot: WorldSnapshot, opts: SpriteSceneOptions & { viewport: Viewport }) {
  const { viewport, ...rest } = opts;
  return collectSpriteScene(snapshot, rest).items.filter((item) => isVisible(viewport, item.x, item.y));
}

const SETTLER = { Settler: { tribe: 0 } };
const TREE = { Resource: { goodType: 1 } };

/** A mirror at its first tick holding `entities`, the way the runtime receives the world. */
function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
  const mirror = new SnapshotMirror();
  const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
  mirror.apply({ tick: 1, baseTick: 0, rebuild: true, touched, removed: [], events: [] });
  return mirror;
}

/** Apply one tick's changes on top of the mirror's last tick. */
function advance(mirror: SnapshotMirror, touched: readonly EntityDelta[], removed: readonly number[] = []) {
  const baseTick = mirror.tick ?? 0;
  mirror.apply({ tick: baseTick + 1, baseTick, rebuild: false, touched, removed, events: [] });
  return mirror.snapshot();
}

describe('collectSpriteScene over the position index', () => {
  it('emits exactly the full walk’s items across culls (viewport, statics, fog)', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, SETTLER), // framed
      entity(2, 40, 40, SETTLER), // far off-screen
      entity(3, 1, 1, TREE), // framed but statically drawn
      entity(4, 2, 1, TREE), // framed, pool-drawn
      entity(5, 1, 2, SETTLER), // framed but fogged
      entity(6, 1, 1, {}), // not drawable
      { id: 8, components: SETTLER }, // not positioned
    ]);
    const opts = {
      // Frames tiles (1..2, 1..2), which is everything but the far settler.
      viewport: { ...viewportAt(1, 1), maxX: viewportAt(2, 1).maxX, maxY: viewportAt(1, 2).maxY },
      staticRefs: new Set([3]),
      fogVisible: (_x: number, tileY: number) => tileY < 2,
      ghosts: ghostSourceOf([{ ref: 9, kind: 'building', tileX: 1, tileY: 1, typeId: 7 }]),
    };
    const indexed = collectSpriteScene(snapshot, opts);
    expect(indexed.items).toEqual(culledWalk(snapshot, opts));
    expect(indexed.items.map((d) => d.ref)).toContain(4);
    // The culled (2), fogged (5) and ghost (9) refs stay live; the statically drawn (3), the unpositioned
    // (8) and the never-alive (7) do not. The positioned but undrawable 6 answers live, having no sprite.
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].filter((ref) => indexed.liveRefs.has(ref))).toEqual([
      1, 2, 4, 5, 6, 9,
    ]);
  });

  it('matches the culled full walk over a scattered map at every box, bucket edges included', () => {
    // Fractional positions on both row parities across several tile buckets, one kind per id class.
    const SPREAD_X = 7;
    const SPREAD_Y = 13;
    const MAP_TILES = 50;
    const COUNT = 400;
    const KINDS = [SETTLER, TREE, { Building: { buildingType: 7, tribe: 0 } }, { Stockpile: {} }];
    const entities = Array.from({ length: COUNT }, (_, i) =>
      entity(
        i + 1,
        ((i * SPREAD_X) % MAP_TILES) + (i % 4) / 4,
        ((i * SPREAD_Y) % MAP_TILES) + (i % 3) / 3,
        KINDS[i % KINDS.length] ?? SETTLER,
      ),
    );
    const snapshot = snapshotOf(entities);
    const boxes: Viewport[] = [
      { ...viewportAt(3, 3), maxX: viewportAt(9, 3).maxX, maxY: viewportAt(3, 9).maxY },
      { ...viewportAt(7.5, 7.5), maxX: viewportAt(16.5, 7.5).maxX, maxY: viewportAt(7.5, 16.5).maxY },
      { ...viewportAt(20, 11), maxX: viewportAt(35, 11).maxX, maxY: viewportAt(20, 40).maxY },
      { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 },
    ];
    for (const viewport of boxes) {
      const opts = { viewport, fogVisible: (tileX: number) => tileX < MAP_TILES / 2 };
      const indexed = collectSpriteScene(snapshot, opts).items;
      expect(indexed.length).toBeGreaterThan(0);
      expect(indexed).toEqual(culledWalk(snapshot, opts));
    }
  });

  it('keeps a vehicle whose drawn anchor is framed while its Position sits in the next tile bucket', () => {
    // Cell (8, 2) opens the second bucket column; the leg starts one cell west, at (7, 2), in the first.
    const at = positionOfNode(16, 4);
    const from = { hx: 14, hy: 4 };
    const cart = entity(1, at.x / ONE, at.y / ONE, {
      Vehicle: { vehicleType: 2, tribe: 1, task: 'none', facing: 0, passengers: [null], vehicles: [] },
      VehicleDrive: { goal: from, route: [], from, progress: 0, increment: components.NODE_PROGRESS_FULL },
    });
    const snapshot = snapshotOf([cart]);
    const opts = { viewport: viewportAt(7, 2) };
    expect(collectSpriteScene(snapshot, opts).items.map((d) => d.ref)).toEqual([1]);
    expect(collectSpriteScene(snapshot, opts).items).toEqual(culledWalk(snapshot, opts));
  });

  it('keeps a choreographed craftsman drawn at his framed workplace while he stands in the next bucket', () => {
    const VIKING = 1;
    const BAKER = 20;
    const MAKE_BREAD = 47;
    const BREAD = 19;
    const BAKERY_ID = 10;
    const BAKER_ID = 1;
    // The build culls a craftsman on his workplace's anchor, before the program's room offset; the
    // oracle culls the offset item, so the program plays at the anchor itself to keep both on one point.
    const program: GfxInHouseProgram = {
      tribe: VIKING,
      job: BAKER,
      action: MAKE_BREAD,
      entries: [
        { kind: 'walk', dir: 3, goodType: 0, x: 0, y: 0, from: 0, to: 0 },
        { kind: 'clip', action: MAKE_BREAD, subId: 1, dir: 5, from: 0, to: 100 },
      ],
    };
    // The bakery sits in the first bucket column; the baker's own Position, at its door, in the second.
    const bakery = entity(BAKERY_ID, 7, 5, {
      Building: { buildingType: 1, tribe: VIKING, built: ONE, level: 0 },
    });
    const baker = entity(BAKER_ID, 9, 7, {
      Settler: { tribe: VIKING, jobType: BAKER },
      Resting: { at: BAKERY_ID },
      CurrentAtomic: {
        atomicId: MAKE_BREAD,
        duration: 100,
        effect: { kind: 'produce', recipeOutput: BREAD },
        targetEntity: BAKERY_ID,
      },
      AtomicClock: { elapsed: 30 },
    });
    const snapshot = snapshotOf([bakery, baker]);
    const inHousePrograms = (tribe: number, job: number, action: number) =>
      tribe === VIKING && job === BAKER && action === MAKE_BREAD ? program : undefined;
    const viewport = viewportAt(7, 5);
    const door = tileToScreen(9, 7);
    expect(isVisible(viewport, door.x, door.y)).toBe(false);
    expect(viewport.maxX / (2 * TILE_HALF_W)).toBeLessThan(TILE_BUCKET_SIZE);
    const opts = { viewport, inHousePrograms };
    const indexed = collectSpriteScene(snapshot, opts).items;
    expect(indexed.map((d) => d.ref)).toContain(BAKER_ID);
    expect(indexed).toEqual(culledWalk(snapshot, opts));
  });

  it('serves camera pans over one snapshot: each viewport sees its own entities', () => {
    const snapshot = snapshotOf([entity(1, 1, 1, SETTLER), entity(2, 40, 40, SETTLER)]);
    const near = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1) });
    const far = collectSpriteScene(snapshot, { viewport: viewportAt(40, 40) });
    expect(near.items.map((d) => d.ref)).toEqual([1]);
    expect(far.items.map((d) => d.ref)).toEqual([2]);
  });

  it('serves a moved entity at its new spot and stops serving a dead one on the next mirror tick', () => {
    const mirror = mirrorOf([entity(1, 1, 1, SETTLER), entity(2, 1, 1, SETTLER)]);
    const before = collectSpriteScene(mirror.snapshot(), { viewport: viewportAt(1, 1) });
    expect(before.items.map((d) => d.ref)).toEqual([1, 2]);
    // Next tick 1 walked far away and 2 died.
    const moved = { id: 1, components: { Position: { x: 40 * ONE, y: 40 * ONE } }, removed: [] };
    const after = advance(mirror, [moved], [2]);
    const oldSpot = collectSpriteScene(after, { viewport: viewportAt(1, 1) });
    expect(oldSpot.items).toEqual([]);
    expect(oldSpot.liveRefs.has(1)).toBe(true); // alive, merely elsewhere
    expect(oldSpot.liveRefs.has(2)).toBe(false); // dead, so the pool may reap its sprite
    const newSpot = collectSpriteScene(after, { viewport: viewportAt(40, 40) });
    expect(newSpot.items.map((d) => d.ref)).toEqual([1]);
    expect(newSpot.items).toEqual(culledWalk(after, { viewport: viewportAt(40, 40) }));
  });

  it('picks up an entity that became drawable after the index first saw it', () => {
    // A bare mover: Position but no drawable marker, so nothing draws.
    const mirror = mirrorOf([entity(1, 1, 1, {})]);
    expect(collectSpriteScene(mirror.snapshot(), { viewport: viewportAt(1, 1) }).items).toEqual([]);
    const grown = collectSpriteScene(advance(mirror, [{ id: 1, components: SETTLER, removed: [] }]), {
      viewport: viewportAt(1, 1),
    });
    expect(grown.items.map((d) => d.ref)).toEqual([1]);
    expect(grown.liveRefs.has(1)).toBe(true);
  });

  it('force-emits the off-screen portrait subject through the id fallback, tagged portraitOnly', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, SETTLER),
      entity(2, 40, 40, SETTLER), // outside every queried bucket
    ]);
    const scene = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), portraitRef: 2 });
    const subject = scene.items.find((d) => d.ref === 2);
    expect(subject?.portraitOnly).toBe(true);
    expect(scene.items.map((d) => d.ref).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('emits signpost boards identically, their synthetic refs live only while the post draws', () => {
    const snapshot = snapshotOf([
      entity(1, 0, 0, { Signpost: { links: [2] }, Owner: { player: 1 } }),
      entity(2, 4, 0, { Signpost: { links: [1] }, Owner: { player: 1 } }),
    ]);
    const viewport = { ...viewportAt(0, 0), maxX: viewportAt(4, 0).maxX }; // frame both posts
    const indexed = collectSpriteScene(snapshot, { viewport });
    expect(indexed.items).toEqual(culledWalk(snapshot, { viewport }));
    const boardRefs = indexed.items.filter((d) => d.ref < 0).map((d) => d.ref);
    expect(boardRefs.length).toBeGreaterThan(0);
    for (const ref of boardRefs) expect(indexed.liveRefs.has(ref)).toBe(true);
    // Panned away the posts stop drawing, and the board push runs after the post's cull, so the boards
    // stop being live while the posts stay live through the index.
    const away = collectSpriteScene(snapshot, { viewport: viewportAt(40, 40) });
    for (const ref of boardRefs) expect(away.liveRefs.has(ref)).toBe(false);
    expect(away.liveRefs.has(1)).toBe(true);
  });

  it('answers a released static on the frame its ref leaves the (in-place mutated) set', () => {
    const staticRefs = new Set([1]);
    const snapshot = snapshotOf([entity(1, 1, 1, TREE)]);
    const before = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), staticRefs });
    expect(before.items).toEqual([]);
    expect(before.liveRefs.has(1)).toBe(false);
    staticRefs.delete(1); // the static→dynamic handover mutates the caller's set between frames
    const after = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), staticRefs });
    expect(after.items.map((d) => d.ref)).toEqual([1]);
    expect(after.liveRefs.has(1)).toBe(true);
  });
});
