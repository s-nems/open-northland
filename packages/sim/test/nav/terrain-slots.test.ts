import { describe, expect, it } from 'vitest';
import { fx, ONE } from '../../src/core/fixed.js';
import { type LandscapeProps, type NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';

const GRASS = 0;
const SAND = 1;
const WATER = 2;
/** A typeId the props table lacks, which reads as blocking. */
const UNLISTED = 3;

const PROPS = new Map<number, LandscapeProps>([
  [GRASS, { walkable: true, buildable: true, plantable: true }],
  [SAND, { walkable: true, buildable: true, plantable: false }],
  [WATER, { walkable: false, buildable: false, plantable: false }],
]);

/** One row: grass, sand, water, an unlisted type, grass. */
function row(): TerrainGraph {
  return new TerrainGraph(5, 1, Int32Array.from([GRASS, SAND, WATER, UNLISTED, GRASS]), PROPS);
}

describe('terrain per-node slots', () => {
  it('answer every node as its type props do', () => {
    const terrain = row();
    const read = (node: number) => ({
      walk: terrain.isWalkable(node as NodeId),
      build: terrain.isBuildable(node as NodeId),
      plant: terrain.isPlantable(node as NodeId),
    });
    expect([0, 1, 2, 3].map(read)).toEqual([
      { walk: true, build: true, plant: true },
      { walk: true, build: true, plant: false },
      { walk: false, build: false, plant: false },
      { walk: false, build: false, plant: false },
    ]);
  });

  it('throw on a node id outside the grid', () => {
    const terrain = row();
    expect(() => terrain.isWalkable(5 as NodeId)).toThrow(/out of range/);
    expect(() => terrain.typeAt(-1 as NodeId)).toThrow(/out of range/);
  });

  it('price a step by its world length and omit an unwalkable one', () => {
    const terrain = row();
    expect(terrain.steps(terrain.nodeAt(0, 0))).toEqual([
      { node: terrain.nodeAt(1, 0), cost: fx.div(ONE, fx.fromInt(2)) },
    ]);
    expect(terrain.steps(terrain.nodeAt(1, 0))).toEqual([
      { node: terrain.nodeAt(0, 0), cost: fx.div(ONE, fx.fromInt(2)) },
    ]);
  });
});
