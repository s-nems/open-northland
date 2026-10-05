import { compatibilityIssues, type RoomView } from '@open-northland/net-protocol';
import { formatMessage, messages } from '../../i18n/index.js';
import { el, PANEL_STYLE } from '../../view/overlay.js';

export interface LobbyCard {
  connecting(url: string): void;
  /** `players` is the creator's target; a joiner shows the room without one. `invite` is the search
   *  that opens the next player in a new tab, null once nobody more is awaited. */
  room(view: RoomView, players: number | null, invite: string | null): void;
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
  const inviteLink = el('a', 'display:none;margin-top:8px;color:#f0c070', messages().net.openNextPlayer);
  inviteLink.target = '_blank';
  panel.append(title, detail, inviteLink, noteLine);
  document.body.append(panel);
  return {
    connecting(url): void {
      title.textContent = formatMessage(messages().net.connecting, { url });
      detail.textContent = '';
    },
    room(view, players, invite): void {
      const copy = messages().net;
      title.textContent = formatMessage(copy.roomTitle, { id: view.id });
      inviteLink.style.display = invite === null ? 'none' : 'block';
      if (invite !== null) inviteLink.href = invite;
      if (view.state !== 'lobby') {
        detail.textContent =
          view.state === 'ended' ? messages().hud.matchFinishedTitle : messages().network.starting;
        return;
      }
      const seated = view.members.map(
        (member) => `${member.nick}${member.seat === null ? '' : ` (${member.seat})`}`,
      );
      detail.textContent = [
        players === null
          ? formatMessage(copy.roomMembers, { count: view.members.length })
          : formatMessage(copy.roomWaiting, { count: view.members.length, players }),
        seated.join(', '),
        formatMessage(copy.roomJoinHint, { id: view.id }),
        ...compatibilityIssues(view.members, view.creator).map((issue) =>
          formatMessage(issue.reason === 'missing' ? copy.compatibilityMissing : copy.compatibilityMismatch, {
            nick: issue.nick,
            kind: copy.compatibilityKinds[issue.kind],
          }),
        ),
      ].join('\n');
    },
    note(text): void {
      noteLine.textContent = text ?? '';
    },
    dismiss: () => panel.remove(),
  };
}
