import type { GameSession, SeatMode, SessionRules, SessionWorld } from '@open-northland/lockstep';

export type RoomState = 'lobby' | 'running';

/** What the creator decides for the whole room. The world is fixed at creation. */
export interface RoomSettings {
  readonly name: string;
  readonly world: SessionWorld;
  readonly seed: number;
  readonly rules: SessionRules;
  readonly speed: number;
}

/** What an unclaimed seat does; `human` is never chosen, it is what a claimed seat becomes. */
export type VacantSeatMode = Exclude<SeatMode, 'human'>;

export interface RoomSeatSetup {
  readonly player: number;
  readonly mode: VacantSeatMode;
  readonly color: number;
}

export interface RoomSeatView {
  readonly player: number;
  readonly mode: SeatMode;
  readonly color: number;
  readonly nick: string | null;
  readonly ready: boolean;
}

export interface RoomMemberView {
  readonly nick: string;
  readonly seat: number | null;
  readonly connected: boolean;
}

export interface RoomView {
  readonly id: string;
  readonly state: RoomState;
  readonly creator: string;
  readonly settings: RoomSettings;
  readonly seats: readonly RoomSeatView[];
  readonly members: readonly RoomMemberView[];
}

export interface RoomSummary {
  readonly id: string;
  readonly name: string;
  readonly state: RoomState;
  readonly members: number;
  readonly seats: number;
}

/** A seat envelope as the wire carries it. The relay reads the authority half and stamps `player`; the
 *  command is the sim's contract, which every receiving client validates before applying. */
export interface WireEnvelope {
  readonly v: number;
  readonly origin: 'player';
  readonly player: number;
  readonly command: { readonly kind: string };
}

export interface WireCommand {
  readonly envelope: WireEnvelope;
  readonly sequence: number;
}

export interface WireFrame {
  readonly tick: number;
  readonly commands: readonly WireCommand[];
}

export type ClientMessage =
  | { readonly kind: 'hello'; readonly protocol: number; readonly token: string; readonly nick: string }
  | { readonly kind: 'listRooms' }
  | { readonly kind: 'createRoom'; readonly settings: RoomSettings; readonly seats: readonly RoomSeatSetup[] }
  | { readonly kind: 'joinRoom'; readonly roomId: string }
  | { readonly kind: 'leaveRoom' }
  | { readonly kind: 'claimSeat'; readonly player: number | null }
  | {
      readonly kind: 'setSeat';
      readonly player: number;
      readonly mode?: VacantSeatMode;
      readonly color?: number;
    }
  | { readonly kind: 'setReady'; readonly ready: boolean }
  | { readonly kind: 'start' }
  | { readonly kind: 'loaded' }
  | { readonly kind: 'command'; readonly envelope: WireEnvelope; readonly fromTick: number }
  | { readonly kind: 'clock'; readonly speed?: number; readonly paused?: boolean }
  | { readonly kind: 'chat'; readonly text: string }
  | { readonly kind: 'pong'; readonly t: number };

export type ClientMessageKind = ClientMessage['kind'];

export type ServerMessage =
  | { readonly kind: 'welcome'; readonly protocol: number; readonly nick: string }
  | { readonly kind: 'rooms'; readonly rooms: readonly RoomSummary[] }
  | { readonly kind: 'room'; readonly room: RoomView }
  | { readonly kind: 'left' }
  | { readonly kind: 'start'; readonly session: GameSession }
  | {
      readonly kind: 'clock';
      readonly tick: number;
      readonly speed: number;
      readonly paused: boolean;
      readonly by: string | null;
    }
  | { readonly kind: 'frame'; readonly tick: number; readonly commands: readonly WireCommand[] }
  | { readonly kind: 'delay'; readonly ticks: number }
  | { readonly kind: 'chat'; readonly from: string; readonly text: string }
  | { readonly kind: 'ping'; readonly t: number }
  | { readonly kind: 'rejected'; readonly of: ClientMessageKind; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };
