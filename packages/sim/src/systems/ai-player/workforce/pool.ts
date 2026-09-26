import { Female, JobAssignment, Settler, TrainingOrder } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/work-flag.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isFighterJob, isFisherJob, isScoutJob } from '../../readviews/index.js';
import { jobCanBuild } from '../../settlers/atomics/start.js';
import { jobAtomics } from '../../settlers/targets/index.js';
import { ownedSettlers } from '../seat-roster.js';
import { GENERIC_COLLECTOR_TARGET, type WantedGood } from './collectors/index.js';
import { byExperience, trackExperience } from './experience.js';

export interface Workforce {
  /** The spare men the phases draw from, in deterministic classification order. */
  readonly pool: Entity[];
  /** Flag gatherers per good, most experienced first and capped at the good's target; extras fall to
   *  `pool`. The phases push their own hires in, so within-decision counts stay honest before the
   *  commands apply. */
  readonly collectorsByGood: Map<number, Entity[]>;
  /** Collect-anything gatherers (a live flag with no good filter), capped at the decision's generic
   *  target. */
  readonly genericCollectors: Entity[];
  /** The flag fishers, kept at their water; the fisher module alone re-plants or retires them. */
  readonly fishers: Entity[];
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
 * the generic collectors, the fishers and the scouts are recognized in place; everyone else lands in the
 * spare pool.
 * A good's holders are ranked most experienced first on its `(job, good)` track, ascending id on ties,
 * before the target caps them, so an over-target good hands back its greenest gatherers.
 */
export function classifyWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  wanted: readonly WantedGood[],
  genericTarget = GENERIC_COLLECTOR_TARGET,
): Workforce {
  const index = contentIndex(ctx.content);
  // The pool candidates in the canonical settler walk, flag holders included until their cap is known.
  const spares: Entity[] = [];
  const collectorsByGood = new Map<number, Entity[]>();
  const targets = new Map<number, number>();
  const genericCollectors: Entity[] = [];
  const fishers: Entity[] = [];
  const scouts: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (!isAllocatableMan(world, ctx, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (world.has(e, JobAssignment)) continue; // staffing a building - keep the post
    if (isScoutJob(ctx.content, job)) {
      scouts.push(e);
      continue;
    }
    if (isFisherJob(ctx.content, job)) {
      fishers.push(e);
      continue;
    }
    const flag = job === null ? undefined : liveWorkFlag(world, e);
    if (
      job !== null &&
      flag !== undefined &&
      flag.goodType === undefined &&
      index.harvestJobs.has(job) &&
      genericCollectors.length < genericTarget
    ) {
      genericCollectors.push(e);
      continue;
    }
    spares.push(e);
    const goodType = flag?.goodType;
    if (job === null || goodType === undefined) continue;
    const want = wanted.find((w) => w.good.typeId === goodType && jobAtomics(ctx, job).has(w.harvestAtomic));
    if (want === undefined) continue;
    targets.set(goodType, want.target);
    const holders = collectorsByGood.get(goodType);
    if (holders === undefined) collectorsByGood.set(goodType, [e]);
    else holders.push(e);
  }
  const kept = new Set<Entity>();
  for (const [goodType, holders] of collectorsByGood) {
    const onGood = (e: Entity): number => {
      const job = world.get(e, Settler).jobType;
      return job === null ? 0 : trackExperience(world, ctx, e, job, goodType);
    };
    byExperience(holders, onGood).splice(targets.get(goodType) ?? 0);
    if (holders.length === 0) collectorsByGood.delete(goodType);
    for (const e of holders) kept.add(e);
  }
  const pool = spares.filter((e) => !kept.has(e));
  return { pool, collectorsByGood, genericCollectors, fishers, scouts };
}

/**
 * The spare pool one decision draws from, tracking which men are already claimed so two phases never
 * post the same settler. A pick is the first unclaimed qualifying member in classification order, or with
 * a `rank` the highest-ranked one, the first in that order on a tie, so it is deterministic either way.
 */
export class SpareForce {
  private readonly used = new Set<Entity>();
  constructor(private readonly pool: readonly Entity[]) {}

  take(qualifies?: (e: Entity) => boolean, rank?: (e: Entity) => number): Entity | null {
    let spare: Entity | null = null;
    let best = Number.NEGATIVE_INFINITY;
    for (const e of this.pool) {
      if (this.used.has(e) || (qualifies !== undefined && !qualifies(e))) continue;
      if (rank === undefined) {
        spare = e;
        break;
      }
      const score = rank(e);
      if (score > best) {
        spare = e;
        best = score;
      }
    }
    if (spare !== null) this.used.add(spare);
    return spare;
  }

  /** Whether a `take` with the same test would find someone, without claiming him: a caller pays a
   *  spot search only for a man it can post. */
  any(qualifies?: (e: Entity) => boolean): boolean {
    for (const e of this.pool) {
      if (!this.used.has(e) && (qualifies === undefined || qualifies(e))) return true;
    }
    return false;
  }

  remaining(): Entity[] {
    return this.pool.filter((e) => !this.used.has(e));
  }
}
