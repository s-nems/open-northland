import type { BuildingFootprint, ContentSet } from '@open-northland/data';
import { Building, Palisade, PalisadeBlocking, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CountedCells } from '../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { countsMatchCells, doorNodeOf, houseFootprintOf, sameCells, translatedCells } from './geometry.js';
import { standingWallCells } from './standing-walls.js';

// The memoized per-world cache of cells standing buildings make unwalkable, plus its coherence verifier -
// the building twin of ./resource-blocked-cache.ts.

/**
 * The building bodies with the walls, kept per world and terrain: a building change
 * re-settles the nodes the {@link BuildingCellsIndex} flipped, and a wall or door change those its wall
 * cells gained or lost, so the cells are edited in place rather than copied per change.
 */
interface BuildingBlockedCache extends CountedCells {
  /** The {@link BuildingCellsIndex} revision the cells were settled at. */
  buildingRevision: number;
  /** Palisade and PalisadeBlocking membership generations: a wall or a shut gate blocks its walk cells.
   *  Its cells and gate state change only by a re-add; the in-place writes are a claim and build progress. */
  palisadeMembershipGeneration: number;
  palisadeBlockingGeneration: number;
  readonly content: ContentSet;
  readonly terrain: TerrainGraph;
  readonly cells: Set<NodeId>;
  /** 1 on {@link cells}, else 0. */
  readonly counts: Uint16Array;
  /** What {@link buildingBlockedCells} hands out: a view minted per settle, whose identity keys the
   *  caches over it as a fresh set did. */
  view: ReadonlySet<NodeId>;
  /** The standing walls' cells, as of the palisade generations. */
  walls: ReadonlySet<NodeId>;
  /** The nodes that entered or left {@link cells} since {@link takeBuildingBlockFlips} last drained them,
   *  for its one reader; a node may repeat. Past {@link FLIP_LOG_CAP} entries the log is dropped and
   *  marked lost, so a cache nobody drains stays bounded. */
  readonly flips: NodeId[];
  flipsLost: boolean;
}

const FLIP_LOG_CAP = 8192;

function logFlip(log: NodeId[], node: NodeId): boolean {
  if (log.length >= FLIP_LOG_CAP) return false;
  log.push(node);
  return true;
}

const buildingBlockedCache = new WeakMap<World, BuildingBlockedCache>();

/** Open the shortest passage through a building's own walk block to exterior ground, over the lattice
 * edges. A door one of its six edges already leaves carves nothing: every extracted door opens onto
 * such an edge, as the original's doors do. The carve sees only the building's own body, so a body stays
 * a pure function of its footprint and anchor, and another building's body, a resource or a wall on the
 * landing of a door's only edge seals that door. Approximation: the original carves nothing, and what it
 * does with a door sealed that way is unconfirmed. The carve remains for a door no edge leaves, a shape
 * the extracted footprints do not have. A carved cell is ground to walk, never to stand on (`doorways`).
 * The door, usually outside `body`, is the start and never the exit, or the wall cell behind it would
 * open onto it. Open ground the walls enclose is no exit. */
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
      if (next === door || !terrain.isWalkable(next) || !terrain.joined(cell, next)) continue;
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
  /** Every door node and the carved passage cells behind it. */
  readonly doorways: ReadonlySet<NodeId>;
}

/** Every building carved afresh: the verifiers' reference for {@link BuildingCellsIndex}. */
function deriveBuildingCells(world: World, content: ContentSet, terrain: TerrainGraph): BuildingCells {
  const blocked = new Set<NodeId>();
  // The exact door point stays open even if another building's reserved margin overlaps it.
  const doors = new Set<NodeId>();
  const doorways = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const footprint = houseFootprintOf(content, b);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const walk = walkBodyOf(terrain, footprint, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.x, p.y));
    if (walk.door !== null) doors.add(walk.door);
    for (const cell of walk.body) blocked.add(cell);
    for (const cell of walk.passage) doorways.add(cell);
  }
  for (const cell of doors) blocked.delete(cell);
  return { blocked, doorways };
}

/** Walls go in after the door subtraction, so an authored overlap cannot punch a door-shaped hole through
 *  a palisade. The verifier's fresh derivation of {@link BuildingBlockedCache.cells}. */
function withWalls(world: World, terrain: TerrainGraph, buildings: BuildingCells): Set<NodeId> {
  const blocked = new Set(buildings.blocked);
  const walls = standingWallCells(world, terrain);
  for (const cell of walls.walls) blocked.add(cell);
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
 * doors sit on it, so a building placed, razed or retyped re-stamps only its
 * own body. Building membership and value journals name the changed buildings; positions are immutable once
 * placed. A journal gap re-stamps every building. Construction progress and wall changes keep it.
 */
class BuildingCellsIndex implements BuildingCells {
  /** Nodes some body covers and no door sits on. */
  readonly blocked = new Set<NodeId>();
  /** Every door node and the carved passage cells behind it: walkable, but no stand. */
  readonly doorways = new Set<NodeId>();
  /** Moves whenever {@link blocked} changes, and on every full re-stamp. */
  revision = 0;
  /** The nodes that entered or left {@link blocked} since {@link takeBlockedFlips} last drained them, for
   *  its one reader, the blocked layer; a node may repeat. */
  private readonly blockedFlips: NodeId[] = [];
  private blockedFlipsLost = true;
  private membershipGeneration = 0;
  private valueGeneration = 0;
  private readonly bodyCounts: Uint16Array;
  private readonly doorCounts: Uint16Array;
  private readonly doorwayCounts: Uint16Array;
  private readonly placed = new Map<Entity, PlacedBody>();

  constructor(
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    this.bodyCounts = new Uint16Array(terrain.nodeCount);
    this.doorCounts = new Uint16Array(terrain.nodeCount);
    this.doorwayCounts = new Uint16Array(terrain.nodeCount);
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

  /** The walk body held for building `e`, carved at its current footprint and anchor: null when its
   *  footprint blocks nothing, undefined when it is no placed building. */
  walkOf(e: Entity): WalkBody | null | undefined {
    return this.placed.get(e)?.walk;
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
    this.blockedFlips.length = 0;
    this.blockedFlipsLost = true;
  }

  /** Move the nodes {@link blocked} gained or lost since the previous call into `into`, returning false
   *  when a full re-stamp or an overflowing log came in between, so the reader must re-read the set. */
  takeBlockedFlips(into: NodeId[]): boolean {
    const kept = !this.blockedFlipsLost;
    if (kept) for (let i = 0; i < this.blockedFlips.length; i++) into.push(this.blockedFlips[i] as NodeId);
    this.blockedFlips.length = 0;
    this.blockedFlipsLost = false;
    return kept;
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
    const footprint = houseFootprintOf(this.content, b);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.x, p.y);
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
    // The passage starts at the door, so one loop stamps both.
    for (const cell of walk.passage) {
      const count = (this.doorwayCounts[cell] ?? 0) + delta;
      this.doorwayCounts[cell] = count;
      if (count > 0) this.doorways.add(cell);
      else this.doorways.delete(cell);
    }
  }

  private settleBlocked(cell: NodeId): void {
    const blocked = (this.bodyCounts[cell] ?? 0) > 0 && (this.doorCounts[cell] ?? 0) === 0;
    if (blocked === this.blocked.has(cell)) return;
    if (blocked) this.blocked.add(cell);
    else this.blocked.delete(cell);
    this.revision++;
    if (!this.blockedFlipsLost && !logFlip(this.blockedFlips, cell)) {
      this.blockedFlips.length = 0;
      this.blockedFlipsLost = true;
    }
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
  if (sameCells(index.blocked, fresh.blocked) && sameCells(index.doorways, fresh.doorways)) return [];
  return ['buildingCells diverge from a fresh carve - a building change went unseen'];
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
    return []; // stale key - the next read settles, nothing can consume the old cells
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
 * Standing walls and shut gates add their walk cells; the navigation edge rule closes slanted joints.
 *
 * Derived state, never hashed. Memoized per world on the Building store's membership generation, the
 * buildings' types and the wall membership generations, so building progress, a wall claim and a wall's
 * build keep it. Each change hands out a new view over the live cells, so its identity keys dependent
 * caches; read it, never keep it past a building or wall change. A set union and a door subtraction,
 * neither with a pick, so store-iteration order cannot change it.
 */
export function buildingBlockedCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return blockedCache(world, ctx, terrain).view;
}

/** The nodes a building's body covers, its doors and walls left out. The shared cached set:
 *  membership reads only. */
export function buildingBodyCells(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return buildingCells(world, ctx.content, terrain).blocked;
}

/** Every standing building's door node and the passage carved from it through its own walls: walkable
 *  ground, but a stand on it sits in the doorway or under the house's art, so the spacing drives and
 *  eviction never land there. The shared cached set: membership reads only. */
export function buildingDoorwayNodes(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  return buildingCells(world, ctx.content, terrain).doorways;
}

/** {@link walkBodyOf} of building `e` at its current footprint and anchor as the building index holds
 *  it, shared and read-only; null when its footprint blocks nothing or it is no placed building. */
export function placedWalkBody(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  e: Entity,
): WalkBody | null {
  return buildingCells(world, content, terrain).walkOf(e) ?? null;
}

/** {@link buildingBlockedCells} with its per-node counts, for the dynamic overlay. */
export function buildingBlockedLayer(world: World, ctx: ContentContext, terrain: TerrainGraph): CountedCells {
  return blockedCache(world, ctx, terrain);
}

/** `world`'s blocked layer on `terrain`, settled now. */
function blockedCache(world: World, ctx: ContentContext, terrain: TerrainGraph): BuildingBlockedCache {
  const buildings = buildingCells(world, ctx.content, terrain);
  const cache = buildingBlockedCache.get(world);
  if (cache === undefined || cache.terrain !== terrain || cache.content !== ctx.content) {
    const cells = new Set<NodeId>();
    const created: BuildingBlockedCache = {
      buildingRevision: -1,
      palisadeMembershipGeneration: -1,
      palisadeBlockingGeneration: -1,
      content: ctx.content,
      terrain,
      cells,
      counts: new Uint16Array(terrain.nodeCount),
      view: new CellsView(cells),
      walls: NO_NODES,
      flips: [],
      flipsLost: true,
    };
    buildingBlockedCache.set(world, created);
    world.registerCacheVerifier('buildingBlockedCells', () =>
      verifyBuildingBlockedCache(world, ctx.content, terrain),
    );
    settleLayer(world, terrain, buildings, created, false);
    return created;
  }
  if (cache.buildingRevision === buildings.revision && palisadesUnchanged(world, cache)) return cache;
  settleLayer(world, terrain, buildings, cache, true);
  return cache;
}

const NO_NODES: ReadonlySet<NodeId> = new Set();

/** A read-only window on a live node set. */
class CellsView implements ReadonlySet<NodeId> {
  constructor(private readonly cells: ReadonlySet<NodeId>) {}

  get size(): number {
    return this.cells.size;
  }

  has(node: NodeId): boolean {
    return this.cells.has(node);
  }

  values(): SetIterator<NodeId> {
    return this.cells.values();
  }

  keys(): SetIterator<NodeId> {
    return this.cells.keys();
  }

  entries(): SetIterator<[NodeId, NodeId]> {
    return this.cells.entries();
  }

  [Symbol.iterator](): SetIterator<NodeId> {
    return this.cells.values();
  }

  forEach(visit: (value: NodeId, key: NodeId, set: ReadonlySet<NodeId>) => void): void {
    for (const node of this.cells) visit(node, node, this);
  }
}

/** Scratch: the nodes one settle re-tests. */
const settleNodes: NodeId[] = [];

/** Bring `cache` level with the building index and the walls: the nodes the index flipped and those the
 *  re-derived walls gained or lost, or every node when the index lost its flips or the cache
 *  never `settled` before. */
function settleLayer(
  world: World,
  terrain: TerrainGraph,
  buildings: BuildingCellsIndex,
  cache: BuildingBlockedCache,
  settled: boolean,
): void {
  const nodes = settleNodes;
  nodes.length = 0;
  const tracked = buildings.takeBlockedFlips(nodes) && settled;
  const palisadesMoved = !palisadesUnchanged(world, cache);
  if (palisadesMoved || !tracked) {
    const walls = new Set(standingWallCells(world, terrain).walls);
    listDifference(cache.walls, walls, nodes);
    cache.walls = walls;
  }
  if (tracked) {
    for (let i = 0; i < nodes.length; i++) settleNode(cache, buildings, nodes[i] as NodeId);
  } else {
    for (const node of cache.cells) cache.counts[node] = 0;
    cache.cells.clear();
    for (const node of buildings.blocked) settleNode(cache, buildings, node);
    for (const node of cache.walls) settleNode(cache, buildings, node);
    cache.flips.length = 0;
    cache.flipsLost = true;
  }
  nodes.length = 0;
  cache.view = new CellsView(cache.cells);
  cache.buildingRevision = buildings.revision;
  cache.palisadeMembershipGeneration = world.componentGeneration(Palisade);
  cache.palisadeBlockingGeneration = world.componentGeneration(PalisadeBlocking);
}

/** Append to `into` every node in exactly one of `held` and `fresh`. */
function listDifference(held: ReadonlySet<NodeId>, fresh: ReadonlySet<NodeId>, into: NodeId[]): void {
  for (const node of held) if (!fresh.has(node)) into.push(node);
  for (const node of fresh) if (!held.has(node)) into.push(node);
}

/** Set `node`'s membership to the union of the building bodies and the walls, logging a flip. */
function settleNode(cache: BuildingBlockedCache, buildings: BuildingCellsIndex, node: NodeId): void {
  const blocked = buildings.blocked.has(node) || cache.walls.has(node);
  if (blocked === cache.cells.has(node)) return;
  if (blocked) cache.cells.add(node);
  else cache.cells.delete(node);
  cache.counts[node] = blocked ? 1 : 0;
  if (!cache.flipsLost && !logFlip(cache.flips, node)) {
    cache.flips.length = 0;
    cache.flipsLost = true;
  }
}

/**
 * Move the nodes {@link buildingBlockedLayer}'s cells gained or lost since the previous call into `into`,
 * returning false when the log was dropped in between or no layer exists, so the reader must re-read the
 * whole layer. One reader per world: the walk-block mask's levelling.
 */
export function takeBuildingBlockFlips(world: World, terrain: TerrainGraph, into: NodeId[]): boolean {
  const cache = buildingBlockedCache.get(world);
  if (cache === undefined || cache.terrain !== terrain) return false;
  const kept = !cache.flipsLost;
  if (kept) for (let i = 0; i < cache.flips.length; i++) into.push(cache.flips[i] as NodeId);
  cache.flips.length = 0;
  cache.flipsLost = false;
  return kept;
}
