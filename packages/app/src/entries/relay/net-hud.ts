import type { ClockState, RelayClientView } from '@open-northland/net-client';
import type { RoomView, ServerMessage } from '@open-northland/net-protocol';
import { diag } from '../../diag/index.js';
import type { NetPanelModel } from '../../hud/network/model.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { relayCloseText, relayReasonText } from '../../net/relay-reason.js';
import type { LinkState } from '../../session/worker/net-protocol.js';
import { clockAnnouncement } from '../../view/net/session-clock.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { createRelayPanelFeed } from './net-panel-feed.js';

export interface NetHudDeps {
  readonly client: RelayClientView;
  readonly readout: () => NetReadout;
  /** The relay this client is linked to, which the panel names. */
  readonly relayUrl: string | null;
}

export interface NetHud {
  /** The network panel's model: the window, the banners, the chat log and the speed segments read it.
   *  The same object while nothing in it changed. */
  model(): NetPanelModel;
  /** Every relay message after the client acted on it. */
  observe(message: ServerMessage): void;
  link(state: LinkState, reason?: string): void;
}

/** A relayed game's side of the network panel: the model it reads, the chat with the session's
 *  announcements, and the notice about this client's own link or world. */
export function mountNetHud(deps: NetHudDeps): NetHud {
  const { client } = deps;
  const copy = messages().net;
  const feed = createRelayPanelFeed({ client, readout: deps.readout, relayUrl: deps.relayUrl });
  let previousRoom: RoomView | null = client.room;
  let previousClock: ClockState | null = client.clockState;
  let linkNotice: string | null = null;
  let worldNotice: string | null = null;

  const announce = (text: string): void => feed.announce(text);
  const refreshNotice = (): void => feed.notice(linkNotice ?? worldNotice);
  const announceRoom = (room: RoomView): void => {
    const before = new Map(previousRoom?.members.map((member) => [member.nick, member.connected]) ?? []);
    for (const member of room.members) {
      const was = before.get(member.nick);
      if (was === undefined) {
        if (previousRoom !== null) announce(formatMessage(copy.memberJoined, { nick: member.nick }));
      } else if (was !== member.connected) {
        announce(
          formatMessage(member.connected ? copy.memberReturned : copy.memberDropped, { nick: member.nick }),
        );
      }
    }
    previousRoom = room;
  };

  return {
    model: feed.model,
    observe(message): void {
      feed.observe(message);
      switch (message.kind) {
        case 'room':
          announceRoom(message.room);
          return;
        case 'kicked':
          announce(formatMessage(copy.departed[message.cause][message.mode], { nick: message.nick }));
          return;
        case 'clock': {
          const line = clockAnnouncement(previousClock, message);
          if (line !== null) announce(line);
          previousClock = message;
          return;
        }
        case 'rejected':
          announce(formatMessage(copy.refused, { reason: relayReasonText(message.reason) }));
          return;
        case 'error':
          announce(
            formatMessage(messages().networkRelay.serverSays, { reason: relayReasonText(message.reason) }),
          );
          return;
        case 'desync':
          worldNotice = formatMessage(copy.desync, { nick: message.reference, tick: message.tick });
          diag.warn('net', 'out of sync with the room', {
            tick: message.tick,
            domains: message.domains,
            reference: message.reference,
          });
          refreshNotice();
          return;
        default:
          return;
      }
    },
    link(state, reason): void {
      linkNotice =
        state === 'ok' ? null : state === 'reconnecting' ? copy.reconnecting : relayCloseText(reason);
      refreshNotice();
    },
  };
}
