import type { UiCue } from '@open-northland/audio';
import type { HypertextBook, HypertextUserIcon } from '@open-northland/data';
import type { MapViewTarget } from '@open-northland/render';
import type { MissionGoal, MissionPage } from '../../../game/mission-brief.js';
import { bcp47Tag, formatMessage, messages } from '../../../i18n/index.js';
import { navBeamRect } from '../../nav-beam.js';
import { NOTICE_COLUMN, TOP_BAR_HEIGHT } from '../../regions.js';
import { GLYPH } from '../icons.js';
import { escapeHtml, setClass, setHidden } from '../parts/dom.js';
import type { ClientRect } from '../portrait-hole.js';
import { WINDOW_KNOT } from '../symbols.js';
import { chronicleSpread } from './chronicle.js';
import type { GoalMark } from './goal-marks.js';
import { openGoalCount } from './goal-marks.js';
import { goalsSpread } from './goal-markup.js';
import { FLOURISH, type FlowContext, flowMarkup, roman, type ViewSlot } from './markup.js';
import { type BookPage, displayTitle, pageSegments } from './page-segments.js';
import { type BookPosition, columnCount, spreadCount, turnPage } from './paging.js';
import { type MissionHumanLookup, type UserIconBox, userIconBox } from './user-icons.js';
import { type BookView, maskHoles, measureViews as viewsOn } from './view-holes.js';

export type { BookView } from './view-holes.js';

/** The book's own size in design px; a screen too small for it shrinks it whole. */
const BOOK = { w: 990, h: 620 } as const;
/** Room the book keeps from the notice column, the top bar, the beam and the screen edge. */
const BOOK_MARGIN = 16;
/** The fore-edge tabs stand this far out of the book's right edge. */
const TAB_REACH = 44;
/** One wheel turn per this many ms, so a trackpad's burst turns one page, not ten. */
const WHEEL_TURN_MS = 280;
/** The leaf's flip (foundation.css, `on-book-flip`) and a frame's margin, after which the world views
 *  are cut in again. */
const LEAF_TURN_MS = 440;
/** How often the shown world views are copied into stills, which a turning leaf shows in their place. */
const STILL_REFRESH_MS = 1000;

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
  /** The close medallion closed the book. */
  readonly onDismiss: () => void;
  readonly cue: (cue: UiCue) => void;
}

/** What the book shows when it opens: a chapter the script just delivered, the goals, or where the
 *  reader stood. */
export interface BookOpening {
  readonly reading: BookReading;
  /** A script delivered this chapter: it is marked new, and with `paused` the map dims behind it while
   *  the game waits. */
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

/** The page's lower corner curled up with an arrow on the flap, drawn for the right page; the left
 *  page's corner mirrors it. The gradients shade the page under the fold and light the flap. */
const curl = (direction: -1 | 1): string => {
  const id = `on-curl-${direction < 0 ? 'prev' : 'next'}`;
  return `<svg viewBox="0 0 64 64" class="on-book__curl" aria-hidden="true"><defs>
    <linearGradient id="${id}-under" gradientUnits="userSpaceOnUse" x1="45" y1="45" x2="64" y2="64"><stop offset="0" stop-color="#4a3824"/><stop offset="0.55" stop-color="#9c8558"/><stop offset="1" stop-color="#b8a274"/></linearGradient>
    <linearGradient id="${id}-flap" gradientUnits="userSpaceOnUse" x1="45" y1="45" x2="29" y2="29"><stop offset="0" stop-color="#fbf4df"/><stop offset="1" stop-color="#d9c79b"/></linearGradient>
  </defs><g${direction < 0 ? ' transform="matrix(-1 0 0 1 64 0)"' : ''}><path d="M26 64L64 26V64Z" fill="url(#${id}-under)"/><path class="on-book__curl-flap" d="M26 64L64 26Q46 27.5 29 29Q27.5 46 26 64Z" fill="url(#${id}-flap)"/><path class="on-book__curl-fold" d="M26 64L64 26"/><path class="on-book__curl-arrow" d="M32.5 45C33 37.5 38.5 33.5 46 35.5M41.5 31.5l4.8 4-4 4.6"/></g></svg>`;
};

/** A page of the spread as it stood, and where it stands on the book in design px. */
interface PageShot {
  readonly page: HTMLElement;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

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
      <div class="on-book__cover"></div>
      <div class="on-book__trim">${WINDOW_KNOT}</div>
      <div class="on-book__tabs" role="tablist" aria-label="${escapeHtml(copy.tabsLabel)}">${TABS.map(
        (t) =>
          `<button type="button" role="tab" class="on-book__tab" data-tab="${t}" aria-selected="false"><span>${escapeHtml(copy.tabs[t])}${
            t === 'goals' ? '<span class="on-tab__count" hidden></span>' : ''
          }</span></button>`,
      ).join('')}</div>
      <div class="on-book__spread"></div>
      <div class="on-book__leaves" inert></div>
      <button type="button" class="on-medallion on-book__close" aria-label="${escapeHtml(messages().hud.shell.close)}">${GLYPH.close}</button>
    </section>`;
  const book = scene.querySelector<HTMLElement>('.on-book');
  const cover = scene.querySelector<HTMLElement>('.on-book__cover');
  const spreadEl = scene.querySelector<HTMLElement>('.on-book__spread');
  const leaves = scene.querySelector<HTMLElement>('.on-book__leaves');
  const goalCount = scene.querySelector<HTMLElement>('.on-tab__count');
  const dim = scene.querySelector<HTMLElement>('.on-book-scene__dim');
  if (
    book === null ||
    cover === null ||
    spreadEl === null ||
    leaves === null ||
    goalCount === null ||
    dim === null
  ) {
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
  /** A page turn animates the leaf until this timer settles it. */
  let turning: ReturnType<typeof setTimeout> | null = null;
  /** Each view slot's still canvas; a leaf lifts copies of the ones the renderer has painted. */
  const stills = new Map<number, HTMLCanvasElement>();
  const painted = new Set<number>();
  let stillsDue = true;
  let stillsAt = Number.NEGATIVE_INFINITY;
  /** Slots whose stills went to the renderer, which paints them after this frame's read. */
  let handed: readonly number[] = [];
  /** Leaf lenses whose view had no still yet; the next copy fills them. */
  let waiting: { readonly lens: HTMLElement; readonly slot: number }[] = [];
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
        <button type="button" class="on-book__corner on-book__corner--prev" data-turn="-1">${curl(-1)}</button></div>
      <div class="on-book__page on-book__page--right">${col('right')}<div class="on-book__foot">${foot}</div>
        <button type="button" class="on-book__corner on-book__corner--next" data-turn="1">${curl(1)}</button></div>`;
  };

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
      <span class="on-book__folio" data-folio="right"></span><span></span>`;
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

  /** The painted cover and the arrival's dim both lie over a view, so both are cut. */
  const cutHoles = (clips: readonly ClientRect[]): void => {
    maskHoles(cover, clips);
    maskHoles(dim, clips);
  };

  /** The views on the shown spread, holes cut for them; none while the book is hidden. A turning leaf
   *  covers the new spread's holes where it lies. */
  const measureViews = (): void => {
    if (scene.hidden) {
      shownViews = [];
      cutHoles([]);
      return;
    }
    // Client px per design px of the book: the plane's scale times the book's own.
    const k = cover.offsetWidth === 0 ? 1 : cover.getBoundingClientRect().width / cover.offsetWidth;
    shownViews = viewsOn(spreadEl, slots, k);
    cutHoles(shownViews.map((v) => v.clip));
    if (shownViews.some((v) => !painted.has(v.slot))) stillsDue = true;
  };

  /** Show `slot`'s still in a copied page's lens; false while the view has none. */
  const fillLens = (lens: HTMLElement, slot: number): boolean => {
    const still = stills.get(slot);
    if (still === undefined || !painted.has(slot)) return false;
    const copy = document.createElement('canvas');
    copy.className = 'on-book__still';
    copy.width = still.width;
    copy.height = still.height;
    copy.getContext('2d')?.drawImage(still, 0, 0);
    lens.replaceChildren(copy);
    return true;
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
    stills.clear();
    painted.clear();
    handed = [];
    leaves.replaceChildren();
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

  /** The spread's two pages as they stand now, copied, so a turn can lift the old ones over the new. */
  const shootPages = (): { readonly left: PageShot; readonly right: PageShot } | null => {
    const shot = (side: 'left' | 'right'): PageShot | null => {
      const page = spreadEl.querySelector<HTMLElement>(`.on-book__page--${side}`);
      if (page === null) return null;
      const copied = page.cloneNode(true);
      if (!(copied instanceof HTMLElement)) return null;
      for (const lens of copied.querySelectorAll<HTMLElement>('.on-book__lens')) {
        const slot = Number(lens.parentElement?.dataset.view);
        if (!fillLens(lens, slot)) waiting.push({ lens, slot });
      }
      return {
        page: copied,
        x: spreadEl.offsetLeft + page.offsetLeft,
        y: spreadEl.offsetTop + page.offsetTop,
        w: page.offsetWidth,
        h: page.offsetHeight,
      };
    };
    const left = shot('left');
    const right = shot('right');
    return left === null || right === null ? null : { left, right };
  };

  /** A page copy on its own piece of the painted vellum, placed at `x`, `y` in its parent. */
  const leafSide = (shot: PageShot, className: string, x: number, y: number): HTMLElement => {
    const node = document.createElement('div');
    node.className = className;
    Object.assign(node.style, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${shot.w}px`,
      height: `${shot.h}px`,
      backgroundPosition: `${-shot.x}px ${-shot.y}px`,
    });
    node.append(shot.page);
    return node;
  };

  /** Lift the old page on the turned side and flip it over the gutter onto the other side, where its
   *  back is the new page there; the other old page lies under it until it lands. */
  const flip = (direction: -1 | 1, before: { readonly left: PageShot; readonly right: PageShot }): void => {
    leaves.replaceChildren();
    const after = shootPages();
    if (after === null) return;
    const lifted = direction > 0 ? before.right : before.left;
    const lying = direction > 0 ? before.left : before.right;
    const back = direction > 0 ? after.left : after.right;
    const gutter = (before.left.x + before.left.w + before.right.x) / 2;
    const leaf = document.createElement('div');
    leaf.className = `on-book__leaf on-book__leaf--${direction > 0 ? 'next' : 'prev'}`;
    Object.assign(leaf.style, {
      left: `${lifted.x}px`,
      top: `${lifted.y}px`,
      width: `${lifted.w}px`,
      height: `${lifted.h}px`,
      transformOrigin: `${gutter - lifted.x}px 50%`,
    });
    // The back is turned over on the leaf (foundation.css), so the flip lands it where the new page
    // stands.
    leaf.append(
      leafSide(lifted, 'on-book__side on-book__side--front', 0, 0),
      leafSide(back, 'on-book__side on-book__side--back', 0, 0),
    );
    leaves.append(leafSide(lying, 'on-book__side', lying.x, lying.y), leaf);
  };

  /** The leaf lies still: the world views are cut in again. */
  const settle = (): void => {
    turning = null;
    leaves.replaceChildren();
    waiting = [];
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
    waiting = [];
    const before = shootPages();
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
    stillsDue = true;
    if (before !== null) flip(direction, before);
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
      '[data-tab], [data-turn], .on-book__close, [data-pick], [data-read], [data-jump], [data-table], [data-back], [data-view]',
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
    } else if (control.classList.contains('on-book__close')) {
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
      leaves.replaceChildren();
      waiting = [];
      setHidden(scene, true);
      arrival = false;
      shownViews = [];
      cutHoles([]);
    },
    reading: () => reading,
    refresh(): void {
      if (scene.hidden) return;
      if (handed.length > 0) {
        for (const slot of handed) painted.add(slot);
        handed = [];
        waiting = waiting.filter(({ lens, slot }) => !fillLens(lens, slot));
      }
      if (performance.now() - stillsAt > STILL_REFRESH_MS) stillsDue = true;
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
    views(): readonly BookView[] {
      if (!stillsDue || shownViews.length === 0) return shownViews;
      stillsDue = false;
      handed = shownViews.map((view) => view.slot);
      stillsAt = performance.now();
      return shownViews.map((view) => {
        let still = stills.get(view.slot);
        if (still === undefined) {
          still = document.createElement('canvas');
          stills.set(view.slot, still);
        }
        return { ...view, still };
      });
    },
    dispose(): void {
      if (turning !== null) clearTimeout(turning);
      resizes.disconnect();
      window.removeEventListener('resize', onResize);
      scene.remove();
    },
  };
}
