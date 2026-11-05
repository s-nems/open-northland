import {
  type EntityDelta,
  type EntitySnapshot,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { Container, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../../../src/data/scene/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import type { TargetTone } from '../../../src/gpu/selection/style.js';
import { LayerBinder } from '../../../src/gpu/sprite-pool/bind-layers.js';
import { type PoolFrame, SpritePool } from '../../../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { ONE, type SpriteAtlas, type SpriteSheet, type Viewport } from '../../../src/index.js';
import { entity } from '../../support/fixtures.js';

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
    // Large enough to show every entity these specs place, so only the scene's box culls them.
    screenW: 1600,
    screenH: 1000,
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

describe('SpritePool - a held tree off the screen', () => {
  it('detaches a held tree the screen leaves and draws it again when the screen returns', () => {
    const mirror = mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
    ]);
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), sheet);
    // The scene's box keeps the tree throughout; only the screen moves away from it and back.
    const away = { camera: { offsetX: -2000, offsetY: 0 } };
    pool.reconcile(frameOf(mirror.snapshot()));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)])));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker)]), away));
    expect(pool.anchorOf(TREE)).toBeUndefined();
    expect(pool.drawnItems().map((item) => item.ref)).not.toContain(TREE);
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 2, walker)]), away));
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 3, walker)])));
    expect(pool.anchorOf(TREE)).toBeDefined();
    expect(pool.boundsOf(TREE)).toBeDefined();
    expect(pool.drawnItems().map((item) => item.ref)).toContain(TREE);
  });
});

describe('SpritePool - a looping tree', () => {
  const SWAY_BOB = 2;
  const loopAtlas: SpriteAtlas = {
    width: 32,
    height: 32,
    frames: new Map([
      [BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }],
      [SWAY_BOB, { x: 16, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }],
    ]),
  };
  const loopSheet: SpriteSheet = {
    ...sheet,
    kindLayers: { resource: { source, atlas: loopAtlas } },
    bindings: { ...sheet.bindings, resource: { byGood: { 1: [{ frames: [BOB, SWAY_BOB] }] }, default: BOB } },
  };

  it('holds an untouched tree unvisited, steps its loop on every tick and keeps it pickable', () => {
    const mirror = mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
    ]);
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), loopSheet);
    const drawnX = (of: Container = layer): number[] =>
      of.children.flatMap((c) =>
        c.children.map((s) => (s as unknown as { texture: { frame: { x: number } } }).texture.frame.x),
      );
    pool.reconcile(frameOf(mirror.snapshot()));
    const refs = presentedRefs();
    for (const x of [2, 3]) {
      const before = drawnX();
      const snapshot = advance(mirror, [moved(SETTLER, x, walker)]);
      pool.reconcile(frameOf(snapshot));
      expect(drawnX()).not.toEqual(before);
      // The step draws the frame a first visit at this tick draws.
      const visited = new Container();
      new SpritePool(visited, new TextureCache(), loopSheet).reconcile(frameOf(snapshot));
      expect(drawnX()).toEqual(drawnX(visited));
      expect(pool.boundsOf(TREE)).toBeDefined();
      const stepped = drawnX();
      pool.reconcile(frameOf(snapshot, { alpha: 0.5 }));
      expect(drawnX()).toEqual(stepped);
    }
    // Only the comparison pools' first visits presented it.
    expect(refs().filter((ref) => ref === TREE)).toHaveLength(2);
  });

  it('steps a held tree under environment motion as a first visit draws it at every alpha', () => {
    const mirror = mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
    ]);
    const layer = new Container();
    const pool = new SpritePool(layer, new TextureCache(), loopSheet);
    const drawnX = (of: Container): number[] =>
      of.children.flatMap((c) =>
        c.children.map((s) => (s as unknown as { texture: { frame: { x: number } } }).texture.frame.x),
      );
    const motion = { environmentMotion: true } as const;
    pool.reconcile(frameOf(mirror.snapshot(), { ...motion, alpha: 0 }));
    for (const x of [2, 3, 2, 3]) {
      const snapshot = advance(mirror, [moved(SETTLER, x, walker)]);
      for (const alpha of [0, 0.3, 0.7, 1]) {
        const frame = frameOf(snapshot, { ...motion, alpha });
        pool.reconcile(frame);
        const visited = new Container();
        new SpritePool(visited, new TextureCache(), loopSheet).reconcile(frame);
        expect(drawnX(layer)).toEqual(drawnX(visited));
      }
    }
  });

  it('binds a stepped tree whose bake was turned away again on the next still frame', () => {
    const mirror = mirrorOf([
      entity(SETTLER, 1, 1, walker),
      entity(TREE, 4, 1, { Resource: { goodType: 1 } }),
    ]);
    let turnedAway = 0;
    vi.spyOn(TextureCache.prototype, 'deferrals', 'get').mockImplementation(() => turnedAway);
    const pool = new SpritePool(new Container(), new TextureCache(), loopSheet);
    pool.reconcile(frameOf(mirror.snapshot()));
    const boundRefs: number[] = [];
    vi.spyOn(LayerBinder.prototype, 'bind').mockImplementation((_pe, item) => {
      boundRefs.push(item.ref);
      if (item.ref === TREE && boundRefs.filter((ref) => ref === TREE).length === 1) turnedAway++;
    });
    const snapshot = advance(mirror, [moved(SETTLER, 2, walker)]);
    pool.reconcile(frameOf(snapshot));
    pool.reconcile(frameOf(snapshot, { alpha: 0.5 }));
    expect(boundRefs.filter((ref) => ref === TREE)).toHaveLength(2);
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
    ['a pick mark', { marks: new Map([[TREE, 'candidate']]) }],
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

  it('presents it while a target flash plays, then once more to clear it, and holds it again after', () => {
    const { mirror, pool } = held();
    const flashing = { flashes: new Map([[TREE, { tone: 'assign' as const, progress: 0.5 }]]) };
    const lit = presentedRefs();
    pool.reconcile(frameOf(nextTick(mirror), flashing));
    expect(lit()).toContain(TREE);
    const clearing = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 4, walker)])));
    expect(clearing()).toContain(TREE);
    const later = presentedRefs();
    pool.reconcile(frameOf(advance(mirror, [moved(SETTLER, 5, walker)])));
    expect(later().filter((ref) => ref === TREE).length).toBe(
      clearing().filter((ref) => ref === TREE).length,
    );
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

  it('keeps still frames while a pick marks a target off the screen', () => {
    const OFF_SCREEN = 999;
    const marks = new Map<number, TargetTone>([[OFF_SCREEN, 'candidate']]);
    const { pool, snapshot } = settled({ marks });
    const refs = presentedRefs();
    pool.reconcile(frameOf(snapshot, { alpha: 0.5, marks }));
    expect(refs()).not.toContain(POST);
  });

  it('keeps a held candidate breathing through the still frames after a pick marks it', () => {
    const { pool, snapshot } = settled();
    const marks = new Map<number, TargetTone>([[TREE, 'candidate']]);
    pool.reconcile(frameOf(snapshot, { marks }));
    const refs = presentedRefs();
    pool.reconcile(frameOf(snapshot, { alpha: 0.5, marks, selectionTime: 0.35 }));
    expect(refs()).toContain(TREE);
    expect(refs()).not.toContain(POST);
  });

  // A still signpost is visited by every full pass and by no still frame.
  it.each<[string, Partial<PoolFrame>]>([
    ['a mark change', { marks: new Map([[TREE, 'refused']]) }],
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
  it('clears the flash of an entity whose flash ends between two still frames', () => {
    const flashing = { flashes: new Map([[TREE, { tone: 'attack' as const, progress: 0.5 }]]) };
    const { pool, snapshot } = settled(flashing);
    const pooled = (
      pool as unknown as { pool: Map<number, { sprites: { selectionEffect?: number }[] }> }
    ).pool.get(TREE);
    const lift = () => Math.max(...(pooled?.sprites ?? []).map((sprite) => sprite.selectionEffect ?? 0));
    expect(lift()).toBeGreaterThan(0);
    pool.reconcile(frameOf(snapshot, { alpha: 0.5 }));
    expect(lift()).toBe(0);
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
