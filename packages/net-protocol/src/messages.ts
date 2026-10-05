import type {
  AiDifficulty,
  GameSession,
  InitialSaveIdentity,
  SeatMode,
  SessionRules,
  SessionWorld,
} from '@open-northland/lockstep';
import type { SyncDomain } from '@open-northland/sim';
import type { LobbyCompatibility } from './compatibility.js';
import type { RelayReason } from './reasons.js';

export type RoomState = 'lobby' | 'running' | 'ended';

/** What the creator decides for the whole room. The world is fixed at creation. */
export interface RoomSettings {
  readonly initialSave?: InitialSaveIdentity;
  readonly mapOrigin?: 'mod' | 'user';
  readonly kickedSeatMode?: DepartedSeatMode;
  readonly name: string;
  readonly world: SessionWorld;
  readonly seed: number;
  readonly rules: SessionRules;
  readonly speed: number;
}

export type LobbySettings = Omit<RoomSettings, 'world' | 'initialSave' | 'mapOrigin'>;

/** What an unclaimed seat does; `human` is never chosen, it is what a claimed seat becomes. */
export type VacantSeatMode = Exclude<SeatMode, 'human'>;

/** What a seat becomes when its member departs a running game; its settlers already stand, so it
 *  cannot turn `absent`. */
export type DepartedSeatMode = Exclude<VacantSeatMode, 'absent'>;

/** Why a member left a started game's seat: a passed kick vote or its own leave. */
export type DepartureCause = 'vote' | 'left';

export interface RoomSeatSetup {
  readonly player: number;
  readonly mode: VacantSeatMode;
  /** The vacant modes the map offers this seat, `mode` among them. */
  readonly offers: readonly VacantSeatMode[];
  readonly color: number;
  readonly team?: number | null;
  /** The tribe the map's roster names for the seat; a seat without one, such as a scene's, offers no
   *  tribe choice. */
  readonly authoredTribe?: number;
  /** The tribe the seat starts as when it is not `authoredTribe`: a saved world's choice. */
  readonly tribe?: number;
  /** Present on a seat the lobby may hand to the computer at a level: the level it starts at. */
  readonly difficulty?: AiDifficulty;
}

export interface RoomSeatView {
  readonly player: number;
  readonly mode: SeatMode;
  readonly offers: readonly VacantSeatMode[];
  readonly color: number;
  readonly team?: number | null;
  /** Present together: the map's tribe for the seat and the one it plays. */
  readonly authoredTribe?: number;
  readonly tribe?: number;
  /** Present on a seat that takes a level: how hard it plays while the computer has it. */
  readonly difficulty?: AiDifficulty;
  readonly nick: string | null;
  readonly ready: boolean;
}

export interface RoomMemberView {
  readonly nick: string;
  readonly seat: number | null;
  readonly connected: boolean;
  readonly compatibility: LobbyCompatibility | null;
  /** The load the member's last acknowledgement reported; null before its first. */
  readonly load: ClientLoad | null;
  /** The boot progress in whole percent the member last reported while building its world; null once
   *  that world has loaded, and before its first report. */
  readonly loading: number | null;
  /** The relay's smoothed round trip to the member in milliseconds; null while it is disconnected. */
  readonly roundTripMs: number | null;
  /** The member's assigned input delay in ticks; null while it is disconnected. */
  readonly delayTicks: number | null;
  /** Ticks the member's acknowledgements trail the clock; 0 before the clock runs, after the match
   *  ended, and while the relay does not follow its world (loading, gone, out of sync). */
  readonly behindTicks: number;
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

/** A client's own load, reported with every acknowledgement: `tickMs` is the smoothed wall time one
 *  tick costs it in milliseconds, its sim's or its display's, whichever is more; `buffered` the frames
 *  it holds received and not yet run. */
export interface ClientLoad {
  readonly tickMs: number;
  readonly buffered: number;
}

/** Why the clock holds for a member; a member that is merely slow paces the clock instead. */
export type WaitReason = 'gone' | 'silent' | 'loading' | 'resync';

/** What bounds a governed speed: `load` when the member's reported tick cost does, `lag` when the
 *  catch-up share of the requested speed does (a member that reports it could keep up, yet trails). */
export type GovernorCause = 'load' | 'lag';

/** The speed the relay runs the clock at for a slow member, never above the requested one, and the
 *  member it paces the room for. */
export interface GovernedClock {
  readonly nick: string;
  readonly speed: number;
  readonly cause: GovernorCause;
}

/** One line of a room's chat as the relay logged it: `tick` is the clock's next tick when the relay
 *  received it, null before the clock started. */
export interface ChatLine {
  readonly from: string;
  readonly text: string;
  readonly tick: number | null;
}

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
export type BlobType = 'snapshot' | 'save' | 'map' | 'initialSave';

export type BlobUpload = {
  readonly to: string | null;
  readonly tick: number | null;
  readonly bytes: string;
} & (
  | { readonly type: 'snapshot'; readonly world: number }
  | { readonly type: Exclude<BlobType, 'snapshot'> }
);

export type ClientMessage =
  | { readonly kind: 'hello'; readonly protocol: number; readonly token: string; readonly nick: string }
  | { readonly kind: 'listRooms' }
  | { readonly kind: 'requestInitialSave' }
  | { readonly kind: 'requestMap' }
  | { readonly kind: 'createRoom'; readonly settings: RoomSettings; readonly seats: readonly RoomSeatSetup[] }
  | { readonly kind: 'joinRoom'; readonly roomId: string }
  | { readonly kind: 'leaveRoom' }
  | { readonly kind: 'claimSeat'; readonly player: number | null }
  | {
      readonly kind: 'setSeat';
      readonly player: number;
      readonly mode?: VacantSeatMode;
      readonly color?: number;
      readonly team?: number | null;
      readonly tribe?: number;
      readonly difficulty?: AiDifficulty;
    }
  | { readonly kind: 'setReady'; readonly ready: boolean }
  | { readonly kind: 'setCompatibility'; readonly compatibility: LobbyCompatibility | null }
  | { readonly kind: 'setSettings'; readonly settings: LobbySettings }
  | { readonly kind: 'start' }
  | { readonly kind: 'saveOrders'; readonly id: number; readonly tick: number; readonly world: number }
  /** The tick the client's world stands at and the world's generation, or a null tick for a client
   *  holding no world that needs the room's snapshot. */
  | { readonly kind: 'loaded'; readonly tick: number; readonly world: number }
  | { readonly kind: 'loaded'; readonly tick: null }
  /** How far the client's boot is before it reports `loaded`, in whole percent. */
  | { readonly kind: 'loading'; readonly progress: number }
  | { readonly kind: 'finish'; readonly tick: number; readonly hash: string; readonly world: number }
  | {
      readonly kind: 'ack';
      readonly tick: number;
      readonly digest: WireDigest;
      readonly world: number;
      readonly load: ClientLoad;
    }
  | { readonly kind: 'command'; readonly envelope: PlayerWireEnvelope; readonly fromTick: number }
  | { readonly kind: 'clock'; readonly speed?: number; readonly paused?: boolean }
  | { readonly kind: 'kick'; readonly player: number }
  /** `to` names one member's nick, or null for everyone else in the room. `tick` is required for a
   *  snapshot or a save, since the relay serves the frames after it. */
  | ({ readonly kind: 'blob' } & BlobUpload)
  | { readonly kind: 'chat'; readonly text: string }
  | { readonly kind: 'pong'; readonly t: number };

export type ClientMessageKind = ClientMessage['kind'];

export type ServerMessage =
  | {
      readonly kind: 'saveOrders';
      readonly id: number;
      readonly tick: number;
      readonly frames: readonly WireFrame[];
    }
  | { readonly kind: 'ended'; readonly tick: number; readonly hash: string }
  /** `build` names the relay's build when its operator gave it one. */
  | { readonly kind: 'welcome'; readonly protocol: number; readonly nick: string; readonly build?: string }
  | { readonly kind: 'rooms'; readonly rooms: readonly RoomSummary[] }
  | { readonly kind: 'room'; readonly room: RoomView }
  | { readonly kind: 'left' }
  /** `snapshotTick` is the tick of the room's cached snapshot, which a client holding no world asks
   *  for with `loaded { tick: null }`; null means build the world from the descriptor. */
  | { readonly kind: 'start'; readonly session: GameSession; readonly snapshotTick: number | null }
  | {
      readonly kind: 'clock';
      readonly tick: number;
      /** The requested speed; the clock runs at `governed.speed` while that is set. */
      readonly speed: number;
      readonly paused: boolean;
      readonly by: string | null;
      readonly governed: GovernedClock | null;
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
      readonly mode: DepartedSeatMode;
      readonly cause: DepartureCause;
      readonly tick: number;
    }
  | {
      readonly kind: 'desync';
      readonly tick: number;
      readonly domains: readonly SyncDomain[];
      readonly reference: string;
    }
  /** To the reference member of a verdict: the nicks whose digest differed from its own at `tick`. */
  | {
      readonly kind: 'disputed';
      readonly tick: number;
      readonly domains: readonly SyncDomain[];
      readonly diverged: readonly string[];
    }
  | { readonly kind: 'snapshotRequest' }
  | { readonly kind: 'mapRequest'; readonly from: string }
  | {
      readonly kind: 'blob';
      readonly type: BlobType;
      readonly from: string;
      readonly tick: number | null;
      readonly bytes: string;
    }
  | ({ readonly kind: 'chat' } & ChatLine)
  /** The room's chat so far, oldest first, sent to a member each time it enters or returns to the
   *  room, right after the room view. */
  | { readonly kind: 'chatHistory'; readonly lines: readonly ChatLine[] }
  /** `roundTripMs` is the smoothed round trip the relay measured for this client, for its own readout. */
  | { readonly kind: 'ping'; readonly t: number; readonly roundTripMs: number }
  | {
      readonly kind: 'rejected';
      readonly of: ClientMessageKind;
      readonly reason: RelayReason;
      readonly requestId?: number;
    }
  | { readonly kind: 'error'; readonly reason: RelayReason };
