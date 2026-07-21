import { describe, expect, it } from 'vitest';
import { errorMessage } from '../src/errors.js';

describe('errorMessage', () => {
  it('reads the message of a thrown Error', () => {
    expect(errorMessage(new Error('atlas page overflows its sheet'))).toBe('atlas page overflows its sheet');
  });

  it('keeps a subclass message, so a decoder error still names its own cause', () => {
    class DecodeError extends Error {}
    expect(errorMessage(new DecodeError('truncated chunk'))).toBe('truncated chunk');
  });

  it('describes a thrown string instead of rendering it as "undefined"', () => {
    expect(errorMessage('boom')).toBe('boom');
  });

  it('describes a thrown non-Error object instead of rendering it as "undefined"', () => {
    expect(errorMessage({ code: 'ENOENT' })).toBe('[object Object]');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
