import type { ContentSet } from '@open-northland/data';
import { Building, Position, UnderConstruction } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { BlockOverlay, NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { ANCHOR_ONLY, buildingFootprintOf } from './geometry.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';

// WALK-BLOCK overlays the routing/render consume: the union views over the memoized building
// walk-block cells (./building-blocked-cache.ts) and the incrementally-cached resource cells
// (./resource-blocked-cache.ts), plus the ground plots of under-construction sites. DERIVED state —
// never hashed, never stored.

/**
 * Every standing building's door node — the passable gates {@link buildingBlockedCells} carves out of
 * the walk-block. A door is a designated stand (an operator runs its workshop from it), so displacement
 * passes exempt it the same way the blocked-set carve-out does. Order-independent set union.
 */
export function buildingDoorNodes(world: World, ctx: SystemContext, terrain: TerrainGraph): Set<NodeId> {
  const doors = new Set<NodeId>();
  for (const e of world.query(Building, Position)) {
    const door = buildingFootprintOf(ctx.content, world.get(e, Building).buildingType)?.door;
    if (door === undefined) continue;
    const p = world.get(e, Position);
    const { hx: ax, hy: ay } = nodeOfPosition(p.x, p.y);
    if (terrain.inBounds(ax + door.dx, ay + door.dy)) doors.add(terrain.nodeAt(ax + door.dx, ay + door.dy));
  }
  return doors;
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
 *  for a caller that needs an owning `Set` (or to fold more layers over it). Both inputs are shared
 *  caches, so the union is copied fresh per call; a caller that only tests membership should prefer
 *  {@link dynamicBlockOverlay}, which skips the copy entirely. */
export function dynamicBlockedCells(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
): ReadonlySet<NodeId> {
  const blocked = new Set<NodeId>(buildingBlockedCells(world, ctx, terrain));
  for (const cell of resourceBlockedCells(world, terrain)) blocked.add(cell);
  return blocked;
}

/**
 * The same building + resource walk-block overlay as {@link dynamicBlockedCells}, but as a
 * membership VIEW ({@link LayeredBlocks}) that never copies either cached layer into a fresh set.
 * For a caller that only asks `.has(node)` — the pathfinder's block test, the move-order goal snap,
 * the spawn push — this is the O(1)-to-compose form: a box-select issuing one move order per selected
 * unit (or a map load spawning hundreds of settlers) reuses the two shared caches per call.
 */
export function dynamicBlockOverlay(world: World, ctx: SystemContext, terrain: TerrainGraph): BlockOverlay {
  return new LayeredBlocks([buildingBlockedCells(world, ctx, terrain), resourceBlockedCells(world, terrain)]);
}
