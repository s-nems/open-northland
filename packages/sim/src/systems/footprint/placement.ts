import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  Stockpile,
  stockpileEntries,
} from '../../components/index.js';
import { fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
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
  const ax = fx.toInt(p.x);
  const ay = fx.toInt(p.y);
  const door = buildingFootprintOf(ctx, b.buildingType)?.door;
  if (door === undefined) return { x: ax, y: ay };
  const at = { x: ax + door.dx, y: ay + door.dy };
  if (ctx.terrain !== undefined && !ctx.terrain.inBounds(at.x, at.y)) return { x: ax, y: ay };
  return at;
}

function resourceAtTile(world: World, x: number, y: number, goodType: number): Entity | null {
  for (const resource of world.query(Resource, Position)) {
    const pos = world.get(resource, Position);
    if (fx.toInt(pos.x) !== x || fx.toInt(pos.y) !== y) continue;
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
  const ax = fx.toInt(p.x);
  const ay = fx.toInt(p.y);
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
  const x = fx.toInt(p.x);
  const y = fx.toInt(p.y);
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
    const footprint = buildingFootprintOf(ctx, b.buildingType);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    const ax = fx.toInt(p.x);
    const ay = fx.toInt(p.y);
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
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)` —
 * the original's FREE placement rule: no grid fields, just collision + a minimum distance from
 * blocking terrain and other houses, both encoded by the type's extracted footprint. Valid iff:
 *
 *  1. every cell of its `reserved` zone (the build-exclusion area — the max-level body plus the
 *     source's margin ring) is on the map and on WALKABLE terrain (the "minimum distance from
 *     blocking terrain": water/rock/void may not touch the zone), and stays clear of resource
 *     walk-block bodies;
 *  2. against every existing building: my `familyBody` (the largest body my level chain reaches —
 *     placing level 0 reserves the top level's space) stays out of ITS `reserved` zone, and its
 *     `familyBody` stays out of MY `reserved` zone. Each house keeps every other house's walls at
 *     least its own margin away — but two margins may overlap, so houses still pack closely (the
 *     original's "very free" placement). A footprint-less existing building (synthetic content)
 *     counts as a 1-cell body/zone on its anchor tile.
 *
 * A `buildingType` without a footprint validates trivially (no collision model — the pre-footprint
 * behavior synthetic content keeps). Settlers never block placement (the foundation appears under
 * them and they walk off — the walls only enter the nav overlay, {@link buildingBlockedCells}).
 *
 * source-basis (approximated, source basis "Building placement"): the footprint cells and the
 * body/zone split are the extracted `LogicWalkBlockArea`/`LogicBuildBlockArea` data (faithful); the
 * exact overlap RULE (body-vs-zone symmetric, zones may overlap) is our reading of those two areas —
 * the engine's check has no oracle. Determinism: pure boolean over content + world state; any
 * overlap rejects, so scan order cannot change the answer.
 */
export function canPlaceBuilding(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  buildingType: number,
  x: number,
  y: number,
): boolean {
  const footprint = buildingFootprintOf(ctx, buildingType);
  if (footprint === undefined) return true; // no collision model — places freely (synthetic content)

  // Set keys are geometry.ts's injective string tileKey — NOT a numeric `y*width+x` packing, which
  // would alias an off-map cell onto a real tile on the adjacent row (an existing footprint-less
  // building placed at a negative coordinate would then falsely reject a distant placement).
  // 1. The reserved zone must lie on the map and on walkable ground.
  const reserved = new Set<string>();
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) return false; // zone off the map edge
    if (!terrain.isWalkable(terrain.cellAt(cx, cy))) return false; // blocking terrain too close
    reserved.add(tileKey(cx, cy));
  }

  // The new building's full family body (max-level walls), reused for resource and building zone checks.
  const familyBody = new Set<string>();
  for (const c of footprint.familyBody) familyBody.add(tileKey(x + c.dx, y + c.dy));

  // Resource-vs-building collision. A footprinted resource contributes its extracted walk body and
  // build-exclusion zone; a legacy resource with no footprint keeps the old anchor-in-reserved rule.
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    const rx = fx.toInt(p.x);
    const ry = fx.toInt(p.y);
    const resource = world.tryGet(e, ResourceFootprint);
    if (resource === undefined) {
      if (reserved.has(tileKey(rx, ry))) return false;
      continue;
    }
    const resourceBody = translatedCellKeys(resource.walk, rx, ry);
    for (const key of resourceBody) if (reserved.has(key)) return false;
    const resourceZone = translatedCellKeys(resource.build, rx, ry);
    for (const key of resourceZone) if (familyBody.has(key)) return false;
  }

  // 2. Body-vs-zone against every existing building (symmetric, so the margin holds both ways).
  for (const e of world.query(Building, Position)) {
    const other = world.get(e, Building);
    const p = world.get(e, Position);
    const ox = fx.toInt(p.x);
    const oy = fx.toInt(p.y);
    const otherFp = buildingFootprintOf(ctx, other.buildingType);
    // A footprint-less building is a 1-cell body/zone on its anchor.
    const otherBody = otherFp?.familyBody.length ? otherFp.familyBody : ANCHOR_ONLY;
    const otherZone = otherFp?.reserved.length ? otherFp.reserved : ANCHOR_ONLY;
    for (const c of otherBody) {
      if (reserved.has(tileKey(ox + c.dx, oy + c.dy))) return false; // its walls in my zone
    }
    for (const c of otherZone) {
      if (familyBody.has(tileKey(ox + c.dx, oy + c.dy))) return false; // my walls in its zone
    }
  }
  return true;
}
