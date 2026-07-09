import type { BuildingFootprint, ContentSet } from '@vinland/data';
import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import {
  ANCHOR_ONLY,
  buildingFootprintOf,
  nearestCell,
  nearestFreeNeighbour,
  tileKey,
  translatedCells,
} from './geometry.js';
import { resourceBlockedCells } from './resources.js';

// INTERACTION + PLACEMENT — where a unit stands to use a building/resource (door nodes, work
// nodes), the walk-block overlays routing consumes, and the can-this-building-go-here check.

/**
 * The integer HALF-CELL NODE a settler must stand on to INTERACT with a building — its door node
 * (`anchor + footprint.door`, both half-cell offsets) when the type has one, else the anchor node
 * itself (the pre-footprint same-node model, which synthetic content keeps). This is the single
 * seam every "walk to the building / are we at the building" consumer resolves through (the AI
 * walk targets + arrival checks, the JobSystem adopt bucket, the production worker-presence gate),
 * so the walk goal and the presence test can never disagree about where "at the building" is —
 * with the walls now blocking, the anchor node itself is typically unreachable, and the door is
 * where the original's settlers enter. A door node OFF the map (impossible for a gate-placed
 * footprinted building — the placement rule forces the whole reserved zone, door included,
 * in-bounds — but reachable through hand-authored content) falls back to the anchor node, so every
 * consumer stays consistent instead of a clamped walk goal disagreeing with the raw-node presence
 * checks. Returns null for an entity without a Building or Position.
 */
export function interactionTile(
  world: World,
  ctx: SystemContext,
  building: Entity,
): { x: number; y: number } | null {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return null;
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const door = buildingFootprintOf(ctx.content, b.buildingType)?.door;
  if (door === undefined) return { x: ax, y: ay };
  const at = { x: ax + door.dx, y: ay + door.dy };
  if (ctx.terrain !== undefined && !ctx.terrain.inBounds(at.x, at.y)) return { x: ax, y: ay };
  return at;
}

function resourceAtTile(world: World, x: number, y: number, goodType: number): Entity | null {
  // A PICK, so the winner must be canonical: keep the LOWEST id among matches rather than the first
  // in query order (store insertion order is history-dependent — two same-good resources sharing a
  // node would otherwise resolve differently after a snapshot rebuild).
  let best: Entity | null = null;
  for (const resource of world.query(Resource, Position)) {
    if (best !== null && resource >= best) continue;
    const pos = world.get(resource, Position);
    const n = nodeOfPosition(pos.x, pos.y);
    if (n.hx !== x || n.hy !== y) continue;
    if (world.get(resource, Resource).goodType !== goodType) continue;
    best = resource;
  }
  return best;
}

function stockedGoodAt(world: World, entity: Entity): number | null {
  const stock = world.tryGet(entity, Stockpile);
  if (stock === undefined) return null;
  for (const [goodType, amount] of stockpileEntries(stock)) {
    if (amount > 0) return goodType;
  }
  return null;
}

/**
 * The cell a collector should stand on to work a resource. Prefer the data's non-anchor work cells,
 * since those give the adjacent stance for blocking nodes; a resource whose only legal work cell is
 * its anchor (for example a one-tile mushroom fixture) remains workable.
 */
export function resourceWorkCell(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
  from?: CellId,
): CellId {
  const p = world.get(resource, Position);
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.cellAtClamped(ax, ay);
  const footprint = world.tryGet(resource, ResourceFootprint);
  if (footprint === undefined) return anchor;

  const blocked = resourceBlockedCells(world, terrain);
  const work = translatedCells(terrain, footprint.work, ax, ay).filter(
    (cell) => terrain.isWalkable(cell) && !blocked.has(cell),
  );
  const adjacent = work.filter((cell) => cell !== anchor);
  const picked = nearestCell(terrain, adjacent.length > 0 ? adjacent : work, from);
  if (picked !== null) return picked;
  return nearestFreeNeighbour(terrain, anchor, blocked, from) ?? anchor;
}

/**
 * The interaction cell for a plain positioned target. If a loose ground drop lies under a still-standing
 * resource, collect it from that resource's work cell. That makes mined goods follow the intended cadence:
 * one chip drops one ore/clay at the deposit, then the collector picks it up before starting another chip.
 * Blocking deposits get the adjacent stance because their anchor is unwalkable; low non-blocking deposits
 * (clay) still use the same work-cell rule so they do not get mined dry before the first pickup.
 */
export function positionedInteractionCell(
  world: World,
  terrain: TerrainGraph,
  entity: Entity,
  from?: CellId,
): CellId {
  const p = world.get(entity, Position);
  const { hx: x, hy: y } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.cellAtClamped(x, y);
  const drop = world.tryGet(entity, GroundDrop);
  if (drop !== undefined) {
    const resource = resourceAtTile(world, x, y, stockedGoodAt(world, entity) ?? drop.goodType);
    if (resource !== null) return resourceWorkCell(world, terrain, resource, from);
  }
  const blocked = resourceBlockedCells(world, terrain);
  if (!blocked.has(anchor)) return anchor;
  return nearestFreeNeighbour(terrain, anchor, blocked, from) ?? anchor;
}

/**
 * The cells standing buildings make UNWALKABLE right now — the union of every placed building's
 * `footprint.blocked` cells (its CURRENT level's walls; the level chain swaps `buildingType`, so an
 * upgraded home's larger body is picked up on the next rebuild). The walk-block applies from the
 * placement tick: a grey foundation already occupies its cells, exactly like the original.
 *
 * A building's own DOOR cell is always left walkable, even when the source lists it inside the
 * walk-block — the real data does exactly that for the defence-wall gate (`work_pottery_02`'s
 * `LogicDoorPoint` sits inside its `LogicWalkBlockArea`: a wall's door IS its passable gate). Without
 * this carve-out the walk-to-door goal would be a blocked cell → `findPath` fails → the request is
 * never re-issued → the settler wedges permanently. The extractor keeps the source cells verbatim
 * (provenance); the consumer applies the gate semantics.
 *
 * DERIVED state, rebuilt per tick by its consumer (the PathfindingSystem) — never hashed, never
 * stored, so it cannot drift from the Building components it is computed from (the same stance as
 * `TileBuckets`). Determinism: a set UNION over `world.query` — order-independent (membership only,
 * no pick; the door carve-out is per-building, keyed to its own cells), so store-order iteration is
 * fine.
 */
export function buildingBlockedCells(world: World, ctx: SystemContext, terrain: TerrainGraph): Set<CellId> {
  const blocked = new Set<CellId>();
  // Door cells collected separately and removed at the end: two buildings can overlap only via the
  // door-in-reserved margin, and a door must stay passable regardless of which building contributed
  // the wall cell (union first, subtract after — order-independent either way).
  const doors = new Set<CellId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(ctx.content, b.buildingType);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
    for (const cell of translatedCells(terrain, footprint.blocked, ax, ay)) {
      blocked.add(cell);
    }
    const door = footprint.door;
    if (door !== undefined && terrain.inBounds(ax + door.dx, ay + door.dy)) {
      doors.add(terrain.cellAt(ax + door.dx, ay + door.dy));
    }
  }
  for (const cell of doors) blocked.delete(cell);
  return blocked;
}

/** Building walk-blocks plus the cached resource walk-block overlay. */
export function dynamicBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<CellId> {
  const blocked = buildingBlockedCells(world, ctx, terrain);
  for (const cell of resourceBlockedCells(world, terrain)) blocked.add(cell);
  return blocked;
}

/**
 * The two ways a standing resource/building blocks a new placement — merged across entity KIND because
 * {@link canPlaceAnchor} treats resource and building the same within each:
 *  - OBSTACLE cells (resource WALK bodies + existing building FAMILY bodies) reject a candidate's
 *    RESERVED zone — the "minimum distance from a node/wall";
 *  - EXCLUSION cells (resource BUILD zones + existing building RESERVED zones) reject its FAMILY BODY.
 */
const OBSTACLE = 0;
const EXCLUSION = 1;
type BlockerChannel = typeof OBSTACLE | typeof EXCLUSION;

/**
 * Enumerate every (cell, channel) the world's standing resources and buildings contribute — the SINGLE
 * definition of "what blocks placement where". Both the command gate's string sets
 * ({@link collectPlacementBlockers}) and the overlay's dense masks ({@link memoizedPlacementGrid}) are
 * stamped from THIS one pass, so the two representations can never disagree about which cells block.
 * A footprint-less resource/building contributes its 1-cell anchor (the pre-footprint same-tile rule).
 * Determinism: a pure enumeration over `world.query`; both consumers only take set UNIONS / mask writes
 * (membership, no pick), so store-iteration order cannot change any later answer.
 */
function eachBlockerCell(
  world: World,
  content: ContentSet,
  visit: (x: number, y: number, channel: BlockerChannel) => void,
): void {
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const fp = world.tryGet(e, ResourceFootprint);
    if (fp === undefined) {
      visit(hx, hy, OBSTACLE); // legacy anchor-only resource keeps the old same-tile rule
      continue;
    }
    for (const c of fp.walk) visit(hx + c.dx, hy + c.dy, OBSTACLE);
    for (const c of fp.build) visit(hx + c.dx, hy + c.dy, EXCLUSION);
  }
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const fp = buildingFootprintOf(content, b.buildingType);
    const body = fp?.familyBody.length ? fp.familyBody : ANCHOR_ONLY;
    const zone = fp?.reserved.length ? fp.reserved : ANCHOR_ONLY;
    for (const c of body) visit(hx + c.dx, hy + c.dy, OBSTACLE);
    for (const c of zone) visit(hx + c.dx, hy + c.dy, EXCLUSION);
  }
}

/**
 * The command-gate obstacle sets — one throwaway per {@link canPlaceBuilding} check (which probes a
 * SINGLE anchor). Injective string {@link tileKey}s, NOT a numeric `y*width+x` packing (which would
 * alias an off-map cell onto a real tile a row over — a footprint-less building at a negative
 * coordinate would then falsely reject a distant placement). The overlay probes thousands of anchors
 * per frame, so it uses the dense-mask twin ({@link PlacementGrid}) instead.
 */
interface PlacementBlockers {
  readonly terrain: TerrainGraph;
  readonly obstacles: Set<string>;
  readonly exclusions: Set<string>;
}

function collectPlacementBlockers(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): PlacementBlockers {
  const obstacles = new Set<string>();
  const exclusions = new Set<string>();
  eachBlockerCell(world, content, (x, y, channel) => {
    (channel === OBSTACLE ? obstacles : exclusions).add(tileKey(x, y));
  });
  return { terrain, obstacles, exclusions };
}

/**
 * Whether `footprint` may be placed with its anchor at integer tile `(x,y)` against the precomputed
 * {@link PlacementBlockers} — the original's FREE placement rule: no grid fields, just collision +
 * a minimum distance from blocking terrain and other houses, both encoded by the extracted footprint.
 * Valid iff:
 *
 *  1. every cell of the `reserved` zone (the build-exclusion area — the max-level body plus the
 *     source's margin ring) is on the map and on BUILDABLE terrain (the landscape row's `buildable`
 *     flag: water/rock/void may not touch the zone; a real map's tree/rock margin band is walkable
 *     ground that still rejects here), clear of resource walk-block bodies, and clear of every
 *     existing building's walls;
 *  2. the new building's `familyBody` (the largest body its level chain reaches — placing level 0
 *     reserves the top level's space) stays out of every resource build-zone and every existing
 *     building's reserved zone. The body-vs-zone test is symmetric, so each house keeps every other
 *     house's walls at least its own margin away — but two margins may overlap, so houses still pack
 *     closely (the original's "very free" placement).
 *
 * source-basis (approximated, source basis "Building placement"): the footprint cells and the
 * body/zone split are the extracted `LogicWalkBlockArea`/`LogicBuildBlockArea` data (faithful); the
 * exact overlap RULE (body-vs-zone symmetric, zones may overlap) is our reading of those two areas —
 * the engine's check has no oracle. Determinism: pure boolean over the blocker sets; any overlap
 * rejects, so evaluation order cannot change the answer.
 */
function canPlaceAnchor(
  blockers: PlacementBlockers,
  footprint: BuildingFootprint,
  x: number,
  y: number,
): boolean {
  const { terrain } = blockers;
  // 1. The reserved zone must lie on the map, on buildable ground, and clear of node/wall OBSTACLES.
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.cellAt(cx, cy))) return false; // blocking terrain too close
    if (blockers.obstacles.has(tileKey(cx, cy))) return false; // a resource body or a building's walls
  }
  // 2. My family body must stay clear of resource + building EXCLUSION zones (the symmetric margin).
  for (const c of footprint.familyBody) {
    if (blockers.exclusions.has(tileKey(x + c.dx, y + c.dy))) return false;
  }
  return true;
}

/**
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)`. A
 * `buildingType` without a footprint validates trivially (no collision model — the pre-footprint
 * behavior synthetic content keeps). Settlers never block placement (the foundation appears under
 * them and they walk off — the walls only enter the nav overlay, {@link buildingBlockedCells}).
 * The rule and its source basis live on {@link canPlaceAnchor}; this builds a one-shot
 * {@link PlacementBlockers} for the single command-time check.
 */
export function canPlaceBuilding(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildingType: number,
  x: number,
  y: number,
): boolean {
  const footprint = buildingFootprintOf(ctx.content, buildingType);
  if (footprint === undefined) return true; // no collision model — places freely (synthetic content)
  return canPlaceAnchor(collectPlacementBlockers(world, ctx.content, terrain), footprint, x, y);
}

/** A ready-to-query buildability test for ONE building type: the type's footprint resolved against a
 *  precomputed snapshot of the world's obstacle sets. Built once (see {@link placementProbe}) and then
 *  asked `canPlace(x,y)` per tile — the placement-overlay's screen-bounded seam. */
export interface PlacementProbe {
  /** Whether a building of the probed type may be placed with its anchor at integer tile `(x, y)`. */
  canPlace(x: number, y: number): boolean;
}

/**
 * Stride the Building store generation is shifted by before the Resource generation is folded in, so
 * one number carries both (`≈67M` head-room per axis, exact in a double until either axis passes it).
 * A fold collision would only make the read-path memo below reuse a stale wash for one frame — never
 * a placement decision (the command gate always re-scans) — so an astronomically rare overflow is
 * cosmetic and self-correcting, the same tolerance {@link signatureOf}'s render-side hash accepts.
 */
const BLOCKER_VERSION_STRIDE = 2 ** 26;

/**
 * A per-world version of the placement-blocker INPUTS: it changes only when a Building or Resource is
 * added or removed. Buildings and resources never move once placed, and `familyBody`/`reserved` are
 * the union across a type's whole level chain (schema.ts) — so a level-up (an in-place `buildingType`
 * swap) leaves the set unchanged. That makes the two component generations an EXACT signal for the
 * obstacle sets: the overlay and {@link memoizedPlacementGrid} both reuse their last result until this
 * value moves, instead of re-deriving every tick. Read-only + deterministic (component generations
 * are a pure function of the mutation history); never hashed, never a sim decision.
 */
export function placementBlockerVersion(world: World): number {
  return world.componentGeneration(Building) * BLOCKER_VERSION_STRIDE + world.componentGeneration(Resource);
}

/**
 * The overlay's DENSE obstacle representation: one byte per half-cell node (`terrain.width×height`,
 * row-major `y*width+x` — the same index `TerrainGraph.cellAt` mints), `1` iff that node is an
 * OBSTACLE / EXCLUSION cell. Stamped from the same {@link eachBlockerCell} pass the command gate keys
 * as strings, but read back as an O(1) typed-array index in the hot loop instead of a `tileKey`
 * string allocation + `Set<string>` probe. THAT is the fix for the build-wash freeze: re-probing a
 * whole visible band for a barracks-scale footprint drops from ~90 ms to ~10 ms (measured), so opening
 * the wash and panning while placing no longer stutter. Off-map blocker cells are simply not stamped —
 * a candidate whose reserved cell is off-map is rejected by the bounds check first, so they can never
 * be queried. Terrain buildability stays a live `isBuildable()` call (static, already a grid). */
interface PlacementGrid {
  readonly terrain: TerrainGraph;
  readonly obstacle: Uint8Array;
  readonly exclusion: Uint8Array;
}

/** The dense twin of {@link canPlaceAnchor} — same rule, read from the mask grid. Kept in lockstep
 *  with the sparse version by the `placementProbe matches canPlaceBuilding at every anchor` test. */
function canPlaceOnGrid(grid: PlacementGrid, footprint: BuildingFootprint, x: number, y: number): boolean {
  const { terrain, obstacle, exclusion } = grid;
  const w = terrain.width;
  const h = terrain.height;
  // 1. Reserved zone: on the map, on buildable ground, clear of OBSTACLE nodes.
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.cellAt(cx, cy))) return false; // blocking terrain too close
    if (obstacle[cy * w + cx] === 1) return false; // a resource body or a building's walls
  }
  // 2. Family body: clear of EXCLUSION zones. familyBody ⊆ reserved, so every cell here is already
  //    proven in-bounds by loop 1 — the guard only shields a hand-authored footprint that breaks that.
  for (const c of footprint.familyBody) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (cx >= 0 && cy >= 0 && cx < w && cy < h && exclusion[cy * w + cx] === 1) return false;
  }
  return true;
}

/**
 * Per-world memo of the overlay's dense placement grid, keyed by the {@link placementBlockerVersion} it
 * was stamped at. The overlay probes it every RAF frame (frames outrun ticks; a paused/hovering build
 * never ticks) — without the memo each frame would re-scan every Resource + Building on the map (an
 * O(entities) whole-map pass per frame — the perf/architecture review's finding). Keying on the blocker
 * version (not the tick) means a running sim whose buildings/resources are unchanged reuses the grid
 * across ticks too, and a DIRECT `world.add`/`remove` (the fixture idiom) invalidates it the moment it
 * bumps a generation. The mask arrays are REUSED across rebuilds (same world+terrain) — a resource
 * depleting mid-placement clears + re-stamps rather than churning a map-sized allocation. A pure
 * read-path cache: it feeds only the app overlay, never a sim decision, so it is not hashed and needs
 * no `verifyCaches` registration. Built lazily on the first probe, so it costs nothing outside build mode.
 */
interface GridMemo {
  version: number;
  content: ContentSet;
  terrain: TerrainGraph;
  grid: PlacementGrid;
}
const gridMemo = new WeakMap<World, GridMemo>();

function memoizedPlacementGrid(world: World, content: ContentSet, terrain: TerrainGraph): PlacementGrid {
  const version = placementBlockerVersion(world);
  const cached = gridMemo.get(world);
  if (
    cached !== undefined &&
    cached.version === version &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.grid;
  }
  const size = terrain.width * terrain.height;
  let grid: PlacementGrid;
  if (cached?.grid.terrain === terrain && cached.grid.obstacle.length === size) {
    // Reuse last grid's arrays (terrain never changes per world), so a rebuild is a clear + re-stamp,
    // not a fresh map-sized allocation churned every time a resource depletes mid-placement.
    cached.grid.obstacle.fill(0);
    cached.grid.exclusion.fill(0);
    grid = cached.grid;
  } else {
    grid = { terrain, obstacle: new Uint8Array(size), exclusion: new Uint8Array(size) };
  }
  const w = terrain.width;
  const h = terrain.height;
  eachBlockerCell(world, content, (x, y, channel) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return; // off-map cells are never queried (see canPlaceOnGrid)
    (channel === OBSTACLE ? grid.obstacle : grid.exclusion)[y * w + x] = 1;
  });
  gridMemo.set(world, { version, content, terrain, grid });
  return grid;
}

/**
 * Build a {@link PlacementProbe} for `buildingType` — resolve its footprint and snapshot the world's
 * obstacle cells into a dense mask grid, so the app's build-mode overlay can probe every visible tile
 * against the exact same rule the `placeBuilding` command gates on ({@link canPlaceBuilding}), reading
 * O(1) typed-array masks instead of re-scanning the world per cell. The grid is memoized per
 * {@link placementBlockerVersion}, so it is re-stamped only when a building/resource actually appears
 * or disappears — not every tick, and not every frame while the world is unchanged. A footprint-less
 * type always reports placeable (its command-time behavior).
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
): PlacementProbe {
  const footprint = buildingFootprintOf(content, buildingType);
  if (footprint === undefined) return { canPlace: () => true };
  const grid = memoizedPlacementGrid(world, content, terrain);
  return { canPlace: (x, y) => canPlaceOnGrid(grid, footprint, x, y) };
}
