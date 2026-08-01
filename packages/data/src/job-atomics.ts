import { firstByTypeId } from './lookup.js';
import type { JobType } from './schema/index.js';

const EMPTY: ReadonlySet<number> = new Set<number>();

/** Memo keyed on the job table itself: a `ContentSet`'s `jobs` array is stable, so repeated callers
 *  share one resolution instead of rebuilding it. */
const CACHE = new WeakMap<readonly JobType[], ReadonlyMap<number, ReadonlySet<number>>>();

/**
 * Per job typeId: every atomic id the job may run — its `baseJob` chain resolved, plus its own
 * `allowedAtomics`, minus its own `forbiddenAtomics`.
 *
 * A base job absent from `jobs` contributes nothing, and a cycle stops at the repeated job;
 * `validateCrossReferences` rejects both at load, so neither shape reaches a running game.
 */
export function resolveJobAtomics(jobs: readonly JobType[]): ReadonlyMap<number, ReadonlySet<number>> {
  const cached = CACHE.get(jobs);
  if (cached !== undefined) return cached;

  const byTypeId = firstByTypeId(jobs);
  const resolved = new Map<number, ReadonlySet<number>>();
  const resolving = new Set<number>();
  const resolve = (typeId: number): ReadonlySet<number> => {
    const done = resolved.get(typeId);
    if (done !== undefined) return done;
    const job = byTypeId.get(typeId);
    if (job === undefined || resolving.has(typeId)) return EMPTY;
    resolving.add(typeId);
    const set = new Set(job.baseJob === undefined ? EMPTY : resolve(job.baseJob));
    resolving.delete(typeId);
    for (const atomic of job.allowedAtomics) set.add(atomic);
    for (const atomic of job.forbiddenAtomics) set.delete(atomic);
    resolved.set(typeId, set);
    return set;
  };

  for (const job of jobs) resolve(job.typeId);
  CACHE.set(jobs, resolved);
  return resolved;
}
