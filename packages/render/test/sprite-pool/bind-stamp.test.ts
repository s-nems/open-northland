import type { WorldSnapshot } from '@open-northland/sim';
import { Container, Sprite, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Camera, Viewport } from '../../src/data/projection/index.js';
import type { SpriteDrawItem } from '../../src/data/scene/index.js';
import type { SpriteKind } from '../../src/data/sprites/index.js';
import type { ElevationField } from '../../src/data/terrain/index.js';
import { DEFAULT_SHADOW_STYLE } from '../../src/gpu/shadow-style.js';
import { type BindFrame, LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { BindStamp, FrameEpoch } from '../../src/gpu/sprite-pool/bind-stamp.js';
import { type PoolFrame, SpritePool } from '../../src/gpu/sprite-pool/index.js';
import { createPooled } from '../../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../../src/gpu/sprite-pool/resolved-layer.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import type { DrawItem, SpriteAtlas, SpriteSheet } from '../../src/index.js';
import { drawItem, entity, snapshotOf } from '../support/fixtures.js';

/**
 * A still frame (paused, or a still camera over a quiet town) must not present and bind every drawn
 * entity again. Plain sprites only: a paletted mesh needs a DOM canvas.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const CAMERA: Camera = { offsetX: 0, offsetY: 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
/** Frames nothing any spec places, so an entity stays live and pooled while it is not drawn. */
const VIEW_NONE: Viewport = { minX: 1e9, maxX: 1e9 + 1, minY: 1e9, maxY: 1e9 + 1 };
const source = new TextureSource({ width: 64, height: 64 });
const BODY_BOB = 1;
const atlas: SpriteAtlas = {
  width: 32,
  height: 32,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 16, height: 32, offsetX: -8, offsetY: -32 }]]),
};
/** One idle character without a palette LUT, so it binds plain sprites. */
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: { settler: BODY_BOB, resource: 1, building: 1 },
  characters: { byJob: {}, default: { body: { source, atlas }, binding: { idle: BODY_BOB } } },
};
const SETTLER = 1;
const HIGHLIGHT_NO_TINT = 0xff8888;

function frameOf(snapshot: WorldSnapshot, fields: Partial<PoolFrame> = {}): PoolFrame {
  return {
    snapshot,
    viewport: VIEW_ALL,
    tick: 0,
    camera: CAMERA,
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 1,
    ...fields,
  };
}

function setup() {
  const layer = new Container();
  const pool = new SpritePool(layer, new TextureCache(), sheet);
  const bind = vi.spyOn(LayerBinder.prototype, 'bind');
  const snapshot = snapshotOf([entity(SETTLER, 0, 0, { Settler: { tribe: 0 } })]);
  return { layer, pool, bind, snapshot };
}

function bodySprite(layer: Container): Sprite {
  const body = (layer.children[0] as Container | undefined)?.children[0];
  if (!(body instanceof Sprite)) throw new Error('the settler body was not bound');
  return body;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SpritePool - an entity whose inputs held still keeps its bind', () => {
  it('skips the bind on an identical frame and still answers its bounds', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    const bounds = { ...pool.boundsOf(SETTLER) };
    pool.reconcile(frameOf(snapshot));
    expect(bind).toHaveBeenCalledTimes(1);
    expect(pool.boundsOf(SETTLER)).toEqual(bounds);
  });

  it('skips the bind when only the frame alpha moved and the layers resolved the same', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot, { alpha: 0.25 }));
    pool.reconcile(frameOf(snapshot, { alpha: 0.75 }));
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it('binds again when the alpha moves an entity between its tick anchors', () => {
    const pool = new SpritePool(new Container(), new TextureCache(), undefined);
    const bind = vi.spyOn(LayerBinder.prototype, 'bind');
    pool.reconcile(frameOf(snapshotOf([entity(SETTLER, 0, 0, { Projectile: {} })]), { tick: 0 }));
    const inFlight = snapshotOf([entity(SETTLER, 0, 1, { Projectile: {} })]);
    pool.reconcile(frameOf(inFlight, { tick: 1, alpha: 0.25 }));
    pool.reconcile(frameOf(inFlight, { tick: 1, alpha: 0.75 }));
    expect(bind).toHaveBeenCalledTimes(3);
  });

  it('binds again when a setting the layers read changes', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    pool.reconcile(frameOf(snapshot, { shadowStyle: DEFAULT_SHADOW_STYLE }));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  it('binds again when the texture cache swaps its shadow textures', () => {
    const { bind, snapshot } = setup();
    const textures = new TextureCache();
    const pool = new SpritePool(new Container(), textures, sheet);
    pool.reconcile(frameOf(snapshot));
    textures.setSoftShadows(true);
    pool.reconcile(frameOf(snapshot));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  it('binds again when the device-pixel grid changes under a still camera', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    pool.reconcile(frameOf(snapshot, { snapResolution: 2 }));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  it('binds again when a highlight map changes in place', () => {
    const { layer, pool, bind, snapshot } = setup();
    const highlight = new Map<number, boolean>();
    pool.reconcile(frameOf(snapshot, { highlight }));
    highlight.set(SETTLER, false);
    pool.reconcile(frameOf(snapshot, { highlight }));
    expect(bind).toHaveBeenCalledTimes(2);
    expect(bodySprite(layer).tint).toBe(HIGHLIGHT_NO_TINT);
  });

  it('binds again when the entity returns after a frame off the draw list', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    pool.reconcile(frameOf(snapshot, { viewport: VIEW_NONE }));
    pool.reconcile(frameOf(snapshot));
    expect(bind).toHaveBeenCalledTimes(2);
  });

  it('keeps the bind across a new snapshot and tick that leave the entity as it was', () => {
    const { layer, pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    const body = bodySprite(layer);
    pool.reconcile(frameOf(snapshotOf([entity(SETTLER, 0, 0, { Settler: { tribe: 0 } })]), { tick: 1 }));
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bodySprite(layer)).toBe(body);
  });

  it('binds a new draw item that moved the entity', () => {
    const { pool, bind, snapshot } = setup();
    pool.reconcile(frameOf(snapshot));
    pool.reconcile(frameOf(snapshotOf([entity(SETTLER, 1, 0, { Settler: { tribe: 0 } })]), { tick: 1 }));
    expect(bind).toHaveBeenCalledTimes(2);
  });
});

describe('SpritePool - a still clockless entity skips its present', () => {
  const TREE = 2;
  /** Counts the resolves that read the tree's binding: one per present of the tree. */
  function countingPool() {
    let presents = 0;
    const counted: SpriteSheet = {
      ...sheet,
      bindings: {
        ...sheet.bindings,
        get resource() {
          presents++;
          return sheet.bindings.resource;
        },
      },
    };
    const pool = new SpritePool(new Container(), new TextureCache(), counted);
    return { pool, presents: () => presents };
  }
  const tree = (tileX: number) => snapshotOf([entity(TREE, tileX, 0, { Resource: { goodType: 3 } })]);

  it('resolves an unchanged tree once across new snapshots, ticks and frame alphas', () => {
    const { pool, presents } = countingPool();
    pool.reconcile(frameOf(tree(0), { tick: 0 }));
    const first = presents();
    pool.reconcile(frameOf(tree(0), { tick: 1, alpha: 0.5 }));
    pool.reconcile(frameOf(tree(0), { tick: 2, alpha: 0.25 }));
    expect(presents()).toBe(first);
    expect(pool.boundsOf(TREE)).toBeDefined();
  });

  it('resolves the tree again once its item changes', () => {
    const { pool, presents } = countingPool();
    pool.reconcile(frameOf(tree(0), { tick: 0 }));
    const first = presents();
    pool.reconcile(frameOf(tree(1), { tick: 1 }));
    expect(presents()).toBeGreaterThan(first);
  });
});

describe('FrameEpoch', () => {
  it('bumps on a frame-wide input the bind reads, not on a new frame object or alpha', () => {
    const epoch = new FrameEpoch();
    const base = frameOf(snapshotOf([]));
    epoch.advance(base, 0);
    const first = epoch.current;

    epoch.advance({ ...base, camera: { ...CAMERA }, alpha: 0.5 }, 0);
    expect(epoch.current).toBe(first);
    epoch.advance({ ...base, camera: { offsetX: 1, offsetY: 0 } }, 0);
    expect(epoch.current).toBe(first + 1);
    epoch.advance({ ...base, camera: { offsetX: 1, offsetY: 0 } }, 1);
    expect(epoch.current).toBe(first + 2);
  });

  it('keeps the bind epoch over a new tick, which reaches a bind only through the layers', () => {
    const epoch = new FrameEpoch();
    const base = frameOf(snapshotOf([]));
    epoch.advance(base, 0);
    const { current, bind } = epoch;

    epoch.advance({ ...base, tick: 1, environmentMotion: true }, 0);
    expect(epoch.current).toBe(current + 1);
    expect(epoch.bind).toBe(bind);
    epoch.advance({ ...base, tick: 1, environmentMotion: true, snapResolution: 2 }, 0);
    expect(epoch.bind).toBe(bind + 1);
  });
});

describe('BindStamp.bindHolds', () => {
  const frame = atlas.frames.get(BODY_BOB);
  if (frame === undefined) throw new Error('the body bob has no frame');
  const LAYERS: readonly ResolvedLayer[] = [{ source, frame, scale: 1 }];
  const BIND_FRAME: BindFrame = { camera: CAMERA, screenW: 800, screenH: 600, enhancedSampling: true };
  const OTHER_PLAYER = 2;
  /** The pool keys a stamp by its entity's ref, so a bind and its stamp always share it. */
  const KEYED_BY_POOL = 'ref';

  /** `item` reporting each field a reader looks up into `keys`. */
  function recording(item: DrawItem, keys: Set<string>): DrawItem {
    return new Proxy(item, {
      get(target, key, receiver) {
        if (typeof key === 'string') keys.add(key);
        return Reflect.get(target, key, receiver);
      },
    });
  }

  function spriteItem(kind: SpriteKind, fields: Partial<DrawItem> = {}): SpriteDrawItem {
    return { ...drawItem(kind, fields), kind };
  }

  function stampOf(item: SpriteDrawItem) {
    const pe = createPooled(item.kind, undefined);
    const epoch = new FrameEpoch();
    const stamp = new BindStamp();
    stamp.record(item, epoch, undefined, pe.motion, LAYERS);
    return { pe, epoch, stamp };
  }

  it('compares every item field a plain bind reads', () => {
    const items: SpriteDrawItem[] = [
      spriteItem('settler', { lift: 1 }),
      spriteItem('settler', { ghost: true }),
      spriteItem('building', { builtPct: 40 }),
      spriteItem('building', { upgradePct: 40 }),
      spriteItem('palisade', { palisadeSite: 'unclaimed' }),
      spriteItem('palisade', { palisadeSite: 'claimed' }),
      spriteItem('roadsite', { roadSite: 'unclaimed' }),
      spriteItem('roadsite', { roadSite: 'claimed' }),
    ];
    const binder = new LayerBinder(new TextureCache(), undefined);
    const bound = new Set<string>();
    const compared = new Set<string>([KEYED_BY_POOL]);
    for (const item of items) {
      for (const layers of [LAYERS, null]) {
        binder.bind(createPooled(item.kind, undefined), recording(item, bound), layers, BIND_FRAME, 0);
      }
      const { epoch, stamp } = stampOf(item);
      expect(stamp.bindHolds(recording(item, compared), epoch.bind, undefined)).toBe(true);
    }
    expect([...bound].filter((key) => !compared.has(key))).toEqual([]);
  });

  it.each([
    ['the highlight', {}, true],
    ['the team colour', { player: OTHER_PLAYER }, undefined],
    ['the fog ghost', { ghost: true }, undefined],
  ] as const)('binds again over the same layers when %s changes', (_, fields, highlight) => {
    const item = spriteItem('settler');
    const { pe, epoch, stamp } = stampOf(item);
    expect(stamp.presents(pe.motion, LAYERS)).toBe(true);
    expect(stamp.bindHolds({ ...item }, epoch.bind, undefined)).toBe(true);
    expect(stamp.bindHolds({ ...item, ...fields }, epoch.bind, highlight)).toBe(false);
  });
});
