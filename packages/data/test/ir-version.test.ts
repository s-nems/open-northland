import { describe, expect, it } from 'vitest';
import { IR_VERSION, parseContentSet, parseGeneratedContentSet } from '../src/index.js';

function contentSet(version: unknown): Record<string, unknown> {
  return {
    manifest: { version, generatedFrom: { mod: 'synthetic-test-fixture' }, locale: 'eng' },
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

describe('the generated-content lane gate', () => {
  // The parsed set materializes every lane, the shape the pipeline writes.
  const generated: Record<string, unknown> = parseContentSet(contentSet(IR_VERSION));

  it('accepts a document carrying every lane', () => {
    expect(parseGeneratedContentSet(generated).manifest.version).toBe(IR_VERSION);
  });

  it('rejects a document missing a lane instead of defaulting it', () => {
    const { tribes: _tribes, sounds: _sounds, ...older } = generated;
    expect(() => parseGeneratedContentSet(older)).toThrow(
      'generated content lacks tribes, sounds: regenerate',
    );
  });

  it('leaves a non-object to the schema error', () => {
    expect(() => parseGeneratedContentSet(null)).not.toThrow('generated content lacks');
    expect(() => parseGeneratedContentSet(null)).toThrow();
  });
});
