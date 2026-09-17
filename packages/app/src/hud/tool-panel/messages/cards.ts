import { type PendingMessage, USER_MESSAGE_TYPE, type UserMessage, type UserMessageType } from './types.js';

/** The column's order: the weightiest first, then the newest within a weight. */
export function orderNotes(notes: readonly UserMessage[]): UserMessage[] {
  return [...notes].sort((a, b) => b.priority - a.priority || b.tick - a.tick || b.id - a.id);
}

/** The emblems a card without a live settler shows on its thumbnail; each has a line glyph fallback. */
export type NoticeGlyph = 'house' | 'swords' | 'skull' | 'shield' | 'banner' | 'chest' | 'scroll';

/** What a card's thumbnail shows: the subject settler drawn as on the map, the subject building's body
 *  as the construction window pictures it, or a glyph. A dim glyph marks a subject that is gone; a
 *  glyph about another seat names it, so the card can paint the glyph in that seat's colour. */
export type NoticeThumb =
  | { readonly kind: 'settler'; readonly entity: number }
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
  [USER_MESSAGE_TYPE.houseAttacked, 'swords'],
  [USER_MESSAGE_TYPE.vehicleAttacked, 'swords'],
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

/** An attacked settler shows the swords rather than its figure; any other settler subject is drawn. A
 *  building subject that would show the house glyph shows its own body instead while `buildingTypeOf`
 *  still knows its type. */
export function noticeThumb(
  note: Pick<PendingMessage, 'type' | 'subject' | 'about'>,
  buildingTypeOf: (entity: number) => number | undefined,
): NoticeThumb {
  const { type, subject } = note;
  if (subject?.kind === 'settler' && type !== USER_MESSAGE_TYPE.humanAttacked) {
    return { kind: 'settler', entity: subject.entity };
  }
  const glyph = GLYPH_BY_TYPE.get(type) ?? (subject?.kind === 'settler' ? 'swords' : 'scroll');
  if (subject?.kind === 'building' && glyph === 'house') {
    const typeId = buildingTypeOf(subject.entity);
    if (typeId !== undefined) return { kind: 'building', typeId };
  }
  return { kind: 'glyph', glyph, dim: glyph === GONE_GLYPH, seat: SEAT_ROWS.has(type) ? note.about : null };
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
