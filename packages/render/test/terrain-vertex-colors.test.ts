import { Mesh, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { TerrainLayer } from '../src/gpu/terrain/index.js';
import type { TerrainTextureSet } from '../src/gpu/terrain-textures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

function meshes(layer: TerrainLayer): Mesh[] {
  return layer.container.children.flatMap((chunk) =>
    chunk.children.filter((child): child is Mesh => child instanceof Mesh),
  );
}

const palette = Array.from({ length: 256 }, (_, i) => (i === 1 ? 0x408020 : 0x808080));
const terrain = { width: 65, height: 2, typeIds: Array.from({ length: 130 }, () => 0) };

const boundTextures: TerrainTextureSet = {
  pages: new Map([['white', Texture.WHITE.source]]),
  cellFor: () => ({ pageKey: 'white', rect: { x: 0, y: 0, w: 1, h: 1 } }),
};

for (const [name, textures, brightness] of [
  ['flat', undefined, undefined],
  ['textured', boundTextures, undefined],
  ['shaded', boundTextures, Array.from({ length: 130 }, () => 127)],
  ['missing-texture fallback', { pages: new Map(), cellFor: () => undefined }, undefined],
] as const) {
  describe(`terrain vertex colors: ${name}`, () => {
    it('updates only affected mesh buffers, preserves RGB, and skips unchanged replay state', () => {
      const layer = new TerrainLayer();
      layer.set({ ...terrain, ...(brightness === undefined ? {} : { brightness }) }, textures);
      const before = meshes(layer);
      const calls = before.map((mesh) => vi.spyOn(mesh.geometry.getBuffer('aVertexColor'), 'update'));
      const initial = before[0]?.geometry.getBuffer('aVertexColor').data;
      expect(initial).toBeInstanceOf(Float32Array);
      layer.applyVertexColors([{ hx: 0, hy: 0, value: 1 }], palette);
      expect(meshes(layer)).toEqual(before);
      expect(calls[0]).toHaveBeenCalledOnce();
      expect(calls.slice(1).every((call) => call.mock.calls.length === 0)).toBe(true);
      const colors = before[0]?.geometry.getBuffer('aVertexColor').data;
      expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([0.5, 1, 0.25]);
      layer.applyVertexColors([{ hx: 0, hy: 0, value: 1 }], palette);
      expect(calls[0]).toHaveBeenCalledOnce();
      layer.applyVertexColors([{ hx: 0, hy: 0, value: 0 }], palette);
      expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([1, 1, 1]);
      layer.destroy();
    });
  });
}

it('updates all copies of a shared vertex at a chunk boundary', () => {
  const layer = new TerrainLayer();
  layer.set(terrain);
  const all = meshes(layer);
  const calls = all.map((mesh) => vi.spyOn(mesh.geometry.getBuffer('aVertexColor'), 'update'));
  layer.applyVertexColors([{ hx: 64, hy: 0, value: 1 }], palette);
  expect(calls[0]).toHaveBeenCalledOnce();
  expect(calls[1]).toHaveBeenCalledOnce();
  expect(calls[2]).not.toHaveBeenCalled();
  layer.destroy();
});

it('uses neutral colors without a palette and applies saved values when the palette arrives', () => {
  const layer = new TerrainLayer();
  layer.set(terrain);
  layer.applyVertexColors([{ hx: 0, hy: 0, value: 1 }]);
  const colors = meshes(layer)[0]?.geometry.getBuffer('aVertexColor').data;
  expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([1, 1, 1]);
  layer.applyVertexColors([], palette);
  expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([0.5, 1, 0.25]);
  layer.set(terrain);
  layer.applyVertexColors([], palette);
  expect(Array.from(meshes(layer)[0]?.geometry.getBuffer('aVertexColor').data.slice(0, 3) ?? [])).toEqual([
    1, 1, 1,
  ]);
  layer.destroy();
});
