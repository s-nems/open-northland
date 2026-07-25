import { describe, expect, it } from 'vitest';
import { IR_VERSION, parseContentSet } from '../src/index.js';

function contentSet(version: unknown): Record<string, unknown> {
  return {
    manifest: { version, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [],
    jobs: [],
    buildings: [],
  };
}

/** The gate every loader inherits: `parseContentSet` is the one seam they all go through. */
describe('the IR version gate', () => {
  it('accepts content stamped with the current version', () => {
    expect(parseContentSet(contentSet(IR_VERSION)).manifest.version).toBe(IR_VERSION);
  });

  it('rejects an older stamp with an expected/actual message', () => {
    expect(() => parseContentSet(contentSet(IR_VERSION - 1))).toThrow(
      `content reports ${IR_VERSION - 1}, this build reads ${IR_VERSION}`,
    );
  });

  it('rejects a newer stamp rather than reading it as forward-compatible', () => {
    expect(() => parseContentSet(contentSet(IR_VERSION + 1))).toThrow(
      `content reports ${IR_VERSION + 1}, this build reads ${IR_VERSION}`,
    );
  });

  it('rejects a missing or non-numeric stamp', () => {
    expect(() => parseContentSet(contentSet(undefined))).toThrow('IR version mismatch');
    expect(() => parseContentSet(contentSet(String(IR_VERSION)))).toThrow('IR version mismatch');
  });
});
