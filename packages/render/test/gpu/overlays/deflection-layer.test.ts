import type { SimEvent } from '@open-northland/sim';
import { Container, Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DEFLECTION_TICKS, GLANCE_TICKS } from '../../../src/data/effects/deflection.js';
import type { Viewport } from '../../../src/data/projection/index.js';
import type { ElevationField } from '../../../src/data/terrain/index.js';
import { DeflectionLayer } from '../../../src/gpu/overlays/deflection-layer.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../../../src/index.js';

/** The drawn glance: the arrow's heading frame and shape, the cull and fog, and its retirement. The
 *  fixture sheet's TextureSource is never sampled. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const VIEW_NONE: Viewport = { minX: 1e6, maxX: 1e6 + 1, minY: 1e6, maxY: 1e6 + 1 };
const source = {} as TextureSource;
const ARROW = 1;
const ROCK = 2;
const TICK = 50;
const FRAME_SIDE = 4;
const LONG = { length: 2, thickness: 1 };

const atlas: SpriteAtlas = {
  width: 64,
  height: 64,
  frames: new Map(
    [0, 1, 2, 3].map((bob) => [
      bob,
      { x: 0, y: 0, width: FRAME_SIDE, height: FRAME_SIDE, offsetX: -2, offsetY: -2 },
    ]),
  ),
};
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: 1,
    munition: {
      byMunition: {
        [ARROW]: { layer: 'arrow', valencies: [[0], [1], [2], [3]], loop: true, directional: true },
      },
      trailByMunition: {},
    },
  },
  families: { arrow: { source, atlas } },
  shotShapes: () => LONG,
};

const blocked = (projectile: number, munitionType = ARROW): SimEvent =>
  ({
    kind: 'arrowBlocked',
    projectile,
    shooter: 3,
    target: 4,
    munitionType,
    soundType: 1,
    at: { hx: 20, hy: 8 },
  }) as SimEvent;

function layer(): { arrows: DeflectionLayer; spriteLayer: Container } {
  const spriteLayer = new Container();
  return { arrows: new DeflectionLayer(spriteLayer, new TextureCache(), sheet), spriteLayer };
}
const shown = (c: Container) => c.children.filter((n): n is Sprite => n instanceof Sprite && n.visible);

describe('DeflectionLayer', () => {
  it('draws the arrow heading frame at its shape, glancing to the ground, then retires it', () => {
    const { arrows, spriteLayer } = layer();
    arrows.ingest([blocked(2)], TICK);
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: TICK });
    const [arrow] = shown(spriteLayer);
    expect(arrow?.texture.frame.width).toBe(FRAME_SIDE);
    expect(Math.max(arrow?.scale.x ?? 0, arrow?.scale.y ?? 0)).toBeCloseTo(LONG.length);
    const struck = { x: arrow?.x, y: arrow?.y };
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: TICK + GLANCE_TICKS });
    expect(arrow?.y).toBeGreaterThan(struck.y ?? 0); // came down
    expect(Math.abs(arrow?.rotation ?? 0)).toBeCloseTo(Math.PI);
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: TICK + DEFLECTION_TICKS });
    expect(spriteLayer.children).toHaveLength(0);
  });

  it('holds its pose while the render clock stands still', () => {
    const { arrows, spriteLayer } = layer();
    arrows.ingest([blocked(2)], TICK);
    const paused = TICK + GLANCE_TICKS / 2;
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: paused });
    const [arrow] = shown(spriteLayer);
    const pose = { x: arrow?.x, y: arrow?.y, rotation: arrow?.rotation };
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: paused });
    expect({ x: arrow?.x, y: arrow?.y, rotation: arrow?.rotation }).toEqual(pose);
  });

  it('hides an arrow off screen or under fog and mints none for an unbound munition', () => {
    const { arrows, spriteLayer } = layer();
    arrows.ingest([blocked(2), blocked(3, ROCK)], TICK);
    arrows.draw({ elevation: FLAT, viewport: VIEW_NONE, renderTime: TICK });
    expect(spriteLayer.children).toHaveLength(0);
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: TICK, fogVisible: () => false });
    expect(spriteLayer.children).toHaveLength(0);
    arrows.draw({ elevation: FLAT, viewport: VIEW_ALL, renderTime: TICK });
    expect(shown(spriteLayer)).toHaveLength(1);
  });
});
