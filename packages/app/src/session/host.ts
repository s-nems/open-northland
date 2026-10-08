import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  AssistantAudienceKind,
  AssistantCounterValues,
  ConstructionPlot,
  ConstructionSupply,
  DiplomacyState,
  Entity,
  EntitySnapshot,
  EquipPickEntry,
  EquipSelectionPick,
  ExportSaveOptions,
  FogMode,
  FogView,
  FormationSlotGroup,
  HalfCellNode,
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
  SignpostReachView,
  SimEvent,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
  WorkStatus,
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
  /** The tick batches taken in, one message each. */
  readonly batches: number;
  /** How far the sim's thread had stepped past the delivered tick, as its newest batch reported. */
  readonly leadTicks: number;
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
  signpostReachVersion(): string;
  signpostReach(player: number): Promise<SignpostReachView | null>;
  /** Changes when a gate answer may, movers aside. */
  palisadeLayoutVersion(): string;
  /** Changes when a road site answer may. */
  roadSitePlacementVersion(): string;
  /** The directed stance `from` holds toward `to`; a pair never set reads `enemy`. */
  diplomacyStance(from: number, to: number): DiplomacyState;
  hasMetPlayer(viewer: number, other: number): boolean;
  assistantCounters(player: number): Readonly<AssistantCounterValues>;
  /** The good types `player`'s assistant may hand out. */
  assistantGrants(player: number): readonly number[];
  /** The weapon goods `player`'s assistant never arms a recruit with. */
  assistantWeaponVetoes(player: number): readonly number[];
  /** The grant kinds `player`'s assistant hands to fighters alone. */
  assistantSoldierOnlyGrants(player: number): readonly AssistantAudienceKind[];
  /** Whether `player`'s assistant sends graduates straight to a free workplace. */
  assistantPostsGraduates(player: number): boolean;
  /** Whether `player`'s gatherers move their own flags after the resources. */
  assistantMovesFlags(player: number): boolean;
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
   *  `tribe` picks the footprint and, while `gated`, adds the seat's technology gate (a paper waives it). */
  placementProbe(
    buildingType: number,
    area: NodeArea,
    player?: number,
    tribe?: number,
    gated?: boolean,
  ): Promise<NodeGridAnswer | null>;
  /** Fresh formation groups on land, with vehicle commanders retaining the clicked target. */
  formationSlots(
    target: HalfCellNode,
    members: readonly Entity[],
    rowSpacing?: 1 | 2,
  ): Promise<readonly FormationSlotGroup[] | null>;
  signpostProbe(player: number, area: NodeArea): Promise<NodeGridAnswer | null>;
  palisadeProbe(gfxIndex: number, area: NodeArea): Promise<NodeGridAnswer | null>;
  /** Where a road may be ordered over `area`; null for a mapless world. */
  roadSiteProbe(area: NodeArea): Promise<NodeGridAnswer | null>;
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
  /** The tribes `player` may place houses of, its own tribe first. */
  buildTribes(player: number): Promise<readonly number[]>;
  canChooseJob(entity: Entity, jobType: number): Promise<boolean>;
  hasEarnedGood(entity: Entity, goodType: number): Promise<boolean>;
  equipPickList(entity: Entity, group: EquipCategory): Promise<readonly EquipPickEntry[]>;
  /** The selection's equip menu: every good some of `entities` can wear and reach, with its takers. */
  equipPicksForSelection(entities: readonly Entity[]): Promise<readonly EquipSelectionPick[]>;
  /** Whether a unit is holding its ground on battle alert. */
  standsTo(entity: Entity): Promise<boolean>;
  /** Why a tradesman works or stands idle; undefined when no status applies. */
  workStatus(entity: Entity): Promise<WorkStatus | undefined>;
  /** What a building site's bill still lacks and whether the seat holds each missing good; undefined for
   *  anything but a building site. */
  constructionSupply(site: Entity): Promise<ConstructionSupply | undefined>;
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
