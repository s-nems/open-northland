import type { SimEvent } from '@open-northland/sim';
import { Container, type Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_TICKS,
  collapseProgress,
  foldBuildingCollapses,
  MAX_ACTIVE_COLLAPSES,
} from '../src/data/effects/index.js';
import type { Viewport } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import { CollapseLayer } from '../src/gpu/overlays/collapse-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../src/index.js';

/**
 * The building-collapse transient: `buildingDestroyed` (combat raze and player demolish alike) folds into
 * a short sink window during which the body is drawn with its lowest pixel rows clipped at the ground line
 * and the graphic shifted down by the same amount — the mirror of the construction rise (the original's
 * `PrintBob_UsingCollapseTimeMask`). The fixture sheet's fake TextureSource is never sampled, so the layer
 * runs headless; what these pin is the fold lifecycle and the crop/sink arithmetic.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = {} as TextureSource;

const BODY_BOB = 70;
const BODY_H = 10;
const atlas: SpriteAtlas = {
  width: 100,
  height: BODY_H,
  frames: new Map([[BODY_BOB, { x: 0, y: 0, width: 10, height: BODY_H, offsetX: -5, offsetY: -BODY_H }]]),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: { byType: { 13: { layer: 'houses', bob: BODY_BOB } }, default: BODY_BOB },
  },
  families: { houses: { source, atlas } },
};

const razed = (entity: number, buildingType = 13, at: { hx: number; hy: number } = { hx: 4, hy: 6 }) =>
  ({ kind: 'buildingDestroyed', entity, player: 2, buildingType, at }) as SimEvent;

describe('foldBuildingCollapses', () => {
  it('spawns a collapse per positioned buildingDestroyed and expires it after COLLAPSE_TICKS', () => {
    const live = foldBuildingCollapses([], [razed(9)], 100);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ entity: 9, typeId: 13, hx: 4, hy: 6, spawnTick: 100 });
    expect(collapseProgress(live[0] as never, 100)).toBe(0);
    expect(collapseProgress(live[0] as never, 100 + COLLAPSE_TICKS / 2)).toBeCloseTo(0.5);
    expect(collapseProgress(live[0] as never, 100 + COLLAPSE_TICKS)).toBe(1);
    expect(foldBuildingCollapses(live, [], 100 + COLLAPSE_TICKS)).toHaveLength(0);
  });

  it('drops an event with no position, and caps the live list oldest-first', () => {
    expect(
      foldBuildingCollapses(
        [],
        [{ kind: 'buildingDestroyed', entity: 1, player: null, buildingType: 13 } as SimEvent],
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
  it('mints one sinking node per razed building, crops it as it sinks, and retires it when done', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), sheet);
    layer.ingest([razed(9)], 0);

    layer.draw(FLAT, VIEW_ALL, 0);
    expect(spriteLayer.children).toHaveLength(1);
    const node = spriteLayer.children[0] as Container;
    const spr = node.children[0] as Sprite;
    expect(spr.texture.frame.height).toBe(BODY_H); // intact at progress 0
    expect(spr.position.y).toBe(-BODY_H); // the frame's own draw offset (feet-anchored)

    // Halfway: the bottom half of the body is clipped and the remainder shifted down by the same rows,
    // so the visible bottom edge stays pinned at the ground line while the roof sinks.
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS / 2);
    expect(spr.texture.frame.height).toBe(BODY_H / 2);
    expect(spr.position.y).toBe(-BODY_H + BODY_H / 2);

    // Fully sunk (and folded out): the node is destroyed, the layer is empty again.
    layer.ingest([], COLLAPSE_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS);
    expect(spriteLayer.children).toHaveLength(0);
  });

  it('draws nothing without a sheet (headless content-less checkout) and never throws', () => {
    const spriteLayer = new Container();
    const layer = new CollapseLayer(spriteLayer, new TextureCache(), undefined);
    layer.ingest([razed(9)], 0);
    layer.draw(FLAT, VIEW_ALL, 0);
    expect(spriteLayer.children).toHaveLength(0);
  });
});
