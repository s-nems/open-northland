import type { ClockState } from '@open-northland/net-client';
import type { RoomView, ServerMessage } from '@open-northland/net-protocol';
import { diag } from '../../diag/index.js';
import type { NetLineCue, NetPanelModel } from '../../hud/network/model.js';
import { desyncNotice } from '../../hud/network/text.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { relayReasonText } from '../../net/relay-reason.js';
import type { LinkReport } from '../../session/worker/net-protocol.js';
import { clockAnnouncement } from '../../view/net/session-clock.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';
import { createRelayPanelFeed, type RelayPanelFeedDeps } from './net-panel-feed.js';

export interface NetHudDeps {
  readonly client: RelayPanelFeedDeps['client'];
  readonly readout: () => NetReadout;
  /** The relay this client is linked to, which the panel names. */
  readonly relayUrl: string | null;
}

export interface NetHud {
  /** The network panel's model: the window, the status line, the chat log and the speed segments read
   *  it. Built at most once per task, so a frame's readers share one build; the same object while
   *  nothing in it changed. */
  model(): NetPanelModel;
  /** Every relay message after the client acted on it. */
  observe(message: ServerMessage): void;
  /** The link as the worker last reported it; `atMs` is when that report arrived, default now. */
  link(report: LinkReport, atMs?: number): void;
  /** The world this HUD mounted over was rebuilt from a snapshot after `desync`; the log says so. */
  resynced(desync: Extract<ServerMessage, { kind: 'desync' }>): void;
}

/** A relayed game's side of the network panel: the model it reads, the chat with the session's
 *  announcements, and the notice about this client's own link or world. */
export function mountNetHud(deps: NetHudDeps): NetHud {
  const { client } = deps;
  const copy = messages().net;
  const feed = createRelayPanelFeed({ client, readout: deps.readout, relayUrl: deps.relayUrl });
  let previousRoom: RoomView | null = client.room;
  let previousClock: ClockState | null = client.clockState;
  let previousResponsiveness = client.responsiveness;
  // A frame's readers all run in one animation-frame callback; its microtasks run after them.
  let built: NetPanelModel | null = null;
  const forget = (): void => {
    built = null;
  };

  const announce = (text: string, cue?: NetLineCue): void => feed.announce(text, cue);
  const announceRoom = (room: RoomView): void => {
    const before = new Map(previousRoom?.members.map((member) => [member.nick, member.connected]) ?? []);
    for (const member of room.members) {
      const was = before.get(member.nick);
      if (was === undefined) {
        if (previousRoom !== null)
          announce(formatMessage(copy.memberJoined, { nick: member.nick }), 'arrival');
      } else if (was !== member.connected) {
        announce(
          formatMessage(member.connected ? copy.memberReturned : copy.memberDropped, { nick: member.nick }),
          member.connected ? 'arrival' : 'departure',
        );
      }
    }
    previousRoom = room;
  };

  return {
    model(): NetPanelModel {
      if (built === null) {
        built = feed.model();
        queueMicrotask(forget);
      }
      return built;
    },
    observe(message): void {
      feed.observe(message);
      switch (message.kind) {
        case 'responsiveness': {
          const responseCopy = messages().hud.network.responsiveness;
          if (message.by !== null && message.mode !== previousResponsiveness.mode)
            announce(
              formatMessage(responseCopy.changed, {
                nick: message.by,
                mode: responseCopy.options[message.mode],
              }),
            );
          previousResponsiveness = message;
          return;
        }
        case 'room':
          announceRoom(message.room);
          return;
        case 'kicked':
          announce(
            formatMessage(copy.departed[message.cause][message.mode], { nick: message.nick }),
            'departure',
          );
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
          feed.notice(desyncNotice(message.reference, message.tick));
          diag.warn('net', 'out of sync with the room', {
            tick: message.tick,
            domains: message.domains,
            reference: message.reference,
          });
          return;
        default:
          return;
      }
    },
    resynced(desync): void {
      announce(formatMessage(copy.resynced, { nick: desync.reference, tick: desync.tick }));
    },
    link(report, atMs): void {
      feed.link(report, atMs);
    },
  };
}
