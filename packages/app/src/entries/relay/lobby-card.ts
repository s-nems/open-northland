import type { RoomView } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';
import { el, PANEL_STYLE } from '../../view/overlay.js';

export interface LobbyCard {
  connecting(url: string): void;
  /** `players` is the creator's target; a joiner shows the room without one. */
  room(view: RoomView, players: number | null): void;
  /** A line under the room, such as a refusal the lobby walk retries past. */
  note(text: string | null): void;
  dismiss(): void;
}

/** The card the developer entry shows before the world boots: the connection, then the room's state. */
export function mountLobbyCard(): LobbyCard {
  const panel = el('div', `${PANEL_STYLE};top:50%;left:50%;right:auto;transform:translate(-50%,-50%)`);
  panel.setAttribute('role', 'status');
  const title = el('div', 'font-weight:700;font-size:14px;margin-bottom:6px');
  const detail = el('div', 'opacity:0.85;white-space:pre-line');
  const noteLine = el('div', 'margin-top:6px;color:#f0c070');
  panel.append(title, detail, noteLine);
  document.body.append(panel);
  return {
    connecting(url): void {
      title.textContent = formatMessage(messages().net.connecting, { url });
      detail.textContent = '';
    },
    room(view, players): void {
      const copy = messages().net;
      title.textContent = formatMessage(copy.roomTitle, { id: view.id });
      const seated = view.members.map(
        (member) => `${member.nick}${member.seat === null ? '' : ` (${member.seat})`}`,
      );
      detail.textContent = [
        players === null
          ? formatMessage(copy.roomMembers, { count: view.members.length })
          : formatMessage(copy.roomWaiting, { count: view.members.length, players }),
        seated.join(', '),
        formatMessage(copy.roomJoinHint, { id: view.id }),
      ].join('\n');
    },
    note(text): void {
      noteLine.textContent = text ?? '';
    },
    dismiss: () => panel.remove(),
  };
}
