import { BufferImageSource, Mesh, UniformGroup } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { makeElevationField, NO_WATER } from '../../src/data/terrain/index.js';
import { buildWeatherField } from '../../src/data/weather/field.js';
import type { WeatherConditions } from '../../src/data/weather/types.js';
import { TerrainLayer } from '../../src/gpu/terrain/index.js';
import { type WeatherCoverTarget, WeatherGround } from '../../src/gpu/weather/ground-weather.js';
import { useHeadlessShaderContext } from '../support/shader-context.js';

useHeadlessShaderContext();

const WIDTH = 20;
const HEIGHT = 20;
const VIEW = { camera: { offsetX: 0, offsetY: 0, scale: 1 }, screenW: 640, screenH: 360 };
const TERRAIN = {
  width: WIDTH,
  height: HEIGHT,
  water: NO_WATER,
  elevation: makeElevationField(undefined, 0, 0),
};

function snowField(density: number) {
  return buildWeatherField(
    [{ weather: 'snow', min: { hx: 0, hy: 0 }, max: { hx: 2 * WIDTH - 1, hy: 2 * HEIGHT - 1 }, density }],
    2 * WIDTH,
    2 * HEIGHT,
  );
}

const SNOWING: WeatherConditions = {
  amounts: { rain: 0, snow: 0.3, sand: 0 },
  storm: 0,
  windX: 30,
  windY: 0,
  gust: 0,
  flash: 0,
  strikes: [],
};

/** Records every cover and clock the ground hands a target. */
function recorder(): WeatherCoverTarget & { calls: (Uint8Array | null)[]; rain: number[] } {
  const calls: (Uint8Array | null)[] = [];
  const rain: number[] = [];
  return {
    calls,
    rain,
    setWeatherCover: (texels) => calls.push(texels === null ? null : texels.slice()),
    setWeatherCoverClock: (_seconds, falling) => rain.push(falling),
  };
}

function rainField(density: number) {
  return buildWeatherField(
    [{ weather: 'rain', min: { hx: 0, hy: 0 }, max: { hx: 2 * WIDTH - 1, hy: 2 * HEIGHT - 1 }, density }],
    2 * WIDTH,
    2 * HEIGHT,
  );
}

const RAINING: WeatherConditions = { ...SNOWING, amounts: { rain: 0.3, snow: 0, sand: 0 } };

describe('WeatherGround', () => {
  it('never switches the terrain cover on over a dry map', () => {
    const target = recorder();
    const ground = new WeatherGround([target]);
    ground.setTerrain(TERRAIN);
    ground.setField(snowField(0));
    for (let t = 0; t < 5; t += 0.1) ground.update(null, VIEW, t);
    expect(target.calls.every((c) => c === null)).toBe(true);
    expect(ground.container.children.every((c) => !c.visible)).toBe(true);
    ground.destroy();
  });

  it('opens a snowy map white and runs its reactions while it snows', () => {
    const target = recorder();
    const ground = new WeatherGround([target]);
    ground.setTerrain(TERRAIN);
    ground.setField(snowField(3000));
    ground.update(SNOWING, VIEW, 0);
    const first = target.calls[0];
    expect(first?.[1]).toBe(255);
    expect(ground.container.children.some((c) => c.visible)).toBe(true);
    ground.setEnabled(false);
    expect(target.calls.at(-1)).toBeNull();
    expect(ground.container.children.every((c) => !c.visible)).toBe(true);
    ground.destroy();
  });
});

describe('WeatherGround cover targets', () => {
  it('hands every target the same cover and runs the clock only while it shows', () => {
    const terrain = recorder();
    const decor = recorder();
    const ground = new WeatherGround([terrain, decor]);
    ground.setTerrain(TERRAIN);
    ground.setField(rainField(3000));
    ground.update(RAINING, VIEW, 0);
    expect(decor.calls).toEqual(terrain.calls);
    // Rain falling now rides the cover's alpha, the wetness its red.
    expect(terrain.calls[0]?.[0]).toBe(255);
    expect(terrain.calls[0]?.[3]).toBe(255);
    expect(terrain.rain.at(-1)).toBeCloseTo(1, 5);
    ground.destroy();
  });

  it('clears the previous map cover from every target when the next map opens dry', () => {
    const terrain = recorder();
    const decor = recorder();
    const ground = new WeatherGround([terrain, decor]);
    ground.setTerrain(TERRAIN);
    ground.setField(snowField(3000));
    ground.update(SNOWING, VIEW, 0);
    ground.setTerrain(TERRAIN);
    ground.setField(null);
    ground.update(null, VIEW, 1);
    expect(decor.calls.at(-1)).toBeNull();
    expect(terrain.calls.at(-1)).toBeNull();
    ground.destroy();
  });
});

describe('terrain weather cover hook', () => {
  it('gates the cover behind one uniform that stays off until a grid arrives', () => {
    const source = new BufferImageSource({ resource: new Uint8Array(64 * 64 * 4), width: 64, height: 64 });
    const layer = new TerrainLayer();
    layer.set(
      { width: 2, height: 2, typeIds: [0, 0, 0, 0], brightness: [127, 127, 127, 127] },
      {
        pages: new Map([['ground', source]]),
        cellFor: () => ({ pageKey: 'ground', rect: { x: 0, y: 0, w: 63, h: 63 } }),
      },
    );
    const mesh = layer.container.children[0]?.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('Missing terrain mesh');
    const fragment = mesh.shader?.glProgram?.fragment ?? '';
    // A dry map must not pay for the cover: the switch gates a branch and never scales an expression.
    expect(fragment).toContain('if (uCover > 0.5)');
    expect(fragment).not.toMatch(/[,*+-]\s*uCover\b/);
    const group = mesh.shader?.resources.coverVars;
    if (!(group instanceof UniformGroup)) throw new Error('Missing cover uniforms');
    expect(group.uniforms.uCover).toBe(0);
    const texels = new Uint8Array(1 * 1 * 4).fill(255);
    layer.setWeatherCover(texels, 1, 1);
    expect(group.uniforms.uCover).toBe(1);
    layer.setWeatherCover(new Uint8Array(3 * 2 * 4), 3, 2);
    const cover = mesh.shader?.resources.uCoverTex;
    expect(cover?.width).toBe(3);
    expect(cover?.height).toBe(2);
    layer.setWeatherCover(null, 0, 0);
    expect(group.uniforms.uCover).toBe(0);
    layer.destroy();
    source.destroy();
  });
});
