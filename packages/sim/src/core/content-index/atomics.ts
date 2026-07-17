import type { ContentSet } from '@open-northland/data';

/** The per-job allowed-atomic sets (first-wins per typeId, like every other table). */
export function jobAtomicSets(content: ContentSet): ReadonlyMap<number, ReadonlySet<number>> {
  const map = new Map<number, ReadonlySet<number>>();
  for (const job of content.jobs) {
    if (map.has(job.typeId)) continue;
    const set = new Set<number>(job.allowedAtomics);
    for (const a of job.baseAtomics) set.add(a);
    for (const a of job.forbiddenAtomics) set.delete(a);
    map.set(job.typeId, set);
  }
  return map;
}

/** The flag-gathering trades ({@link import('../content-index.js').ContentIndex.harvestJobs}): a job whose
 *  grants (`allowedAtomics` minus `forbiddenAtomics`) include some non-farmed good's harvest atomic.
 *  `baseAtomics` are excluded — a tribe-wide default equal to a good's harvest atomic (real soldier
 *  `baseAtomics=[31]` == herb's harvest) must not classify the job as a gatherer. First-wins per typeId,
 *  like the other tables. */
export function harvestCapableJobs(content: ContentSet): ReadonlySet<number> {
  const harvestAtomics = new Set<number>();
  for (const g of content.goods) {
    if (g.farming !== undefined) continue; // field-farmed — its harvester is a bound farmer, not a flag gatherer
    if (g.atomics.harvest !== undefined) harvestAtomics.add(g.atomics.harvest);
  }
  const seen = new Set<number>();
  const jobs = new Set<number>();
  for (const job of content.jobs) {
    if (seen.has(job.typeId)) continue;
    seen.add(job.typeId);
    const forbidden = new Set(job.forbiddenAtomics);
    for (const a of job.allowedAtomics) {
      if (!forbidden.has(a) && harvestAtomics.has(a)) {
        jobs.add(job.typeId);
        break;
      }
    }
  }
  return jobs;
}

/** The per-tribe `setatomic` binding tables (first-wins per tribe typeId; last-wins per binding —
 *  see {@link import('../content-index.js').ContentIndex.atomicBindingsByTribe}). */
export function atomicBindingTables(
  content: ContentSet,
): ReadonlyMap<number, ReadonlyMap<number, ReadonlyMap<number, string>>> {
  const byTribe = new Map<number, Map<number, Map<number, string>>>();
  for (const tribe of content.tribes) {
    if (byTribe.has(tribe.typeId)) continue;
    const byJob = new Map<number, Map<number, string>>();
    for (const b of tribe.atomicBindings) {
      let byAtomic = byJob.get(b.jobType);
      if (byAtomic === undefined) {
        byAtomic = new Map<number, string>();
        byJob.set(b.jobType, byAtomic);
      }
      byAtomic.set(b.atomicId, b.animation); // last-wins: a later binding overwrites
    }
    byTribe.set(tribe.typeId, byJob);
  }
  return byTribe;
}
