import { formatMessage, type Messages } from '../../i18n/index.js';
import type { NoticeGlyph, NoticeThumb } from '../tool-panel/messages/cards.js';
import { MIN_STACK_MEMBERS } from '../tool-panel/messages/groups.js';
import type { MessagePriorityLevel } from '../tool-panel/messages/types.js';
import { GLYPH } from './icons.js';

type NoticesCopy = Messages['hud']['notices'];

/** One note as the column shows it; the message centre projects its feed into these. */
export interface NoticeCardView {
  readonly id: number;
  readonly level: MessagePriorityLevel;
  /** The event line, short enough to fit the card. */
  readonly short: string;
  /** The whole message, shown beside the column on hover or focus. */
  readonly full: string;
  readonly thumb: NoticeThumb;
  /** True when the card has a place to send the view to. */
  readonly canGo: boolean;
  /** True for a card raised moments ago: it slides in, and an urgent one pulses its seal. */
  readonly fresh: boolean;
}

/** One member of an open stack, as its row inside the column shows it. */
export interface NoticeMemberView {
  readonly id: number;
  readonly level: MessagePriorityLevel;
  /** Who or what the note is about, or its whole message when no subject is left to name. */
  readonly label: string;
  /** The member's own card line when the stack's members read different ones; else empty. */
  readonly detail: string;
  readonly age: string;
  readonly full: string;
  readonly thumb: NoticeThumb;
  readonly canGo: boolean;
}

/** One card of the column: a lone note, or a stack of notes that share a key, faced by its lead. */
export interface NoticeStackView {
  readonly key: string;
  /** The lead's card; `fresh` when the stack's newest member is. */
  readonly lead: NoticeCardView;
  readonly count: number;
  /** What a stack holds ("1 dying · 3 starving"), empty for a lone note. */
  readonly breakdown: string;
  /** Every member in lead order for the open stack; null for every other card. */
  readonly members: readonly NoticeMemberView[] | null;
}

export interface NoticeThumbPainters {
  /** Paint a building's body into a canvas; false leaves the house glyph in its place. */
  readonly paintBuilding: (canvas: HTMLCanvasElement, typeId: number) => boolean;
  /** Paint a glyph's artwork into a canvas, in `seat`'s colour when the card is about one; false leaves
   *  the line glyph in its place, and `onFail` asks for it after a true return. */
  readonly paintGlyph: (
    canvas: HTMLCanvasElement,
    glyph: NoticeGlyph,
    seat: number | null,
    onFail: () => void,
  ) => boolean;
}

export const SEAL_BY_LEVEL: Readonly<Record<MessagePriorityLevel, string>> = {
  0: '',
  1: 'warn',
  2: 'danger',
};
/** Past two digits the count seal sets its number smaller. */
const WIDE_COUNT = 100;
/** The edge classes: the smallest stack shows one card behind, a larger one two. */
export const STACK = 'on-notice--stack';
const PAIR = 'on-notice--pair';

/** The line glyphs that stand in for a thumbnail the painters cannot draw. */
const NOTICE_GLYPH: Readonly<Record<NoticeGlyph, string>> = {
  house: GLYPH.house,
  swords: GLYPH.swords,
  skull: GLYPH.skull,
  shield: GLYPH.shield,
  banner: GLYPH.banner,
  chest: GLYPH.chest,
  scroll: GLYPH.scroll,
};

const DIM = ' on-notice__preview--dim';

export function glyphMarkup(glyph: NoticeGlyph, dim: boolean): string {
  return `<span class="on-notice__preview on-notice__preview--glyph${dim ? DIM : ''}" aria-hidden="true">${NOTICE_GLYPH[glyph]}</span>`;
}

export function previewMarkup(thumb: NoticeThumb): string {
  switch (thumb.kind) {
    case 'settler':
    case 'vehicle':
      return '<canvas class="on-notice__preview on-notice__preview--figure" aria-hidden="true"></canvas>';
    case 'building':
      return '<canvas class="on-notice__preview on-notice__preview--building" aria-hidden="true"></canvas>';
    case 'glyph':
      return `<canvas class="on-notice__preview on-notice__preview--art${thumb.dim ? DIM : ''}" aria-hidden="true"></canvas>`;
  }
}

/** Paint a new thumbnail's building or glyph canvas inside `host`; one the painters cannot draw becomes
 *  a line glyph. A figure is painted every frame instead. */
export function paintNoticeThumb(host: Element, thumb: NoticeThumb, painters: NoticeThumbPainters): void {
  if (thumb.kind === 'settler' || thumb.kind === 'vehicle') return;
  const canvas = host.querySelector('canvas.on-notice__preview');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (thumb.kind === 'building') {
    if (!painters.paintBuilding(canvas, thumb.typeId)) canvas.outerHTML = glyphMarkup('house', false);
  } else {
    const toLineGlyph = (): void => {
      canvas.outerHTML = glyphMarkup(thumb.glyph, thumb.dim);
    };
    if (!painters.paintGlyph(canvas, thumb.glyph, thumb.seat, toLineGlyph)) toLineGlyph();
  }
}

/** The entity a figure thumbnail paints, or undefined for one painted once. */
export function figureEntity(thumb: NoticeThumb): number | undefined {
  return thumb.kind === 'settler' || thumb.kind === 'vehicle' ? thumb.entity : undefined;
}

function sealClass(level: MessagePriorityLevel): string {
  const seal = SEAL_BY_LEVEL[level];
  return `on-seal${seal === '' ? '' : ` on-seal--${seal}`}`;
}

/** Whether `stack` shows as a stack rather than a lone card. */
export function isStack(stack: NoticeStackView): boolean {
  return stack.count >= MIN_STACK_MEMBERS;
}

/** What needs the card's inside built anew when it changes; the count, the labels and the edges update
 *  in place. */
export function cardShape(stack: NoticeStackView): string {
  const { lead } = stack;
  return `${lead.id}|${lead.level}|${lead.canGo}|${isStack(stack)}`;
}

/** The inside of a card: the face with the thumbnail and the event line, a lone note's seal on the face
 *  or a stack's count seal as its own toggle button beside it, the ×, and a stack's edges. */
export function cardInnerMarkup(stack: NoticeStackView): string {
  const { lead } = stack;
  const stacked = isStack(stack);
  const seal = stacked ? '' : `<i class="${sealClass(lead.level)}" aria-hidden="true"></i>`;
  const toggle = stacked
    ? `<button type="button" class="on-notice__toggle" aria-expanded="false"><i class="${sealClass(lead.level)} on-seal--count" aria-hidden="true"></i></button>`
    : '';
  const edges = stacked
    ? '<span class="on-notice__edge" aria-hidden="true"></span><span class="on-notice__edge on-notice__edge--2" aria-hidden="true"></span>'
    : '';
  return `<button type="button" class="on-notice__card">${previewMarkup(lead.thumb)}<b class="on-notice__event"></b>${seal}${lead.canGo ? GLYPH.go : ''}</button>${toggle}<button type="button" class="on-notice__dismiss">${GLYPH.close}</button>${edges}`;
}

/** Set a card's class, labels, count and line from `stack`; its inside must already have its shape. */
export function fillCard(li: HTMLLIElement, stack: NoticeStackView, open: boolean, copy: NoticesCopy): void {
  const { lead } = stack;
  const stacked = isStack(stack);
  const seal = SEAL_BY_LEVEL[lead.level];
  li.classList.toggle('on-notice--warn', seal === 'warn');
  li.classList.toggle('on-notice--danger', seal === 'danger');
  li.classList.toggle(STACK, stacked);
  li.classList.toggle(PAIR, stack.count === MIN_STACK_MEMBERS);
  li.classList.toggle('on-notice--open', open);
  li.dataset.key = stack.key;
  li.dataset.id = String(lead.id);
  const entity = figureEntity(lead.thumb);
  if (entity === undefined) delete li.dataset.entity;
  else li.dataset.entity = String(entity);
  const face = li.querySelector('.on-notice__card');
  const event = li.querySelector('.on-notice__event');
  const dismiss = li.querySelector('.on-notice__dismiss');
  if (face === null || event === null || dismiss === null)
    throw new Error('notice column: card markup incomplete');
  event.textContent = lead.short;
  face.setAttribute('aria-label', stacked ? `${stack.breakdown}. ${lead.full}` : lead.full);
  // A card with no target is a disclosure: a press pins its whole message.
  if (!lead.canGo && !face.hasAttribute('aria-expanded')) face.setAttribute('aria-expanded', 'false');
  dismiss.setAttribute('aria-label', stacked ? `${copy.groupDismiss} (${stack.breakdown})` : copy.dismiss);
  const toggle = li.querySelector('.on-notice__toggle');
  if (toggle !== null) {
    toggle.setAttribute('aria-expanded', String(open));
    const label = open ? copy.groupClose : formatMessage(copy.groupOpen, { count: stack.count });
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('title', `${label} (${open ? '←' : '→'})`);
    const count = toggle.firstElementChild;
    if (count !== null) {
      count.textContent = String(stack.count);
      count.classList.toggle('on-seal--wide', stack.count >= WIDE_COUNT);
    }
  }
}
