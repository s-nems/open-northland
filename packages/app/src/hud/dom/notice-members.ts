import { formatMessage, type Messages } from '../../i18n/index.js';
import type { NoticeThumb } from '../tool-panel/messages/cards.js';
import { GLYPH } from './icons.js';
import {
  figureEntity,
  type NoticeMemberView,
  type NoticeThumbPainters,
  paintNoticeThumb,
  previewMarkup,
  SEAL_BY_LEVEL,
} from './notice-card.js';

type NoticesCopy = Messages['hud']['notices'];

/** Rows an open stack lists before its "more in the group" button extends the list to every member. */
const MEMBER_ROWS_SHOWN = 6;
export const MEMBERS_ID = 'on-notice-members';

/** The rows of the open stack, a block of the column's list right under the stack's card. */
export interface NoticeMembers {
  /** The block; the column inserts it after the open card. */
  readonly element: HTMLLIElement;
  /** Show `members` for the stack `key`; a new key starts with the short list again. */
  sync(key: string, members: readonly NoticeMemberView[]): void;
  /** Forget the shown stack, so its next opening starts with the short list again. */
  close(): void;
  /** List every member, past the short list; answers the first row it added. */
  extend(): HTMLLIElement | undefined;
  rows(): HTMLLIElement[];
  /** The rows between `top` and `bottom` (the column list's scroll coordinates) with their tops there.
   *  Rows share one height, so the slice comes from the offsets alone, not a walk over every row. */
  visibleRows(top: number, bottom: number): readonly VisibleRow[];
  /** The row buttons and the extend button in focus order. */
  focusables(): HTMLElement[];
  memberView(row: HTMLLIElement): NoticeMemberView | undefined;
  /** Paint the building and glyph thumbnails of rows between `top` and `bottom` (the list's scroll
   *  coordinates) that have none yet; the rest wait until they scroll into view. */
  paintVisible(top: number, bottom: number, painters: NoticeThumbPainters): void;
}

export interface VisibleRow {
  readonly row: HTMLLIElement;
  readonly top: number;
}

function thumbKey(thumb: NoticeThumb): string {
  switch (thumb.kind) {
    case 'settler':
    case 'vehicle':
      return `${thumb.kind}:${thumb.entity}`;
    case 'building':
      return `building:${thumb.typeId}`;
    case 'glyph':
      return `glyph:${thumb.glyph}:${thumb.dim}:${thumb.seat ?? ''}`;
  }
}

function rowShape(view: NoticeMemberView): string {
  return `${thumbKey(view.thumb)}|${view.canGo}`;
}

function rowMarkup(view: NoticeMemberView): string {
  return `<button type="button" class="on-member__go"><span class="on-member__thumb">${previewMarkup(view.thumb)}</span><i class="on-seal" aria-hidden="true"></i><span class="on-member__text"><b class="on-member__label"></b><span class="on-member__meta"></span></span></button><button type="button" class="on-member__dismiss">${GLYPH.close}</button>`;
}

function fillRow(row: HTMLLIElement, view: NoticeMemberView): void {
  const seal = row.querySelector('.on-seal');
  const label = row.querySelector('.on-member__label');
  const meta = row.querySelector('.on-member__meta');
  const go = row.querySelector('.on-member__go');
  if (seal === null || label === null || meta === null || go === null) {
    throw new Error('notice column: member row markup incomplete');
  }
  const level = SEAL_BY_LEVEL[view.level];
  seal.className = `on-seal${level === '' ? '' : ` on-seal--${level}`}`;
  label.textContent = view.label;
  meta.textContent = view.detail === '' ? view.age : `${view.detail} · ${view.age}`;
  go.setAttribute('aria-label', `${view.full} ${view.age}`);
  // A row with no target is a disclosure: a press pins its whole message.
  if (!view.canGo && !go.hasAttribute('aria-expanded')) go.setAttribute('aria-expanded', 'false');
  const entity = figureEntity(view.thumb);
  if (entity === undefined) delete row.dataset.entity;
  else row.dataset.entity = String(entity);
}

export function createNoticeMembers(copy: NoticesCopy): NoticeMembers {
  const element = document.createElement('li');
  element.className = 'on-members';
  element.innerHTML = `<ol class="on-members__rows" id="${MEMBERS_ID}"></ol><button type="button" class="on-members__more" hidden></button>`;
  const list = element.querySelector('ol');
  const more = element.querySelector('.on-members__more');
  if (!(list instanceof HTMLOListElement) || !(more instanceof HTMLButtonElement)) {
    throw new Error('notice column: members markup incomplete');
  }
  list.setAttribute('aria-label', copy.members);
  const rowsById = new Map<number, HTMLLIElement>();
  const views = new Map<HTMLLIElement, NoticeMemberView>();
  const shapes = new Map<HTMLLIElement, string>();
  const painted = new WeakSet<HTMLLIElement>();
  let shownKey: string | null = null;
  let extended = false;
  let last: readonly NoticeMemberView[] = [];

  const rows = (): HTMLLIElement[] =>
    [...list.children].filter((c): c is HTMLLIElement => c instanceof HTMLLIElement);

  const sync = (key: string, members: readonly NoticeMemberView[]): void => {
    if (key !== shownKey) {
      shownKey = key;
      extended = false;
    }
    last = members;
    const shown = extended ? members : members.slice(0, MEMBER_ROWS_SHOWN);
    const keep = new Set(shown.map((m) => m.id));
    for (const [id, row] of rowsById) {
      if (keep.has(id)) continue;
      row.remove();
      rowsById.delete(id);
      views.delete(row);
      shapes.delete(row);
    }
    shown.forEach((view, i) => {
      let row = rowsById.get(view.id);
      const shape = rowShape(view);
      if (row === undefined || shapes.get(row) !== shape) {
        const fresh = row ?? document.createElement('li');
        fresh.className = 'on-member';
        fresh.dataset.id = String(view.id);
        fresh.innerHTML = rowMarkup(view);
        fresh.querySelector('.on-member__dismiss')?.setAttribute('aria-label', copy.dismiss);
        painted.delete(fresh);
        shapes.set(fresh, shape);
        rowsById.set(view.id, fresh);
        row = fresh;
      }
      views.set(row, view);
      fillRow(row, view);
      const at = list.children[i];
      if (at !== row) list.insertBefore(row, at ?? null);
    });
    const hidden = members.length - shown.length;
    more.hidden = hidden <= 0;
    more.textContent = formatMessage(copy.membersMore, { count: hidden });
  };

  const visibleRows = (top: number, bottom: number): VisibleRow[] => {
    const { children } = list;
    const first = children[0];
    if (!(first instanceof HTMLElement)) return [];
    const base = element.offsetTop + list.offsetTop + first.offsetTop;
    const second = children[1];
    const pitch = second instanceof HTMLElement ? second.offsetTop - first.offsetTop : first.offsetHeight;
    if (pitch <= 0) return [];
    const from = Math.max(0, Math.floor((top - base) / pitch));
    const to = Math.min(children.length, Math.ceil((bottom - base) / pitch));
    const out: VisibleRow[] = [];
    for (let i = from; i < to; i++) {
      const row = children[i];
      if (row instanceof HTMLLIElement) out.push({ row, top: base + i * pitch });
    }
    return out;
  };

  return {
    element,
    sync,
    close: (): void => {
      shownKey = null;
      extended = false;
    },
    extend: (): HTMLLIElement | undefined => {
      if (extended || shownKey === null) return undefined;
      const before = list.children.length;
      extended = true;
      sync(shownKey, last);
      const added = list.children[before];
      return added instanceof HTMLLIElement ? added : undefined;
    },
    rows,
    visibleRows,
    focusables: (): HTMLElement[] => {
      const out: HTMLElement[] = [];
      for (const row of rows()) {
        const go = row.querySelector('.on-member__go');
        if (go instanceof HTMLElement) out.push(go);
      }
      if (!more.hidden) out.push(more);
      return out;
    },
    memberView: (row) => views.get(row),
    paintVisible: (top, bottom, painters): void => {
      for (const { row } of visibleRows(top, bottom)) {
        if (painted.has(row)) continue;
        const view = views.get(row);
        if (view === undefined) continue;
        painted.add(row);
        paintNoticeThumb(row, view.thumb, painters);
      }
    },
  };
}
