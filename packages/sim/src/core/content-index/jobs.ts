import type { JobType } from '@open-northland/data';

/** The rule-relevant trades a job id can name; any other civilian trade names none ({@link jobRoleOfId}). */
export type JobRole = 'soldier' | 'hero' | 'scout' | 'hunter' | 'druid';

/**
 * The role a `jobtypes` id slug names; `hero` matches by prefix, so the `heroine_*` classes count too.
 * Soldier and hero stay apart because fight-XP routing feeds their general tracks separately.
 *
 * Approximation over the extracted job name: `jobtypes.ini` declares no role field, and slug
 * classification is the existing precedent for a trade the data does not flag (`_sea`, `carrier`).
 */
export function jobRoleOfId(id: string): JobRole | null {
  if (id.startsWith('soldier')) return 'soldier';
  if (id.startsWith('hero')) return 'hero';
  if (id === 'scout') return 'scout';
  if (id === 'hunter') return 'hunter';
  if (id === 'druid') return 'druid';
  return null;
}

/** Whether `role` is one of the two combat trades. */
export function isFighterRole(role: JobRole | null): boolean {
  return role === 'soldier' || role === 'hero';
}

/**
 * Whether a job id names the transport trade - the original's carrier (`logicworker 24`), which ferries
 * goods but never operates a workshop's craft. Approximation over the extracted job name, on the same
 * basis as {@link jobRoleOfId}: no readable rule file carries a transport flag, and both the sandbox
 * content and the extraction pipeline emit this job under the stable `carrier` slug.
 */
export function isCarrierJobId(id: string): boolean {
  return id === 'carrier';
}

/** Whether a job id names the land trader (`jobtypes.ini` 25), the trade that plies a cart between two
 *  houses. The sea variant is excluded: the original's `trader_sea` job task is an empty stub. */
export function isTraderJobId(id: string): boolean {
  return id === 'trader';
}

/** The job typeIds of each role. */
export type JobRoleSets = Readonly<Record<JobRole, ReadonlySet<number>>>;

/** Split `jobs` (the index's by-typeId table, so a duplicate typeId is already resolved) into the roles. */
export function jobRoleSets(jobs: ReadonlyMap<number, JobType>): JobRoleSets {
  const sets: Record<JobRole, Set<number>> = {
    soldier: new Set(),
    hero: new Set(),
    scout: new Set(),
    hunter: new Set(),
    druid: new Set(),
  };
  for (const [typeId, job] of jobs) {
    const role = jobRoleOfId(job.id);
    if (role !== null) sets[role].add(typeId);
  }
  return sets;
}
