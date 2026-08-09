import { Building, DefenceMode } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { shelterCapacityOf } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { isBuilt } from '../../seat-roster.js';
import { nearestRaiderWithin, type Raider, watchBandOf } from './threat.js';

/** Ring and unring the seat's shelters: defence mode goes up on every standing shelter a raider has
 *  closed inside its {@link watchBandOf}, and comes down once the last one is out of it. */
export function alarmOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of owned) {
    const building = world.get(e, Building);
    if (shelterCapacityOf(ctx.content, building.buildingType) === 0) continue;
    const up = world.has(e, DefenceMode);
    const threatened = isBuilt(world, e) && raiders.length > 0 && closedOn(world, ctx, terrain, e, raiders);
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
