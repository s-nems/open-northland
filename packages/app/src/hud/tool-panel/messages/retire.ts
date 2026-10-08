import { entityById, ONE, systems, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { JOB_CARRIER, JOB_CIVILIST } from '../../../catalog/jobs.js';
import {
  isFemale,
  marriageOf,
  needsRuleEnabled,
  orderedNeedOf,
  residenceHomeOf,
  type SnapshotEntity,
  settlerJobType,
  settlerNeedsOf,
  trainingHouseOf,
  vehicleCommanderOf,
  vehicleSeatsOf,
  workFlagOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { type FightAreas, isFightNote } from './fight-areas.js';
import {
  familyNoteWaitOf,
  hasWorkplaceToWorkAt,
  holdsPost,
  type IdleReasonReader,
  idleNoteHeldByStall,
  idlesBetweenLoads,
  isStillDying,
  lacksTradeCart,
  occupationOf,
  worksAtOwnFlag,
} from './from-snapshot.js';
import { IDLE_NOTE_TYPES, idleNoteType } from './idle-reasons.js';
import type { ShortageReader } from './site-shortages.js';
import { USER_MESSAGE_TYPE, type UserMessage } from './types.js';
import type { StallReader } from './workshop-stalls.js';

/** Ticks a lost note stays up whatever the sim says: a worker that shrugs a refused order off and walks on
 *  at its next re-plan would otherwise take the note with it before it was read. Approximation. */
export const LOST_NOTE_HOLD_TICKS = 5 * TICKS_PER_SECOND;

/** Whether a need note's own stage has passed. The original validates these messages against the human's
 *  current need and explicitly removes them when its fulfill-needs task finishes. A heavier hunger stage
 *  taking a lighter card's place is the feed's rule, not this one. */
function isNeedNoteOver(m: UserMessage, snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  if (!needsRuleEnabled(snapshot)) return true;
  const needs = settlerNeedsOf(e, snapshot.tick);
  if (needs === undefined) return true;
  switch (m.type) {
    case USER_MESSAGE_TYPE.hungry:
      return needs.hunger < systems.NEED_CRITICAL_THRESHOLD;
    case USER_MESSAGE_TYPE.starving:
      return needs.hunger < ONE;
    case USER_MESSAGE_TYPE.tired:
      return needs.fatigue < systems.NEED_CRITICAL_THRESHOLD;
    case USER_MESSAGE_TYPE.wantsToPray:
      // An ordered prayer searches at any bar level, so its note stands with the order.
      return needs.piety < systems.NEED_CRITICAL_THRESHOLD && orderedNeedOf(e) !== 'piety';
    default:
      return false;
  }
}

/** The polled idle notes last as long as the sweep's idle run would: idle chatter's walk keeps the run,
 *  so it keeps the note too, while anything the planner gave the settler, an order or a held post ends
 *  both. A worker's two idle notes hand over to each other as the sweep's reason moves between a
 *  shortage and anything else. */
function isIdleNoteOver(
  m: UserMessage,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
  stalls: StallReader | null,
  idleReasons: IdleReasonReader | null,
): boolean {
  if (occupationOf(snapshot, e) === 'busy' || holdsPost(e)) return true;
  if (IDLE_NOTE_TYPES.has(m.type)) {
    const posted = hasWorkplaceToWorkAt(snapshot, e);
    if (posted ? idleNoteHeldByStall(e, stalls) || idlesBetweenLoads(e) : !worksAtOwnFlag(e)) return true;
    const reason = idleReasons?.(e.id);
    return reason !== undefined && idleNoteType(reason) !== m.type;
  }
  if (m.type === USER_MESSAGE_TYPE.workplaceNotFound) {
    return workplaceOf(e) !== undefined || workFlagOf(e) !== undefined;
  }
  return !lacksTradeCart(e);
}

/** Someone aboard to work a vehicle's wanted amounts: its commander, whatever the trade, or a carrier in
 *  any seat, as the sim's cargo rule reads them. */
function hasCargoHand(snapshot: WorldSnapshot, vehicle: SnapshotEntity): boolean {
  if (vehicleCommanderOf(vehicle) !== undefined) return true;
  const passengers = (vehicle.components.Vehicle as { passengers?: unknown } | undefined)?.passengers;
  return vehicleSeatsOf(passengers).some((seat) => {
    const rider = entityById(snapshot, seat.entity);
    return rider !== undefined && settlerJobType(rider) === JOB_CARRIER;
  });
}

/** A workshop's refusal memo of a vehicle yard search stands for as long as the search keeps failing:
 *  it lapses only to be searched again, in the same plan when the turn is the vehicle's. */
function yardRefusalStands(snapshot: WorldSnapshot, worker: SnapshotEntity): boolean {
  const workplace = workplaceOf(worker);
  if (workplace === undefined) return false;
  return entityById(snapshot, workplace)?.components.VehicleYardRefusals !== undefined;
}

/** A stall note ends when its workshop runs a cycle again, or once the sweep finds no stall or another
 *  reason; another good under the same reason only rewords it. */
function isStallOver(m: UserMessage, workshop: SnapshotEntity, stalls: StallReader | null): boolean {
  if (workshop.components.Production !== undefined || stalls === null) return true;
  const verdict = stalls.verdict(workshop.id);
  if (verdict === undefined) return false;
  return verdict === null || verdict.reason !== m.stall?.reason;
}

/** A shortage note ends when its site is no longer going up, or once the sweep finds the site short of
 *  nothing; another good only rewords it. */
function isShortageOver(site: SnapshotEntity, shortages: ShortageReader | null): boolean {
  if (site.components.UnderConstruction === undefined || shortages === null) return true;
  return shortages.verdict(site.id) === null;
}

/** A grown-up note has done its job once the player acted on it: a grown man took up a trade or is on
 *  his way to a school or barracks to learn one, a grown woman has a home. */
function isGrownUpSettled(e: SnapshotEntity): boolean {
  if (isFemale(e)) return residenceHomeOf(e) !== undefined;
  return settlerJobType(e) !== JOB_CIVILIST || trainingHouseOf(e) !== undefined;
}

function isDriving(vehicle: SnapshotEntity): boolean {
  return vehicle.components.VehicleDrive !== undefined;
}

/** Whether the note's subject has left the world; a subjectless note has no one to lose. */
export function isSubjectGone(m: UserMessage, snapshot: WorldSnapshot): boolean {
  return m.subject !== null && entityById(snapshot, m.subject.entity) === undefined;
}

/**
 * Whether a note's reason is gone: its subject left the world, the state a state note reports ended, a
 * fight went quiet in `fights`, `stalls` judged a workshop's stall otherwise, `shortages` a site's
 * shortage otherwise, or a refusal was answered. One instance serves a feed, since a refused
 * drive is answered only by a drive that starts after the vehicle stood: the drive under way at the
 * refusal, if any, is not the answer.
 * Call {@link endPass} after each expiry pass, so the notes that left stop being watched.
 */
export class NoteRetirement {
  /** Each watched no-path note by id: whether its vehicle has stood since the refusal. */
  private stood = new Map<number, boolean>();
  private watched = new Set<number>();

  constructor(
    private readonly fights: FightAreas,
    private readonly stalls: StallReader | null = null,
    private readonly shortages: ShortageReader | null = null,
    private readonly idleReasons: IdleReasonReader | null = null,
  ) {}

  isOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
    if (isFightNote(m)) return !this.fights.isActive(m.about, snapshot.tick);
    if (m.subject === null) return false;
    const e = entityById(snapshot, m.subject.entity);
    if (e === undefined) return true;
    switch (m.type) {
      case USER_MESSAGE_TYPE.hungry:
      case USER_MESSAGE_TYPE.starving:
      case USER_MESSAGE_TYPE.tired:
      case USER_MESSAGE_TYPE.wantsToPray:
        return isNeedNoteOver(m, snapshot, e);
      case USER_MESSAGE_TYPE.willDie:
        return !isStillDying(e);
      case USER_MESSAGE_TYPE.nothingToDo:
      case USER_MESSAGE_TYPE.cannotFindGood:
      case USER_MESSAGE_TYPE.workplaceNotFound:
      case USER_MESSAGE_TYPE.noVehicleForWork:
        return isIdleNoteOver(m, snapshot, e, this.stalls, this.idleReasons);
      case USER_MESSAGE_TYPE.productionStalled:
        return isStallOver(m, e, this.stalls);
      case USER_MESSAGE_TYPE.constructionStarved:
        return isShortageOver(e, this.shortages);
      case USER_MESSAGE_TYPE.vehicleSiteNotFound:
      case USER_MESSAGE_TYPE.vehicleSiteOccupied:
        return !yardRefusalStands(snapshot, e);
      case USER_MESSAGE_TYPE.lostWithoutSignposts:
        return snapshot.tick - m.tick >= LOST_NOTE_HOLD_TICKS && e.components.LostWay === undefined;
      case USER_MESSAGE_TYPE.familyBlocked:
        // A new reason retires the note, so it raises its own with its own text.
        return familyNoteWaitOf(e) !== m.familyWait;
      case USER_MESSAGE_TYPE.noOneToMarry:
        return marriageOf(e) !== undefined;
      case USER_MESSAGE_TYPE.grewUp:
        return isGrownUpSettled(e);
      case USER_MESSAGE_TYPE.vehicleNoCommander:
        return vehicleCommanderOf(e) !== undefined;
      case USER_MESSAGE_TYPE.vehicleNoAnimal:
        return (e.components.Vehicle as { harnessed?: unknown } | undefined)?.harnessed === true;
      case USER_MESSAGE_TYPE.vehicleNoCarrier:
        return hasCargoHand(snapshot, e);
      case USER_MESSAGE_TYPE.vehicleNoPath:
        return this.droveSince(m.id, e);
      default:
        return false;
    }
  }

  endPass(): void {
    for (const id of this.stood.keys()) {
      if (!this.watched.has(id)) this.stood.delete(id);
    }
    this.watched.clear();
  }

  private droveSince(id: number, vehicle: SnapshotEntity): boolean {
    this.watched.add(id);
    const driving = isDriving(vehicle);
    if (this.stood.get(id) === true) return driving;
    // First seen, or still on the drive the refusal left under way.
    this.stood.set(id, !driving);
    return false;
  }
}
