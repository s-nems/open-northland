import { describe, expect, it } from 'vitest';
import { JOB_CIVILIST, JOB_IDLE, JOB_SOLDIER, JOB_SOLDIER_SWORD } from '../src/catalog/jobs.js';
import { isSoldierJob, PROFESSIONS, pickerEntries, professionDefForJob } from '../src/catalog/professions.js';
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
    expect(professionLabel('collector')).toBe('Zbieracz');
    // Idle is not a ROSTER profession (professionDefForJob returns undefined so the panel labels it
    // itself); the picker still leads with it as the hand-added Cywil row.
    expect(professionDefForJob(JOB_IDLE)).toBeUndefined();
    expect(professionLabel('idle')).toBe('Cywil');
  });

  it('is complete: covers the original production trades beyond gatherers/soldiers', () => {
    const keys = new Set(PROFESSIONS.map((p) => p.key));
    for (const trade of ['builder', 'mason', 'smith', 'baker', 'farmer', 'tailor', 'druid'] as const) {
      expect(keys.has(trade), `missing trade "${trade}"`).toBe(true);
    }
    // The jester (jobtypes.ini 28) is deliberately NOT a profession — 8th Wonder doesn't field it.
    const JESTER_JOB = 28;
    expect(PROFESSIONS.some((p) => p.jobType === JESTER_JOB)).toBe(false);
  });

  it('builds a grouped picker list: Cywil leads ungrouped, then a header opens each category', () => {
    const entries = pickerEntries();
    // The leading row assigns the original's civilist job (6) — the no-trade adult no workplace employs.
    expect(entries[0]).toEqual({ kind: 'profession', jobType: JOB_CIVILIST, label: 'Cywil' });
    expect(entries[1]?.kind).toBe('header');
    const rows = entries.filter((e) => e.kind === 'profession');
    expect(rows).toHaveLength(PROFESSIONS.length + 1); // the roster + the leading Cywil row
    // The first row after the first header is the first roster profession.
    const firstRosterRow = entries
      .slice(2)
      .find((e): e is Extract<typeof e, { kind: 'profession' }> => e.kind === 'profession');
    expect(firstRosterRow?.jobType).toBe(PROFESSIONS[0]?.jobType);
  });
});
