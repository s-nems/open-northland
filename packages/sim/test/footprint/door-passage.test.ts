import { describe, expect, it } from 'vitest';
import { ONE } from '../../src/core/fixed.js';
import { type LandscapeProps, type NodeId, TerrainGraph } from '../../src/nav/terrain/index.js';
import { doorPassage } from '../../src/systems/footprint/building-blocked-cache.js';

const GRASS = 0;
const PROPS = new Map<number, LandscapeProps>([
  [GRASS, { walkable: true, buildable: true, plantable: true, walkCost: ONE }],
]);

/** `#` a wall node, `D` the door, `.` open ground; one string per lattice row. */
function building(rows: readonly string[]): { terrain: TerrainGraph; body: Set<NodeId>; door: NodeId } {
  const width = rows[0]?.length ?? 0;
  const terrain = new TerrainGraph(
    width,
    rows.length,
    new Int32Array(width * rows.length).fill(GRASS),
    PROPS,
  );
  const body = new Set<NodeId>();
  let door: NodeId | null = null;
  rows.forEach((row, y) => {
    [...row].forEach((mark, x) => {
      if (mark === '#' || mark === 'D') body.add(terrain.nodeAt(x, y));
      if (mark === 'D') door = terrain.nodeAt(x, y);
    });
  });
  if (door === null) throw new Error('fixture has no door');
  return { terrain, body, door };
}

/** Whether the door walks to the bottom row by the pathfinder's steps once its passage is carved. */
function doorWalksOut(terrain: TerrainGraph, body: Set<NodeId>, door: NodeId): boolean {
  const walls = new Set(body);
  for (const cell of doorPassage(terrain, body, door)) walls.delete(cell);
  const seen = new Set<NodeId>([door]);
  const queue = [door];
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at];
    if (cell === undefined) continue;
    if (terrain.yOf(cell) === terrain.height - 1) return true;
    for (const { node } of terrain.steps(cell, walls)) {
      if (!seen.has(node)) {
        seen.add(node);
        queue.push(node);
      }
    }
  }
  return false;
}

describe('doorPassage', () => {
  it('carves past a hole the walls enclose instead of ending the passage in it', () => {
    const { terrain, body, door } = building([
      '#########',
      '####D####',
      '#########',
      '####.####', // a hole beside the first wall cell under the door, sealed on every step
      '#########',
      '.........',
    ]);
    expect(doorWalksOut(terrain, body, door)).toBe(true);
  });

  it('opens only the door when it already stands on the edge', () => {
    const { terrain, body, door } = building(['#####', '##D##', '.....']);
    expect(doorPassage(terrain, body, door)).toEqual([door]);
  });
});
