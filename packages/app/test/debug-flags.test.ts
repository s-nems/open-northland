import { describe, expect, it } from 'vitest';
import { debugFlags, hasDebugFlag, setDebugFlag } from '../src/diag/debug-flags.js';

/**
 * `?debug=` as a set. It was a single exact-match value, so a second mode could not be turned on
 * without silently turning the first one off.
 */

describe('debugFlags', () => {
  it('still reads a single flag the way it always did', () => {
    expect(hasDebugFlag(new URLSearchParams('?debug=perf'), 'perf')).toBe(true);
  });

  it('reads several flags from one param', () => {
    expect([...debugFlags(new URLSearchParams('?debug=profile,trace'))]).toEqual(['profile', 'trace']);
  });

  it('tolerates spacing and empty entries', () => {
    expect([...debugFlags(new URLSearchParams('?debug=profile, ,trace '))]).toEqual(['profile', 'trace']);
  });

  it('reads no flags at all when the param is absent', () => {
    expect(debugFlags(new URLSearchParams()).size).toBe(0);
  });
});

describe('setDebugFlag', () => {
  it('adds a flag without clobbering its siblings', () => {
    const params = new URLSearchParams('?debug=profile,trace');
    setDebugFlag(params, 'geometry', true);
    expect(debugFlags(params)).toEqual(new Set(['profile', 'trace', 'geometry']));
  });

  it('removes one flag and leaves the rest running', () => {
    const params = new URLSearchParams('?debug=profile,geometry');
    setDebugFlag(params, 'geometry', false);
    expect(params.get('debug')).toBe('profile');
  });

  it('drops the param entirely once nothing is left, so no empty ?debug= lingers', () => {
    const params = new URLSearchParams('?debug=geometry');
    setDebugFlag(params, 'geometry', false);
    expect(params.has('debug')).toBe(false);
  });

  it('is idempotent', () => {
    const params = new URLSearchParams('?debug=perf');
    setDebugFlag(params, 'perf', true);
    expect(params.get('debug')).toBe('perf');
  });
});
