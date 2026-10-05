import type { GameSession } from '@open-northland/lockstep';
import {
  type ChatLine,
  MAX_CHAT_HISTORY_LINES,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  type WaitedMember,
} from '@open-northland/net-protocol';

export type ClockState = Extract<ServerMessage, { kind: 'clock' }>;

/** What the relay's messages say about one client's lobby and session. The client and any mirror of it
 *  apply the same messages in the same order and reach the same state. */
export class RelayState {
  nick: string;
  welcomed = false;
  /** The relay's build as its last `welcome` named it; null when it named none. */
  relayBuild: string | null = null;
  rooms: readonly RoomSummary[] = [];
  room: RoomView | null = null;
  session: GameSession | null = null;
  /** The relay's last word on the clock. */
  clockState: ClockState | null = null;
  /** The relay's last word on who the room waits for. */
  waitingFor: readonly WaitedMember[] = [];
  delayTicks: number | null = null;
  /** The relay's smoothed round trip to this client, from its last ping. */
  roundTripMs: number | null = null;
  /** The room's chat, oldest first: the relay's history on entering, then each line as it is said. A
   *  new array per change. */
  chat: readonly ChatLine[] = [];
  /** Set by a desync notice: the next world comes from a snapshot, whatever `start` offers. The client
   *  also clears it when it adopts a world. */
  outOfSync = false;

  constructor(nick: string) {
    this.nick = nick;
  }

  apply(message: ServerMessage): void {
    switch (message.kind) {
      case 'welcome':
        this.nick = message.nick;
        this.welcomed = true;
        this.relayBuild = message.build ?? null;
        break;
      case 'rooms':
        this.rooms = message.rooms;
        break;
      case 'room':
        this.room = message.room;
        break;
      case 'ended':
        this.waitingFor = [];
        break;
      case 'left':
        this.room = null;
        this.session = null;
        this.clockState = null;
        this.waitingFor = [];
        this.delayTicks = null;
        this.chat = [];
        this.outOfSync = false;
        break;
      case 'start':
        this.session = message.session;
        break;
      case 'clock':
        this.clockState = message;
        break;
      case 'delay':
        this.delayTicks = message.ticks;
        break;
      case 'waiting':
        this.waitingFor = message.for;
        break;
      case 'desync':
        this.outOfSync = true;
        break;
      case 'ping':
        this.roundTripMs = message.roundTripMs;
        break;
      case 'chatHistory':
        this.chat = message.lines;
        break;
      case 'chat': {
        const line: ChatLine = { from: message.from, text: message.text, tick: message.tick };
        // The newest lines up to the relay's own cap, this one included.
        this.chat = [...this.chat.slice(1 - MAX_CHAT_HISTORY_LINES), line];
        break;
      }
      case 'saveOrders':
      case 'frame':
      case 'mapRequest':
      case 'kickVote':
      case 'kicked':
      case 'error':
      case 'snapshotRequest':
      case 'disputed':
      case 'blob':
      case 'rejected':
        break;
      default:
        assertNever(message);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
