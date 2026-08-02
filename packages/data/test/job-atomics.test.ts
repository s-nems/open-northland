import { describe, expect, it } from 'vitest';
import { type JobType, resolveJobAtomics } from '../src/index.js';

/**
 * The base-job chain (`jobtypes` `baseatomics`) resolution both the sim's permission gate and the
 * app's gather menu read. The shapes below mirror the real table: a root with the general grants, a
 * child that adds its trade atomics, a child that denies part of what it inherits, and a leaf that
 * grants nothing of its own (the armed soldiers 32..41 are exactly this).
 */
const job = (typeId: number, fields: Partial<JobType> = {}): JobType => ({
  typeId,
  id: `job_${typeId}`,
  allowedAtomics: [],
  forbiddenAtomics: [],
  ...fields,
});

const setOf = (map: ReadonlyMap<number, ReadonlySet<number>>, typeId: number): number[] =>
  [...(map.get(typeId) ?? [])].sort((a, b) => a - b);

describe('resolveJobAtomics', () => {
  it('gives a root job its own grants and a child the base plus its own', () => {
    const map = resolveJobAtomics([
      job(6, { allowedAtomics: [10, 22, 23] }),
      job(18, { allowedAtomics: [29, 34], baseJob: 6 }),
    ]);
    expect(setOf(map, 6)).toEqual([10, 22, 23]);
    expect(setOf(map, 18)).toEqual([10, 22, 23, 29, 34]);
  });

  it('lets forbidatomic deny an inherited atomic, and passes the denial down the chain', () => {
    const map = resolveJobAtomics([
      job(6, { allowedAtomics: [10, 12, 20] }),
      job(31, { allowedAtomics: [81], forbiddenAtomics: [12, 20], baseJob: 6 }),
      job(32, { baseJob: 31 }), // grants nothing of its own - its set is its base's
    ]);
    expect(setOf(map, 31)).toEqual([10, 81]);
    expect(setOf(map, 32)).toEqual([10, 81]);
  });

  it('re-grants an atomic a base denied when the child allows it again', () => {
    const map = resolveJobAtomics([
      job(6, { allowedAtomics: [10] }),
      job(31, { forbiddenAtomics: [10], baseJob: 6 }),
      job(42, { allowedAtomics: [10], baseJob: 31 }),
    ]);
    expect(setOf(map, 31)).toEqual([]);
    expect(setOf(map, 42)).toEqual([10]);
  });

  it('keeps the first row of a duplicated typeId, like the other content tables', () => {
    const map = resolveJobAtomics([job(6, { allowedAtomics: [10] }), job(6, { allowedAtomics: [99] })]);
    expect(setOf(map, 6)).toEqual([10]);
  });

  it('inherits nothing from an absent base rather than throwing', () => {
    const map = resolveJobAtomics([job(7, { allowedAtomics: [12], baseJob: 404 })]);
    expect(setOf(map, 7)).toEqual([12]);
  });

  it('returns the same resolution for the same job table', () => {
    const jobs = [job(6, { allowedAtomics: [10] }), job(18, { allowedAtomics: [29], baseJob: 6 })];
    expect(resolveJobAtomics(jobs)).toBe(resolveJobAtomics(jobs));
  });

  // `validateCrossReferences` rejects a cycle at load; the resolver still must not hang on one. Which
  // end of a mutual cycle keeps the union is an artefact of file order, so only termination is pinned.
  it('terminates on a base-job cycle', () => {
    const map = resolveJobAtomics([
      job(1, { allowedAtomics: [10], baseJob: 2 }),
      job(2, { allowedAtomics: [20], baseJob: 1 }),
      job(3, { allowedAtomics: [30], baseJob: 3 }),
    ]);
    expect(setOf(map, 1)).toContain(10);
    expect(setOf(map, 2)).toContain(20);
    expect(setOf(map, 3)).toEqual([30]); // a self-cycle inherits nothing, keeping its own grants
  });
});
