import type { BuildingFootprint, FootprintCell } from '@vinland/data';
import { Building, Position, Resource } from '../components/index.js';
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

/** The footprint of a building type, or undefined when the type is unknown or carries none. */
export function buildingFootprintOf(ctx: SystemContext, buildingType: number): BuildingFootprint | undefined {
  return ctx.content.buildings.find((t) => t.typeId === buildingType)?.footprint;
}

/**
 * The integer tile a settler must stand on to INTERACT with a building — its door cell
 * (`anchor + footprint.door`) when the type has one, else the anchor tile itself (the pre-footprint
 * same-tile model, which synthetic content keeps). This is the single seam every "walk to the
 * building / are we at the building" consumer resolves through (the AI walk targets + arrival
 * checks, the JobSystem adopt bucket, the production worker-presence gate), so the walk goal and
 * the presence test can never disagree about where "at the building" is — with the walls now
 * blocking, the anchor tile itself is typically unreachable, and the door is where the original's
 * settlers enter. Returns null for an entity without a Building or Position.
 */
export function interactionTile(
  world: World,
  ctx: SystemContext,
  building: Entity,
): { x: number; y: number } | null {
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return null;
  const door = buildingFootprintOf(ctx, b.buildingType)?.door;
  return {
    x: fx.toInt(p.x) + (door?.dx ?? 0),
    y: fx.toInt(p.y) + (door?.dy ?? 0),
  };
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

/**
 * The cells standing buildings make UNWALKABLE right now — the union of every placed building's
 * `footprint.blocked` cells (its CURRENT level's walls; the level chain swaps `buildingType`, so an
 * upgraded home's larger body is picked up on the next rebuild). The walk-block applies from the
 * placement tick: a grey foundation already occupies its cells, exactly like the original.
 *
 * DERIVED state, rebuilt per tick by its consumer (the PathfindingSystem) — never hashed, never
 * stored, so it cannot drift from the Building components it is computed from (the same stance as
 * `TileBuckets`). Determinism: a set UNION over `world.query` — order-independent (membership only,
 * no pick), so store-order iteration is fine.
 */
export function buildingBlockedCells(world: World, ctx: SystemContext, terrain: TerrainGraph): Set<CellId> {
  const blocked = new Set<CellId>();
  for (const e of world.query(Building, Position)) {
    const b = world.get(e, Building);
    const footprint = buildingFootprintOf(ctx, b.buildingType);
    if (footprint === undefined || footprint.blocked.length === 0) continue;
    const p = world.get(e, Position);
    for (const cell of translatedCells(terrain, footprint.blocked, fx.toInt(p.x), fx.toInt(p.y))) {
      blocked.add(cell);
    }
  }
  return blocked;
}

/** A packed per-tile key into `width`-wide grid space (the cell-id packing, reused for set tests). */
function packTile(terrain: TerrainGraph, x: number, y: number): number {
  return y * terrain.width + x;
}

/**
 * Whether a building of `buildingType` may be placed with its anchor at integer tile `(x, y)` —
 * the original's FREE placement rule: no grid fields, just collision + a minimum distance from
 * blocking terrain and other houses, both encoded by the type's extracted footprint. Valid iff:
 *
 *  1. every cell of its `reserved` zone (the build-exclusion area — the max-level body plus the
 *     source's margin ring) is on the map and on WALKABLE terrain (the "minimum distance from
 *     blocking terrain": water/rock/void may not touch the zone), and holds no {@link Resource}
 *     node (a tree/stone keeps the same distance a house does);
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
 * FIDELITY (approximated, docs/FIDELITY.md "Building placement"): the footprint cells and the
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

  // 1. The reserved zone must lie on the map, on walkable ground, clear of resource nodes.
  const reserved = new Set<number>();
  for (const c of footprint.reserved) {
    const cx = x + c.dx;
    const cy = y + c.dy;
    if (!terrain.inBounds(cx, cy)) return false; // zone off the map edge
    if (!terrain.isWalkable(terrain.cellAt(cx, cy))) return false; // blocking terrain too close
    reserved.add(packTile(terrain, cx, cy));
  }
  for (const e of world.query(Resource, Position)) {
    const p = world.get(e, Position);
    if (reserved.has(packTile(terrain, fx.toInt(p.x), fx.toInt(p.y)))) return false; // a tree/stone in the zone
  }

  // 2. Body-vs-zone against every existing building (symmetric, so the margin holds both ways).
  const familyBody = new Set<number>();
  for (const c of footprint.familyBody) familyBody.add(packTile(terrain, x + c.dx, y + c.dy));

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
      if (reserved.has(packTile(terrain, ox + c.dx, oy + c.dy))) return false; // its walls in my zone
    }
    for (const c of otherZone) {
      if (familyBody.has(packTile(terrain, ox + c.dx, oy + c.dy))) return false; // my walls in its zone
    }
  }
  return true;
}

/** The 1-cell footprint a footprint-less building presents to placement checks. */
const ANCHOR_ONLY: readonly FootprintCell[] = Object.freeze([{ dx: 0, dy: 0 }]);
