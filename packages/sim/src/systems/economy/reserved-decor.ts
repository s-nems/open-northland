import type { ContentSet } from '@open-northland/data';
import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { reservedZoneOf } from '../footprint/geometry.js';
import { placementBlockerGrid } from '../footprint/placement/blocker-grid.js';
import { entityNode } from '../spatial/nodes.js';

/** A spatial region-index `near` query - every entity of one decor kind whose anchor lies within `reach`
 *  nodes of `(hx, hy)`, ascending-id (e.g. `bushesNearNode`, `stumpsNearNode`). */
type NearQuery = (world: World, hx: number, hy: number, reach: number) => Entity[];

/**
 * The walkable landscape-decor entities standing inside `building`'s reserved build-exclusion zone; each
 * caller adds its own removal policy. Bounded by the zone: reads only the decor within its Chebyshev reach,
 * never every one on the map. The returned list is a snapshot, so a caller may `world.destroy` each entry
 * without disturbing the scan.
 */
export function decorInReservedZone(
  world: World,
  ctx: SystemContext,
  building: Entity,
  near: NearQuery,
): Entity[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const b = world.tryGet(building, Building);
  const p = world.tryGet(building, Position);
  if (b === undefined || p === undefined) return [];
  const anchor = nodeOfPosition(p.x, p.y);
  const rz = reservedZoneOf(ctx.content, terrain, b.buildingType, b.tribe, anchor.hx, anchor.hy);
  if (rz === undefined) return [];
  return near(world, anchor.hx, anchor.hy, rz.reach).filter((e) =>
    rz.zone.has(entityNode(world, terrain, e)),
  );
}

/**
 * Whether half-cell node `(hx, hy)` lies in a standing building's reserved zone, the ground its placement
 * cleared of walkable decor. A map's decor authored there, such as under a start building a changed tribe
 * widened, is skipped at spawn so it matches what placing the building would have left.
 */
export function insideBuildingReservedZone(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
): boolean {
  if (!terrain.inBounds(hx, hy)) return false;
  const grid = placementBlockerGrid(world, content, terrain);
  return (grid.buildingZone[hy * terrain.width + hx] ?? 0) > 0;
}
