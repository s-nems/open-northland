import { Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { translatedCells } from './geometry.js';

/** The cells standing walls block, and the passages of open gates, which no joint seal may close. */
export interface StandingWallCells {
  readonly walls: ReadonlySet<NodeId>;
  readonly passages: ReadonlySet<NodeId>;
}

export function standingWallCells(world: World, terrain: TerrainGraph): StandingWallCells {
  const walls = new Set<NodeId>();
  const passages = new Set<NodeId>();
  for (const e of world.query(PalisadeBlocking, Palisade, Position)) {
    const wall = world.get(e, Palisade);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const body = translatedCells(terrain, wall.walk, hx, hy);
    for (const cell of body) walls.add(cell);
    if (wall.gate?.open !== true) continue;
    for (const cell of translatedCells(terrain, wall.placementWalk, hx, hy)) {
      if (!body.includes(cell)) passages.add(cell);
    }
  }
  return { walls, passages };
}

/**
 * The nodes that close the slanted joints of wall lines touching `from`. Walls join on the six-node
 * landscape lattice, where an odd-row node's neighbours one half-row up and down sit a column to +x. Two
 * of the pathfinder's diagonal steps cross such a joint, each with one midpoint flank open; blocking one
 * corner of the joint refuses both. The odd-row corner is taken unless an open gate passes there.
 * Project rule: a joined wall line holds walkers wherever it turns.
 */
export function wallJointSeals(
  terrain: TerrainGraph,
  cells: StandingWallCells,
  from: Iterable<NodeId> = cells.walls,
): Set<NodeId> {
  const seals = new Set<NodeId>();
  const { walls, passages } = cells;
  const open = (x: number, y: number): NodeId | null => {
    if (!terrain.inBounds(x, y)) return null;
    const node = terrain.nodeAt(x, y);
    return walls.has(node) ? null : node;
  };
  for (const cell of from) {
    const { x, y } = terrain.coordsOf(cell);
    const odd = (y & 1) === 1;
    for (const dy of [-1, 1]) {
      const partnerX = odd ? x + 1 : x - 1;
      if (!terrain.inBounds(partnerX, y + dy) || !walls.has(terrain.nodeAt(partnerX, y + dy))) continue;
      const oddCorner = odd ? open(x + 1, y) : open(x, y + dy);
      const evenCorner = odd ? open(x, y + dy) : open(x - 1, y);
      // A corner that is already wall closes the joint by the diagonal flank rule; the map edge needs none.
      if (oddCorner === null || evenCorner === null) continue;
      seals.add(passages.has(oddCorner) ? evenCorner : oddCorner);
    }
  }
  return seals;
}
