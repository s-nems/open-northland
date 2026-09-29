import { type ContentSet, footprintCellDx } from '@open-northland/data';
import { Building, Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { buildingFootprintOf, countsMatchCells, sameCells, translatedCells } from './geometry.js';
import { standingWallCells, wallJointSeals } from './wall-joints.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence verifier -
// the building twin of ./resource-blocked-cache.ts.

interface BuildingBlockedCache extends CountedCells {
  /** Building MEMBERSHIP generation (add/remove/destroy) the cells were derived at. */
  readonly membershipGeneration: number;
  /** Building VALUE generation the cells were last confirmed at (see {@link heldBuildingTypesStand}). */
  valueGeneration: number;
  /** Palisade and PalisadeBlocking membership generations: a wall or a shut gate blocks its walk cells.
   *  Its cells and gate state change only by a re-add; the in-place writes are a claim and build progress. */
  readonly palisadeMembershipGeneration: number;
  readonly palisadeBlockingGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  /** 1 on {@link cells}, else 0. One array per world and terrain, restamped by each rebuild. */
  readonly counts: Uint16Array;
  /** The `buildingType` each derived building's cells came from. */
  readonly types: ReadonlyMap<Entity, number>;
}

const buildingBlockedCache = new WeakMap<World, BuildingBlockedCache>();

/** Open the shortest passage through a building's own walk block to exterior ground.
 * Some door points are ringed by wall cells; clearing the point alone leaves the door unreachable. Open
 * ground the walls enclose is no exit: the saracen fortress's door lane zig-zags through one-node holes
 * that this lattice's steps cannot follow, so its nearest opening is a sealed pocket. */
export function doorPassage(terrain: TerrainGraph, body: ReadonlySet<NodeId>, door: NodeId): NodeId[] {
  const leadsOut = exteriorTest(terrain, body, door);
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
        if (!leadsOut(next)) continue;
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

/** Whether open ground walks out past the body's bounding box by the pathfinder's own steps, so an exit
 *  into a hole the walls enclose is refused. Memoized per open node within one building's carve. */
function exteriorTest(
  terrain: TerrainGraph,
  body: ReadonlySet<NodeId>,
  door: NodeId,
): (open: NodeId) => boolean {
  let x0 = terrain.xOf(door);
  let x1 = x0;
  let y0 = terrain.yOf(door);
  let y1 = y0;
  for (const n of body) {
    x0 = Math.min(x0, terrain.xOf(n));
    x1 = Math.max(x1, terrain.xOf(n));
    y0 = Math.min(y0, terrain.yOf(n));
    y1 = Math.max(y1, terrain.yOf(n));
  }
  const outside = (n: NodeId): boolean => {
    const x = terrain.xOf(n);
    const y = terrain.yOf(n);
    return x < x0 || x > x1 || y < y0 || y > y1;
  };
  const verdict = new Map<NodeId, boolean>();
  return (open) => {
    const known = verdict.get(open);
    if (known !== undefined) return known;
    const seen = new Set<NodeId>([open]);
    const queue: NodeId[] = [open];
    let out = false;
    for (let at = 0; at < queue.length && !out; at++) {
      const cell = queue[at];
      if (cell === undefined) continue;
      if (outside(cell) || verdict.get(cell) === true) out = true;
      else {
        for (const { node } of terrain.steps(cell, body)) {
          if (!seen.has(node)) {
            seen.add(node);
            queue.push(node);
          }
        }
      }
    }
    // A failed flood saw its whole pocket, so every node of it shares the verdict.
    if (out) verdict.set(open, true);
    else for (const n of seen) verdict.set(n, false);
    return out;
  };
}

interface BuildingCells {
  /** The building bodies, doors and their passages carved out. */
  readonly blocked: Set<NodeId>;
  /** Each door node and the passage cleared from it to exterior ground. */
  readonly openings: Set<NodeId>;
}

function deriveBuildingCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  types?: Map<Entity, number>,
): BuildingCells {
  const blocked = new Set<NodeId>();
  const openings = new Set<NodeId>();
  // The exact door point stays open even if another building's reserved margin overlaps it.
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    types?.set(e, b.buildingType);
    const footprint = buildingFootprintOf(content, b.buildingType, b.tribe);
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
        for (const cell of doorPassage(terrain, body, doorNode)) {
          body.delete(cell);
          openings.add(cell);
        }
      }
    }
    for (const cell of body) blocked.add(cell);
  }
  for (const cell of doors) blocked.delete(cell);
  return { blocked, openings };
}

/** One full derivation - the rebuild and the verifier's reference run through this single path. Records
 *  each building's type into `types` when given. */
function deriveBuildingBlockedCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  types?: Map<Entity, number>,
): Set<NodeId> {
  const { blocked, openings } = deriveBuildingCells(world, content, terrain, types);
  // Walls go in after the door subtraction, so an authored overlap cannot punch a door-shaped hole
  // through a palisade.
  const walls = standingWallCells(world, terrain);
  for (const cell of walls.walls) blocked.add(cell);
  for (const cell of wallJointSeals(terrain, walls, walls.walls, openings)) blocked.add(cell);
  return blocked;
}

/**
 * Whether the Building value writes since `generation` left every building in `types` at its held type.
 * Of the Building fields only `buildingType` moves a footprint (the in-place tier swap), while `built`
 * progress bumps the value generation on every construction advance. False when the journal cannot cover
 * the span; the caller turned on `journalValueWrites(Building)` when it recorded `types`.
 */
export function heldBuildingTypesStand(
  world: World,
  types: ReadonlyMap<Entity, number>,
  generation: number,
): boolean {
  if (world.componentValueGeneration(Building) === generation) return true;
  const written = world.valueWritesSince(Building, generation);
  if (written === null) return false;
  for (const e of written) {
    const type = types.get(e);
    if (type !== undefined && world.tryGet(e, Building)?.buildingType !== type) return false;
  }
  return true;
}

interface OpeningsMemo {
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly membershipGeneration: number;
  valueGeneration: number;
  readonly types: ReadonlyMap<Entity, number>;
  readonly openings: ReadonlySet<NodeId>;
}

const openingsMemo = new WeakMap<World, OpeningsMemo>();

/** Every building's door node and the passage cleared from it to exterior ground, which a wall joint
 *  seal leaves open. Memoized on Building membership and the buildings' types, so construction progress
 *  and a wall change keep it. Derived state, never hashed. */
export function buildingOpenings(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const membershipGeneration = world.componentGeneration(Building);
  const valueGeneration = world.componentValueGeneration(Building);
  const held = openingsMemo.get(world);
  if (
    held?.content === content &&
    held.terrain === terrain &&
    held.membershipGeneration === membershipGeneration &&
    heldBuildingTypesStand(world, held.types, held.valueGeneration)
  ) {
    held.valueGeneration = valueGeneration;
    return held.openings;
  }
  world.journalValueWrites(Building);
  const types = new Map<Entity, number>();
  const { openings } = deriveBuildingCells(world, content, terrain, types);
  openingsMemo.set(world, { content, terrain, membershipGeneration, valueGeneration, types, openings });
  return openings;
}

function palisadesUnchanged(world: World, cached: BuildingBlockedCache): boolean {
  return (
    cached.palisadeMembershipGeneration === world.componentGeneration(Palisade) &&
    cached.palisadeBlockingGeneration === world.componentGeneration(PalisadeBlocking)
  );
}

function verifyBuildingBlockedCache(world: World, content: ContentSet, terrain: TerrainGraph): string[] {
  const cached = buildingBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain || cached.content !== content) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Building) ||
    !palisadesUnchanged(world, cached) ||
    !heldBuildingTypesStand(world, cached.types, cached.valueGeneration)
  ) {
    return []; // stale key - the next read rebuilds, nothing can consume the old cells
  }
  const fresh = deriveBuildingBlockedCells(world, content, terrain);
  if (!sameCells(cached.cells, fresh)) {
    return [
      `buildingBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} - a Building changed in place outside World.mut`,
    ];
  }
  if (!countsMatchCells(cached.counts, cached.cells)) {
    return ['buildingBlockedCells counts disagree with its cells - a rebuild missed a restamp'];
  }
  return [];
}

/**
 * The cells standing buildings make UNWALKABLE right now - the union of every placed building's
 * `footprint.blocked` cells at its current level. The walk-block applies from the placement tick, so a grey
 * foundation already occupies its cells, exactly like the original.
 *
 * A building's own DOOR and the shortest passage to exterior ground are left walkable when the door
 * lies inside the walk-block. Without that passage a clear door point can still be sealed by wall cells.
 * Standing walls and shut gates add their walk cells and the seals of their slanted joints
 * (`wallJointSeals`), which leave a door and its passage open.
 *
 * Derived state, never hashed. Memoized per world on the Building store's membership generation, the
 * buildings' types and the wall membership generations, so building progress, a wall claim and a wall's
 * build keep it. A rebuild returns a new set, so its identity keys dependent caches. The returned set is
 * the SHARED cached copy: membership reads only. A set union and a door subtraction, neither with a pick,
 * so store-iteration order cannot change it.
 */
export function buildingBlockedCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return buildingBlockedLayer(world, ctx, terrain).cells;
}

/** {@link buildingBlockedCells} with its per-node counts, for the dynamic overlay. */
export function buildingBlockedLayer(world: World, ctx: ContentContext, terrain: TerrainGraph): CountedCells {
  const membershipGeneration = world.componentGeneration(Building);
  const valueGeneration = world.componentValueGeneration(Building);
  const cached = buildingBlockedCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.membershipGeneration === membershipGeneration &&
    palisadesUnchanged(world, cached) &&
    heldBuildingTypesStand(world, cached.types, cached.valueGeneration)
  ) {
    cached.valueGeneration = valueGeneration;
    return cached;
  }

  world.journalValueWrites(Building);
  const types = new Map<Entity, number>();
  const cells = deriveBuildingBlockedCells(world, ctx.content, terrain, types);
  let counts: Uint16Array;
  if (cached?.terrain === terrain) {
    counts = cached.counts;
    for (const cell of cached.cells) counts[cell] = 0;
  } else {
    counts = new Uint16Array(terrain.nodeCount);
  }
  for (const cell of cells) counts[cell] = 1;
  const cache: BuildingBlockedCache = {
    membershipGeneration,
    valueGeneration,
    palisadeMembershipGeneration: world.componentGeneration(Palisade),
    palisadeBlockingGeneration: world.componentGeneration(PalisadeBlocking),
    content: ctx.content,
    terrain,
    cells,
    counts,
    types,
  };
  buildingBlockedCache.set(world, cache);
  world.registerCacheVerifier('buildingBlockedCells', () =>
    verifyBuildingBlockedCache(world, ctx.content, terrain),
  );
  return cache;
}
