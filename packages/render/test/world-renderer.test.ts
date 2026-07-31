import { type Application, Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { WorldRenderer } from '../src/gpu/world-renderer/index.js';
import { mountPainterOrder, type WorldSceneLayers } from '../src/gpu/world-renderer/painter-order.js';

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
  'doorBadges',
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
