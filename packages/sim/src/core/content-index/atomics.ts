import { type ContentSet, resolveJobAtomics } from '@open-northland/data';

/** The flag-gathering trades: a job whose resolved atomics include some non-farmed good's harvest
 *  atomic, whether declared or inherited from its base job. */
export function harvestCapableJobs(content: ContentSet): ReadonlySet<number> {
  const harvestAtomics = new Set<number>();
  for (const g of content.goods) {
    if (g.farming !== undefined) continue; // field-farmed - its harvester is a bound farmer, not a flag gatherer
    if (g.atomics.harvest !== undefined) harvestAtomics.add(g.atomics.harvest);
  }
  const jobs = new Set<number>();
  for (const [typeId, atomics] of resolveJobAtomics(content.jobs)) {
    for (const harvest of harvestAtomics) {
      if (atomics.has(harvest)) {
        jobs.add(typeId);
        break;
      }
    }
  }
  return jobs;
}

/** The per-tribe `setatomic` binding tables: first-wins per tribe typeId, last-wins per binding. */
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
      byAtomic.set(b.atomicId, b.animation);
    }
    byTribe.set(tribe.typeId, byJob);
  }
  return byTribe;
}
