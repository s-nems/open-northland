import { type Application, Container, type Sprite } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { SceneLight } from '../../src/gpu/lighting/scene-light.js';
import { WorldRenderer } from '../../src/gpu/world-renderer/index.js';
import { entity, snapshotOf } from '../support/fixtures.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';

useHeadlessShaderContext();

const NIGHT = [0.56, 0.56, 0.56] as const;
const SCREEN = { width: 800, height: 600 };
const frameAt = (gameSeconds: number) => ({ screenW: SCREEN.width, screenH: SCREEN.height, gameSeconds });
const quads = (light: SceneLight): [Sprite, Sprite] => light.container.children as [Sprite, Sprite];

describe('SceneLight', () => {
  it('draws nothing in daylight', () => {
    const light = new SceneLight();
    light.update(frameAt(0));
    light.setTarget(null);
    light.update(frameAt(1));
    expect(light.container.visible).toBe(false);
    light.destroy();
  });

  it('multiplies by the grade, snapping on the first frame and fading after', () => {
    const light = new SceneLight();
    light.setTarget(NIGHT);
    light.update(frameAt(10));
    const [shade] = quads(light);
    expect(light.container.visible).toBe(true);
    expect(shade.visible).toBe(true);
    expect(shade.tint).toBe(0x8f8f8f); // 0.56 * 255
    expect(shade.width).toBe(SCREEN.width);
    light.setTarget(null);
    light.update(frameAt(10.1));
    const fading = light.drawnGrade()[0];
    expect(fading).toBeGreaterThan(NIGHT[0]);
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
    expect(light.drawnGrade()).toEqual([...NIGHT]);
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

describe('WorldRenderer scene light', () => {
  it('mounts over the world and the weather, under the chrome and the HUD', () => {
    const stage = new Container();
    const gpu = { resolution: 1, renderPipes: { batch: { addToBatch: () => undefined } } };
    const app = { stage, screen: SCREEN, renderer: gpu, render: () => undefined };
    const renderer = new WorldRenderer(app as unknown as Application);
    const labels = stage.children.map((child) => child.label);
    const sky = labels.indexOf('weather-sky');
    const light = labels.indexOf('scene-light');
    expect(sky).toBeGreaterThan(0);
    expect(light).toBe(sky + 1);
    expect(light).toBeLessThan(labels.length - 1);
    renderer.update({
      snapshot: snapshotOf([entity(1, 0, 0, { Building: {} })]),
      camera: { offsetX: 0, offsetY: 0 },
    });
    expect(stage.children[light]?.visible).toBe(false);
    renderer.dispose();
  });
});
