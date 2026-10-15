// @vitest-environment jsdom
import type { HypertextBlock, HypertextCallback } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type BookReading,
  createBookWindow,
  type ShownCallback,
} from '../src/hud/dom/mission-book/book-window.js';

/** Which of a briefing chapter's on-screen callbacks the book window hands on after a layout. The
 *  document has no layout here, so every page window and marker is stubbed to one visible box. */

const PAGE = 500;
const BOX = DOMRect.fromRect({ x: 0, y: 0, width: 300, height: 500 });
const NODE: HypertextCallback['args'] = [1000, 296, 188];
const SOUND: HypertextCallback['args'] = [2000, 3, 0];

const brief: BookReading = { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 };

function text(line: string): HypertextBlock {
  return { kind: 'text', style: 'body', text: line };
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(BOX.width);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(BOX.width);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    const style = computed(el);
    return new Proxy(style, { get: (s, key) => (key === 'columnGap' ? '20px' : Reflect.get(s, key)) });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function mountWindow(blocks: readonly HypertextBlock[]) {
  const shown: (ShownCallback | null)[] = [];
  const fired: HypertextCallback['args'][] = [];
  const book = createBookWindow({
    infoRows: () => [],
    plane: document.body,
    chapters: () => [PAGE],
    page: () => ({ title: '', blocks, lang: 'pol' }),
    goals: () => [],
    missionName: 'Test',
    history: null,
    missionHuman: () => null,
    pictureUrl: (file) => file,
    onShowOnMap: () => undefined,
    onCallback: (callback) => {
      shown.push(callback);
      if (callback !== null) fired.push(callback.args);
    },
    takeGoalMarks: () => new Map(),
    onDismiss: () => undefined,
    cue: () => undefined,
  });
  return { book, fired, shown };
}

describe('the book window`s briefing callbacks', () => {
  it('hands on only the last callback the spread shows, as the original keeps one pending', () => {
    const { book, fired, shown } = mountWindow([
      { kind: 'callback', args: NODE },
      text('Title'),
      { kind: 'callback', args: SOUND },
      text('Body'),
    ]);
    book.open({ reading: brief, arrival: true, paused: false });
    expect(fired.length).toBeGreaterThan(0);
    expect(new Set(fired.map((args) => args.join()))).toEqual(new Set([SOUND.join()]));
    expect(shown.at(-1)).toEqual({ args: SOUND, lang: 'pol', spread: '0:0' });
  });

  it('hands on nothing on the goals tab or while the book is closed', () => {
    const { book, fired, shown } = mountWindow([{ kind: 'callback', args: NODE }, text('Body')]);
    book.open({ reading: { ...brief, tab: 'goals' }, arrival: false, paused: false });
    expect(fired).toEqual([]);
    expect(shown.every((callback) => callback === null)).toBe(true);
    book.open({ reading: brief, arrival: false, paused: false });
    expect(fired.at(-1)).toEqual(NODE);
    book.close();
    const count = fired.length;
    book.rebuild();
    expect(fired).toHaveLength(count);
  });
});
