import { describe, expect, it } from 'vitest';
import { textEncoding } from '../src/text-encoding.js';

describe('textEncoding', () => {
  it('reads Italian text with CP1252, where CP1250 would turn its accents into other letters', () => {
    const bytes = Uint8Array.from([0xe0, 0xe8, 0xec, 0xf2, 0xf9]);
    expect(new TextDecoder(textEncoding('ita')).decode(bytes)).toBe('àèìòù');
  });
});
