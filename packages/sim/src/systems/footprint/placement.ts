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
  translatedCellKeys,
  translatedCells,
} from './geometry.js';
import { resourceBlockedCells } from './resources.js';

// INTERACTION + PLACEMENT — where a unit stands to use a building/resource (door cells, work
// cells), the walk-block overlays routing consumes, and the can-this-building-go-here check.

/**
 * The integer tile a settler must stand on to INTERACT with a building — its door cell
 * (`anchor + footprint.door`) when the type has one, else the anchor tile itself (the pre-footprint
 * same-tile model, which synthetic content keeps). This is the single seam every "walk to the
 * building / are we at the building" consumer resolves through (the AI walk targets + arrival
 * checks, the JobSystem adopt bucket, the production worker-presence gate), so the walk goal and
 * the presence test can never disagree about where "at the building" is — with the walls now
 * blocking, the anchor tile itself is typically unreachable, and the door is where the original's
 * settlers enter. A door tile OFF the map (impossible for a gate-placed footprinted building — the
 * placement rule forces the whole reserved zone, door included, in-bounds — but reachable through
 * hand-authored content) falls back to the anchor tile, so every consumer stays consistent instead
 * of a clamped walk goal disagreeing with the raw-tile presence checks. Returns null for an entity
 * without a Building or Position.
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
  for (const resource of world.query(Resource, Position)) {
    const pos = world.get(resource, Position);
    const n = nodeOfPosition(pos.x, pos.y);
    if (n.hx !== x || n.hy !== y) continue;
    if (world.get(resource, Resource).goodType !== goodType) continue;
    return resource;
  }
  return null;
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
 * The precomputed obstacle sets a placement check reads — the resource + building bodies/zones the
 * new building's footprint must avoid, gathered ONCE from `world`+`content` and then reused across
 * every candidate anchor. A single `canPlaceBuilding` builds one throwaway; the placement-overlay
 * {@link placementProbe} builds one and probes the whole visible viewport against it (so the overlay
 * stays O(visible cells), not O(cells × entities)).
 *
 * All keys are geometry.ts's injective string {@link tileKey} — NOT a numeric `y*width+x` packing,
 * which would alias an off-map cell onto a real tile on the adjacent row (a footprint-less building
 * at a negative coordinate would then falsely reject a distant placement).
 */
interface PlacementBlockers {
  readonly terrain: TerrainGraph;
  /** Cells a resource WALK body (or a footprint-less resource's anchor) occupies — a building's
   *  reserved zone may not touch these (the "minimum distance from a node"). */
  readonly resourceBodies: Set<string>;
  /** Cells a resource BUILD-exclusion zone covers — a building's family body may not touch these. */
  readonly resourceZones: Set<string>;
  /** Union of every existing building's family body (a footprint-less building: its 1-cell anchor). */
  readonly buildingBodies: Set<string>;
  /** Union of every existing building's reserved zone (a footprint-less building: its 1-cell anchor). */
  readonly buildingZones: Set<string>;
}

/** Gather the resource + building obstacle sets from the world once. Determinism: set UNIONS over
 *  `world.query` (membership only, no pick), so store-iteration order cannot change any later answer. */
function collectPlacementBlockers(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): PlacementBlockers {
  const resourceBodies = new Set<string>();
  const resourceZones = new Set<string>();
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    const { hx: rx, hy: ry } = nodeOfPosition(p.x, p.y);
    const fp = world.tryGet(e, ResourceFootprint);
    if (fp === undefined) {
      resourceBodies.add(tileKey(rx, ry)); // legacy anchor-only resource keeps the old same-tile rule
      continue;
    }
    for (const key of translatedCellKeys(fp.walk, rx, ry)) resourceBodies.add(key);
    for (const key of translatedCellKeys(fp.build, rx, ry)) resourceZones.add(key);
  }
  const buildingBodies = new Set<string>();
  const buildingZones = new Set<string>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const p = world.get(e, Position);
    const { hx: ox, hy: oy } = nodeOfPosition(p.x, p.y);
    const fp = buildingFootprintOf(content, b.buildingType);
    // A footprint-less building is a 1-cell body/zone on its anchor.
    const body = fp?.familyBody.length ? fp.familyBody : ANCHOR_ONLY;
    const zone = fp?.reserved.length ? fp.reserved : ANCHOR_ONLY;
    for (const c of body) buildingBodies.add(tileKey(ox + c.dx, oy + c.dy));
    for (const c of zone) buildingZones.add(tileKey(ox + c.dx, oy + c.dy));
  }
  return { terrain, resourceBodies, resourceZones, buildingBodies, buildingZones };
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
  // 1. The reserved zone must lie on the map, on buildable ground, and clear of node/wall bodies.
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) return false; // zone off the map edge
    if (!terrain.isBuildable(terrain.cellAt(cx, cy))) return false; // blocking terrain too close
    const key = tileKey(cx, cy);
    if (blockers.resourceBodies.has(key)) return false; // a tree/stone/ore/water node's body
    if (blockers.buildingBodies.has(key)) return false; // another building's walls in my zone
  }
  // 2. My family body must stay clear of resource + building exclusion zones (the symmetric margin).
  for (const c of footprint.familyBody) {
    const key = tileKey(x + c.dx, y + c.dy);
    if (blockers.resourceZones.has(key)) return false;
    if (blockers.buildingZones.has(key)) return false; // my walls in another building's zone
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
 * Per-world memo of the placement obstacle sets, keyed by the tick they were gathered at. Sim state
 * mutates only at a tick boundary (the command seam), so within one tick the sets are constant — the
 * overlay probes them every RAF frame (frames outrun ticks; a paused/hovering build never ticks), and
 * without this each frame would re-scan every Resource + Building on the map (an O(entities) whole-map
 * pass per frame — the perf/architecture review's finding). A pure read-path cache: it feeds only the
 * app overlay, never a sim decision, so it is not hashed and needs no `verifyCaches` registration.
 */
interface BlockerMemo {
  tick: number;
  content: ContentSet;
  terrain: TerrainGraph;
  blockers: PlacementBlockers;
}
const blockerMemo = new WeakMap<World, BlockerMemo>();

/**
 * KNOWN FRAGILITY (named, currently safe by call order): the "constant within one tick" premise can
 * be violated by DIRECT `world.add`/`remove` between steps — the fixture idiom (a harness stamping
 * Resources without ticking). Today every such mutation happens either before the first probe of its
 * tick or after the last one, and the COMMAND gate never reads this memo (`canPlaceBuilding` always
 * collects fresh), so a stale set can only mis-tint the overlay for a frame. If a same-tick
 * probe→mutate→probe sequence ever appears, key this on the Building/Resource store generations
 * instead of the tick.
 */
function memoizedBlockers(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  tick: number,
): PlacementBlockers {
  const cached = blockerMemo.get(world);
  if (
    cached !== undefined &&
    cached.tick === tick &&
    cached.content === content &&
    cached.terrain === terrain
  ) {
    return cached.blockers;
  }
  const blockers = collectPlacementBlockers(world, content, terrain);
  blockerMemo.set(world, { tick, content, terrain, blockers });
  return blockers;
}

/**
 * Build a {@link PlacementProbe} for `buildingType` — resolve its footprint and snapshot the world's
 * obstacle sets, so the app's build-mode overlay can probe every visible tile against the exact same
 * rule the `placeBuilding` command gates on ({@link canPlaceBuilding}), without rescanning the world
 * per cell. Passing `tick` (the current sim tick) memoizes the obstacle sets per tick, so the once-per-
 * frame probe build doesn't re-scan every entity while the world is unchanged; omit it (tests) to
 * always rebuild. A footprint-less type always reports placeable (its command-time behavior).
 */
export function placementProbe(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  buildingType: number,
  tick?: number,
): PlacementProbe {
  const footprint = buildingFootprintOf(content, buildingType);
  if (footprint === undefined) return { canPlace: () => true };
  const blockers =
    tick === undefined
      ? collectPlacementBlockers(world, content, terrain)
      : memoizedBlockers(world, content, terrain, tick);
  return { canPlace: (x, y) => canPlaceAnchor(blockers, footprint, x, y) };
}
