import { describe, expect, it } from 'vitest';
import { fanOverlap, noticeThumb, orderNotes } from '../src/hud/tool-panel/messages/cards.js';
import {
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessage,
} from '../src/hud/tool-panel/messages/types.js';

function note(id: number, priority: MessagePriorityLevel, tick: number): UserMessage {
  return {
    id,
    priority,
    tick,
    type: USER_MESSAGE_TYPE.hungry,
    subject: null,
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
    text: { short: '', full: '' },
  };
}

const noBuilding = (): number | undefined => undefined;

describe('notice cards', () => {
  it('orders the weightiest first and the newest within a weight', () => {
    const ordered = orderNotes([note(1, 0, 10), note(2, 2, 5), note(3, 1, 20), note(4, 2, 9), note(5, 2, 9)]);
    // Two notes raised on one tick keep arrival order reversed, so the later id stands first.
    expect(ordered.map((m) => m.id)).toEqual([5, 4, 2, 3, 1]);
  });

  it('draws a live settler subject and swaps in the swords for an attacked one', () => {
    const settler = { kind: 'settler', entity: 7 } as const;
    expect(noticeThumb(USER_MESSAGE_TYPE.hungry, settler, noBuilding)).toEqual({
      kind: 'settler',
      entity: 7,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.humanAttacked, settler, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'swords',
      dim: false,
    });
  });

  it('pictures a finished or upgraded building by its body while its type is known, else the house glyph', () => {
    const building = { kind: 'building', entity: 3 } as const;
    const typeOf = (entity: number): number | undefined => (entity === 3 ? 27 : undefined);
    expect(noticeThumb(USER_MESSAGE_TYPE.houseFinished, building, typeOf)).toEqual({
      kind: 'building',
      typeId: 27,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.houseUpgraded, building, typeOf)).toEqual({
      kind: 'building',
      typeId: 27,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.houseFinished, building, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'house',
      dim: false,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.houseAttacked, building, typeOf)).toEqual({
      kind: 'glyph',
      glyph: 'swords',
      dim: false,
    });
  });

  it('shows a glyph for a subjectless row, dim for a death', () => {
    expect(noticeThumb(USER_MESSAGE_TYPE.humanDied, null, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'skull',
      dim: true,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.playerSighted, null, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'banner',
      dim: false,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.specialItemFound, null, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'chest',
      dim: false,
    });
    expect(noticeThumb(USER_MESSAGE_TYPE.experienceUnlocks, null, noBuilding)).toEqual({
      kind: 'glyph',
      glyph: 'scroll',
      dim: false,
    });
  });

  it('fans only when the cards do not fit, spreads the shortfall and keeps the minimum strip', () => {
    // Four 68 px cards with 7 px gaps need 300 px.
    expect(fanOverlap([68, 68, 68, 68], 300, 7, 32)).toBe(0);
    expect(fanOverlap([68], 10, 7, 32)).toBe(0);
    // 60 px short over three seams: 20 px each.
    expect(fanOverlap([68, 68, 68, 68], 240, 7, 32)).toBe(20);
    // The cap: a card may lose no more than its height minus the strip, plus the gap it no longer needs.
    expect(fanOverlap([68, 68, 68, 68], 100, 7, 32)).toBe(43);
    expect(fanOverlap([68, 40, 68], 100, 7, 32)).toBe(15);
  });
});
