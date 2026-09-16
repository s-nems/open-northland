import { entityById, ONE, systems, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { needsRuleEnabled, settlerNeedsOf, workFlagOf, workplaceOf } from '../../../game/snapshot.js';
import { isStandingNote } from './feed.js';
import { hasWorkplaceToWorkAt, occupationOf } from './from-snapshot.js';
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
      return needs.piety < systems.NEED_CRITICAL_THRESHOLD;
    default:
      return false;
  }
}

/** The two polled idle notes last only while the state that raised them still holds. */
function isIdleNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  const e = m.subject === null ? undefined : entityById(snapshot, m.subject.entity);
  if (e === undefined) return true;
  if (occupationOf(snapshot, e) !== 'idle') return true;
  if (m.type === USER_MESSAGE_TYPE.nothingToDo) return !hasWorkplaceToWorkAt(snapshot, e);
  if (m.type === USER_MESSAGE_TYPE.workplaceNotFound) {
    return workplaceOf(e) !== undefined || workFlagOf(e) !== undefined;
  }
  return false;
}

/** Whether a note's reason is gone: its subject left the world, or the sim's `LostWay` marker came off. */
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
  if (m.type === USER_MESSAGE_TYPE.nothingToDo || m.type === USER_MESSAGE_TYPE.workplaceNotFound) {
    return isIdleNoteOver(m, snapshot);
  }
  if (!isStandingNote(m.type)) return false;
  return snapshot.tick - m.tick >= LOST_NOTE_HOLD_TICKS && e.components.LostWay === undefined;
}
