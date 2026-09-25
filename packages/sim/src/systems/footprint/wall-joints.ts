import type { FootprintCell } from '@open-northland/data';
import { Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { sameCells, translatedCells } from './geometry.js';

/** A membership test over half-cell nodes. */
export interface NodeMembership {
  has(node: NodeId): boolean;
}

/** The cells standing walls block, and the passages of open gates, which no joint seal may close. */
export interface StandingWallCells {
  readonly walls: NodeMembership & Iterable<NodeId>;
  readonly passages: NodeMembership;
}

/** A node set that counts its members, since the outer posts of a gate's run stand inside its body. */
class CountedNodes implements NodeMembership, Iterable<NodeId> {
  private readonly counts = new Map<NodeId, number>();

  has(node: NodeId): boolean {
    return this.counts.has(node);
  }

  [Symbol.iterator](): Iterator<NodeId> {
    return this.counts.keys();
  }

  add(node: NodeId): void {
    this.counts.set(node, (this.counts.get(node) ?? 0) + 1);
  }

  remove(node: NodeId): void {
    const count = this.counts.get(node) ?? 0;
    if (count <= 1) this.counts.delete(node);
    else this.counts.set(node, count - 1);
  }

  clear(): void {
    this.counts.clear();
  }
}

interface WallCapture {
  readonly walls: readonly NodeId[];
  readonly passages: readonly NodeId[];
}

/** A wall's cells and gate state change only by re-adding its Palisade, and a wall never moves, so the
 *  two membership journals cover every input. */
const WALL_CELL_INPUTS = { membership: [Palisade, PalisadeBlocking], values: [] };

function captureWall(world: World, terrain: TerrainGraph, e: Entity): WallCapture | null {
  if (!world.has(e, PalisadeBlocking)) return null;
  const wall = world.tryGet(e, Palisade);
  const p = world.tryGet(e, Position);
  if (wall === undefined || p === undefined) return null;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  const walls = translatedCells(terrain, wall.walk, hx, hy);
  if (wall.gate?.open !== true) return { walls, passages: [] };
  const passages = translatedCells(terrain, wall.placementWalk, hx, hy).filter(
    (cell) => !walls.includes(cell),
  );
  return { walls, passages };
}

class StandingWallIndex implements StandingWallCells {
  readonly walls = new CountedNodes();
  readonly passages = new CountedNodes();
  private readonly captures: JournaledCaptures<WallCapture>;

  constructor(
    world: World,
    readonly terrain: TerrainGraph,
  ) {
    this.captures = new JournaledCaptures<WallCapture>(
      world,
      WALL_CELL_INPUTS,
      () => world.query(PalisadeBlocking, Palisade, Position),
      {
        capture: (e) => captureWall(world, terrain, e),
        apply: (_e, captured) => {
          for (const cell of captured.walls) this.walls.add(cell);
          for (const cell of captured.passages) this.passages.add(cell);
        },
        withdraw: (_e, captured) => {
          for (const cell of captured.walls) this.walls.remove(cell);
          for (const cell of captured.passages) this.passages.remove(cell);
        },
        clear: () => {
          this.walls.clear();
          this.passages.clear();
        },
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }
}

const standingWallIndexes = new WeakMap<World, StandingWallIndex>();

function deriveStandingWallCells(
  world: World,
  terrain: TerrainGraph,
): { walls: Set<NodeId>; passages: Set<NodeId> } {
  const walls = new Set<NodeId>();
  const passages = new Set<NodeId>();
  for (const e of world.query(PalisadeBlocking, Palisade, Position)) {
    const captured = captureWall(world, terrain, e);
    for (const cell of captured?.walls ?? []) walls.add(cell);
    for (const cell of captured?.passages ?? []) passages.add(cell);
  }
  return { walls, passages };
}

function verifyStandingWallCells(world: World, terrain: TerrainGraph): string[] {
  const held = standingWallIndexes.get(world);
  if (held === undefined || held.terrain !== terrain) return [];
  held.catchUp();
  const fresh = deriveStandingWallCells(world, terrain);
  if (sameCells(new Set(held.walls), fresh.walls) && sameCells(new Set(held.passages), fresh.passages))
    return [];
  return ['standingWallCells holds other cells than a re-derivation - a wall changed in place'];
}

/**
 * The live cells of the standing walls, caught up from the wall membership journals, so a placement or a
 * gate swap costs the walls that changed. Derived state, never hashed; membership reads only.
 */
export function standingWallCells(world: World, terrain: TerrainGraph): StandingWallCells {
  let index = standingWallIndexes.get(world);
  if (index?.terrain !== terrain) {
    index = new StandingWallIndex(world, terrain);
    standingWallIndexes.set(world, index);
    world.registerCacheVerifier('standingWallCells', () => verifyStandingWallCells(world, terrain));
    return index;
  }
  index.catchUp();
  return index;
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
  cells: StandingWallCells | { readonly walls: NodeMembership; readonly passages: NodeMembership },
  from: Iterable<NodeId>,
): Set<NodeId> {
  const seals = new Set<NodeId>();
  const { walls, passages } = cells;
  const open = (x: number, y: number): NodeId | null => {
    if (!terrain.inBounds(x, y)) return null;
    const node = terrain.nodeAt(x, y);
    return walls.has(node) ? null : node;
  };
  for (const cell of from) {
    const x = terrain.xOf(cell);
    const y = terrain.yOf(cell);
    const odd = (y & 1) === 1;
    for (const dy of JOINT_ROW_STEPS) {
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

const JOINT_ROW_STEPS = [-1, 1] as const;

/**
 * The cells `walk` anchored at `hx,hy` closes once it blocks: its own body and the joint seals it makes
 * against the standing walls. An open gate's passage the body now covers is no longer a passage.
 */
export function wallClosingCells(
  world: World,
  terrain: TerrainGraph,
  walk: readonly FootprintCell[],
  hx: number,
  hy: number,
): Set<NodeId> {
  const body = new Set(translatedCells(terrain, walk, hx, hy));
  const standing = standingWallCells(world, terrain);
  const seals = wallJointSeals(
    terrain,
    {
      walls: { has: (node) => body.has(node) || standing.walls.has(node) },
      passages: { has: (node) => !body.has(node) && standing.passages.has(node) },
    },
    body,
  );
  for (const seal of seals) body.add(seal);
  return body;
}
