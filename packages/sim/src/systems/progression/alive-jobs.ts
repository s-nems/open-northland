import { Owner, ownerOf, Person, Settler } from '../../components/index.js';
import type { World } from '../../ecs/world.js';

type Jobs = ReadonlyMap<number | undefined, ReadonlyMap<number, ReadonlySet<number>>>;
const memo = new WeakMap<World, { key: string; jobs: Jobs }>();
const EMPTY: ReadonlyMap<number, ReadonlySet<number>> = new Map();

/** One shared scan per relevant generation, isolated by owner and tribe. */
export function aliveTribeJobs(world: World, owner?: number): ReadonlyMap<number, ReadonlySet<number>> {
  const key = generationKey(world);
  let held = memo.get(world);
  if (held?.key !== key) {
    const jobs = deriveJobs(world);
    if (held === undefined)
      world.registerCacheVerifier('aliveTribeJobs', () => {
        const current = memo.get(world);
        if (current === undefined || current.key !== generationKey(world)) return [];
        return sameJobs(current.jobs, deriveJobs(world))
          ? []
          : ['aliveTribeJobs disagrees with a fresh owner/tribe scan'];
      });
    held = { key, jobs };
    memo.set(world, held);
  }
  return held.jobs.get(owner) ?? EMPTY;
}

function generationKey(world: World): string {
  return [
    world.componentGeneration(Person),
    world.componentGeneration(Settler),
    world.componentValueGeneration(Settler),
    world.componentGeneration(Owner),
    world.componentValueGeneration(Owner),
  ].join(':');
}

function deriveJobs(world: World): Jobs {
  const jobs = new Map<number | undefined, Map<number, Set<number>>>();
  for (const e of world.query(Person, Settler)) {
    const s = world.get(e, Settler);
    if (s.jobType === null) continue;
    const player = ownerOf(world, e);
    let tribes = jobs.get(player);
    if (tribes === undefined) {
      tribes = new Map();
      jobs.set(player, tribes);
    }
    let trades = tribes.get(s.tribe);
    if (trades === undefined) {
      trades = new Set();
      tribes.set(s.tribe, trades);
    }
    trades.add(s.jobType);
  }
  return jobs;
}

function sameJobs(a: Jobs, b: Jobs): boolean {
  if (a.size !== b.size) return false;
  for (const [owner, tribes] of a) {
    const other = b.get(owner);
    if (other === undefined || other.size !== tribes.size) return false;
    for (const [tribe, jobs] of tribes) {
      const otherJobs = other.get(tribe);
      if (otherJobs === undefined || jobs.size !== otherJobs.size) return false;
      for (const job of jobs) if (!otherJobs.has(job)) return false;
    }
  }
  return true;
}
