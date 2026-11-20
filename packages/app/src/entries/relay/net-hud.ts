import type { ClockState } from '@open-northland/net-client';
import type { RoomView, ServerMessage } from '@open-northland/net-protocol';
import type { SimEvent } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import type { NetLineCue, NetPanelModel } from '../../hud/network/model.js';
import { desyncNotice } from '../../hud/network/text.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { relayReasonText } from '../../net/relay-reason.js';
import type { LinkReport } from '../../session/worker/net-protocol.js';
import type { NetReadout } from '../../view/net/readout.js';
import { clockAnnouncement } from '../../view/net/session-clock.js';
import { createRelayPanelFeed, type RelayPanelFeedDeps } from './net-panel-feed.js';

export interface NetHudDeps {
  readonly client: RelayPanelFeedDeps['client'];
  readonly readout: () => NetReadout;
  /** The relay this client is linked to, which the panel names. */
  readonly relayUrl: string | null;
  /** Who played a seat, which a surrender's line names. */
  readonly nickOf: (player: number) => string | undefined;
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
  /** The sim events of a stepped frame; a seat's surrender gets a line. */
  worldEvents(events: readonly SimEvent[]): void;
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
  // The nicks a `kicked` line already saw off: its room view, which follows it, drops them silently.
  const farewelled = new Set<string>();
  // A frame's readers all run in one animation-frame callback; its microtasks run after them.
  let built: NetPanelModel | null = null;
  const forget = (): void => {
    built = null;
  };

  const announce = (text: string, cue?: NetLineCue): void => feed.announce(text, cue);
  const announceRoom = (room: RoomView): void => {
    const before = new Map(previousRoom?.members.map((member) => [member.nick, member.connected]) ?? []);
    const present = new Set(room.members.map((member) => member.nick));
    for (const nick of before.keys()) {
      if (!present.has(nick) && !farewelled.has(nick))
        announce(formatMessage(copy.memberLeft, { nick }), 'departure');
    }
    farewelled.clear();
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
          farewelled.add(message.nick);
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
          // The log goes out with bug reports, so it names the other player by seat.
          diag.warn('net', 'out of sync with the room', {
            tick: message.tick,
            domains: message.domains,
            referenceSeat:
              client.room?.members.find((member) => member.nick === message.reference)?.seat ?? null,
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
    worldEvents(events): void {
      for (const event of events) {
        if (event.kind !== 'playerSurrendered') continue;
        const nick = deps.nickOf(event.player);
        if (nick !== undefined) announce(formatMessage(copy.surrendered, { nick }), 'departure');
      }
    },
  };
}
