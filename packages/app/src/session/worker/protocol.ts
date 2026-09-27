import type { ContentSet } from '@open-northland/data';
import type {
  AssistantCounterValues,
  CommandEnvelope,
  ConstructionPlot,
  DiplomacyState,
  ExportSaveOptions,
  FogMaskAnswer,
  FogMode,
  MatchOutcome,
  MatchRulesView,
  MissionScript,
  MissionStatus,
  ScriptLandscapeType,
  SimEvent,
  SnapshotDelta,
} from '@open-northland/sim';
import type { DiagEntry } from '../../diag/log.js';
import type { SessionHost, TickDiagnostics } from '../host.js';

/**
 * The messages between the runtime and the worker that owns the sim. Everything crossing is plain
 * structured-cloneable data; a request carries an id its reply names. Only the worker's `ticks`
 * messages count against the runtime's bound, and the runtime acknowledges them as it delivers them.
 */

/** How the worker runs the session it builds. */
export interface WorkerSessionOptions {
  readonly speed: number;
  readonly paused: boolean;
  /** The seat whose fog masks the worker posts until the runtime asks for another; null posts none. */
  readonly fogSeat: number | null;
  /** Take the diag cadence's state hashes and invariant checks (`diagCadenceAt`). */
  readonly diagnostics: boolean;
  /** Stop the clock on the tick a sub-mission transition fires, where the single-player frame loop
   *  would have stopped stepping, so the sheet captures that tick. */
  readonly pauseOnSubMission: boolean;
  /** What the worker does once the runtime leaves too many ticks undelivered. */
  readonly undelivered: UndeliveredTicks;
  /** The event kinds a shed tick still delivers, ahead of the next delivered tick's own. */
  readonly retainedEventKinds: readonly SimEvent['kind'][];
}

/**
 * `hold` stops the clock at `leadTickLimit`, a couple of the runtime's frames past the drawn tick, as a
 * local session may: the clock slows to what the runtime draws. `shed` keeps stepping, as a session
 * whose clock another authority runs must, and past `undeliveredTickLimit` drops the oldest undelivered
 * ticks' records: the delta still spans them, so only their events are lost, except the retained kinds.
 */
export type UndeliveredTicks = 'hold' | 'shed';

/** The async `SessionHost` reads the worker answers by calling the same member on the host over its
 *  sim; `hashState`, `run` and `settled` carry the worker's tick and have their own calls. */
export const HOST_REQUESTS = [
  'placementProbe',
  'signpostProbe',
  'palisadeProbe',
  'palisadeGateProbe',
  'palisadeGateSites',
  'ownPalisadeNodes',
  'mooringProbe',
  'unlockStatus',
  'canChooseJob',
  'equipPickList',
  'standsTo',
  'workStatus',
  'papers',
  'diplomacyLocked',
  'goodsTradedWith',
  'openTributes',
  'tradeOffersOf',
  'tradeOffersAt',
  'traderView',
  'tradeHousesAttachableBy',
  'vehiclesAttachableBy',
  'missionBriefingHistory',
  'missionBriefingPage',
  'missionHuman',
  'missionPresentation',
  'infoLines',
  'landscapeEdits',
  'exportSave',
  'commandLog',
] as const satisfies readonly (keyof SessionHost)[];

export type HostRequestName = (typeof HOST_REQUESTS)[number];
export type HostRequests = Pick<SessionHost, HostRequestName>;

export function isHostRequest(name: string): name is HostRequestName {
  return (HOST_REQUESTS as readonly string[]).includes(name);
}

export type WorkerCall =
  | { readonly method: 'host'; readonly name: HostRequestName; readonly args: readonly unknown[] }
  | { readonly method: 'hashState' }
  | { readonly method: 'run'; readonly ticks: number }
  | { readonly method: 'settle' }
  | { readonly method: 'captureSave'; readonly options: ExportSaveOptions }
  | { readonly method: 'profileRows' };

export type ToWorker<B> =
  | { readonly kind: 'boot'; readonly boot: B; readonly options: WorkerSessionOptions }
  /** The runtime drew its first frame: the clock runs from here, as the inline driver's first advance
   *  starts it, so no tick is stepped while the view is still mounting. */
  | { readonly kind: 'start' }
  | { readonly kind: 'submit'; readonly envelope: CommandEnvelope }
  | { readonly kind: 'pause'; readonly paused: boolean }
  | { readonly kind: 'speed'; readonly speed: number }
  /** The runtime delivered this many more `ticks` messages, in a frame that followed the previous one
   *  by `frameMs`. */
  | { readonly kind: 'delivered'; readonly messages: number; readonly frameMs: number }
  | { readonly kind: 'fogSeat'; readonly player: number }
  | { readonly kind: 'instruments'; readonly profile: boolean; readonly spans: boolean }
  | { readonly kind: 'profileReset' }
  | { readonly kind: 'ping' }
  | { readonly kind: 'call'; readonly id: number; readonly call: WorkerCall };

/** An error as it crosses: an `Error` would lose its class, and some engines its stack. */
export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly stack: string | undefined;
}

export function wireError(err: unknown): WireError {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'Error', message: String(err), stack: undefined };
}

/** The error the receiving side throws: the sender's message and stack under the sender's name. */
export function errorFromWire(wire: WireError): Error {
  const error = new Error(wire.message);
  error.name = wire.name;
  if (wire.stack !== undefined) error.stack = wire.stack;
  return error;
}

/** The per-frame reads that are no snapshot component, as the worker last posted them. */
export interface WorldFacts {
  /** The same array while no site changes, which the runtime keeps as its identity. */
  readonly constructionPlots: readonly ConstructionPlot[];
  readonly placementBlockerVersion: string;
  readonly signpostBlockerVersion: string;
  readonly palisadeLayoutVersion: string;
  /** `MAX_PLAYERS` rows of `MAX_PLAYERS` directed stances, row `from`. */
  readonly stances: readonly DiplomacyState[];
  /** The same layout, row `viewer`. */
  readonly met: readonly boolean[];
  /** Indexed by player. */
  readonly assistants: readonly AssistantFacts[];
  readonly needsEnabled: boolean;
  readonly fogMode: FogMode;
  /** Indexed by player. */
  readonly matchOutcomes: readonly MatchOutcome[];
  readonly missionStatus: readonly MissionStatus[];
}

export interface AssistantFacts {
  readonly counters: Readonly<AssistantCounterValues>;
  readonly grants: readonly number[];
  readonly weaponVetoes: readonly number[];
}

/** One stepped tick as the worker saw it. */
export interface TickRecord {
  readonly tick: number;
  readonly events: readonly SimEvent[];
  /** The sim's stepping time for the tick, in the worker. */
  readonly simMs: number;
  /** Taken on the diag cadence when the session asked for diagnostics, else null. */
  readonly diagnostics: TickDiagnostics | null;
}

/** One system's interval, on the worker's clock. */
export interface SystemSpan {
  readonly system: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** A fog change: the viewer seat's masks, or null for fog off. */
export interface FogUpdate {
  readonly fog: FogMaskAnswer | null;
}

/** The ticks the worker stepped since its last batch: one delta spanning them, and each tick's record
 *  in order, so no event is lost when the runtime fell behind. */
export interface TickBatch {
  readonly delta: SnapshotDelta;
  readonly ticks: readonly TickRecord[];
  /** Only the facts that changed since the previous batch. */
  readonly facts: Partial<WorldFacts>;
  readonly fog: FogUpdate | null;
  /** The worker's fixed timestep's monotonic total. */
  readonly droppedTicks: number;
  /** Present while the runtime asked for per-system spans. */
  readonly spans: readonly SystemSpan[] | null;
  /** Ticks since the previous batch whose records the worker shed; they directly precede `ticks`. */
  readonly shedTicks: number;
  /** The most ticks the worker had stepped past the runtime's delivered tick at any of this batch's
   *  steps, counting the batch in flight as undelivered until the runtime says so. */
  readonly leadTicks: number;
}

/** What the runtime reads of the built world before its first frame. */
export interface WorkerReady<E> {
  readonly delta: SnapshotDelta;
  readonly facts: WorldFacts;
  readonly fog: FogMaskAnswer | null;
  readonly content: ContentSet;
  readonly mapFingerprint: string | undefined;
  readonly landscapeTypes: readonly ScriptLandscapeType[];
  readonly missions: MissionScript | undefined;
  readonly matchRules: MatchRulesView;
  readonly seed: number;
  readonly maxStepsPerFrame: number;
  /** The worker clock's origin, which places its spans on the runtime's clock. */
  readonly timeOrigin: number;
  /** How long the worker took to build the world from its boot message. */
  readonly buildMs: number;
  /** What the worker logged while it built the world, for the runtime's own log. */
  readonly log: readonly DiagEntry[];
  /** What the world's builder hands the runtime beside the sim. */
  readonly extras: E;
}

export type FromWorker<E> =
  | { readonly kind: 'ready'; readonly ready: WorkerReady<E> }
  | { readonly kind: 'bootFailed'; readonly error: WireError; readonly log: readonly DiagEntry[] }
  | { readonly kind: 'ticks'; readonly batch: TickBatch }
  | { readonly kind: 'fog'; readonly update: FogUpdate }
  | {
      readonly kind: 'reply';
      readonly id: number;
      /** The worker's tick when it answered. */
      readonly tick: number;
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly kind: 'reply';
      readonly id: number;
      readonly tick: number;
      readonly ok: false;
      readonly error: WireError;
    }
  | { readonly kind: 'tickError'; readonly error: WireError }
  | { readonly kind: 'pong' };
