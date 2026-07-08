import type {
  BuildingFootprint,
  ContentSet,
  FootprintCell,
  LandscapeBlockArea,
  LandscapeGfx,
} from '@vinland/data';
import {
  Building,
  GroundDrop,
  Position,
  Resource,
  ResourceFootprint,
  type ResourceFootprintCell,
  type ResourceFootprintData,
  Stockpile,
  stockpileEntries,
} from '../components/index.js';
import { contentIndex } from '../core/content-index.js';
import { fx } from '../core/fixed.js';
import type { Entity, World } from '../ecs/world.js';
import type { CellId, TerrainGraph } from '../nav/terrain.js';
import type { SystemContext } from './context.js';

// Building ground-footprint helpers — the collision/placement model extracted from the original's
// `[GfxHouse]` records ({@link BuildingFootprint}: `blocked` walk-block body, `familyBody` max-level
// body, `reserved` build-exclusion zone, `door` entry cell). A leaf module like shared.ts: consumed
// by the CommandSystem (placement validation), the PathfindingSystem (the walk-block overlay), the
// AI planner + JobSystem + ProductionSystem (door-cell interaction), never importing any system.
//
// A building TYPE without a footprint (synthetic test content; the one real graphics-less type)
// keeps the pre-footprint behavior everywhere: it places without collision checks, blocks no cell,
// and is interacted with on its anchor tile.
//
// Resource footprints are opt-in via ResourceFootprint. A bare Resource keeps the legacy same-tile
// fixture behavior; a stamped one consumes the original `[GfxLandscape]` walk/build/work areas.

/** Injective per-tile key for a spatial set/bucket (integer tile `x`,`y`). A string so a consumer with
 *  no terrain handle (hence no map width) can still key by tile — and so a negative/off-map coordinate
 *  can never alias onto a real tile the way a numeric `y*width+x` packing would. Re-exported by
 *  shared.ts (whose `TileBuckets` keys with it); defined here because shared.ts already imports from
 *  this module, keeping the leaf import graph acyclic. */
export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** The footprint of a building type, or undefined when the type is unknown or carries none. */
function buildingFootprintOf(ctx: SystemContext, buildingType: number): BuildingFootprint | undefined {
  return contentIndex(ctx.content).buildings.get(buildingType)?.footprint;
}

/** Collapse a `[GfxLandscape]` area table to the fresh/full object's cells. */
function footprintCellsForFullState(areas: readonly LandscapeBlockArea[]): ResourceFootprintCell[] {
  if (areas.length === 0) return [];
  let fullState = 0;
  for (const [state] of areas) if (state > fullState) fullState = state;
  const seen = new Set<string>();
  const out: ResourceFootprintCell[] = [];
  for (const [state, dx, dy, run] of areas) {
    if (state !== fullState) continue;
    if (run <= 0) continue;
    for (let i = 0; i < run; i++) {
      const cell = { dx: dx + i, dy };
      const key = tileKey(cell.dx, cell.dy);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cell);
    }
  }
  return out;
}

/**
 * Convert one decoded `[GfxLandscape]` record into the sim's resource-footprint component payload.
 * The source stores repeated rows per valency/growth state; collision for Step 5 is static until the
 * node is removed, so the full/fresh state is the correct conservative consumer.
 */
export function resourceFootprintFromLandscapeGfx(record: LandscapeGfx): ResourceFootprintData {
  return {
    walk: footprintCellsForFullState(record.walkBlockAreas),
    build: footprintCellsForFullState(record.buildBlockAreas),
    work: footprintCellsForFullState(record.workAreas),
    sourceGfxIndex: record.index,
  };
}

/** Resolve the representative harvest-stage landscape gfx record for a good's resource node. */
export function resourceFootprintForGood(
  content: ContentSet,
  goodType: number,
  gfxIndex?: number,
): ResourceFootprintData | null {
  const pipeline = contentIndex(content).gatheringPipelinesByGood.get(goodType);
  const stage = pipeline?.harvest ?? pipeline?.pickup;
  if (stage === undefined) return null;
  const byIndex = contentIndex(content).landscapeGfxByIndex;
  if (gfxIndex !== undefined) {
    if (!stage.gfxIndices.includes(gfxIndex)) return null;
    const record = byIndex.get(gfxIndex);
    return record === undefined ? null : resourceFootprintFromLandscapeGfx(record);
  }
  for (const index of stage.gfxIndices) {
    const record = byIndex.get(index);
    if (record !== undefined) return resourceFootprintFromLandscapeGfx(record);
  }
  return null;
}

/** Stamp a resource node with its content-derived footprint, returning false when no source record exists. */
export function stampResourceFootprint(
  world: World,
  content: ContentSet,
  resource: Entity,
  goodType: number,
  gfxIndex?: number,
): boolean {
  const footprint = resourceFootprintForGood(content, goodType, gfxIndex);
  if (footprint === null) return false;
  world.add(resource, ResourceFootprint, footprint);
  refreshResourceBlockedCacheEntry(world, resource);
  return true;
}

/** Remove a resource footprint through the incremental blocked-cell cache before destroying a node. */
export function unstampResourceFootprint(world: World, resource: Entity): void {
  if (!world.has(resource, ResourceFootprint)) return;
  world.remove(resource, ResourceFootprint);
  removeResourceBlockedCacheEntry(world, resource);
  syncResourceBlockedCacheGeneration(world);
}

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

/** Translate a footprint cell list to a building anchor, dropping cells outside the terrain grid
 *  (a border-hugging building simply blocks/reserves fewer cells than its template). */
function translatedCells(
  terrain: TerrainGraph,
  cells: readonly FootprintCell[],
  anchorX: number,
  anchorY: number,
): CellId[] {
  const out: CellId[] = [];
  for (const c of cells) {
    const x = anchorX + c.dx;
    const y = anchorY + c.dy;
    if (terrain.inBounds(x, y)) out.push(terrain.cellAt(x, y));
  }
  return out;
}

function translatedCellKeys(cells: readonly FootprintCell[], anchorX: number, anchorY: number): Set<string> {
  const out = new Set<string>();
  for (const c of cells) out.add(tileKey(anchorX + c.dx, anchorY + c.dy));
  return out;
}

interface ResourceBlockedCache {
  generation: number;
  readonly terrain: TerrainGraph;
  readonly cells: Set<CellId>;
  readonly counts: Map<CellId, number>;
  readonly entries: Map<Entity, readonly CellId[]>;
}

const resourceBlockedCache = new WeakMap<World, ResourceBlockedCache>();

function resourceBlockedCellsFor(world: World, terrain: TerrainGraph, resource: Entity): CellId[] | null {
  const footprint = world.tryGet(resource, ResourceFootprint);
  const p = world.tryGet(resource, Position);
  if (footprint === undefined || p === undefined) return null;
  const ax = fx.toInt(p.x);
  const ay = fx.toInt(p.y);
  return translatedCells(terrain, footprint.walk, ax, ay);
}

function addResourceBlockedCacheEntry(
  cache: ResourceBlockedCache,
  resource: Entity,
  cells: readonly CellId[],
): void {
  removeResourceBlockedCacheEntryFrom(cache, resource);
  cache.entries.set(resource, cells);
  for (const cell of cells) {
    const count = (cache.counts.get(cell) ?? 0) + 1;
    cache.counts.set(cell, count);
    cache.cells.add(cell);
  }
}

function removeResourceBlockedCacheEntryFrom(cache: ResourceBlockedCache, resource: Entity): void {
  const cells = cache.entries.get(resource);
  if (cells === undefined) return;
  cache.entries.delete(resource);
  for (const cell of cells) {
    const count = (cache.counts.get(cell) ?? 0) - 1;
    if (count > 0) {
      cache.counts.set(cell, count);
    } else {
      cache.counts.delete(cell);
      cache.cells.delete(cell);
    }
  }
}

function refreshResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  const cells = resourceBlockedCellsFor(world, cache.terrain, resource);
  if (cells === null) {
    removeResourceBlockedCacheEntryFrom(cache, resource);
  } else {
    addResourceBlockedCacheEntry(cache, resource, cells);
  }
  syncResourceBlockedCacheGeneration(world);
}

function removeResourceBlockedCacheEntry(world: World, resource: Entity): void {
  const cache = resourceBlockedCache.get(world);
  if (cache === undefined) return;
  removeResourceBlockedCacheEntryFrom(cache, resource);
}

function syncResourceBlockedCacheGeneration(world: World): void {
  const cache = resourceBlockedCache.get(world);
  if (cache !== undefined) cache.generation = world.componentGeneration(ResourceFootprint);
}

function deriveResourceBlockedCache(world: World, terrain: TerrainGraph): ResourceBlockedCache {
  const cache: ResourceBlockedCache = {
    generation: world.componentGeneration(ResourceFootprint),
    terrain,
    cells: new Set<CellId>(),
    counts: new Map<CellId, number>(),
    entries: new Map<Entity, readonly CellId[]>(),
  };
  for (const e of world.query(ResourceFootprint, Position)) {
    const cells = resourceBlockedCellsFor(world, terrain, e);
    if (cells !== null) addResourceBlockedCacheEntry(cache, e, cells);
  }
  return cache;
}

function deriveResourceBlockedCells(world: World, terrain: TerrainGraph): Set<CellId> {
  return deriveResourceBlockedCache(world, terrain).cells;
}

function sameCells(a: ReadonlySet<CellId>, b: ReadonlySet<CellId>): boolean {
  if (a.size !== b.size) return false;
  for (const cell of a) if (!b.has(cell)) return false;
  return true;
}

function verifyResourceBlockedCache(world: World, terrain: TerrainGraph): string[] {
  const cached = resourceBlockedCache.get(world);
  if (cached === undefined) return [];
  if (cached.terrain !== terrain) return [];
  if (cached.generation !== world.componentGeneration(ResourceFootprint)) return [];
  const fresh = deriveResourceBlockedCells(world, terrain);
  if (sameCells(cached.cells, fresh)) return [];
  return [
    `resourceBlockedCells cache holds ${cached.cells.size} cells but re-derived ${fresh.size} — stale resource footprint overlay`,
  ];
}

/**
 * The cells standing resource nodes make unwalkable. Built once per world/terrain and maintained by
 * `stampResourceFootprint` / `unstampResourceFootprint` for the resource spawn/removal paths, so clearing
 * a forest mutates just the affected node's cells instead of scanning every resource on the next route.
 * A direct ResourceFootprint store mutation still falls back to a full rebuild for correctness.
 */
export function resourceBlockedCells(world: World, terrain: TerrainGraph): ReadonlySet<CellId> {
  const generation = world.componentGeneration(ResourceFootprint);
  const cached = resourceBlockedCache.get(world);
  if (cached !== undefined && cached.terrain === terrain && cached.generation === generation) {
    return cached.cells;
  }

  const cache = deriveResourceBlockedCache(world, terrain);
  resourceBlockedCache.set(world, cache);
  world.registerCacheVerifier('resourceBlockedCells', () => verifyResourceBlockedCache(world, terrain));
  return cache.cells;
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

/** Integer Manhattan distance between two cells — the cheap reach/nearness heuristic the AI planner,
 *  combat range check, and herding leader-distance measure with (A* computes the real path cost).
 *  Defined here (the leaf module, for its nearest-cell picks) and re-exported by ./spatial.ts. */
export function manhattan(terrain: TerrainGraph, a: CellId, b: CellId): number {
  const ca = terrain.coordsOf(a);
  const cb = terrain.coordsOf(b);
  return Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y);
}

function nearestCell(
  terrain: TerrainGraph,
  candidates: readonly CellId[],
  from: CellId | undefined,
): CellId | null {
  let best: CellId | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const cell of candidates) {
    const dist = from === undefined ? 0 : manhattan(terrain, from, cell);
    if (best === null || dist < bestDist || (dist === bestDist && cell < best)) {
      best = cell;
      bestDist = dist;
    }
  }
  return best;
}

function nearestFreeNeighbour(
  terrain: TerrainGraph,
  anchor: CellId,
  blocked: ReadonlySet<CellId>,
  from: CellId | undefined,
): CellId | null {
  return nearestCell(
    terrain,
    terrain.walkableNeighbours(anchor).filter((cell) => !blocked.has(cell)),
    from,
  );
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

  // Set keys are shared.ts's injective string tileKey — NOT a numeric `y*width+x` packing, which
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

/** The 1-cell footprint a footprint-less building presents to placement checks. */
const ANCHOR_ONLY: readonly FootprintCell[] = Object.freeze([{ dx: 0, dy: 0 }]);
