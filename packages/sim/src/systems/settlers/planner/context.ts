import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { type NavigationLimit, rankFromNode, rankFromSpot } from '../../signposts/index.js';
import type { GossipCandidates } from '../../social/index.js';
import type { RankFrom } from '../../spatial/walk-rank.js';
import type { SupplyTally } from '../../stores/index.js';
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
  /** Tick-shared tally of the units live errands commit to each destination and claim at each source. */
  readonly supply: SupplyTally;
  /** This settler's signpost-navigation confinement, or null when unlimited. Every drive gates its
   *  searched targets' interaction cells on it; only a settler's bound targets, its own workplace, flag
   *  or storage binding, stay ungated. */
  readonly limit: NavigationLimit | null;
  /** Tick-shared lazy chat-candidate buckets, so a rung that parks a settler with nothing to do can
   *  offer it the same idle chat the bottom rung runs. */
  readonly gossipCandidates: GossipCandidates;
}

/**
 * What `plan`'s settler ranks a search's candidates from at `node`: its own spot unless given, or a flag,
 * a door or a mooring it works outward from. The walk its confinement measures from there, or the node, by
 * distance, for a settler nothing confines and a spot no walk starts from.
 */
export function planRank(
  plan: Pick<PlannerContext, 'world' | 'ctx' | 'terrain' | 'jobType' | 'owner' | 'here' | 'limit'>,
  node: NodeId = plan.here,
): RankFrom {
  if (plan.limit === null) return node;
  if (node === plan.here) return rankFromSpot(plan.limit, node);
  return rankFromNode(plan.world, plan.ctx.content, plan.terrain, plan.jobType, plan.owner, node);
}

/** A {@link PlannerContext} whose per-settler fields the ladder rewrites for each plan, so a pass
 *  allocates one. A drive must not keep it past the plan it was handed for. */
export type PlannerContextSlot = { -readonly [K in keyof PlannerContext]: PlannerContext[K] };
