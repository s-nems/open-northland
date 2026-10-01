import { describe, expect, it } from 'vitest';
import { ResourceFootprint } from '../../src/components/index.js';
import { World } from '../../src/ecs/world.js';
import { createResourceNode } from '../../src/systems/footprint/resources.js';
import { aiContent } from '../fixtures/ai-content.js';

const STONE = 4;
const SMALL_HEAP = 2;
/** A second stone record whose block rows grow with the heap's level. */
const GROWING_HEAP = 9;

function stoneContent() {
  const base = aiContent();
  const small = base.landscapeGfx.find((g) => g.index === SMALL_HEAP);
  if (small === undefined) throw new Error('fixture stone record');
  const rows = (...areas: [number, number, number, number][]) => areas;
  return {
    ...base,
    landscapeGfx: [
      ...base.landscapeGfx.filter((g) => g !== small),
      { ...small, walkBlockAreas: rows([0, 2, 0, 1]) },
      {
        ...small,
        index: GROWING_HEAP,
        walkBlockAreas: rows([1, 0, 0, 1], [3, -1, 0, 3]),
        buildBlockAreas: rows([1, 0, 0, 1]),
      },
    ],
    gatheringPipeline: base.gatheringPipeline.map((p) =>
      p.goodType === STONE
        ? { ...p, harvest: { landscapeType: 15, gfxIndices: [SMALL_HEAP, GROWING_HEAP] } }
        : p,
    ),
  };
}

function walkOf(spec: { gfxIndex?: number; blockLevel?: number }) {
  const world = new World();
  const node = createResourceNode(world, stoneContent(), {
    good: STONE,
    remaining: 10,
    harvestAtomic: 25,
    x: 8,
    y: 8,
    ...spec,
  });
  if (node === null) throw new Error('stone placed');
  return world.get(node, ResourceFootprint).walk;
}

describe('a map-placed resource node', () => {
  it('blocks as its own record up to its authored level', () => {
    expect(walkOf({ gfxIndex: GROWING_HEAP, blockLevel: 1 })).toEqual([{ dx: 0, dy: 0 }]);
    expect(walkOf({ gfxIndex: GROWING_HEAP, blockLevel: 3 })).toHaveLength(3);
  });

  it("falls back to the good's first record without a record of its own", () => {
    expect(walkOf({})).toEqual([{ dx: 2, dy: 0 }]);
    expect(walkOf({ gfxIndex: 77, blockLevel: 3 })).toEqual([{ dx: 2, dy: 0 }]);
  });
});
