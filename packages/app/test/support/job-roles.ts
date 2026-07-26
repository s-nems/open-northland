import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { expect } from 'vitest';

/**
 * The `jobtypes.ini` id bands the sim used to classify job roles by, before `core/content-index/jobs.ts`
 * derived them from the job id slugs. Restated verbatim rather than read off the derivation under test, so
 * both role suites (the committed fallback catalog and the real IR) prove the same equivalence.
 */
const SOLDIER_JOB_MIN = 31;
const SOLDIER_JOB_MAX = 41;
const HERO_JOB_MIN = 42;
const HERO_JOB_MAX = 47;
const SCOUT_JOB = 27;
const HUNTER_JOB = 15;

/** Assert every job `content` declares lands in exactly the role the deleted id bands gave it. The
 *  soldier/hero split is load-bearing: the two feed different general fight-XP tracks. */
export function expectJobRolesMatchTheOldBands(content: ContentSet): void {
  for (const job of content.jobs) {
    const id = job.typeId;
    const where = `${job.id} (${id})`;
    expect(systems.isSoldierJob(content, id), `soldier: ${where}`).toBe(
      id >= SOLDIER_JOB_MIN && id <= SOLDIER_JOB_MAX,
    );
    expect(systems.isHeroJob(content, id), `hero: ${where}`).toBe(id >= HERO_JOB_MIN && id <= HERO_JOB_MAX);
    expect(systems.isFighterJob(content, id), `fighter: ${where}`).toBe(
      id >= SOLDIER_JOB_MIN && id <= HERO_JOB_MAX,
    );
    expect(systems.isScoutJob(content, id), `scout: ${where}`).toBe(id === SCOUT_JOB);
    expect(systems.isHunterJob(content, id), `hunter: ${where}`).toBe(id === HUNTER_JOB);
  }
}

/** The job typeIds of each role the content declares, ascending — so a suite can prove its coverage
 *  instead of passing vacuously on a content set with no fighters at all. */
export function jobRoleIds(content: ContentSet): {
  soldiers: number[];
  heroes: number[];
  scout: number | null;
  hunters: number[];
} {
  const ids = (has: (jobType: number) => boolean): number[] =>
    content.jobs
      .map((j) => j.typeId)
      .filter(has)
      .sort((a, b) => a - b);
  return {
    soldiers: ids((j) => systems.isSoldierJob(content, j)),
    heroes: ids((j) => systems.isHeroJob(content, j)),
    scout: systems.scoutJobType(content),
    hunters: ids((j) => systems.isHunterJob(content, j)),
  };
}

export { HERO_JOB_MAX, HERO_JOB_MIN, HUNTER_JOB, SCOUT_JOB, SOLDIER_JOB_MAX, SOLDIER_JOB_MIN };
