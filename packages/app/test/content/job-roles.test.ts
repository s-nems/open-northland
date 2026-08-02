import { describe, expect, it } from 'vitest';
import {
  expectJobRolesMatchTheOldBands,
  HERO_JOB_MAX,
  HERO_JOB_MIN,
  jobRoleIds,
  SCOUT_JOB,
  SOLDIER_JOB_MAX,
  SOLDIER_JOB_MIN,
} from '../support/job-roles.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The job-role derivation over the REAL extracted job table - the join the fallback catalog cannot prove.
 * `jobtypes.ini` has no role field, so the sim reads the roles off each job's extracted id slug; a slug
 * rename upstream would otherwise silently turn the soldiers into civilians, or move a job across the
 * soldier/hero line and reroute its general fight XP.
 */
const span = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

describe.runIf(hasRealIr())('job roles over the real IR', () => {
  it('classifies every extracted job as the jobtypes.ini id bands did', async () => {
    const { real } = await loadContentUnderTest();
    expectJobRolesMatchTheOldBands(real);
  });

  it('resolves the whole soldier and hero bands, so the check above is not vacuous', async () => {
    const { real } = await loadContentUnderTest();
    const roles = jobRoleIds(real);
    expect(roles.soldiers).toEqual(span(SOLDIER_JOB_MIN, SOLDIER_JOB_MAX));
    expect(roles.heroes).toEqual(span(HERO_JOB_MIN, HERO_JOB_MAX));
    expect(roles.scout).toBe(SCOUT_JOB);
  });
});
