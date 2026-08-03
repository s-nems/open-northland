import { Building, DefenceMode } from '../../../../components/index.js';
import type { Command } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { shelterCapacityOf } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { isBuilt } from '../../shared.js';
import {
  nearestRaiderWithin,
  type Raider,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from './threat.js';

/**
 * Ring and unring the seat's shelters: defence mode goes up on every standing shelter a raider has closed
 * inside {@link threatWatchNodes} of, and comes down once the last one has drawn off past
 * {@link THREAT_STAND_DOWN_MARGIN_NODES} beyond that. The two radii differ on purpose - raising the alarm
 * pulls every civilian off the map, so a border that flapped would cost the seat its economy.
 */
export function alarmOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  owned: readonly Entity[],
  raiders: readonly Raider[],
): Command[] {
  const commands: Command[] = [];
  for (const e of owned) {
    const building = world.get(e, Building);
    if (shelterCapacityOf(ctx.content, building.buildingType) === 0) continue;
    const up = world.has(e, DefenceMode);
    const threatened =
      isBuilt(world, e) && raiders.length > 0 && closedOn(world, ctx, terrain, e, up, raiders);
    if (threatened === up) continue;
    commands.push({ kind: 'setDefenceMode', building: e, enabled: threatened });
  }
  return commands;
}

/** Whether a raider stands inside `shelter`'s band - widened by the stand-down margin while its alarm is
 *  already `up`, which is the whole of the hysteresis. */
function closedOn(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  shelter: Entity,
  up: boolean,
  raiders: readonly Raider[],
): boolean {
  const watch = threatWatchNodes(ctx, world.get(shelter, Building).tribe);
  const band = up ? watch + THREAT_STAND_DOWN_MARGIN_NODES : watch;
  const at = terrain.coordsOf(entityNode(world, terrain, shelter));
  return nearestRaiderWithin(raiders, at.x, at.y, band) !== null;
}
