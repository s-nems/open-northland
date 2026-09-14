import type { WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { isNoteOver, LOST_NOTE_HOLD_TICKS } from '../src/hud/tool-panel/messages/retire.js';
import {
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';

const RAISED = 100;
const HELD = RAISED + LOST_NOTE_HOLD_TICKS - 1;
const RELEASED = RAISED + LOST_NOTE_HOLD_TICKS;
const SETTLER = 7;

function world(tick: number, settler: 'lost' | 'found' | 'gone'): WorldSnapshot {
  if (settler === 'gone') return { tick, events: [], entities: [] };
  const components = settler === 'lost' ? { LostWay: { cutOff: false } } : {};
  return { tick, events: [], entities: [{ id: SETTLER, components }] };
}

function note(
  type: UserMessageType,
  subject: UserMessage['subject'] = { kind: 'settler', entity: SETTLER },
): UserMessage {
  return {
    id: 1,
    type,
    subject,
    at: null,
    about: null,
    goodType: null,
    jobType: null,
    priority: 2,
    tick: RAISED,
    text: 'x',
  };
}

describe('note retirement', () => {
  it('ends any note whose subject left the world, and none without a subject', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), world(RELEASED, 'gone'))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.lostWithoutSignposts), world(RELEASED, 'gone'))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.humanDied, null), world(RELEASED, 'gone'))).toBe(false);
  });

  it('leaves an event note to its lifetime whether or not its settler is lost', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), world(RELEASED, 'found'))).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), world(RELEASED, 'lost'))).toBe(false);
  });

  it('keeps a lost note while the sim keeps the settler marked lost', () => {
    const lost = note(USER_MESSAGE_TYPE.lostWithoutSignposts);
    expect(isNoteOver(lost, world(RELEASED, 'lost'))).toBe(false);
    expect(isNoteOver(lost, world(RELEASED + 10_000, 'lost'))).toBe(false);
  });

  it('ends a lost note once the marker comes off, but not inside the hold', () => {
    const lost = note(USER_MESSAGE_TYPE.lostWithoutSignposts);
    expect(isNoteOver(lost, world(HELD, 'found'))).toBe(false);
    expect(isNoteOver(lost, world(RELEASED, 'found'))).toBe(true);
  });
});
