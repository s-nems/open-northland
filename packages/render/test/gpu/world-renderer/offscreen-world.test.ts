import {
  type Application,
  Container,
  RendererType,
  RenderTarget,
  type RenderTexture,
  Texture,
} from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { OffscreenWorld } from '../../../src/gpu/world-renderer/offscreen-world.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

/** A stage with the renderer's scene at its bottom, a canvas at `resolution`, and spies for the two
 *  renders a frame makes: the scene into its frame, then the stage. */
function stubApp(resolution: number) {
  const stage = new Container();
  const scene = new Container();
  scene.label = 'world-scene';
  const world = new Container();
  const lit = new Container();
  world.addChild(lit);
  scene.addChild(world, new Container());
  stage.addChild(scene);
  const hud = new Container();
  stage.addChild(hud);
  const targets: RenderTexture[] = [];
  const renderer = {
    resolution,
    render: vi.fn((options: { target?: RenderTexture }) => {
      if (options.target !== undefined) targets.push(options.target);
    }),
    renderTarget: { getRenderTarget: () => ({ isRoot: false }) },
  };
  const app = { stage, screen: { width: 800, height: 600 }, renderer, render: vi.fn() };
  return {
    app: app as unknown as Application & typeof app,
    stage,
    scene,
    world,
    lit,
    hud,
    renderer,
    targets,
  };
}

const presentOf = (stage: Container) => stage.getChildByLabel('offscreen-world');
/** World texels per device pixel, as the quad's magnifier reads it. */
const texelsPerPixel = (upscale: OffscreenWorld): number | undefined =>
  (upscale as unknown as { uniforms: { uniforms: { uUpscale: Float32Array } } }).uniforms.uniforms
    .uUpscale[1];

/** How the quad reads the frame: 0 sharp, 1 xBR, 2 one fetch. */
const presentMode = (upscale: OffscreenWorld): number | undefined =>
  (upscale as unknown as { uniforms: { uniforms: { uUpscale: Float32Array } } }).uniforms.uniforms
    .uUpscale[0];
const NIGHT = { light: Texture.WHITE, lit: [1, 1, 1] } as const;

describe('OffscreenWorld', () => {
  useHeadlessShaderContext();

  it('reads a frame the size of the canvas with one fetch, except through xBR', () => {
    const modeOf = (filter: 'sharp' | 'xbr', canvas: number, world: number): number | undefined => {
      const { app, scene, world: worldLayer, lit } = stubApp(canvas);
      const frame = new OffscreenWorld(app, scene, worldLayer, lit, filter, world);
      frame.render(NIGHT);
      const mode = presentMode(frame);
      frame.destroy();
      return mode;
    };
    expect(modeOf('sharp', 1, Number.POSITIVE_INFINITY)).toBe(2);
    expect(modeOf('sharp', 2, 1)).toBe(0);
    expect(modeOf('xbr', 1, Number.POSITIVE_INFINITY)).toBe(1);
    expect(modeOf('xbr', 2, 1)).toBe(1);
  });

  it('draws the scene into one kept frame while the canvas is denser, the stage over its quad', () => {
    const { app, stage, scene, world, lit, hud, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, world, lit, 'sharp', 1);
    upscale.render();
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), hud]);
    expect(presentOf(stage)?.visible).toBe(true);
    expect(targets).toHaveLength(2);
    expect(targets[1]).toBe(targets[0]);
    expect(app.render).toHaveBeenCalledTimes(2);
    expect(upscale.drawResolution()).toBe(1);
    expect(texelsPerPixel(upscale)).toBe(0.5);
    upscale.destroy();
  });

  it('keeps the frame under a render scale whose texels do not divide the screen', () => {
    const { app, scene, world, lit, targets } = stubApp(2);
    app.screen.width = 801;
    app.screen.height = 601;
    const upscale = new OffscreenWorld(app, scene, world, lit, 'xbr', 1.3);
    upscale.render();
    upscale.render();
    expect(targets[1]).toBe(targets[0]);
    upscale.destroy();
  });

  it('makes a new frame after a resize and keeps it after', () => {
    const { app, scene, world, lit, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, world, lit, 'sharp', 1);
    upscale.render();
    app.screen.width = 1024;
    upscale.render();
    upscale.render();
    expect(targets[1]).not.toBe(targets[0]);
    expect(targets[2]).toBe(targets[1]);
    expect(targets[0]?.destroyed).toBe(true);
    upscale.destroy();
  });

  it('puts the scene back above the quad when the canvas is no denser, and leaves again', () => {
    const { app, stage, scene, world, lit, hud, renderer, targets } = stubApp(2);
    const upscale = new OffscreenWorld(app, scene, world, lit, 'sharp', 1);
    upscale.render();
    renderer.resolution = 1;
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), scene, hud]);
    expect(presentOf(stage)?.visible).toBe(false);
    expect(targets).toHaveLength(1);
    renderer.resolution = 2;
    upscale.render();
    expect(stage.children).toEqual([presentOf(stage), hud]);
    expect(targets).toHaveLength(2);
    expect(texelsPerPixel(upscale)).toBe(0.5);
    upscale.destroy();
  });
});

describe('OffscreenWorld at night', () => {
  useHeadlessShaderContext();

  it('draws a canvas no denser than the world into its frame while a night composite lights it', () => {
    const { app, stage, scene, world, lit, hud, targets } = stubApp(1);
    const frame = new OffscreenWorld(app, scene, world, lit, 'sharp', Number.POSITIVE_INFINITY);
    frame.render();
    expect(targets).toHaveLength(0);
    frame.render({ light: Texture.WHITE, lit: [1, 1, 1] });
    expect(stage.children).toEqual([presentOf(stage), hud]);
    // The world, then the scene's child over it.
    expect(targets).toHaveLength(2);
    expect(texelsPerPixel(frame)).toBe(1);
    frame.render();
    expect(stage.children).toEqual([presentOf(stage), scene, hud]);
    frame.destroy();
  });

  it('draws a WebGL night into its frame and a lit mask beside it, remade with the frame', () => {
    const { app, stage, scene, world, lit, hud, renderer, targets } = stubApp(1);
    lit.isRenderGroup = true;
    Object.assign(renderer, {
      type: RendererType.WEBGL,
      gl: {
        COLOR_ATTACHMENT0: 0x8ce0,
        NONE: 0,
        drawBuffers: () => {},
        useProgram: () => {},
        clear: () => {},
        getFragDataLocation: () => -1,
      },
      renderPipes: { renderGroup: { execute: () => {} } },
    });
    const night = { light: Texture.WHITE, lit: [1, 1, 1] as const };
    const frame = new OffscreenWorld(app, scene, world, lit, 'sharp', Number.POSITIVE_INFINITY);
    frame.render(night);
    // The masked world, then the scene's children over it into the frame alone.
    const [masked, over] = targets as unknown[];
    expect(masked).toBeInstanceOf(RenderTarget);
    const mask = (masked as RenderTarget).colorTextures[1];
    expect(mask?.format).toBe('r8unorm');
    expect((masked as RenderTarget).colorTexture).toBe((over as RenderTexture).source);
    expect(scene.children.every((child) => child.visible)).toBe(true);
    frame.render(night);
    expect(targets[2]).toBe(masked);
    app.screen.width = 1024;
    frame.render(night);
    expect(targets[4]).not.toBe(masked);
    expect(mask?.destroyed).toBe(true);
    const remade = (targets[4] as unknown as RenderTarget).colorTextures[1];
    frame.render();
    expect(stage.children).toEqual([presentOf(stage), scene, hud]);
    expect(remade?.destroyed).toBe(true);
    frame.destroy();
  });
});
