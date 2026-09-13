import type { ClockState, RelayClient } from '@open-northland/net-client';
import type { RoomView, ServerMessage } from '@open-northland/net-protocol';
import { diag } from '../../diag/index.js';
import { DEFAULT_GAME_SPEED_CONTROL, type GameSpeedControl } from '../../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../../i18n/index.js';
import { type ChatPanel, mountChatPanel } from '../../view/net/chat-panel.js';
import { memberRows, mountNetStatusPanel, type NetStatusPanel } from '../../view/net/net-status.js';
import { clockAnnouncement, speedControlFor } from '../../view/net/session-clock.js';
import { createWaitingOverlay, type WaitingOverlay } from '../../view/net/waiting-overlay.js';
import type { GameViewHandle } from '../../view/runtime/game-view.js';
import type { NetReadout } from '../../view/runtime/net-readout.js';

export type LinkState = 'ok' | 'reconnecting' | 'closed';

export interface NetHudDeps {
  readonly client: RelayClient;
  readonly view: GameViewHandle;
  readonly readout: () => NetReadout;
}

export interface NetHud {
  /** Every relay message after the client acted on it. */
  observe(message: ServerMessage): void;
  link(state: LinkState, reason?: string): void;
  dispose(): void;
}

/** The overlays of a relayed game: the wait panel with its kick votes, the chat with the session's
 *  announcements, and the player list with this client's connection figures. */
export function mountNetHud(deps: NetHudDeps): NetHud {
  const { client, view } = deps;
  const copy = messages().net;
  const seatOf = (nick: string): number | null =>
    client.room?.members.find((member) => member.nick === nick)?.seat ?? null;
  const waiting: WaitingOverlay = createWaitingOverlay({ seatOf, onKick: (player) => client.kick(player) });
  const chat: ChatPanel = mountChatPanel({
    leftPx: () => view.hudInsetBottomLeftPx,
    onSend: (text) => client.say(text),
  });
  const status: NetStatusPanel = mountNetStatusPanel();
  let waited: ServerMessage & { kind: 'waiting' } = { kind: 'waiting', for: client.waitingFor };
  let previousRoom: RoomView | null = null;
  let previousClock: ClockState | null = client.clockState;
  let speedControl: GameSpeedControl = DEFAULT_GAME_SPEED_CONTROL;
  let linkNotice: string | null = null;
  let worldNotice: string | null = null;

  const announce = (text: string): void => chat.append({ from: null, text });
  const refreshStatus = (): void => {
    chat.updateLayout();
    status.update(memberRows(client.room, waited.for, client.nick), deps.readout());
  };
  const refreshNotice = (): void => waiting.notice(linkNotice ?? worldNotice);
  const syncClock = (clock: ClockState): void => {
    speedControl = speedControlFor(clock, speedControl);
    view.syncSpeed(speedControl);
  };
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

  if (client.room !== null) previousRoom = client.room;
  if (previousClock !== null) syncClock(previousClock);
  // The wait the room was already in when this client finished booting.
  waiting.waiting(client.waitingFor);
  refreshStatus();

  return {
    observe(message): void {
      switch (message.kind) {
        case 'room':
          announceRoom(message.room);
          refreshStatus();
          return;
        case 'waiting':
          waited = message;
          waiting.waiting(message.for);
          refreshStatus();
          return;
        case 'kickVote':
          waiting.tally(message);
          return;
        case 'kicked':
          announce(
            formatMessage(message.mode === 'ai' ? copy.kicked : copy.kickedIdle, { nick: message.nick }),
          );
          return;
        case 'clock': {
          const line = clockAnnouncement(previousClock, message);
          if (line !== null) announce(line);
          previousClock = message;
          syncClock(message);
          return;
        }
        case 'chat':
          chat.append({ from: message.from, text: message.text });
          return;
        case 'rejected':
          announce(formatMessage(copy.refused, { reason: message.reason }));
          // The speed button moved on the click; the relay did not, so the button follows it back.
          if (message.of === 'clock' && previousClock !== null) syncClock(previousClock);
          return;
        case 'error':
          announce(message.reason);
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
        case 'ping':
        case 'delay':
          refreshStatus();
          return;
        default:
          return;
      }
    },
    link(state, reason): void {
      linkNotice =
        state === 'ok'
          ? null
          : state === 'reconnecting'
            ? copy.reconnecting
            : formatMessage(copy.closed, { reason: reason ?? '' });
      refreshNotice();
      refreshStatus();
    },
    dispose(): void {
      waiting.dispose();
      chat.dispose();
      status.dispose();
    },
  };
}
