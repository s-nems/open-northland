export * as components from './components/index.js';
// Fog-of-war mode ids and the diplomacy stance union, flattened to the package root for render and
// app consumers.
export type { MatchOutcome } from './components/match.js';
export { type DiplomacyState, FOG_MODE, type FogMode } from './components/rules.js';
export type { AtomicEffect } from './core/atomic-effect.js';
export type { Brand } from './core/brand.js';
export type { LoggedCommand } from './core/command-queue.js';
export {
  adminCommand,
  aiCommand,
  COMMAND_ENVELOPE_VERSION,
  type Command,
  type CommandEnvelope,
  type PlayerCommand,
  playerCommand,
  type SettlerEquipment,
  type SettlerEquipmentSlot,
  setupCommand,
} from './core/commands/index.js';
export { parseCommandEnvelope, parseCommandLog } from './core/commands/parse.js';
export { constructionBillForType, harvestJobsOf } from './core/content-index.js';
export { EventBuffer, eventNode, type SimEvent, type SimEventKind } from './core/events.js';
export { type Fixed, fx, ONE } from './core/fixed.js';
export { FixedTimestep, MS_PER_TICK, TICKS_PER_SECOND } from './core/loop.js';
export { Rng } from './core/rng.js';
export type { Component, Entity } from './ecs/world.js';
export { World } from './ecs/world.js';
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
  type HalfCellNode,
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
  OLDEST_SUPPORTED_SAVE_VERSION,
  parseSaveGame,
  type RestoredSimulation,
  type RestoreOptions,
  type RngSection,
  restoreSimulation,
  SAVE_FORMAT_VERSION,
  SAVE_KIND,
  SAVE_MAP_KEY,
  type SaveGame,
  type SaveGameHeader,
  type SaveGameSection,
  serializeSaveGame,
} from './save/index.js';
// The idle-adult job key of the HUD population tally: a façade read view, not a system.
export { IDLE_JOB } from './simulation/hud.js';
export { type FogView, type SimOptions, Simulation, type SystemInstrument } from './simulation.js';
export type { ConstructionPlot, PlacementProbe, ResourceNodeSpec } from './systems/footprint/index.js';
// The walk cadence (ticks per visual cell at cruise), exposed so render can tune animation cadence
// independently without restating the sim's travel time.
export { WALK_TICKS_PER_CELL } from './systems/movement/system.js';
export * as systems from './systems/public.js';
export type { EquipPickEntry } from './systems/readviews/index.js';
export { FOG_STATE } from './systems/vision/index.js';
