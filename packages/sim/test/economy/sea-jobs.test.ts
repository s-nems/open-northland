import { type ContentSet, IR_VERSION, type JobType, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { isSeaJob, seaJobs } from '../../src/systems/index.js';

/** Resolve a job by its `id` from a content set (throws if absent — a test-fixture programmer error). */
function job(content: ContentSet, id: string): JobType {
  const found = content.jobs.find((j) => j.id === id);
  if (found === undefined) throw new Error(`fixture has no job "${id}"`);
  return found;
}

/**
 * The sea-job read view — `seaJobs`/`isSeaJob` classify the `fisher_sea`/`trader_sea` rows out of
 * `content.jobs` *by the data alone* (the `_sea` id suffix the original `jobtypes` data carries), the
 * job-side seed the Sea/Northland slice (water travel, embark/disembark) builds on — never by a
 * hardcoded list.
 *
 * The fixture mirrors the real `jobtypes.ini` shape: the land trades (`fisher` 22, `trader` 25) and
 * their distinct water specializations (`fisher_sea` 23, `trader_sea` 26), plus an unrelated land job
 * (`farmer`) and `idle` — declared OUT of typeId order so the sort is exercised. The sea rows carry
 * empty `allowedAtomics` like the real data (their atomics come per-tribe via `setatomic`), so the
 * classification rests on the same `id` the pipeline pins, not on atomics.
 */
function jobContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      // trader_sea (typeId 26) declared first — a sea job. Proves the sort, not declaration order.
      { typeId: 26, id: 'trader_sea' },
      { typeId: 22, id: 'fisher', allowedAtomics: [36, 37, 38] }, // the land fisher — NOT a sea job
      { typeId: 23, id: 'fisher_sea' }, // a sea job, after trader_sea — proves the sort puts it first
      { typeId: 25, id: 'trader' }, // the land trader — NOT a sea job
      { typeId: 18, id: 'farmer' }, // an unrelated land job
      { typeId: 0, id: 'idle' },
    ],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
  });
}

describe('isSeaJob', () => {
  it('is true for a `_sea` job and false for its land counterpart / any landlubber job', () => {
    const content = jobContent();
    expect(isSeaJob(job(content, 'fisher_sea'))).toBe(true);
    expect(isSeaJob(job(content, 'trader_sea'))).toBe(true);
    expect(isSeaJob(job(content, 'fisher'))).toBe(false); // land trade — not a sea job
    expect(isSeaJob(job(content, 'trader'))).toBe(false);
    expect(isSeaJob(job(content, 'farmer'))).toBe(false);
    expect(isSeaJob(job(content, 'idle'))).toBe(false);
  });
});

describe('seaJobs', () => {
  it('returns only the `_sea` jobs (the sea trades)', () => {
    const ids = seaJobs(jobContent()).map((j) => j.id);
    expect(ids).toEqual(['fisher_sea', 'trader_sea']); // land trades excluded
  });

  it('sorts ascending by typeId regardless of declaration order', () => {
    // Declared trader_sea(26) before fisher_sea(23); the view must still put fisher_sea first.
    const typeIds = seaJobs(jobContent()).map((j) => j.typeId);
    expect(typeIds).toEqual([23, 26]);
  });

  it('is empty when no job carries the `_sea` suffix (a land-only set)', () => {
    const content = parseContentSet({
      manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [
        { typeId: 0, id: 'idle' },
        { typeId: 22, id: 'fisher' },
      ],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    });
    expect(seaJobs(content)).toEqual([]);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = jobContent();
    expect(seaJobs(content)).toEqual(seaJobs(content));
  });
});
