import { type Application, Container, type Renderer, type Sprite, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { shownGrade } from '../../../src/data/lighting/grade.js';
import { LightSiteList } from '../../../src/data/lighting/light-sites.js';
import { SceneLight } from '../../../src/gpu/lighting/scene-light.js';
import { WorldRenderer } from '../../../src/gpu/world-renderer/index.js';
import { entity, snapshotOf } from '../../support/fixtures.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

const NIGHT = [0.56, 0.56, 0.56] as const;
const SCREEN = { width: 800, height: 600 };
const frameAt = (gameSeconds: number) => ({ screenW: SCREEN.width, screenH: SCREEN.height, gameSeconds });
const quads = (light: SceneLight): [Sprite, Sprite, Container] =>
  light.container.children as [Sprite, Sprite, Container];
const SHOWN_NIGHT = shownGrade(NIGHT, [1, 1, 1]);
const packed = ([r, g, b]: readonly number[]) =>
  (Math.round((r ?? 0) * 255) << 16) | (Math.round((g ?? 0) * 255) << 8) | Math.round((b ?? 0) * 255);

describe('SceneLight', () => {
  it('draws nothing in daylight', () => {
    const light = new SceneLight();
    light.update(frameAt(0));
    light.setTarget(null);
    light.update(frameAt(1));
    expect(light.container.visible).toBe(false);
    light.destroy();
  });

  it('multiplies by the shown grade, snapping on the first frame and fading after', () => {
    const light = new SceneLight();
    light.setTarget(NIGHT);
    light.update(frameAt(10));
    const [shade] = quads(light);
    expect(light.container.visible).toBe(true);
    expect(shade.visible).toBe(true);
    expect(shade.tint).toBe(packed(SHOWN_NIGHT));
    expect(shade.width).toBe(SCREEN.width);
    light.setTarget(null);
    light.update(frameAt(10.1));
    const fading = light.drawnGrade()[0];
    expect(fading).toBeGreaterThan(SHOWN_NIGHT[0]);
    expect(fading).toBeLessThan(1);
    light.update(frameAt(10.1));
    expect(light.drawnGrade()[0]).toBe(fading); // paused
    light.update(frameAt(100));
    expect(light.container.visible).toBe(false);
    light.destroy();
  });

  it('takes a snapped target at once after a daylight first frame', () => {
    const light = new SceneLight();
    light.update(frameAt(0));
    light.setTarget(NIGHT, true);
    light.update(frameAt(0.1));
    expect(light.drawnGrade()).toEqual(SHOWN_NIGHT);
    light.destroy();
  });

  it('adds the channels above daylight as one quad', () => {
    const light = new SceneLight();
    light.setTarget([1.34, 1.15, 0.9]);
    light.update(frameAt(0));
    const [shade, overbright] = quads(light);
    expect(shade.visible).toBe(true);
    expect(shade.tint).toBe(0xffffe6);
    expect(overbright.visible).toBe(true);
    expect(overbright.tint).toBe(0x160a00); // a quarter of the excess: 0.085, 0.0375, 0
    light.setTarget([1.2, 1.1, 1]);
    light.update(frameAt(30));
    expect(shade.visible).toBe(false);
    expect(overbright.visible).toBe(true);
    light.setTarget([0.9, 0.9, 0.9]);
    light.update(frameAt(60));
    expect(shade.visible).toBe(true);
    expect(overbright.visible).toBe(false);
    light.destroy();
  });
});

describe('SceneLight at night', () => {
  const camera = { offsetX: 100, offsetY: 50, scale: 2 };
  const nightWith = (lights: LightSiteList) => {
    const render = vi.fn();
    const renderer = { resolution: 1, render } as unknown as Renderer;
    const light = new SceneLight();
    light.setTarget(NIGHT, true);
    light.update({ ...frameAt(0), camera, lights: lights.sites, renderer });
    return { light, render };
  };

  it('hands the composite a light map cleared to the shown night, a pool per light and a flame per fire', () => {
    const lights = new LightSiteList();
    lights.push('building', 1, 10, 20);
    lights.push('fire', 2, 40, 60);
    const { light, render } = nightWith(lights);
    expect(light.nightLevel()).toBe(1);
    const [shade, , flares] = quads(light);
    expect(shade.visible).toBe(false);
    expect(render).toHaveBeenCalledOnce();
    const pass = render.mock.calls[0]?.[0] as { container: Container; clearColor: number[]; target: unknown };
    expect(light.composite()?.light).toBe(pass.target);
    expect(pass.clearColor.slice(0, 3)).toEqual(SHOWN_NIGHT);
    const pools = pass.container.children.flatMap((group) => group.children.filter((pool) => pool.visible));
    expect(pools.map((pool) => [pool.x, pool.y])).toEqual([
      [120, 90],
      [180, 170],
    ]);
    expect(flares.children.filter((flare) => flare.visible)).toHaveLength(1);
    light.shadeForPicture(true);
    expect(shade.visible).toBe(true);
    expect(shade.texture).toBe(pass.target);
    light.shadeForPicture(false);
    expect(shade.visible).toBe(false);
    light.destroy();
  });

  it('composites a night with no light on screen too, so the settlers still show lit', () => {
    const { light, render } = nightWith(new LightSiteList());
    expect(render).toHaveBeenCalledOnce();
    expect(light.composite()).not.toBeNull();
    light.destroy();
  });

  it('draws a flat night without its lights when the settings turn them off', () => {
    const lights = new LightSiteList();
    lights.push('fire', 2, 40, 60);
    const render = vi.fn();
    const renderer = { resolution: 1, render } as unknown as Renderer;
    const light = new SceneLight();
    light.setTarget(NIGHT, true);
    light.update({ ...frameAt(0), camera, lights: lights.sites, renderer, dayNight: false });
    const [shade, , flares] = quads(light);
    expect(render).not.toHaveBeenCalled();
    expect(light.composite()).toBeNull();
    expect(shade.tint).toBe(packed(SHOWN_NIGHT));
    expect(flares.children.some((flare) => flare.visible)).toBe(false);
    light.destroy();
  });

  it('burns none at sunset, and a snap out of the night puts the flames out', () => {
    const lights = new LightSiteList();
    lights.push('fire', 2, 40, 60);
    const { light } = nightWith(lights);
    const [shade, , flares] = quads(light);
    light.setTarget([1, 0.9, 0.8], true);
    expect(light.nightLevel()).toBe(0);
    light.update({ ...frameAt(1), camera, lights: lights.sites });
    expect(light.container.visible).toBe(true);
    expect(light.composite()).toBeNull();
    expect(shade.visible).toBe(true);
    expect(shade.texture).toBe(Texture.WHITE);
    expect(flares.children.some((flare) => flare.visible)).toBe(false);
    light.destroy();
  });
});

describe('SceneLight attack night', () => {
  const camera = { offsetX: 0, offsetY: 0, scale: 1 };
  const renderer = { resolution: 1, render: vi.fn() } as unknown as Renderer;
  const frame = (gameSeconds: number) => ({ ...frameAt(gameSeconds), camera, renderer });

  it('falls over a day as a lit night and lifts back to daylight', () => {
    const light = new SceneLight();
    light.update(frame(0));
    light.setAttackNight(true);
    light.update(frame(1));
    expect(light.nightLevel()).toBeLessThan(1);
    light.update(frame(4));
    expect(light.nightLevel()).toBe(1);
    expect(light.composite()).not.toBeNull();
    light.setAttackNight(false);
    light.update(frame(8));
    expect(light.nightLevel()).toBe(0);
    expect(light.container.visible).toBe(false);
    light.destroy();
  });

  it('keeps a darker script night as the script draws it', () => {
    const deep = [0.3, 0.32, 0.45] as const;
    const light = new SceneLight();
    light.setTarget(deep, true);
    light.update(frame(0));
    const before = [...light.drawnGrade()];
    light.setAttackNight(true);
    light.update(frame(4));
    expect([...light.drawnGrade()]).toEqual(before);
    light.destroy();
  });
});

describe('WorldRenderer scene light', () => {
  it('mounts over the world and the weather, under the chrome and the HUD', () => {
    const stage = new Container();
    const gpu = {
      resolution: 1,
      renderPipes: { batch: { addToBatch: () => undefined } },
      runners: { contextChange: { add: () => undefined, remove: () => undefined } },
      render: () => undefined,
      extract: { pixels: () => ({ pixels: new Uint8Array(0) }) },
    };
    const app = { stage, screen: SCREEN, renderer: gpu, render: () => undefined };
    const renderer = new WorldRenderer(app as unknown as Application);
    const scene = stage.getChildByLabel('world-scene');
    if (scene === null) throw new Error('missing world scene');
    const labels = scene.children.map((child) => child.label);
    const sky = labels.indexOf('weather-sky');
    const light = labels.indexOf('scene-light');
    expect(sky).toBeGreaterThan(0);
    expect(light).toBe(sky + 1);
    expect(light).toBeLessThan(labels.length - 1);
    expect(stage.getChildIndex(scene)).toBeLessThan(stage.children.length - 1);
    renderer.update({
      snapshot: snapshotOf([entity(1, 0, 0, { Building: {} })]),
      camera: { offsetX: 0, offsetY: 0 },
    });
    expect(scene.children[light]?.visible).toBe(false);
    renderer.dispose();
  });
});
