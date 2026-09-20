export { CHEST_KINDS, CHEST_LANDSCAPE_SLUG, type ChestKind } from './components/chest.js';
export * as components from './components/index.js';
export type { MatchOutcome, MatchRulesView } from './components/match.js';
export { BRIEFING_HISTORY_LIMIT } from './components/mission.js';
export type { MissionPresentationView } from './components/mission-presentation.js';
// Fog mode ids, their two settings and the diplomacy stance union, flattened to the package root for
// render and app consumers.
/** The four need bars, the vocabulary the `orderNeed` command addresses one by. */
export type { NeedKind } from './components/needs.js';
export { PAPER_KINDS, type Paper, type PaperKind, PLACING_PAPER_KINDS } from './components/papers.js';
export {
  type DiplomacyState,
  FOG_MODE,
  type FogMode,
  type FogSettings,
  fogModeOf,
  fogSettings,
} from './components/rules.js';
export type { AtomicEffect } from './core/atomic-effect.js';
export type { Brand } from './core/brand.js';
export type { LoggedCommand } from './core/command-queue.js';
export {
  adminCommand,
  aiCommand,
  COMMAND_ENVELOPE_VERSION,
  type Command,
  type CommandEnvelope,
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
export {
  type EntitySnapshot,
  entityById,
  type HomeQualityView,
  homeQualityView,
  takeSnapshot,
  type WorldSnapshot,
} from './inspect/snapshot.js';
export {
  type ChangedEntity,
  type ComponentChange,
  diffSnapshots,
  type SnapshotDiff,
} from './inspect/snapshot-diff.js';
export type { BlockOverlay } from './nav/block-overlay.js';
export {
  cellAnchorNode,
  cellOfAnchorNode,
  cellOfNode,
  type HalfCellNode,
  hexDistanceBetween,
  hexNeighboursOf,
  nodeOfPosition,
  positionOfNode,
} from './nav/halfcell.js';
export { findPath, type SearchStats } from './nav/pathfinding/index.js';
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
  type FogView,
  type SimOptions,
  Simulation,
  type SyncDigest,
  type SystemInstrument,
} from './simulation.js';
export type { ConstructionPlot, PlacementProbe, ResourceNodeSpec } from './systems/footprint/index.js';
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
export * as systems from './systems/public.js';
export type { EquipPickEntry } from './systems/readviews/index.js';
export type { TradeOffer, TraderView, TradeStopView } from './systems/trade/index.js';
export { FOG_STATE } from './systems/vision/index.js';
