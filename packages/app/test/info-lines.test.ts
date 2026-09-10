import { describe, expect, it } from 'vitest';
import { formatInfoLine, infoLineTexts } from '../src/game/info-lines.js';

describe('formatInfoLine', () => {
  it('prints the count into the first %d and the extra into the second, leaving the rest alone', () => {
    const line = { index: 0, stringId: 11, count: 3, extra: 8 };
    expect(formatInfoLine('Settlers at the ford: %d of %d', line)).toBe('Settlers at the ford: 3 of 8');
    expect(formatInfoLine('Only %d here', line)).toBe('Only 3 here');
    expect(formatInfoLine('Nothing to fill', line)).toBe('Nothing to fill');
    expect(formatInfoLine('%d/%d/%d', line)).toBe('3/8/%d');
  });

  it('prints a zero for a plain string and the id for a string the map lacks', () => {
    expect(formatInfoLine('%d warriors', { index: 0, stringId: 5, count: 0, extra: 0 })).toBe('0 warriors');
    expect(formatInfoLine(undefined, { index: 0, stringId: 5, count: 0, extra: 0 })).toBe('#5');
  });

  it('lists the lines in the order given', () => {
    const texts: Record<number, string> = { 1: 'one', 2: 'two %d' };
    expect(
      infoLineTexts(
        [
          { index: 0, stringId: 1, count: 0, extra: 0 },
          { index: 2, stringId: 2, count: 4, extra: 0 },
        ],
        (id) => texts[id],
      ),
    ).toEqual(['one', 'two 4']);
  });
});
