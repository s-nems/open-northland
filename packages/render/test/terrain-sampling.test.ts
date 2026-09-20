import { TRANSITION_NONE, TRANSITION_PAIRS } from '@open-northland/data';
import { BufferImageSource, Mesh, UniformGroup } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { TerrainLayer } from '../src/gpu/terrain/index.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

function meshOf(layer: TerrainLayer): Mesh {
  const mesh = layer.container.children[0]?.children[0];
  if (!(mesh instanceof Mesh)) throw new Error('Missing terrain mesh');
  return mesh;
}

describe('terrain shader gating', () => {
  it('branches on the water enhancement instead of multiplying by it, and samples before it filters', () => {
    const source = new BufferImageSource({ resource: new Uint8Array(64 * 64 * 4), width: 64, height: 64 });
    const layer = new TerrainLayer();
    layer.set(
      { width: 1, height: 1, typeIds: [0], brightness: [127] },
      {
        pages: new Map([['ground', source]]),
        cellFor: () => ({ pageKey: 'ground', rect: { x: 0, y: 0, w: 63, h: 63 } }),
      },
    );
    const fragment = meshOf(layer).shader?.glProgram?.fragment ?? '';
    // The baseline must not pay for the enhancement, so the flag may gate a branch but never multiply
    // into an expression: a `mix(..., uEnhancedWater)` evaluates the enhanced terms on every fragment,
    // on land and with the setting off.
    expect(fragment).toContain('if (uEnhancedWater > 0.5)');
    expect(fragment).not.toMatch(/[,*+-]\s*uEnhancedWater/);
    expect(fragment).not.toMatch(/uEnhancedWater\s*[*+]/);
    // The sampling gate has to return before the derivatives, or the baseline pays for them anyway.
    expect(fragment.indexOf('uEnhancedSampling < 0.5')).toBeLessThan(fragment.indexOf('dFdx('));
    layer.destroy();
    source.destroy();
  });
});

describe('terrain footprint sampling', () => {
  for (const shaded of [false, true]) {
    it(`keeps triangle bounds and shared live setting across rebuilds (${shaded ? 'shaded' : 'unshaded'})`, () => {
      const source = new BufferImageSource({
        resource: new Uint8Array(128 * 64 * 4),
        width: 128,
        height: 64,
      });
      const textures = {
        pages: new Map([['ground', source]]),
        cellFor: (typeId: number) => ({ pageKey: 'ground', rect: { x: typeId * 64, y: 0, w: 63, h: 63 } }),
      };
      const terrain = { width: 2, height: 1, typeIds: [0, 1], ...(shaded ? { brightness: [127, 127] } : {}) };
      const layer = new TerrainLayer();
      layer.setEnhancedSampling(true);
      layer.set(terrain, textures);
      const mesh = meshOf(layer);
      const bounds = mesh.geometry.getBuffer('aSampleBounds').data;
      expect(Array.from(bounds)).toEqual([
        ...Array.from({ length: 6 }, () => [0, 0, 63 / 128, 63 / 64]).flat(),
        ...Array.from({ length: 6 }, () => [0.5, 0, 127 / 128, 63 / 64]).flat(),
      ]);
      const group = mesh.shader?.resources.waveVars;
      if (!(group instanceof UniformGroup)) throw new Error('Missing shared sampling uniforms');
      expect(group.uniforms.uEnhancedSampling).toBe(1);
      expect(group.uniforms.uEnhancedWater).toBe(0);
      layer.setEnhancedWater(true);
      layer.setEnhancedSampling(false);
      expect(group.uniforms.uEnhancedSampling).toBe(0);
      expect(group.uniforms.uEnhancedWater).toBe(1);
      expect(meshOf(layer)).toBe(mesh);
      expect(layer.container.children[0]?.children).toHaveLength(1);
      layer.setEnhancedSampling(true);
      layer.set(terrain, textures);
      expect(meshOf(layer).shader?.resources.waveVars.uniforms.uEnhancedSampling).toBe(1);
      expect(meshOf(layer).shader?.resources.waveVars.uniforms.uEnhancedWater).toBe(1);
      layer.destroy();
      source.destroy();
    });
  }

  it('pushes the water shading pair in lockstep with the wave amplitude on a ground-lane map', () => {
    const source = new BufferImageSource({ resource: new Uint8Array(64 * 64 * 4), width: 64, height: 64 });
    const tile = { pageKey: 'ground', coordsA: [0, 0, 63, 63, 0, 63], coordsB: [0, 0, 63, 0, 63, 63] };
    const textures = {
      pages: new Map([['ground', source]]),
      cellFor: () => undefined,
      groundFor: () => tile,
    };
    // Two cells on one page: meadow, then deep water. Vertices come out triangle by triangle, cell A
    // then cell B: vertices 0..5 belong to the meadow cell (some on the water cell's nodes), 6..11 to
    // the water cell.
    const terrain = {
      width: 2,
      height: 1,
      typeIds: [0, 0],
      brightness: [127, 127],
      ground: { patterns: ['block meadow 00', 'block water 01'], a: [0, 1], b: [0, 1] },
    };
    const layer = new TerrainLayer();
    layer.set(terrain, textures);
    const geometry = meshOf(layer).geometry;
    const waves = geometry.getBuffer('aWave').data;
    const water = geometry.getBuffer('aWater').data;
    expect(waves).toHaveLength(12);
    expect(water).toHaveLength(24);
    expect(Array.from(water.slice(0, 12))).toEqual(new Array(12).fill(0));
    expect(Array.from(water.slice(12, 14))).toEqual([1, 1]);
    layer.destroy();
    source.destroy();
  });

  it('keeps the water shading off a land transition overlaid on water', () => {
    const source = new BufferImageSource({ resource: new Uint8Array(64 * 64 * 4), width: 64, height: 64 });
    const tile = { pageKey: 'ground', coordsA: [0, 0, 63, 63, 0, 63], coordsB: [0, 0, 63, 0, 63, 63] };
    const textures = {
      pages: new Map([['ground', source]]),
      cellFor: () => undefined,
      groundFor: () => tile,
      transitionFor: () => ({ pageKey: 'ground', coordsA: [tile.coordsA], coordsB: [tile.coordsB] }),
    };
    // One deep-water cell: a sand overlay on triangle A, a water overlay on triangle B (pair 0 of
    // transition types 0 and 1).
    const SAND_PAIR_0 = 0;
    const WATER_PAIR_0 = TRANSITION_PAIRS;
    const terrain = {
      width: 1,
      height: 1,
      typeIds: [0],
      brightness: [127],
      ground: { patterns: ['block water 01'], a: [0], b: [0] },
      transitions: {
        types: ['sand 1', 'water bright 1'],
        a1: [SAND_PAIR_0],
        b1: [WATER_PAIR_0],
        a2: [TRANSITION_NONE],
        b2: [TRANSITION_NONE],
      },
    };
    const layer = new TerrainLayer();
    layer.set(terrain, textures);
    const overlay = layer.container.children[0]?.children[1];
    if (!(overlay instanceof Mesh)) throw new Error('Missing overlay mesh');
    const water = overlay.geometry.getBuffer('aWater').data;
    expect(Array.from(water)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    layer.destroy();
    source.destroy();
  });

  it('leaves mipmapped materials on hardware sampling', () => {
    const source = new BufferImageSource({
      resource: new Uint8Array(16),
      width: 2,
      height: 2,
      autoGenerateMipmaps: true,
    });
    const layer = new TerrainLayer();
    layer.setEnhancedSampling(true);
    layer.set(
      { width: 1, height: 1, typeIds: [0] },
      {
        pages: new Map([['own', source]]),
        cellFor: () => ({ pageKey: 'own', rect: { x: 0, y: 0, w: 1, h: 1 } }),
      },
    );
    expect(meshOf(layer).shader?.resources.sampling.uniforms.uManualSampling).toBe(0);
    layer.destroy();
    source.destroy();
  });
});
