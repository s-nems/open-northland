import type { UiCue } from '@open-northland/audio';
import { currentLocale, formatMessage, messages } from '../../i18n/index.js';
import type { ResidentFigureBox, ResidentFigureSlot } from '../tool-panel/residents/figures.js';
import {
  filtersActive,
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
  sortResidents,
} from '../tool-panel/residents/rows.js';
import type { ToolWindow } from '../tool-panel/window-shell.js';
import { GLYPH, RESIDENTS_TOKEN } from './icons.js';
import { centralWindowPlacer, createHudWindow } from './window.js';

/** Design px (FOUNDATION.md): the central window width shared with the construction window. */
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

export interface ResidentsWindowDeps {
  readonly plane: HTMLElement;
  /** The seat's people. A new array means a new tick's list; the same one costs nothing. */
  readonly rows: () => readonly ResidentRow[];
  /** The sim's rule behind the "can become" filter, asked only while that filter is set. */
  readonly canBecome: (id: number, jobType: number) => boolean;
  /** The trades the "can become" filter offers, in picker order. */
  readonly trades: readonly { readonly jobType: number; readonly label: string }[];
  /** The unit controls' selection, which the rows light for; `version` moves with every change. */
  readonly selection: { readonly ids: () => ReadonlySet<number>; readonly version: () => number };
  /** A row or the whole shown list was picked: `extend` adds to the selected group and the window
   *  stays; without it the pick replaces the selection, a single one is shown on the map, and the
   *  window has already closed. */
  readonly onSelect: (ids: readonly number[], show: boolean) => void;
  /** Paint the standing figures of the rows on screen. */
  readonly paintFigures: (slots: readonly ResidentFigureSlot[], box: ResidentFigureBox) => void;
  readonly cue: (cue: UiCue) => void;
}

/** The residents window on the DOM plane (FOUNDATION.md, "Residents window"): the search and the two
 *  profession filters, the group row and the lacks row as one grid of chips, and the parchment list
 *  with sortable heads. It takes part in the window registry like a legacy pop-up, but the plane
 *  routes its own pointer input, so it claims no canvas point. */
export interface ResidentsWindow extends ToolWindow {
  /** Once a frame: re-place an open window, relist on a new tick or selection, paint the figures. */
  refresh(): void;
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
  shown: string;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  html = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

function button(className: string, html = ''): HTMLButtonElement {
  const node = element('button', className, html);
  node.type = 'button';
  return node;
}

/** A tick relists with mostly the same words; an unchanged write would still dirty the layout the
 *  figure pass reads right after. */
function write(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttribute(node: Element, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

function setValue(control: HTMLSelectElement | HTMLInputElement, value: string): void {
  if (control.value !== value) control.value = value;
}

/** Cmd stands in for Ctrl, whose click opens the context menu on macOS. */
const gestureOf = (event: MouseEvent): PickGesture =>
  pickGestureOf({ range: event.shiftKey, toggle: event.ctrlKey || event.metaKey });

/** A chip caption: every word opens with a capital, as the panel's "Miejsce Pracy" labels do. */
function capitalized(text: string, locale: string): string {
  return text
    .split(' ')
    .map((word) => word.charAt(0).toLocaleUpperCase(locale) + word.slice(1))
    .join(' ');
}

export function createResidentsWindow(deps: ResidentsWindowDeps): ResidentsWindow {
  const copy = messages().hud.residentsWindow;
  const locale = currentLocale() === 'pol' ? 'pl' : 'en';
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
  query.autocomplete = 'off';
  const selectField = (caption: string): HTMLSelectElement => {
    const field = element('label', 'on-res-field', `<span></span><select></select>`);
    const [text, select] = [field.querySelector('span'), field.querySelector('select')];
    if (text === null || select === null) throw new Error('residents: select field');
    text.textContent = caption;
    find.append(field);
    return select;
  };
  find.append(search);
  const professionSelect = selectField(copy.job);
  const canBecomeSelect = selectField(copy.canBecome);
  canBecomeSelect.replaceChildren(
    new Option(copy.anyone, ''),
    ...deps.trades.map((trade) => new Option(trade.label, String(trade.jobType))),
  );

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

  // One row per listed person, kept while they live; a tick rewrites only the rows that changed.
  const views = new Map<number, RowView>();
  let shownIds: readonly number[] = [];
  let rows: readonly ResidentRow[] | null = null;
  let shownSelection = -1;
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
      `<span class="on-res-row__figure"><canvas aria-hidden="true"></canvas></span><strong></strong><span></span><span></span><span class="on-res-row__lacks"></span>`,
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
    control.addEventListener('click', (event) => pickRow(id, event));
    item.append(control);
    return { item, pick: control, canvas, cells: [name, profession, workplace, lacks], shown: '' };
  };

  const writeRow = (view: RowView, row: ResidentRow): void => {
    const profession =
      row.ageYears === null
        ? row.profession
        : formatMessage(copy.childAge, { stage: row.profession, years: row.ageYears });
    const key = [row.name, profession, row.workplace, row.lacks.join(',')].join('|');
    if (key === view.shown) return;
    view.shown = key;
    const [name, job, workplace, lacks] = view.cells;
    name.textContent = row.name;
    name.title = row.name;
    job.textContent = profession;
    job.title = profession;
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
    setValue(canBecomeSelect, filters.canBecome === null ? '' : String(filters.canBecome));
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
            name: deps.trades.find((trade) => trade.jobType === filters.canBecome)?.label ?? '',
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
      professionSelect.replaceChildren(
        new Option(copy.anyJob, ''),
        ...entries.map(
          (entry) =>
            new Option(
              formatMessage(copy.jobOption, { name: entry.profession, count: entry.count }),
              entry.profession,
            ),
        ),
      );
    }
    setValue(professionSelect, held);
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

  /** Filter, order and write the list from the rows in hand; focus and scroll stay where they were. */
  const relist = (): void => {
    const all = rows ?? [];
    const listing = listResidents(all, state.filters, locale, deps.canBecome);
    const listed = sortResidents(listing.shown, state.sort, locale);
    const alive = new Set<number>();
    for (const row of all) alive.add(row.id);
    for (const id of views.keys()) if (!alive.has(id)) views.delete(id);
    const items: HTMLLIElement[] = [];
    for (const row of listed) {
      let view = views.get(row.id);
      if (view === undefined) {
        view = buildRow(row.id);
        views.set(row.id, view);
      }
      writeRow(view, row);
      items.push(view.item);
    }
    const ids = listed.map((row) => row.id);
    if (ids.length !== shownIds.length || ids.some((id, index) => id !== shownIds[index])) {
      // Re-appending a row drops its focus; hand it back without moving the scroll.
      const focused = document.activeElement;
      list.replaceChildren(...items);
      if (focused instanceof HTMLElement && list.contains(focused)) focused.focus({ preventScroll: true });
    }
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
  professionSelect.addEventListener('change', () =>
    setFilters({ ...state.filters, profession: professionSelect.value }),
  );
  canBecomeSelect.addEventListener('change', () =>
    setFilters({
      ...state.filters,
      canBecome: canBecomeSelect.value === '' ? null : Number(canBecomeSelect.value),
    }),
  );
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
    figuresStale = true;
  });

  /** The figures of the rows inside the list's visible strip. */
  const paintVisible = (): void => {
    figuresStale = false;
    const top = list.scrollTop;
    const bottom = top + list.clientHeight;
    const slots: ResidentFigureSlot[] = [];
    let box: ResidentFigureBox | null = null;
    for (const id of shownIds) {
      const view = views.get(id);
      if (view === undefined) continue;
      const { item, canvas } = view;
      if (item.offsetTop + item.offsetHeight <= top) continue;
      if (item.offsetTop >= bottom) break;
      // One rect read serves every row: the plane's scale is theirs.
      box ??= {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        pixelScale:
          (canvas.getBoundingClientRect().width / Math.max(1, canvas.offsetWidth)) * devicePixelRatio,
      };
      slots.push({ entity: id, canvas });
    }
    if (box !== null && box.pixelScale > 0) deps.paintFigures(slots, box);
  };

  const placeWindow = centralWindowPlacer(window, deps.plane, RESIDENTS_WINDOW_W);
  const place = (): void => {
    // A moved plane shows other rows, at another pixel scale.
    if (placeWindow()) figuresStale = true;
  };

  const open = (): void => {
    state = { ...state, filters: NO_RESIDENT_FILTERS, scrollTop: 0 };
    anchor = null;
    rows = deps.rows();
    window.open();
    place(); // the list needs its height bound before a restored scroll can land
    relist();
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
      place();
      const next = deps.rows();
      if (next !== rows) {
        rows = next;
        relist();
      } else if (deps.selection.version() !== shownSelection) {
        showSelection();
        shownSelection = deps.selection.version();
      }
      if (figuresStale) paintVisible();
    },
    state: () => state,
    restore: (next) => {
      state = next;
      if (!window.isOpen()) return;
      relist();
      list.scrollTop = next.scrollTop;
    },
    onDismiss: window.onDismiss,
    dispose: window.dispose,
  };
}
