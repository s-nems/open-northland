import type { JobType } from '@open-northland/data';

/** The combat-relevant trades a job id can name; a civilian trade names none ({@link jobRoleOfId}). */
export type JobRole = 'soldier' | 'hero' | 'scout' | 'hunter';

/**
 * The role a `jobtypes` id slug names - every soldier class is `soldier_*`, every hero `hero_*`/`heroine_*`
 * (so the `hero` prefix covers both spellings), while the scout and the hunter are single trades whose whole
 * id is the slug. Soldier and hero stay apart because the fight-XP routing feeds their general tracks
 * separately; {@link import('../../systems/readviews/jobs.js').isFighterJob} is the union.
 *
 * An APPROXIMATION over the extracted job name: `jobtypes.ini` declares no role field, and the only other
 * extracted per-job data - the atomic grants - would trade a job id for an atomic id without isolating the
 * fighters at all. Slug classification is the existing precedent for a trade the data does not flag (`_sea`,
 * `carrier`). Stronger unused signals are inventoried in
 * docs/tickets/pipeline/jobtypes-per-job-flags-unextracted.md.
 */
export function jobRoleOfId(id: string): JobRole | null {
  if (id.startsWith('soldier')) return 'soldier';
  if (id.startsWith('hero')) return 'hero';
  if (id === 'scout') return 'scout';
  if (id === 'hunter') return 'hunter';
  return null;
}

/** Whether `role` is one of the two combat trades - the {@link import('../../systems/readviews/jobs.js').isFighterJob}
 *  union, owned here so the row-level and content-keyed predicates cannot drift apart. */
export function isFighterRole(role: JobRole | null): boolean {
  return role === 'soldier' || role === 'hero';
}

/**
 * Whether a job id names the transport trade - the original's carrier (`logicworker 24`, the "tragarz" who
 * ferries goods but never operates a workshop's craft). An APPROXIMATION over the extracted job name, the
 * same basis as {@link jobRoleOfId}: no readable rule file carries a transport flag, and both the sandbox
 * content and the extraction pipeline emit this job under the stable `carrier` slug. The one owner of that
 * test - the producer drive, the operator count and the HUD all route through it.
 */
export function isCarrierJobId(id: string): boolean {
  return id === 'carrier';
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
  };
  for (const [typeId, job] of jobs) {
    const role = jobRoleOfId(job.id);
    if (role !== null) sets[role].add(typeId);
  }
  return sets;
}
