import {
  type Application,
  BufferImageSource,
  Container,
  Mesh,
  Sprite,
  TextureSource,
  UniformGroup,
} from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { MapObjectSprite } from '../src/gpu/map-objects/index.js';
import {
  markPixelArtSource,
  pixelArtMagnifyMode,
  setPixelArtMagnification,
  setWorldShadowStyle,
  worldShadowStyle,
} from '../src/gpu/pixel-art-registry.js';
import { BASELINE_ENHANCEMENTS, WorldRenderer } from '../src/gpu/world-renderer/index.js';
import { mountPainterOrder, type WorldSceneLayers } from '../src/gpu/world-renderer/painter-order.js';
import { entity, snapshotOf } from './support/fixtures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

// The magnification mode and the shadow style are page globals and the suite shares a process, so a
// test that leaves one set would poison every file after it.
afterEach(() => {
  setPixelArtMagnification('off');
  setWorldShadowStyle(null);
});

/** An {@link Application} stub. Constructing the renderer wires Pixi containers and touches no GL, so
 *  the retained graph is readable here; a field the stub lacks would throw rather than pass. */
function stubApp(): Application {
  return {
    stage: new Container(),
    screen: { width: 800, height: 600 },
    renderer: { resolution: 1 },
    render: () => undefined,
  } as unknown as Application;
}

const SLOTS = [
  'terrain',
  'decorShadows',
  'decor',
  'fog',
  'constructionPlots',
  'placementWash',
  'selection',
  'bones',
  'sprites',
  'blood',
  'damageSmoke',
  'constructionSigns',
  'bubbles',
  'hearts',
  'geometryDebug',
] as const satisfies readonly (keyof WorldSceneLayers)[];

describe('mountPainterOrder', () => {
  it('mounts every slot back to front, in the order that decides what draws over what', () => {
    const layers = Object.fromEntries(
      SLOTS.map((slot) => [slot, new Container()]),
    ) as unknown as WorldSceneLayers;
    const world = new Container();
    mountPainterOrder(world, layers);
    expect(world.children).toEqual(SLOTS.map((slot) => layers[slot]));
  });
});

/** Every {@link Sprite} in the retained graph under `root`. */
function spritesUnder(root: Container): Sprite[] {
  const found: Sprite[] = [];
  const pending: Container[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node instanceof Sprite) found.push(node);
    pending.push(...node.children);
  }
  return found;
}

/** The shared water uniform group of the first shaded terrain mesh under `root`. */
function waveUniformsUnder(root: Container): UniformGroup {
  const pending: Container[] = [root];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const group = node instanceof Mesh ? node.shader?.resources.waveVars : undefined;
    if (group instanceof UniformGroup) return group;
    pending.push(...node.children);
  }
  throw new Error('no shaded terrain mesh');
}

describe('WorldRenderer scene graph', () => {
  it('routes each enhancement to its own layer', () => {
    const app = stubApp();
    const renderer = new WorldRenderer(app);
    const source = new BufferImageSource({ resource: new Uint8Array(64 * 64 * 4), width: 64, height: 64 });
    const tile = { pageKey: 'ground', coordsA: [0, 0, 63, 63, 0, 63], coordsB: [0, 0, 63, 0, 63, 63] };
    renderer.setTerrain(
      {
        width: 2,
        height: 1,
        typeIds: [0, 0],
        brightness: [127, 127],
        ground: { patterns: ['block meadow 00', 'block water 01'], a: [0, 1], b: [0, 1] },
      },
      { pages: new Map([['ground', source]]), cellFor: () => undefined, groundFor: () => tile },
    );
    const treeSource = new BufferImageSource({ resource: new Uint8Array(8 * 8 * 4), width: 8, height: 8 });
    const tree: MapObjectSprite = {
      x: 200,
      y: 200,
      source: treeSource,
      frames: [{ x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -7 }],
      scale: 0.5,
      decor: false,
      phase: 0,
      sway: 0.01,
    };
    renderer.setMapObjects([tree]);
    const frame = {
      snapshot: snapshotOf([]),
      camera: { offsetX: 0, offsetY: 0, scale: 1 },
      tick: 20,
      alpha: 0.5,
    };
    renderer.update(frame);
    const swayed = spritesUnder(app.stage).find((sprite) => sprite.texture.source === treeSource);
    if (swayed === undefined) throw new Error('no swaying tree');
    const stillX = swayed.x;

    const water = waveUniformsUnder(app.stage);
    const magnifyOff = pixelArtMagnifyMode();

    // Each enhancement drives one layer, so every other observable has to hold still beside it.
    renderer.setGraphicsEnhancements({ ...BASELINE_ENHANCEMENTS, environmentMotion: true });
    renderer.update(frame);
    expect(swayed.x).not.toBe(stillX);
    expect(water.uniforms.uEnhancedWater).toBe(0);
    expect(water.uniforms.uEnhancedSampling).toBe(0);
    expect(worldShadowStyle()).toBeNull();
    expect(pixelArtMagnifyMode()).toBe(magnifyOff);

    renderer.setGraphicsEnhancements({ ...BASELINE_ENHANCEMENTS, enhancedWater: true });
    renderer.update(frame);
    expect(water.uniforms.uEnhancedWater).toBe(1);
    expect(water.uniforms.uEnhancedSampling).toBe(0);
    expect(swayed.x).toBe(stillX);

    renderer.setGraphicsEnhancements({ ...BASELINE_ENHANCEMENTS, softShadows: true });
    expect(worldShadowStyle()).not.toBeNull();
    expect(water.uniforms.uEnhancedWater).toBe(0);
    expect(pixelArtMagnifyMode()).toBe(magnifyOff);

    renderer.setGraphicsEnhancements({
      ...BASELINE_ENHANCEMENTS,
      enhancedSampling: true,
      pixelArtScaler: 'sharp',
    });
    expect(water.uniforms.uEnhancedSampling).toBe(1);
    expect(worldShadowStyle()).toBeNull();
    const sharp = pixelArtMagnifyMode();
    renderer.setGraphicsEnhancements({
      ...BASELINE_ENHANCEMENTS,
      enhancedSampling: true,
      pixelArtScaler: 'xbr',
    });
    expect(new Set([magnifyOff, sharp, pixelArtMagnifyMode()]).size).toBe(3);

    renderer.setGraphicsEnhancements(BASELINE_ENHANCEMENTS);
    expect(pixelArtMagnifyMode()).toBe(magnifyOff);
    expect(water.uniforms.uEnhancedSampling).toBe(0);
    renderer.dispose();
    source.destroy();
    treeSource.destroy();
  });

  it('keeps enhanced camera motion subpixel and restores device alignment when switched off', () => {
    const app = stubApp();
    const renderer = new WorldRenderer(app, { viewSmoothing: true });
    const world = app.stage.children[0];
    if (world === undefined) throw new Error('missing world layer');
    const frame = { snapshot: snapshotOf([]), camera: { offsetX: 0.25, offsetY: -0.25, scale: 2 } };
    renderer.update(frame);
    expect(world.x).toBe(0);
    expect(world.y).toBeCloseTo(0);
    renderer.setGraphicsEnhancements({ ...BASELINE_ENHANCEMENTS, enhancedSampling: true });
    renderer.update(frame);
    expect(world.x).toBe(0.25);
    expect(world.y).toBe(-0.25);
    renderer.setGraphicsEnhancements(BASELINE_ENHANCEMENTS);
    renderer.update(frame);
    expect(world.x).toBe(0);
    expect(world.y).toBeCloseTo(0);
    expect(frame.camera.offsetX).toBe(0.25);
    renderer.dispose();
  });

  it('toggles enhanced RGBA sampling independently of the legacy view-smoothing option', () => {
    const app = stubApp();
    const source = new TextureSource({ width: 8, height: 8, scaleMode: 'nearest' });
    markPixelArtSource(source); // the original's loader marks its pages; the art filter claims those
    const renderer = new WorldRenderer(app, {
      viewSmoothing: false,
      sheet: {
        source,
        atlas: {
          width: 8,
          height: 8,
          frames: new Map([[1, { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 }]]),
        },
        bindings: { building: 1, settler: 1, resource: 1 },
      },
    });
    const frame = {
      snapshot: snapshotOf([entity(1, 0, 0, { Building: {} })]),
      camera: { offsetX: 100, offsetY: 100, scale: 0.5 },
    };
    renderer.update(frame); // register the drawn page
    renderer.update(frame);
    expect(source.scaleMode).toBe('nearest');
    renderer.setGraphicsEnhancements({ ...BASELINE_ENHANCEMENTS, enhancedSampling: true });
    renderer.update(frame);
    expect(source.scaleMode).toBe('linear');
    renderer.setGraphicsEnhancements(BASELINE_ENHANCEMENTS);
    renderer.update(frame);
    expect(source.scaleMode).toBe('nearest');
    renderer.dispose();
    source.destroy();
  });

  it('mounts the world layer under the screen chrome, with the whole painter order inside it', () => {
    const app = stubApp();
    const renderer = new WorldRenderer(app);
    const world = app.stage.children[0];
    expect(world).toBeInstanceOf(Container);
    expect((world as Container).children).toHaveLength(SLOTS.length);
    renderer.dispose();
  });

  it('drops the whole graph on dispose', () => {
    const app = stubApp();
    const renderer = new WorldRenderer(app);
    expect(app.stage.children.length).toBeGreaterThan(0);
    renderer.dispose();
    expect(app.stage.children).toHaveLength(0);
  });
});
