import { Mesh, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { halfCellToScreen } from '../src/data/projection/index.js';
import { TerrainLayer } from '../src/gpu/terrain/index.js';
import type { TerrainTextureSet } from '../src/gpu/terrain-textures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

function meshes(layer: TerrainLayer): Mesh[] {
  return layer.container.children.flatMap((chunk) =>
    chunk.children.filter((child): child is Mesh => child instanceof Mesh),
  );
}

const terrain = { width: 65, height: 2, typeIds: Array.from({ length: 130 }, () => 0) };
const NODES_X = 2 * terrain.width;
const NODE_COUNT = NODES_X * 2 * terrain.height;
const TINT = [0.5, 1, 0.25] as const;

/** Neutral multipliers everywhere but `tinted`, which take {@link TINT}. */
function colorsWith(...tinted: readonly (readonly [number, number])[]): Float32Array {
  const colors = new Float32Array(NODE_COUNT * 3).fill(1);
  for (const [hx, hy] of tinted) colors.set(TINT, (hy * NODES_X + hx) * 3);
  return colors;
}

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
      layer.applyVertexColors(colorsWith([0, 0]));
      expect(meshes(layer)).toEqual(before);
      expect(calls[0]).toHaveBeenCalledOnce();
      expect(calls.slice(1).every((call) => call.mock.calls.length === 0)).toBe(true);
      const colors = before[0]?.geometry.getBuffer('aVertexColor').data;
      expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual(TINT);
      layer.applyVertexColors(colorsWith([0, 0]));
      expect(calls[0]).toHaveBeenCalledOnce();
      layer.applyVertexColors(colorsWith());
      expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([1, 1, 1]);
      layer.destroy();
    });
  });
}

/** Every colour triple this mesh stores for the vertex sitting on lattice node (hx, hy). */
function colorsAtNode(mesh: Mesh, hx: number, hy: number): number[][] {
  const { x, y } = halfCellToScreen(hx, hy);
  const positions = mesh.geometry.getBuffer('aPosition').data;
  const colors = mesh.geometry.getBuffer('aVertexColor').data;
  const found: number[][] = [];
  for (let v = 0; v * 2 < positions.length; v++) {
    if (positions[v * 2] === Math.fround(x) && positions[v * 2 + 1] === Math.fround(y))
      found.push(Array.from(colors.slice(v * 3, v * 3 + 3)));
  }
  return found;
}

it('updates all copies of a shared vertex at a chunk boundary', () => {
  const layer = new TerrainLayer();
  layer.set(terrain);
  const [left, right, far] = meshes(layer);
  if (left === undefined || right === undefined || far === undefined)
    throw new Error('expected three chunk meshes');
  // Node 64 is the seam between the first two 32-tile chunks: each keeps its own copies of it, and a
  // copy left behind keeps the old shade as a visible crack down the chunk edge.
  layer.applyVertexColors(colorsWith([64, 0]));
  const seamLeft = colorsAtNode(left, 64, 0);
  const seamRight = colorsAtNode(right, 64, 0);
  expect(seamLeft.length).toBeGreaterThan(0);
  expect(seamRight.length).toBeGreaterThan(0);
  for (const copy of [...seamLeft, ...seamRight]) expect(copy).toEqual(TINT);
  // The third chunk never carries the node, so every one of its vertices keeps the neutral white.
  const untouched = far.geometry.getBuffer('aVertexColor').data;
  expect([...untouched].every((channel) => channel === 1)).toBe(true);
  layer.destroy();
});

it('starts a rebuilt map neutral and ignores border vertices outside the lattice', () => {
  const layer = new TerrainLayer();
  layer.set(terrain);
  layer.applyVertexColors(colorsWith([0, 0]));
  layer.set(terrain);
  const colors = meshes(layer)[0]?.geometry.getBuffer('aVertexColor').data;
  expect(Array.from(colors?.slice(0, 3) ?? [])).toEqual([1, 1, 1]);
  // Every node tinted: the vertices a border cell's triangles push past the lattice keep neutral white.
  layer.applyVertexColors(new Float32Array(NODE_COUNT * 3).fill(TINT[0]));
  const channels = meshes(layer).flatMap((mesh) => [...mesh.geometry.getBuffer('aVertexColor').data]);
  expect(channels.filter((channel) => channel === 1).length).toBeGreaterThan(0);
  expect(channels.every((channel) => channel === 1 || channel === TINT[0])).toBe(true);
  layer.destroy();
});
