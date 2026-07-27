import { Female, JobAssignment, Settler, TrainingOrder } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isFighterJob, isScoutJob } from '../../readviews/index.js';
import { jobCanBuild } from '../../settlers/atomics/start.js';
import { jobAtomics } from '../../settlers/targets/index.js';
import { ownedSettlers } from '../shared.js';
import { GENERIC_COLLECTOR_TARGET, type WantedGood } from './collectors.js';

/** The seat's adult men sorted into the workforce this decision allocates: the recognized
 *  collectors (by good type), generic collectors, and scouts kept in place, and everyone else in the
 *  spare `pool`. */
export interface Workforce {
  /** The builder pool the phases draw from, in classification (deterministic) order. */
  readonly pool: Entity[];
  /** Recognized flag gatherers per good, in classification order, capped at the good's target —
   *  extras fall to the pool (self-healing). The phases push their own hires in, so within-decision
   *  counts stay honest before the commands apply. */
  readonly collectorsByGood: Map<number, Entity[]>;
  /** Collect-anything gatherers (a live flag with no good filter), capped at
   *  {@link GENERIC_COLLECTOR_TARGET}. */
  readonly genericCollectors: Entity[];
  readonly scouts: Entity[];
}

/** The lowest builder-trade job in content, or null when the content has no builder. */
export function builderJobOf(ctx: SystemContext): number | null {
  let best: number | null = null;
  for (const job of ctx.content.jobs) {
    if (!jobCanBuild(ctx, job.typeId)) continue;
    if (best === null || job.typeId < best) best = job.typeId;
  }
  return best;
}

/**
 * Classify the seat's adult men: employed workers keep their post, the collectors of each wanted
 * good — up to its target — the generic collectors, and the scouts are recognized in place, and
 * everyone else (civilians, stray trades, surplus collectors) lands in the spare pool — the builder
 * pool of the plan. Soldiers stay soldiers: the allocator governs civilians only.
 */
export function classifyWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  wanted: readonly WantedGood[],
): Workforce {
  const index = contentIndex(ctx.content);
  const pool: Entity[] = [];
  const collectorsByGood = new Map<number, Entity[]>();
  const genericCollectors: Entity[] = [];
  const scouts: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (isFighterJob(ctx.content, job)) continue;
    if (world.has(e, TrainingOrder)) continue; // committed to a barracks drill — no longer spare
    if (world.has(e, JobAssignment)) continue; // staffing a building — keep the post
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
        genericCollectors.length < GENERIC_COLLECTOR_TARGET
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
 * The spare builder pool this decision draws from, tracking which men are already claimed so two phases
 * never post the same settler. {@link take} hands out the first unclaimed member (in classification
 * order, so the pick is deterministic) that clears an optional filter; {@link remaining} lists the men
 * still unclaimed after the phases run.
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
