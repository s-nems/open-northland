import { describe, expect, it } from 'vitest';
import { JOB_CIVILIST, JOB_SOLDIER, JOB_SOLDIER_SWORD } from '../../src/catalog/jobs.js';
import {
  isSoldierJob,
  PROFESSIONS,
  pickerEntries,
  professionDefForJob,
} from '../../src/catalog/professions.js';
import { sandboxContent } from '../../src/game/sandbox/index.js';
import { professionLabel } from '../../src/i18n/index.js';

describe('profession catalog + i18n', () => {
  it('offers every profession as a job that setJob can actually assign (no dead picker rows)', () => {
    // `setJob` silently no-ops a jobType absent from `content.jobs` (packages/sim), so every catalog
    // profession MUST be present in the sandbox content - this is the guard against a click that does nothing.
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
    // Any job in the jobtypes.ini soldier band (31..41) - including the scene-only weapon classes -
    // resolves to that one soldier profession for the label.
    expect(isSoldierJob(JOB_SOLDIER)).toBe(true);
    expect(professionDefForJob(JOB_SOLDIER)?.key).toBe('soldier');
    expect(professionDefForJob(JOB_SOLDIER_SWORD)?.key).toBe('soldier');
    expect(professionLabel('soldier')).toBe('Żołnierz');
  });

  it('builds a grouped picker list: a header opens each category, Cywil in the basic one', () => {
    const entries = pickerEntries();
    // The civilist row assigns the original's job 6 - the no-trade adult no workplace employs.
    expect(entries.slice(0, 2)).toEqual([
      { kind: 'header', label: 'Podstawowe' },
      { kind: 'profession', jobType: JOB_CIVILIST, label: 'Cywil' },
    ]);
    expect(entries[2]).toMatchObject({ kind: 'profession', jobType: PROFESSIONS[0]?.jobType });
    const rows = entries.filter((e) => e.kind === 'profession');
    expect(rows).toHaveLength(PROFESSIONS.length + 1); // the roster + the Civilian row
    const categories = new Set(PROFESSIONS.map((p) => p.category));
    expect(entries.filter((e) => e.kind === 'header')).toHaveLength(categories.size);
  });
});
