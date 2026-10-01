import type { MinimapObjects, SceneTerrain } from '@open-northland/render';
import { applyMinimapGroundMode, type MinimapGroundMode } from '@open-northland/render/data';
import { positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, Container, Sprite } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diag } from '../src/diag/index.js';
import { GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import {
  createInlineMinimapBaker,
  createMinimapRasterizer,
  type MinimapBakerFactory,
  minimapBakeScene,
} from '../src/hud/minimap/bake.js';
import { createSeenStandingObjects, minimapFeatureOfGoodTypes } from '../src/hud/minimap/live-objects.js';
import {
  BAKE_SIZE_SETTLE_MS,
  createMinimapSurface,
  MAX_BAKE_ZOOM,
  OBJECT_REBAKE_INTERVAL_MS,
} from '../src/hud/minimap/surface.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const SIZE = 4;
const TERRAIN: SceneTerrain = {
  width: SIZE,
  height: SIZE,
  typeIds: Array.from({ length: SIZE * SIZE }, () => 0),
};
const MEADOW = 0x426f32;
const MAP = { x: 0, y: 0, w: 52, h: 42 };
const FEATURES = minimapFeatureOfGoodTypes([{ id: 'wood', typeId: GOOD_WOOD }]);

function tree(id: number, hx: number, hy: number): Ent {
  return {
    id,
    components: {
      Resource: { goodType: GOOD_WOOD, remaining: 1, harvestAtomic: 0 },
      Position: positionOfNode(hx, hy),
    },
  };
}

function standingObjects(snapshot: WorldSnapshot): MinimapObjects {
  const seen = createSeenStandingObjects(FEATURES);
  seen.refresh(snapshot, null);
  return seen.objects();
}

function expectedRaster(objects: MinimapObjects, mode: MinimapGroundMode = 'natural'): Uint8Array {
  const natural = createMinimapRasterizer(minimapBakeScene(TERRAIN, () => MEADOW))(MAP.w, MAP.h, objects);
  return applyMinimapGroundMode(natural, mode);
}

/** Let the baker's answer land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function groundOf(host: Container): Sprite {
  const ground = host.children[0];
  if (!(ground instanceof Sprite)) throw new Error('missing ground');
  return ground;
}

function pixelsOf(ground: Sprite): Uint8Array {
  const source = ground.texture.source;
  if (!(source instanceof BufferImageSource)) throw new Error('missing pixel source');
  return source.resource as Uint8Array;
}

interface DeferredBake {
  readonly width: number;
  readonly height: number;
  readonly mode: MinimapGroundMode;
  resolve(rgba: Uint8Array): void;
  reject(err: Error): void;
}

/** A baker whose bakes settle only when the test says so. */
function deferredBaker(): {
  readonly factory: MinimapBakerFactory;
  readonly calls: DeferredBake[];
  disposed: boolean;
} {
  const out = {
    calls: [] as DeferredBake[],
    disposed: false,
    factory: (() => ({
      bake: (width, height, mode) =>
        new Promise<Uint8Array>((resolve, reject) =>
          out.calls.push({ width, height, mode, resolve, reject }),
        ),
      dispose: () => {
        out.disposed = true;
      },
    })) as MinimapBakerFactory,
  };
  return out;
}

function surfaceOn(
  host: Container,
  baker: MinimapBakerFactory,
  resolution: () => number = () => 1,
  groundMode: () => MinimapGroundMode = () => 'natural',
) {
  let now = 0;
  const surface = createMinimapSurface({
    container: host,
    terrain: TERRAIN,
    map: MAP,
    colourOf: () => MEADOW,
    featureOfGoodType: FEATURES,
    resolution,
    shownWidth: () => MAP.w,
    baker,
    groundMode,
    now: () => now,
  });
  return {
    surface,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('minimap ground surface', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for one bake while one is in flight', async () => {
    const host = new Container();
    const baker = deferredBaker();
    const { surface, advance } = surfaceOn(host, baker.factory);
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    surface.sync(snapshot, null);
    advance(OBJECT_REBAKE_INTERVAL_MS);
    surface.sync(snapshotOf([]), null);
    surface.sync(snapshotOf([]), null);
    expect(baker.calls).toHaveLength(1);
    baker.calls[0]?.resolve(expectedRaster(standingObjects(snapshot)));
    await settle();
    expect(groundOf(host).visible).toBe(true);
    surface.dispose();
    host.destroy();
  });

  it('bakes once inline after a failed bake, then stops', async () => {
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {});
    const host = new Container();
    const baker = deferredBaker();
    let resolution = 1;
    const { surface, advance } = surfaceOn(host, baker.factory, () => resolution);
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    surface.sync(snapshot, null);
    baker.calls[0]?.reject(new Error('worker gone'));
    await settle();
    const ground = groundOf(host);
    expect(ground.visible).toBe(true);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(snapshot)));
    expect(warn).toHaveBeenCalledTimes(1);
    const fallback = ground.texture;

    resolution = 2;
    surface.sync(snapshot, null);
    advance(OBJECT_REBAKE_INTERVAL_MS);
    surface.sync(snapshotOf([]), null);
    await settle();
    expect(baker.calls).toHaveLength(1);
    expect(ground.texture).toBe(fallback);
    surface.dispose();
    host.destroy();
  });

  it('lands no texture from a bake that settles after dispose', async () => {
    const warn = vi.spyOn(diag, 'warn').mockImplementation(() => {});
    const host = new Container();
    const baker = deferredBaker();
    const { surface } = surfaceOn(host, baker.factory);
    surface.sync(snapshotOf([tree(1, 2, 2)]), null);
    const ground = groundOf(host);
    surface.dispose();
    expect(baker.disposed).toBe(true);
    baker.calls[0]?.resolve(new Uint8Array(MAP.w * MAP.h * 4));
    await settle();
    expect(ground.visible).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    host.destroy();
  });

  it('bakes the styled raster at the display resolution and rebakes when it changes', async () => {
    const host = new Container();
    let resolution = 1;
    let now = 0;
    const surface = createMinimapSurface({
      container: host,
      terrain: TERRAIN,
      map: MAP,
      colourOf: () => MEADOW,
      featureOfGoodType: FEATURES,
      resolution: () => resolution,
      shownWidth: () => MAP.w,
      baker: createInlineMinimapBaker,
      groundMode: () => 'natural',
      now: () => now,
    });
    const ground = groundOf(host);
    expect(ground.visible).toBe(false);
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    surface.sync(snapshot, null);
    await settle();
    expect(ground.visible).toBe(true);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(snapshot)));
    const first = ground.texture;
    surface.sync(snapshot, null);
    await settle();
    expect(ground.texture).toBe(first);

    resolution = 2;
    surface.sync(snapshot, null);
    now = BAKE_SIZE_SETTLE_MS;
    surface.sync(snapshot, null);
    await settle();
    expect(first.destroyed).toBe(true);
    expect([ground.texture.width, ground.texture.height]).toEqual([MAP.w * 2, MAP.h * 2]);
    expect([ground.width, ground.height]).toEqual([MAP.w, MAP.h]);
    const last = ground.texture;
    surface.dispose();
    expect(last.destroyed).toBe(true);
    expect(host.children).toHaveLength(0);
    host.destroy();
  });

  it('redraws a felled forest at most once per rebake interval', async () => {
    const host = new Container();
    let now = 0;
    const surface = createMinimapSurface({
      container: host,
      terrain: TERRAIN,
      map: MAP,
      colourOf: () => MEADOW,
      featureOfGoodType: FEATURES,
      resolution: () => 1,
      shownWidth: () => MAP.w,
      baker: createInlineMinimapBaker,
      groundMode: () => 'natural',
      now: () => now,
    });
    const ground = groundOf(host);
    // Separate snapshots build their own indexes, so the counts stand in for a mirror's growing revision.
    surface.sync(snapshotOf([tree(1, 2, 2), tree(2, 4, 4)]), null);
    await settle();
    const forested = ground.texture;
    const felled = snapshotOf([tree(1, 2, 2)]);
    now = OBJECT_REBAKE_INTERVAL_MS - 1;
    surface.sync(felled, null);
    await settle();
    expect(ground.texture).toBe(forested);
    now = OBJECT_REBAKE_INTERVAL_MS;
    surface.sync(felled, null);
    await settle();
    expect(ground.texture).not.toBe(forested);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(felled)));
    surface.dispose();
    host.destroy();
  });

  it('bakes the shown width at the display resolution, up to the cap, and smaller again', async () => {
    const host = new Container();
    /** A panel that shows the whole map narrower than its raster. */
    const PANEL_WIDTH = 30;
    const RESOLUTION = 2;
    const CAP = MAP.w * MAX_BAKE_ZOOM * RESOLUTION;
    let zoom = 1;
    let now = 0;
    const widths: number[] = [];
    const surface = createMinimapSurface({
      container: host,
      terrain: TERRAIN,
      map: MAP,
      colourOf: () => MEADOW,
      featureOfGoodType: FEATURES,
      resolution: () => RESOLUTION,
      shownWidth: () => PANEL_WIDTH * zoom,
      baker: (scene) => {
        const inner = createInlineMinimapBaker(scene);
        return {
          bake: (width, height, mode, objects) => {
            widths.push(width);
            return inner.bake(width, height, mode, objects);
          },
          dispose: inner.dispose,
        };
      },
      groundMode: () => 'natural',
      now: () => now,
    });
    const ground = groundOf(host);
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    const zoomTo = async (next: number): Promise<void> => {
      zoom = next;
      surface.sync(snapshot, null);
      now += BAKE_SIZE_SETTLE_MS;
      surface.sync(snapshot, null);
      await settle();
    };
    surface.sync(snapshot, null);
    await settle();
    const shown = PANEL_WIDTH * RESOLUTION;
    expect(widths).toEqual([shown]);
    expect([ground.texture.width, ground.texture.height]).toEqual([
      shown,
      Math.round((shown * MAP.h) / MAP.w),
    ]);

    // A wheel burst asks for one bake, once the size has held still.
    for (const step of [1.4, 1.7, 2]) {
      zoom = step;
      now += BAKE_SIZE_SETTLE_MS / 4;
      surface.sync(snapshot, null);
    }
    await settle();
    expect(widths).toEqual([shown]);
    now += BAKE_SIZE_SETTLE_MS;
    surface.sync(snapshot, null);
    await settle();
    expect(widths).toEqual([shown, shown * 2]);
    expect([ground.width, ground.height]).toEqual([MAP.w, MAP.h]);

    await zoomTo(4);
    expect(widths).toEqual([shown, shown * 2, CAP]);
    await zoomTo(3.5);
    expect(widths).toHaveLength(3);
    await zoomTo(1);
    expect(widths).toEqual([shown, shown * 2, CAP, shown]);
    surface.dispose();
    host.destroy();
  });

  it('rebakes at once at the baked size when the ground mode changes, holding the old picture', async () => {
    const host = new Container();
    const baker = deferredBaker();
    let mode: MinimapGroundMode = 'natural';
    let resolution = 1;
    const { surface } = surfaceOn(
      host,
      baker.factory,
      () => resolution,
      () => mode,
    );
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    surface.sync(snapshot, null);
    baker.calls[0]?.resolve(expectedRaster(standingObjects(snapshot)));
    await settle();
    const ground = groundOf(host);
    const natural = ground.texture;

    // The new size has not settled, so the flip grades the baked size the baker still holds.
    mode = 'dark';
    resolution = 2;
    surface.sync(snapshot, null);
    expect(baker.calls.map((call) => [call.width, call.height, call.mode])).toEqual([
      [MAP.w, MAP.h, 'natural'],
      [MAP.w, MAP.h, 'dark'],
    ]);
    expect(ground.texture).toBe(natural);
    baker.calls[1]?.resolve(expectedRaster(standingObjects(snapshot), 'dark'));
    await settle();
    expect(ground.texture).not.toBe(natural);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(snapshot), 'dark'));
    surface.sync(snapshot, null);
    expect(baker.calls).toHaveLength(2);
    surface.dispose();
    host.destroy();
  });

  it('grades the inline fallback for the chosen mode and for a later flip', async () => {
    vi.spyOn(diag, 'warn').mockImplementation(() => {});
    const host = new Container();
    const baker = deferredBaker();
    let mode: MinimapGroundMode = 'muted';
    const { surface } = surfaceOn(
      host,
      baker.factory,
      () => 1,
      () => mode,
    );
    const snapshot = snapshotOf([tree(1, 2, 2)]);
    surface.sync(snapshot, null);
    baker.calls[0]?.reject(new Error('worker gone'));
    await settle();
    const ground = groundOf(host);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(snapshot), 'muted'));

    mode = 'hidden';
    surface.sync(snapshot, null);
    expect(baker.calls).toHaveLength(1);
    expect(pixelsOf(ground)).toEqual(expectedRaster(standingObjects(snapshot), 'hidden'));
    surface.dispose();
    host.destroy();
  });
});
