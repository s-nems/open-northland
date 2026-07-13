import type { ContentSet } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { ANCHOR_ONLY, buildingFootprintOf, translatedCells } from './geometry.js';
import { resourceBlockedCells } from './resources.js';

// WALK-BLOCK overlays the routing/render consume: the cells standing buildings (and, folded in,
// resources) make unwalkable, plus the ground plots of under-construction sites. DERIVED state,
// rebuilt per tick/frame by its consumer — never hashed, never stored.

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
