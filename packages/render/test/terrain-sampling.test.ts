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
      layer.setEnhancedSampling(false);
      expect(group.uniforms.uEnhancedSampling).toBe(0);
      expect(meshOf(layer)).toBe(mesh);
      expect(layer.container.children[0]?.children).toHaveLength(1);
      layer.setEnhancedSampling(true);
      layer.set(terrain, textures);
      expect(meshOf(layer).shader?.resources.waveVars.uniforms.uEnhancedSampling).toBe(1);
      layer.destroy();
      source.destroy();
    });
  }

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
