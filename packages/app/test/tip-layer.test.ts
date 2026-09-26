import { describe, expect, it } from 'vitest';
import { tipRefresh } from '../src/hud/dom/parts/tip-layer.js';

describe('tip refresh', () => {
  it('keeps an unchanged tip, shows a new text, and hides with the text or the control', () => {
    expect(tipRefresh('A 20 · B 0', 'A 20 · B 0', true)).toBe('keep');
    expect(tipRefresh('A 20 · B 0', 'A 19 · B 1', true)).toBe('show');
    expect(tipRefresh('A 20 · B 0', '', true)).toBe('hide');
    expect(tipRefresh('A 20 · B 0', 'A 20 · B 0', false)).toBe('hide');
  });
});
