export type { AssistantCounterValues } from './components/assistant.js';
export { CHEST_KINDS, CHEST_LANDSCAPE_SLUG, type ChestKind } from './components/chest.js';
export {
  PRODUCTION_COUNT_MAX,
  PRODUCTION_UNLIMITED,
  type ProductionCount,
  productionCountOf,
} from './components/economy/production.js';
export * as components from './components/index.js';
export type { MatchOutcome, MatchRulesView } from './components/match.js';
export { BRIEFING_HISTORY_LIMIT } from './components/mission.js';
export type { MissionPresentationView } from './components/mission-presentation.js';
// Fog mode ids, their two settings and the diplomacy stance union, flattened to the package root for
// render and app consumers.
/** The four need bars, the vocabulary the `orderNeed` command addresses one by. */
export type { NeedKind } from './components/needs.js';
export { PAPER_KINDS, type Paper, type PaperKind, PLACING_PAPER_KINDS } from './components/papers.js';
export { buildTribes } from './components/player-placement.js';
export { roadShardKey } from './components/roads.js';
export {
  type DiplomacyState,
  FOG_MODE,
  type FogMode,
  type FogSettings,
  fogModeOf,
  fogSettings,
} from './components/rules.js';
export {
  type NeedDrain,
  type NeedLevels,
  SETTLER_NAME_MAX_CHARS,
  type SettlerNeedsView,
} from './components/settler.js';
export { WALK_RANGE_NODES } from './components/signpost.js';
export { TRADE_LIMIT_NONE, TRADE_ROUTE_HOUSES, type TradeImportMark } from './components/trade.js';
export type { UnlockKind } from './components/unlocks.js';
export type { AtomicEffect } from './core/atomic-effect.js';
export type { Brand } from './core/brand.js';
export type { LoggedCommand } from './core/command-queue.js';
export {
  adminCommand,
  aiCommand,
  COMMAND_ENVELOPE_VERSION,
  type Command,
  type CommandEnvelope,
  type GroupMember,
  type GroupWorker,
  orderedSettler,
  ownedEnvelope,
  type PlayerCommand,
  playerCommand,
  type SettlerEquipment,
  type SettlerEquipmentSlot,
  setupCommand,
} from './core/commands/index.js';
export { parseCommandEnvelope, parseCommandLog } from './core/commands/parse.js';
export {
  buildingLevelForType,
  constructionBillForType,
  harvestJobsOf,
  jobAllowsAtomic,
} from './core/content-index.js';
export { EventBuffer, eventNode, type SimEvent, type SimEventKind } from './core/events.js';
export { type Fixed, fx, ONE } from './core/fixed.js';
export { FixedTimestep, MS_PER_TICK, TICKS_PER_SECOND } from './core/loop.js';
export { Rng } from './core/rng.js';
export type { Component, Entity, MutationSink, SyncDomain } from './ecs/world.js';
export { SYNC_DOMAINS, World } from './ecs/world.js';
export { CORE_INVARIANTS, checkInvariants, type Invariant } from './harness/invariants.js';
export { type SeedAnimalsOptions, seedAnimalHerds } from './harness/populate.js';
export {
  type RunOptions,
  type ScenarioOptions,
  type ScenarioResult,
  scenario,
} from './harness/scenario.js';
export { type DigestInputDifference, diffDigestInputs } from './inspect/digest-inputs-diff.js';
export {
  type DigestComponentInputsJson,
  digestInputsFromJson,
  digestInputsToJson,
  type SyncDigestInputsJson,
} from './inspect/digest-inputs-json.js';
export {
  type DeltaDigest,
  type DigestMismatch,
  MirrorTruth,
} from './inspect/entity-digest.js';
export {
  dumpEntity,
  type EntityDump,
  type EntityTraceStep,
  traceEntity,
} from './inspect/entity-dump.js';
export {
  type Divergence,
  HashTrace,
  type HashTraceEntry,
  type HashTraceOptions,
} from './inspect/hashtrace.js';
export { type HouseholdGoodPolicyView, householdGoodPolicyView } from './inspect/household-policy.js';
export {
  type EntitySnapshot,
  entityById,
  type HomeQualityView,
  homeQualityView,
  indexOfEntity,
  indexOfEntityFrom,
  takeSnapshot,
  type WorldSnapshot,
} from './inspect/snapshot.js';
export {
  cloneEvents,
  SnapshotDeltaStream,
  type SnapshotDeltaStreamOptions,
} from './inspect/snapshot-clones.js';
export {
  type EntityChange,
  type EntityDelta,
  type EntitySnapshotDelta,
  entityDeltas,
  packSnapshotDelta,
  type SnapshotDelta,
} from './inspect/snapshot-delta.js';
export {
  type ChangedEntity,
  type ComponentChange,
  diffSnapshots,
  type SnapshotDiff,
} from './inspect/snapshot-diff.js';
export {
  collectPositioned,
  countedBy,
  EntityGroups,
  entitiesWith,
  firstDifference,
  groupedBy,
  indexesOf,
  isPositioned,
  listedWhere,
  positionedWithin,
  type SnapshotIndexReader,
  type SnapshotIndexReads,
  type SnapshotIndexSpec,
  withComponent,
} from './inspect/snapshot-indexes.js';
export { SnapshotMirror } from './inspect/snapshot-mirror.js';
export { TILE_BUCKET_SIZE, type TileBox, TileBuckets } from './inspect/tile-buckets.js';
export type { BlockOverlay } from './nav/block-overlay.js';
export { ClearanceField, MAX_CLEARANCE_CLASS } from './nav/clearance.js';
export {
  cellAnchorNode,
  cellOfAnchorNode,
  cellOfNode,
  type HalfCellNode,
  hexDistanceBetween,
  hexNeighboursOf,
  type NodeArea,
  nodeOfPosition,
  positionOfNode,
} from './nav/halfcell.js';
export { findPath, type SearchStats } from './nav/pathfinding/index.js';
export { type ReachArea, reachContains, unionReachAreas } from './nav/range-search.js';
export {
  buildTerrainGraph,
  type CellTerrainMap,
  halfCellMapFromCells,
  type NodeId,
  nodeLatticeDistance,
  TerrainGraph,
  type TerrainMap,
} from './nav/terrain/index.js';
export type {
  LandscapeRemovalGroup,
  ScriptLandscapePlacement,
  ScriptLandscapeType,
} from './nav/terrain/landscapes.js';
export { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW, worldDistance } from './nav/world-metric.js';
export { type DivergenceReport, localizeDivergence } from './replay/localize-divergence.js';
export {
  type RebaseInputs,
  type RebaseResult,
  rebaseContent,
} from './replay/rebase-content.js';
export { type ReplayOptions, type RunReplay, replay, stepReplaying } from './replay/replay.js';
export { scrubWindow } from './replay/scrub-window.js';
export {
  type CommandsSection,
  type ComponentSection,
  type EntitiesSection,
  type ExportSaveOptions,
  exportSaveGame,
  type FogSection,
  parseSaveGame,
  type RestoreOptions,
  type RngSection,
  restoreSimulation,
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  SAVE_MAP_KEY,
  type SavedCommand,
  type SaveGame,
  type SaveGameHeader,
  type SaveGameSection,
  serializeSaveGame,
  withSaveContinuation,
} from './save/index.js';
// The idle-adult job key of the HUD population tally: a façade read view, not a system.
export { IDLE_JOB } from './simulation/hud.js';
export {
  type MooringAnswer,
  NODE_SET_STRIDE,
  type NodeGridAnswer,
  type NodeSetAnswer,
  nodeGridAccepts,
  nodeGridUpgradeReserve,
  nodeSetHas,
} from './simulation/probe-answers.js';
export { fogViewOfMask } from './simulation/read-seams.js';
export {
  type DigestComponentInputs,
  type FogMaskAnswer,
  type FogView,
  type SimOptions,
  Simulation,
  type SyncDigest,
  type SyncDigestInputs,
  type SystemInstrument,
} from './simulation.js';
export type { PlayerPlacementProbe } from './systems/conflict/contested-ground.js';
export type { GatheringTrade } from './systems/economy/gather-goods.js';
export type { ConstructionPlot, PlacementProbe, ResourceNodeSpec } from './systems/footprint/index.js';
export type { LandscapeEditView } from './systems/landscape/view.js';
export { RUIN_COLLAPSE_TICKS } from './systems/lifecycle/ruins.js';
export type {
  InfoLineView,
  MissionDefinition,
  MissionGoalOp,
  MissionHouseRef,
  MissionResultOp,
  MissionScript,
  MissionStatus,
  OpenTribute,
  ResolvedOp,
} from './systems/missions/index.js';
export {
  MISSION_HOUSE_NAME_FIELD,
  MISSION_LANDSCAPE_NAME_FIELD,
  SUCCESSFUL_IF,
} from './systems/missions/index.js';
// The walk cadence (ticks per visual cell at cruise), exposed so render can tune animation cadence
// independently without restating the sim's travel time.
export type { PalisadeGateProbeResult } from './systems/palisades/index.js';
export type { UnlockStatus } from './systems/progression/index.js';
export * as systems from './systems/public.js';
export type { HerdWait } from './systems/readviews/herd-hold.js';
export type { EquipPickEntry, MilitaryMode } from './systems/readviews/index.js';
export type { WorkStatus } from './systems/readviews/work-status.js';
export type { SignpostProbe } from './systems/signposts/index.js';
export type { SignpostReachPost, SignpostReachView } from './systems/signposts/reach.js';
export { heapReach } from './systems/stores/seat-stock.js';
export type { TradeOffer, TraderView, TradeStopView } from './systems/trade/index.js';
export type { MooringProbe, VehicleStockView, VehicleView } from './systems/vehicles/index.js';
export { FOG_STATE } from './systems/vision/index.js';
