import type { JobEnablesKind, TribeType } from '@open-northland/data';

/**
 * Per tribe: `kind → targetId → the job types whose presence unlocks that target`, the read shape of the
 * `jobEnables*` tech graph. A tribe, kind, or target absent from the table is gated by no edge.
 */
export type EnablingJobTables = ReadonlyMap<
  number,
  ReadonlyMap<JobEnablesKind, ReadonlyMap<number, ReadonlySet<number>>>
>;

/**
 * Group each tribe's `jobEnables` edges by `(kind, targetId)`, the shape the unlock gate probes. Built from
 * the index's by-typeId tribe table, so it reads the same single record `tribes.get(tribe)` does. A repeated
 * `(jobType, kind, targetId)` triple collapses into the set, since membership is the whole question.
 */
export function enablingJobTables(tribes: ReadonlyMap<number, TribeType>): EnablingJobTables {
  const tables = new Map<number, Map<JobEnablesKind, Map<number, Set<number>>>>();
  for (const [typeId, tribe] of tribes) {
    if (tribe.jobEnables.length === 0) continue;
    const byKind = new Map<JobEnablesKind, Map<number, Set<number>>>();
    for (const edge of tribe.jobEnables) {
      let byTarget = byKind.get(edge.kind);
      if (byTarget === undefined) {
        byTarget = new Map<number, Set<number>>();
        byKind.set(edge.kind, byTarget);
      }
      let jobs = byTarget.get(edge.targetId);
      if (jobs === undefined) {
        jobs = new Set<number>();
        byTarget.set(edge.targetId, jobs);
      }
      jobs.add(edge.jobType);
    }
    tables.set(typeId, byKind);
  }
  return tables;
}
