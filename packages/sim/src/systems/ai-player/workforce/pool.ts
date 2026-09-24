import { Female, JobAssignment, Settler, TrainingOrder } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isFighterJob, isScoutJob } from '../../readviews/index.js';
import { jobCanBuild } from '../../settlers/atomics/start.js';
import { jobAtomics } from '../../settlers/targets/index.js';
import { ownedSettlers } from '../seat-roster.js';
import { GENERIC_COLLECTOR_TARGET, type WantedGood } from './collectors/index.js';

export interface Workforce {
  /** The spare men the phases draw from, in deterministic classification order. */
  readonly pool: Entity[];
  /** Flag gatherers per good, capped at the good's target; extras fall to `pool`. The phases push
   *  their own hires in, so within-decision counts stay honest before the commands apply. */
  readonly collectorsByGood: Map<number, Entity[]>;
  /** Collect-anything gatherers (a live flag with no good filter), capped at the decision's generic
   *  target. */
  readonly genericCollectors: Entity[];
  readonly scouts: Entity[];
}

/** The lowest builder-trade job in content, or null when the content has no builder. */
export function builderJobOf(ctx: SystemContext): number | null {
  let best: number | null = null;
  for (const job of ctx.content.jobs) {
    if (!jobCanBuild(ctx.content, job.typeId)) continue;
    if (best === null || job.typeId < best) best = job.typeId;
  }
  return best;
}

/** The seat's settlers who are not fighters, women and children included. */
export function civilianCount(world: World, ctx: SystemContext, player: number): number {
  let civilians = 0;
  for (const e of ownedSettlers(world, player)) {
    if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) civilians++;
  }
  return civilians;
}

/** Whether the settler is labour the allocator may move: an adult man, neither a fighter nor committed
 *  to a drill. */
export function isAllocatableMan(world: World, ctx: SystemContext, e: Entity): boolean {
  if (world.has(e, Female) || !isAdultSettler(world, e)) return false;
  if (isFighterJob(ctx.content, world.get(e, Settler).jobType)) return false;
  return !world.has(e, TrainingOrder);
}

/**
 * Classify the seat's adult men: employed workers, the collectors of each wanted good up to its target,
 * the generic collectors and the scouts are recognized in place; everyone else lands in the spare pool.
 */
export function classifyWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  wanted: readonly WantedGood[],
  genericTarget = GENERIC_COLLECTOR_TARGET,
): Workforce {
  const index = contentIndex(ctx.content);
  const pool: Entity[] = [];
  const collectorsByGood = new Map<number, Entity[]>();
  const genericCollectors: Entity[] = [];
  const scouts: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (!isAllocatableMan(world, ctx, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (world.has(e, JobAssignment)) continue; // staffing a building - keep the post
    if (isScoutJob(ctx.content, job)) {
      scouts.push(e);
      continue;
    }
    if (job !== null) {
      const flag = liveWorkFlag(world, e);
      const goodType = flag?.goodType;
      if (goodType !== undefined) {
        const want = wanted.find(
          (w) => w.good.typeId === goodType && jobAtomics(ctx, job).has(w.harvestAtomic),
        );
        const holders = collectorsByGood.get(goodType) ?? [];
        if (want !== undefined && holders.length < want.target) {
          holders.push(e);
          collectorsByGood.set(goodType, holders);
          continue;
        }
      } else if (
        flag !== undefined &&
        index.harvestJobs.has(job) &&
        genericCollectors.length < genericTarget
      ) {
        genericCollectors.push(e);
        continue;
      }
    }
    pool.push(e);
  }
  return { pool, collectorsByGood, genericCollectors, scouts };
}

/**
 * The spare pool one decision draws from, tracking which men are already claimed so two phases never
 * post the same settler. A pick is the first unclaimed member in classification order, so it is
 * deterministic.
 */
export class SpareForce {
  private readonly used = new Set<Entity>();
  constructor(private readonly pool: readonly Entity[]) {}

  take(qualifies?: (e: Entity) => boolean): Entity | null {
    const spare = this.pool.find((e) => !this.used.has(e) && (qualifies === undefined || qualifies(e)));
    if (spare === undefined) return null;
    this.used.add(spare);
    return spare;
  }

  remaining(): Entity[] {
    return this.pool.filter((e) => !this.used.has(e));
  }
}
