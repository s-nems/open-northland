import { describe, expect, it } from 'vitest';
import { classifyContent } from '../src/content-state.js';

/**
 * The staleness classification (`src/content-state.ts`): what the shell boots into. Only an exact
 * stamp match is `ready`; a schema mismatch blocks play; a missing stamp (pre-manifest or
 * interrupted conversion) degrades to recommended-regeneration, never to a crash-at-load.
 */
describe('classifyContent', () => {
  const current = { irVersion: 2, contentRevision: 3 };

  it('is missing without ir.json regardless of any stamp', () => {
    expect(classifyContent(current, current, false)).toBe('missing');
    expect(classifyContent(undefined, current, false)).toBe('missing');
  });

  it('is ready only on an exact stamp match', () => {
    expect(classifyContent({ irVersion: 2, contentRevision: 3 }, current, true)).toBe('ready');
  });

  it('treats an IR schema mismatch as blocking', () => {
    expect(classifyContent({ irVersion: 1, contentRevision: 3 }, current, true)).toBe('stale-schema');
  });

  it('treats an older revision or a missing stamp as regeneration-recommended', () => {
    expect(classifyContent({ irVersion: 2, contentRevision: 2 }, current, true)).toBe('stale-revision');
    expect(classifyContent(undefined, current, true)).toBe('stale-revision');
  });
});
