import {
  isWildlife,
  Marriage,
  Owner,
  Position,
  Rider,
  recordHumanDeath,
  Settler,
  unseatPassenger,
  Vehicle,
  Wedding,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { droppedEquipmentOf, scatterSpilledStock } from '../economy/goods-spill.js';
import { removeWorkFlag } from '../economy/work-flag.js';
import { isMinor } from '../family/households.js';
import { releaseWidowedParentsOf, settleWidowhood } from '../family/widowhood.js';
import { releasePalisadeReservation } from '../palisades/reservation.js';
import { isSoldierJob } from '../readviews/index.js';
import { abandonCargoRun } from '../vehicles/cargo.js';

// A settler's death and silent removal: a leaf below the cleanup system, so a vehicle sinking its crew
// and the cleanup reaping a vehicle do not import each other.

/** Announce a combatant's death, count it against its owner, remove it from the world, and leave its
 *  gear on the ground where it fell. The event is emitted before the destroy so its `Owner` and
 *  `Position` are still readable. Also the death a sinking ship deals its crew. */
export function reap(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  const settler = world.tryGet(e, Settler);
  const animal = isWildlife(world, e);
  ctx.events.emit({
    kind: 'settlerDied',
    entity: e,
    cause: causeOf(settler),
    player: owner?.player ?? null,
    ...(animal ? { animal: true } : {}),
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  if (!animal) recordHumanDeath(world, owner?.player, isSoldierJob(ctx.content, settler?.jobType ?? null));
  const loot = droppedEquipmentOf(world, e);
  removeSettlerSilently(world, e);
  scatterSpilledStock(world, ctx, loot);
}

/** Destroy a settler and settle every binding it leaves dangling. The reaper layers the death event,
 *  the statistics and the dropped gear on top of this. */
export function removeSettlerSilently(world: World, e: Entity): void {
  removeWorkFlag(world, e); // a work flag has no owner once its gatherer is gone
  releasePalisadeReservation(world, e);
  const rider = world.tryGet(e, Rider);
  if (rider !== undefined && world.has(rider.vehicle, Vehicle)) unseatPassenger(world, rider.vehicle, e);
  abandonCargoRun(world, e);
  const marriage = world.tryGet(e, Marriage);
  const wedding = world.tryGet(e, Wedding);
  const wasMinor = isMinor(world, e);
  world.destroy(e);
  // The widowing rule needs the decedent already dead, so it settles after the destroy; a dying minor
  // is the other trigger that expires a widowed parent's carve-out.
  if (marriage !== undefined && world.isAlive(marriage.spouse)) settleWidowhood(world, marriage.spouse);
  if (wedding !== undefined && world.isAlive(wedding.partner)) world.remove(wedding.partner, Wedding);
  if (wasMinor) releaseWidowedParentsOf(world, e);
}

/** A render/audio hint, not simulated state: hunger pinned at ONE reads as starvation, everything else as
 *  combat damage. A swing that kills a settler already pinned is the accepted ambiguity. */
function causeOf(settler: { hunger: Fixed } | undefined): string {
  return settler !== undefined && settler.hunger === ONE ? DEATH_CAUSE_STARVATION : DEATH_CAUSE_DAMAGE;
}

const DEATH_CAUSE_DAMAGE = 'damage';
const DEATH_CAUSE_STARVATION = 'starvation';
