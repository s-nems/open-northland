import { entityById, ONE, systems, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import {
  childOrderWaitOf,
  marriageOf,
  needsRuleEnabled,
  orderedNeedOf,
  type SnapshotEntity,
  settlerNeedsOf,
  vehicleCommanderOf,
  workFlagOf,
  workplaceOf,
} from '../../../game/snapshot.js';
import { isStandingNote } from './feed.js';
import { hasWorkplaceToWorkAt, isDying, lacksTradeCart, occupationOf } from './from-snapshot.js';
import { USER_MESSAGE_TYPE, type UserMessage } from './types.js';

/** Ticks a lost note stays up whatever the sim says: a worker that shrugs a refused order off and walks on
 *  at its next re-plan would otherwise take the note with it before it was read. Approximation. */
export const LOST_NOTE_HOLD_TICKS = 5 * TICKS_PER_SECOND;

/** Whether a need note has been answered. The original validates these messages against the human's
 *  current need and explicitly removes them when its fulfill-needs task finishes. */
function isNeedNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  const e = m.subject === null ? undefined : entityById(snapshot, m.subject.entity);
  if (e === undefined) return true;
  if (!needsRuleEnabled(snapshot)) return true;
  const needs = settlerNeedsOf(e);
  if (needs === undefined) return true;
  switch (m.type) {
    case USER_MESSAGE_TYPE.hungry:
      return needs.hunger < systems.NEED_CRITICAL_THRESHOLD;
    case USER_MESSAGE_TYPE.starving:
      return needs.hunger < ONE;
    case USER_MESSAGE_TYPE.tired:
      return needs.fatigue < systems.NEED_CRITICAL_THRESHOLD;
    case USER_MESSAGE_TYPE.wantsToPray:
      // A failed search for somewhere to pray raises it below the critical level, so it lasts until a
      // prayer takes the bar back under the level the search started at. An ordered prayer searches at
      // any bar level, so its note stands with the order.
      return needs.piety < systems.NEED_DRIVE_THRESHOLD && orderedNeedOf(e) !== 'piety';
    default:
      return false;
  }
}

/** The polled idle notes last only while the state that raised them still holds. */
function isIdleNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  const e = m.subject === null ? undefined : entityById(snapshot, m.subject.entity);
  if (e === undefined) return true;
  if (occupationOf(snapshot, e) !== 'idle') return true;
  if (m.type === USER_MESSAGE_TYPE.nothingToDo) return !hasWorkplaceToWorkAt(snapshot, e);
  if (m.type === USER_MESSAGE_TYPE.workplaceNotFound) {
    return workplaceOf(e) !== undefined || workFlagOf(e) !== undefined;
  }
  if (m.type === USER_MESSAGE_TYPE.noVehicleForWork) return !lacksTradeCart(e);
  return false;
}

/** The notes whose cause is a state the snapshot still shows, over once that state is gone. A family
 *  note is over once its reason changes too, so the new reason raises a note with its own text. */
function isStateNoteOver(m: UserMessage, e: SnapshotEntity): boolean | undefined {
  switch (m.type) {
    case USER_MESSAGE_TYPE.willDie:
      return !isDying(e);
    case USER_MESSAGE_TYPE.noOneToMarry:
      return marriageOf(e) !== undefined;
    case USER_MESSAGE_TYPE.vehicleNoCommander:
      return vehicleCommanderOf(e) !== undefined;
    case USER_MESSAGE_TYPE.vehicleNoAnimal:
      return (e.components.Vehicle as { harnessed?: unknown } | undefined)?.harnessed === true;
    case USER_MESSAGE_TYPE.familyBlocked:
      return childOrderWaitOf(e) !== m.familyWait;
    default:
      return undefined;
  }
}

/** Whether the note's subject has left the world; a subjectless note has no one to lose. */
export function isSubjectGone(m: UserMessage, snapshot: WorldSnapshot): boolean {
  return m.subject !== null && entityById(snapshot, m.subject.entity) === undefined;
}

/** Whether a note's reason is gone: its subject left the world, the state a polled or state note reports
 *  ended, or the sim's `LostWay` marker came off. A note about a one-off event lives out its lifetime. */
export function isNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  if (m.subject === null) return false;
  const e = entityById(snapshot, m.subject.entity);
  if (e === undefined) return true;
  if (
    m.type === USER_MESSAGE_TYPE.hungry ||
    m.type === USER_MESSAGE_TYPE.starving ||
    m.type === USER_MESSAGE_TYPE.tired ||
    m.type === USER_MESSAGE_TYPE.wantsToPray
  ) {
    return isNeedNoteOver(m, snapshot);
  }
  if (
    m.type === USER_MESSAGE_TYPE.nothingToDo ||
    m.type === USER_MESSAGE_TYPE.workplaceNotFound ||
    m.type === USER_MESSAGE_TYPE.noVehicleForWork
  ) {
    return isIdleNoteOver(m, snapshot);
  }
  const stateOver = isStateNoteOver(m, e);
  if (stateOver !== undefined) return stateOver;
  if (!isStandingNote(m.type)) return false;
  return snapshot.tick - m.tick >= LOST_NOTE_HOLD_TICKS && e.components.LostWay === undefined;
}
