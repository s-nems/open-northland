import type { GameSession } from '@open-northland/lockstep';
import type {
  ChatLine,
  GovernedClock,
  ResponsivenessMode,
  ResponsivenessState,
  RoomSummary,
  RoomView,
  WaitedMember,
} from '@open-northland/net-protocol';
import type { CommandEnvelope, SaveGame } from '@open-northland/sim';
import type { RelayLobby } from './lobby.js';
import type { ClockState } from './relay-state.js';

/** The lobby requests a display makes of the client, by the `RelayLobby` method that sends each. */
const LOBBY_ACTIONS = [
  'listRooms',
  'createRoom',
  'joinRoom',
  'leaveRoom',
  'claimSeat',
  'setSeat',
  'setSettings',
  'requestInitialSave',
  'requestMap',
  'setCompatibility',
  'setReady',
  'start',
  'reportLoading',
  'say',
  'kick',
  'sendBlob',
] as const satisfies readonly (keyof RelayLobby)[];

export type LobbyAction = (typeof LOBBY_ACTIONS)[number];

export function isLobbyAction(name: string): name is LobbyAction {
  return (LOBBY_ACTIONS as readonly string[]).includes(name);
}

/** What a display reads of a relayed session's client and asks of it, whether the client runs beside
 *  it or elsewhere: the relay's lobby and session state, the clock of the adopted world, and requests. */
export interface RelayClientView extends Pick<RelayLobby, LobbyAction> {
  readonly nick: string;
  readonly welcomed: boolean;
  readonly relayBuild: string | null;
  readonly rooms: readonly RoomSummary[];
  readonly room: RoomView | null;
  /** The room's chat, oldest first, the relay's history included; a new array per change. */
  readonly chat: readonly ChatLine[];
  readonly session: GameSession | null;
  readonly clockState: ClockState | null;
  readonly responsiveness: ResponsivenessState;
  readonly waitingFor: readonly WaitedMember[];
  readonly delayTicks: number | null;
  readonly roundTripMs: number | null;
  readonly isOutOfSync: boolean;
  readonly tick: number | null;
  readonly paused: boolean;
  /** The requested speed; the clock runs at `governed.speed` while that is set. */
  readonly speed: number;
  readonly governed: GovernedClock | null;
  readonly bufferedTicks: number;
  readonly droppedTicks: number;
  readonly latency: { readonly clickToApplyMs: number | null };
  readonly resultTick: number | null;
  readonly endedTick: number | null;
  readonly worldId: number | null;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  setResponsiveness(mode: ResponsivenessMode): void;
  submit(envelope: CommandEnvelope): void;
  shareSave(to: string | null, save: SaveGame): Promise<void>;
}
