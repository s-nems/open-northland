import { Building, DefenceMode, Owner, UnderConstruction } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { shelterCapacityOf } from '../readviews/index.js';

/**
 * Raise or lower the alarm on one owned garrison building - see the command doc. The mode is a plain
 * {@link DefenceMode} marker; everything it causes belongs to the defence system and the shelter drive,
 * keyed on the marker.
 *
 * A type with no garrison (`shelterCapacity 0`) is refused in both directions. Raising is also refused for
 * a site still under construction, a foundation having no inside to hide in; lowering is not refused for
 * the building's state.
 */
export function setDefenceMode(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setDefenceMode' }>,
): void {
  const building = command.building;
  if (!world.isAlive(building)) return;
  const b = world.tryGet(building, Building);
  const owner = world.tryGet(building, Owner);
  if (b === undefined || owner === undefined) return;
  if (shelterCapacityOf(ctx.content, b.buildingType) === 0) return;

  if (!command.enabled) {
    world.remove(building, DefenceMode);
    return;
  }
  if (world.has(building, UnderConstruction)) return;
  if (world.has(building, DefenceMode)) return; // already up - no second alarm
  world.add(building, DefenceMode, {});
  ctx.events.emit({ kind: 'defenceAlarmRaised', entity: building, player: owner.player });
}
