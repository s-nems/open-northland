import { describe, expect, it } from 'vitest';
import {
  autoSaveName,
  displayNameOf,
  formatPlaytime,
  formatSavedAt,
  hasSaveSuffix,
  MAX_SAVE_NAME_LENGTH,
  sanitizedSaveName,
} from '../src/view/runtime/save-load/list-model.js';

/** 12 sim ticks per game second (`TICKS_PER_SECOND`). */
const TICKS_PER_MINUTE = 12 * 60;

const BEL = String.fromCharCode(7);

describe('formatPlaytime', () => {
  it('formats m:ss under an hour and h:mm:ss from there', () => {
    expect(formatPlaytime(0)).toBe('0:00');
    expect(formatPlaytime(11)).toBe('0:00');
    expect(formatPlaytime(12)).toBe('0:01');
    expect(formatPlaytime(TICKS_PER_MINUTE * 61 + 12 * 5)).toBe('1:01:05');
  });
});

describe('formatSavedAt', () => {
  it('renders a dash for an unknown timestamp and a localized stamp otherwise', () => {
    expect(formatSavedAt(null, 'pl')).toBe('-');
    expect(formatSavedAt(Date.UTC(2026, 0, 15, 12, 30), 'pl')).toMatch(/2026/);
  });
});

describe('sanitizedSaveName', () => {
  it('replaces forbidden filename characters and strips control characters', () => {
    expect(sanitizedSaveName('przed atakiem')).toBe('przed atakiem');
    expect(sanitizedSaveName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizedSaveName(`ok${BEL}name`)).toBe('okname');
  });

  it('trims, caps the length, and refuses an empty result', () => {
    expect(sanitizedSaveName('  x  ')).toBe('x');
    expect(sanitizedSaveName('y'.repeat(200))).toHaveLength(MAX_SAVE_NAME_LENGTH);
    expect(sanitizedSaveName('')).toBeNull();
    expect(sanitizedSaveName('   ')).toBeNull();
    expect(sanitizedSaveName(BEL)).toBeNull();
  });
});

describe('sanitizedSaveName against the desktop filename guard', () => {
  // The desktop main process rejects these outright (`save-files.ts`); a sanitized title must
  // never reach it carrying one, or every desktop save write breaks.
  it('yields names the shell accepts: no forbidden or control characters, bounded length', () => {
    const nasty = ['..\\..\\up', 'a:b*c?d', `x${BEL}y`, '  spaced  ', '"quoted"', 'z'.repeat(500)];
    for (const raw of nasty) {
      const name = sanitizedSaveName(raw);
      if (name === null) continue;
      expect(name).toMatch(/^[^\\/:*?"<>|]{1,120}$/);
      expect(hasControl(name)).toBe(false);
    }
  });
});

function hasControl(value: string): boolean {
  return [...value].some((ch) => (ch.codePointAt(0) ?? 0) < 0x20);
}

describe('save file suffixes', () => {
  it('classifies and strips the three accepted suffixes only', () => {
    expect(hasSaveSuffix('a.json.gz')).toBe(true);
    expect(hasSaveSuffix('a.json')).toBe(true);
    expect(hasSaveSuffix('a.gz')).toBe(true);
    expect(hasSaveSuffix('a.txt')).toBe(false);
    expect(hasSaveSuffix('.gz')).toBe(false);
    expect(displayNameOf('przed atakiem.json.gz')).toBe('przed atakiem');
    expect(displayNameOf('foreign.json')).toBe('foreign');
    expect(displayNameOf('plain')).toBe('plain');
  });
});

describe('autoSaveName', () => {
  it('numbers past the list size and skips taken names', () => {
    expect(autoSaveName('Zapis {n}', [])).toBe('Zapis 1');
    expect(autoSaveName('Zapis {n}', ['Zapis 1', 'przed atakiem'])).toBe('Zapis 3');
    expect(autoSaveName('Zapis {n}', ['Zapis 2'])).toBe('Zapis 3');
  });
});
