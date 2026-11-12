import { Building, DefenceMode } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { shelterCapacityOf } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { isBuilt } from '../../seat-roster.js';
import {
  nearestRaiderWithin,
  type Raider,
  raidersNearAny,
  type Shooter,
  threatWatchNodes,
  watchBandOf,
} from './threat.js';

/** Ring and unring the seat's shelters: defence mode goes up on every standing shelter a raider has closed
 *  inside its {@link watchBandOf}, or an armed ship (`ships`) inside its plain watch, and comes down once
 *  the last one is out of it. */
export function alarmOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
  ships: readonly Shooter[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const near = raidersNearAny(world, ctx, terrain, owned, raiders);
  for (const e of owned) {
    const building = world.get(e, Building);
    if (shelterCapacityOf(ctx.content, building.buildingType) === 0) continue;
    const up = world.has(e, DefenceMode);
    const threatened =
      isBuilt(world, e) &&
      ((near.length > 0 && closedOn(world, ctx, terrain, e, near)) || shipOff(world, ctx, terrain, e, ships));
    if (threatened === up) continue;
    commands.push({ kind: 'setDefenceMode', building: e, enabled: threatened });
  }
  return commands;
}

/** Whether a raider stands inside `shelter`'s band ({@link watchBandOf} - the hysteresis lives there). */
function closedOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  shelter: Entity,
  raiders: readonly Raider[],
): boolean {
  const at = terrain.coordsOf(entityNode(world, terrain, shelter));
  // Reachability is not asked: a bow across a river still puts arrows in the street.
  return nearestRaiderWithin(raiders, at.x, at.y, watchBandOf(world, ctx, shelter), null) !== null;
}

/**
 * Whether an armed ship lies inside `shelter`'s plain watch. No sortie can answer a ship, so the
 * stand-down margin of {@link watchBandOf} would hold the town in cover for as long as one rode at anchor
 * past its own reach.
 */
function shipOff(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  shelter: Entity,
  ships: readonly Shooter[],
): boolean {
  if (ships.length === 0) return false;
  const at = terrain.coordsOf(entityNode(world, terrain, shelter));
  const watch = threatWatchNodes(ctx, world.get(shelter, Building).tribe);
  return ships.some((ship) => hexDistanceBetween(ship.x, ship.y, at.x, at.y) <= watch);
}
