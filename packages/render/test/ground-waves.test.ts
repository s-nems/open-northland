import { Container, type Renderer, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import type { Viewport } from '../src/data/projection/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { type GroundWave, GroundWaveLayer, groundWaveFrameAt } from '../src/gpu/ground-waves/index.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

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

function fakeRenderer(): { renderer: Renderer; render: ReturnType<typeof vi.fn> } {
  const render = vi.fn();
  return { renderer: { resolution: 1, render } as unknown as Renderer, render };
}

describe('groundWaveFrameAt', () => {
  it('advances one frame per tick from the placement phase', () => {
    expect(groundWaveFrameAt(wave(1), 0)).toBe(FRAME_1);
    expect(groundWaveFrameAt(wave(1), 1)).toBe(FRAME_0);
    expect(groundWaveFrameAt(wave(0), 3)).toBe(FRAME_1);
  });
});

describe('GroundWaveLayer', () => {
  it('filters the ground only while a wave is on screen and motion is on', () => {
    const ground = new Container();
    const { renderer, render } = fakeRenderer();
    const layer = new GroundWaveLayer(renderer, ground);
    layer.set([wave()]);

    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    expect(ground.filters).toHaveLength(1);
    expect(render).toHaveBeenCalledTimes(1);

    layer.update(ELSEWHERE, CAMERA, SCREEN, SCREEN, 1, true);
    expect(ground.filters).toBeNull();

    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 2, false);
    expect(ground.filters).toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('stops lifting the ground once its only wave is removed', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    const only = wave();
    layer.set([only]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    layer.remove(only);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 1, true);
    expect(ground.filters).toBeNull();
  });

  it('turns the lift off for a framed view and back on after it', () => {
    const ground = new Container();
    const layer = new GroundWaveLayer(fakeRenderer().renderer, ground);
    layer.set([wave()]);
    layer.update(WIDE, CAMERA, SCREEN, SCREEN, 0, true);
    const filter = ground.filters?.[0];

    layer.suspend(true);
    expect(filter?.enabled).toBe(false);
    layer.suspend(false);
    expect(filter?.enabled).toBe(true);
  });
});
