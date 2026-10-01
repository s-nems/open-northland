import { type PendingMessage, USER_MESSAGE_TYPE, type UserMessageType } from './types.js';

/** The emblems a card without a live settler shows on its thumbnail; each has a line glyph fallback. */
export type NoticeGlyph = 'house' | 'swords' | 'skull' | 'shield' | 'banner' | 'chest' | 'scroll';

/** What a card's thumbnail shows: the subject settler or vehicle drawn as on the map, a building type's
 *  body as the construction window pictures it (the subject's, or the one an unlock opens), or a glyph.
 *  A dim glyph marks a subject that is gone; a glyph about another seat names it, so the card can paint
 *  the glyph in that seat's colour. */
export type NoticeThumb =
  | { readonly kind: 'settler'; readonly entity: number }
  | { readonly kind: 'vehicle'; readonly entity: number }
  | { readonly kind: 'building'; readonly typeId: number }
  | {
      readonly kind: 'glyph';
      readonly glyph: NoticeGlyph;
      readonly dim: boolean;
      readonly seat: number | null;
    };

const GLYPH_BY_TYPE: ReadonlyMap<UserMessageType, NoticeGlyph> = new Map<UserMessageType, NoticeGlyph>([
  [USER_MESSAGE_TYPE.houseFinished, 'house'],
  [USER_MESSAGE_TYPE.houseUpgraded, 'house'],
  [USER_MESSAGE_TYPE.productionStalled, 'house'],
  [USER_MESSAGE_TYPE.settlementAttacked, 'swords'],
  [USER_MESSAGE_TYPE.peopleAttacked, 'swords'],
  [USER_MESSAGE_TYPE.humanDied, 'skull'],
  [USER_MESSAGE_TYPE.playerDied, 'skull'],
  [USER_MESSAGE_TYPE.playerSighted, 'shield'],
  [USER_MESSAGE_TYPE.diplomacyChanged, 'banner'],
  [USER_MESSAGE_TYPE.specialItemFound, 'chest'],
]);

const GONE_GLYPH: NoticeGlyph = 'skull';

/** The rows whose `about` is a seat number rather than a reaped settler's id. */
const SEAT_ROWS: ReadonlySet<UserMessageType> = new Set<UserMessageType>([
  USER_MESSAGE_TYPE.playerSighted,
  USER_MESSAGE_TYPE.diplomacyChanged,
  USER_MESSAGE_TYPE.playerDied,
]);

/** A note that pictures a building type (an unlock) shows its body. A settler subject is drawn, and a
 *  vehicle subject while `vehicleOnMap` finds it standing on the map (a vehicle carried on a ship has no
 *  picture of its own). A building subject that would show the house glyph shows its own body instead
 *  while `buildingTypeOf` still knows its type. An attack note's swords take its first striking seat's
 *  colour. */
export function noticeThumb(
  note: Pick<PendingMessage, 'type' | 'subject' | 'about' | 'building' | 'fight'>,
  buildingTypeOf: (entity: number) => number | undefined,
  vehicleOnMap: (entity: number) => boolean,
): NoticeThumb {
  const { type, subject } = note;
  if (note.building !== undefined) return { kind: 'building', typeId: note.building };
  if (subject?.kind === 'settler') return { kind: 'settler', entity: subject.entity };
  if (subject?.kind === 'vehicle' && vehicleOnMap(subject.entity)) {
    return { kind: 'vehicle', entity: subject.entity };
  }
  const glyph = GLYPH_BY_TYPE.get(type) ?? 'scroll';
  if (subject?.kind === 'building' && glyph === 'house') {
    const typeId = buildingTypeOf(subject.entity);
    if (typeId !== undefined) return { kind: 'building', typeId };
  }
  const seat = SEAT_ROWS.has(type) ? note.about : (note.fight?.seats[0] ?? null);
  return { kind: 'glyph', glyph, dim: glyph === GONE_GLYPH, seat };
}

/**
 * How far each card slides under the one before it so the column fits `room`: nothing while the
 * natural heights fit, else the shortfall spread evenly, capped so every card keeps `minStrip` of
 * itself showing. Past that cap the column scrolls instead.
 */
export function fanOverlap(heights: readonly number[], room: number, gap: number, minStrip: number): number {
  if (heights.length < 2) return 0;
  const natural = heights.reduce((sum, height) => sum + height + gap, 0);
  if (natural <= room) return 0;
  const cap = Math.min(...heights) - minStrip + gap;
  return Math.max(0, Math.min(cap, Math.ceil((natural - room) / (heights.length - 1))));
}

/**
 * The overlap of the cards below an open stack's rows. The cards down to the open one keep the overlap
 * `above` they had when it opened, so nothing above the pointer moves; the rows never fan; the cards
 * after them fan in the room left, the first of them clear of the rows.
 */
export function fanBelowOpen(
  heights: readonly number[],
  openIndex: number,
  rowsHeight: number,
  above: number,
  room: number,
  gap: number,
  minStrip: number,
): number {
  let used = rowsHeight + gap;
  for (let i = 0; i <= openIndex && i < heights.length; i++) {
    used += (heights[i] ?? 0) + gap - (i === 0 ? 0 : above);
  }
  return fanOverlap(heights.slice(openIndex + 1), room - used, gap, minStrip);
}
