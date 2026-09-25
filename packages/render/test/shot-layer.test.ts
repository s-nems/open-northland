import type { SimEvent } from '@open-northland/sim';
import { Container, type Graphics, Sprite, type TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { ONE, tileToScreen, type Viewport } from '../src/data/projection/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import { ShotLayer } from '../src/gpu/overlays/shot-layer.js';
import { resolveLayers } from '../src/gpu/sprite-pool/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas, SpriteSheet } from '../src/index.js';
import { drawItem, drawnGeometry, entity, snapshotOf } from './support/fixtures.js';

/**
 * A siege shot's presentation: the stone on the pool's one-tick lag, its trail outliving the landing,
 * the pool's cull and fog verdict, the landing smoke's life, and the pool drawing nothing for a bound
 * siege shot while an arrow draws its heading frame. The fixture sheet's TextureSource is never sampled.
 */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW_ALL: Viewport = { minX: -1e6, maxX: 1e6, minY: -1e6, maxY: 1e6 };
const source = {} as TextureSource;
const ROCK = 2;
const ARROW = 1;
const SHOT = 7;
const LAUNCH = 10;
/** 16 map points east at weapon speed 3. */
const FLIGHT = 42;
/** The trail's four puff ticks plus the tick the track is kept past them. */
const TRAIL_TAIL = 5;
const SMOKE_TICKS = 20;
/** The pool draws a tick behind the snapshot. */
const LAG = 1;

const frame = (bob: number) => [bob, { x: 0, y: 0, width: 4, height: 4, offsetX: -2, offsetY: -2 }] as const;
const atlas = (bobs: readonly number[]): SpriteAtlas => ({
  width: 64,
  height: 64,
  frames: new Map(bobs.map(frame)),
});
const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: 1,
    munition: {
      byMunition: {
        [ROCK]: { layer: 'rock', valencies: [[212, 213]], loop: true, directional: false },
        [ARROW]: { layer: 'arrow', valencies: [[0], [1], [2], [3]], loop: true, directional: true },
      },
      trailByMunition: {
        [ROCK]: { layer: 'smoke', valencies: [[4, 3, 2, 1]], loop: false, directional: false },
      },
      impactSmoke: { layer: 'smoke', valencies: [[187, 188]], loop: false, directional: false },
    },
  },
  families: {
    rock: { source, atlas: atlas([212, 213]) },
    smoke: { source, atlas: atlas([1, 2, 3, 4, 187, 188]) },
    arrow: { source, atlas: atlas([0, 1, 2, 3]) },
  },
};

const stone = entity(SHOT, 2, 4, {
  Projectile: {
    originX: 2 * ONE,
    originY: 4 * ONE,
    aimX: 10 * ONE,
    aimY: 4 * ONE,
    speed: 3,
    launchTick: LAUNCH,
    munitionType: ROCK,
    impact: { smokeTicks: SMOKE_TICKS },
  },
});
const inFlight = snapshotOf([stone], LAUNCH);
const landed = snapshotOf([], LAUNCH + FLIGHT + 1);
const drawnShot = drawnGeometry({ anchorOf: (ref) => (ref === SHOT ? { x: 0, y: 0 } : undefined) });

function layer(): { shots: ShotLayer; spriteLayer: Container } {
  const spriteLayer = new Container();
  return { shots: new ShotLayer(spriteLayer, new TextureCache(), sheet), spriteLayer };
}

const sprites = (c: Container) => c.children.filter((n): n is Sprite => n instanceof Sprite && n.visible);
const shadows = (c: Container) => c.children.filter((n) => !(n instanceof Sprite) && n.visible) as Graphics[];

describe('ShotLayer', () => {
  it('flies the stone on the pool lag: on the catapult at launch, over the chord mid-flight', () => {
    const { shots, spriteLayer } = layer();
    const draw = (snapshot = inFlight, renderTime = LAUNCH) =>
      shots.draw({ snapshot, drawn: drawnShot, elevation: FLAT, viewport: VIEW_ALL, renderTime });
    draw(inFlight, LAUNCH + LAG);
    const from = tileToScreen(2, 4);
    const to = tileToScreen(10, 4);
    const [atLaunch] = sprites(spriteLayer);
    expect(atLaunch?.x).toBe(from.x - 2);
    draw(inFlight, LAUNCH + LAG + FLIGHT / 2);
    const mid = sprites(spriteLayer).find((s) => s.alpha === 1);
    expect(mid?.x).toBeCloseTo((from.x + to.x) / 2 - 2);
    expect(mid?.y).toBeLessThan(from.y - 2 - 40); // lobbed at least the minimum peak
    expect(shadows(spriteLayer)).toHaveLength(1);
  });

  it('plays the trail out after the stone lands, then retires every node', () => {
    const { shots, spriteLayer } = layer();
    const draw = (snapshot: typeof inFlight, renderTime: number) =>
      shots.draw({ snapshot, drawn: drawnShot, elevation: FLAT, viewport: VIEW_ALL, renderTime });
    draw(inFlight, LAUNCH + LAG + FLIGHT);
    draw(landed, LAUNCH + LAG + FLIGHT + 1);
    const puffs = sprites(spriteLayer);
    expect(puffs.length).toBeGreaterThan(0);
    expect(puffs.every((p) => p.alpha < 1)).toBe(true); // no stone, only translucent puffs
    expect(shadows(spriteLayer)).toHaveLength(0);
    draw(landed, LAUNCH + LAG + FLIGHT + TRAIL_TAIL + 1);
    expect(spriteLayer.children).toHaveLength(0);
  });

  it('draws nothing of a shot the pool culled or fogged', () => {
    const { shots, spriteLayer } = layer();
    shots.draw({
      snapshot: inFlight,
      drawn: drawnGeometry(),
      elevation: FLAT,
      viewport: VIEW_ALL,
      renderTime: LAUNCH + LAG + FLIGHT / 2,
    });
    expect(spriteLayer.children).toHaveLength(0);
  });

  it('raises the landing smoke for at most its lifetime', () => {
    const { shots, spriteLayer } = layer();
    const burst = {
      kind: 'groundBurst',
      projectile: SHOT,
      munitionType: ROCK,
      smokeTicks: SMOKE_TICKS,
      at: { hx: 20, hy: 8 },
    } as SimEvent;
    const tick = LAUNCH + FLIGHT + 1;
    shots.ingest([burst], tick);
    const draw = (renderTime: number) =>
      shots.draw({
        snapshot: landed,
        drawn: drawnGeometry(),
        elevation: FLAT,
        viewport: VIEW_ALL,
        renderTime,
      });
    draw(tick);
    expect(sprites(spriteLayer)).toHaveLength(1);
    draw(tick + SMOKE_TICKS);
    expect(spriteLayer.children).toHaveLength(0);
  });
});

describe('the pool on a projectile', () => {
  it('draws nothing for a bound siege shot, an arrow its heading frame, and an unbound one the marker', () => {
    const siege = drawItem('projectile', { munition: ROCK, siege: true, rotation: 0 });
    expect(resolveLayers(sheet, siege, 0)).toEqual([]);
    const east = drawItem('projectile', { munition: ARROW, rotation: 0 });
    const layers = resolveLayers(sheet, east, 0);
    expect(layers?.[0]?.frame).toBe(sheet.families?.arrow?.atlas.frames.get(1)); // a quarter turn of 4
    expect(resolveLayers(sheet, drawItem('projectile', { munition: 9 }), 0)).toBeNull();
  });
});
