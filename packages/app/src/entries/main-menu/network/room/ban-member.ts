import type { RoomView } from '@open-northland/net-protocol';
import { formatMessage } from '../../../../i18n/index.js';
import { button } from './controls.js';
import type { NetworkRoomDeps } from './types.js';

/** How long an armed kick waits for the press that confirms it. */
export const BAN_CONFIRM_MS = 4000;

/** The creator's kick for one member, in two presses: the first arms it, a second within
 *  `BAN_CONFIRM_MS` bans the member from the room. */
export function banMemberControl({ client, copy }: Pick<NetworkRoomDeps, 'client' | 'copy'>) {
  let nick: string | null = null;
  let armed: ReturnType<typeof setTimeout> | null = null;
  const control = button(copy.banMember, () => {
    if (nick === null) return;
    if (armed === null) {
      armed = setTimeout(disarm, BAN_CONFIRM_MS);
      paint();
      return;
    }
    const target = nick;
    disarm();
    client.banMember(target);
  });
  control.classList.add('network-room__ban');
  function paint(): void {
    control.textContent = armed === null ? copy.banMember : copy.banConfirm;
    control.classList.toggle('is-armed', armed !== null);
    control.setAttribute(
      'aria-label',
      armed === null ? formatMessage(copy.banMemberLabel, { nick: nick ?? '' }) : copy.banConfirm,
    );
  }
  function disarm(): void {
    if (armed !== null) clearTimeout(armed);
    armed = null;
    paint();
  }
  return {
    root: control,
    update(room: RoomView, member: string | null, interactive: boolean): void {
      const shown = room.creator === client.nick && interactive && member !== null && member !== client.nick;
      // An armed press belongs to the member it was armed for, not to whoever takes the row's seat.
      if (member !== nick || !shown) {
        nick = member;
        disarm();
      }
      control.hidden = !shown;
    },
  };
}
