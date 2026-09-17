import type { ContentSet } from '@open-northland/data';
import {
  components,
  entityById,
  harvestJobsOf,
  jobAllowsAtomic,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { JOB_IDLE } from '../../../catalog/jobs.js';
import {
  childOrderOf,
  hasEligiblePartner,
  isAdult,
  isBoundByMarriage,
  isFemale,
  isJobLocked,
  isMarrying,
  isPlayerControllable,
  marriageOf,
  pinnedSiteOf,
  regeneratesInWorld,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  settlersIn,
  stanceModeOf,
  trainingHouseOf,
  workAreaOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { ACTION_COMMANDS, type ActionCommandId } from '../../../hud/action-ring/index.js';

/**
 * Which orders a selection may issue: the ones at least one selected settler allows, and a selection of
 * several drops the single-settler orders entirely. Deliberate deviation from the original, which draws
 * an order only when every selected settler allows it; here a mixed group keeps the order and
 * {@link orderRecipients} sends it to the settlers that allow it. Each gate follows the original's row as
 * far as the simulation honours it, and otherwise what the command accepts, so a lit button never
 * issues an order the next tick sheds.
 */
export function allowedActions(
  content: ContentSet,
  snapshot: WorldSnapshot,
  ids: readonly number[],
): ReadonlySet<ActionCommandId> {
  const settlers = settlersIn(snapshot, ids);
  const several = settlers.length > 1;
  const allowed = new Set<ActionCommandId>();
  for (const command of ACTION_COMMANDS) {
    if (several && !command.multi) continue;
    if (settlers.some((e) => allows(content, snapshot, e, command.id, several))) allowed.add(command.id);
  }
  return allowed;
}

/** The selected settlers order `id` goes to: the ones that allow it, in selection order. */
export function orderRecipients(
  content: ContentSet,
  snapshot: WorldSnapshot,
  ids: readonly number[],
  id: ActionCommandId,
): number[] {
  const settlers = settlersIn(snapshot, ids);
  const several = settlers.length > 1;
  if (several && ACTION_COMMANDS.find((command) => command.id === id)?.multi !== true) return [];
  return settlers.filter((e) => allows(content, snapshot, e, id, several)).map((e) => e.id);
}

/** A settler the player may re-trade or post: the simulation refuses both for a child and for a woman. */
function tradeAssignable(e: SnapshotEntity): boolean {
  return isAdult(e) && !isFemale(e);
}

/** A settler whose trade an order may change: a script can fix a trade the player could otherwise set. */
function tradeChangeable(e: SnapshotEntity): boolean {
  return tradeAssignable(e) && !isJobLocked(e);
}

/** A married woman may order a child while her husband lives and no child of hers is still growing. */
function canOrderChild(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  if (!isAdult(e) || !isFemale(e) || childOrderOf(e) !== undefined) return false;
  const marriage = marriageOf(e);
  if (marriage === undefined || entityById(snapshot, marriage.spouse) === undefined) return false;
  const child = marriage.child !== null ? entityById(snapshot, marriage.child) : undefined;
  return child === undefined || isAdult(child);
}

/** Men, and heroes of either sex: whom the original offers every strike past the one at a settler. */
function strikesAnyTarget(content: ContentSet, e: SnapshotEntity, job: number | null): boolean {
  return !isFemale(e) || systems.isHeroJob(content, job);
}

/** A lone fighter is offered the modes it is not in; a group is offered all three, as in the original. */
function offersMode(
  content: ContentSet,
  e: SnapshotEntity,
  job: number | null,
  mode: number,
  several: boolean,
): boolean {
  return systems.isFighterJob(content, job) && (several || stanceModeOf(e) !== mode);
}

/** The trades that work a harvest area or place a fishing delivery flag. */
function worksAnArea(content: ContentSet, e: SnapshotEntity, job: number | null): boolean {
  return (
    tradeAssignable(e) &&
    workplaceOf(e) === undefined &&
    job !== null &&
    (harvestJobsOf(content).has(job) || systems.isFisherJob(content, job))
  );
}

function allows(
  content: ContentSet,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  id: ActionCommandId,
  several: boolean,
): boolean {
  // The sim drops every player order for a unit a script put beyond the player's reach.
  if (!isPlayerControllable(e)) return false;
  const job = settlerJobType(e) ?? null;
  switch (id) {
    case 'goTo':
      return true;
    // The sim's attach gate is the vehicle type's own job list, read once a vehicle is picked; here only
    // a grown settler is offered the order (approximation: the original's ring row is not read).
    case 'assignVehicle':
      return isAdult(e);
    case 'eat':
    case 'sleep':
      return !systems.isHeroJob(content, job);
    case 'talk':
      // The chat drive leaves the fighter trades out, so the button follows it rather than the original's
      // wider "is able to talk" test.
      return !systems.isFighterJob(content, job) && jobAllowsAtomic(content, job, components.TALK_ATOMIC_ID);
    case 'pray':
      return !systems.isHeroJob(content, job) && jobAllowsAtomic(content, job, systems.PRAY_ATOMIC_ID);
    case 'marry':
      return (
        isAdult(e) &&
        !isBoundByMarriage(snapshot, e) &&
        !isMarrying(e) &&
        trainingHouseOf(e) === undefined &&
        !systems.isOnMission(content, job) &&
        hasEligiblePartner(content, snapshot, e)
      );
    case 'haveBoy':
    case 'haveGirl':
      return canOrderChild(snapshot, e);
    case 'changeProfession':
      return tradeChangeable(e);
    case 'changeEquipment':
      // The sim's `mayChangeEquipment`: a grown man who is no hero.
      return isAdult(e) && !isFemale(e) && !systems.isHeroJob(content, job);
    case 'assignWorkArea':
      return worksAnArea(content, e, job);
    case 'showWorkArea':
      // There is a circle to draw only around a work flag: an employed gatherer roams for the nearest
      // node instead of working a bounded area, while a fisher uses it as the delivery point.
      return worksAnArea(content, e, job) && workAreaOf(e) !== undefined;
    case 'erectSignpost':
    case 'explore':
      return systems.isScoutJob(content, job);
    case 'removeBuildingSite':
      return (
        tradeAssignable(e) &&
        job !== null &&
        systems.jobCanBuild(content, job) &&
        pinnedSiteOf(e) !== undefined
      );
    case 'assignBuildingSite':
      return tradeAssignable(e) && job !== null && systems.jobCanBuild(content, job);
    case 'removeLearningPlace':
      return trainingHouseOf(e) !== undefined;
    case 'assignLearningPlace':
      return tradeChangeable(e);
    case 'removeWorkPlace':
      return tradeAssignable(e) && workplaceOf(e) !== undefined;
    case 'assignWorkPlace':
      // A settler with no trade has nothing to place; the trade itself is what a workplace employs.
      return tradeAssignable(e) && job !== null && job !== JOB_IDLE;
    case 'removeHome':
      return isAdult(e) && residenceHomeOf(e) !== undefined;
    case 'assignHome':
      return isAdult(e);
    case 'attackInhabitants':
      // Observation: the original sends any adult at another settler, armed or not - an unarmed striker
      // chases and lands nothing, which is what the combat pass does with the order here too.
      return isAdult(e);
    case 'attackBuilding':
    case 'attackAnimal':
    case 'attackVehicle':
      return isAdult(e) && strikesAnyTarget(content, e, job);
    case 'attackPosition':
      return isAdult(e) && strikesAnyTarget(content, e, job) && systems.isFighterJob(content, job);
    case 'attackMode':
      return offersMode(content, e, job, systems.MILITARY_MODE.ATTACK, several);
    case 'defenceMode':
      return offersMode(content, e, job, systems.MILITARY_MODE.DEFEND, several);
    case 'ignorantMode':
      return offersMode(content, e, job, systems.MILITARY_MODE.IGNORE, several);
    // The original's group ring lists both regeneration toggles; a lone soldier sees only the one that
    // flips the state it is in.
    case 'allowRegeneration':
      return systems.isSoldierJob(content, job) && (several || !regeneratesInWorld(e));
    case 'prohibitRegeneration':
      return systems.isSoldierJob(content, job) && (several || regeneratesInWorld(e));
    default: {
      const unreachable: never = id;
      throw new Error(`unhandled action command: ${String(unreachable)}`);
    }
  }
}
