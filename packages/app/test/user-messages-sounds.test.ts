import type { AttackReport, NoticeVoice, NotificationCue } from '@open-northland/audio';
import { describe, expect, it } from 'vitest';
import { createMessageFeed, type ShownNote, shownNote } from '../src/hud/tool-panel/messages/feed.js';
import { FIGHT_TYPE } from '../src/hud/tool-panel/messages/fight-areas.js';
import { messagePriority } from '../src/hud/tool-panel/messages/priority.js';
import {
  type NoticeSoundSink,
  noticeSoundOf,
  soundShownNote,
} from '../src/hud/tool-panel/messages/sounds.js';
import {
  type MessagePriorityLevel,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';

/** A shown note's sound: the fight notes feed the attack alert on every hit, a settler's weariness or
 *  hunger speaks once as a new card, every other new card rings the card cue. */

const TICK = 100;
const SETTLER = 7;
const AREA = 3;
const HIT = { hx: 40, hy: 30 };
const TEXT = { short: 'note', full: 'a note' };

function pending(type: UserMessageType, extra: Partial<PendingMessage> = {}): PendingMessage {
  return {
    type,
    subject: null,
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
    ...extra,
  };
}

const fight = (type: UserMessageType): PendingMessage => pending(type, { at: HIT, about: AREA });
const settlerNote = (type: UserMessageType): PendingMessage =>
  pending(type, { subject: { kind: 'settler', entity: SETTLER } });

/** A fake driver that records what the notices asked of it. */
function fakeDriver() {
  const calls: Array<
    | { readonly kind: 'alert'; readonly report: AttackReport }
    | { readonly kind: 'voice'; readonly voice: NoticeVoice; readonly settler: number }
    | { readonly kind: 'notify'; readonly notification: NotificationCue; readonly rateKey?: string }
  > = [];
  const sink: NoticeSoundSink = {
    alertAttack: (report) => calls.push({ kind: 'alert', report }),
    noticeVoice: (voice, settler) => calls.push({ kind: 'voice', voice, settler }),
    notify: (notification, rateKey) =>
      calls.push({ kind: 'notify', notification, ...(rateKey !== undefined ? { rateKey } : {}) }),
  };
  return { calls, sink };
}

/** The message centre's take: add a note, then sound it if the column shows it. */
function centre() {
  const feed = createMessageFeed();
  const driver = fakeDriver();
  const take = (note: PendingMessage): ShownNote | null => {
    const shown = shownNote(
      feed,
      note,
      feed.add(note, TICK, () => TEXT),
    );
    if (shown !== null) soundShownNote(shown, driver.sink);
    return shown;
  };
  return { feed, take, calls: driver.calls };
}

describe('notice sounds', () => {
  it('maps each note to its sound', () => {
    expect(noticeSoundOf(FIGHT_TYPE.settlement)).toEqual({ kind: 'attack', front: 'base' });
    expect(noticeSoundOf(FIGHT_TYPE.field)).toEqual({ kind: 'attack', front: 'units' });
    expect(noticeSoundOf(USER_MESSAGE_TYPE.nothingToDo)).toEqual({ kind: 'voice', voice: 'weary' });
    expect(noticeSoundOf(USER_MESSAGE_TYPE.starving)).toEqual({ kind: 'voice', voice: 'hungry' });
    expect(noticeSoundOf(USER_MESSAGE_TYPE.houseFinished)).toEqual({ kind: 'own' });
    expect(noticeSoundOf(USER_MESSAGE_TYPE.canDoNewJob)).toEqual({ kind: 'own' });
    expect(noticeSoundOf(USER_MESSAGE_TYPE.humanDied)).toEqual({ kind: 'card' });
  });

  it('feeds the attack alert on the new fight card and on every hit that revises it', () => {
    const c = centre();
    expect(c.take(fight(FIGHT_TYPE.field))?.fresh).toBe(true);
    expect(c.take(fight(FIGHT_TYPE.field))?.fresh).toBe(false);
    const alert = { kind: 'alert', report: { front: 'units', at: HIT } };
    expect(c.calls).toEqual([alert, alert]);
  });

  it('stays quiet about a fight the player dismissed or filtered out', () => {
    const dismissed = centre();
    dismissed.take(fight(FIGHT_TYPE.settlement));
    const [card] = dismissed.feed.live();
    if (card === undefined) throw new Error('no fight card');
    dismissed.feed.remove(card.id, TICK);
    expect(dismissed.take(fight(FIGHT_TYPE.settlement))).toBeNull();
    expect(dismissed.calls).toHaveLength(1);

    const filtered = centre();
    const above = (messagePriority(FIGHT_TYPE.field) + 1) as MessagePriorityLevel;
    filtered.feed.setLevel(above);
    expect(filtered.take(fight(FIGHT_TYPE.field))).toBeNull();
    expect(filtered.calls).toEqual([]);
  });

  it("speaks a new weary or hungry note in the settler's voice, once", () => {
    const c = centre();
    c.take(settlerNote(USER_MESSAGE_TYPE.nothingToDo));
    c.take(settlerNote(USER_MESSAGE_TYPE.nothingToDo));
    expect(c.calls).toEqual([{ kind: 'voice', voice: 'weary', settler: SETTLER }]);
  });

  it('rings a new card rate-keyed by its type, and nothing for a note with its own sound', () => {
    const c = centre();
    c.take(pending(USER_MESSAGE_TYPE.playerSighted, { about: 2 }));
    c.take(pending(USER_MESSAGE_TYPE.playerSighted, { about: 2 }));
    c.take(settlerNote(USER_MESSAGE_TYPE.canDoNewJob));
    expect(c.calls).toEqual([
      { kind: 'notify', notification: 'card', rateKey: String(USER_MESSAGE_TYPE.playerSighted) },
    ]);
  });
});
