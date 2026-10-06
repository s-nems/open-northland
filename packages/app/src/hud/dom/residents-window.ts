import type { UiCue } from '@open-northland/audio';
import { pickerEntries } from '../../catalog/professions.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { productSelectionLabel } from '../details-panel/model/settler-work.js';
import { type FigureBox, type FigureSlot, NO_FIGURE_SLOTS } from '../figures/live-figures.js';
import type { CanBecomeOption } from '../tool-panel/residents/can-become.js';
import {
  filtersActive,
  filtersRemembered,
  INITIAL_RESIDENTS_STATE,
  listResidents,
  NO_RESIDENT_FILTERS,
  type PickGesture,
  pickedGroup,
  pickGestureOf,
  RESIDENT_GROUPS,
  RESIDENT_LACKS,
  type ResidentFilters,
  type ResidentGroup,
  type ResidentLack,
  type ResidentListing,
  type ResidentRow,
  type ResidentSortKey,
  type ResidentsWindowState,
  sameTradePick,
  sortResidents,
  type TradePick,
  tradePickKey,
} from '../tool-panel/residents/rows.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import type { ChoiceGroup } from './choice-window.js';
import { type GoodIconPainter, goodIconMarkup } from './good-art.js';
import { GLYPH, RESIDENTS_TOKEN } from './icons.js';
import { button, element, setAttribute, setHidden, setValue, write } from './parts/dom.js';
import { type DropdownEntry, type DropdownHandle, dropdownControl } from './parts/dropdown.js';
import { quietTextField } from './parts/text-field.js';
import { professionChoices } from './profession-choices.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px: the central window width shared with the construction window. */
const RESIDENTS_WINDOW_W = 640;

const LACK_GLYPH: Readonly<Record<ResidentLack, string>> = {
  home: GLYPH.house,
  post: GLYPH.forge,
  tool: GLYPH.tool,
  shoes: GLYPH.boot,
  partner: GLYPH.heart,
  children: GLYPH.cradle,
  weapon: GLYPH.blade,
  mead: GLYPH.mug,
};

const SORT_KEYS: readonly ResidentSortKey[] = ['name', 'profession', 'workplace', 'lacks'];

/** A row figure's map px per design px, and how far above its box's bottom edge the feet stand (design
 *  px). */
const ROW_FIGURE_ZOOM = 0.72;
const ROW_FIGURE_FEET_INSET = 2;
/** Wall-clock ms between two reads of a new tick's people while the window stays open: a thousand rows
 *  filter, sort and rewrite in a few ms, which every tick at x3 would pay for no visible difference. */
const ROWS_REFRESH_MS = 250;
/** Rows attached beyond each edge of the visible strip, so a wheel turn shows written rows at once. */
const ROW_MARGIN = 8;
/** Rows attached before a row's height is known: enough to fill the list's first view. */
const ROWS_BEFORE_MEASURE = 32;
/** Design px of a product's icon after the profession. */
const PRODUCT_ICON_PX = 20;
/** Icons the profession column has room for beside a long trade name; the rest read as "+N". */
const PRODUCT_ICONS_MAX = 4;

export interface ResidentsWindowDeps {
  readonly plane: HTMLElement;
  /** The seat's people. A new array means a new tick's list; the same one costs nothing. */
  readonly rows: () => readonly ResidentRow[];
  /** The current game tick, which times how long a closed window remembers its filters. */
  readonly tick: () => number;
  /** The sim's rule behind the "can become" filter, asked only while that filter is set. */
  readonly canBecome: (id: number, pick: TradePick) => boolean;
  /** Bumped when a `canBecome` answer lands anew, which relists under unchanged rows; absent, only new
   *  rows relist. */
  readonly answersVersion?: () => number;
  /** The trades the "can become" filter offers, in picker order. */
  readonly trades: readonly CanBecomeOption[];
  /** The unit controls' selection, which the rows light for; `version` moves with every change. */
  readonly selection: { readonly ids: () => ReadonlySet<number>; readonly version: () => number };
  /** A row or the whole shown list was picked: `extend` adds to the selected group and the window
   *  stays; without it the pick replaces the selection, a single one is shown on the map, and the
   *  window has already closed. */
  readonly onSelect: (ids: readonly number[], show: boolean) => void;
  readonly cue: (cue: UiCue) => void;
  /** Paints the goods a worker is set to make after its profession; absent shows the profession alone. */
  readonly icons?: GoodIconPainter;
}

/** The residents window on the DOM plane: the search and the two profession filters, the group row and the
 *  lacks row as one grid of chips, and the parchment list with sortable heads. It takes part in the window
 *  registry like a legacy pop-up, but the plane routes its own pointer input, so it claims no canvas
 *  point. */
export interface ResidentsWindow extends ToolWindow {
  /** Once a frame: re-place an open window, relist on a new tick or selection. */
  refresh(): void;
  /** The figures of the rows on screen, which the owner paints every frame; none while closed. */
  figureSlots(): readonly FigureSlot[];
  state(): ResidentsWindowState;
  restore(state: ResidentsWindowState): void;
  /** The close medallion was pressed; the owner returns focus to the beam. */
  onDismiss(listener: () => void): void;
  dispose(): void;
}

interface RowView {
  readonly item: HTMLLIElement;
  readonly pick: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
  readonly cells: readonly [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
  /** The profession cell's trade name and the goods after it. */
  readonly trade: HTMLElement;
  readonly goods: HTMLElement;
  shown: string;
}

/** Cmd stands in for Ctrl, whose click opens the context menu on macOS. */
const gestureOf = (event: MouseEvent): PickGesture =>
  pickGestureOf({ range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });

/** A chip caption: every word opens with a capital, as the panel's "Workplace" labels do. */
function capitalized(text: string, locale: string): string {
  return text
    .split(' ')
    .map((word) => word.charAt(0).toLocaleUpperCase(locale) + word.slice(1))
    .join(' ');
}

export function createResidentsWindow(deps: ResidentsWindowDeps): ResidentsWindow {
  const copy = messages().hud.residentsWindow;
  const locale = bcp47Tag();
  const window = createHudWindow(deps.plane, {
    title: copy.title,
    art: RESIDENTS_TOKEN,
    closeLabel: messages().hud.shell.close,
    width: RESIDENTS_WINDOW_W,
  });
  window.element.classList.add('on-window--residents');
  window.body.classList.add('on-window__body--column');
  let state: ResidentsWindowState = INITIAL_RESIDENTS_STATE;

  // The search and the two profession filters.
  const find = element('div', 'on-res-find');
  const search = element(
    'label',
    'on-res-field on-res-field--search',
    `${GLYPH.search}<input type="search">`,
  );
  const query = search.querySelector('input');
  if (query === null) throw new Error('residents: search field');
  query.placeholder = copy.searchPlaceholder;
  query.setAttribute('aria-label', copy.searchLabel);
  quietTextField(query);
  // The caption sits in the dropdown's own field, so the list opens under both.
  const selectField = (caption: string, onPick: (key: string) => void): DropdownHandle<string> => {
    const dropdown = dropdownControl<string>({
      label: caption,
      className: 'on-res-select',
      entries: [],
      active: '',
      onPick,
    });
    dropdown.root.classList.add('on-res-field');
    const text = element('span', '');
    text.textContent = caption;
    dropdown.root.prepend(text);
    find.append(dropdown.root);
    return dropdown;
  };
  find.append(search);
  const professionSelect = selectField(copy.job, (key) => {
    setFilters({ ...state.filters, profession: key });
  });
  const canBecomeSelect = selectField(copy.canBecome, (key) => {
    setFilters({
      ...state.filters,
      canBecome: deps.trades.find((trade) => tradePickKey(trade.pick) === key)?.pick ?? null,
    });
  });
  const professionGroups = professionChoices(
    pickerEntries(),
    () => true,
    () => true,
  );
  const optionGroups = (groups: readonly ChoiceGroup[]): DropdownEntry<string>[] =>
    groups
      .filter((group) => group.rows.length > 0)
      .map((group) => ({
        group: group.label,
        choices: group.rows.map((row) => ({ id: row.key, label: row.label })),
      }));
  // Each profession row stands for the picks of its trade, in the category the picker files it under.
  canBecomeSelect.setEntries([
    { id: '', label: copy.anyone },
    ...optionGroups(
      professionGroups.map((group) => ({
        ...group,
        rows: group.rows.flatMap((row) =>
          deps.trades
            .filter((trade) => String(trade.pick.jobType) === row.key)
            .map((trade) => ({ key: tradePickKey(trade.pick), label: trade.label })),
        ),
      })),
    ),
  ]);

  // Both chip rows share one grid, so their cells line up edge to edge.
  const chipRow = (caption: string, label: string): HTMLElement => {
    const row = element(
      'div',
      'on-res-chips',
      `<span class="on-res-chips__label" aria-hidden="true"></span>`,
    );
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', label);
    if (row.firstElementChild !== null) row.firstElementChild.textContent = caption;
    return row;
  };
  const chip = (caption: string, glyph: string): { button: HTMLButtonElement; count: HTMLElement } => {
    const control = button(
      'on-res-chip',
      `<span class="on-res-chip__count">${glyph}<b></b></span><span class="on-res-chip__label"></span>`,
    );
    const [count, label] = [control.querySelector('b'), control.querySelector('.on-res-chip__label')];
    if (count === null || label === null) throw new Error('residents: chip');
    label.textContent = caption;
    return { button: control, count };
  };
  const groupRow = chipRow(copy.who, copy.who);
  const groupChips = new Map<ResidentGroup, { button: HTMLButtonElement; count: HTMLElement }>();
  for (const id of RESIDENT_GROUPS) {
    const view = chip(copy.groups[id], '');
    view.button.addEventListener('click', () => {
      deps.cue('confirm');
      setFilters({ ...state.filters, group: id });
    });
    groupChips.set(id, view);
    groupRow.append(view.button);
  }
  const lackRow = chipRow(copy.without, copy.lacksLabel);
  lackRow.classList.add('on-res-chips--lacks');
  const lackChips = new Map<ResidentLack, { button: HTMLButtonElement; count: HTMLElement }>();
  for (const id of RESIDENT_LACKS) {
    const view = chip(capitalized(copy.lacks[id], locale), LACK_GLYPH[id]);
    view.button.title = formatMessage(copy.lackTitle, { what: copy.lacks[id] });
    view.button.addEventListener('click', () => {
      deps.cue('confirm');
      const lacks = state.filters.lacks.includes(id)
        ? state.filters.lacks.filter((held) => held !== id)
        : [...state.filters.lacks, id];
      setFilters({ ...state.filters, lacks });
    });
    lackChips.set(id, view);
    lackRow.append(view.button);
  }

  // The parchment: the summary line, the sortable heads, the list, and the two empty notes.
  const sheet = element('div', 'on-parchment on-res-sheet');
  const summary = element('p', 'on-parchment__note on-res-summary', `<span></span>`);
  const summaryText = summary.firstElementChild;
  const clearButton = (): HTMLButtonElement => {
    const control = button('on-res-clear');
    control.textContent = copy.clear;
    control.addEventListener('click', (event) => {
      deps.cue('confirm');
      setFilters(NO_RESIDENT_FILTERS);
      if (event.detail === 0) query.focus({ preventScroll: true });
    });
    return control;
  };
  const clear = clearButton();
  const closeButton = window.element.querySelector('.on-window__close');
  if (closeButton === null) throw new Error('residents: close button');
  closeButton.before(clear);
  const head = element('div', 'on-res-head', `<span></span>`);
  const heads = new Map<ResidentSortKey, HTMLButtonElement>();
  for (const key of SORT_KEYS) {
    const control = button('');
    control.textContent = copy.columns[key];
    control.addEventListener('click', () => {
      deps.cue('confirm');
      state = { ...state, sort: { key, descending: state.sort.key === key && !state.sort.descending } };
      relist();
    });
    heads.set(key, control);
    head.append(control);
  }
  const list = element('ul', 'on-res-list');
  const emptyNote = (title: string, text: string): HTMLElement => {
    const note = element('div', 'on-catalog__empty', `<strong></strong><span></span>`);
    const [strong, span] = note.children;
    if (strong !== undefined) strong.textContent = title;
    if (span !== undefined) span.textContent = text;
    return note;
  };
  const noMatch = emptyNote(copy.noMatchTitle, copy.noMatchText);
  noMatch.append(clearButton());
  const none = emptyNote(copy.noneTitle, copy.noneText);
  sheet.append(summary, head, list, noMatch, none);

  const foot = element(
    'footer',
    'on-res-foot',
    `<span class="on-res-hint"><kbd></kbd> <span></span> · <kbd>Ctrl</kbd> <span></span> · <kbd>Shift</kbd> <span></span></span><span class="on-res-picked"></span>`,
  );
  const [hintClick] = foot.querySelectorAll('kbd');
  const hintTexts = foot.querySelectorAll('.on-res-hint > span');
  if (hintClick !== undefined) hintClick.textContent = copy.hintClick;
  [copy.hintClickDoes, copy.hintToggleDoes, copy.hintRangeDoes].forEach((text, index) => {
    const node = hintTexts[index];
    if (node !== undefined) node.textContent = text;
  });
  const picked = foot.querySelector('.on-res-picked');
  const selectShown = button('on-button on-res-all', `<span></span><span class="on-count"></span>`);
  const [selectShownLabel, shownCount] = selectShown.querySelectorAll('span');
  if (!(picked instanceof HTMLElement) || selectShownLabel === undefined || shownCount === undefined) {
    throw new Error('residents: footer');
  }
  selectShownLabel.textContent = copy.selectShown;
  foot.append(selectShown);
  window.body.append(find, groupRow, lackRow, sheet, foot);

  // One row view per listed person met on screen, kept while they live. Only the rows in and near the
  // visible strip are in the list, between two spacers that keep the scroll height of the whole: a tick
  // rewrites only attached rows that changed, and no frame reads layout.
  const views = new Map<number, RowView>();
  let shownIds: readonly number[] = [];
  let listedRows: readonly ResidentRow[] = [];
  const padTop = element('li', 'on-res-pad');
  const padBottom = element('li', 'on-res-pad');
  /** The attached rows, indices into `listedRows`, both ends inclusive. */
  let attached = { first: 0, last: -1 };
  /** A row's height and the list's visible height, layout px; 0 until measured on a shown list. */
  let rowPx = 0;
  let viewPx = 0;
  /** The row figures' box, read with the heights. */
  let figureBox: FigureBox | null = null;
  let rows: readonly ResidentRow[] | null = null;
  /** When the window last asked for the seat's people. */
  let rowsReadAt = Number.NEGATIVE_INFINITY;
  let shownSelection = -1;
  let listedAnswers = -1;
  let figuresStale = true;

  /** The last row pressed without Shift, where a range press starts. */
  let anchor: number | null = null;
  const select = (ids: readonly number[], show: boolean): void => {
    deps.cue('confirm');
    if (show) window.close();
    deps.onSelect(ids, show);
  };
  const pickRow = (id: number, event: MouseEvent): void => {
    const gesture = gestureOf(event);
    if (gesture === 'show' || gesture === 'toggle') anchor = id;
    select(pickedGroup(gesture, id, deps.selection.ids(), shownIds, anchor), gesture === 'show');
  };
  // Pressed plain, the button selects the listed people and closes; with a modifier it adds them.
  selectShown.addEventListener('click', (event) => {
    if (shownIds.length === 0) return;
    if (gestureOf(event) === 'show') select(shownIds, true);
    else select([...new Set([...deps.selection.ids(), ...shownIds])], false);
  });

  const buildRow = (id: number): RowView => {
    const item = element('li', '');
    const control = button(
      'on-res-row',
      `<span class="on-res-row__figure"><canvas aria-hidden="true"></canvas></span><strong></strong><span class="on-res-row__job"><span></span><span class="on-res-row__goods"></span></span><span></span><span class="on-res-row__lacks"></span>`,
    );
    const canvas = control.querySelector('canvas');
    const [name, profession, workplace, lacks] = [...control.children].slice(1);
    if (
      canvas === null ||
      !(name instanceof HTMLElement) ||
      !(profession instanceof HTMLElement) ||
      !(workplace instanceof HTMLElement) ||
      !(lacks instanceof HTMLElement)
    ) {
      throw new Error('residents: row markup');
    }
    const [trade, goods] = profession.children;
    if (!(trade instanceof HTMLElement) || !(goods instanceof HTMLElement))
      throw new Error('residents: job cell');
    control.addEventListener('click', (event) => pickRow(id, event));
    item.append(control);
    return {
      item,
      pick: control,
      canvas,
      cells: [name, profession, workplace, lacks],
      trade,
      goods,
      shown: '',
    };
  };

  /** The goods after the profession: their icons, or the one word while every open one runs. */
  const writeProducts = (goods: HTMLElement, word: string | null, goodIds: readonly string[]): void => {
    setHidden(goods, word === null && (goodIds.length === 0 || deps.icons === undefined));
    if (word !== null) {
      goods.textContent = word;
      return;
    }
    const shown = goodIds.slice(0, PRODUCT_ICONS_MAX);
    goods.innerHTML = shown.map(() => goodIconMarkup(PRODUCT_ICON_PX)).join('');
    for (const [index, frame] of goods.querySelectorAll<HTMLElement>('.on-good__frame').entries()) {
      const goodId = shown[index];
      if (goodId !== undefined) deps.icons?.(frame, goodId, PRODUCT_ICON_PX);
    }
    if (goodIds.length > shown.length)
      goods.append(element('small', '', `+${goodIds.length - shown.length}`));
  };

  const writeRow = (view: RowView, row: ResidentRow): void => {
    const profession =
      row.ageYears === null
        ? row.profession
        : formatMessage(copy.childAge, { stage: row.profession, years: row.ageYears });
    const products = row.products;
    const goodIds =
      products?.running.flatMap((good) => (good.goodId === undefined ? [] : [good.goodId])) ?? [];
    const made = products === null ? null : productSelectionLabel(products);
    const key = [
      row.name,
      profession,
      made ?? '',
      goodIds.join(','),
      row.workplace,
      row.lacks.join(','),
    ].join('|');
    if (key === view.shown) return;
    view.shown = key;
    const [name, job, workplace, lacks] = view.cells;
    name.textContent = row.name;
    name.title = row.name;
    view.trade.textContent = profession;
    // Worded as the hover card words it: "Zbieracz - Drewno, Grzyb".
    job.title = made === null ? profession : `${profession} - ${made}`;
    writeProducts(view.goods, products?.all === true ? made : null, goodIds);
    workplace.textContent = row.workplace === '' ? copy.noWorkplace : row.workplace;
    workplace.title = row.workplace;
    lacks.replaceChildren(
      ...row.lacks.map((id) => {
        const mark = element('i', '', LACK_GLYPH[id]);
        mark.title = formatMessage(copy.lackTitle, { what: copy.lacks[id] });
        return mark;
      }),
    );
  };

  const showFilters = (): void => {
    const { filters } = state;
    for (const [id, view] of groupChips)
      setAttribute(view.button, 'aria-pressed', String(id === filters.group));
    for (const [id, view] of lackChips) {
      setAttribute(view.button, 'aria-pressed', String(filters.lacks.includes(id)));
    }
    setValue(query, filters.query);
    canBecomeSelect.setActive(filters.canBecome === null ? '' : tradePickKey(filters.canBecome));
  };

  const showSummary = (all: readonly ResidentRow[], shown: number): void => {
    const { filters } = state;
    const active = filtersActive(filters);
    const parts = [
      filters.group === 'all' ? '' : copy.groups[filters.group],
      ...filters.lacks.map((id) =>
        formatMessage(copy.lackTitle, { what: copy.lacks[id] }).toLocaleLowerCase(locale),
      ),
      filters.profession === '' ? '' : formatMessage(copy.filterJob, { name: filters.profession }),
      filters.canBecome === null
        ? ''
        : formatMessage(copy.filterCanBecome, {
            name: deps.trades.find((trade) => sameTradePick(trade.pick, filters.canBecome))?.label ?? '',
          }),
      filters.query.trim() === '' ? '' : formatMessage(copy.filterQuery, { query: filters.query.trim() }),
    ].filter((part) => part !== '');
    if (summaryText !== null) {
      write(
        summaryText,
        active
          ? [formatMessage(copy.shown, { shown, count: all.length }), ...parts].join(' · ')
          : formatMessage(copy.everyone, { count: all.length }),
      );
    }
    setHidden(clear, !active);
    setHidden(summary, all.length === 0);
    setHidden(none, all.length > 0);
    setHidden(noMatch, all.length === 0 || shown > 0);
    setHidden(head, shown === 0);
    setHidden(list, shown === 0);
  };

  let shownProfessions = '';
  const showCounts = ({ counts, professions }: ResidentListing): void => {
    for (const [id, view] of groupChips) {
      write(view.count, String(counts.groups[id]));
      view.button.classList.toggle('on-res-chip--zero', counts.groups[id] === 0);
    }
    for (const [id, view] of lackChips) {
      const count = counts.lacks[id];
      write(view.count, String(count));
      view.button.classList.toggle('on-res-chip--zero', count === 0);
      setAttribute(view.button, 'aria-label', formatMessage(copy.lackCount, { what: copy.lacks[id], count }));
    }
    // The profession filter lists the trades the other filters keep; the picked one stays listed
    // when they keep nobody of it, so the filter never clears itself under the player.
    const held = state.filters.profession;
    const entries =
      professions.some((entry) => entry.profession === held) || held === ''
        ? professions
        : [...professions, { profession: held, count: 0 }];
    const key = entries.map((entry) => `${entry.profession}:${entry.count}`).join('|');
    if (shownProfessions !== key) {
      shownProfessions = key;
      const known = new Set(professionGroups.flatMap((group) => group.rows.map((row) => row.label)));
      const optionLabel = (entry: (typeof entries)[number]): string =>
        formatMessage(copy.jobOption, { name: entry.profession, count: entry.count });
      professionSelect.setEntries([
        { id: '', label: copy.anyJob },
        ...entries
          .filter((entry) => !known.has(entry.profession))
          .map((entry) => ({ id: entry.profession, label: optionLabel(entry) })),
        ...optionGroups(
          professionGroups.map((group) => ({
            label: group.label,
            rows: group.rows.flatMap((row) => {
              const entry = entries.find((entry) => entry.profession === row.label);
              return entry === undefined ? [] : [{ key: entry.profession, label: optionLabel(entry) }];
            }),
          })),
        ),
      ]);
    }
    professionSelect.setActive(held);
  };

  const showSelection = (): void => {
    const selected = deps.selection.ids();
    let count = 0;
    for (const id of shownIds) {
      const on = selected.has(id);
      if (on) count += 1;
      const view = views.get(id);
      if (view !== undefined) setAttribute(view.pick, 'aria-pressed', String(on));
    }
    write(picked, formatMessage(copy.picked, { count }));
    setHidden(picked, count === 0);
  };

  /** The scroll the list can hold with `count` rows: a narrowed list keeps the deep scroll of the
   *  wide one until the browser clamps it, which it does a view at a time. */
  const scrollFor = (count: number): number => Math.min(state.scrollTop, Math.max(0, count * rowPx - viewPx));

  /** The rows to attach for the list's scroll: the visible strip and a margin either side. */
  const rangeFor = (count: number): { first: number; last: number } => {
    if (rowPx <= 0) return { first: 0, last: Math.min(count, ROWS_BEFORE_MEASURE) - 1 };
    const scroll = scrollFor(count);
    const first = Math.max(0, Math.floor(scroll / rowPx) - ROW_MARGIN);
    const last = Math.min(count - 1, Math.ceil((scroll + viewPx) / rowPx) + ROW_MARGIN);
    return { first, last };
  };

  /** Attach the rows the scroll shows, written from the listed rows; `reordered` forces the list's
   *  children to be laid again although the range held. */
  const attach = (reordered: boolean): void => {
    const range = rangeFor(listedRows.length);
    const moved = reordered || range.first !== attached.first || range.last !== attached.last;
    const items: HTMLLIElement[] = [];
    for (let at = range.first; at <= range.last; at++) {
      const row = listedRows[at];
      if (row === undefined) continue;
      let view = views.get(row.id);
      if (view === undefined) {
        view = buildRow(row.id);
        views.set(row.id, view);
        // A row built by a scroll is not reached by the relist's selection pass.
        setAttribute(view.pick, 'aria-pressed', String(deps.selection.ids().has(row.id)));
      }
      writeRow(view, row);
      items.push(view.item);
    }
    if (moved) {
      // Re-appending a row drops its focus; hand it back without moving the scroll.
      const focused = document.activeElement;
      padTop.style.height = `${range.first * rowPx}px`;
      padBottom.style.height = `${Math.max(0, listedRows.length - range.last - 1) * rowPx}px`;
      list.replaceChildren(padTop, ...items, padBottom);
      if (focused instanceof HTMLElement && list.contains(focused)) focused.focus({ preventScroll: true });
      attached = range;
      figuresStale = true;
    }
  };

  /** Read a row's height, the list's and the figure box once the list shows rows: on open and when the
   *  window moved, never per frame. */
  const measure = (): void => {
    const first = list.querySelector<HTMLElement>('.on-res-row');
    const canvas = first?.querySelector('canvas');
    if (first === null || canvas === null || canvas === undefined) return;
    rowPx = first.parentElement?.offsetHeight ?? 0;
    viewPx = list.clientHeight;
    const pixelScale =
      (canvas.getBoundingClientRect().width / Math.max(1, canvas.offsetWidth)) * devicePixelRatio;
    figureBox = { width: canvas.clientWidth, height: canvas.clientHeight, pixelScale };
    attach(false);
  };

  /** Filter, order and write the list from the rows in hand; focus and scroll stay where they were. */
  const relist = (): void => {
    const all = rows ?? [];
    const listing = listResidents(all, state.filters, locale, deps.canBecome);
    const listed = sortResidents(listing.shown, state.sort, locale);
    const alive = new Set<number>();
    for (const row of all) alive.add(row.id);
    for (const id of views.keys()) if (!alive.has(id)) views.delete(id);
    listedRows = listed;
    const ids = listed.map((row) => row.id);
    attach(ids.length !== shownIds.length || ids.some((id, index) => id !== shownIds[index]));
    // A window opened over no people has no row to measure yet.
    if (rowPx <= 0 && listed.length > 0) measure();
    shownIds = ids;
    for (const [key, control] of heads) {
      // The lacks key opens with the neediest, which reads as a descending column.
      const down = state.sort.descending !== (key === 'lacks');
      const direction = key !== state.sort.key ? 'none' : down ? 'descending' : 'ascending';
      if (control.dataset.sort === direction) continue;
      control.dataset.sort = direction;
      const column = copy.columns[key];
      if (direction === 'none') control.removeAttribute('aria-label');
      else {
        const label = direction === 'descending' ? copy.sortedDescending : copy.sortedAscending;
        control.setAttribute('aria-label', formatMessage(label, { column }));
      }
    }
    write(shownCount, String(ids.length));
    selectShown.disabled = ids.length === 0;
    showFilters();
    showCounts(listing);
    showSummary(all, ids.length);
    showSelection();
    shownSelection = deps.selection.version();
    figuresStale = true;
  };

  const setFilters = (filters: ResidentFilters): void => {
    state = { ...state, filters };
    relist();
  };
  query.addEventListener('input', () => setFilters({ ...state.filters, query: query.value }));
  // The shell leaves a text field its keys, so the field takes Escape itself, and keeps it from the
  // unit controls' own Escape ladder: the first press clears a typed query, the next closes the window.
  query.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (query.value === '') window.dismiss();
    else setFilters({ ...state.filters, query: '' });
  });
  // Kept live: a hidden element reads its scroll as 0, so the close cannot read it back.
  list.addEventListener('scroll', () => {
    state = { ...state, scrollTop: list.scrollTop };
    attach(false);
    figuresStale = true;
  });

  /** The figures of the rows inside the list's visible strip, found by arithmetic on the scroll. */
  let visibleSlots: readonly FigureSlot[] = NO_FIGURE_SLOTS;
  const measureVisible = (): void => {
    figuresStale = false;
    const box = figureBox;
    if (box === null || box.pixelScale <= 0 || rowPx <= 0) {
      visibleSlots = NO_FIGURE_SLOTS;
      return;
    }
    const slots: FigureSlot[] = [];
    const scroll = scrollFor(listedRows.length);
    const first = Math.floor(scroll / rowPx);
    const last = Math.min(listedRows.length - 1, Math.ceil((scroll + viewPx) / rowPx) - 1);
    for (let at = first; at <= last; at++) {
      const row = listedRows[at];
      const view = row === undefined ? undefined : views.get(row.id);
      if (row === undefined || view === undefined) continue;
      slots.push({
        entity: row.id,
        canvas: view.canvas,
        box,
        zoom: ROW_FIGURE_ZOOM,
        feetInset: ROW_FIGURE_FEET_INSET,
      });
    }
    visibleSlots = slots;
  };

  const placeWindow = centralWindowPlacer(window, deps.plane, RESIDENTS_WINDOW_W);
  const place = (): void => {
    // A moved plane shows other rows, at another pixel scale.
    if (placeWindow()) {
      measure();
      figuresStale = true;
    }
  };

  /** The last tick the window was seen open; a frame's refresh keeps it current, so it reads as the
   *  close tick however the window closed. */
  let lastOpenTick: number | null = null;
  const open = (): void => {
    const tick = deps.tick();
    if (!filtersRemembered(lastOpenTick, tick)) {
      state = { ...state, filters: NO_RESIDENT_FILTERS, scrollTop: 0 };
    }
    lastOpenTick = tick;
    anchor = null;
    rows = deps.rows();
    window.open();
    place(); // the list needs its height bound before a restored scroll can land
    relist();
    measure();
    list.scrollTop = state.scrollTop;
  };

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? window.close() : open()),
    close: window.close,
    claims: () => false,
    handleClick: () => false,
    refresh: () => {
      if (!window.isOpen()) return;
      lastOpenTick = deps.tick();
      place();
      const now = performance.now();
      let next = rows;
      if (now - rowsReadAt >= ROWS_REFRESH_MS) {
        next = deps.rows();
        rowsReadAt = now;
      }
      const answers = deps.answersVersion?.() ?? 0;
      if (next !== rows || (state.filters.canBecome !== null && answers !== listedAnswers)) {
        rows = next;
        listedAnswers = answers;
        relist();
      } else if (deps.selection.version() !== shownSelection) {
        showSelection();
        shownSelection = deps.selection.version();
      }
      if (figuresStale) measureVisible();
    },
    figureSlots: () => (window.isOpen() ? visibleSlots : NO_FIGURE_SLOTS),
    state: () => state,
    restore: (next) => {
      state = next;
      if (!window.isOpen()) return;
      relist();
      list.scrollTop = next.scrollTop;
      attach(false);
    },
    onDismiss: window.onDismiss,
    dispose: window.dispose,
  };
}
