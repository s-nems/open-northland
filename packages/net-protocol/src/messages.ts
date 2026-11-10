import type {
  ComputerDifficulty,
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

/** Where the creator's map came from, when the room lets members fetch it; absent turns map delivery off. */
export type RoomMapOrigin = 'mod' | 'user' | 'catalog';

/** A map the creator installed from the map catalogue, so a member without it can fetch the same
 *  conversion from the catalogue's server before asking the creator for it. */
export interface CatalogMapAnnouncement {
  readonly entryId: string;
  readonly mapId: string;
  /** The `mapDocumentsFingerprint` of the map's terrain and script documents. */
  readonly fingerprint: string;
  /** The content version the map was converted for. */
  readonly irVersion: number;
}

/** What the creator decides for the whole room. The world is fixed at creation. */
export interface RoomSettings {
  readonly initialSave?: InitialSaveIdentity;
  readonly mapOrigin?: RoomMapOrigin;
  /** Present exactly when `mapOrigin` is `catalog`, naming the room's map. */
  readonly catalogMap?: CatalogMapAnnouncement;
  readonly kickedSeatMode?: DepartedSeatMode;
  readonly name: string;
  readonly world: SessionWorld;
  readonly seed: number;
  readonly rules: SessionRules;
  readonly speed: number;
}

export type LobbySettings = Omit<RoomSettings, 'world' | 'initialSave' | 'mapOrigin' | 'catalogMap'>;

/** What an unclaimed seat does; `human` is never chosen, it is what a claimed seat becomes. */
export type VacantSeatMode = Exclude<SeatMode, 'human'>;

/** Departure can hand control to full AI or leave it idle; map-script setup and entity removal
 *  belong to the lobby, before the world starts. */
export type DepartedSeatMode = Exclude<VacantSeatMode, 'absent' | 'map-ai'>;

/** Why a member left a started game's seat: a passed kick vote, its own leave, or a boot that stood
 *  still too long before the clock ran. */
export type DepartureCause = 'vote' | 'left' | 'loadingTimedOut';

export interface RoomSeatSetup {
  readonly player: number;
  readonly mode: VacantSeatMode;
  /** Whether a person may occupy this seat, independently of its vacant mode. */
  readonly claimable: boolean;
  /** The vacant modes the map offers this seat, `mode` among them. Map AI is the sole offer of
   *  its reserved seat; claimable seats offer only computer, idle or absent. */
  readonly offers: readonly VacantSeatMode[];
  readonly color: number;
  /** The tribe the map's roster names for the seat; a seat without one, such as a scene's, offers no
   *  tribe choice. */
  readonly authoredTribe?: number;
  /** The tribe the seat starts as when it is not `authoredTribe`: a saved world's choice. */
  readonly tribe?: number;
  /** Present on a seat the lobby may hand to the computer at a level: the level it starts at. */
  readonly difficulty?: ComputerDifficulty;
}

export interface RoomSeatView {
  readonly player: number;
  readonly mode: SeatMode;
  readonly claimable: boolean;
  readonly offers: readonly VacantSeatMode[];
  readonly color: number;
  /** Present together: the map's tribe for the seat and the one it plays. */
  readonly authoredTribe?: number;
  readonly tribe?: number;
  /** Present on a seat that takes a level: how hard it plays while the computer has it. */
  readonly difficulty?: ComputerDifficulty;
  readonly nick: string | null;
  readonly ready: boolean;
}

/** A flag a player picked to show beside their nick: two capital letters, an ISO 3166-1 region
 *  (`PL`) or another code a flag set draws (`EU`). Wherever a flag may stand, its absence is none. */
export type PlayerFlag = string;

/** A player's flag as a message carries it: the field is left out for no flag. */
export function withFlag(flag: PlayerFlag | undefined): { readonly flag?: PlayerFlag } {
  return flag === undefined ? {} : { flag };
}

export interface RoomMemberView {
  readonly nick: string;
  readonly flag?: PlayerFlag;
  readonly seat: number | null;
  readonly connected: boolean;
  readonly compatibility: LobbyCompatibility | null;
  /** The load the member's last acknowledgement reported; null before its first. */
  readonly load: ClientLoad | null;
  /** Boot progress in whole percent, with 100 once the world has loaded; null before its first report. */
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
  /** Whether joining asks a password; the password itself never leaves the relay. */
  readonly locked: boolean;
  readonly seats: readonly RoomSeatView[];
  readonly members: readonly RoomMemberView[];
}

export interface RoomSummary {
  readonly id: string;
  readonly name: string;
  readonly state: RoomState;
  /** The nicks of the members connected now; a room nobody is connected to waits for them to return. */
  readonly members: readonly string[];
  readonly seats: number;
  readonly world: SessionWorld;
  /** Whether joining asks a password. */
  readonly locked: boolean;
  /** Wall milliseconds the clock had run when the relay sent the summary; null before it runs. */
  readonly playedMs: number | null;
}

/** Someone connected to the relay by the nick they introduced themselves with; `room` is the id of
 *  the room they are in, null outside one. */
export interface OnlinePlayer {
  readonly nick: string;
  readonly flag?: PlayerFlag;
  readonly room: string | null;
}

/** Someone the relay saw recently who is no longer connected: `at` is when, in Unix epoch ms. */
export interface RecentPlayer {
  readonly nick: string;
  readonly at: number;
}

/** One line of the relay's own chat, which everyone outside a room shares; `at` is the relay's wall
 *  clock in Unix epoch milliseconds. */
export interface HallChatLine {
  readonly from: string;
  /** The speaker's flag when they said the line. */
  readonly flag?: PlayerFlag;
  readonly text: string;
  readonly at: number;
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
  readonly command: {
    readonly kind: 'setAiControl';
    readonly player: number;
    readonly enabled: true;
    readonly computerEnabled: true;
    readonly mapAiEnabled: true;
  };
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

/** Why the clock holds for a member. A slow member paces the clock instead, and is waited for as
 *  `slow` only once it has stayed slow for the relay's bound. */
export type WaitReason = 'gone' | 'silent' | 'loading' | 'resync' | 'slow';

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

/** One line of a room's chat as the relay logged it: `at` is the relay's wall clock when it received
 *  the line, in Unix epoch milliseconds, and `tick` the clock's next tick then, null before it started. */
export interface ChatLine extends HallChatLine {
  readonly tick: number | null;
}

/** A spot on the map as a signal names it: a half-cell node of the sim's lattice. */
export interface SignalNode {
  readonly hx: number;
  readonly hy: number;
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

export type ResponsivenessMode = 'auto' | 'responsive' | 'balanced' | 'smooth';

export interface ResponsivenessState {
  readonly mode: ResponsivenessMode;
  readonly bufferTicks: number;
  /** The member who last selected the mode; null for a room's default. */
  readonly by: string | null;
}

export type ClientMessage =
  | {
      readonly kind: 'hello';
      readonly protocol: number;
      readonly token: string;
      readonly nick: string;
      readonly flag?: PlayerFlag;
    }
  | { readonly kind: 'listRooms' }
  | { readonly kind: 'requestInitialSave' }
  | { readonly kind: 'requestMap' }
  /** `password`, when given, is what every later `joinRoom` must name; it is not part of the settings,
   *  since those go to every member. */
  | {
      readonly kind: 'createRoom';
      readonly settings: RoomSettings;
      readonly seats: readonly RoomSeatSetup[];
      readonly password?: string;
    }
  | { readonly kind: 'joinRoom'; readonly roomId: string; readonly password?: string }
  | { readonly kind: 'leaveRoom' }
  | { readonly kind: 'claimSeat'; readonly player: number | null }
  | {
      readonly kind: 'setSeat';
      readonly player: number;
      readonly mode?: VacantSeatMode;
      readonly color?: number;
      readonly tribe?: number;
      readonly difficulty?: ComputerDifficulty;
    }
  | { readonly kind: 'moveMember'; readonly nick: string; readonly player: number | null }
  /** The creator's, in the lobby: remove the member and keep it out of the room for the room's life. */
  | { readonly kind: 'banMember'; readonly nick: string }
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
  | { readonly kind: 'responsiveness'; readonly mode: ResponsivenessMode }
  /** A yes towards kicking the member in seat `player`, or with `yes: false` the withdrawal of one. */
  | { readonly kind: 'kick'; readonly player: number; readonly yes: boolean }
  /** `to` names one member's nick, or null for everyone else in the room. `tick` is required for a
   *  snapshot or a save, since the relay serves the frames after it. */
  | ({ readonly kind: 'blob' } & BlobUpload)
  | { readonly kind: 'chat'; readonly text: string }
  /** A map signal for the members in the seats `to` names, the sender's allies as its world sees them;
   *  the relay delivers it to no one else. */
  | { readonly kind: 'signal'; readonly at: SignalNode; readonly to: readonly number[] }
  /** A line for the relay's own chat, said outside a room. */
  | { readonly kind: 'hallChat'; readonly text: string }
  | { readonly kind: 'pong'; readonly t: number };

export type ClientMessageKind = ClientMessage['kind'];

export type ServerMessage =
  | ({ readonly kind: 'responsiveness' } & ResponsivenessState)
  | {
      readonly kind: 'saveOrders';
      readonly id: number;
      readonly tick: number;
      readonly frames: readonly WireFrame[];
    }
  | { readonly kind: 'ended'; readonly tick: number; readonly hash: string }
  /** `build` names the relay's build when its operator gave it one. */
  | { readonly kind: 'welcome'; readonly protocol: number; readonly nick: string; readonly build?: string }
  /** Every room; pushed to a client outside a room when it arrives there and whenever the list changes. */
  | { readonly kind: 'rooms'; readonly rooms: readonly RoomSummary[] }
  /** Who is connected and who left recently, newest first; pushed like `rooms`. */
  | {
      readonly kind: 'presence';
      readonly online: readonly OnlinePlayer[];
      readonly recent: readonly RecentPlayer[];
    }
  | ({ readonly kind: 'hallChat' } & HallChatLine)
  /** The relay's chat, oldest first, as a client arrives outside a room: all it keeps when `replaces`,
   *  otherwise the lines said since the client last heard the hall, to append. */
  | { readonly kind: 'hallChatHistory'; readonly lines: readonly HallChatLine[]; readonly replaces: boolean }
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
  /** A map signal from the member `from` in seat `seat`. Not logged: a member that was away misses it. */
  | { readonly kind: 'signal'; readonly from: string; readonly seat: number; readonly at: SignalNode }
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
