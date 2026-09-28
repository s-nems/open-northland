import type { UiCue } from '@open-northland/audio';
import type { HypertextBook, HypertextUserIcon } from '@open-northland/data';
import type { MapViewTarget } from '@open-northland/render';
import type { MissionGoal, MissionPage } from '../../../game/mission-brief.js';
import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import { navBeamRect } from '../../nav-beam.js';
import { NOTICE_COLUMN, TOP_BAR_HEIGHT } from '../../regions.js';
import { GLYPH } from '../icons.js';
import { escapeHtml, setClass, setHidden } from '../parts/dom.js';
import { WINDOW_ORNAMENTS } from '../symbols.js';
import { chronicleSpread } from './chronicle.js';
import type { GoalMark } from './goal-marks.js';
import { openGoalCount } from './goal-marks.js';
import { goalsSpread } from './goal-markup.js';
import { FLOURISH, type FlowContext, flowMarkup, roman, type ViewSlot } from './markup.js';
import { type BookPage, displayTitle, pageSegments } from './page-segments.js';
import { type BookPosition, columnCount, spreadCount, turnPage } from './paging.js';
import { type MissionHumanLookup, type UserIconBox, userIconBox } from './user-icons.js';
import { type BookView, cutViewHoles, maskHoles } from './view-holes.js';

export type { BookView } from './view-holes.js';

/** The book's own size in design px; a screen too small for it shrinks it whole. */
const BOOK = { w: 990, h: 620 } as const;
/** Room the book keeps from the notice column, the top bar, the beam and the screen edge. */
const BOOK_MARGIN = 16;
/** The fore-edge tabs stand this far out of the book's right edge. */
const TAB_REACH = 44;
/** One wheel turn per this many ms, so a trackpad's burst turns one page, not ten. */
const WHEEL_TURN_MS = 280;
/** The leaf's turn (foundation.css, `on-book-leaf`) and a frame's margin, after which the world views
 *  are cut in again. */
const LEAF_TURN_MS = 340;

export type BookTab = 'brief' | 'goals' | 'history';
const TABS: readonly BookTab[] = ['brief', 'goals', 'history'];

/** Where the reader stands in an open book, carried across a remount. */
export interface BookReading {
  readonly tab: BookTab;
  readonly chapter: number;
  readonly spread: number;
  /** The history table page being read on the chronicle tab, or null for its contents. */
  readonly table: string | null;
  readonly pick: number;
}

export interface BookWindowDeps {
  readonly plane: HTMLElement;
  /** The chapters so far, oldest first; each is a briefing page, or the map's fallback text (null). */
  readonly chapters: () => readonly (number | null)[];
  readonly page: (page: number | null) => MissionPage;
  readonly goals: () => readonly MissionGoal[];
  readonly missionName: string;
  readonly history: HypertextBook | null;
  readonly missionHuman: MissionHumanLookup;
  readonly pictureUrl: (file: string) => string;
  readonly onShowOnMap: (target: MapViewTarget) => void;
  /** The goal changes the player has not seen yet, which count as seen once the goal page shows them. */
  readonly takeGoalMarks: () => ReadonlyMap<string, GoalMark>;
  /** The close medallion or the resume button closed the book. */
  readonly onDismiss: () => void;
  readonly cue: (cue: UiCue) => void;
}

/** What the book shows when it opens: a chapter the script just delivered, the goals, or where the
 *  reader stood. */
export interface BookOpening {
  readonly reading: BookReading;
  /** A script delivered this chapter: it is marked new, and with `paused` the game waits behind it. */
  readonly arrival: boolean;
  readonly paused: boolean;
}

export interface BookWindow {
  readonly element: HTMLElement;
  isOpen(): boolean;
  open(opening: BookOpening): void;
  close(): void;
  reading(): BookReading;
  /** Once a frame: re-place on a screen change, rebuild the goal tab on a changed list. */
  refresh(): void;
  /** Rebuild the shown page, for a chapter or a named human that landed anew. */
  rebuild(): void;
  views(): readonly BookView[];
  dispose(): void;
}

const svgTurn = (direction: -1 | 1): string =>
  direction < 0
    ? '<svg viewBox="0 0 20 20" class="on-book__ico"><path d="M12.5 4.5L7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '<svg viewBox="0 0 20 20" class="on-book__ico"><path d="M7.5 4.5L13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PLAY =
  '<svg viewBox="0 0 20 20" class="on-book__ico"><path d="M6 4l10 6-10 6z" fill="currentColor"/></svg>';
const TURN_CLASS = { [-1]: 'on-book__spread--turn-prev', 1: 'on-book__spread--turn-next' } as const;

const goalsKeyOf = (goals: readonly MissionGoal[]): string =>
  goals.map((g) => `${g.key}:${g.state}:${g.text}`).join('\n');

export function createBookWindow(deps: BookWindowDeps): BookWindow {
  const copy = messages().hud.missionBook;
  const locale = bcp47Tag();
  const scene = document.createElement('div');
  scene.className = 'on-book-scene';
  scene.hidden = true;
  scene.innerHTML = `<div class="on-book-scene__dim"></div>
    <section class="on-book" aria-label="${escapeHtml(copy.title)}">
      <div class="on-book__shadow"></div>
      <div class="on-book__cover">${WINDOW_ORNAMENTS}<span class="on-book__gutter"></span></div>
      <div class="on-book__tabs" role="tablist" aria-label="${escapeHtml(copy.tabsLabel)}">${TABS.map(
        (t) =>
          `<button type="button" role="tab" class="on-book__tab" data-tab="${t}" aria-selected="false"><span>${escapeHtml(copy.tabs[t])}${
            t === 'goals' ? '<span class="on-tab__count" hidden></span>' : ''
          }</span></button>`,
      ).join('')}</div>
      <div class="on-book__spread"></div>
      <p class="on-book__paused" role="status" hidden><span class="on-book__paused-bars"></span>${escapeHtml(copy.paused)}</p>
      <button type="button" class="on-medallion on-book__close" aria-label="${escapeHtml(messages().hud.shell.close)}">${GLYPH.close}</button>
    </section>`;
  const book = scene.querySelector<HTMLElement>('.on-book');
  const cover = scene.querySelector<HTMLElement>('.on-book__cover');
  const spreadEl = scene.querySelector<HTMLElement>('.on-book__spread');
  const pausedEl = scene.querySelector<HTMLElement>('.on-book__paused');
  const goalCount = scene.querySelector<HTMLElement>('.on-tab__count');
  if (book === null || cover === null || spreadEl === null || pausedEl === null || goalCount === null) {
    throw new Error('mission book: markup');
  }
  deps.plane.append(scene);

  let reading: BookReading = { tab: 'brief', chapter: 0, spread: 0, table: null, pick: 0 };
  /** A chapter to land on its last spread once it is laid out (turning back into it). */
  let landLast = false;
  let arrival = false;
  /** The goal changes the goal page has shown during this opening; they stay marked until it closes. */
  let marks = new Map<string, GoalMark>();
  let spreads = 1;
  let slots: ViewSlot[] = [];
  let shownViews: readonly BookView[] = [];
  /** A page turn animates the leaf; the world views wait for it to settle. */
  let turning: ReturnType<typeof setTimeout> | null = null;
  /** The goal list the tabs and the goal page were built from, and its content. */
  let goalsShown: readonly MissionGoal[] | null = null;
  let goalsKey = '';
  let placed = '';
  let lastWheel = Number.NEGATIVE_INFINITY;

  const chapters = (): readonly (number | null)[] => {
    const list = deps.chapters();
    return list.length === 0 ? [null] : list;
  };
  const chapterPage = (index: number): { readonly page: BookPage; readonly title: string | null } => {
    const list = chapters();
    const shown = deps.page(list[Math.min(index, list.length - 1)] ?? null);
    const page = pageSegments(shown.blocks);
    // The fallback text is headed by the map's name; a page without its own title gets none.
    return { page, title: shown.title !== '' ? shown.title : page.title };
  };

  const iconBox = (icon: HypertextUserIcon): UserIconBox | null => userIconBox(icon, deps.missionHuman);
  const flowContext = (): FlowContext => ({
    pictureUrl: deps.pictureUrl,
    iconBox,
    showOnMap: copy.showOnMap,
    views: slots,
  });

  const titleMarkup = (title: string | null): string =>
    title === null
      ? FLOURISH
      : `<h3 class="on-book__title">${escapeHtml(displayTitle(title, locale))}</h3>${FLOURISH}`;

  const readingSpread = (head: string, flow: string, foot: string): string => {
    const col = (side: 'left' | 'right'): string =>
      `<div class="on-book__window on-book__window--${side}" data-col="${side}"><div class="on-book__flow">${head}${flow}<p class="on-book__fin" aria-hidden="true">❦</p></div></div>`;
    return `<div class="on-book__page on-book__page--left">${col('left')}<p class="on-book__folio" data-folio="left"></p>
        <button type="button" class="on-book__corner on-book__corner--prev" data-turn="-1">${svgTurn(-1)}</button></div>
      <div class="on-book__page on-book__page--right">${col('right')}<div class="on-book__foot">${foot}</div>
        <button type="button" class="on-book__corner on-book__corner--next" data-turn="1">${svgTurn(1)}</button></div>`;
  };

  const resumeButton = (): string =>
    arrival && !pausedEl.hidden
      ? `<button type="button" class="on-button on-button--accent on-book__resume" data-close>${PLAY}${escapeHtml(copy.resume)}</button>`
      : '<span></span>';

  const briefMarkup = (): string => {
    const count = chapters().length;
    const index = Math.min(reading.chapter, count - 1);
    const { page, title } = chapterPage(index);
    const fresh =
      arrival && index === count - 1
        ? `<span class="on-book__new">${escapeHtml(copy.newChapter)}</span>`
        : '';
    const mission = displayTitle(deps.missionName, locale);
    // The map's name heads the chapter unless the chapter's own title already says it.
    const when =
      mission === '' ||
      (title !== null &&
        displayTitle(title, locale).toLocaleLowerCase(locale) === mission.toLocaleLowerCase(locale))
        ? ''
        : `<p class="on-book__when">${escapeHtml(mission)}</p>`;
    const head = `<p class="on-book__kicker">${fresh}${escapeHtml(formatMessage(copy.chapter, { n: roman(index + 1) }))}</p>${when}${titleMarkup(title)}`;
    const flow =
      page.segments.length === 0
        ? `<p class="on-book__p">${escapeHtml(copy.noBriefing)}</p>`
        : flowMarkup(page, flowContext());
    const foot = `<span class="on-book__foot-chapter">${escapeHtml(formatMessage(copy.chapterOf, { n: index + 1, count }))}</span>
      <span class="on-book__folio" data-folio="right"></span>${resumeButton()}`;
    return readingSpread(head, flow, foot);
  };

  const tableMarkup = (id: string): string => {
    const tables = deps.history;
    const blocks = tables !== null && Object.hasOwn(tables.pages, id) ? tables.pages[id] : undefined;
    const page = pageSegments(blocks ?? []);
    const indexTitle = tables === null ? null : pageSegments(tables.pages[tables.start] ?? []).title;
    const kicker =
      indexTitle === null
        ? ''
        : `<p class="on-book__kicker">${escapeHtml(displayTitle(indexTitle, locale))}</p>`;
    const head = `${kicker}${id === tables?.start ? FLOURISH : titleMarkup(page.title)}`;
    const back =
      id === tables?.start
        ? `<button type="button" class="on-book__back" data-back="chronicle">${GLYPH.back}${escapeHtml(copy.chronicleBack)}</button>`
        : `<button type="button" class="on-book__back" data-back="tables">${GLYPH.back}${escapeHtml(copy.tablesBack)}</button>`;
    const foot = `${back}<span class="on-book__folio" data-folio="right"></span><span></span>`;
    return readingSpread(head, flowMarkup(page, flowContext()), foot);
  };

  const syncTabs = (goals: readonly MissionGoal[]): void => {
    for (const tab of scene.querySelectorAll<HTMLElement>('[data-tab]')) {
      const selected = tab.dataset.tab === reading.tab;
      if (tab.getAttribute('aria-selected') !== String(selected))
        tab.setAttribute('aria-selected', String(selected));
    }
    const open = openGoalCount(goals);
    setHidden(goalCount, open === 0);
    const text = String(open);
    if (goalCount.textContent !== text) goalCount.textContent = text;
  };

  /** The views on the shown spread, holes cut for them; none while the book is hidden or a leaf turns. */
  const measureViews = (): void => {
    if (scene.hidden || turning !== null) {
      shownViews = [];
      maskHoles(cover, []);
      return;
    }
    shownViews = cutViewHoles(cover, spreadEl, slots);
  };

  /** Lay the chapter out in page columns and show the current spread's two. */
  const layout = (): void => {
    const right = spreadEl.querySelector<HTMLElement>('[data-col="right"]');
    const left = spreadEl.querySelector<HTMLElement>('[data-col="left"]');
    const rightFlow = right?.firstElementChild;
    const leftFlow = left?.firstElementChild;
    if (
      !(rightFlow instanceof HTMLElement) ||
      !(leftFlow instanceof HTMLElement) ||
      right === null ||
      left === null
    ) {
      measureViews();
      return;
    }
    const gap = Number.parseFloat(getComputedStyle(rightFlow).columnGap);
    const width = right.clientWidth;
    if (!Number.isFinite(gap) || width === 0) return;
    const columns = columnCount(rightFlow.scrollWidth, width, gap);
    spreads = spreadCount(columns);
    let spread = landLast ? spreads - 1 : Math.min(reading.spread, spreads - 1);
    landLast = false;
    spread = Math.max(0, spread);
    reading = { ...reading, spread };
    const leftCol = 2 * spread;
    const rightCol = leftCol + 1;
    const step = width + gap;
    leftFlow.style.transform = `translateX(${-leftCol * step}px)`;
    rightFlow.style.transform = `translateX(${-rightCol * step}px)`;
    setClass(right, 'on-book__window--blank', rightCol >= columns);
    const folio = (side: 'left' | 'right', text: string): void => {
      const node = spreadEl.querySelector(`[data-folio="${side}"]`);
      if (node !== null && node.textContent !== text) node.textContent = text;
    };
    folio('left', formatMessage(copy.folio, { n: leftCol + 1 }));
    folio(
      'right',
      rightCol < columns ? formatMessage(copy.folioOf, { n: rightCol + 1, count: columns }) : '',
    );
    const chapterCount = reading.table === null ? chapters().length : 1;
    const chapter = reading.table === null ? reading.chapter : 0;
    const prev = turnPage({ chapter, spread }, -1, spreads, chapterCount);
    const next = turnPage({ chapter, spread }, 1, spreads, chapterCount);
    const corner = (direction: -1 | 1, to: BookPosition | null): void => {
      const node = spreadEl.querySelector<HTMLButtonElement>(`[data-turn="${direction}"]`);
      if (node === null) return;
      node.disabled = to === null;
      const crosses = to !== null && to.chapter !== chapter;
      setClass(node, 'on-book__corner--chapter', crosses);
      const label =
        direction < 0
          ? crosses
            ? copy.prevChapter
            : copy.prevPage
          : crosses
            ? copy.nextChapter
            : copy.nextPage;
      node.setAttribute('aria-label', label);
    };
    corner(-1, prev);
    corner(1, next);
    measureViews();
  };

  const render = (): void => {
    slots = [];
    const goals = deps.goals();
    goalsShown = goals;
    goalsKey = goalsKeyOf(goals);
    syncTabs(goals);
    spreadEl.className = `on-book__spread on-book__spread--${reading.tab}`;
    if (reading.tab === 'goals') {
      for (const [key, mark] of deps.takeGoalMarks()) marks.set(key, mark);
      spreadEl.innerHTML = goalsSpread(goals, marks, displayTitle(deps.missionName, locale));
    } else if (reading.tab === 'history' && reading.table !== null)
      spreadEl.innerHTML = tableMarkup(reading.table);
    else if (reading.tab === 'history') {
      spreadEl.innerHTML = chronicleSpread({
        chapters: chapters().map((_, i) => chapterPage(i)),
        pick: reading.pick,
        history: deps.history,
        pictureUrl: deps.pictureUrl,
        locale,
      });
    } else spreadEl.innerHTML = briefMarkup();
    layout();
  };

  const place = (): boolean => {
    const width = deps.plane.clientWidth;
    const height = deps.plane.clientHeight;
    const key = `${width}x${height}`;
    if (key === placed) return false;
    placed = key;
    const left = NOTICE_COLUMN.left + NOTICE_COLUMN.width + BOOK_MARGIN;
    const right = width - BOOK_MARGIN - TAB_REACH;
    const top = TOP_BAR_HEIGHT + BOOK_MARGIN;
    const bottom = navBeamRect({ width, height }, 1).y - BOOK_MARGIN;
    const scale = Math.max(Number.EPSILON, Math.min(1, (right - left) / BOOK.w, (bottom - top) / BOOK.h));
    const w = BOOK.w * scale;
    const h = BOOK.h * scale;
    // On the screen's axis where it fits, else as far left as the notices allow.
    const x = Math.max(left, Math.min((width - w) / 2, right - w));
    const y = top + (bottom - top - h) / 2;
    book.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${scale})`;
    return true;
  };

  /** The leaf lies still: the world views are cut in again. */
  const settle = (): void => {
    turning = null;
    spreadEl.classList.remove(TURN_CLASS[-1], TURN_CLASS[1]);
    measureViews();
  };

  const turn = (direction: -1 | 1): void => {
    const table = reading.table !== null;
    const to = turnPage(
      { chapter: table ? 0 : reading.chapter, spread: reading.spread },
      direction,
      spreads,
      table ? 1 : chapters().length,
    );
    if (to === null) return;
    deps.cue('confirm');
    const crosses = !table && to.chapter !== reading.chapter;
    landLast = to.spread === 'last';
    reading = {
      ...reading,
      chapter: table ? reading.chapter : to.chapter,
      spread: to.spread === 'last' ? 0 : to.spread,
    };
    if (turning !== null) clearTimeout(turning);
    turning = setTimeout(settle, LEAF_TURN_MS);
    if (crosses) render();
    else layout();
    spreadEl.classList.remove(TURN_CLASS[-1], TURN_CLASS[1]);
    void spreadEl.offsetWidth; // restart the leaf animation
    spreadEl.classList.add(TURN_CLASS[direction]);
  };

  const show = (next: Partial<BookReading>): void => {
    reading = { ...reading, spread: 0, ...next };
    render();
  };

  const relayout = (): void => {
    if (!scene.hidden) layout();
  };

  const onClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>(
      '[data-tab], [data-turn], [data-close], .on-book__close, [data-pick], [data-read], [data-jump], [data-table], [data-back], [data-view]',
    );
    if (control === null || control === undefined || !scene.contains(control)) return;
    const data = control.dataset;
    if (data.turn !== undefined) {
      turn(data.turn === '-1' ? -1 : 1);
      return;
    }
    deps.cue('confirm');
    if (data.tab !== undefined) {
      const tab = TABS.find((t) => t === data.tab);
      if (tab !== undefined && tab !== reading.tab) show({ tab, table: null });
    } else if (data.close !== undefined || control.classList.contains('on-book__close')) {
      deps.onDismiss();
    } else if (data.pick !== undefined) {
      show({ pick: Number(data.pick) });
    } else if (data.read !== undefined) {
      show({ tab: 'brief', chapter: Number(data.read) });
    } else if (data.jump !== undefined || data.table !== undefined) {
      const page = data.jump ?? data.table ?? '';
      if (deps.history !== null && Object.hasOwn(deps.history.pages, page))
        show({ tab: 'history', table: page });
    } else if (data.back !== undefined) {
      show({ table: data.back === 'tables' ? (deps.history?.start ?? null) : null });
    } else if (data.view !== undefined) {
      const target = slots[Number(data.view)]?.icon.target;
      if (target !== undefined && target !== null) deps.onShowOnMap(target);
    }
  };
  const onDoubleClick = (event: MouseEvent): void => {
    const row = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-pick]') : null;
    if (row !== null) show({ tab: 'brief', chapter: Number(row.dataset.pick) });
  };
  const onWheel = (event: WheelEvent): void => {
    if (reading.tab === 'goals' || (reading.tab === 'history' && reading.table === null)) return;
    event.preventDefault();
    if (event.deltaY === 0 || event.timeStamp - lastWheel < WHEEL_TURN_MS) return;
    lastWheel = event.timeStamp;
    turn(event.deltaY > 0 ? 1 : -1);
  };
  // Pictures and late fonts change the flow; neither event bubbles, so they are caught on the way down.
  const onLoad = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) relayout();
  };
  const onError = (event: Event): void => {
    if (event.target instanceof HTMLImageElement) event.target.classList.add('on-book__img--missing');
  };
  scene.addEventListener('click', onClick);
  scene.addEventListener('dblclick', onDoubleClick);
  book.addEventListener('wheel', onWheel, { passive: false });
  scene.addEventListener('load', onLoad, true);
  scene.addEventListener('error', onError, true);
  const onResize = (): void => {
    placed = '';
  };
  window.addEventListener('resize', onResize);
  const resizes = new ResizeObserver(relayout);
  resizes.observe(spreadEl);

  return {
    element: scene,
    isOpen: () => !scene.hidden,
    open(opening): void {
      arrival = opening.arrival;
      marks = new Map();
      setClass(scene, 'on-book-scene--arrival', opening.arrival && opening.paused);
      setHidden(pausedEl, !(opening.arrival && opening.paused));
      reading = opening.reading;
      landLast = false;
      setHidden(scene, false);
      placed = '';
      place();
      render();
      void document.fonts.ready.then(relayout);
    },
    close(): void {
      if (turning !== null) clearTimeout(turning);
      turning = null;
      setHidden(scene, true);
      arrival = false;
      shownViews = [];
      maskHoles(cover, []);
    },
    reading: () => reading,
    refresh(): void {
      if (scene.hidden) return;
      if (place()) relayout();
      // The goal states follow the sim; the reading pages never move under the reader.
      const goals = deps.goals();
      if (goals === goalsShown) return;
      goalsShown = goals;
      const key = goalsKeyOf(goals);
      if (key === goalsKey) return;
      goalsKey = key;
      if (reading.tab === 'goals') render();
      else syncTabs(goals);
    },
    rebuild(): void {
      if (!scene.hidden) render();
    },
    views: () => shownViews,
    dispose(): void {
      if (turning !== null) clearTimeout(turning);
      resizes.disconnect();
      window.removeEventListener('resize', onResize);
      scene.remove();
    },
  };
}
