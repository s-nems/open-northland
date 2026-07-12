export * as components from './components/index.js';
// Fog-of-war: the mode ids + the per-cell mask states, exported top-level so render/app consumers
// (the fog wash, the sprite cull, the minimap) read the contract without the `systems` namespace.
export { FOG_MODE } from './components/rules.js';
export type { Brand } from './core/brand.js';
export { assertNever } from './core/brand.js';
export {
  type AtomicEffect,
  type Command,
  CommandQueue,
  type LoggedCommand,
  type SettlerEquipment,
  type SettlerEquipmentSlot,
} from './core/commands.js';
export { EventBuffer, type SimEvent, type SimEventKind } from './core/events.js';
export { type Fixed, fx, ONE } from './core/fixed.js';
export { FixedTimestep, MS_PER_TICK, TICKS_PER_SECOND } from './core/loop.js';
export { Rng } from './core/rng.js';
export type { Component, Entity } from './ecs/world.js';
export { defineComponent, World } from './ecs/world.js';
export {
  buildingSane,
  CORE_INVARIANTS,
  cachesCoherent,
  checkInvariants,
  enjoymentInRange,
  fatigueInRange,
  hungerInRange,
  type Invariant,
  pietyInRange,
  populationWithinHousing,
  stockNonNegative,
} from './harness/invariants.js';
export { type SeedAnimalsOptions, seedAnimalHerds } from './harness/populate.js';
export {
  type RunOptions,
  Scenario,
  type ScenarioOptions,
  type ScenarioResult,
  scenario,
} from './harness/scenario.js';
export { clearComponentStores } from './harness/stores.js';
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
export { type EntitySnapshot, takeSnapshot, type WorldSnapshot } from './inspect/snapshot.js';
export {
  type ChangedEntity,
  type ComponentChange,
  diffSnapshots,
  type SnapshotDiff,
} from './inspect/snapshot-diff.js';
export {
  cellAnchorNode,
  type HalfCellNode,
  nodeOfPosition,
  positionOfNode,
} from './nav/halfcell.js';
export { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW, worldDistance } from './nav/metric.js';
export { findPath, type SearchStats } from './nav/pathfinding.js';
export {
  type BlockOverlay,
  buildTerrainGraph,
  type CellTerrainMap,
  halfCellMapFromCells,
  type NodeId,
  nodeLatticeDistance,
  TerrainGraph,
  type TerrainMap,
} from './nav/terrain.js';
export {
  type DivergenceReport,
  localizeDivergence,
  type RunReplay,
} from './replay/localize-divergence.js';
export {
  type RebaseInputs,
  type RebaseResult,
  rebaseContent,
} from './replay/rebase-content.js';
export { type ReplayOptions, replay } from './replay/replay.js';
export { scrubWindow } from './replay/scrub-window.js';
export { type FogView, type SimOptions, Simulation, spawnAt } from './simulation.js';
export type { ConstructionPlot, PlacementProbe, ResourceNodeSpec } from './systems/footprint/index.js';
export * as systems from './systems/index.js';
// The walk cadence (ticks per visual cell at cruise) — public so the render's walk-cycle clock can
// stay in exact step with the sim's gait instead of restating the number.
export { WALK_TICKS_PER_CELL } from './systems/movement/movement.js';
export { FOG_STATE } from './systems/vision/index.js';
