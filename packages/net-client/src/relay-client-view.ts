import type { GameSession } from '@open-northland/lockstep';
import type { RoomSummary, RoomView, WaitedMember } from '@open-northland/net-protocol';
import type { CommandEnvelope, SaveGame } from '@open-northland/sim';
import type { RelayLobby } from './lobby.js';
import type { ClockState } from './relay-state.js';

type LobbyAction =
  | 'listRooms'
  | 'createRoom'
  | 'joinRoom'
  | 'leaveRoom'
  | 'claimSeat'
  | 'setSeat'
  | 'setSettings'
  | 'requestInitialSave'
  | 'requestMap'
  | 'setCompatibility'
  | 'setReady'
  | 'start'
  | 'say'
  | 'kick'
  | 'sendBlob';

/** What a display reads of a relayed session's client and asks of it, whether the client runs beside
 *  it or elsewhere: the relay's lobby and session state, the clock of the adopted world, and requests. */
export interface RelayClientView extends Pick<RelayLobby, LobbyAction> {
  readonly nick: string;
  readonly welcomed: boolean;
  readonly rooms: readonly RoomSummary[];
  readonly room: RoomView | null;
  readonly session: GameSession | null;
  readonly clockState: ClockState | null;
  readonly waitingFor: readonly WaitedMember[];
  readonly delayTicks: number | null;
  readonly roundTripMs: number | null;
  readonly isOutOfSync: boolean;
  readonly tick: number | null;
  readonly paused: boolean;
  readonly speed: number;
  readonly bufferedTicks: number;
  readonly droppedTicks: number;
  readonly latency: { readonly clickToApplyMs: number | null };
  readonly resultTick: number | null;
  readonly endedTick: number | null;
  readonly worldId: number | null;
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  submit(envelope: CommandEnvelope): void;
  shareSave(to: string | null, save: SaveGame): Promise<void>;
}
