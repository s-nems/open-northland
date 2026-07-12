import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import type { TargetCandidates } from './targets/index.js';

/** The non-null worker state shared by every economy rung for one idle settler. */
export interface PlannerWorker {
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: ReadonlyMap<number, number>;
}

/**
 * Tick-local inputs that travel together through every economy drive. The planner creates one value
 * per idle settler; individual drives add only the state unique to their decision (a load, workplace,
 * or claim set). Keeping this context immutable makes the shared deterministic inputs explicit without
 * introducing another world-owned cache or mutable service.
 */
export interface PlannerContext extends PlannerWorker {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly entity: Entity;
  readonly here: NodeId;
  readonly targets: TargetCandidates;
}
