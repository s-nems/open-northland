// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissionInfoRow } from '../src/game/info-lines.js';
import { createBookWindow } from '../src/hud/dom/mission-book/book-window.js';
import { GoalMarks } from '../src/hud/dom/mission-book/goal-marks.js';
import { createGoalSlip } from '../src/hud/dom/mission-book/goal-slip.js';

const count = (have: number): readonly MissionInfoRow[] => [
  { kind: 'progress', label: 'Diamonds', have, need: 10 },
];
const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function slip() {
  const open = vi.fn();
  const panel = createGoalSlip({ plane: document.body, bookKey: () => 'M', onOpenBook: open, cue: () => {} });
  const marks = new GoalMarks();
  return { panel, marks, open, dock: document.querySelector<HTMLElement>('.on-slip') };
}

describe('mission progress on the goal slip', () => {
  it('shows counters without visible mission goals, updates while folded and opens the book', () => {
    const { panel, marks, dock, open } = slip();
    panel.update([], marks, false, count(3));
    expect(dock?.hidden).toBe(false);
    expect(dock?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
    dock?.querySelector<HTMLButtonElement>('[data-fold]')?.click();
    panel.update([], marks, false, count(4));
    expect(panel.isFolded()).toBe(true);
    expect(dock?.querySelector('.on-slip__progress')?.textContent).toBe('4/10');
    expect(dock?.querySelector('.on-slip__sheet')).toBeNull();
    dock?.querySelector<HTMLButtonElement>('[data-fold]')?.click();
    dock?.querySelector<HTMLButtonElement>('[data-book]')?.click();
    expect(open).toHaveBeenCalledOnce();
    panel.update([], marks, true, count(4));
    expect(dock?.hidden).toBe(true);
    panel.update([], marks, false, []);
    expect(dock?.hidden).toBe(true);
  });

  it('keeps script text safe, removes departed rows and bounds over-target bars', () => {
    const { panel, marks, dock } = slip();
    panel.update([], marks, false, [...count(14), { kind: 'text', text: '<img src=x> A team won!' }]);
    expect(dock?.querySelector('img')).toBeNull();
    expect(dock?.textContent).toContain('<img src=x> A team won!');
    expect(dock?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('10');
    expect(dock?.querySelector('.on-goal-info__count')?.textContent).toContain('14');
    panel.update([], marks, false, [{ kind: 'text', text: 'Next wave' }]);
    expect(dock?.querySelector('[role="progressbar"]')).toBeNull();
    expect(dock?.textContent).toContain('Next wave');
  });

  it('does not replace unchanged DOM on another read or reset the folded state', () => {
    const { panel, marks, dock } = slip();
    panel.update([], marks, false, count(3));
    const content = dock?.querySelector('.on-slip__content');
    if (content) content.scrollTop = 84;
    const button = dock?.querySelector<HTMLButtonElement>('[data-fold]');
    button?.focus();
    panel.update([], marks, false, count(3));
    expect(dock?.querySelector('[data-fold]')).toBe(button);
    panel.update([], marks, false, count(4));
    expect(dock?.querySelector('.on-slip__content')?.scrollTop).toBe(84);
    expect(document.activeElement).toBe(dock?.querySelector('[data-fold]'));
    panel.setFolded(true);
    panel.update([], marks, false, [...count(4), { kind: 'progress', label: 'People', have: 12, need: 20 }]);
    expect(panel.isFolded()).toBe(true);
    expect(dock?.querySelector('.on-slip__progress')?.getAttribute('title')).toBe(
      'Diamonds 4/10, People 12/20',
    );
  });
});

it('refreshes counters on an open goal page even when the mission list stays unchanged', () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
  let rows = count(3);
  const goals: [] = [];
  const book = createBookWindow({
    plane: document.body,
    voice: null,
    chapters: () => [],
    page: () => ({ title: '', blocks: [], lang: null }),
    goals: () => goals,
    infoRows: () => rows,
    missionName: 'Test',
    history: null,
    missionHuman: () => null,
    pictureUrl: () => '',
    onShowOnMap: () => {},
    onCallback: () => {},
    takeGoalMarks: () => new Map(),
    onDismiss: () => {},
    cue: () => {},
  });
  book.open({
    reading: { tab: 'goals', chapter: 0, spread: 0, table: null, pick: 0 },
    arrival: false,
    paused: false,
  });
  expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('3');
  const sheet = document.querySelector('.on-book__sheet');
  if (sheet) sheet.scrollTop = 92;
  rows = count(8);
  book.refresh();
  expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('8');
  expect(document.querySelector('.on-book__sheet')?.scrollTop).toBe(92);
  rows = [];
  book.refresh();
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
  book.dispose();
});
