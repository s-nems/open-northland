import type { SimEvent } from '@open-northland/sim';
import { Container, type Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_LIFETIME_TICKS,
  COLLAPSE_TICKS,
  collapseDustPuff,
  collapseProgress,
  DUST_PUFFS,
  DUST_SETTLE_TICKS,
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
  it('spawns a collapse per positioned buildingDestroyed and expires it once the dust settles', () => {
    const live = foldBuildingCollapses([], [razed(9)], 100);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ entity: 9, typeId: 13, hx: 4, hy: 6, spawnTick: 100 });
    expect(collapseProgress(live[0] as never, 100)).toBe(0);
    expect(collapseProgress(live[0] as never, 100 + COLLAPSE_TICKS / 2)).toBeCloseTo(0.5);
    expect(collapseProgress(live[0] as never, 100 + COLLAPSE_TICKS)).toBe(1);
    // The sunk body's dust tail keeps the collapse alive for DUST_SETTLE_TICKS more.
    expect(foldBuildingCollapses(live, [], 100 + COLLAPSE_TICKS)).toHaveLength(1);
    expect(foldBuildingCollapses(live, [], 100 + COLLAPSE_LIFETIME_TICKS)).toHaveLength(0);
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

describe('collapseDustPuff', () => {
  it('is deterministic, billows in at the crash, and settles to nothing by the end of the tail', () => {
    expect(collapseDustPuff(9, 3, 7, 20)).toEqual(collapseDustPuff(9, 3, 7, 20));
    expect(collapseDustPuff(9, 3, 0, 20).alpha).toBeLessThanOrEqual(
      // The cloud-wide envelope is still ramping at age 0 — never denser than mid-sink.
      Math.max(...Array.from({ length: COLLAPSE_TICKS }, (_, a) => collapseDustPuff(9, 3, a, 20).alpha)),
    );
    for (let i = 0; i < DUST_PUFFS; i++) {
      expect(collapseDustPuff(9, i, COLLAPSE_LIFETIME_TICKS, 20).alpha).toBe(0);
    }
  });

  it('keeps every puff at or below the ground line, spread across the body base', () => {
    const HALF_W = 20;
    for (let i = 0; i < DUST_PUFFS; i++) {
      for (let age = 0; age < COLLAPSE_LIFETIME_TICKS; age++) {
        const pose = collapseDustPuff(9, i, age, HALF_W);
        expect(pose.y).toBeLessThanOrEqual(0); // dust rolls low, it never plumes upward far
        expect(Math.abs(pose.x)).toBeLessThanOrEqual(HALF_W * 2); // near the base, not across the map
        expect(pose.radius).toBeGreaterThan(0);
      }
    }
  });

  it('holds the cloud dense through the whole sink window before the settle fade', () => {
    // At every tick of the sink at least one puff is well past its birth fade — no gap in the mask.
    for (let age = DUST_SETTLE_TICKS / 2; age <= COLLAPSE_TICKS; age++) {
      const best = Math.max(
        ...Array.from({ length: DUST_PUFFS }, (_, i) => collapseDustPuff(9, i, age, 20).alpha),
      );
      expect(best).toBeGreaterThan(0.2);
    }
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

    // The dust cloud is minted last (drawn over the sprites' crop edge), centered on the body's base
    // line, one unit circle per puff — churning from the first tick.
    const dust = node.children[node.children.length - 1] as Container;
    expect(dust.children).toHaveLength(DUST_PUFFS);
    expect(dust.position.y).toBe(0); // the fixture frame's bottom edge (offsetY + height) is the ground

    // Halfway: the bottom half of the body is clipped and the remainder shifted down by the same rows,
    // so the visible bottom edge stays pinned at the ground line while the roof sinks.
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS / 2);
    expect(spr.texture.frame.height).toBe(BODY_H / 2);
    expect(spr.position.y).toBe(-BODY_H + BODY_H / 2);
    expect(dust.children.some((p) => p.alpha > 0)).toBe(true); // the cloud masks the cut

    // Fully sunk: the body is hidden but the node stays — the dust settles over the empty plot.
    layer.ingest([], COLLAPSE_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_TICKS);
    expect(spriteLayer.children).toHaveLength(1);
    expect(spr.visible).toBe(false);
    expect(dust.children.some((p) => p.alpha > 0)).toBe(true);

    // Settled (and folded out): the node is destroyed, the layer is empty again.
    layer.ingest([], COLLAPSE_LIFETIME_TICKS);
    layer.draw(FLAT, VIEW_ALL, COLLAPSE_LIFETIME_TICKS);
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
