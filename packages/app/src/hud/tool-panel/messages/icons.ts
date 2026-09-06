import type { GuiFrameName } from '../../../content/gui-atlas-map.js';
import {
  type MessagePriorityLevel,
  type MessageSubject,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from './types.js';

/** The pinned parchment behind a note: the pin's colour is the priority. */
export const NOTE_BACKDROP: Readonly<Record<MessagePriorityLevel, GuiFrameName>> = {
  0: 'message_note_low',
  1: 'message_note_medium',
  2: 'message_note_high',
};

/** What a note shows on its parchment: the subject settler drawn standing, or a stone token. */
export type NoteIcon =
  | { readonly kind: 'portrait' }
  | { readonly kind: 'frame'; readonly name: GuiFrameName };

const TOKEN_BY_TYPE: ReadonlyMap<UserMessageType, GuiFrameName> = new Map<UserMessageType, GuiFrameName>([
  [USER_MESSAGE_TYPE.houseFinished, 'message_icon_house'],
  [USER_MESSAGE_TYPE.houseUpgraded, 'message_icon_house'],
  [USER_MESSAGE_TYPE.houseAttacked, 'message_icon_swords'],
  [USER_MESSAGE_TYPE.humanDied, 'message_icon_skull'],
  [USER_MESSAGE_TYPE.playerDied, 'message_icon_skull'],
  [USER_MESSAGE_TYPE.playerSighted, 'message_icon_handshake'],
  [USER_MESSAGE_TYPE.diplomacyChanged, 'message_icon_handshake'],
  [USER_MESSAGE_TYPE.specialItemFound, 'message_icon_chest'],
]);

/** An attacked settler shows the swords rather than its portrait. */
export function noteIcon(type: UserMessageType, subject: MessageSubject | null): NoteIcon | null {
  if (subject?.kind === 'settler') {
    return type === USER_MESSAGE_TYPE.humanAttacked
      ? { kind: 'frame', name: 'message_icon_swords' }
      : { kind: 'portrait' };
  }
  const token = TOKEN_BY_TYPE.get(type);
  return token === undefined ? null : { kind: 'frame', name: token };
}
