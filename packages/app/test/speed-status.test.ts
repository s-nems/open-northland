import { afterEach, expect, it, vi } from 'vitest';
import { setActiveLocale } from '../src/i18n/index.js';
import { mountSpeedStatusLine, speedShortfallText } from '../src/view/speed-status.js';

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveLocale('pol');
});

/** A detached stand-in for the line's element that counts how often its text is written. */
function stubLine() {
  let text = '';
  const line = {
    style: {} as Record<string, string>,
    writes: 0,
    setAttribute: () => undefined,
    remove: () => undefined,
    get textContent() {
      return text;
    },
    set textContent(next: string) {
      line.writes++;
      text = next;
    },
  };
  vi.stubGlobal('document', { createElement: () => line, documentElement: {} });
  return line;
}

it('prints delivered against requested speed in the active language', () => {
  setActiveLocale('eng');
  expect(speedShortfallText(0.62, 1)).toBe('The game runs at ×0.6 instead of ×1');
  setActiveLocale('pol');
  expect(speedShortfallText(2.96, 5)).toBe('Gra działa w tempie ×3.0 zamiast ×5');
});

it('shows only while a shortfall holds and rewrites only when the printed figure changes', () => {
  const line = stubLine();
  const status = mountSpeedStatusLine({ append: () => undefined } as unknown as HTMLElement);
  expect(line.style.display).toBe('none');

  status.update(3.02, 5);
  expect(line.style.display).toBe('');
  expect(line.textContent).toBe(speedShortfallText(3, 5));
  // Same tenth every frame: nothing formatted, nothing written.
  for (let i = 0; i < 60; i++) status.update(3.04, 5);
  expect(line.writes).toBe(1);

  status.update(2.5, 5);
  expect(line.writes).toBe(2);

  setActiveLocale('eng');
  status.update(2.5, 5);
  expect(line.textContent).toBe('The game runs at ×2.5 instead of ×5');

  status.update(null, 5);
  expect(line.style.display).toBe('none');
});
