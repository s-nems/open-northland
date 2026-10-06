import {
  type EntityDelta,
  type EntitySnapshot,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { Container, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { ONE, type SpriteAtlas, type SpriteSheet, type Viewport } from '../../src/index.js';
import { entity } from '../support/fixtures.js';

/**
 * On a tick that leaves a self-contained entity untouched, the pool neither presents nor revisits it:
 * it stays attached, sighted and pickable. A delta touching it, or a selection naming it, brings it back.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW: Viewport = { minX: -500, maxX: 1500, minY: -500, maxY: 1500 };
const source = new TextureSource({ width: 64, height: 64 });
const BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas,
  bindings: { settler: BOB, resource: BOB, building: BOB },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BOB } } },
};
const SETTLER = 1;
const TREE = 2;
const HEAP = 3;
const POST = 4;
const walker = { Settler: { tribe: 0 } };

function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
  const mirror = new SnapshotMirror();
  const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
  mirror.apply(packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched, removed: [], events: [] }));
  return mirror;
}

function advance(
  mirror: SnapshotMirror,
  touched: readonly EntityDelta[],
  removed: readonly number[] = [],
): WorldSnapshot {
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

const moved = (id: number, x: number, extra: Record<string, unknown>): EntityDelta => ({
  id,
  components: { Position: { x: x * ONE, y: ONE }, ...extra },
  removed: [],
});

function frameOf(snapshot: WorldSnapshot, fields: Partial<PoolFrame> = {}): PoolFrame {
  return {
    snapshot,
    viewport: VIEW,
    tick: snapshot.tick,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    ...fields,
  };
}

function presentedRefs(): () => number[] {
  type PresentPooled = (pe: unknown, item: DrawItem) => void;
  const spy = vi.spyOn(SpritePool.prototype as unknown as { presentPooled: PresentPooled }, 'presentPooled');
  return () => spy.mock.calls.map((call) => call[1].ref);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpritePool - held self-contained entities', () => {
  const start = () =>
    mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
      entity(HEAP, 6, 1, { Stockpile: { goodType: 2, amount: 3 } }),
    ]);

  it('skips an untouched tree on a tick and keeps it drawn and pickable', () => {
    const mirror = start();
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot()));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)])));
    const refs = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker)])));
    expect(refs()).toContain(SETTLER);
    expect(refs()).not.toContain(TREE);
    expect(pool.boundsOf(TREE)).toBeDefined();
    expect(pool.anchorOf(TREE)).toBeDefined();
    expect(pool.drawnItems().map((item) => item.ref)).toContain(TREE);
    expect(layer.children.length).toBeGreaterThan(0);
  });

  it('presents a touched heap again, and a held tree once a selection names it', () => {
    const mirror = start();
    const pool = new SpritePool(new Container(), new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot()));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)])));
    const refs = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(HEAP, 6, { Stockpile: { goodType: 2, amount: 4 } })])));
    expect(refs()).toContain(HEAP);
    expect(refs()).not.toContain(TREE);
    pool.reconcile(
      frameOf(advance(mirror, [moved(SETTLER, 3, walker)]), {
        selection: new Set([TREE]),
        selectionStyle: 'outline',
      }),
    );
    expect(refs()).toContain(TREE);
  });
});

describe('SpritePool - what releases a held tree', () => {
  const start = () =>
    mirrorOf([entity(SETTLER, 1, 1, walker), entity(TREE, 4, 1, { Resource: { goodType: 1 } })]);
  /** A pool two ticks in, the tree held since the second. */
  const held = (fields: Partial<PoolFrame> = {}) => {
    const mirror = start();
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot(), fields));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)]), fields));
    return { mirror, layer, pool };
  };
  const nextTick = (mirror: SnapshotMirror) => advance(mirror, [moved(SETTLER, 3, walker)]);

  it.each<[string, Partial<PoolFrame>]>([
    ['the wind rising', { wind: { strength: 1, direction: 0, gust: 0 } }],
    ['the motion setting flipping', { environmentMotion: false }],
    ['an assignment highlight', { highlight: new Map([[TREE, true]]) }],
    ['another selection style', { selectionStyle: 'pulse' }],
  ])('presents it again on %s', (_name, change) => {
    const { mirror, pool } = held({ environmentMotion: true });
    const refs = presentedRefs();
    pool.reconcile(frameOf(nextTick(mirror), { environmentMotion: true, ...change }));
    expect(refs()).toContain(TREE);
  });

  it('presents it to clear its emphasis once deselected, and holds it again after', () => {
    const { mirror, pool } = held();
    const selected = { selection: new Set([TREE]), selectionStyle: 'outline' as const };
    pool.reconcile(frameOf(nextTick(mirror), selected));
    const refs = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 4, walker)])));
    expect(refs()).toContain(TREE);
    const later = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 5, walker)])));
    expect(later().filter((ref) => ref === TREE).length).toBe(refs().filter((ref) => ref === TREE).length);
  });

  it('detaches it once a delta removes it', () => {
    const { mirror, layer, pool } = held();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker)], [TREE])));
    expect(pool.drawnItems().map((item) => item.ref)).toEqual([SETTLER]);
    expect(layer.children.length).toBe(1);
    expect(pool.boundsOf(TREE)).toBeUndefined();
  });
});

describe('SpritePool - a still frame', () => {
  const start = () =>
    mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
      entity(POST, 5, 1, { Signpost: { owner: 0 } }),
    ]);
  /** A pool whose last pass drew a spliced tick, so the next frame of it at another alpha may be still. */
  const settled = (fields: Partial<PoolFrame> = {}) => {
    const mirror = start();
    const pool = new SpritePool(new Container(), new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot(), fields));
    const snapshot = advance(mirror, [moved(SETTLER, 2, walker)]);
    pool.reconcile(frameOf(snapshot, fields));
    return { pool, snapshot };
  };

  it('presents only the entities that move with the frame clock', () => {
    const { pool, snapshot } = settled();
    const refs = presentedRefs();
    pool.reconcile(frameOf(snapshot, { alpha: 0.5 }));
    expect(refs()).not.toContain(TREE);
    expect(refs()).not.toContain(POST);
  });

  // A still signpost is visited by every full pass and by no still frame.
  it.each<[string, Partial<PoolFrame>]>([
    ['a highlight change', { highlight: new Map([[TREE, false]]) }],
    ['a camera move', { camera: { offsetX: 7, offsetY: 0 } }],
  ])('runs a full pass on %s', (_name, change) => {
    const { pool, snapshot } = settled();
    const refs = presentedRefs();
    pool.reconcile(frameOf(snapshot, { alpha: 0.5, ...change }));
    expect(refs()).toContain(POST);
  });

  it('clears the outline of an entity deselected between two still frames', () => {
    const selected = { selection: new Set([TREE]), selectionStyle: 'outline' as const };
    const { pool, snapshot } = settled(selected);
    const pooled = (pool as unknown as { pool: Map<number, { container: Container }> }).pool.get(TREE);
    const outlined = () => (pooled?.container.children ?? []).some((c) => c.constructor === Container);
    expect(outlined()).toBe(true);
    pool.reconcile(frameOf(snapshot, { alpha: 0.5 }));
    expect(outlined()).toBe(false);
  });
});

describe('SpritePool - a still entity of a kind every build re-emits', () => {
  /** More trees than the death reap sweeps per frame, so only the detach scan can take the post down. */
  const CROWD = 300;
  const FIRST_TREE = 100;
  const start = () =>
    mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(POST, 5, 1, { Signpost: { owner: 0 } }),
      ...Array.from({ length: CROWD }, (_, i) =>
        entity(FIRST_TREE + i, i % 20, 2 + Math.floor(i / 20), { Resource: { goodType: 1 } }),
      ),
    ]);
  const drawnRefs = (pool: SpritePool): number[] =>
    pool
      .drawnItems()
      .map((item) => item.ref)
      .filter((ref) => ref < FIRST_TREE);

  it('detaches a still signpost once it leaves the snapshot', () => {
    const mirror = start();
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot()));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)])));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker)])));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 4, walker)], [POST])));
    expect(drawnRefs(pool)).toEqual([SETTLER]);
    expect(layer.children.length).toBe(1 + CROWD);
    expect(pool.boundsOf(POST)).toBeUndefined();
  });

  it('detaches a still signpost moved out of the cull box', () => {
    const mirror = start();
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    pool.reconcile(frameOf(mirror.snapshot()));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)])));
    const far = { id: POST, components: { Position: { x: 400 * ONE, y: ONE } }, removed: [] };
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker), far])));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 4, walker)])));
    expect(drawnRefs(pool)).toEqual([SETTLER]);
    expect(layer.children.length).toBe(1 + CROWD);
    expect(pool.boundsOf(POST)).toBeUndefined();
  });
});
