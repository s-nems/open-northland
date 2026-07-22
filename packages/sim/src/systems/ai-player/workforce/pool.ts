import { Female, JobAssignment, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { jobCanBuild } from '../../agents/actions.js';
import { jobAtomics } from '../../agents/targets/index.js';
import type { SystemContext } from '../../context.js';
import { liveWorkFlag } from '../../economy/flags.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isFighterJob } from '../../readviews/index.js';
import { SCOUT_JOB } from '../../readviews/stances.js';
import { ownedSettlers } from '../shared.js';
import type { WantedGood } from './collectors.js';

/** The seat's adult non-fighter men sorted into the workforce this decision allocates: the recognized
 *  collectors (by good type) and scouts kept in place, and everyone else in the spare `pool`. */
export interface Workforce {
  /** The builder pool the phases draw from, in classification (deterministic) order. */
  readonly pool: Entity[];
  readonly collectorByGood: Map<number, Entity>;
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
 * Classify the seat's adult non-fighter men: employed workers keep their post, the current collector of
 * each wanted good and the scouts are recognized in place, and everyone else (civilians, stray trades,
 * duplicate collectors) lands in the spare pool — the builder pool of the plan. Soldiers stay soldiers:
 * the reset covers civilians only.
 */
export function classifyWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  wanted: readonly WantedGood[],
): Workforce {
  const pool: Entity[] = [];
  const collectorByGood = new Map<number, Entity>();
  const scouts: Entity[] = [];
  for (const e of ownedSettlers(world, player)) {
    if (world.has(e, Female) || !isAdultSettler(world, e)) continue;
    const job = world.get(e, Settler).jobType;
    if (isFighterJob(job)) continue;
    if (world.has(e, JobAssignment)) continue; // staffing a building — keep the post
    if (job === SCOUT_JOB) {
      scouts.push(e);
      continue;
    }
    if (job !== null) {
      const goodType = liveWorkFlag(world, e)?.goodType;
      if (
        goodType !== undefined &&
        !collectorByGood.has(goodType) &&
        wanted.some((w) => w.good.typeId === goodType && jobAtomics(ctx, job).has(w.harvestAtomic))
      ) {
        collectorByGood.set(goodType, e);
        continue;
      }
    }
    pool.push(e);
  }
  return { pool, collectorByGood, scouts };
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
