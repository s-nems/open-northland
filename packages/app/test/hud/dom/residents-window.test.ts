// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResidentsWindow, type ResidentsWindow } from '../../../src/hud/dom/residents-window.js';
import type { ResidentRow } from '../../../src/hud/tool-panel/residents/rows.js';
import { currentLocale, messages, setActiveLocale } from '../../../src/i18n/index.js';

/** The row, list and figure heights the stubbed layout reports, layout px. */
const ROW_PX = 34;
const VIEW_PX = 340;
/** A row figure's box height (foundation.css `.on-res-row__figure`). */
const FIGURE_PX = 33;
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
    trade: 'Civilian',
    ageYears: null,
    workplace: '',
    products: null,
    weapon: null,
    armor: null,
    posted: false,
    lacks: [],
  }));
}

/** jsdom lays nothing out: every list item reports the row height, the list its view, the plane a screen. */
function stubLayout(): void {
  const height = (el: HTMLElement): number => {
    if (el.tagName === 'LI') return ROW_PX;
    if (el.classList.contains('on-res-list')) return VIEW_PX;
    if (el.classList.contains('on-res-row__figure')) return FIGURE_PX;
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
  onSelect: (ids: readonly number[], show: boolean) => void = () => undefined,
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
    onSelect,
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
  it.each([
    ['contextmenu', { ctrlKey: true }],
    ['click', { ctrlKey: true }],
    ['click', { metaKey: true }],
  ] as const)('adds and removes a row with %s %j while leaving the window open', (type, modifiers) => {
    const selected = new Set([1]);
    const onSelect = vi.fn((ids: readonly number[]) => {
      selected.clear();
      for (const id of ids) selected.add(id);
    });
    const { list } = openWindow(() => people(3), selected, onSelect);
    const row = list.querySelectorAll('.on-res-row')[1];
    if (row === undefined) throw new Error('second resident missing');
    row.dispatchEvent(new MouseEvent(type, { bubbles: true, ...modifiers }));
    expect(onSelect).toHaveBeenLastCalledWith([1, 2], false);
    expect(window?.isOpen()).toBe(true);
    row.dispatchEvent(new MouseEvent(type, { bubbles: true, ...modifiers }));
    expect(onSelect).toHaveBeenLastCalledWith([1], false);
    expect(window?.isOpen()).toBe(true);
  });

  it('ignores an ordinary right-click on a row', () => {
    const onSelect = vi.fn();
    const { list } = openWindow(() => people(3), new Set([1]), onSelect);
    list
      .querySelector('.on-res-row')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(window?.isOpen()).toBe(true);
  });

  it('adds all shown residents with the macOS Ctrl context-menu gesture', () => {
    const onSelect = vi.fn();
    openWindow(() => people(3), new Set([99]), onSelect);
    document
      .querySelector('.on-res-all')
      ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ctrlKey: true }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith([99, 1, 2, 3], false);
    expect(window?.isOpen()).toBe(true);
  });

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

  it('paints the row figures off the page and shows their copies on one canvas over the rows', () => {
    const drawn: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          clearRect: () => undefined,
          save: () => undefined,
          restore: () => undefined,
          beginPath: () => undefined,
          roundRect: () => undefined,
          clip: () => undefined,
          drawImage: (source: HTMLCanvasElement) => drawn.push(source),
        }) as never,
    );
    const { list } = openWindow(() => people(PEOPLE));
    window?.refresh();
    const slots = window?.figureSlots() ?? [];
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((slot) => !slot.canvas.isConnected)).toBe(true);
    expect(list.querySelectorAll('canvas')).toHaveLength(1);
    for (const slot of slots) slot.canvas.width = 40;
    window?.markDrawn(new Set(slots.map((slot) => slot.canvas)));
    // The first paint after the rows were laid places the canvas and copies every attached figure.
    expect(drawn).toEqual(expect.arrayContaining(slots.map((slot) => slot.canvas)));
    drawn.length = 0;
    const [first] = slots;
    if (first !== undefined) window?.markDrawn(new Set([first.canvas]));
    expect(drawn).toEqual(first === undefined ? [] : [first.canvas]);
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

  it('leaves the attached rows in place when the list changes outside the strip', () => {
    let rows = people(PEOPLE);
    const { list } = openWindow(() => rows);
    const relaid = vi.spyOn(list, 'replaceChildren');
    rows = rows.slice(0, PEOPLE - 1);
    window?.refresh();
    expect(relaid).not.toHaveBeenCalled();
    const attached = list.querySelectorAll('.on-res-row').length;
    expect(padPx(list) + attached * ROW_PX).toBe((PEOPLE - 1) * ROW_PX);
    rows = rows.slice(1);
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    window?.refresh();
    expect(relaid).toHaveBeenCalledOnce();
    expect(shownNames(list)[0]).toBe('Settler 0002');
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

  it('offers the gear row under the lacks for the soldiers group only, and drops its picks with another group', () => {
    const gear = [
      ['spear', 'light', true],
      ['bow', 'heavy', false],
      ['spear', 'none', false],
    ] as const;
    const soldiers = people(gear.length).map((row, at) => ({
      ...row,
      kind: 'soldier' as const,
      weapon: gear[at]?.[0] ?? null,
      armor: gear[at]?.[1] ?? null,
      posted: gear[at]?.[2] ?? false,
    }));
    const { list } = openWindow(() => soldiers);
    const rows = [...document.querySelectorAll<HTMLElement>('.on-res-chips')];
    const [groupRow, lackRow, gearRow] = rows;
    expect(lackRow?.classList.contains('on-res-chips--lacks')).toBe(true);
    expect(gearRow?.classList.contains('on-res-chips--gear')).toBe(true);
    const chipOf = (row: Element | undefined, label: string): HTMLButtonElement => {
      const chip = [...(row?.querySelectorAll<HTMLButtonElement>('.on-res-chip') ?? [])].find(
        (control) => control.querySelector('.on-res-chip__label')?.textContent === label,
      );
      if (chip === undefined) throw new Error(`no ${label} chip`);
      return chip;
    };
    expect(gearRow?.hidden).toBe(true);
    expect(gearRow?.querySelectorAll('.on-res-chip')).toHaveLength(8); // as many as the rows above
    chipOf(groupRow, 'Soldiers').click();
    expect(gearRow?.hidden).toBe(false);
    expect(chipOf(gearRow, 'Spear').textContent).toContain('2');
    chipOf(gearRow, 'Spear').click();
    expect(shownNames(list)).toEqual(['Settler 0001', 'Settler 0003']);
    chipOf(gearRow, 'No armour').click();
    expect(shownNames(list)).toEqual(['Settler 0003']);
    chipOf(gearRow, 'No armour').click(); // pressed again, it lets every armour through
    expect(shownNames(list)).toHaveLength(2);
    chipOf(gearRow, 'Spear').click(); // and a weapon every weapon
    expect(shownNames(list)).toHaveLength(3);
    expect(chipOf(gearRow, 'Free').textContent).toContain('2');
    chipOf(gearRow, 'Free').click();
    expect(shownNames(list)).toEqual(['Settler 0002', 'Settler 0003']);
    chipOf(gearRow, 'Light armour').click();
    chipOf(groupRow, 'Everyone').click();
    expect(gearRow?.hidden).toBe(true);
    expect(shownNames(list)).toHaveLength(3);
    chipOf(groupRow, 'Soldiers').click(); // the gear picks went with the other group
    expect(shownNames(list)).toHaveLength(3);
  });

  it('files the soldier classes under the military group of the Profession filter', () => {
    const ironSpearman = messages().hud.groupPanel.soldierClass.soldier_spear_iron;
    const [settler, hero] = people(2);
    if (settler === undefined || hero === undefined) throw new Error('two people');
    openWindow(() => [
      { ...settler, kind: 'soldier', profession: ironSpearman, trade: 'Soldier', weapon: 'spear' },
      { ...hero, kind: 'hero', profession: 'Hero', trade: 'Hero' },
    ]);
    const options = [...document.querySelectorAll('.on-res-select-list')][0]?.querySelectorAll(
      '.on-res-select-option',
    );
    const optionOf = (name: string): Element | undefined =>
      [...(options ?? [])].find((option) => option.textContent?.startsWith(name));
    // A class the picker knows sits in a category; a profession it does not leads the list ungrouped.
    expect(optionOf(ironSpearman)?.closest('.on-res-select-group')).toBeInstanceOf(HTMLElement);
    expect(optionOf('Hero')).toBeDefined();
    expect(optionOf('Hero')?.closest('.on-res-select-group')).toBeNull();
  });
});
