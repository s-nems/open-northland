import type { BuildingFootprint, ContentSet } from '@vinland/data';
import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
  stockpileEntries,
  UnderConstruction,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import {
  ANCHOR_ONLY,
  buildingFootprintOf,
  nearestCell,
  nearestFreeNeighbour,
  nodeKey,
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
export function interactionNode(
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
 * The cell a collector should stand on to work a resource. A walkable deposit whose work area
 * includes its own anchor node is worked standing ON the deposit — the OBSERVED original clay
 * digger squarely on its pit. Today that anchor-listing comes from the sandbox's invented work
 * areas (`game/sandbox/content.ts`), NOT the real clay records: those list the anchor only in
 * their partial states, and the sim collapses `workAreas` to the FULL state
 * (`fullStateBlockAreaCells`), whose rows exclude `(0,0)` — so if real records ever feed this,
 * the digger silently reverts to an adjacent stance unless that collapse is revisited. A blocking
 * node's anchor never survives the walkable filter, so trees/stones/ore keep the adjacent stance;
 * a resource whose only legal work cell is its anchor (a one-tile mushroom fixture) remains
 * workable through the same anchor-first rule.
 */
export function resourceWorkCell(
  world: World,
  terrain: TerrainGraph,
  resource: Entity,
  from?: NodeId,
): NodeId {
  const p = world.get(resource, Position);
  const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.nodeAtClamped(ax, ay);
  const footprint = world.tryGet(resource, ResourceFootprint);
  if (footprint === undefined) return anchor;

  const blocked = resourceBlockedCells(world, terrain);
  const work = translatedCells(terrain, footprint.work, ax, ay).filter(
    (cell) => terrain.isWalkable(cell) && !blocked.has(cell),
  );
  if (work.includes(anchor)) return anchor; // stand ON a walkable deposit that lists its own anchor
  const picked = nearestCell(terrain, work, from);
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
  from?: NodeId,
): NodeId {
  const p = world.get(entity, Position);
  const { hx: x, hy: y } = nodeOfPosition(p.x, p.y);
  const anchor = terrain.nodeAtClamped(x, y);
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
 * `NodeBuckets`). Determinism: a set UNION over `world.query` — order-independent (membership only,
 * no pick; the door carve-out is per-building, keyed to its own cells), so store-order iteration is
 * fine.
 */
export function buildingBlockedCells(world: World, ctx: SystemContext, terrain: TerrainGraph): Set<NodeId> {
  const blocked = new Set<NodeId>();
  // Door cells collected separately and removed at the end: two buildings can overlap only via the
  // door-in-reserved margin, and a door must stay passable regardless of which building contributed
  // the wall cell (union first, subtract after — order-independent either way).
  const doors = new Set<NodeId>();
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
      doors.add(terrain.nodeAt(ax + door.dx, ay + door.dy));
    }
  }
  for (const cell of doors) blocked.delete(cell);
  return blocked;
}

/** One under-construction building's ground plot — the half-cell body cells it occupies, for the render's
 *  grey "construction site" decal. Cells are `(col,row)` on the `2W×2H` half-cell lattice (anchor +
 *  footprint offset), the same coords `halfCellToScreen` projects. */
export interface ConstructionPlot {
  readonly cells: readonly { readonly col: number; readonly row: number }[];
}

/**
 * The ground plots of every UNDER-CONSTRUCTION building — its footprint body cells (`blocked`, this size
 * level's walk-block body) translated to world half-cell nodes, so the render can wash a grey "plac budowy"
 * over exactly the cells the finished building will stand on. A footprint-less type (synthetic content, the
 * one graphics-less real type) falls back to its single anchor cell so a site always marks its ground.
 *
 * Read-only render support like {@link import('../../simulation.js').Simulation.placementProbe} — never
 * mutates, so it is determinism-irrelevant; it reads only positions + content, no RNG, no wall-clock, and
 * iterates the small {@link UnderConstruction} store (membership, no pick — order-independent).
 */
export function constructionSitePlots(world: World, content: ContentSet): ConstructionPlot[] {
  const plots: ConstructionPlot[] = [];
  for (const e of world.query(UnderConstruction, Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(content, b.buildingType);
    const p = world.get(e, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    const body = footprint !== undefined && footprint.blocked.length > 0 ? footprint.blocked : ANCHOR_ONLY;
    plots.push({ cells: body.map((c) => ({ col: hx + c.dx, row: hy + c.dy })) });
  }
  return plots;
}

/** Building walk-blocks plus the cached resource walk-block overlay, materialized as ONE union set —
 *  for a caller that needs an owning `Set` (or to fold more layers over it). A caller that only tests
 *  membership should prefer {@link dynamicBlockOverlay}, which skips the union copy. */
export function dynamicBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const blocked = buildingBlockedCells(world, ctx, terrain);
  for (const cell of resourceBlockedCells(world, terrain)) blocked.add(cell);
  return blocked;
}

/**
 * The same building + resource walk-block overlay as {@link dynamicBlockedCells}, but as a
 * membership VIEW ({@link LayeredBlocks}) that never copies the (potentially large) resource overlay
 * into a fresh set. For a caller that only asks `.has(node)` — the pathfinder's block test, the
 * move-order goal snap — this is the cheap form: a box-select issuing one move order per selected
 * unit then re-scans only the small Building store per order, never re-copies every resource cell.
 */
export function dynamicBlockOverlay(world: World, ctx: SystemContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks([buildingBlockedCells(world, ctx, terrain), resourceBlockedCells(world, terrain)]);
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
 * SINGLE anchor). Injective string {@link nodeKey}s, NOT a numeric `y*width+x` packing (which would
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
    (channel === OBSTACLE ? obstacles : exclusions).add(nodeKey(x, y));
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
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
    if (blockers.obstacles.has(nodeKey(cx, cy))) return false; // a resource body or a building's walls
  }
  // 2. My family body must stay clear of resource + building EXCLUSION zones (the symmetric margin).
  for (const c of footprint.familyBody) {
    if (blockers.exclusions.has(nodeKey(x + c.dx, y + c.dy))) return false;
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
 * A per-world version of the placement-blocker INPUTS — the exact component stores {@link eachBlockerCell}
 * reads: whether each `Building`, `Resource`, and `ResourceFootprint` exists. Their generations bump only
 * on add/remove ({@link World.componentGeneration}), so this moves precisely when the obstacle set can
 * change — NOT every tick — and the overlay and {@link memoizedPlacementGrid} reuse their last result
 * until it does. Exactness rests on three standing invariants (all hold today):
 *   - buildings and resources never MOVE once placed (only settlers/vehicles/projectiles mutate Position),
 *     so a stored entity's cells are fixed;
 *   - `familyBody`/`reserved` are the union across a type's whole level chain (the extractor stamps the
 *     same arrays on every level's typeId — schema.ts), so an in-place level-up leaves the set unchanged;
 *   - a `ResourceFootprint` stamp/unstamp is always bundled in the same step with the `Resource` add/destroy
 *     that also moves this version — folding its generation in is belt-and-suspenders for any future path
 *     that decouples them (a miss would leave a stale overlay wash for a frame, never a placement decision:
 *     the command gate always re-scans fresh).
 * A string (not a packed number) so three monotonic counters compose with no overflow/aliasing reasoning.
 * Read-only + deterministic (a pure function of the mutation history); never hashed, never a sim decision.
 */
export function placementBlockerVersion(world: World): string {
  return `${world.componentGeneration(Building)}.${world.componentGeneration(Resource)}.${world.componentGeneration(ResourceFootprint)}`;
}

/**
 * The overlay's DENSE obstacle representation: one byte per half-cell node (`terrain.width×height`,
 * row-major `y*width+x` — the same index `TerrainGraph.nodeAt` mints), `1` iff that node is an
 * OBSTACLE / EXCLUSION cell. Stamped from the same {@link eachBlockerCell} pass the command gate keys
 * as strings, but read back as an O(1) typed-array index in the hot loop instead of a `nodeKey`
 * string allocation + `Set<string>` probe — the difference that lets the overlay re-probe a whole
 * visible band (screen × footprint) without stalling a frame, even for a many-hundred-cell footprint.
 * Off-map blocker cells are simply not stamped — a candidate whose reserved cell is off-map is rejected
 * by the bounds check first, so they can never be queried. Terrain buildability stays a live
 * `isBuildable()` call (static, already a grid). */
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
    if (!terrain.isBuildable(terrain.nodeAt(cx, cy))) return false; // blocking terrain too close
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
  version: string;
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
 *
 * The returned probe reads the memo's SHARED mask arrays, which are re-stamped IN PLACE on the next
 * blocker change — so drain a probe's band before the world can change again. The frame loop probes one
 * type synchronously each frame, so it never holds two probes across a rebuild; a second concurrent
 * consumer would need its own grid.
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
