import { formatMessage, messages } from '../../i18n/index.js';
import type { Rect } from '../geometry.js';
import { NOTICE_COLUMN } from '../regions.js';
import { fanOverlap, type NoticeGlyph, type NoticeThumb } from '../tool-panel/messages/cards.js';
import type { MessagePriorityLevel } from '../tool-panel/messages/types.js';
import { GLYPH } from './icons.js';

/** Below this visible strip per card (design px) the fan stops and the list scrolls instead. */
const MIN_CARD_STRIP = 32;
/** The gap between unfanned cards (design px); mirrors `.on-notice` in foundation.css. */
const CARD_GAP = 7;
/** A card counts as below the fold once more than this much of it (design px) is past the edge. */
const FOLD_TOLERANCE = 6;
/** The badge scrolls one screen less this much, so the last card seen stays as a landmark. */
const MORE_SCROLL_KEEP = 40;
const STACKED = 'on-notices--stacked';
const OVERFLOWING = 'on-notices--overflowing';
const LONG = 'on-notice--long';
const FRESH = 'on-notice--fresh';
/** The arrival animations whose end retires the fresh state: the seal pulse outlasts the slide. */
const ARRIVAL_ANIMATION = { card: 'on-notice-in', seal: 'on-seal-pulse' } as const;

const SEAL_BY_LEVEL: Readonly<Record<MessagePriorityLevel, string>> = { 0: '', 1: 'warn', 2: 'danger' };
const FILTER_CLASS_BY_LEVEL: Readonly<Record<MessagePriorityLevel, string>> = {
  0: 'low',
  1: 'medium',
  2: 'high',
};
const FILTER_LEVELS: readonly MessagePriorityLevel[] = [0, 1, 2];

/** One card as the column shows it; the message centre projects its feed into these. */
export interface NoticeCardView {
  readonly id: number;
  readonly level: MessagePriorityLevel;
  readonly subject: string | null;
  readonly body: string;
  readonly full: string;
  readonly thumb: NoticeThumb;
  /** True when the card has a place to send the view to. */
  readonly canGo: boolean;
  /** True for a card raised moments ago: it slides in, and an urgent one pulses its seal. */
  readonly fresh: boolean;
}

export interface NoticeColumnDeps {
  readonly plane: HTMLElement;
  /** Design px the column keeps clear above the plane's bottom edge, for the minimap. */
  readonly bottomInset: number;
  readonly onLevel: (level: MessagePriorityLevel) => void;
  readonly onGo: (id: number) => void;
  readonly onDismiss: (id: number) => void;
  readonly onDismissAll: () => void;
}

/** A visible settler thumbnail, in client px. */
export interface NoticeThumbnail {
  readonly id: number;
  readonly entity: number;
  /** The whole thumbnail box, where the figure stands. */
  readonly box: Rect;
  /** The part of it inside the list's visible area. */
  readonly visible: Rect;
  /** True while the cards are fanned, so the backing must hide the card behind. */
  readonly opaque: boolean;
}

/** The notification column: the seal filters with their tallies, the fanning card list, the "more"
 *  badge and the unfolded text beside a long card. */
export interface NoticeColumn {
  /** Rebuild for `cards` in column order; call only when the feed changed. */
  render(cards: readonly NoticeCardView[], tally: readonly number[], level: MessagePriorityLevel): void;
  /** The settler thumbnails on screen this frame, back to front, for the figure layer under the cards. */
  thumbnails(): readonly NoticeThumbnail[];
  dispose(): void;
}

/** The line glyphs a card without a live settler shows. */
const NOTICE_GLYPH: Readonly<Record<NoticeGlyph, string>> = {
  house: GLYPH.house,
  swords: GLYPH.swords,
  skull: GLYPH.skull,
  banner: GLYPH.banner,
  chest: GLYPH.chest,
  scroll: GLYPH.scroll,
};

function previewMarkup(thumb: NoticeThumb): string {
  if (thumb.kind === 'settler') return '<span class="on-notice__preview on-notice__preview--settler"></span>';
  return `<span class="on-notice__preview on-notice__preview--glyph${thumb.dim ? ' on-notice__preview--dim' : ''}" aria-hidden="true">${NOTICE_GLYPH[thumb.glyph]}</span>`;
}

/** The markup of one card, shared with the gallery board's sample column. */
export function noticeCardMarkup(card: NoticeCardView, dismissLabel: string): string {
  const seal = SEAL_BY_LEVEL[card.level];
  const li = document.createElement('li');
  li.className = `on-notice${seal === '' ? '' : ` on-notice--${seal}`}${card.fresh ? ` ${FRESH}` : ''}`;
  li.dataset.id = String(card.id);
  if (card.thumb.kind === 'settler') li.dataset.entity = String(card.thumb.entity);
  li.innerHTML = `<button type="button" class="on-notice__card">${previewMarkup(card.thumb)}<small class="on-notice__subject"></small><b class="on-notice__event"></b><i class="on-seal${seal === '' ? '' : ` on-seal--${seal}`}" aria-hidden="true"></i>${card.canGo ? GLYPH.go : ''}</button><button type="button" class="on-notice__dismiss">${GLYPH.close}</button>`;
  const button = li.querySelector('.on-notice__card');
  const subject = li.querySelector('.on-notice__subject');
  const event = li.querySelector('.on-notice__event');
  const dismiss = li.querySelector('.on-notice__dismiss');
  if (button === null || subject === null || event === null || dismiss === null) {
    throw new Error('notice column: card markup incomplete');
  }
  button.setAttribute('aria-label', card.full);
  subject.textContent = card.subject ?? '';
  subject.toggleAttribute('hidden', card.subject === null);
  event.textContent = card.body;
  dismiss.setAttribute('aria-label', dismissLabel);
  return li.outerHTML;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w <= 0 || h <= 0 ? null : { x, y, w, h };
}

function rectOf(element: Element): Rect {
  const r = element.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function createNoticeColumn(deps: NoticeColumnDeps): NoticeColumn {
  const copy = messages().hud.notices;
  const column = document.createElement('aside');
  column.className = 'on-notices';
  Object.assign(column.style, {
    left: `${NOTICE_COLUMN.left}px`,
    top: `${NOTICE_COLUMN.top}px`,
    width: `${NOTICE_COLUMN.width}px`,
    bottom: `${deps.bottomInset}px`,
  });
  column.innerHTML = `<div class="on-notices__head"><span class="on-sr"></span><div class="on-filters" role="toolbar"></div></div><p class="on-notices__empty" hidden></p><ul class="on-notices__list"></ul><button type="button" class="on-notices__more" hidden><svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg><span></span></button><div class="on-notices__full" role="tooltip" hidden></div>`;
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
  filters.setAttribute('aria-label', copy.levelLabel);
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

  const cardsById = new Map<number, HTMLLIElement>();
  const viewsById = new Map<number, NoticeCardView>();
  const items = (): HTMLLIElement[] =>
    [...list.children].filter((c): c is HTMLLIElement => c instanceof HTMLLIElement);
  const idOf = (li: HTMLElement): number => Number(li.dataset.id);
  const itemOf = (target: EventTarget | null): HTMLLIElement | null => {
    const li = target instanceof Element ? target.closest('.on-notice') : null;
    return li instanceof HTMLLIElement ? li : null;
  };

  /** A hovered or focused card parts its neighbours, which can push the last card past the edge for
   *  the moment; the badge waits for the fan to close again. */
  const updateMore = (): void => {
    if (list.matches(':hover') || list.contains(document.activeElement)) return;
    const fold = list.scrollTop + list.clientHeight;
    let below = 0;
    for (const li of items()) if (li.offsetTop + li.offsetHeight - FOLD_TOLERANCE > fold) below++;
    more.hidden = below === 0;
    moreCount.textContent = formatMessage(copy.more, { count: below });
    column.classList.toggle(OVERFLOWING, list.scrollHeight > list.clientHeight + 1);
  };

  /** A card whose event line overflows its clamp unfolds beside the column; measured once, unfanned. */
  const measureLong = (li: HTMLLIElement): void => {
    if (li.dataset.measured === '1') return;
    li.dataset.measured = '1';
    const event = li.querySelector('.on-notice__event');
    if (event instanceof HTMLElement && event.scrollHeight > event.clientHeight + 1) li.classList.add(LONG);
  };

  /** Fan the cards so they all fit: one uniform overlap, weightier cards in front. Fanned cards keep
   *  one event line, so the heights are measured again once the fan is on. */
  const layout = (): void => {
    const shown = items();
    shown.forEach((li, i) => {
      li.style.setProperty('--z', String(shown.length - i));
    });
    const styles = getComputedStyle(list);
    const room =
      column.clientHeight - list.offsetTop - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    column.classList.remove(STACKED);
    for (const li of shown) measureLong(li);
    const heights = (): number[] => shown.map((li) => li.offsetHeight);
    let overlap = fanOverlap(heights(), room, CARD_GAP, MIN_CARD_STRIP);
    if (overlap > 0) {
      column.classList.add(STACKED);
      overlap = fanOverlap(heights(), room, CARD_GAP, MIN_CARD_STRIP);
    }
    list.style.setProperty('--overlap', `${overlap}px`);
    updateMore();
  };

  let pinned: HTMLLIElement | null = null;
  const showFull = (li: HTMLLIElement): void => {
    full.textContent = viewsById.get(idOf(li))?.full ?? '';
    full.hidden = false;
    full.style.top = `${list.offsetTop + li.offsetTop - list.scrollTop}px`;
  };
  const hideFull = (): void => {
    if (pinned === null) full.hidden = true;
  };
  const pinFull = (li: HTMLLIElement | null): void => {
    pinned = li;
    if (li === null) full.hidden = true;
    else showFull(li);
    for (const each of items()) {
      each.querySelector('.on-notice__card')?.setAttribute('aria-expanded', String(each === pinned));
    }
  };
  const longCardOf = (target: EventTarget | null): HTMLLIElement | null => {
    const li = itemOf(target);
    if (li === null || !li.classList.contains(LONG)) return null;
    return target instanceof Element && target.closest('.on-notice__card') !== null ? li : null;
  };

  list.addEventListener('click', (event) => {
    const li = itemOf(event.target);
    if (li === null || !(event.target instanceof Element)) return;
    if (event.target.closest('.on-notice__dismiss') !== null) {
      if (event.shiftKey) deps.onDismissAll();
      else deps.onDismiss(idOf(li));
      return;
    }
    if (event.target.closest('.on-notice__card') === null) return;
    const view = viewsById.get(idOf(li));
    if (view?.canGo === true) deps.onGo(view.id);
    else if (li.classList.contains(LONG)) pinFull(pinned === li ? null : li);
  });
  list.addEventListener('contextmenu', (event) => {
    const li = itemOf(event.target);
    if (li === null) return;
    event.preventDefault();
    if (event.shiftKey) deps.onDismissAll();
    else deps.onDismiss(idOf(li));
  });
  list.addEventListener('keydown', (event) => {
    if (event.key === 'Delete') {
      const li = itemOf(event.target);
      if (li === null) return;
      event.preventDefault();
      if (event.shiftKey) deps.onDismissAll();
      else deps.onDismiss(idOf(li));
    } else if (event.key === 'Escape' && pinned !== null) {
      event.preventDefault();
      event.stopPropagation();
      pinFull(null);
    }
  });
  const onEnter = (event: Event): void => {
    const li = longCardOf(event.target);
    if (li !== null && pinned === null) showFull(li);
  };
  const onLeave = (event: Event): void => {
    if (longCardOf(event.target) !== null) hideFull();
  };
  list.addEventListener('mouseover', onEnter);
  list.addEventListener('mouseout', onLeave);
  list.addEventListener('focusin', onEnter);
  list.addEventListener('focusout', onLeave);
  list.addEventListener('scroll', () => {
    if (pinned !== null) showFull(pinned);
    updateMore();
  });
  // The fan settles through a margin transition; count the fold again once it has.
  list.addEventListener('transitionend', updateMore);
  list.addEventListener('mouseleave', updateMore);
  more.addEventListener('click', () => {
    list.scrollBy({ top: list.clientHeight - MORE_SCROLL_KEEP, behavior: 'smooth' });
  });
  const resize = new ResizeObserver(layout);
  resize.observe(column);

  return {
    render: (cards, tally, level): void => {
      const focused = document.activeElement;
      let lostFocus = false;
      const keep = new Set(cards.map((card) => card.id));
      for (const [id, li] of cardsById) {
        if (keep.has(id)) continue;
        if (li.contains(focused)) lostFocus = true;
        if (li === pinned) pinFull(null);
        li.remove();
        cardsById.delete(id);
        viewsById.delete(id);
      }
      cards.forEach((card, i) => {
        viewsById.set(card.id, card);
        let li = cardsById.get(card.id);
        if (li === undefined) {
          const holder = document.createElement('ul');
          holder.innerHTML = noticeCardMarkup(card, copy.dismiss);
          const made = holder.firstElementChild;
          if (!(made instanceof HTMLLIElement)) throw new Error('notice column: card markup');
          li = made;
          cardsById.set(card.id, li);
          if (card.fresh) {
            // Retire the class once the arrival has played, so a later reorder does not replay it.
            const last = card.level === 2 ? ARRIVAL_ANIMATION.seal : ARRIVAL_ANIMATION.card;
            const fresh = li;
            fresh.addEventListener('animationend', (event) => {
              if (event.animationName === last) fresh.classList.remove(FRESH);
            });
          }
        }
        const at = list.children[i];
        if (at !== li) list.insertBefore(li, at ?? null);
      });
      if (lostFocus) {
        const next = list.querySelector('.on-notice__card');
        if (next instanceof HTMLElement) next.focus();
        else filterButtons[level]?.focus();
      }
      const total = tally.reduce((sum, n) => sum + n, 0);
      count.textContent = formatMessage(copy.count, { count: total });
      empty.hidden = total > 0;
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
      layout();
    },
    thumbnails: (): NoticeThumbnail[] => {
      const clip = rectOf(list);
      const opaque = column.classList.contains(STACKED);
      const top = list.scrollTop;
      const bottom = top + list.clientHeight;
      const out: NoticeThumbnail[] = [];
      const raised: NoticeThumbnail[] = [];
      for (const li of items().reverse()) {
        // Cards past the fold cost no rect read.
        if (li.offsetTop + li.offsetHeight <= top || li.offsetTop >= bottom) continue;
        const preview = li.querySelector('.on-notice__preview--settler');
        if (preview === null) continue;
        const box = rectOf(preview);
        const visible = intersect(box, clip);
        if (visible === null) continue;
        const entry = { id: idOf(li), entity: Number(li.dataset.entity), box, visible, opaque };
        // A hovered or focused card stands over its neighbours, so its figure paints last.
        if (li.matches(':hover, :focus-within')) raised.push(entry);
        else out.push(entry);
      }
      out.push(...raised);
      return out;
    },
    dispose: (): void => {
      resize.disconnect();
      column.remove();
    },
  };
}
