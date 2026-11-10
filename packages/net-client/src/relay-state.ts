import type { GameSession } from '@open-northland/lockstep';
import {
  AUTO_INITIAL_BUFFER_TICKS,
  type ChatLine,
  type HallChatLine,
  MAX_CHAT_HISTORY_LINES,
  MAX_HALL_CHAT_LINES,
  type OnlinePlayer,
  type RecentPlayer,
  type ResponsivenessState,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  type WaitedMember,
  withFlag,
} from '@open-northland/net-protocol';

export type ClockState = Extract<ServerMessage, { kind: 'clock' }>;

const INITIAL_RESPONSIVENESS: ResponsivenessState = {
  mode: 'auto',
  bufferTicks: AUTO_INITIAL_BUFFER_TICKS,
  by: null,
};

/** What the relay's messages say about one client's lobby and session. The client and any mirror of it
 *  apply the same messages in the same order and reach the same state. */
export class RelayState {
  nick: string;
  welcomed = false;
  /** The relay's build as its last `welcome` named it; null when it named none. */
  relayBuild: string | null = null;
  rooms: readonly RoomSummary[] = [];
  /** Who is connected to the relay and who left it recently, as its last `presence` said. */
  online: readonly OnlinePlayer[] = [];
  recent: readonly RecentPlayer[] = [];
  /** The relay's own chat, oldest first, as heard outside a room. A new array per change. */
  hallChat: readonly HallChatLine[] = [];
  room: RoomView | null = null;
  session: GameSession | null = null;
  /** The relay's last word on the clock. */
  clockState: ClockState | null = null;
  responsiveness: ResponsivenessState = { ...INITIAL_RESPONSIVENESS };
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
      case 'presence':
        this.online = message.online;
        this.recent = message.recent;
        break;
      case 'hallChatHistory':
        this.hallChat = (message.replaces ? message.lines : [...this.hallChat, ...message.lines]).slice(
          -MAX_HALL_CHAT_LINES,
        );
        break;
      case 'hallChat': {
        const line: HallChatLine = {
          from: message.from,
          ...withFlag(message.flag),
          text: message.text,
          at: message.at,
        };
        this.hallChat = [...this.hallChat.slice(1 - MAX_HALL_CHAT_LINES), line];
        break;
      }
      case 'room':
        this.room = message.room;
        if (this.session !== null) {
          const self = message.room.members.find((member) => member.nick === this.nick);
          if (self !== undefined) this.session = { ...this.session, localSeat: self.seat ?? 'observer' };
        }
        break;
      case 'ended':
        this.waitingFor = [];
        break;
      case 'left':
        this.room = null;
        this.session = null;
        this.clockState = null;
        this.responsiveness = { ...INITIAL_RESPONSIVENESS };
        this.waitingFor = [];
        this.delayTicks = null;
        this.chat = [];
        this.outOfSync = false;
        break;
      case 'start':
        this.session = message.session;
        break;
      case 'responsiveness':
        this.responsiveness = message;
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
        const { from, flag, text, at, tick } = message;
        const line: ChatLine = { from, ...withFlag(flag), text, at, tick };
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
      case 'signal':
        break;
      default:
        assertNever(message);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`unreachable: ${JSON.stringify(value)}`);
}
