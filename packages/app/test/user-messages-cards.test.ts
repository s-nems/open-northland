import { describe, expect, it } from 'vitest';
import { fanOverlap, noticeFullText, noticeThumb, orderNotes } from '../src/hud/tool-panel/messages/cards.js';
import {
  type MessagePriorityLevel,
  type MessageSubject,
  USER_MESSAGE_TYPE,
  type UserMessage,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';
import { messages } from '../src/i18n/index.js';

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
const onMap = (): boolean => true;

function raised(type: UserMessageType, subject: MessageSubject | null, about: number | null = null) {
  return { type, subject, about };
}

function fightNote(type: UserMessageType, seats: readonly number[]) {
  const fight = {
    buildings: 1,
    walls: 0,
    settlers: 0,
    vehicles: 0,
    seats,
    wild: seats.length === 0,
    lastHitTick: 0,
  };
  return { ...raised(type, null, 4), fight };
}

describe('notice cards', () => {
  it('orders the weightiest first and the newest within a weight', () => {
    const ordered = orderNotes([note(1, 0, 10), note(2, 2, 5), note(3, 1, 20), note(4, 2, 9), note(5, 2, 9)]);
    // Two notes raised on one tick keep arrival order reversed, so the later id stands first.
    expect(ordered.map((m) => m.id)).toEqual([5, 4, 2, 3, 1]);
  });

  it('draws a live settler subject', () => {
    const settler = { kind: 'settler', entity: 7 } as const;
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.hungry, settler), noBuilding, onMap)).toEqual({
      kind: 'settler',
      entity: 7,
    });
  });

  it("shows a fight's swords in its first striking seat's colour, untinted for wild beasts", () => {
    const ENEMY_SEAT = 2;
    expect(
      noticeThumb(fightNote(USER_MESSAGE_TYPE.settlementAttacked, [ENEMY_SEAT, 3]), noBuilding, onMap),
    ).toEqual({ kind: 'glyph', glyph: 'swords', dim: false, seat: ENEMY_SEAT });
    expect(noticeThumb(fightNote(USER_MESSAGE_TYPE.peopleAttacked, []), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'swords',
      dim: false,
      seat: null,
    });
  });

  it('draws a live vehicle subject', () => {
    const vehicle = { kind: 'vehicle', entity: 9 } as const;
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.vehicleNoCarrier, vehicle), noBuilding, onMap)).toEqual({
      kind: 'vehicle',
      entity: 9,
    });
    // A vehicle carried on a ship draws nothing of its own, so its card keeps the scroll.
    expect(
      noticeThumb(raised(USER_MESSAGE_TYPE.cannotLeaveVehicle, vehicle), noBuilding, () => false),
    ).toEqual({
      kind: 'glyph',
      glyph: 'scroll',
      dim: false,
      seat: null,
    });
  });

  it('pictures a finished or upgraded building by its body while its type is known, else the house glyph', () => {
    const building = { kind: 'building', entity: 3 } as const;
    const typeOf = (entity: number): number | undefined => (entity === 3 ? 27 : undefined);
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.houseFinished, building), typeOf, onMap)).toEqual({
      kind: 'building',
      typeId: 27,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.houseUpgraded, building), typeOf, onMap)).toEqual({
      kind: 'building',
      typeId: 27,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.houseFinished, building), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'house',
      dim: false,
      seat: null,
    });
  });

  it('pictures the building an unlock opens in place of the settler who earned it', () => {
    const settler = { kind: 'settler', entity: 7 } as const;
    const POTTERY = 20;
    const unlock = { ...raised(USER_MESSAGE_TYPE.experienceUnlocks, settler), building: POTTERY };
    expect(noticeThumb(unlock, noBuilding, onMap)).toEqual({ kind: 'building', typeId: POTTERY });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.experienceUnlocks, settler), noBuilding, onMap)).toEqual({
      kind: 'settler',
      entity: 7,
    });
  });

  it('shows a glyph for a subjectless row, dim for a death', () => {
    // A death's `about` is the reaped settler's id, never a seat to paint the skull with.
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.humanDied, null, 41), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'skull',
      dim: true,
      seat: null,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.specialItemFound, null), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'chest',
      dim: false,
      seat: null,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.experienceUnlocks, null), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'scroll',
      dim: false,
      seat: null,
    });
  });

  it('names the seat a seat row is about, so its glyph takes that colour', () => {
    const SEAT = 3;
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.playerSighted, null, SEAT), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'shield',
      dim: false,
      seat: SEAT,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.diplomacyChanged, null, SEAT), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'banner',
      dim: false,
      seat: SEAT,
    });
    expect(noticeThumb(raised(USER_MESSAGE_TYPE.playerDied, null, SEAT), noBuilding, onMap)).toEqual({
      kind: 'glyph',
      glyph: 'skull',
      dim: true,
      seat: SEAT,
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

it('links an idle notification to the current diagnosis without changing other messages', () => {
  const subject = { kind: 'settler', entity: 7 } as const;
  const text = { short: 'Bjorn', full: 'Bjorn nie ma zajęcia.' };
  expect(noticeFullText({ type: USER_MESSAGE_TYPE.nothingToDo, subject, text })).toBe(
    `${text.full} ${messages().hud.notices.idleReasonHint}`,
  );
  expect(noticeFullText({ type: USER_MESSAGE_TYPE.hungry, subject, text })).toBe(text.full);
  expect(noticeFullText({ type: USER_MESSAGE_TYPE.nothingToDo, subject: null, text })).toBe(text.full);
});
