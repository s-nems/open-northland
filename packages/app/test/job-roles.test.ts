import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { expectJobRolesMatchTheOldBands, jobRoleIds, SCOUT_JOB } from './support/job-roles.js';

/**
 * The sim classifies soldier/hero/scout/hunter off the content's job id slugs
 * (`core/content-index/jobs.ts`). That replaced hardcoded numeric bands in the sim systems; this pins the
 * replacement against the committed fallback catalog, so the bands can never come back through a renamed
 * catalog job. The real-IR twin is `test/content/job-roles.test.ts`.
 */
describe('job roles over the fallback catalog', () => {
  const content = sandboxContent();

  it('classifies every catalog job exactly as the deleted jobtypes.ini id bands did', () => {
    expectJobRolesMatchTheOldBands(content);
  });

  it('covers the catalog soldiers and the scout/hunter trades (a vacuous pass would not)', () => {
    const roles = jobRoleIds(content);
    expect(roles.soldiers.length).toBeGreaterThan(1);
    expect(roles.scout).toBe(SCOUT_JOB);
    expect(roles.hunters.length).toBe(1);
  });

  it('classifies nothing for a job id the content does not declare', () => {
    const unknown = 9999;
    expect(content.jobs.some((j) => j.typeId === unknown)).toBe(false);
    expect(systems.isFighterJob(content, unknown)).toBe(false);
    expect(systems.isScoutJob(content, unknown)).toBe(false);
    expect(systems.isHunterJob(content, unknown)).toBe(false);
  });
});
