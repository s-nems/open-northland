import { formatMessage, type Messages, pluralForm } from '../../../i18n/index.js';
import { lifecycleOf } from './lifecycle.js';
import {
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from './types.js';

type NoticesCopy = Messages['hud']['notices'];

/** The types a family breakdown names, one plural phrase each in the catalog. */
type FamilyTypeName = keyof NoticesCopy['groupParts'];

/** The topic families that share one stack across types and weights; every other type stacks with notes
 *  of its own type and card line. */
type NoticeFamily = 'hunger' | 'idle';

/** Each family's types, heaviest first: the order a stack's breakdown names them in. */
const NOTICE_FAMILIES: Readonly<Record<NoticeFamily, readonly FamilyTypeName[]>> = {
  hunger: ['willDie', 'starving', 'hungry'],
  idle: ['workplaceNotFound', 'noVehicleForWork', 'nothingToDo'],
};

/** A stack needs this many members; a lone note is a plain card. */
export const MIN_STACK_MEMBERS = 2;

const FAMILY_ENTRIES = Object.entries(NOTICE_FAMILIES) as [NoticeFamily, readonly FamilyTypeName[]][];
const FAMILY_BY_TYPE: ReadonlyMap<UserMessageType, NoticeFamily> = new Map(
  FAMILY_ENTRIES.flatMap(([family, names]) =>
    names.map((name) => [USER_MESSAGE_TYPE[name], family] as const),
  ),
);
/** A family type's place in its family, heaviest 0: dying leads starving though both weigh as urgent. */
const STAGE_BY_TYPE: ReadonlyMap<UserMessageType, number> = new Map(
  FAMILY_ENTRIES.flatMap(([, names]) =>
    names.map((name, stage) => [USER_MESSAGE_TYPE[name], stage] as const),
  ),
);

/** The types whose card line differs between notes only by the subject's sex ("Zgubił się", "Zgubiła
 *  się"): such a line carries no detail, so the type stacks as one. */
export const SEX_ONLY_LINE_TYPES: ReadonlySet<UserMessageType> = new Set([
  USER_MESSAGE_TYPE.lostWithoutSignposts,
  USER_MESSAGE_TYPE.grewUp,
]);

/** The card line a note reads, as stacking compares it: its type, with the detail the line names (a
 *  good, a stance, a family reason) unless only the subject's sex varies it. */
function lineKey(note: Pick<UserMessage, 'type' | 'text'>): string {
  return SEX_ONLY_LINE_TYPES.has(note.type) ? `type:${note.type}` : `type:${note.type}|${note.text.short}`;
}

/** The stack a note joins: its family, else its card line. */
export function noticeGroupKey(note: Pick<UserMessage, 'type' | 'text'>): string {
  const family = FAMILY_BY_TYPE.get(note.type);
  return family === undefined ? lineKey(note) : `family:${family}`;
}

/** The lead rule: the heaviest first (by weight, then by family stage); among equals a state note
 *  standing longest (the most neglected) and an event note newest (where things happen now). */
export function compareLead(a: UserMessage, b: UserMessage): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const stages = (STAGE_BY_TYPE.get(a.type) ?? 0) - (STAGE_BY_TYPE.get(b.type) ?? 0);
  if (stages !== 0) return stages;
  const bothState = lifecycleOf(a.type) === 'state' && lifecycleOf(b.type) === 'state';
  return bothState ? a.tick - b.tick || a.id - b.id : b.tick - a.tick || b.id - a.id;
}

/** Notes that share a key. `members` runs in lead order, so `members[0]` is the card's face. */
export interface NoticeGroup {
  readonly key: string;
  readonly members: readonly UserMessage[];
  readonly level: MessagePriorityLevel;
  /** The newest member, which places the stack within its weight. */
  readonly newest: UserMessage;
}

function isNewer(a: UserMessage, b: UserMessage): boolean {
  return a.tick > b.tick || (a.tick === b.tick && a.id > b.id);
}

/**
 * The column's stacks for the shown notes, in column order: the heaviest weight first, then the stack
 * whose newest member arrived last, so a new member lifts its stack. One pass per feed change over at
 * most the feed's slots.
 */
export function groupNotes(notes: readonly UserMessage[]): NoticeGroup[] {
  const byKey = new Map<string, UserMessage[]>();
  for (const note of notes) {
    const key = noticeGroupKey(note);
    const members = byKey.get(key);
    if (members === undefined) byKey.set(key, [note]);
    else members.push(note);
  }
  const groups: NoticeGroup[] = [];
  for (const [key, members] of byKey) {
    members.sort(compareLead);
    const [lead] = members;
    if (lead === undefined) continue;
    let newest = lead;
    for (const m of members) if (isNewer(m, newest)) newest = m;
    groups.push({ key, members, level: lead.priority, newest });
  }
  return groups.sort(
    (a, b) => b.level - a.level || b.newest.tick - a.newest.tick || b.newest.id - a.newest.id,
  );
}

/** What a stack holds, for its hover line and its spoken label: a family's members counted per type
 *  ("1 umiera · 3 głodują · 9 chce jeść"), any other stack's count of notes. */
export function groupBreakdown(group: NoticeGroup, copy: NoticesCopy, localeTag: string): string {
  const count = group.members.length;
  const [lead] = group.members;
  const family = lead === undefined ? undefined : FAMILY_BY_TYPE.get(lead.type);
  if (family === undefined) return formatMessage(pluralForm(count, copy.groupCount, localeTag), { count });
  const parts: string[] = [];
  for (const name of NOTICE_FAMILIES[family]) {
    const type = USER_MESSAGE_TYPE[name];
    let n = 0;
    for (const m of group.members) if (m.type === type) n++;
    if (n > 0) parts.push(formatMessage(pluralForm(n, copy.groupParts[name], localeTag), { count: n }));
  }
  return parts.join(' · ');
}

/** Whether a stack's members read different card lines, so each row names its own; a line that
 *  differs only by the subject's sex is the same line. */
export function groupMixesLines(group: NoticeGroup): boolean {
  const [lead] = group.members;
  if (lead === undefined) return false;
  const line = lineKey(lead);
  return group.members.some((m) => lineKey(m) !== line);
}
