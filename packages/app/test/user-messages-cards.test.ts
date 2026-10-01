import { describe, expect, it } from 'vitest';
import {
  fanBelowOpen,
  fanOverlap,
  noticeFullText,
  noticeThumb,
} from '../src/hud/tool-panel/messages/cards.js';
import {
  type MessageSubject,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';
import { messages } from '../src/i18n/index.js';

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

  it('keeps the cards down to an open stack where they were and fans the ones below its rows', () => {
    // Open at index 1 with no overlap above: two cards, 100 px of rows and three gaps use 213 px of 400,
    // so the two cards below (106 px with their gaps) stay apart.
    expect(fanBelowOpen([46, 46, 46, 46], 1, 100, 0, 400, 7, 27)).toBe(0);
    // 300 px leaves 87 for the 106 they need: the one seam below takes the 19 px shortfall.
    expect(fanBelowOpen([46, 46, 46, 46], 1, 100, 0, 300, 7, 27)).toBe(19);
    // The overlap kept above frees its room for the cards below.
    expect(fanBelowOpen([46, 46, 46, 46], 1, 100, 10, 300, 7, 27)).toBe(9);
    // Past the strip cap the cards below stop folding and the list scrolls; one card below never folds.
    expect(fanBelowOpen([46, 46, 46, 46], 1, 200, 0, 300, 7, 27)).toBe(26);
    expect(fanBelowOpen([46, 46, 46], 1, 200, 0, 100, 7, 27)).toBe(0);
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
