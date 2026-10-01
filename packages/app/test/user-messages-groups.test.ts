import { describe, expect, it } from 'vitest';
import { createMessageFeed } from '../src/hud/tool-panel/messages/feed.js';
import {
  compareLead,
  groupBreakdown,
  groupMixesLines,
  groupNotes,
  noticeGroupKey,
  SEX_ONLY_LINE_TYPES,
} from '../src/hud/tool-panel/messages/groups.js';
import { messagePriority } from '../src/hud/tool-panel/messages/priority.js';
import { type MessageText, userMessageTypeName } from '../src/hud/tool-panel/messages/text.js';
import {
  type MessagePriorityLevel,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';
import { en } from '../src/i18n/en.js';
import { messages } from '../src/i18n/index.js';
import { pl } from '../src/i18n/pl.js';

const { hungry, starving, willDie, nothingToDo, workplaceNotFound, tired, houseFinished } = USER_MESSAGE_TYPE;
const TICK = 100;
const IMPORTANT: MessagePriorityLevel = 2;

function note(
  id: number,
  type: UserMessageType,
  tick: number,
  short = 'x',
  priority: MessagePriorityLevel = messagePriority(type),
): UserMessage {
  return {
    id,
    type,
    priority,
    tick,
    subject: { kind: 'settler', entity: id },
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
    text: { short, full: `${short} ${id}` },
  };
}

function pending(type: UserMessageType, entity: number): PendingMessage {
  return {
    type,
    subject: { kind: 'settler', entity },
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
  };
}

const TEXT = (short: string) => (): MessageText => ({ short, full: short });
const ids = (members: readonly UserMessage[]): number[] => members.map((m) => m.id);

describe('notice groups', () => {
  it('stacks a topic family across its types and every other type by its card line', () => {
    expect(noticeGroupKey(note(1, hungry, TICK))).toBe(noticeGroupKey(note(2, willDie, TICK)));
    expect(noticeGroupKey(note(1, nothingToDo, TICK))).toBe(noticeGroupKey(note(2, workplaceNotFound, TICK)));
    expect(noticeGroupKey(note(1, hungry, TICK))).not.toBe(noticeGroupKey(note(2, nothingToDo, TICK)));
    // A good or a stance on the card line makes its own stack.
    const learned = USER_MESSAGE_TYPE.canProduceNewGood;
    expect(noticeGroupKey(note(1, learned, TICK, 'Umie: chleb'))).not.toBe(
      noticeGroupKey(note(2, learned, TICK, 'Umie: miód')),
    );
    expect(noticeGroupKey(note(1, tired, TICK, 'x'))).not.toBe(
      noticeGroupKey(note(2, houseFinished, TICK, 'x')),
    );
  });

  it('keeps a line that only agrees with the settler’s sex in one stack', () => {
    const lost = USER_MESSAGE_TYPE.lostWithoutSignposts;
    const line = messages().userMessages.short.lostWithoutSignposts;
    const [he, she] = typeof line === 'string' ? [line, line] : [line.he, line.she];
    expect(he).not.toBe(she);
    expect(noticeGroupKey(note(1, lost, TICK, he))).toBe(noticeGroupKey(note(2, lost, TICK, she)));
  });

  it('lists only types whose card line varies by sex in either catalog', () => {
    for (const catalog of [pl, en]) {
      const short: Readonly<Record<string, unknown>> = catalog.userMessages.short;
      for (const type of SEX_ONLY_LINE_TYPES) {
        expect(typeof short[userMessageTypeName(type)], userMessageTypeName(type)).toBe('object');
      }
    }
  });

  it('stacks grown men and grown women apart in either catalog', () => {
    const grewUp = USER_MESSAGE_TYPE.grewUp;
    for (const catalog of [pl, en]) {
      // The note carries no sex, so the card line alone keeps the two stacks apart.
      const { he, she } = catalog.userMessages.short.grewUp;
      expect(he).not.toBe(she);
      const stacks = groupNotes([note(1, grewUp, 1, he), note(2, grewUp, 2, she), note(3, grewUp, 3, he)]);
      expect(stacks.map((s) => ids(s.members))).toEqual([[3, 1], [2]]);
    }
  });

  it('never stacks unlock notes', () => {
    const unlocks = USER_MESSAGE_TYPE.experienceUnlocks;
    const stacks = groupNotes([note(1, unlocks, 1, 'Nowa wiedza'), note(2, unlocks, 2, 'Nowa wiedza')]);
    expect(stacks.map((s) => ids(s.members))).toEqual([[2], [1]]);
  });

  it('reads he and she lines of one type as the same line, so their rows name no detail', () => {
    const lost = USER_MESSAGE_TYPE.lostWithoutSignposts;
    const [stack] = groupNotes([note(1, lost, 1, 'Zgubił się'), note(2, lost, 2, 'Zgubiła się')]);
    if (stack === undefined) throw new Error('no stack');
    expect(stack.members).toHaveLength(2);
    expect(groupMixesLines(stack)).toBe(false);
  });

  it('leads with the heaviest, then the longest-standing state note or the newest event note', () => {
    const states = [note(1, hungry, 10), note(2, starving, 30), note(3, starving, 20), note(4, hungry, 5)];
    expect(ids([...states].sort(compareLead))).toEqual([3, 2, 4, 1]);
    // Dying and starving weigh alike; the heavier stage of the family leads.
    expect(ids([note(5, starving, 1), note(6, willDie, 9)].sort(compareLead))).toEqual([6, 5]);
    const events = [note(5, houseFinished, 10), note(6, houseFinished, 30), note(7, houseFinished, 20)];
    expect(ids([...events].sort(compareLead))).toEqual([6, 7, 5]);
  });

  it('orders stacks by weight, then by their newest member, so a new member lifts its stack', () => {
    const notes = [
      note(1, tired, 50),
      note(2, tired, 10),
      note(3, nothingToDo, 40),
      note(4, hungry, 20),
      note(5, willDie, 5),
    ];
    const groups = groupNotes(notes);
    // The hunger family weighs as its dying member and leads; the tired stack's newest (50) beats idle's.
    expect(groups.map((g) => [g.key, ids(g.members)])).toEqual([
      ['family:hunger', [5, 4]],
      [noticeGroupKey(notes[0] as UserMessage), [2, 1]],
      ['family:idle', [3]],
    ]);
    const lifted = groupNotes([...notes, note(6, nothingToDo, 60)]);
    expect(lifted.map((g) => g.key)).toEqual([
      'family:hunger',
      'family:idle',
      noticeGroupKey(notes[0] as UserMessage),
    ]);
  });

  it('orders lone notes as the column always did: the weightiest, then the newest', () => {
    const lone = [
      note(1, tired, 10, 'a'),
      note(2, houseFinished, 5, 'b', IMPORTANT),
      note(3, tired, 20, 'c', 1),
      note(4, houseFinished, 9, 'd', IMPORTANT),
      note(5, houseFinished, 9, 'e', IMPORTANT),
    ];
    expect(groupNotes(lone).map((g) => g.members[0]?.id)).toEqual([5, 4, 2, 3, 1]);
  });

  it('names a family’s members per type with Polish and English plurals', () => {
    const [family] = groupNotes([
      note(1, willDie, 1, 'Umiera'),
      ...[2, 3, 4].map((id) => note(id, starving, id, 'Głoduje')),
      ...[5, 6, 7, 8, 9].map((id) => note(id, hungry, id, 'Głód')),
    ]);
    if (family === undefined) throw new Error('no family');
    expect(groupBreakdown(family, pl.hud.notices, 'pl')).toBe('1 umiera · 3 głodują · 5 chce jeść');
    expect(groupBreakdown(family, en.hud.notices, 'en')).toBe('1 dying · 3 starving · 5 hungry');
    const [tiredStack] = groupNotes([note(1, tired, 1), note(2, tired, 2)]);
    if (tiredStack === undefined) throw new Error('no stack');
    expect(groupBreakdown(tiredStack, pl.hud.notices, 'pl')).toBe('2 powiadomienia');
    expect(groupMixesLines(family)).toBe(true);
    expect(groupMixesLines(tiredStack)).toBe(false);
  });

  it('groups only the shown notes, so a filter leaves a family its urgent members', () => {
    const feed = createMessageFeed();
    feed.add(pending(hungry, 1), TICK, TEXT('Głód'));
    feed.add(pending(hungry, 2), TICK, TEXT('Głód'));
    feed.add(pending(starving, 3), TICK, TEXT('Głoduje'));
    feed.add(pending(willDie, 4), TICK, TEXT('Umiera'));
    expect(groupNotes(feed.displayed()).map((g) => g.members.length)).toEqual([4]);
    feed.setLevel(IMPORTANT);
    const [urgent] = groupNotes(feed.displayed());
    expect(urgent?.members.map((m) => m.type)).toEqual([willDie, starving]);
    // The seals still count every note, not the cards.
    expect(feed.tally()).toEqual([2, 0, 2]);
  });

  it('drops a retired member from its stack and hands the face to the next lead', () => {
    const feed = createMessageFeed();
    feed.add(pending(willDie, 1), TICK, TEXT('Umiera'));
    feed.add(pending(starving, 2), TICK, TEXT('Głoduje'));
    feed.add(pending(hungry, 3), TICK, TEXT('Głód'));
    feed.expire(TICK + 1, (m) => m.type === willDie);
    const [after] = groupNotes(feed.displayed());
    expect(after?.members[0]?.type).toBe(starving);
    expect(after?.members).toHaveLength(2);
    feed.expire(TICK + 2, (m) => m.type === starving);
    expect(groupNotes(feed.displayed()).map((g) => g.members.length)).toEqual([1]);
  });

  it('dismisses a stack member by member, each held while its own cause lasts', () => {
    const feed = createMessageFeed();
    for (const entity of [1, 2, 3]) feed.add(pending(hungry, entity), TICK, TEXT('Głód'));
    const before = feed.version();
    const [stack] = groupNotes(feed.displayed());
    expect(feed.removeMany(new Set(ids(stack?.members ?? [])), TICK + 1)).toBe(true);
    expect(feed.version()).toBe(before + 1);
    expect(feed.displayed()).toHaveLength(0);
    expect(feed.state().history).toHaveLength(3);
    // Each dismissed member stays away; a settler newly hungry starts a new card.
    expect(feed.add(pending(hungry, 2), TICK + 2, TEXT('Głód'))).toBe('duplicate');
    expect(feed.add(pending(hungry, 4), TICK + 2, TEXT('Głód'))).toBe('accepted');
    // One member's cause ending frees only that member.
    feed.expire(TICK + 3, (m) => m.subject?.entity === 1);
    expect(feed.add(pending(hungry, 1), TICK + 4, TEXT('Głód'))).toBe('accepted');
    expect(feed.add(pending(hungry, 3), TICK + 4, TEXT('Głód'))).toBe('duplicate');
  });

  it('dismisses one member of a stack and leaves the rest standing', () => {
    const feed = createMessageFeed();
    for (const entity of [1, 2, 3]) feed.add(pending(tired, entity), TICK, TEXT('Zmęczenie'));
    feed.remove(2, TICK + 1);
    expect(groupNotes(feed.displayed()).map((g) => ids(g.members))).toEqual([[1, 3]]);
    expect(feed.removeMany(new Set([99]), TICK + 1)).toBe(false);
  });
});
