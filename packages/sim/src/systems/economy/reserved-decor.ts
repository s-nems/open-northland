import { Building, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { reservedZoneOf } from '../footprint/geometry.js';
import { entityNode } from '../spatial.js';

/** A spatial region-index `near` query — every entity of one decor kind whose anchor lies within `reach`
 *  nodes of `(hx, hy)`, ascending-id (e.g. `bushesNearNode`, `stumpsNearNode`). */
type NearQuery = (world: World, hx: number, hy: number, reach: number) => Entity[];

/**
 * The walkable landscape-decor entities standing inside `building`'s reserved build-exclusion zone — the
 * shared candidate resolution behind the placement razing passes (berry bushes, felled-tree stumps). Each
 * caller then applies its own removal policy: a bush announces itself first (its `?map=` static quad must be
 * dropped), a stump just destroys.
 *
 * Golden-rule-6 bounded: reads only the decor within the zone's Chebyshev reach via `near` (the kind's region
 * index) and keeps those whose node lies in the zone, never every one on the map. The returned list is a
 * snapshot, so a caller may `world.destroy` each entry without disturbing the scan. Empty for a mapless sim, a
 * non-building / position-less target, or a fully off-grid zone.
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
  const rz = reservedZoneOf(ctx.content, terrain, b.buildingType, anchor.hx, anchor.hy);
  if (rz === undefined) return [];
  return near(world, anchor.hx, anchor.hy, rz.reach).filter((e) =>
    rz.zone.has(entityNode(world, terrain, e)),
  );
}
