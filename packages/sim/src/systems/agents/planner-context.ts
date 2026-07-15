import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import type { InboundSupplyTally } from '../stores/index.js';
import type { TargetCandidates } from './targets/index.js';

/** The non-null worker state shared by every economy rung for one idle settler. */
export interface PlannerWorker {
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: ReadonlyMap<number, number>;
  /** The settler's owning player, or `undefined` when neutral (every golden fixture). The SIDE key the
   *  economy gates unbound targeting on — a settler builds/staffs/supplies only its own player's
   *  buildings, since two players can field the same `tribe` (see {@link import('../../components/ownership.js').ownerOf}). */
  readonly owner: number | undefined;
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
  /** Tick-shared construction inbound-supply tally, seeded from live {@link import('../../components/settler.js').SupplyRun}
   *  errands and kept in lockstep as the pass stamps/releases them — the hoisted form of a per-call
   *  SupplyRun scan (see {@link InboundSupplyTally}). */
  readonly inbound: InboundSupplyTally;
}
