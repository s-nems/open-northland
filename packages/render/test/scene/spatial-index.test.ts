import { describe, expect, it } from 'vitest';
import { collectSpriteScene, SpriteSpatialIndex } from '../../src/data/scene/index.js';
import { ONE, tileToScreen, type Viewport } from '../../src/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';

/**
 * The retained {@link SpriteSpatialIndex} and the indexed scene build. The contract under test: with
 * an index, `collectSpriteScene` walks only the buckets under the viewport yet emits EXACTLY the items
 * of the full walk (the golden-visuals guarantee), while `liveRefs` keeps answering map-wide liveness
 * as a membership view. The index survives across snapshots: moves re-bucket, deaths stop answering.
 */

/** A viewport framing just the anchor of tile `(x, y)` - the same ±10 px box the culling specs use. */
function viewportAt(x: number, y: number): Viewport {
  const anchor = tileToScreen(x, y);
  return { minX: anchor.x - 10, maxX: anchor.x + 10, minY: anchor.y - 10, maxY: anchor.y + 10 };
}

describe('collectSpriteScene with a SpriteSpatialIndex', () => {
  it('emits exactly the full walk’s items across culls (viewport, statics, fog)', () => {
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Settler: { tribe: 0 } }), // framed
      entity(2, 40, 40, { Settler: { tribe: 0 } }), // far off-screen
      entity(3, 1, 1, { Resource: { goodType: 1 } }), // framed but statically drawn
      entity(4, 2, 1, { Resource: { goodType: 1 } }), // framed, pool-drawn
      entity(5, 1, 2, { Settler: { tribe: 0 } }), // framed but fogged
      entity(6, 1, 1, {}), // not drawable
    ]);
    const opts = {
      // Frame tiles (1..2, 1..2): rows 1 and 2, columns 1 and 2 - everything but the far settler.
      viewport: { ...viewportAt(1, 1), maxX: viewportAt(2, 1).maxX, maxY: viewportAt(1, 2).maxY },
      staticRefs: new Set([3]),
      fogVisible: (_x: number, tileY: number) => tileY < 2,
      ghosts: [{ ref: 9, kind: 'building', tileX: 1, tileY: 1, typeId: 7 } as const],
    };
    const indexed = collectSpriteScene(snapshot, { ...opts, index: new SpriteSpatialIndex() });
    const walked = collectSpriteScene(snapshot, opts);
    expect(indexed.items).toEqual(walked.items);
    expect(indexed.items.map((d) => d.ref)).toContain(4);
    // Map-wide liveness holds without the walk: culled (2), fogged (5) and ghost (9) refs live; the
    // statically drawn (3), the non-drawable (6) and the never-alive (7) do not.
    for (const scene of [indexed, walked]) {
      expect([1, 2, 3, 4, 5, 6, 7, 9].filter((ref) => scene.liveRefs.has(ref))).toEqual([1, 2, 4, 5, 9]);
    }
  });

  it('serves camera pans over one snapshot: each viewport sees its own entities', () => {
    const index = new SpriteSpatialIndex();
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Settler: { tribe: 0 } }),
      entity(2, 40, 40, { Settler: { tribe: 0 } }),
    ]);
    const near = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), index });
    const far = collectSpriteScene(snapshot, { viewport: viewportAt(40, 40), index });
    expect(near.items.map((d) => d.ref)).toEqual([1]);
    expect(far.items.map((d) => d.ref)).toEqual([2]);
  });

  it('re-buckets a moved entity and stops serving a dead one on the next snapshot', () => {
    const index = new SpriteSpatialIndex();
    const doomed = entity(2, 1, 1, { Settler: { tribe: 0 } });
    const before = snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } }), doomed]);
    expect(collectSpriteScene(before, { viewport: viewportAt(1, 1), index }).items.map((d) => d.ref)).toEqual(
      [1, 2],
    );
    // Next tick: 1 walked far away, 2 died. The stale bucket entries must neither draw nor stay live.
    const after = snapshotOf([entity(1, 40, 40, { Settler: { tribe: 0 } })], 2);
    const oldSpot = collectSpriteScene(after, { viewport: viewportAt(1, 1), index });
    expect(oldSpot.items).toEqual([]);
    expect(oldSpot.liveRefs.has(1)).toBe(true); // alive, merely elsewhere
    expect(oldSpot.liveRefs.has(2)).toBe(false); // dead - the pool may reap its sprite
    const newSpot = collectSpriteScene(after, { viewport: viewportAt(40, 40), index });
    expect(newSpot.items.map((d) => d.ref)).toEqual([1]);
  });

  it('picks up an entity that became drawable after the index first saw it', () => {
    const index = new SpriteSpatialIndex();
    // A bare mover: Position but no drawable marker - indexed as nothing.
    collectSpriteScene(snapshotOf([entity(1, 1, 1, {})]), { viewport: viewportAt(1, 1), index });
    const grown = collectSpriteScene(snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } })], 2), {
      viewport: viewportAt(1, 1),
      index,
    });
    expect(grown.items.map((d) => d.ref)).toEqual([1]);
    expect(grown.liveRefs.has(1)).toBe(true);
  });

  it('reuses an identity-stable entity across snapshots (the scenery clone contract)', () => {
    const index = new SpriteSpatialIndex();
    const tree = entity(1, 1, 1, { Resource: { goodType: 1 } });
    collectSpriteScene(snapshotOf([tree]), { viewport: viewportAt(1, 1), index });
    // The same OBJECT in the next snapshot - the sim's scenery clone cache hands these out verbatim.
    const again = collectSpriteScene(snapshotOf([tree], 2), { viewport: viewportAt(1, 1), index });
    expect(again.items.map((d) => d.ref)).toEqual([1]);
    expect(again.liveRefs.has(1)).toBe(true);
  });

  it('force-emits the off-screen portrait subject through the id fallback, tagged portraitOnly', () => {
    const index = new SpriteSpatialIndex();
    const snapshot = snapshotOf([
      entity(1, 1, 1, { Settler: { tribe: 0 } }),
      entity(2, 40, 40, { Settler: { tribe: 0 } }), // outside every queried bucket
    ]);
    const scene = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), index, portraitRef: 2 });
    const subject = scene.items.find((d) => d.ref === 2);
    expect(subject?.portraitOnly).toBe(true);
    expect(scene.items.map((d) => d.ref).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('emits signpost boards identically, their synthetic refs live only while the post draws', () => {
    const index = new SpriteSpatialIndex();
    const snapshot = snapshotOf([
      entity(1, 0, 0, { Signpost: { navRadius: 6 }, Owner: { player: 1 } }),
      entity(2, 4, 0, { Signpost: { navRadius: 5 }, Owner: { player: 1 } }),
    ]);
    const viewport = { ...viewportAt(0, 0), maxX: viewportAt(4, 0).maxX }; // frame both posts
    const indexed = collectSpriteScene(snapshot, { viewport, index });
    const walked = collectSpriteScene(snapshot, { viewport });
    expect(indexed.items).toEqual(walked.items);
    const boardRefs = indexed.items.filter((d) => d.ref < 0).map((d) => d.ref);
    expect(boardRefs.length).toBeGreaterThan(0);
    for (const ref of boardRefs) {
      expect(indexed.liveRefs.has(ref)).toBe(true);
      expect(walked.liveRefs.has(ref)).toBe(true);
    }
    // Panned away, the posts stop drawing, so their boards stop being live (walk parity: the board
    // push runs after the post's cull) while the posts stay live through the index.
    const away = collectSpriteScene(snapshot, { viewport: viewportAt(40, 40), index });
    for (const ref of boardRefs) expect(away.liveRefs.has(ref)).toBe(false);
    expect(away.liveRefs.has(1)).toBe(true);
  });

  it('answers a released static on the frame its ref leaves the (in-place mutated) set', () => {
    const index = new SpriteSpatialIndex();
    const staticRefs = new Set([1]);
    const snapshot = snapshotOf([entity(1, 1, 1, { Resource: { goodType: 1 } })]);
    const before = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), staticRefs, index });
    expect(before.items).toEqual([]);
    expect(before.liveRefs.has(1)).toBe(false);
    staticRefs.delete(1); // the static→dynamic handover mutates the caller's set between frames
    const after = collectSpriteScene(snapshot, { viewport: viewportAt(1, 1), staticRefs, index });
    expect(after.items.map((d) => d.ref)).toEqual([1]);
    expect(after.liveRefs.has(1)).toBe(true);
  });
});

describe('SpriteSpatialIndex directly', () => {
  it('query is a viewport superset: every anchor inside the box is returned', () => {
    const index = new SpriteSpatialIndex();
    // A diagonal band of settlers; the viewport frames a middle slice exactly.
    const entities = Array.from({ length: 20 }, (_, i) =>
      entity(i + 1, 2 * (i + 1), 2 * (i + 1), { Settler: { tribe: 0 } }),
    );
    index.update(snapshotOf(entities));
    const lo = tileToScreen(10, 10);
    const hi = tileToScreen(20, 20);
    const got = index.query({ minX: lo.x, minY: lo.y, maxX: hi.x, maxY: hi.y });
    const inside = entities.filter((e) => {
      const pos = e.components.Position as { x: number; y: number };
      const anchor = tileToScreen(pos.x / ONE, pos.y / ONE);
      return anchor.x >= lo.x && anchor.x <= hi.x && anchor.y >= lo.y && anchor.y <= hi.y;
    });
    expect(inside.length).toBeGreaterThan(3); // the slice is non-trivial
    for (const e of inside) expect(got).toContain(e);
  });

  it('serves a see-everything viewport off the populated buckets, not the empty box area', () => {
    const index = new SpriteSpatialIndex();
    index.update(
      snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } }), entity(2, 40, 40, { Settler: { tribe: 0 } })]),
    );
    // ±1e6 px spans ~61M bucket cells; scanning them (instead of the 2 populated buckets) hangs the
    // pool tests that frame everything - this must return promptly with the full population.
    const all = index.query({ minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 });
    expect(all.map((e) => e.id).sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('update is idempotent per snapshot object and gates has() on the current one', () => {
    const index = new SpriteSpatialIndex();
    const first = snapshotOf([entity(1, 1, 1, { Settler: { tribe: 0 } })]);
    index.update(first);
    index.update(first); // same object - must not double-insert or advance liveness
    expect(index.query(viewportAt(1, 1))).toHaveLength(1);
    expect(index.has(1)).toBe(true);
    index.update(snapshotOf([], 2));
    expect(index.has(1)).toBe(false);
    expect(index.query(viewportAt(1, 1))).toEqual([]);
  });
});
