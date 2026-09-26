import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  AssistantCounterValues,
  ConstructionPlot,
  DiplomacyState,
  Entity,
  EntitySnapshot,
  EquipPickEntry,
  ExportSaveOptions,
  FogMode,
  FogView,
  InfoLineView,
  LandscapeEditView,
  LoggedCommand,
  MatchOutcome,
  MissionPresentationView,
  MissionScript,
  MissionStatus,
  MooringAnswer,
  NodeArea,
  NodeGridAnswer,
  NodeSetAnswer,
  OpenTribute,
  PalisadeGateProbeResult,
  Paper,
  SaveGame,
  ScriptLandscapeType,
  SimEvent,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
  WorldSnapshot,
} from '@open-northland/sim';
import type { SystemProfileRow } from '../diag/system-profile.js';

/** A state hash and the tick it was taken at. */
export interface StateHash {
  readonly tick: number;
  readonly hash: string;
}

/** What the diag cadence reads of one tick (`diagCadenceAt`): its state hash, and the invariant
 *  violations on a tick the cadence checks them, else null. */
export interface TickDiagnostics {
  readonly hash: string;
  readonly violations: readonly string[] | null;
}

/** Receives one system's interval of a tick, in milliseconds on this thread's clock. */
export type SystemSpanSink = (system: string, startMs: number, endMs: number) => void;

export interface InstrumentRequest {
  /** Keep a running per-system profile. */
  readonly profile: boolean;
  readonly spans: SystemSpanSink | null;
}

/** What the ticks a driver's last `advance` delivered cost, for a sim on another thread: its own
 *  stepping time there, and this thread's cost of taking them in. */
export interface OffThreadTickCost {
  readonly simMs: number;
  readonly receiveMs: number;
}

/** The running per-system profile, kept where the sim runs. */
export interface ProfileSource {
  rows(): Promise<readonly SystemProfileRow[]>;
  reset(): void;
}

/**
 * Everything the running game reads of the world. The runtime (frame loop, HUD, controls, saves,
 * diagnostics) consumes this interface and never the `Simulation` behind it, which a host owns: an
 * entry, a scene, or the inline host over a live sim. Members are grouped by the cadence the runtime
 * reads them at. A per-frame member answers synchronously from what a host keeps beside its snapshot;
 * everything else answers a Promise of structured-cloneable data, so a host may run the sim on another
 * thread. A synchronous consumer of an asynchronous read goes through a `LastAnswerCache`.
 */
export interface SessionHost {
  // Session inputs, fixed for the session.

  readonly content: ContentSet;
  /** Identity of the navigated grid, for a save's map check; undefined for a mapless world. */
  readonly mapFingerprint: string | undefined;
  /** The map's landscape catalog rows: the wall and gate types the palisade tools pick from. */
  readonly landscapeTypes: readonly ScriptLandscapeType[];
  /** The map's mission script; undefined for a world that runs none. */
  readonly missions: MissionScript | undefined;

  // Per frame, synchronous.

  readonly tick: number;
  /** The same object while the tick and the world's mutation version hold; memoize by its identity. */
  snapshot(): WorldSnapshot;
  /** The entities that left the world between the previous `snapshot()` and the current one, ascending
   *  by id, as the previous snapshot held them: a settler reaped this frame is named from here. */
  departed(): readonly EntitySnapshot[];
  /** The seat's fog masks, keyed by their `generation`; null with fog off. */
  fogView(player: number): FogView | null;
  constructionPlots(): readonly ConstructionPlot[];
  /** Changes when a placement blocker does, not per tick; building, wall and mooring answers follow it. */
  placementBlockerVersion(): string;
  /** Changes when a signpost answer may. */
  signpostBlockerVersion(): string;
  /** Changes when a gate answer may, movers aside. */
  palisadeLayoutVersion(): string;
  /** The directed stance `from` holds toward `to`; a pair never set reads `enemy`. */
  diplomacyStance(from: number, to: number): DiplomacyState;
  hasMetPlayer(viewer: number, other: number): boolean;
  assistantCounters(player: number): Readonly<AssistantCounterValues>;
  /** The good types `player`'s assistant may hand out. */
  assistantGrants(player: number): readonly number[];
  /** The weapon goods `player`'s assistant never arms a recruit with. */
  assistantWeaponVetoes(player: number): readonly number[];
  needsEnabled(): boolean;
  fogMode(): FogMode;
  matchOutcome(player: number): MatchOutcome;
  missionStatus(): readonly MissionStatus[];

  // Per tick.

  /** The events the last stepped tick emitted; read inside the driver's per-tick callback, since the
   *  next step replaces them. */
  tickEvents(): readonly SimEvent[];
  /** The diag cadence's reads of the tick the per-tick callback delivers, as they stood at that tick;
   *  rejects on a tick off the cadence. */
  tickDiagnostics(): Promise<TickDiagnostics>;
  /** Walks every component of every entity, so never per frame; answers for the tick the sim stands
   *  at, which a host off this thread may have stepped past `tick`. */
  hashState(): Promise<StateHash>;

  // Probes: the placement rules as data over a node area, or null for a mapless world.

  /** The `placeBuilding` rule; with a `player` it also refuses the ground a hostile army contests, and a
   *  `tribe` adds the seat's technology gate. */
  placementProbe(
    buildingType: number,
    area: NodeArea,
    player?: number,
    tribe?: number,
  ): Promise<NodeGridAnswer | null>;
  signpostProbe(player: number, area: NodeArea): Promise<NodeGridAnswer | null>;
  palisadeProbe(gfxIndex: number, area: NodeArea): Promise<NodeGridAnswer | null>;
  palisadeGateProbe(
    hx: number,
    hy: number,
    closedGateGfxIndexes: readonly number[],
    player?: number,
  ): Promise<PalisadeGateProbeResult | null>;
  palisadeGateSites(
    closedGateGfxIndexes: readonly number[],
    player: number,
  ): Promise<readonly PalisadeGateProbeResult[]>;
  /** The nodes `player`'s walls, gates and wall sites stand on. */
  ownPalisadeNodes(player: number): Promise<NodeSetAnswer>;
  /** Null for a vehicle that takes no dock order. */
  mooringProbe(vehicle: Entity): Promise<MooringAnswer | null>;

  // Request-shaped.

  unlockStatus(kind: UnlockKind, typeId: number, tribe: number, player?: number): Promise<UnlockStatus>;
  canChooseJob(entity: Entity, jobType: number): Promise<boolean>;
  equipPickList(entity: Entity, group: EquipCategory): Promise<readonly EquipPickEntry[]>;
  /** Whether a unit is holding its ground on battle alert. */
  standsTo(entity: Entity): Promise<boolean>;
  papers(player: number): Promise<readonly Paper[]>;
  /** Whether the pair's stances are locked, so neither seat's declaration changes them. */
  diplomacyLocked(a: number, b: number): Promise<boolean>;
  /** The units `player`'s traders took out of `partner`'s houses under a trade agreement. */
  goodsTradedWith(player: number, partner: number): Promise<number>;
  /** The open tributes `payer` owes. */
  openTributes(payer: number): Promise<readonly OpenTribute[]>;
  /** The map agreements `partner`'s houses offer a visiting trader, each once. */
  tradeOffersOf(partner: number): Promise<readonly TradeOffer[]>;
  tradeOffersAt(house: Entity): Promise<readonly TradeOffer[]>;
  traderView(trader: Entity): Promise<TraderView | undefined>;
  /** The houses the `attachTradeHouse` command would put on the trader's route now, ascending. */
  tradeHousesAttachableBy(trader: Entity): Promise<readonly Entity[]>;
  /** The vehicles the `attachToVehicle` command would seat the settler on now, ascending. */
  vehiclesAttachableBy(settler: Entity): Promise<readonly Entity[]>;
  missionBriefingHistory(): Promise<readonly number[]>;
  missionBriefingPage(): Promise<number | null>;
  missionHuman(id: number): Promise<Entity | null>;
  missionPresentation(): Promise<MissionPresentationView>;
  infoLines(player: number): Promise<readonly InfoLineView[]>;
  landscapeEdits(): Promise<LandscapeEditView>;
  /** The world alone; a session driver's capture adds the accepted future input. */
  exportSave(options?: ExportSaveOptions): Promise<SaveGame>;

  // Diagnostics.

  commandLog(): Promise<readonly LoggedCommand[]>;
  /** One slot; every consumer of the per-system seam fans out from `installSessionInstruments`. Null
   *  when no profile was asked for. */
  installInstruments(request: InstrumentRequest): ProfileSource | null;
  /** Step the world outside the session clock: the cross-engine probes step a paused session by it.
   *  Resolves once `tick` shows the last of them, which needs the frame loop running. */
  run(ticks: number): Promise<void>;
  /** Resolves once `tick` shows every tick the sim had stepped when asked, which needs the frame loop
   *  running: after a pause it reads the tick the session stopped on. */
  settled(): Promise<void>;
}
