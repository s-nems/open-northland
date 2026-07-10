export { Simulation, type SimOptions, spawnAt } from './simulation.js';
export { World, defineComponent } from './ecs/world.js';
export type { Entity, Component } from './ecs/world.js';
export { Rng } from './core/rng.js';
export { fx, ONE, type Fixed } from './core/fixed.js';
export { FixedTimestep, TICKS_PER_SECOND, MS_PER_TICK } from './core/loop.js';
export * as components from './components/index.js';
export * as systems from './systems/index.js';
export type { PlacementProbe, ResourceNodeSpec } from './systems/footprint/index.js';
export {
  scenario,
  Scenario,
  type ScenarioOptions,
  type ScenarioResult,
  type RunOptions,
} from './harness/scenario.js';
export type { Brand } from './core/brand.js';
export { assertNever } from './core/brand.js';
export {
  type Command,
  type AtomicEffect,
  type LoggedCommand,
  type SettlerEquipment,
  type SettlerEquipmentSlot,
  CommandQueue,
} from './core/commands.js';
export { EventBuffer, type SimEvent, type SimEventKind } from './core/events.js';
export { takeSnapshot, type WorldSnapshot, type EntitySnapshot } from './inspect/snapshot.js';
export {
  diffSnapshots,
  type SnapshotDiff,
  type ChangedEntity,
  type ComponentChange,
} from './inspect/snapshot-diff.js';
export {
  dumpEntity,
  traceEntity,
  type EntityDump,
  type EntityTraceStep,
} from './inspect/entity-dump.js';
export {
  TerrainGraph,
  buildTerrainGraph,
  nodeLatticeDistance,
  halfCellMapFromCells,
  type NodeId,
  type CellTerrainMap,
  type TerrainMap,
} from './nav/terrain.js';
export {
  cellAnchorNode,
  nodeOfPosition,
  positionOfNode,
  type HalfCellNode,
} from './nav/halfcell.js';
export { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW, worldDistance } from './nav/metric.js';
export { findPath } from './nav/pathfinding.js';
export { replay, type ReplayOptions } from './replay/replay.js';
export {
  HashTrace,
  type HashTraceEntry,
  type HashTraceOptions,
  type Divergence,
} from './inspect/hashtrace.js';
export {
  localizeDivergence,
  type DivergenceReport,
  type RunReplay,
} from './replay/localize-divergence.js';
export { scrubWindow } from './replay/scrub-window.js';
export {
  rebaseContent,
  type RebaseInputs,
  type RebaseResult,
} from './replay/rebase-content.js';
export { seedAnimalHerds, type SeedAnimalsOptions } from './harness/populate.js';
export {
  checkInvariants,
  CORE_INVARIANTS,
  type Invariant,
  stockNonNegative,
  hungerInRange,
  fatigueInRange,
  pietyInRange,
  enjoymentInRange,
  buildingSane,
  cachesCoherent,
  populationWithinHousing,
} from './harness/invariants.js';
