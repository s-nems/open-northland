import { Container, type Geometry, RenderContainer, type Renderer, Texture, WebGLRenderer } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { Viewport } from '../../../src/data/projection/index.js';
import type { AtlasFrame } from '../../../src/data/sprites/index.js';
import {
  type GroundWave,
  GroundWaveLayer,
  groundWaveFrameIndex,
} from '../../../src/gpu/ground-waves/index.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

useHeadlessShaderContext();

const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 4, offsetX: -4, offsetY: -2 };
const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 4, offsetX: -4, offsetY: -2 };
const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const ELSEWHERE: Viewport = { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 };
const CAMERA = { offsetX: 0, offsetY: 0, scale: 1 };
const SCREEN = 640;

function wave(phase = 0): GroundWave {
  return { x: 0, y: 0, source: Texture.WHITE.source, frames: [FRAME_0, FRAME_1], phase };
}

function fakeRenderer(): {
  renderer: Renderer;
  render: ReturnType<typeof vi.fn>;
  restoreContext: () => void;
} {
  const render = vi.fn();
  const listeners = new Set<{ contextChange: () => void }>();
  const contextChange = {
    add: (listener: { contextChange: () => void }) => listeners.add(listener),
    remove: (listener: { contextChange: () => void }) => listeners.delete(listener),
  };
  return {
    renderer: { resolution: 1, render, runners: { contextChange } } as unknown as Renderer,
    render,
    restoreContext: () => {
      for (const listener of listeners) listener.contextChange();
    },
  };
}

/** A WebGL renderer stand-in for the lift pass: its current target and the calls the pass makes. */
function fakeTarget(
  isRoot: boolean,
  viewport = { x: 0, y: 0, width: SCREEN, height: SCREEN },
  { resolution = 1, framebuffer = null as object | null } = {},
) {
  const blitFramebuffer = vi.fn();
  const bindFramebuffer = vi.fn();
  const pixiBind = vi.fn();
  const draw = vi.fn();
  const drawn = { framebuffer, resolveTargetFramebuffer: framebuffer };
  const copy = { framebuffer: { copy: true } };
  const target = { resolution, isRoot, flipY: false };
  const renderer = Object.assign(Object.create(WebGLRenderer.prototype) as WebGLRenderer, {
    gl: { bindFramebuffer, blitFramebuffer, READ_FRAMEBUFFER: 1, DRAW_FRAMEBUFFER: 2, FRAMEBUFFER: 3 },
    renderTarget: {
      viewport,
      renderTarget: target,
      getRenderTarget: (texture: unknown) => texture,
      getGpuRenderTarget: (t: unknown) => (t === target ? drawn : copy),
      adaptor: { bindFramebuffer: pixiBind },
    },
    globalUniforms: { bindGroup: {} },
    encoder: { draw },
  });
  return { renderer, blitFramebuffer, bindFramebuffer, pixiBind, draw };
}

function liftNode(ground: Container): RenderContainer {
  const node = ground.children.find((child) => child instanceof RenderContainer);
  if (node === undefined) throw new Error('no lift pass on the ground');
  return node;
}

/** The corners `[x0, y0, x1, y1]` of each wave quad the last lift map render drew, in lift map pixels. */
function mapQuads(render: ReturnType<typeof vi.fn>): number[][] {
  const root = render.mock.calls.at(-1)?.[0].container as Container;
  const target = fakeTarget(false);
  (root.children[0] as RenderContainer).render(target.renderer);
  const quads: number[][] = [];
  for (const [call] of target.draw.mock.calls) {
    const positions = (call.geometry as Geometry).getBuffer('aPosition').data;
    for (let q = call.start / 6; q < (call.start + call.size) / 6; q++) {
      quads.push([
        positions[q * 8],
        positions[q * 8 + 1],
        positions[q * 8 + 4],
        positions[q * 8 + 5],
      ] as number[]);
    }
  }
  return quads;
}

describe('groundWaveFrameIndex', () => {
  it('advances one frame per tick from the placement phase', () => {
    expect(groundWaveFrameIndex(1, 2, 0)).toBe(1);
    expect(groundWaveFrameIndex(1, 2, 1)).toBe(0);
    expect(groundWaveFrameIndex(0, 2, 3)).toBe(1);
  });
});

describe('GroundWaveLayer', () => {
  it('lifts the ground only while a wave is on screen and motion is on', () => {
    const ground = new Container();
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, ground);
    layer.set([wave()]);
    const target = fakeTarget(true);

    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    liftNode(ground).render(target.renderer);
    expect(target.draw).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);

    layer.update(ELSEWHERE, CAMERA, SCREEN, SCREEN, 1, true);
    liftNode(ground).render(target.renderer);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 2, false);
    liftNode(ground).render(target.renderer);
    expect(target.draw).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('copies only the ground under the waves and the reach of a lift below them', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, { offsetX: 100, offsetY: 50, scale: 1 }, SCREEN, SCREEN, 0, true);
    // FRAME_0 spans world x -4..4 and y -2..2, one pixel more each way, so screen x 95..105, y 47..53,
    // and a lift reads up to a red byte's 255 px below that.
    const canvas = fakeTarget(true);
    liftNode(ground).render(canvas.renderer);
    expect(canvas.blitFramebuffer.mock.calls[0]?.slice(0, 8)).toEqual([
      95,
      SCREEN - 308,
      105,
      SCREEN - 47,
      0,
      0,
      10,
      261,
    ]);
    expect(canvas.draw.mock.calls[0]?.[0].size).toBe(6);
    // A texture target counts its rows from the top.
    const texture = fakeTarget(false);
    liftNode(ground).render(texture.renderer);
    expect(texture.blitFramebuffer.mock.calls[0]?.slice(0, 4)).toEqual([95, 47, 105, 308]);
  });

  it('hands the drawn target back to Pixi after the copy, so its framebuffer cache stays true', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    // An upscaled world draws into a texture of its own, not the canvas.
    const frame = { frame: true };
    const target = fakeTarget(true, undefined, { framebuffer: frame });
    liftNode(ground).render(target.renderer);
    expect(target.bindFramebuffer).toHaveBeenLastCalledWith(3, frame);
    expect(target.pixiBind).toHaveBeenCalledWith(frame);
  });

  it('copies and lifts in target pixels at the world resolution', () => {
    const { renderer, render } = fakeRenderer();
    const ground = new Container();
    const layer = new GroundWaveLayer(renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, { offsetX: 100, offsetY: 50, scale: 1 }, SCREEN, SCREEN, 0, true, 2);
    // At two texels per CSS pixel the wave, padded by one pixel, spans pixels 191..209 by 95..105.
    expect(mapQuads(render)).toEqual([[1, 1, 17, 9]]);
    const target = fakeTarget(
      false,
      { x: 0, y: 0, width: 2 * SCREEN, height: 2 * SCREEN },
      { resolution: 2 },
    );
    liftNode(ground).render(target.renderer);
    expect(target.blitFramebuffer.mock.calls[0]?.slice(0, 4)).toEqual([191, 95, 209, 615]);
  });

  it('writes each redraw into the next of three quad geometries, growing only the one it writes', () => {
    const { renderer } = fakeRenderer();
    const ground = new Container();
    const layer = new GroundWaveLayer(renderer, ground);
    const many = Array.from({ length: 65 }, (_, i) => ({ ...wave(), x: i * 10 }));
    layer.set(many);
    const target = fakeTarget(true);
    const geometries = [];
    for (let tick = 0; tick < 4; tick++) {
      layer.update(WIDE, CAMERA, SCREEN, SCREEN, tick, true);
      liftNode(ground).render(target.renderer);
      geometries.push(target.draw.mock.calls[tick]?.[0].geometry);
    }
    expect(new Set(geometries.slice(0, 3)).size).toBe(3);
    expect(geometries[3]).toBe(geometries[0]);
    expect(target.draw.mock.calls.every((call) => call[0].size === 65 * 6)).toBe(true);
  });

  it('draws the lift map over the waves only, in screen pixels', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    layer.set([wave()]);
    layer.update(WIDE, { offsetX: 100, offsetY: 50, scale: 1 }, SCREEN, SCREEN, 0, true);
    const { target } = render.mock.calls[0]?.[0] ?? {};
    // The padded wave covers screen x 95..105 and y 47..53, so the map's first texel is pixel (95, 47).
    expect(mapQuads(render)).toEqual([[1, 1, 9, 5]]);
    expect([target.source.pixelWidth, target.source.pixelHeight]).toEqual([256, 256]);
  });

  it('draws no lift into a target framed off the screen', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    const inset = fakeTarget(false, { x: 10, y: 0, width: 64, height: 64 });
    liftNode(ground).render(inset.renderer);
    expect(inset.blitFramebuffer).not.toHaveBeenCalled();
    expect(inset.draw).not.toHaveBeenCalled();
  });

  it('keeps the lift over ground chunks added after it', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    const chunk = new Container();
    ground.addChild(chunk);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(ground.children.indexOf(liftNode(ground))).toBe(1);
  });

  it('redraws the lift map only when the tick, the camera, the screen or the waves change', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    const waves = [wave(), { ...wave(), x: 40 }];
    layer.set(waves);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(1);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 1, true);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN, 1, true);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN / 2, 1, true);
    layer.remove(waves[1] as GroundWave);
    layer.update(WIDE, { ...CAMERA, offsetX: 1 }, SCREEN, SCREEN / 2, 1, true);
    expect(render).toHaveBeenCalledTimes(5);
  });

  it('draws the lift map again after the GL context was restored, although nothing else changed', () => {
    const { renderer, render, restoreContext } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    restoreContext();
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(2);
    layer.destroy();
    restoreContext();
  });

  it('draws the waves of the blocks under the view in placement order, whatever their position', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    // The first wave placed lies in a block to the right of the second's, which sits left of the origin.
    const right = 3000;
    const left = -100;
    layer.set([
      { ...wave(), x: right },
      { ...wave(), x: left },
    ]);
    layer.update({ minX: -1000, minY: -1000, maxX: 4000, maxY: 1000 }, CAMERA, SCREEN, SCREEN, 0, true);
    expect(render).toHaveBeenCalledTimes(1);
    // The map starts at screen pixel 0, so a quad's map x is its world x.
    expect(mapQuads(render).map(([x]) => x)).toEqual([right + FRAME_0.offsetX, left + FRAME_0.offsetX]);

    layer.update({ minX: right + 1, minY: -1, maxX: right + 2, maxY: 1 }, CAMERA, SCREEN, SCREEN, 1, true);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('draws neighbouring waves of one page in one call, in placement order across pages', () => {
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, new Container());
    const otherPage = Texture.EMPTY.source;
    const otherFrames = [{ ...FRAME_0 }, { ...FRAME_1 }];
    layer.set([
      wave(),
      { ...wave(), x: 20 },
      { ...wave(), x: 40, source: otherPage, frames: otherFrames },
      { ...wave(), x: 60 },
    ]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    const root = render.mock.calls[0]?.[0].container as Container;
    const target = fakeTarget(false);
    (root.children[0] as RenderContainer).render(target.renderer);
    const calls = target.draw.mock.calls.map(([call]) => [call.start, call.size]);
    expect(calls).toEqual([
      [0, 12],
      [12, 6],
      [18, 6],
    ]);
  });

  it('stops lifting the ground once its only wave is removed', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    const only = wave();
    layer.set([only]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    layer.remove(only);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 1, true);
    const target = fakeTarget(true);
    liftNode(ground).render(target.renderer);
    expect(target.draw).not.toHaveBeenCalled();
  });

  it('turns the lift off for a framed view and back on after it', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    const target = fakeTarget(true);

    layer.suspend(true);
    liftNode(ground).render(target.renderer);
    expect(target.draw).not.toHaveBeenCalled();
    layer.suspend(false);
    liftNode(ground).render(target.renderer);
    expect(target.draw).toHaveBeenCalledTimes(1);
  });

  it('lets go of a lift map before destroying it on a resize and on teardown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const layer = new GroundWaveLayer(fakeRenderer().renderer, new Container());
      layer.set([wave()]);
      layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
      layer.update(WIDE, CAMERA, SCREEN / 2, SCREEN, 1, true);
      layer.destroy();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
