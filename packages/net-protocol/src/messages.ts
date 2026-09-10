import type { GameSession, SeatMode, SessionRules, SessionWorld } from '@open-northland/lockstep';
import type { SyncDomain } from '@open-northland/sim';

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
export interface PlayerWireEnvelope {
  readonly v: number;
  readonly origin: 'player';
  readonly player: number;
  readonly command: { readonly kind: string };
}

/** The one trusted command the relay itself issues: the seat a kick vote handed to the AI. A frame
 *  carrying any other trusted command is refused by every client. */
export interface RelayWireEnvelope {
  readonly v: number;
  readonly origin: 'admin';
  readonly command: { readonly kind: 'setPlayerAi'; readonly player: number; readonly enabled: true };
}

export type WireEnvelope = PlayerWireEnvelope | RelayWireEnvelope;

export interface WireCommand {
  readonly envelope: WireEnvelope;
  readonly sequence: number;
}

export interface WireFrame {
  readonly tick: number;
  readonly commands: readonly WireCommand[];
}

/** A tick's sync digest as the wire carries it: the sim's `SyncDigest.domains`. */
export type WireDigest = Readonly<Record<SyncDomain, number>>;

export type WaitReason = 'gone' | 'silent' | 'loading' | 'lagging' | 'resync';

export interface WaitedMember {
  readonly nick: string;
  readonly reason: WaitReason;
  /** Counts down to when a vote to kick this member may open. */
  readonly voteAfterMs: number;
}

/**
 * A client's world generation: 0 for a world built from the descriptor, otherwise the tick of the
 * snapshot it was restored from. An acknowledgement from another generation is stale and ignored.
 */
export const DESCRIPTOR_WORLD = 0;

/** What a blob holds; the relay reads the type and the tick, never the bytes. */
export type BlobType = 'snapshot' | 'save' | 'map';

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
  /** The tick the client's world stands at and the world's generation, or a null tick for a client
   *  holding no world that needs the room's snapshot. */
  | { readonly kind: 'loaded'; readonly tick: number; readonly world: number }
  | { readonly kind: 'loaded'; readonly tick: null }
  | { readonly kind: 'ack'; readonly tick: number; readonly digest: WireDigest; readonly world: number }
  | { readonly kind: 'command'; readonly envelope: PlayerWireEnvelope; readonly fromTick: number }
  | { readonly kind: 'clock'; readonly speed?: number; readonly paused?: boolean }
  | { readonly kind: 'kick'; readonly player: number }
  /** `to` names one member's nick, or null for everyone else in the room. `tick` is required for a
   *  snapshot or a save, since the relay serves the frames after it. */
  | {
      readonly kind: 'blob';
      readonly type: BlobType;
      readonly to: string | null;
      readonly tick: number | null;
      readonly bytes: string;
    }
  | { readonly kind: 'chat'; readonly text: string }
  | { readonly kind: 'pong'; readonly t: number };

export type ClientMessageKind = ClientMessage['kind'];

export type ServerMessage =
  | { readonly kind: 'welcome'; readonly protocol: number; readonly nick: string }
  | { readonly kind: 'rooms'; readonly rooms: readonly RoomSummary[] }
  | { readonly kind: 'room'; readonly room: RoomView }
  | { readonly kind: 'left' }
  /** `snapshotTick` is the tick of the room's cached snapshot, which a client holding no world asks
   *  for with `loaded { tick: null }`; null means build the world from the descriptor. */
  | { readonly kind: 'start'; readonly session: GameSession; readonly snapshotTick: number | null }
  | {
      readonly kind: 'clock';
      readonly tick: number;
      readonly speed: number;
      readonly paused: boolean;
      readonly by: string | null;
    }
  | { readonly kind: 'frame'; readonly tick: number; readonly commands: readonly WireCommand[] }
  | { readonly kind: 'delay'; readonly ticks: number }
  /** An empty `for` ends the wait. */
  | { readonly kind: 'waiting'; readonly for: readonly WaitedMember[] }
  | {
      readonly kind: 'kickVote';
      readonly player: number;
      readonly nick: string;
      readonly yes: readonly string[];
      readonly needed: number;
    }
  | {
      readonly kind: 'kicked';
      readonly player: number;
      readonly nick: string;
      readonly mode: VacantSeatMode;
      readonly tick: number;
    }
  | {
      readonly kind: 'desync';
      readonly tick: number;
      readonly domains: readonly SyncDomain[];
      readonly reference: string;
    }
  | { readonly kind: 'snapshotRequest' }
  | {
      readonly kind: 'blob';
      readonly type: BlobType;
      readonly from: string;
      readonly tick: number | null;
      readonly bytes: string;
    }
  | { readonly kind: 'chat'; readonly from: string; readonly text: string }
  /** `roundTripMs` is the smoothed round trip the relay measured for this client, for its own readout. */
  | { readonly kind: 'ping'; readonly t: number; readonly roundTripMs: number }
  | { readonly kind: 'rejected'; readonly of: ClientMessageKind; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string };
