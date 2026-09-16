import { type Application, Container, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WorldRenderer } from '../src/gpu/world-renderer/index.js';
import { mountPainterOrder, type WorldSceneLayers } from '../src/gpu/world-renderer/painter-order.js';
import { entity, snapshotOf } from './support/fixtures.js';

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

describe('WorldRenderer scene graph', () => {
  it('keeps enhanced camera motion subpixel and restores device alignment when switched off', () => {
    const app = stubApp();
    const renderer = new WorldRenderer(app, { viewSmoothing: true });
    const world = app.stage.children[0];
    if (world === undefined) throw new Error('missing world layer');
    const frame = { snapshot: snapshotOf([]), camera: { offsetX: 0.25, offsetY: -0.25, scale: 2 } };
    renderer.update(frame);
    expect(world.x).toBe(0);
    expect(world.y).toBeCloseTo(0);
    renderer.setGraphicsEnhancements({
      enhancedSampling: true,
      softShadows: false,
      environmentMotion: false,
    });
    renderer.update(frame);
    expect(world.x).toBe(0.25);
    expect(world.y).toBe(-0.25);
    renderer.setGraphicsEnhancements({
      enhancedSampling: false,
      softShadows: false,
      environmentMotion: false,
    });
    renderer.update(frame);
    expect(world.x).toBe(0);
    expect(world.y).toBeCloseTo(0);
    expect(frame.camera.offsetX).toBe(0.25);
    renderer.dispose();
  });

  it('toggles enhanced RGBA sampling independently of the legacy view-smoothing option', () => {
    const app = stubApp();
    const source = new TextureSource({ width: 8, height: 8, scaleMode: 'nearest' });
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
    renderer.setGraphicsEnhancements({
      enhancedSampling: true,
      softShadows: false,
      environmentMotion: false,
    });
    renderer.update(frame);
    expect(source.scaleMode).toBe('linear');
    renderer.setGraphicsEnhancements({
      enhancedSampling: false,
      softShadows: false,
      environmentMotion: false,
    });
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
