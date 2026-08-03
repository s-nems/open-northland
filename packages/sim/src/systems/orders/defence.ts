import { Building, DefenceMode, Owner, UnderConstruction } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { shelterCapacityOf } from '../readviews/index.js';

/**
 * `setDefenceMode` - raise or lower the alarm on one owned garrison building. The mode is a plain
 * {@link DefenceMode} marker; everything it causes (the run for cover, the house-bow fire, the release
 * when it drops) is the DefenceSystem's and the shelter drive's, keyed on the marker.
 *
 * Refused as recoverable bad input (a no-op, still recorded for faithful replay): a dead/stale target, a
 * non-building, an unowned one, a type with no garrison (`shelterCapacity 0`), or - when RAISING - one
 * still under construction, a foundation having no inside to hide in. Lowering is never refused for the
 * building's state: an alarm raised before an upgrade re-opened the site must still be callable off, or
 * the marker would re-arm silently when the upgrade completes. Re-raising an already-raised alarm
 * changes nothing and rings no second bell.
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
