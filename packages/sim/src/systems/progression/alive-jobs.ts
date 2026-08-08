import { Person, Settler } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

interface AliveTribeJobsCache {
  /** Settler membership generation: a birth, a spawn, and a death all move through add/destroy. The
   *  derivation below walks `Person`, which `addPerson` keeps in lockstep with `Settler`. */
  membershipGeneration: number;
  /** Settler value generation: a trade is written in place, invisible to the membership generation above.
   *  Any `World.mut` to Settler bumps it - including the per-tick needs rises - so under a running needs
   *  system this table rebuilds once per tick and amortizes only the within-tick consult burst. */
  valueGeneration: number;
  readonly jobsByTribe: ReadonlyMap<number, ReadonlySet<number>>;
}

const aliveTribeJobsCache = new WeakMap<World, AliveTribeJobsCache>();

/** The one derivation path, so the verifier's reference run cannot drift from the rebuild. */
function deriveAliveTribeJobs(world: World): Map<number, Set<number>> {
  const byTribe = new Map<number, Set<number>>();
  for (const e of world.query(Person)) {
    const s = world.get(e, Settler);
    if (s.jobType === null) continue; // a child and an idle adult hold no trade
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
 * The job types at least one living settler of each tribe currently holds - the membership set the
 * tech-unlock gate tests against, so a probe costs a set lookup instead of a scan over every Settler.
 *
 * Derived state, never hashed and never stored on an entity. Keyed on both Settler generations, so it
 * answers exactly what a fresh scan would, with no within-tick staleness window. The returned maps and
 * sets are the shared cached copies: read only.
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
  // Registered on the first build only: the verifier closes over `world` alone.
  if (cached === undefined)
    world.registerCacheVerifier('aliveTribeJobs', () => verifyAliveTribeJobsCache(world));
  aliveTribeJobsCache.set(world, { membershipGeneration, valueGeneration, jobsByTribe });
  return jobsByTribe;
}
