import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingFootprintOf, sameCells, translatedCells } from './geometry.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence verifier -
// the building twin of ./resource-blocked-cache.ts.

interface BuildingBlockedCache {
  /** Building MEMBERSHIP generation (add/remove/destroy) the cells were derived at. */
  readonly membershipGeneration: number;
  /** Building VALUE generation the cells were last confirmed at. Of the Building fields only
   *  `buildingType` moves cells (the in-place home tier swap), while `built` progress bumps this on every
   *  construction advance, so a bump replays the written buildings against {@link types} and rebuilds
   *  only when one changed type. */
  valueGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  /** The `buildingType` each derived building's cells came from. */
  readonly types: ReadonlyMap<Entity, number>;
}

const buildingBlockedCache = new WeakMap<World, BuildingBlockedCache>();

/** Open the shortest passage through a building's own walk block to exterior ground.
 * Some door points are ringed by wall cells; clearing the point alone leaves the door unreachable. */
function doorPassage(terrain: TerrainGraph, body: ReadonlySet<NodeId>, door: NodeId): NodeId[] {
  const queue: NodeId[] = [door];
  const parent = new Map<NodeId, NodeId>();
  const depth = new Map<NodeId, number>([[door, 0]]);
  let exit: { via: NodeId; outside: NodeId; depth: number } | null = null;
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at];
    if (cell === undefined) continue;
    const steps = depth.get(cell) ?? 0;
    if (exit !== null && steps > exit.depth) break;
    for (const next of terrain.neighbours(cell)) {
      if (!terrain.isWalkable(next)) continue;
      if (!body.has(next)) {
        if (exit === null || steps < exit.depth || (steps === exit.depth && next < exit.outside))
          exit = { via: cell, outside: next, depth: steps };
      } else if (!depth.has(next)) {
        depth.set(next, steps + 1);
        parent.set(next, cell);
        queue.push(next);
      }
    }
  }
  const passage = [door];
  if (exit === null) return passage;
  let cell = exit.via;
  while (cell !== door) {
    passage.push(cell);
    const previous = parent.get(cell);
    if (previous === undefined) break;
    cell = previous;
  }
  return passage;
}

/** One full derivation - the rebuild and the verifier's reference run through this single path. Records
 *  each building's type into `types` when given. */
function deriveBuildingBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  types?: Map<Entity, number>,
): Set<NodeId> {
  const blocked = new Set<NodeId>();
  // The exact door point stays open even if another building's reserved margin overlaps it.
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    types?.set(e, b.buildingType);
    const footprint = buildingFootprintOf(content, b.buildingType);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
    const body = new Set(translatedCells(terrain, footprint.blocked, ax, ay));
    const door = footprint.door;
    if (door !== undefined) {
      const doorX = ax + footprintCellDx(ay, door);
      if (terrain.inBounds(doorX, ay + door.dy)) {
        const doorNode = terrain.nodeAt(doorX, ay + door.dy);
        doors.add(doorNode);
        for (const cell of doorPassage(terrain, body, doorNode)) body.delete(cell);
      }
    }
    for (const cell of body) blocked.add(cell);
  }
  for (const cell of doors) blocked.delete(cell);
  return blocked;
}

/** Whether the Building value writes since the cache's confirmed generation left every derived building's
 *  type alone, so its cells still hold. False when the journal cannot cover the span. */
function valueWritesKeepCells(world: World, cached: BuildingBlockedCache, valueGeneration: number): boolean {
  if (cached.valueGeneration === valueGeneration) return true;
  const written = world.valueWritesSince(Building, cached.valueGeneration);
  if (written === null) return false;
  for (const e of written) {
    const b = world.tryGet(e, Building);
    if (b !== undefined && world.has(e, Position) && cached.types.get(e) !== b.buildingType) return false;
  }
  return true;
}

function verifyBuildingBlockedCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = buildingBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Building) ||
    !valueWritesKeepCells(world, cached, world.componentValueGeneration(Building))
  ) {
    return []; // stale key - the next read rebuilds, nothing can consume the old cells
  }
  const fresh = deriveBuildingBlockedCells(world, content, terrain);
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `buildingBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - a Building changed in place outside World.mut`,
  ];
}

/**
 * The cells standing buildings make UNWALKABLE right now - the union of every placed building's
 * `footprint.blocked` cells at its current level. The walk-block applies from the placement tick, so a grey
 * foundation already occupies its cells, exactly like the original.
 *
 * A building's own DOOR and the shortest passage to exterior ground are left walkable when the door
 * lies inside the walk-block. Without that passage a clear door point can still be sealed by wall cells.
 *
 * Derived state, never hashed. Memoized per world on the Building store's membership generation and the
 * buildings' types, so construction progress keeps the build and a burst of callers between two building
 * changes shares one. A rebuild returns a new set, so its identity keys dependent caches. The returned set
 * is the SHARED cached copy: membership reads only. A set union and a door subtraction, neither with a pick,
 * so store-iteration order cannot change it.
 */
export function buildingBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const membershipGeneration = world.componentGeneration(Building);
  const valueGeneration = world.componentValueGeneration(Building);
  const cached = buildingBlockedCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.membershipGeneration === membershipGeneration &&
    valueWritesKeepCells(world, cached, valueGeneration)
  ) {
    cached.valueGeneration = valueGeneration;
    return cached.cells;
  }

  world.journalValueWrites(Building);
  const types = new Map<Entity, number>();
  const cells = deriveBuildingBlockedCells(world, ctx.content, terrain, types);
  buildingBlockedCache.set(world, {
    membershipGeneration,
    valueGeneration,
    content: ctx.content,
    terrain,
    cells,
    types,
  });
  world.registerCacheVerifier('buildingBlockedCells', () =>
    verifyBuildingBlockedCache(world, ctx.content, terrain),
  );
  return cells;
}
