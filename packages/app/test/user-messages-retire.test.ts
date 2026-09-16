import { ONE, systems, type WorldSnapshot } from '@open-northland/sim';
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

function needsWorld(
  needs: { hunger?: number; fatigue?: number; piety?: number },
  enabled = true,
): WorldSnapshot {
  return {
    tick: RELEASED,
    events: [],
    entities: [
      {
        id: SETTLER,
        components: {
          Settler: {
            tribe: 1,
            jobType: 1,
            hunger: needs.hunger ?? 0,
            fatigue: needs.fatigue ?? 0,
            piety: needs.piety ?? 0,
            enjoyment: 0,
            experience: { $map: [] },
          },
        },
      },
      ...(enabled ? [] : [{ id: 8, components: { WorldRules: { needsEnabled: false } } }]),
    ],
  };
}

function idleWorld(
  state: 'idle-at-workplace' | 'idle-without-workplace' | 'walking' | 'working' | 'has-flag',
): WorldSnapshot {
  const workplace = state === 'idle-at-workplace' ? 8 : undefined;
  return {
    tick: RELEASED,
    events: [],
    entities: [
      {
        id: SETTLER,
        components: {
          ...(workplace === undefined ? {} : { JobAssignment: { workplace } }),
          ...(state === 'walking' ? { MoveGoal: { cell: 12 } } : {}),
          ...(state === 'working'
            ? { CurrentAtomic: { atomicId: 1, effect: { kind: 'produce', recipeOutput: 3 } } }
            : {}),
          ...(state === 'has-flag' ? { WorkFlag: { flag: 9 } } : {}),
        },
      },
      ...(workplace === undefined ? [] : [{ id: workplace, components: {} }]),
    ],
  };
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
    technologies: null,
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
    expect(isNoteOver(note(USER_MESSAGE_TYPE.grewUp), world(RELEASED, 'lost'))).toBe(false);
  });

  it('ends hunger notes as soon as eating answers their condition', () => {
    expect(
      isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: systems.NEED_CRITICAL_THRESHOLD - 1 })),
    ).toBe(true);
    expect(
      isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: systems.NEED_CRITICAL_THRESHOLD })),
    ).toBe(false);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.starving), needsWorld({ hunger: ONE - 1 }))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.starving), needsWorld({ hunger: ONE }))).toBe(false);
  });

  it('ends tired and prayer notes when the corresponding need is answered', () => {
    const answered = systems.NEED_CRITICAL_THRESHOLD - 1;
    expect(isNoteOver(note(USER_MESSAGE_TYPE.tired), needsWorld({ fatigue: answered }))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.wantsToPray), needsWorld({ piety: answered }))).toBe(true);
  });

  it('ends need notes when needs are disabled or the settler no longer carries them', () => {
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), needsWorld({ hunger: ONE }, false))).toBe(true);
    expect(isNoteOver(note(USER_MESSAGE_TYPE.hungry), world(RELEASED, 'found'))).toBe(true);
  });

  it('ends nothing-to-do when the settler starts an activity or no longer has that workplace', () => {
    const idle = note(USER_MESSAGE_TYPE.nothingToDo);
    expect(isNoteOver(idle, idleWorld('idle-at-workplace'))).toBe(false);
    expect(isNoteOver(idle, idleWorld('walking'))).toBe(true);
    expect(isNoteOver(idle, idleWorld('working'))).toBe(true);
    expect(isNoteOver(idle, idleWorld('idle-without-workplace'))).toBe(true);
  });

  it('ends workplace-not-found when the settler acts or receives a workplace substitute', () => {
    const missing = note(USER_MESSAGE_TYPE.workplaceNotFound);
    expect(isNoteOver(missing, idleWorld('idle-without-workplace'))).toBe(false);
    expect(isNoteOver(missing, idleWorld('walking'))).toBe(true);
    expect(isNoteOver(missing, idleWorld('working'))).toBe(true);
    expect(isNoteOver(missing, idleWorld('idle-at-workplace'))).toBe(true);
    expect(isNoteOver(missing, idleWorld('has-flag'))).toBe(true);
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
