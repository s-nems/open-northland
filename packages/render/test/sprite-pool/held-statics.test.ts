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
const walker = { Settler: { tribe: 0 } };

function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
  const mirror = new SnapshotMirror();
  const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
  mirror.apply(packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched, removed: [], events: [] }));
  return mirror;
}

function advance(mirror: SnapshotMirror, touched: readonly EntityDelta[]): WorldSnapshot {
  const lastTick = mirror.tick ?? 0;
  mirror.apply(
    packSnapshotDelta({
      tick: lastTick + 1,
      sequence: lastTick,
      rebuild: false,
      touched,
      removed: [],
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
