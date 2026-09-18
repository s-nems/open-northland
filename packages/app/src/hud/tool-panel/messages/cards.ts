import { type MessageSubject, USER_MESSAGE_TYPE, type UserMessage, type UserMessageType } from './types.js';

/** The column's order: the weightiest first, then the newest within a weight. */
export function orderNotes(notes: readonly UserMessage[]): UserMessage[] {
  return [...notes].sort((a, b) => b.priority - a.priority || b.tick - a.tick || b.id - a.id);
}

/** The line glyphs a card without a live settler shows on its thumbnail. */
export type NoticeGlyph = 'house' | 'swords' | 'skull' | 'banner' | 'chest' | 'scroll';

/** What a card's thumbnail shows: the subject settler drawn as on the map, the subject building's body
 *  as the construction window pictures it, or a glyph. A dim glyph marks a subject that is gone. */
export type NoticeThumb =
  | { readonly kind: 'settler'; readonly entity: number }
  | { readonly kind: 'building'; readonly typeId: number }
  | { readonly kind: 'glyph'; readonly glyph: NoticeGlyph; readonly dim: boolean };

const GLYPH_BY_TYPE: ReadonlyMap<UserMessageType, NoticeGlyph> = new Map<UserMessageType, NoticeGlyph>([
  [USER_MESSAGE_TYPE.houseFinished, 'house'],
  [USER_MESSAGE_TYPE.houseUpgraded, 'house'],
  [USER_MESSAGE_TYPE.houseAttacked, 'swords'],
  [USER_MESSAGE_TYPE.humanDied, 'skull'],
  [USER_MESSAGE_TYPE.playerDied, 'skull'],
  [USER_MESSAGE_TYPE.playerSighted, 'banner'],
  [USER_MESSAGE_TYPE.diplomacyChanged, 'banner'],
  [USER_MESSAGE_TYPE.specialItemFound, 'chest'],
]);

const GONE_GLYPH: NoticeGlyph = 'skull';

/** An attacked settler shows the swords rather than its figure; any other settler subject is drawn. A
 *  building subject that would show the house glyph shows its own body instead while `buildingTypeOf`
 *  still knows its type. */
export function noticeThumb(
  type: UserMessageType,
  subject: MessageSubject | null,
  buildingTypeOf: (entity: number) => number | undefined,
): NoticeThumb {
  if (subject?.kind === 'settler' && type !== USER_MESSAGE_TYPE.humanAttacked) {
    return { kind: 'settler', entity: subject.entity };
  }
  const glyph = GLYPH_BY_TYPE.get(type) ?? (subject?.kind === 'settler' ? 'swords' : 'scroll');
  if (subject?.kind === 'building' && glyph === 'house') {
    const typeId = buildingTypeOf(subject.entity);
    if (typeId !== undefined) return { kind: 'building', typeId };
  }
  return { kind: 'glyph', glyph, dim: glyph === GONE_GLYPH };
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
