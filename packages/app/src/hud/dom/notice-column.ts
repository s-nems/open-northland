import { formatMessage, messages } from '../../i18n/index.js';
import { NOTICE_COLUMN } from '../regions.js';
import { fanBelowOpen, fanOverlap } from '../tool-panel/messages/cards.js';
import type { NoticeFigureBox, NoticeFigureSlot } from '../tool-panel/messages/figures.js';
import type { MessagePriorityLevel } from '../tool-panel/messages/types.js';
import { GLYPH } from './icons.js';
import {
  cardInnerMarkup,
  cardShape,
  fillCard,
  glyphMarkup,
  isStack,
  type NoticeStackView,
  type NoticeThumbPainters,
  paintNoticeThumb,
  STACK,
} from './notice-card.js';
import { driveStackHover } from './notice-hover.js';
import { createNoticeMembers, MEMBERS_ID } from './notice-members.js';

export type { NoticeCardView, NoticeMemberView, NoticeStackView } from './notice-card.js';

/** What opened or closed a stack: a press or key, or the pointer resting on it. */
export type NoticeOpenSource = 'press' | 'hover';

/** Below this visible strip per card (design px) the fan stops and the list scrolls instead. */
const MIN_CARD_STRIP = 27;
/** The gap between unfanned cards (design px); mirrors `.on-notice` in foundation.css. */
const CARD_GAP = 7;
/** A card counts as below the fold once more than this much of it (design px) is past the edge. */
const FOLD_TOLERANCE = 6;
/** The badge scrolls one screen less this much, so the last card seen stays as a landmark. */
const MORE_SCROLL_KEEP = 40;
const STACKED = 'on-notices--stacked';
const OVERFLOWING = 'on-notices--overflowing';
const FRESH = 'on-notice--fresh';
/** A stack that took in a fresh member bumps its count seal once. */
const GREW = 'on-notice--grew';
/** The arrival animations whose end retires the fresh state: the seal pulse outlasts the slide. */
const ARRIVAL_ANIMATION = { card: 'on-notice-in', seal: 'on-seal-pulse', bump: 'on-seal-bump' } as const;

/** The level whose seal pulses on arrival; the others only slide their card in. */
const IMPORTANT_LEVEL: MessagePriorityLevel = 2;
const FILTER_CLASS_BY_LEVEL: Readonly<Record<MessagePriorityLevel, string>> = {
  0: 'low',
  1: 'medium',
  2: 'high',
};
const FILTER_LEVELS: readonly MessagePriorityLevel[] = [0, 1, 2];
/** The parts of a card focus can rest on, so a rebuilt card gives focus back to the same one. */
const CARD_PARTS = ['on-notice__card', 'on-notice__toggle', 'on-notice__dismiss'] as const;

export interface NoticeColumnDeps extends NoticeThumbPainters {
  readonly plane: HTMLElement;
  /** Design px the column keeps clear above the plane's bottom edge, for the minimap. */
  readonly bottomInset: number | (() => number);
  readonly onLevel: (level: MessagePriorityLevel) => void;
  /** Centre the view on one note: a card's lead or a row's member. */
  readonly onGo: (id: number) => void;
  /** Dismiss one member of an open stack. */
  readonly onDismiss: (id: number) => void;
  /** Dismiss every note a card stands for, a lone note or a whole stack. */
  readonly onDismissGroup: (key: string) => void;
  readonly onDismissAll: () => void;
  /** Open the stack `key` in the column, or close the open one (null); a hover preview is silent. */
  readonly onOpen: (key: string | null, source: NoticeOpenSource) => void;
}

/** The figure canvases inside the list's visible area and their shared size on screen. */
export interface NoticeFigureSlots {
  readonly slots: readonly NoticeFigureSlot[];
  readonly box: NoticeFigureBox;
}

/** The notification column: the seal filters with their tallies, the fanning card list with the open
 *  stack's rows, the "more" badge and the whole message beside the hovered card or row. */
export interface NoticeColumn {
  /** Rebuild for `stacks` in column order with `open` listing its rows; call only when either changed. */
  render(
    stacks: readonly NoticeStackView[],
    tally: readonly number[],
    level: MessagePriorityLevel,
    open: string | null,
  ): void;
  /** The settler and vehicle figures to paint this frame: only the cards and rows on screen cost a draw. */
  figures(): NoticeFigureSlots;
  /** Swap a figure canvas whose subject is no longer drawn for the scroll glyph. */
  unpicture(canvas: HTMLCanvasElement): void;
  dispose(): void;
}

function bubbleLine(className: string, text: string): HTMLElement {
  const line = document.createElement('span');
  line.className = className;
  line.textContent = text;
  return line;
}

export function createNoticeColumn(deps: NoticeColumnDeps): NoticeColumn {
  const copy = messages().hud.notices;
  const column = document.createElement('aside');
  column.className = 'on-notices';
  const bottomInset = (): number =>
    typeof deps.bottomInset === 'function' ? deps.bottomInset() : deps.bottomInset;
  let inset = bottomInset();
  Object.assign(column.style, {
    left: `${NOTICE_COLUMN.left}px`,
    top: `${NOTICE_COLUMN.top}px`,
    width: `${NOTICE_COLUMN.width}px`,
    bottom: `${inset}px`,
  });
  column.innerHTML = `<div class="on-notices__head"><span class="on-sr"></span><div class="on-filters" role="toolbar"></div><button type="button" class="on-notices__clear">${GLYPH.bin}</button></div><p class="on-notices__empty" hidden></p><ul class="on-notices__list"></ul><button type="button" class="on-notices__more" hidden><svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg><span></span></button><div class="on-notices__full" role="tooltip" hidden></div>`;
  const part = <T extends Element>(selector: string): T => {
    const found = column.querySelector(selector);
    if (found === null) throw new Error(`notice column: ${selector} missing`);
    return found as T;
  };
  const count = part<HTMLElement>('.on-sr');
  const filters = part<HTMLElement>('.on-filters');
  const empty = part<HTMLElement>('.on-notices__empty');
  const list = part<HTMLElement>('.on-notices__list');
  const more = part<HTMLButtonElement>('.on-notices__more');
  const moreCount = part<HTMLElement>('.on-notices__more span');
  const full = part<HTMLElement>('.on-notices__full');
  const clear = part<HTMLButtonElement>('.on-notices__clear');
  filters.setAttribute('aria-label', copy.levelLabel);
  clear.setAttribute('aria-label', copy.clearAll);
  clear.title = copy.clearAll;
  clear.addEventListener('click', () => deps.onDismissAll());
  empty.textContent = copy.empty;
  list.setAttribute('aria-label', copy.label);
  const filterNames = [copy.filters.all, copy.filters.notable, copy.filters.important];
  const weightNames = [copy.weights.routine, copy.weights.notable, copy.weights.important];
  const filterButtons = FILTER_LEVELS.map((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `on-filter on-filter--${FILTER_CLASS_BY_LEVEL[level]}`;
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = '<span class="on-filter__count"></span>';
    button.addEventListener('click', () => deps.onLevel(level));
    filters.append(button);
    return button;
  });
  deps.plane.append(column);

  const cardsByKey = new Map<string, HTMLLIElement>();
  const viewsByKey = new Map<string, NoticeStackView>();
  const shapes = new Map<HTMLLIElement, string>();
  const members = createNoticeMembers(copy);
  /** The stack whose rows the column lists, as last rendered. */
  let openKey: string | null = null;
  /** Where the card the player opened stood in the list's view (design px), until the layout that
   *  lists its rows has put it back there. */
  let anchor: { readonly key: string; readonly top: number } | null = null;
  /** The overlap the cards down to the open one keep while it is open. */
  let openAbove = 0;
  /** The figure canvases on view as last found, and whether the cards have moved since. */
  let figureSlots: NoticeFigureSlots = { slots: [], box: { width: 0, height: 0, pixelScale: 0 } };
  let figureSlotsStale = true;

  const items = (): HTMLLIElement[] =>
    [...list.children].filter(
      (c): c is HTMLLIElement => c instanceof HTMLLIElement && c.classList.contains('on-notice'),
    );
  const keyOf = (li: HTMLElement): string => li.dataset.key ?? '';
  const itemOf = (target: EventTarget | null): HTMLLIElement | null => {
    const li = target instanceof Element ? target.closest('.on-notice') : null;
    return li instanceof HTMLLIElement ? li : null;
  };
  const rowOf = (target: EventTarget | null): HTMLLIElement | null => {
    const row = target instanceof Element ? target.closest('.on-member') : null;
    return row instanceof HTMLLIElement ? row : null;
  };
  /** An element's top in the list's scrolled content (design px). */
  const topInList = (el: HTMLElement): number => {
    let y = 0;
    for (let at: Element | null = el; at instanceof HTMLElement && at !== list; at = at.offsetParent) {
      y += at.offsetTop;
    }
    return y;
  };

  const updateMore = (): void => {
    const fold = list.scrollTop + list.clientHeight;
    let below = 0;
    for (const li of items()) if (li.offsetTop + li.offsetHeight - FOLD_TOLERANCE > fold) below++;
    more.hidden = below === 0;
    moreCount.textContent = formatMessage(copy.more, { count: below });
    column.classList.toggle(OVERFLOWING, list.scrollHeight > list.clientHeight + 1);
  };

  /** How much of each card's top the card before it covers (design px), for its figure. */
  const covered = new Map<HTMLLIElement, number>();
  /** The overlap of the cards that fan as one: every card while no stack is open, else those down to it. */
  let overlap = 0;
  /** The figure canvases on view and their visible heights, read where the layout is current. */
  const findFigureSlots = (): void => {
    figureSlotsStale = false;
    const top = list.scrollTop;
    const bottom = top + list.clientHeight;
    const slots: NoticeFigureSlot[] = [];
    let box: NoticeFigureBox = { width: 0, height: 0, pixelScale: 0 };
    const take = (holder: HTMLElement, holderTop: number, visible: (canvas: HTMLCanvasElement) => number) => {
      if (holderTop + holder.offsetHeight <= top || holderTop >= bottom) return;
      const canvas = holder.querySelector('.on-notice__preview--figure');
      if (!(canvas instanceof HTMLCanvasElement)) return;
      // One rect read serves every card and row: the plane's scale is theirs, and a row's canvas has
      // a card's size, cropped by its smaller box. The bitmap fills the canvas's content box.
      if (box.pixelScale === 0) {
        box = {
          width: canvas.clientWidth,
          height: canvas.clientHeight,
          pixelScale: (canvas.getBoundingClientRect().width / canvas.offsetWidth) * devicePixelRatio,
        };
      }
      slots.push({ entity: Number(holder.dataset.entity), canvas, visible: visible(canvas) });
    };
    for (const li of items()) {
      const face = li.firstElementChild;
      const height = face instanceof HTMLElement ? face.offsetHeight : li.offsetHeight;
      take(li, li.offsetTop, () => height - (covered.get(li) ?? 0));
    }
    if (openKey !== null) {
      members.paintVisible(top, bottom, deps);
      for (const { row, top: rowTop } of members.visibleRows(top, bottom)) {
        if (row.dataset.entity !== undefined) take(row, rowTop, (canvas) => canvas.clientHeight);
      }
    }
    figureSlots = { slots, box };
  };

  /**
   * Fan the cards so they all fit: one uniform overlap, weightier cards in front. Fanned cards keep one
   * event line, so the heights are measured again once the fan is on. With a stack open, the cards down
   * to it keep the overlap they had, its rows never fan, and the cards below fan in the room left.
   */
  const layout = (): void => {
    const shown = items();
    shown.forEach((li, i) => {
      li.style.setProperty('--z', String(shown.length - i));
      li.style.removeProperty('--overlap');
    });
    const styles = getComputedStyle(list);
    const room =
      column.clientHeight - list.offsetTop - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    const heights = (): number[] => shown.map((li) => li.offsetHeight);
    const openLi = openKey === null ? undefined : cardsByKey.get(openKey);
    const openIndex = openLi === undefined || !members.element.isConnected ? -1 : shown.indexOf(openLi);
    let below = 0;
    if (openIndex < 0) {
      column.classList.remove(STACKED);
      overlap = fanOverlap(heights(), room, CARD_GAP, MIN_CARD_STRIP);
      if (overlap > 0) {
        column.classList.add(STACKED);
        overlap = fanOverlap(heights(), room, CARD_GAP, MIN_CARD_STRIP);
      }
    } else {
      overlap = openAbove;
      column.classList.toggle(STACKED, overlap > 0);
      members.element.style.setProperty('--z', String(shown.length - openIndex));
      const rows = (): number => members.element.offsetHeight;
      below = fanBelowOpen(heights(), openIndex, rows(), overlap, room, CARD_GAP, MIN_CARD_STRIP);
      if (below > 0 && !column.classList.contains(STACKED)) {
        column.classList.add(STACKED);
        below = fanBelowOpen(heights(), openIndex, rows(), overlap, room, CARD_GAP, MIN_CARD_STRIP);
      }
      shown.forEach((li, i) => {
        if (i > openIndex) li.style.setProperty('--overlap', `${below}px`);
      });
    }
    list.style.setProperty('--overlap', `${overlap}px`);
    covered.clear();
    shown.forEach((li, i) => {
      covered.set(li, i === 0 || i === openIndex + 1 ? 0 : i > openIndex && openIndex >= 0 ? below : overlap);
    });
    if (openLi !== undefined && anchor?.key === openKey) {
      // The thinner fanned edges of the stacks above can lift the open card; it goes back under the
      // pointer, with the gap above it or the list scrolled.
      const drift = anchor.top - (openLi.offsetTop - list.scrollTop);
      if (drift > 0) openLi.style.setProperty('--anchor-shift', `${drift}px`);
      else if (drift < 0) list.scrollTop -= drift;
      anchor = null;
    }
    placeFull();
    updateMore();
    findFigureSlots();
  };

  let pinned: HTMLLIElement | null = null;
  /** The card or row the bubble last showed beside. */
  let bubbleFor: HTMLLIElement | null = null;
  /** The bubble beside a card or a row: a row's whole message, a card's with a stack's breakdown. */
  const bubbleOf = (el: HTMLLIElement): HTMLElement[] => {
    const member = members.memberView(el);
    if (member !== undefined) return [bubbleLine('on-notices__full-text', member.full)];
    const stack = viewsByKey.get(keyOf(el));
    if (stack === undefined) return [];
    const text = bubbleLine('on-notices__full-text', stack.lead.full);
    if (!isStack(stack)) return [text];
    return [
      bubbleLine('on-notices__full-head', stack.breakdown),
      text,
      bubbleLine('on-notices__full-hint', copy.groupHint),
    ];
  };
  /** Keep the bubble beside its card or row as the list scrolls or lays out again; one that left goes. */
  const placeFull = (): void => {
    if (bubbleFor === null || full.hidden) return;
    if (bubbleFor.isConnected) full.style.top = `${list.offsetTop + topInList(bubbleFor) - list.scrollTop}px`;
    else full.hidden = true;
  };
  const showFull = (el: HTMLLIElement): void => {
    full.replaceChildren(...bubbleOf(el));
    full.hidden = false;
    bubbleFor = el;
    placeFull();
  };
  const hideFull = (): void => {
    if (pinned === null) full.hidden = true;
  };
  const pinFull = (el: HTMLLIElement | null): void => {
    pinned = el;
    if (el === null) full.hidden = true;
    else showFull(el);
    for (const face of list.querySelectorAll(
      '.on-notice__card[aria-expanded], .on-member__go[aria-expanded]',
    )) {
      face.setAttribute('aria-expanded', String(face.closest('.on-notice, .on-member') === pinned));
    }
  };
  /** The card or row whose hover target `target` is; the dismiss buttons are outside both. */
  const hoverOf = (target: EventTarget | null): HTMLLIElement | null => {
    if (!(target instanceof Element)) return null;
    if (target.closest('.on-member__go') !== null) return rowOf(target);
    if (target.closest('.on-notice__card, .on-notice__toggle') !== null) return itemOf(target);
    return null;
  };

  const toggleOf = (key: string): HTMLElement | null => {
    const toggle = cardsByKey.get(key)?.querySelector('.on-notice__toggle');
    return toggle instanceof HTMLElement ? toggle : null;
  };
  /** How far the open stack's rows push `li` down (design px): the rows, and the overlap the card after
   *  them is spared. They leave when `li` opens, so its anchor discounts them and only the thinner
   *  fanned edges above it are made up for. */
  const rowsAbove = (li: HTMLLIElement): number => {
    const rows = members.element;
    const card = rows.previousElementSibling;
    const after = rows.nextElementSibling;
    if (!rows.isConnected || rows.offsetTop > li.offsetTop) return 0;
    if (!(card instanceof HTMLElement) || !(after instanceof HTMLElement)) return 0;
    return after.offsetTop - (card.offsetTop + card.offsetHeight + CARD_GAP - overlap);
  };
  const open = (li: HTMLLIElement, source: NoticeOpenSource): void => {
    const key = keyOf(li);
    if (!li.classList.contains(STACK)) return;
    if (key !== openKey) {
      anchor = { key, top: li.offsetTop - list.scrollTop - rowsAbove(li) };
      openAbove = overlap;
    }
    deps.onOpen(key, source);
  };
  const close = (source: NoticeOpenSource): void => {
    if (openKey !== null) deps.onOpen(null, source);
  };
  const hover = driveStackHover(list, {
    over: (target) => {
      if (target instanceof Element && target.closest('.on-members') !== null) return openKey;
      const li = itemOf(target);
      return li?.classList.contains(STACK) ? keyOf(li) : null;
    },
    open: (key) => {
      const li = cardsByKey.get(key);
      if (li !== undefined) open(li, 'hover');
    },
    close: () => close('hover'),
  });
  /** Open `li`'s stack for good, or keep its hover preview open. */
  const pin = (li: HTMLLIElement): void => {
    if (!li.classList.contains(STACK)) return;
    hover.pin(keyOf(li));
    open(li, 'press');
  };
  /** Close the open stack by a press or a key; a preview closes as silently as it opened. */
  const closeStack = (): void => {
    const source = openKey !== null && hover.isPinned(openKey) ? 'press' : 'hover';
    hover.closed();
    close(source);
  };
  const dismissCard = (li: HTMLLIElement, all: boolean): void => {
    if (all) deps.onDismissAll();
    else deps.onDismissGroup(keyOf(li));
  };
  const dismissRow = (row: HTMLLIElement, all: boolean): void => {
    if (all) deps.onDismissAll();
    else deps.onDismiss(Number(row.dataset.id));
  };

  list.addEventListener('click', (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const row = rowOf(target);
    if (row !== null) {
      if (target.closest('.on-member__dismiss') !== null) dismissRow(row, event.shiftKey);
      else if (target.closest('.on-member__go') !== null) {
        const view = members.memberView(row);
        if (view?.canGo === true) deps.onGo(view.id);
        else pinFull(pinned === row ? null : row);
      }
      return;
    }
    if (target.closest('.on-members__more') !== null) {
      const added = members.extend();
      layout();
      // The button hides once every row shows; focus goes on to the first row it brought.
      const go = added?.querySelector('.on-member__go');
      if (go instanceof HTMLElement) go.focus();
      return;
    }
    const li = itemOf(target);
    if (li === null) return;
    if (target.closest('.on-notice__dismiss') !== null) {
      dismissCard(li, event.shiftKey);
      return;
    }
    if (target.closest('.on-notice__toggle') !== null) {
      if (keyOf(li) === openKey && hover.isPinned(openKey)) closeStack();
      else pin(li);
      return;
    }
    if (target.closest('.on-notice__card') === null) return;
    if (openKey !== null && keyOf(li) !== openKey) closeStack();
    const lead = viewsByKey.get(keyOf(li))?.lead;
    if (lead?.canGo === true) deps.onGo(lead.id);
    else pinFull(pinned === li ? null : li);
  });
  list.addEventListener('contextmenu', (event) => {
    const row = rowOf(event.target);
    const li = itemOf(event.target);
    if (row === null && li === null) return;
    event.preventDefault();
    if (row !== null) dismissRow(row, event.shiftKey);
    else if (li !== null) dismissCard(li, event.shiftKey);
  });
  const isStackItem = (li: HTMLLIElement): boolean => li.classList.contains(STACK);
  /** Move focus along the open stack's rows by `step`, from the card onto the first row and back. */
  const stepRows = (from: Element, step: number): boolean => {
    if (openKey === null) return false;
    const stops = members.focusables();
    const toggle = toggleOf(openKey);
    const at = from instanceof HTMLElement ? stops.indexOf(from) : -1;
    const onCard = from === toggle || from === cardsByKey.get(openKey)?.querySelector('.on-notice__card');
    if (at < 0 && !onCard) return false;
    const next = at < 0 ? (step > 0 ? stops[0] : undefined) : at + step < 0 ? toggle : stops[at + step];
    next?.focus();
    return next !== undefined && next !== null;
  };
  list.addEventListener('keydown', (event) => {
    const { target } = event;
    if (!(target instanceof Element)) return;
    const row = rowOf(target);
    const li = itemOf(target);
    let handled = true;
    if (event.key === 'Delete' && row !== null) dismissRow(row, event.shiftKey);
    else if (event.key === 'Delete' && li !== null) dismissCard(li, event.shiftKey);
    else if (event.key === 'ArrowRight' && li !== null && isStackItem(li) && !hover.isPinned(keyOf(li)))
      pin(li);
    else if (
      event.key === 'ArrowLeft' &&
      openKey !== null &&
      (row !== null || (li !== null && keyOf(li) === openKey))
    ) {
      toggleOf(openKey)?.focus();
      closeStack();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      handled = stepRows(target, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Escape' && openKey !== null) {
      if (row !== null || target.closest('.on-members') !== null) toggleOf(openKey)?.focus();
      closeStack();
    } else if (event.key === 'Escape' && pinned !== null) pinFull(null);
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  });
  const onEnter = (event: Event): void => {
    const el = hoverOf(event.target);
    if (el !== null && pinned === null) showFull(el);
  };
  const onLeave = (event: Event): void => {
    if (hoverOf(event.target) !== null) hideFull();
  };
  list.addEventListener('mouseover', onEnter);
  list.addEventListener('mouseout', onLeave);
  list.addEventListener('focusin', onEnter);
  list.addEventListener('focusout', onLeave);
  // A scroll or a settled transition moves the figure canvases: they are found again once per frame, in
  // the resize-observer pass after the browser's own layout.
  const slotFinder = new ResizeObserver(() => findFigureSlots());
  const findSlotsAfterFrame = (): void => {
    slotFinder.unobserve(list);
    slotFinder.observe(list);
  };
  list.addEventListener('scroll', () => {
    placeFull();
    updateMore();
    findSlotsAfterFrame();
  });
  // The fan settles through a margin transition; count the fold and place the figures again once it has.
  list.addEventListener('transitionend', () => {
    updateMore();
    findSlotsAfterFrame();
  });
  list.addEventListener('mouseleave', updateMore);
  more.addEventListener('click', () => {
    list.scrollBy({ top: list.clientHeight - MORE_SCROLL_KEEP, behavior: 'smooth' });
  });
  const resize = new ResizeObserver(layout);
  resize.observe(column);
  /** Fan the cards in the next resize-observer pass, which runs after the browser's own layout: a fresh
   *  observation always reports, and the heights read there cost no layout of the rest of the HUD. */
  const layoutAfterFrame = (): void => {
    resize.unobserve(column);
    resize.observe(column);
  };
  // A card whose text grew or shrank fans again once the browser has laid it out; a render that only
  // rewrote counts and labels in cards of unchanged size measures nothing.
  const cardSizes = new ResizeObserver(layout);

  /** Build a card's inside for its shape, keeping focus on the same part when it held it. */
  const shapeCard = (li: HTMLLIElement, stack: NoticeStackView): void => {
    const focused = document.activeElement;
    const part = li.contains(focused)
      ? CARD_PARTS.find((name) => focused?.classList.contains(name))
      : undefined;
    if (pinned === li) pinFull(null);
    li.innerHTML = cardInnerMarkup(stack);
    li.style.removeProperty('--anchor-shift');
    shapes.set(li, cardShape(stack));
    paintNoticeThumb(li, stack.lead.thumb, deps);
    if (part !== undefined) {
      const back = li.querySelector(`.${part}`) ?? li.querySelector('.on-notice__card');
      if (back instanceof HTMLElement) back.focus();
    }
  };
  const newCard = (stack: NoticeStackView): HTMLLIElement => {
    const li = document.createElement('li');
    li.className = 'on-notice';
    shapeCard(li, stack);
    if (stack.lead.fresh) {
      li.classList.add(FRESH);
      // Retire the class once the arrival has played, so a later reorder does not replay it.
      const last = stack.lead.level === IMPORTANT_LEVEL ? ARRIVAL_ANIMATION.seal : ARRIVAL_ANIMATION.card;
      li.addEventListener('animationend', (event) => {
        if (event.animationName === last) li.classList.remove(FRESH);
        if (event.animationName === ARRIVAL_ANIMATION.bump) li.classList.remove(GREW);
      });
    } else {
      li.addEventListener('animationend', (event) => {
        if (event.animationName === ARRIVAL_ANIMATION.bump) li.classList.remove(GREW);
      });
    }
    return li;
  };

  return {
    render: (stacks, tally, level, nextOpen): void => {
      /** Whether a card came, went, moved or changed its shape, or the open stack's rows changed: only
       *  then do the cards fan again. */
      let moved = false;
      const focused = document.activeElement;
      const focusInRows = members.element.contains(focused);
      // A dismissed row hands focus to the row that takes its place, then to its stack's card. A row's
      // stop is its go button, whichever of its buttons held focus.
      const rowAt = focusInRows ? members.rows().findIndex((row) => row.contains(focused)) : -1;
      const focusedStop =
        rowAt >= 0 || !focusInRows ? rowAt : members.focusables().findIndex((stop) => stop.contains(focused));
      const rowsKey = openKey;
      let lostFocus: string | null = null;
      const keep = new Set(stacks.map((stack) => stack.key));
      for (const [key, li] of cardsByKey) {
        if (keep.has(key)) continue;
        if (li.contains(focused)) lostFocus = key;
        if (li === pinned) pinFull(null);
        li.remove();
        cardSizes.unobserve(li);
        moved = true;
        cardsByKey.delete(key);
        viewsByKey.delete(key);
        shapes.delete(li);
      }
      const openStack = nextOpen === null ? undefined : stacks.find((stack) => stack.key === nextOpen);
      const openMembers = openStack !== undefined && isStack(openStack) ? openStack.members : null;
      const opened = openMembers === null ? null : nextOpen;
      if (opened !== openKey) {
        moved = true;
        cardsByKey.get(openKey ?? '')?.style.removeProperty('--anchor-shift');
        if (openKey !== null) toggleOf(openKey)?.removeAttribute('aria-controls');
        if (opened === null) anchor = null;
        if (pinned !== null && members.element.contains(pinned)) pinFull(null);
        members.close();
        openKey = opened;
      }
      let at = 0;
      for (const stack of stacks) {
        const before = viewsByKey.get(stack.key);
        let li = cardsByKey.get(stack.key);
        if (li === undefined) {
          li = newCard(stack);
          cardSizes.observe(li);
          moved = true;
          cardsByKey.set(stack.key, li);
        } else if (shapes.get(li) !== cardShape(stack)) {
          shapeCard(li, stack);
          moved = true;
        }
        if (before !== undefined && stack.count > before.count && stack.lead.fresh) {
          // A bump still playing restarts in place: re-adding its class in the same frame would not
          // replay it, and a reflow between the two would lay the whole HUD out.
          if (li.classList.contains(GREW)) restartBump(li);
          else li.classList.add(GREW);
        }
        viewsByKey.set(stack.key, stack);
        fillCard(li, stack, stack.key === openKey, copy);
        if (list.children[at] !== li) {
          list.insertBefore(li, list.children[at] ?? null);
          moved = true;
        }
        at++;
        if (stack.key === openKey && openMembers !== null) {
          members.sync(stack.key, openMembers);
          moved = true;
          if (list.children[at] !== members.element)
            list.insertBefore(members.element, list.children[at] ?? null);
          toggleOf(stack.key)?.setAttribute('aria-controls', MEMBERS_ID);
          at++;
        }
      }
      if (openKey === null && members.element.isConnected) {
        members.element.remove();
        moved = true;
      }
      hover.listing(openKey);
      // A pinned row whose member left takes its bubble with it.
      if (pinned !== null && !pinned.isConnected) pinFull(null);
      // Moving a card that held focus (a stack lifted by a new member) blurs it; give it back.
      if (focused instanceof HTMLElement && focused.isConnected && list.contains(focused)) {
        if (document.activeElement !== focused) focused.focus({ preventScroll: true });
      }
      if (focusInRows && !members.element.contains(document.activeElement)) {
        const stops = openKey === null ? [] : members.focusables();
        const card = cardsByKey.get(rowsKey ?? '');
        const back =
          stops[Math.min(focusedStop, stops.length - 1)] ??
          (rowsKey === null ? null : toggleOf(rowsKey)) ??
          card?.querySelector('.on-notice__card');
        if (back instanceof HTMLElement) back.focus();
        else lostFocus = rowsKey;
      }
      if (lostFocus !== null && !list.contains(document.activeElement)) {
        const back = list.querySelector('.on-notice__card') ?? filterButtons[level];
        if (back instanceof HTMLElement) back.focus();
      }
      const total = tally.reduce((sum, n) => sum + n, 0);
      count.textContent = formatMessage(copy.count, { count: total });
      empty.hidden = total > 0;
      clear.disabled = stacks.length === 0;
      filterButtons.forEach((button, i) => {
        const filter = filterNames[i] ?? '';
        const label = formatMessage(copy.tally, {
          filter,
          weight: weightNames[i] ?? '',
          count: tally[i] ?? 0,
        });
        button.setAttribute('aria-pressed', String(i === level));
        button.setAttribute('aria-label', label);
        button.title = label;
        const value = button.firstElementChild;
        if (value !== null) value.textContent = String(tally[i] ?? 0);
      });
      if (moved) layoutAfterFrame();
    },
    figures: (): NoticeFigureSlots => {
      const nextInset = bottomInset();
      if (nextInset !== inset) {
        inset = nextInset;
        column.style.bottom = `${inset}px`;
        layoutAfterFrame();
      }
      // The cards' places change only with a layout, a scroll or a settled transition, which find the
      // slots again after the browser's layout; a frame reads layout here only once a card lost its
      // picture.
      if (figureSlotsStale) findFigureSlots();
      return figureSlots;
    },
    unpicture: (canvas): void => {
      canvas.outerHTML = glyphMarkup('scroll', false);
      figureSlotsStale = true;
    },
    dispose: (): void => {
      hover.dispose();
      resize.disconnect();
      cardSizes.disconnect();
      slotFinder.disconnect();
      column.remove();
    },
  };
}

function restartBump(li: HTMLElement): void {
  for (const animation of li.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation && animation.animationName === ARRIVAL_ANIMATION.bump) {
      animation.currentTime = 0;
    }
  }
}
