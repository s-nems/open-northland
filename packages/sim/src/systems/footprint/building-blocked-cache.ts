import type { BuildingFootprint, ContentSet } from '@open-northland/data';
import { Building, Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { buildingFootprintOf, countsMatchCells, doorNodeOf, sameCells, translatedCells } from './geometry.js';
import { standingWallCells, wallJointSeals } from './wall-joints.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence verifier -
// the building twin of ./resource-blocked-cache.ts.

interface BuildingBlockedCache extends CountedCells {
  /** The {@link BuildingCellsIndex} revision the cells were derived at. */
  readonly buildingRevision: number;
  /** Palisade and PalisadeBlocking membership generations: a wall or a shut gate blocks its walk cells.
   *  Its cells and gate state change only by a re-add; the in-place writes are a claim and build progress. */
  readonly palisadeMembershipGeneration: number;
  readonly palisadeBlockingGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  /** 1 on {@link cells}, else 0. One array per world and terrain, restamped by each rebuild. */
  readonly counts: Uint16Array;
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

/** A building's walk body: its footprint `blocked` cells on the map with the door and the passage from it
 *  to exterior ground carved out. `passage` starts at the door and is empty without one. */
export interface WalkBody {
  readonly body: Set<NodeId>;
  readonly door: NodeId | null;
  readonly passage: readonly NodeId[];
}

export function walkBodyOf(
  terrain: TerrainGraph,
  footprint: BuildingFootprint,
  anchorX: number,
  anchorY: number,
): WalkBody {
  const body = new Set(translatedCells(terrain, footprint.blocked, anchorX, anchorY));
  const door = doorNodeOf(terrain, footprint, anchorX, anchorY);
  const passage = door === null ? [] : doorPassage(terrain, body, door);
  for (const cell of passage) body.delete(cell);
  return { body, door, passage };
}

interface BuildingCells {
  /** The building bodies, doors and their passages carved out. */
  readonly blocked: ReadonlySet<NodeId>;
  /** Each door node and the passage cleared from it to exterior ground. */
  readonly openings: ReadonlySet<NodeId>;
}

/** Every building carved afresh: the verifiers' reference for {@link BuildingCellsIndex}. */
function deriveBuildingCells(world: World, content: ContentSet, terrain: TerrainGraph): BuildingCells {
  const blocked = new Set<NodeId>();
  const openings = new Set<NodeId>();
  // The exact door point stays open even if another building's reserved margin overlaps it.
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(content, b.buildingType, b.tribe);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const { body, door, passage } = walkBodyOf(
      terrain,
      footprint,
      nodeHxOfPosition(p.x, p.y),
      nodeHyOfPosition(p.y),
    );
    if (door !== null) doors.add(door);
    for (const cell of passage) openings.add(cell);
    for (const cell of body) blocked.add(cell);
  }
  for (const cell of doors) blocked.delete(cell);
  return { blocked, openings };
}

/** Walls go in after the door subtraction, so an authored overlap cannot punch a door-shaped hole through
 *  a palisade. */
function withWalls(world: World, terrain: TerrainGraph, buildings: BuildingCells): Set<NodeId> {
  const blocked = new Set(buildings.blocked);
  const walls = standingWallCells(world, terrain);
  for (const cell of walls.walls) blocked.add(cell);
  for (const cell of wallJointSeals(terrain, walls, walls.walls, buildings.openings)) blocked.add(cell);
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

/** A building as {@link BuildingCellsIndex} stamped it: its type, and the footprint and anchor its walk
 *  body was carved at, of which the body is a pure function together with the terrain. A footprint that
 *  blocks nothing carves no body. */
interface PlacedBody {
  readonly type: number;
  readonly footprint: BuildingFootprint | undefined;
  readonly hx: number;
  readonly hy: number;
  readonly walk: WalkBody | null;
}

/**
 * The buildings' cells without walls, kept across ticks: per node, how many walk bodies cover it, how many
 * doors sit on it and how many passages cross it, so a building placed, razed or retyped re-stamps only its
 * own body. Building membership and value journals name the changed buildings; positions are immutable once
 * placed. A journal gap re-stamps every building. Construction progress and wall changes keep it.
 */
class BuildingCellsIndex implements BuildingCells {
  /** Nodes some body covers and no door sits on. */
  readonly blocked = new Set<NodeId>();
  /** Nodes some door passage crosses. */
  readonly openings = new Set<NodeId>();
  /** Moves whenever {@link blocked} or {@link openings} changes, and on every full re-stamp. */
  revision = 0;
  private membershipGeneration = 0;
  private valueGeneration = 0;
  private readonly bodyCounts: Uint16Array;
  private readonly doorCounts: Uint16Array;
  private readonly passageCounts: Uint16Array;
  private readonly placed = new Map<Entity, PlacedBody>();

  constructor(
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    this.bodyCounts = new Uint16Array(terrain.nodeCount);
    this.doorCounts = new Uint16Array(terrain.nodeCount);
    this.passageCounts = new Uint16Array(terrain.nodeCount);
  }

  /** Whether the stamps still describe the world: no building joined or left, and no value write since the
   *  held generation moved a held building's type. Pure, so the verifier asks it too. */
  current(world: World): boolean {
    if (this.membershipGeneration !== world.componentGeneration(Building)) return false;
    if (this.valueGeneration === world.componentValueGeneration(Building)) return true;
    const written = world.valueWritesSince(Building, this.valueGeneration);
    if (written === null) return false;
    for (const e of written) {
      const held = this.placed.get(e);
      if (held !== undefined && world.tryGet(e, Building)?.buildingType !== held.type) return false;
    }
    return true;
  }

  catchUp(world: World): void {
    const membership = world.componentGeneration(Building);
    const values = world.componentValueGeneration(Building);
    if (membership === this.membershipGeneration && values === this.valueGeneration) return;
    const joined =
      membership === this.membershipGeneration
        ? NO_ENTITIES
        : world.membershipDeltasSince(Building, this.membershipGeneration);
    const written =
      values === this.valueGeneration ? NO_ENTITIES : world.valueWritesSince(Building, this.valueGeneration);
    if (joined === null || written === null) {
      this.rebuild(world);
      return;
    }
    for (const e of joined) this.restamp(world, e);
    for (const e of written) if (this.placed.has(e)) this.restamp(world, e);
    this.membershipGeneration = membership;
    this.valueGeneration = values;
  }

  rebuild(world: World): void {
    world.journalMembership(Building);
    world.journalValueWrites(Building);
    for (const held of this.placed.values()) if (held.walk !== null) this.stamp(held.walk, -1);
    this.placed.clear();
    for (const e of world.query(Building, Position)) this.restamp(world, e);
    this.membershipGeneration = world.componentGeneration(Building);
    this.valueGeneration = world.componentValueGeneration(Building);
    this.revision++;
  }

  /** Move `e`'s stamp to the body its live building carves, keeping a body whose footprint and anchor
   *  stand. */
  private restamp(world: World, e: Entity): void {
    const held = this.placed.get(e);
    const b = world.tryGet(e, Building);
    const p = b === undefined ? undefined : world.tryGet(e, Position);
    if (b === undefined || p === undefined) {
      if (held !== undefined && held.walk !== null) this.stamp(held.walk, -1);
      this.placed.delete(e);
      return;
    }
    const footprint = buildingFootprintOf(this.content, b.buildingType, b.tribe);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    if (held !== undefined && held.footprint === footprint && held.hx === hx && held.hy === hy) {
      if (held.type !== b.buildingType) this.placed.set(e, { ...held, type: b.buildingType });
      return;
    }
    if (held !== undefined && held.walk !== null) this.stamp(held.walk, -1);
    const carves = footprint !== undefined && footprint.blocked.length > 0;
    const walk = carves ? walkBodyOf(this.terrain, footprint, hx, hy) : null;
    if (walk !== null) this.stamp(walk, 1);
    this.placed.set(e, { type: b.buildingType, footprint, hx, hy, walk });
  }

  private stamp(walk: WalkBody, delta: 1 | -1): void {
    for (const cell of walk.body) {
      this.bodyCounts[cell] = (this.bodyCounts[cell] ?? 0) + delta;
      this.settleBlocked(cell);
    }
    if (walk.door !== null) {
      this.doorCounts[walk.door] = (this.doorCounts[walk.door] ?? 0) + delta;
      this.settleBlocked(walk.door);
    }
    for (const cell of walk.passage) {
      const count = (this.passageCounts[cell] ?? 0) + delta;
      this.passageCounts[cell] = count;
      if (count > 0 === this.openings.has(cell)) continue;
      if (count > 0) this.openings.add(cell);
      else this.openings.delete(cell);
      this.revision++;
    }
  }

  private settleBlocked(cell: NodeId): void {
    const blocked = (this.bodyCounts[cell] ?? 0) > 0 && (this.doorCounts[cell] ?? 0) === 0;
    if (blocked === this.blocked.has(cell)) return;
    if (blocked) this.blocked.add(cell);
    else this.blocked.delete(cell);
    this.revision++;
  }
}

const NO_ENTITIES: readonly Entity[] = [];

const buildingCellsIndexes = new WeakMap<World, BuildingCellsIndex>();

/** `world`'s building cells index, caught up. */
function buildingCells(world: World, content: ContentSet, terrain: TerrainGraph): BuildingCellsIndex {
  let index = buildingCellsIndexes.get(world);
  if (index === undefined || index.content !== content || index.terrain !== terrain) {
    index = new BuildingCellsIndex(content, terrain);
    index.rebuild(world);
    buildingCellsIndexes.set(world, index);
    world.registerCacheVerifier('buildingCells', () => verifyBuildingCells(world));
    return index;
  }
  index.catchUp(world);
  return index;
}

/** The index against a fresh carve of every building, while it reads as current. */
function verifyBuildingCells(world: World): string[] {
  const index = buildingCellsIndexes.get(world);
  if (index === undefined || !index.current(world)) return [];
  const fresh = deriveBuildingCells(world, index.content, index.terrain);
  if (sameCells(index.blocked, fresh.blocked) && sameCells(index.openings, fresh.openings)) return [];
  return ['buildingCells diverge from a fresh carve - a building change went unseen'];
}

/** Every building's door node and the passage cleared from it to exterior ground, which a wall joint
 *  seal leaves open. The live index's set: read it, never keep it past a building change. Derived state,
 *  never hashed. */
export function buildingOpenings(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return buildingCells(world, content, terrain).openings;
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
  const index = buildingCellsIndexes.get(world);
  if (
    index === undefined ||
    !index.current(world) ||
    cached.buildingRevision !== index.revision ||
    !palisadesUnchanged(world, cached)
  ) {
    return []; // stale key - the next read rebuilds, nothing can consume the old cells
  }
  const fresh = withWalls(world, terrain, deriveBuildingCells(world, content, terrain));
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
  const buildings = buildingCells(world, ctx.content, terrain);
  const cached = buildingBlockedCache.get(world);
  if (
    cached !== undefined &&
    cached.terrain === terrain &&
    cached.content === ctx.content &&
    cached.buildingRevision === buildings.revision &&
    palisadesUnchanged(world, cached)
  ) {
    return cached;
  }

  const cells = withWalls(world, terrain, buildings);
  let counts: Uint16Array;
  if (cached?.terrain === terrain) {
    counts = cached.counts;
    for (const cell of cached.cells) counts[cell] = 0;
  } else {
    counts = new Uint16Array(terrain.nodeCount);
  }
  for (const cell of cells) counts[cell] = 1;
  const cache: BuildingBlockedCache = {
    buildingRevision: buildings.revision,
    palisadeMembershipGeneration: world.componentGeneration(Palisade),
    palisadeBlockingGeneration: world.componentGeneration(PalisadeBlocking),
    content: ctx.content,
    terrain,
    cells,
    counts,
  };
  buildingBlockedCache.set(world, cache);
  world.registerCacheVerifier('buildingBlockedCells', () =>
    verifyBuildingBlockedCache(world, ctx.content, terrain),
  );
  return cache;
}
