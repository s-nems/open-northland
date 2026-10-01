import {
  isWildlife,
  LeftCarcass,
  Marriage,
  Owner,
  Position,
  Rider,
  recordHumanDeath,
  Settler,
  SettlerNeeds,
  type SettlerNeedsView,
  Vehicle,
  Wedding,
  YoungAnimal,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { SystemContext } from '../context.js';
import { droppedEquipmentOf, scatterSpilledStock } from '../economy/goods-spill.js';
import { releaseSiteClaim } from '../economy/site-claim.js';
import { removeWorkFlag } from '../economy/work-flag.js';
import { isMinor } from '../family/households.js';
import { releaseWidowedParentsOf, settleWidowhood } from '../family/widowhood.js';
import { setLandscape } from '../landscape/edits.js';
import { animalRecord, firstLandscapeGfxOf, isSoldierJob, MEAT_LANDSCAPE_SLUG } from '../readviews/index.js';
import { abandonCargoRun } from '../vehicles/cargo.js';
import { vacateSeat } from '../vehicles/movement.js';
import { needLevel } from './needs/levels.js';

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
    cause: causeOf(world.tryGet(e, SettlerNeeds), ctx.tick),
    player: owner?.player ?? null,
    ...(animal ? { animal: true } : {}),
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  if (!animal) recordHumanDeath(world, owner?.player, isSoldierJob(ctx.content, settler?.jobType ?? null));
  if (animal && pos !== undefined && settler !== undefined)
    layAnimalRemains(world, ctx, e, settler.tribe, pos);
  const loot = droppedEquipmentOf(world, e);
  removeSettlerSilently(world, e);
  scatterSpilledStock(world, ctx, loot);
}

/**
 * Original behavior: an animal's death other than a hunter's bow kill leaves a `meat` pile where it fell.
 * Approximations: a species with no carcass yields leaves meat even to a hunter's shot, where the original
 * lays its tribe's cadaver; a young pile halved to zero lays nothing, where the original also clears the
 * node's standing object.
 */
function layAnimalRemains(
  world: World,
  ctx: SystemContext,
  e: Entity,
  tribe: number,
  pos: { x: Fixed; y: Fixed },
): void {
  if (world.has(e, LeftCarcass)) return;
  const size = remainsSize(
    animalRecord(ctx.content, tribe)?.maximumCadaverSize ?? 0,
    world.has(e, YoungAnimal),
  );
  if (size <= 0) return;
  const record = firstLandscapeGfxOf(ctx.content, MEAT_LANDSCAPE_SLUG);
  if (record === undefined) return;
  if (setLandscape(world, ctx, nodeOfPosition(pos.x, pos.y), record.index, size)) {
    ctx.events.emit({ kind: 'missionLandscapeChanged' });
  }
}

function remainsSize(cadaverSize: number, young: boolean): number {
  if (cadaverSize <= 0) return 0;
  const pile = Math.max(MINIMUM_REMAINS, Math.floor(cadaverSize / REMAINS_SIZE_DIVISOR));
  return young ? Math.floor(pile / YOUNG_REMAINS_DIVISOR) : pile;
}

/** Destroy a settler and settle every binding it leaves dangling. The reaper layers the death event,
 *  the statistics and the dropped gear on top of this. */
export function removeSettlerSilently(world: World, e: Entity): void {
  removeWorkFlag(world, e); // a work flag has no owner once its gatherer is gone
  releaseSiteClaim(world, e);
  const rider = world.tryGet(e, Rider);
  if (rider !== undefined && world.has(rider.vehicle, Vehicle)) vacateSeat(world, rider.vehicle, e);
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
 *  combat damage. A swing that kills a settler already pinned is the accepted ambiguity, and so is a
 *  script removing a ship at sea before the needs pass, which reads its crew's bars one pass early. */
function causeOf(needs: SettlerNeedsView | undefined, tick: number): string {
  return needs !== undefined && needLevel(needs, 'hunger', tick) === ONE
    ? DEATH_CAUSE_STARVATION
    : DEATH_CAUSE_DAMAGE;
}

/** Original behavior: a meat pile is `maximumcadaversize` / 3 and at least 1, then halved for a young
 *  animal (`baby_animal`), in integer division; a size of 0 leaves none. */
const REMAINS_SIZE_DIVISOR = 3;
const MINIMUM_REMAINS = 1;
const YOUNG_REMAINS_DIVISOR = 2;

const DEATH_CAUSE_DAMAGE = 'damage';
const DEATH_CAUSE_STARVATION = 'starvation';
