import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import type { NavigationLimit } from '../../signposts/index.js';
import type { GossipCandidates } from '../../social/index.js';
import type { InboundSupplyTally } from '../../stores/index.js';
import type { TargetCandidates } from '../targets/index.js';

/** The non-null worker state shared by every economy rung for one idle settler. */
export interface PlannerWorker {
  readonly tribe: number;
  readonly jobType: number;
  readonly experience: ReadonlyMap<number, number>;
  /** The settler's owning player, or `undefined` when neutral. The economy gates unbound targeting on
   *  it, since two players can field the same `tribe`. */
  readonly owner: number | undefined;
}

/**
 * Tick-local inputs that travel together through every economy drive, one value per idle settler.
 * A drive adds only the state unique to its decision, such as a load, workplace, or claim set.
 */
export interface PlannerContext extends PlannerWorker {
  readonly world: World;
  readonly ctx: SystemContext;
  readonly terrain: TerrainGraph;
  readonly entity: Entity;
  readonly here: NodeId;
  readonly targets: TargetCandidates;
  /** Tick-shared tally of units committed to each construction site by live supply errands. */
  readonly inbound: InboundSupplyTally;
  /** This settler's signpost-navigation confinement, or null when unlimited. Every drive gates its
   *  searched targets' interaction cells on it; only a settler's bound targets, its own workplace, flag
   *  or storage binding, stay ungated. */
  readonly limit: NavigationLimit | null;
  /** Tick-shared lazy chat-candidate buckets, so a rung that parks a settler with nothing to do can
   *  offer it the same idle chat the bottom rung runs. */
  readonly gossipCandidates: GossipCandidates;
}
