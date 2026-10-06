// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResidentsWindow, type ResidentsWindow } from '../src/hud/dom/residents-window.js';
import type { ResidentRow } from '../src/hud/tool-panel/residents/rows.js';
import { currentLocale, setActiveLocale } from '../src/i18n/index.js';

/** The row height and list height the stubbed layout reports, layout px. */
const ROW_PX = 34;
const VIEW_PX = 340;
const PEOPLE = 500;
const locale = currentLocale();

function people(count: number): ResidentRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    // Zero-padded, so the name sort keeps id order.
    name: `Settler ${String(i + 1).padStart(4, '0')}`,
    kind: 'civilian' as const,
    female: false,
    jobType: null,
    profession: 'Civilian',
    ageYears: null,
    workplace: '',
    products: null,
    lacks: [],
  }));
}

/** jsdom lays nothing out: every list item reports the row height, the list its view, the plane a screen. */
function stubLayout(): void {
  const height = (el: HTMLElement): number => {
    if (el.tagName === 'LI') return ROW_PX;
    if (el.classList.contains('on-res-list')) return VIEW_PX;
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return height(this);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(40);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
    return this instanceof HTMLElement ? height(this) || 900 : 0;
  });
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1440);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 40, 33));
}

let window: ResidentsWindow | null = null;
beforeEach(() => {
  setActiveLocale('eng');
  stubLayout();
});
afterEach(() => {
  window?.dispose();
  window = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  setActiveLocale(locale);
});

function openWindow(rows: () => readonly ResidentRow[]): { list: HTMLElement } {
  const plane = document.createElement('div');
  document.body.append(plane);
  window = createResidentsWindow({
    plane,
    rows,
    tick: () => 0,
    canBecome: () => false,
    trades: [],
    selection: { ids: () => new Set(), version: () => 0 },
    onSelect: () => undefined,
    cue: () => undefined,
  });
  window.toggle();
  const list = plane.querySelector<HTMLElement>('.on-res-list');
  if (list === null) throw new Error('the window shows its list');
  return { list };
}

const shownNames = (list: HTMLElement): string[] =>
  [...list.querySelectorAll('.on-res-row strong')].map((cell) => cell.textContent ?? '');

describe('residents list', () => {
  it('attaches only the rows around the visible strip and keeps the whole list scroll height', () => {
    const rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    const items = [...list.children] as HTMLElement[];
    const pads = items.filter((li) => li.classList.contains('on-res-pad'));
    const attached = items.length - pads.length;
    expect(attached).toBeLessThan(PEOPLE / 10);
    const padPx = pads.reduce((sum, pad) => sum + Number.parseFloat(pad.style.height || '0'), 0);
    expect(padPx + attached * ROW_PX).toBe(PEOPLE * ROW_PX);
    expect(shownNames(list)[0]).toBe('Settler 0001');
  });

  it('writes the rows a scroll brings into view and hands their figures out', () => {
    const rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    const middle = 250;
    list.scrollTop = middle * ROW_PX;
    list.dispatchEvent(new Event('scroll'));
    window?.refresh();
    expect(shownNames(list)).toContain(`Settler ${String(middle + 1).padStart(4, '0')}`);
    expect(shownNames(list)).not.toContain('Settler 0001');
    const figures = window?.figureSlots().map((slot) => slot.entity) ?? [];
    expect(figures[0]).toBe(middle + 1);
    expect(figures).toHaveLength(VIEW_PX / ROW_PX);
  });

  it('rewrites an attached row whose person changed on a later tick', () => {
    let rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    rows = rows.map((row) => (row.id === 2 ? { ...row, workplace: 'Sawmill' } : row));
    window?.refresh();
    const second = list.querySelectorAll('.on-res-row')[1];
    expect(second?.textContent).toContain('Sawmill');
  });
});
