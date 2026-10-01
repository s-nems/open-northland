import type { MinimapObjects, SceneTerrain } from '@open-northland/render';
import { positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import { BufferImageSource, Container, Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { GOOD_WOOD } from '../src/game/sandbox/ids/index.js';
import {
  createInlineMinimapBaker,
  createMinimapRasterizer,
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

function expectedRaster(objects: MinimapObjects): Uint8Array {
  return createMinimapRasterizer(minimapBakeScene(TERRAIN, () => MEADOW))(MAP.w, MAP.h, objects);
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

describe('minimap ground surface', () => {
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
      zoom: () => 1,
      baker: createInlineMinimapBaker,
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
      zoom: () => 1,
      baker: createInlineMinimapBaker,
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

  it('bakes sharper ground for a settled zoom up to the cap, and the whole-map size back at 1x', async () => {
    const host = new Container();
    let zoom = 1;
    let now = 0;
    const widths: number[] = [];
    const surface = createMinimapSurface({
      container: host,
      terrain: TERRAIN,
      map: MAP,
      colourOf: () => MEADOW,
      featureOfGoodType: FEATURES,
      resolution: () => 1,
      zoom: () => zoom,
      baker: (scene) => {
        const inner = createInlineMinimapBaker(scene);
        return {
          bake: (width, height, objects) => {
            widths.push(width);
            return inner.bake(width, height, objects);
          },
          dispose: inner.dispose,
        };
      },
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
    expect(widths).toEqual([MAP.w]);

    // A wheel burst asks for one bake, once the size has held still.
    for (const step of [1.4, 1.7, 2]) {
      zoom = step;
      now += BAKE_SIZE_SETTLE_MS / 4;
      surface.sync(snapshot, null);
    }
    await settle();
    expect(widths).toEqual([MAP.w]);
    now += BAKE_SIZE_SETTLE_MS;
    surface.sync(snapshot, null);
    await settle();
    expect(widths).toEqual([MAP.w, MAP.w * MAX_BAKE_ZOOM]);
    expect([ground.width, ground.height]).toEqual([MAP.w, MAP.h]);

    await zoomTo(3);
    expect(widths).toHaveLength(2);
    await zoomTo(1);
    expect(widths).toEqual([MAP.w, MAP.w * MAX_BAKE_ZOOM, MAP.w]);
    surface.dispose();
    host.destroy();
  });
});
