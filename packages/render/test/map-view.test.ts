import { type Application, Container, type Rectangle } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { halfCellToScreen } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import { type MapViewFrame, MapViewLayer } from '../src/gpu/overlays/map-view.js';
import { SpritePool } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { entity, snapshotOf } from './support/fixtures.js';

/**
 * The briefing map views: each re-aims the world layer so its target lands on the box's focus, renders
 * into the visible clip only, re-culls the world for the pass (a solo card keeps the main culls) and
 * restores it and the layer's transform afterwards, even when the render throws.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const MAIN = { camera: { offsetX: 0, offsetY: 0 }, width: 800, height: 600 };

interface Pass {
  readonly frame: Rectangle;
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

function harness(fail = false) {
  const world = new Container();
  const sprites = new Container();
  world.addChild(sprites);
  const passes: Pass[] = [];
  const app = {
    renderer: {
      render: (opts: { frame: Rectangle }) => {
        passes.push({ frame: opts.frame, x: world.position.x, y: world.position.y, scale: world.scale.x });
        if (fail) throw new Error('render died');
      },
    },
  } as unknown as Application;
  const pool = new SpritePool(sprites, new TextureCache(), undefined);
  const layer = new MapViewLayer(app, world, pool);
  const culls: string[] = [];
  const worldCull = {
    cullTo: () => culls.push('view'),
    restore: () => culls.push('main'),
    backdrop: 0x336633,
  };
  const scene = {
    snapshot: snapshotOf([entity(7, 3, 4, { Settler: {} })]),
    tick: 0,
    alpha: 1,
    elevation: FLAT,
    main: MAIN,
    spriteMargin: 0,
  };
  return { world, passes, layer, culls, worldCull, scene };
}

const VIEW: MapViewFrame = {
  box: { x: 100, y: 50, w: 560, h: 440 },
  // Scrolled: the top 40 px of the box are above the viewport.
  clip: { x: 104, y: 90, w: 552, h: 396 },
  target: { kind: 'node', hx: 10, hy: 20 },
  focusX: 280,
  focusY: 220,
  scale: 2,
};

describe('MapViewLayer', () => {
  it('lands the node on the focus and renders into the visible clip, re-culled for the pass', () => {
    const { world, passes, layer, culls, worldCull, scene } = harness();
    layer.set([VIEW]);
    layer.draw(scene, worldCull);
    const point = halfCellToScreen(10, 20);
    expect(passes).toHaveLength(1);
    const [pass] = passes;
    expect(pass?.frame).toMatchObject({ x: 104, y: 90, width: 552, height: 396 });
    // Frame-local: the focus sits at box + focus - clip, which the camera maps the target point onto.
    expect(pass?.x).toBeCloseTo(100 + 280 - 104 - point.x * 2);
    expect(pass?.y).toBeCloseTo(50 + 220 - 90 - point.y * 2);
    expect(pass?.scale).toBe(2);
    expect(culls).toEqual(['view', 'main']);
    expect(world.position.x).toBe(0);
    expect(world.scale.x).toBe(1);
  });

  it('draws nothing for a vanished entity or a clip scrolled out of sight', () => {
    const { passes, layer, culls, worldCull, scene } = harness();
    layer.set([
      { ...VIEW, target: { kind: 'entity', ref: 99 } },
      { ...VIEW, clip: { x: 104, y: 90, w: 552, h: 0 } },
    ]);
    layer.draw(scene, worldCull);
    expect(passes).toEqual([]);
    expect(culls).toEqual([]);
  });

  it('restores the world when the render throws', () => {
    const { world, layer, culls, worldCull, scene } = harness(true);
    layer.set([VIEW]);
    expect(() => layer.draw(scene, worldCull)).toThrow('render died');
    expect(culls).toEqual(['view', 'main']);
    expect(world.position.x).toBe(0);
    expect(world.children).toHaveLength(1);
  });

  it('draws a solo card over its fill without re-culling the world, and restores its stash', () => {
    const { world, passes, layer, culls, worldCull, scene } = harness(true);
    layer.set([{ ...VIEW, target: { kind: 'entity', ref: 7 }, soloFill: 0xc4c09f }]);
    expect(() => layer.draw(scene, worldCull)).toThrow('render died');
    expect(passes).toHaveLength(1);
    expect(culls).toEqual([]);
    expect(world.children.every((c) => c.visible)).toBe(true);
    expect(world.children).toHaveLength(1);
  });
});
