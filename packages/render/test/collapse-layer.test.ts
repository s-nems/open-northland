import type { SimEvent } from '@open-northland/sim';
import { Container, DOMAdapter, type Mesh, Sprite, Texture, TextureSource } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COLLAPSE_LIFETIME_TICKS,
  COLLAPSE_SMOKE_LEAD_TICKS,
  COLLAPSE_TICKS,
  collapseProgress,
  foldBuildingCollapses,
  MAX_ACTIVE_COLLAPSES,
} from '../src/data/effects/index.js';
import type { Viewport } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { CollapseLayer } from '../src/gpu/overlays/collapse-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../src/index.js';

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = new TextureSource({ width: 100, height: 10 });

beforeEach(() => {
  vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({
    getContext: () => null,
  } as unknown as HTMLCanvasElement);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({
        canvas: { width, height },
        clearRect: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => vi.restoreAllMocks());

const BODY_BOB = 70;
const STAGE_BOB = 80;
const BODY_H = 10;
const bodyFrame = (x: number) => ({ x, y: 0, width: 10, height: BODY_H, offsetX: -5, offsetY: -BODY_H });
const atlas: SpriteAtlas = {
  width: 100,
  height: BODY_H,
  frames: new Map([
    [BODY_BOB, bodyFrame(0)],
    [STAGE_BOB, bodyFrame(20)],
  ]),
};
const HOUSE = 13;
/** Rises by the bottom-up crop: its family has no time sheet. */
const CROPPED_SITE = 14;
/** Rises by the per-pixel reveal of its family's time sheet. */
const TIMED_SITE = 15;
const stage = (layer: string) => [{ layer, bob: STAGE_BOB, fromPct: 0, toPct: 100 }];
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: {
      byType: { [HOUSE]: { layer: 'houses', bob: BODY_BOB } },
      default: BODY_BOB,
      constructionByType: { [CROPPED_SITE]: stage('houses'), [TIMED_SITE]: stage('timed') },
    },
  },
  families: {
    houses: { source, atlas },
    timed: { source, atlas, times: { width: 100, height: BODY_H, values: new Uint8Array(100 * BODY_H) } },
  },
};

const SIM_ONE = 65536; // the sim fixed-point ONE (buildingDestroyed.built is a 0..ONE fraction)
const razed = (
  entity: number,
  buildingType = HOUSE,
  at: { hx: number; hy: number } = { hx: 4, hy: 6 },
  built = SIM_ONE,
) => ({ kind: 'buildingDestroyed', entity, player: 2, buildingType, built, at }) as SimEvent;
const AT = { hx: 4, hy: 6 };

describe('foldBuildingCollapses', () => {
  it('spawns a collapse per positioned buildingDestroyed and expires it once the dust settles', () => {
    const live = foldBuildingCollapses([], [razed(9)], 100);
    expect(live).toHaveLength(1);
    const collapse = live[0];
    if (collapse === undefined) throw new Error('expected one live collapse');
    expect(collapse).toMatchObject({ entity: 9, typeId: 13, hx: 4, hy: 6, spawnTick: 100 });
    expect(collapseProgress(collapse, 100)).toBe(0);
    expect(collapseProgress(collapse, 100 + COLLAPSE_SMOKE_LEAD_TICKS)).toBe(0);
    expect(collapseProgress(collapse, 100 + COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS / 2)).toBeCloseTo(
      0.25,
    );
    expect(collapseProgress(collapse, 100 + COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS)).toBe(1);
    // Dust remains after the body has cleared.
    expect(foldBuildingCollapses(live, [], 101 + COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS)).toHaveLength(1);
    expect(foldBuildingCollapses(live, [], 100 + COLLAPSE_LIFETIME_TICKS)).toHaveLength(0);
  });

  it('collapses an unfinished site as its construction stage, never the finished body', () => {
    const halfBuilt = {
      kind: 'buildingDestroyed',
      entity: 9,
      player: 2,
      buildingType: 13,
      built: SIM_ONE / 2,
      at: { hx: 4, hy: 6 },
    } as SimEvent;
    const live = foldBuildingCollapses([], [halfBuilt], 0);
    expect(live[0]?.builtPct).toBe(50); // the same whole-percent scale the live construction reveal uses
    expect(foldBuildingCollapses([], [razed(9)], 0)[0]?.builtPct).toBeUndefined(); // finished → the body
  });

  it('drops an event with no position, and caps the live list oldest-first', () => {
    expect(
      foldBuildingCollapses(
        [],
        [
          {
            kind: 'buildingDestroyed',
            entity: 1,
            player: null,
            buildingType: 13,
            built: SIM_ONE,
          } as SimEvent,
        ],
        0,
      ),
    ).toHaveLength(0);
    const flood = Array.from({ length: MAX_ACTIVE_COLLAPSES + 5 }, (_, i) => razed(100 + i));
    const capped = foldBuildingCollapses([], flood, 0);
    expect(capped).toHaveLength(MAX_ACTIVE_COLLAPSES);
    expect(capped[0]).toMatchObject({ entity: 105 }); // the 5 oldest dropped off the front
  });
});

describe('CollapseLayer', () => {
  it('keeps leased layers anchored across culling and releases them when the dust settles', () => {
    const spriteLayer = new Container();
    const source = new TextureSource({ width: 20, height: 20 });
    const body = new Texture({ source });
    const accessory = new Texture({ source });
    const releaseBody = vi.fn();
    const releaseAccessory = vi.fn();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet, () => [
      { texture: body, x: -10, y: -20, scale: 1, alpha: 1, release: releaseBody },
      { texture: accessory, x: 0, y: -40, scale: 0.5, alpha: 0.7, release: releaseAccessory },
    ]);
    layer.ingest([razed(9)], 0);
    layer.draw(FLAT, VIEW_ALL, 0);
    const node = spriteLayer.children[0] as Container;
    const mesh = node.children[1] as Mesh;
    const buffers = [...mesh.geometry.buffers];
    const original = mesh.geometry.getBuffer('aPosition').data.slice();
    expect(mesh.alpha).toBe(0.7);
    layer.draw(FLAT, { minX: 1e6, minY: 1e6, maxX: 2e6, maxY: 2e6 }, COLLAPSE_TICKS / 2);
    expect(node.visible).toBe(false);
    expect(mesh.geometry.getBuffer('aPosition').data).toEqual(original);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS * 0.95);
    expect(node.visible).toBe(true);
    expect(mesh.geometry.getBuffer('aPosition').data).toEqual(original);
    expect(mesh.position).toMatchObject({ x: 0, y: -40 });
    expect(mesh.alpha).toBe(0.7);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_LIFETIME_TICKS);
    expect(releaseBody).toHaveBeenCalledOnce();
    expect(releaseAccessory).toHaveBeenCalledOnce();
    expect(mesh.destroyed).toBe(true);
    expect(buffers.every((buffer) => buffer.destroyed)).toBe(true);
    layer.destroy();
    body.destroy();
    accessory.destroy();
    source.destroy();
  });

  it('dismantles each body in place without moving geometry or cropping its texture, then retires it', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet);
    layer.ingest([razed(9)], 0);

    layer.draw(FLAT, VIEW_ALL, 0);
    expect(spriteLayer.children).toHaveLength(1);
    const node = spriteLayer.children[0] as Container;
    const spr = node.children[0] as Mesh;
    expect(spr.texture.frame.height).toBe(BODY_H); // intact at progress 0
    expect(spr.position.y).toBe(-BODY_H); // the frame's own feet-anchored draw offset

    const positions = spr.geometry.getBuffer('aPosition').data.slice();
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS / 2);
    expect(spr.texture.frame.height).toBe(BODY_H);
    expect(spr.position.y).toBe(-BODY_H);
    expect(spr.geometry.getBuffer('aPosition').data).toEqual(positions);

    layer.ingest([], COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS);
    expect(spriteLayer.children).toHaveLength(1);
    expect(spr.visible).toBe(false);

    layer.ingest([], COLLAPSE_LIFETIME_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_LIFETIME_TICKS);
    expect(spriteLayer.children).toHaveLength(0);
    layer.destroy();
  });

  it('preserves a leased upgrade fade when a mask atlas cannot be allocated', () => {
    vi.spyOn(drawable, 'readable2dContext').mockReturnValue(null);
    const spriteLayer = new Container();
    const texture = new Texture({ source });
    const release = vi.fn();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet, () => [
      { texture, x: -5, y: -10, scale: 1, alpha: 0.3, release },
    ]);
    layer.ingest([razed(9)], 0);
    layer.draw(FLAT, VIEW_ALL, 0);
    const body = spriteLayer.children[0]?.children[0];
    expect(body).toBeInstanceOf(Sprite);
    expect(body?.alpha).toBe(0.3);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_SMOKE_LEAD_TICKS);
    expect(body?.alpha).toBe(0.3);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS / 2);
    expect(body?.alpha).toBeLessThan(0.3);
    expect(body?.y).toBe(-10);
    layer.destroy();
    expect(release).toHaveBeenCalledOnce();
    expect(texture.destroyed).toBe(false);
    texture.destroy();
  });

  it('breaks only the rows a cropped site had revealed, keeping its feet anchor', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet);
    layer.ingest([razed(9, CROPPED_SITE, AT, (SIM_ONE * 3) / 10)], 0);

    layer.draw(FLAT, VIEW_ALL, 0);
    const spr = (spriteLayer.children[0] as Container).children[0] as Mesh;
    const risenRows = (BODY_H * 3) / 10;
    expect(spr.texture.frame.y).toBe(BODY_H - risenRows); // the bottom 30% the live site showed
    expect(spr.texture.frame.height).toBe(risenRows);
    expect(spr.position.y).toBe(-risenRows);

    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS / 2);
    expect(spr.texture.frame.height).toBe(risenRows);
    expect(spr.position.y).toBe(-risenRows);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_SMOKE_LEAD_TICKS + COLLAPSE_TICKS);
    expect(spr.visible).toBe(false);
  });

  it('draws nothing for a site that had revealed nothing yet', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet);
    layer.ingest([razed(9, CROPPED_SITE, AT, 0)], 0);
    layer.draw(FLAT, VIEW_ALL, 0);
    expect(spriteLayer.children).toHaveLength(0);
  });

  it('breaks a timed site from its per-pixel reveal and destroys that bake with the collapse', () => {
    const spriteLayer = new Container();
    const textures = new TextureCache();
    const bake = new Texture({ source: new TextureSource({ width: 10, height: BODY_H }) });
    const bakeReveal = vi.spyOn(textures, 'bakeReveal').mockReturnValue(bake);
    const layer = new CollapseLayer(spriteLayer, textures, sheet);
    layer.ingest([razed(9, TIMED_SITE, AT, SIM_ONE / 4)], 0);

    layer.draw(FLAT, VIEW_ALL, 0);
    expect(bakeReveal).toHaveBeenCalledOnce();
    expect(bakeReveal.mock.calls[0]?.[3]).toBeCloseTo(255 / 4, 0); // a quarter into its [0,100] window
    const spr = (spriteLayer.children[0] as Container).children[0] as Mesh;
    expect(spr.texture.source).toBe(bake.source);
    expect(spr.texture.frame.height).toBe(BODY_H); // the reveal hides pixels, not rows

    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS / 2);
    expect(spr.texture.frame.height).toBe(BODY_H);

    layer.ingest([], COLLAPSE_LIFETIME_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_LIFETIME_TICKS);
    expect(bake.destroyed).toBe(true);
  });

  it('draws nothing without a sheet (headless content-less checkout) and never throws', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), undefined);
    layer.ingest([razed(9)], 0);
    layer.draw(FLAT, VIEW_ALL, 0);
    expect(spriteLayer.children).toHaveLength(0);
  });
});
