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

function openWindow(
  rows: () => readonly ResidentRow[],
  selected: ReadonlySet<number> = new Set(),
): { list: HTMLElement; query: HTMLInputElement } {
  const plane = document.createElement('div');
  document.body.append(plane);
  window = createResidentsWindow({
    plane,
    rows,
    tick: () => 0,
    canBecome: () => false,
    trades: [],
    selection: { ids: () => new Set(selected), version: () => 0 },
    onSelect: () => undefined,
    cue: () => undefined,
  });
  window.toggle();
  const list = plane.querySelector<HTMLElement>('.on-res-list');
  const query = plane.querySelector<HTMLInputElement>('.on-res-field--search input');
  if (list === null || query === null) throw new Error('the window shows its list and search');
  return { list, query };
}

const shownNames = (list: HTMLElement): string[] =>
  [...list.querySelectorAll('.on-res-row strong')].map((cell) => cell.textContent ?? '');

function scrollTo(list: HTMLElement, row: number): void {
  list.scrollTop = row * ROW_PX;
  list.dispatchEvent(new Event('scroll'));
}

const padPx = (list: HTMLElement): number =>
  [...list.querySelectorAll<HTMLElement>('.on-res-pad')].reduce(
    (sum, pad) => sum + Number.parseFloat(pad.style.height || '0'),
    0,
  );

describe('residents list', () => {
  it('attaches only the rows around the visible strip and keeps the whole list scroll height', () => {
    const rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    const attached = list.querySelectorAll('.on-res-row').length;
    expect(attached).toBeLessThan(PEOPLE / 10);
    expect(padPx(list) + attached * ROW_PX).toBe(PEOPLE * ROW_PX);
    expect(shownNames(list)[0]).toBe('Settler 0001');
  });

  it('writes the rows a scroll brings into view and hands their figures out', () => {
    const rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    const middle = 250;
    scrollTo(list, middle);
    window?.refresh();
    expect(shownNames(list)).toContain(`Settler ${String(middle + 1).padStart(4, '0')}`);
    expect(shownNames(list)).not.toContain('Settler 0001');
    const figures = window?.figureSlots().map((slot) => slot.entity) ?? [];
    expect(figures[0]).toBe(middle + 1);
    expect(figures).toHaveLength(VIEW_PX / ROW_PX);
  });

  it('shows a selected person as picked on the row a scroll first builds', () => {
    const rows = people(PEOPLE);
    const picked = 300;
    const { list } = openWindow(() => rows, new Set([picked]));
    scrollTo(list, picked - 5);
    const row = [...list.querySelectorAll<HTMLElement>('.on-res-row')].find((item) =>
      item.textContent?.includes(`Settler ${String(picked).padStart(4, '0')}`),
    );
    expect(row?.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps a narrowed list in view when the wide one was scrolled deep', () => {
    const rows = people(PEOPLE);
    const { list, query } = openWindow(() => rows);
    scrollTo(list, 400);
    query.value = 'Settler 000';
    query.dispatchEvent(new Event('input'));
    const names = shownNames(list);
    expect(names).toHaveLength(9);
    expect(names[0]).toBe('Settler 0001');
    expect(padPx(list)).toBe(0);
  });

  it('measures its rows once people arrive in a window opened over none', () => {
    let rows: ResidentRow[] = [];
    const { list } = openWindow(() => rows);
    rows = people(PEOPLE);
    vi.spyOn(performance, 'now').mockReturnValue(1e9);
    window?.refresh();
    const attached = list.querySelectorAll('.on-res-row').length;
    expect(padPx(list) + attached * ROW_PX).toBe(PEOPLE * ROW_PX);
    expect(window?.figureSlots()).toHaveLength(VIEW_PX / ROW_PX);
  });

  it('rewrites an attached row whose person changed on a later tick', () => {
    let rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    rows = rows.map((row) => (row.id === 2 ? { ...row, workplace: 'Sawmill' } : row));
    window?.refresh();
    const second = list.querySelectorAll('.on-res-row')[1];
    expect(second?.textContent).toContain('Sawmill');
  });

  it("reads a new tick's people at most four times a second while open", () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let rows = people(PEOPLE);
    let reads = 0;
    const { list } = openWindow(() => {
      reads++;
      return rows;
    });
    window?.refresh();
    const before = reads;
    rows = rows.map((row) => (row.id === 1 ? { ...row, workplace: 'Sawmill' } : row));
    now += 100;
    window?.refresh();
    expect(reads).toBe(before);
    expect(list.querySelector('.on-res-row')?.textContent).not.toContain('Sawmill');
    now += 200;
    window?.refresh();
    expect(reads).toBe(before + 1);
    expect(list.querySelector('.on-res-row')?.textContent).toContain('Sawmill');
  });
});
