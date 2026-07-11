import { describe, expect, it } from 'vitest';
import { isSoldierJob, PROFESSIONS, pickerEntries, professionDefForJob } from '../src/catalog/professions.js';
import { JOB_IDLE, JOB_SOLDIER, JOB_SOLDIER_SWORD } from '../src/game/sandbox/ids.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { professionLabel } from '../src/i18n/index.js';

describe('profession catalog + i18n', () => {
  it('offers every profession as a job that setJob can actually assign (no dead picker rows)', () => {
    // `setJob` silently no-ops a jobType absent from `content.jobs` (packages/sim), so every catalog
    // profession MUST be present in the sandbox content — this is the guard against a click that does nothing.
    const jobs = new Set(sandboxContent().jobs.map((j) => j.typeId));
    for (const p of PROFESSIONS) {
      expect(jobs.has(p.jobType), `profession "${p.key}" (job ${p.jobType}) missing from content.jobs`).toBe(
        true,
      );
    }
  });

  it('has no duplicate job ids across the roster', () => {
    const seen = new Set<number>();
    for (const p of PROFESSIONS) {
      expect(seen.has(p.jobType), `duplicate jobType ${p.jobType} ("${p.key}")`).toBe(false);
      seen.add(p.jobType);
    }
  });

  it('collapses the whole soldier band into a single "Żołnierz" profession', () => {
    const soldiers = PROFESSIONS.filter((p) => p.key === 'soldier');
    expect(soldiers).toHaveLength(1);
    expect(soldiers[0]?.jobType).toBe(JOB_SOLDIER);
    // Any job in the jobtypes.ini soldier band (31..41) — including the scene-only weapon classes —
    // resolves to that one soldier profession for the label.
    expect(isSoldierJob(JOB_SOLDIER)).toBe(true);
    expect(professionDefForJob(JOB_SOLDIER)?.key).toBe('soldier');
    expect(professionDefForJob(JOB_SOLDIER_SWORD)?.key).toBe('soldier');
    expect(professionLabel('soldier')).toBe('Żołnierz');
  });

  it('resolves Polish labels for professions, and idle for off-roster jobs', () => {
    expect(professionLabel('smith')).toBe('Kowal');
    expect(professionLabel('gatherer_wood')).toBe('Zbieracz drewna');
    // Idle is not a picker profession; professionDefForJob returns undefined so the panel labels it itself.
    expect(professionDefForJob(JOB_IDLE)).toBeUndefined();
    expect(professionLabel('idle')).toBe('Bezrobotny');
  });

  it('is complete: covers the original production trades beyond gatherers/soldiers', () => {
    const keys = new Set(PROFESSIONS.map((p) => p.key));
    for (const trade of ['builder', 'mason', 'smith', 'baker', 'farmer', 'tailor', 'druid'] as const) {
      expect(keys.has(trade), `missing trade "${trade}"`).toBe(true);
    }
  });

  it('builds a grouped picker list: a header opens each category, every profession is a row', () => {
    const entries = pickerEntries();
    expect(entries[0]?.kind).toBe('header');
    const rows = entries.filter((e) => e.kind === 'profession');
    expect(rows).toHaveLength(PROFESSIONS.length);
    // The first row after the first header is the first roster profession.
    const firstRow = entries.find((e) => e.kind === 'profession');
    expect(firstRow?.kind === 'profession' && firstRow.jobType).toBe(PROFESSIONS[0]?.jobType);
  });
});
