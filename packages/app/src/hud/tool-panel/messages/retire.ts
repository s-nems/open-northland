import { entityById, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import { isStandingNote } from './feed.js';
import type { UserMessage } from './types.js';

/** Ticks a lost note stays up whatever the sim says: a worker that shrugs a refused order off and walks on
 *  at its next re-plan would otherwise take the note with it before it was read. Approximation. */
export const LOST_NOTE_HOLD_TICKS = 5 * TICKS_PER_SECOND;

/** Whether a note's reason is gone: its subject left the world, or the sim's `LostWay` marker came off. */
export function isNoteOver(m: UserMessage, snapshot: WorldSnapshot): boolean {
  if (m.subject === null) return false;
  const e = entityById(snapshot, m.subject.entity);
  if (e === undefined) return true;
  if (!isStandingNote(m.type)) return false;
  return snapshot.tick - m.tick >= LOST_NOTE_HOLD_TICKS && e.components.LostWay === undefined;
}
