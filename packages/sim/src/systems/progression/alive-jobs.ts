import { Settler } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

interface AliveTribeJobsCache {
  /** Settler MEMBERSHIP generation: a birth, a spawn, and a death all move through add/destroy. */
  membershipGeneration: number;
  /** Settler VALUE generation: the trade a settler holds is written in place, invisible to the membership
   *  generation above, so only a `World.write` to Settler distinguishes a retrained settler from the one
   *  this table recorded. Any Settler write bumps it, not just
   *  {@link import('../../components/settler.js').setSettlerJob}, so this table only stays a cache while the
   *  PER-TICK Settler writers (needs decay, work XP, combat need cost) keep writing raw — routing those
   *  through the seam would rebuild it every tick. */
  valueGeneration: number;
  readonly jobsByTribe: ReadonlyMap<number, ReadonlySet<number>>;
}

const aliveTribeJobsCache = new WeakMap<World, AliveTribeJobsCache>();

/** One full derivation: the rebuild and the verifier's reference run through this single path. */
function deriveAliveTribeJobs(world: World): Map<number, Set<number>> {
  const byTribe = new Map<number, Set<number>>();
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.jobType === null) continue; // wildlife, a child and an idle adult hold no trade
    let jobs = byTribe.get(s.tribe);
    if (jobs === undefined) {
      jobs = new Set<number>();
      byTribe.set(s.tribe, jobs);
    }
    jobs.add(s.jobType);
  }
  return byTribe;
}

function sameTables(
  a: ReadonlyMap<number, ReadonlySet<number>>,
  b: ReadonlyMap<number, ReadonlySet<number>>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [tribe, jobs] of a) {
    const other = b.get(tribe);
    if (other === undefined || other.size !== jobs.size) return false;
    for (const jobType of jobs) {
      if (!other.has(jobType)) return false;
    }
  }
  return true;
}

function verifyAliveTribeJobsCache(world: World): string[] {
  const cached = aliveTribeJobsCache.get(world);
  if (cached === undefined) return [];
  if (
    cached.membershipGeneration !== world.componentGeneration(Settler) ||
    cached.valueGeneration !== world.componentValueGeneration(Settler)
  ) {
    return []; // stale key, so the next read rebuilds and nothing can consume the old table
  }
  if (sameTables(cached.jobsByTribe, deriveAliveTribeJobs(world))) return [];
  return [
    'aliveTribeJobs cache disagrees with a fresh derivation: a Settler trade changed outside setSettlerJob',
  ];
}

/**
 * `tribe → the job types at least one living settler of that tribe currently holds`. The membership set the
 * tech-unlock gate tests against, so a probe costs a set lookup instead of a scan over every Settler (the
 * store is padded with wildlife, which are permanently `jobType: null` and could never match).
 *
 * DERIVED state, never hashed and never stored on an entity. Keyed on both Settler generations (see
 * {@link AliveTribeJobsCache}), so it answers exactly what a fresh scan would, with no within-tick
 * staleness window. The returned maps and sets are the SHARED cached copies: read only. Determinism: set
 * membership over `world.query`, which is order-independent and picks nothing.
 */
export function aliveTribeJobs(world: World): ReadonlyMap<number, ReadonlySet<number>> {
  const membershipGeneration = world.componentGeneration(Settler);
  const valueGeneration = world.componentValueGeneration(Settler);
  const cached = aliveTribeJobsCache.get(world);
  if (
    cached !== undefined &&
    cached.membershipGeneration === membershipGeneration &&
    cached.valueGeneration === valueGeneration
  ) {
    return cached.jobsByTribe;
  }

  const jobsByTribe = deriveAliveTribeJobs(world);
  // Registered on the first build only: the verifier closes over `world` alone, and a rebuild runs on
  // the trade-change path this table exists to keep cheap.
  if (cached === undefined)
    world.registerCacheVerifier('aliveTribeJobs', () => verifyAliveTribeJobsCache(world));
  aliveTribeJobsCache.set(world, { membershipGeneration, valueGeneration, jobsByTribe });
  return jobsByTribe;
}
