import type { ContentSet, EquipCategory } from '@open-northland/data';
import type {
  AssistantCounterValues,
  ConstructionPlot,
  DiplomacyState,
  Entity,
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
  MooringProbe,
  OpenTribute,
  PalisadeGateProbeResult,
  Paper,
  PlacementProbe,
  PlayerPlacementProbe,
  SaveGame,
  ScriptLandscapeType,
  SignpostProbe,
  SimEvent,
  SystemInstrument,
  TradeOffer,
  TraderView,
  UnlockKind,
  UnlockStatus,
  WorldSnapshot,
} from '@open-northland/sim';

/**
 * Everything the running game reads of the world. The runtime (frame loop, HUD, controls, saves,
 * diagnostics) consumes this interface and never the `Simulation` behind it, which a host owns: an
 * entry, a scene, or the inline host over a live sim. Members are grouped by the cadence the runtime
 * reads them at, the split a host off the main thread serves differently.
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
  /** The seat's fog masks, keyed by their `generation`; null with fog off. */
  fogView(player: number): FogView | null;
  constructionPlots(): readonly ConstructionPlot[];
  placementProbe(buildingType: number, player?: number, tribe?: number): PlayerPlacementProbe | null;
  /** Changes when a placement blocker does, not per tick; overlay memos key on it. */
  placementBlockerVersion(): string;
  signpostProbe(player: number): SignpostProbe | null;
  signpostBlockerVersion(): string;
  palisadeProbe(gfxIndex: number): PlacementProbe | null;
  palisadeGateProbe(
    hx: number,
    hy: number,
    closedGateGfxIndexes: readonly number[],
    player?: number,
  ): PalisadeGateProbeResult | null;
  palisadeLayoutVersion(): string;
  palisadeGateSites(closedGateGfxIndexes: readonly number[], player: number): PalisadeGateProbeResult[];
  ownPalisadeNodes(player: number): (hx: number, hy: number) => boolean;
  mooringProbe(vehicle: Entity): MooringProbe | null;
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

  // Per tick.

  /** The events the last stepped tick emitted; read inside the driver's per-tick callback, since the
   *  next step replaces them. */
  tickEvents(): readonly SimEvent[];
  /** Walks every component of every entity: the diag trace's cadence read, never per frame. */
  hashState(): string;

  // Rare, request-shaped.

  unlockStatus(kind: UnlockKind, typeId: number, tribe: number, player?: number): UnlockStatus;
  canChooseJob(entity: Entity, jobType: number): boolean;
  equipPickList(entity: Entity, group: EquipCategory): EquipPickEntry[];
  /** Whether a unit is holding its ground on battle alert. */
  standsTo(entity: Entity): boolean;
  papers(player: number): Paper[];
  /** Whether the pair's stances are locked, so neither seat's declaration changes them. */
  diplomacyLocked(a: number, b: number): boolean;
  /** The units `player`'s traders took out of `partner`'s houses under a trade agreement. */
  goodsTradedWith(player: number, partner: number): number;
  /** The open tributes `payer` owes. */
  openTributes(payer: number): readonly OpenTribute[];
  /** The map agreements `partner`'s houses offer a visiting trader, each once. */
  tradeOffersOf(partner: number): readonly TradeOffer[];
  tradeOffersAt(house: Entity): readonly TradeOffer[];
  traderView(trader: Entity): TraderView | undefined;
  canAttachTradeHouse(trader: Entity, house: Entity): boolean;
  canAttachToVehicle(settler: Entity, vehicle: Entity): boolean;
  missionStatus(): readonly MissionStatus[];
  missionBriefingHistory(): readonly number[];
  missionBriefingPage(): number | null;
  missionHuman(id: number): Entity | null;
  missionPresentation(): MissionPresentationView;
  infoLines(player: number): readonly InfoLineView[];
  landscapeEdits(): LandscapeEditView;
  matchOutcome(player: number): MatchOutcome;
  /** The world alone; a session driver's capture adds the accepted future input. */
  exportSave(options?: ExportSaveOptions): SaveGame;

  // Diagnostics.

  readonly commandLog: readonly LoggedCommand[];
  /** One slot; every consumer of the per-system seam fans out from `installSessionInstruments`. */
  setInstrument(instrument: SystemInstrument | null): void;
  /** Step the world outside the session clock: the cross-engine probes step a paused session by it. */
  run(ticks: number): void;
}
