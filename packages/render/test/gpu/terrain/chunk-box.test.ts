import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { SceneTerrain } from '../../../src/data/scene/index.js';
import { triangleANodes, triangleBNodes } from '../../../src/data/terrain/tessellation.js';
import type { TerrainChild } from '../../../src/gpu/terrain/chunk-batcher.js';
import {
  buildChunks,
  type NodeLiftFn,
  positions,
  TERRAIN_CHUNK_TILES,
} from '../../../src/gpu/terrain/geometry.js';

const MAX_LIFT = 90;
/** A grid of two blocks each way, the second ones short. */
const SIZE = TERRAIN_CHUNK_TILES + 5;
/** Every node a different lift up to the map's highest. */
const lift: NodeLiftFn = (hx, hy) => (hx * 31 + hy * 17) % (MAX_LIFT + 1);

describe('buildChunks', () => {
  it("holds every lifted vertex of a block's cells in the block's box, so a view culls by the box alone", () => {
    const terrain = { width: SIZE, height: SIZE } as SceneTerrain;
    const cells = new Map<Container, { c0: number; r0: number; c1: number; r1: number }>();
    const chunks = buildChunks(new Container(), terrain, MAX_LIFT, (c0, r0, c1, r1) => {
      // The block only mounts what it is handed; a bare container stands in for its mesh.
      const mesh = new Container() as unknown as TerrainChild;
      cells.set(mesh, { c0, r0, c1, r1 });
      return [mesh];
    });
    expect(chunks).toHaveLength(4);
    for (const chunk of chunks) {
      const mesh = chunk.container.children[0];
      const range = mesh === undefined ? undefined : cells.get(mesh);
      if (range === undefined) throw new Error('a block lost its mesh');
      let reachedTop = false;
      for (let row = range.r0; row <= range.r1; row++) {
        for (let col = range.c0; col <= range.c1; col++) {
          for (const nodes of [triangleANodes(col, row), triangleBNodes(col, row)]) {
            const corners = positions(nodes, lift);
            for (let i = 0; i < corners.length; i += 2) {
              const x = corners[i] ?? Number.NaN;
              const y = corners[i + 1] ?? Number.NaN;
              expect(x).toBeGreaterThanOrEqual(chunk.minX);
              expect(x).toBeLessThanOrEqual(chunk.maxX);
              expect(y).toBeGreaterThanOrEqual(chunk.minY);
              expect(y).toBeLessThanOrEqual(chunk.maxY);
              reachedTop ||= y < chunk.minY + MAX_LIFT;
            }
          }
        }
      }
      // The lift raises the top row's vertices into the margin the box leaves above the flat block.
      expect(reachedTop).toBe(true);
    }
  });
});
