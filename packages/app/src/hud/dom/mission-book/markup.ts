import type { HypertextPicture, HypertextUserIcon } from '@open-northland/data';
import { GLYPH } from '../icons.js';
import { escapeHtml } from '../parts/dom.js';
import type { BookPage, BookSegment } from './page-segments.js';
import type { UserIconBox } from './user-icons.js';

/**
 * The book's markup for one page of hypertext: the segments set as a flowing text with its pictures
 * and world views where the author placed them. Sizes are design px of the page column.
 */

/** A picture or a world view fits the text column, less the frame around it. */
export const FIGURE = { w: 318, h: 230 } as const;
/** The page's pictures are small scans; past this they blur. */
const MAX_UPSCALE = 1.25;
/** A picture this narrow is a head-and-shoulders portrait (164 × 136 in the campaigns): an oval, no
 *  frame. */
const PORTRAIT_MAX_W = 200;
/** World views of one row sit side by side, at most this many across. */
const VIEWS_ACROSS = 2;
const VIEW_GAP = 8;
/** A figure card keeps the original's 50 × 80 box, enlarged by this. */
export const CARD_ZOOM = 1.25;
/** A spoken line this short moves whole to the next page rather than leave its portrait behind. */
const SHORT_SPEECH = 260;
/** The drop capital spans two lines, so it opens only a paragraph that surely wraps: a one-line
 *  paragraph at a page's foot would cut the capital off at the page edge. A full line holds about 50. */
const DROP_CAP_MIN_CHARS = 90;

export const FLOURISH =
  '<svg viewBox="0 0 120 16" class="on-book__flourish" aria-hidden="true"><path d="M2 8h44M74 8h44" stroke="currentColor" stroke-width="1"/><path d="M60 2l6 6-6 6-6-6z" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="60" cy="8" r="1.6" fill="currentColor"/><path d="M46 8c4-4 6-4 8 0M74 8c-4 4-6 4-8 0" fill="none" stroke="currentColor" stroke-width="1"/></svg>';

/** One world view on the page: the box the renderer paints, in design px, and what it shows. */
export interface ViewSlot {
  readonly icon: UserIconBox;
  /** World px per design px: a map view shows the world at the HUD's own scale, a card enlarges its
   *  figure with the card. */
  readonly zoom: number;
}

export interface FlowContext {
  readonly pictureUrl: (file: string) => string;
  /** The box a `<usericon>` draws, or null when it draws nothing. */
  readonly iconBox: (icon: HypertextUserIcon) => UserIconBox | null;
  readonly showOnMap: string;
  /** Collects the views in document order; a view's markup carries its index. */
  readonly views: ViewSlot[];
}

function figure(picture: HypertextPicture, url: string): string {
  const scale = Math.min(FIGURE.w / picture.width, FIGURE.h / picture.height, MAX_UPSCALE);
  const w = Math.round(picture.width * scale);
  const h = Math.round(picture.height * scale);
  const img = (className: string): string =>
    `<img class="${className}" src="${escapeHtml(url)}" width="${w}" height="${h}" alt="">`;
  if (picture.width <= PORTRAIT_MAX_W) {
    return `<figure class="on-book__fig on-book__fig--portrait">${img('on-book__img on-book__img--portrait')}</figure>`;
  }
  return `<figure class="on-book__fig"><span class="on-book__plate">${img('on-book__img')}</span></figure>`;
}

function views(icons: readonly HypertextUserIcon[], ctx: FlowContext): string {
  const boxes = icons.flatMap((icon) => ctx.iconBox(icon) ?? []);
  if (boxes.length === 0) return '';
  const maps = boxes.filter((b) => b.soloFill === undefined);
  const across = Math.min(VIEWS_ACROSS, Math.max(1, maps.length));
  const mapW = Math.floor((FIGURE.w - (across - 1) * VIEW_GAP) / across);
  const cells = boxes.map((box) => {
    const card = box.soloFill !== undefined;
    const w = card ? Math.round(box.w * CARD_ZOOM) : mapW;
    const h = card ? Math.round(box.h * CARD_ZOOM) : Math.round((mapW * box.h) / box.w);
    const index = ctx.views.push({ icon: box, zoom: card ? CARD_ZOOM : 1 }) - 1;
    // A card whose human is gone gets no hole, so the page paints its fill; over a hole the renderer does.
    const fill =
      box.soloFill === undefined || box.target !== null
        ? ''
        : `;background:#${box.soloFill.toString(16).padStart(6, '0')}`;
    const lens = `<span class="on-book__lens" style="width:${w}px;height:${h}px${fill}"></span>`;
    if (box.target === null)
      return `<span class="on-book__view on-book__view--card" data-view="${index}">${lens}</span>`;
    const label = escapeHtml(ctx.showOnMap);
    const go = card ? '' : `<span class="on-book__go">${GLYPH.pin}<span>${label}</span></span>`;
    return `<button type="button" class="on-book__view${card ? ' on-book__view--card' : ''}" data-view="${index}" aria-label="${label}">${lens}${go}</button>`;
  });
  return `<div class="on-book__views on-book__views--${across}">${cells.join('')}</div>`;
}

/** The class that keeps the author's empty lines before a segment. */
const spaceClass = (s: BookSegment): string => (s.space === undefined ? '' : ` on-book__space--${s.space}`);

function paragraph(s: Extract<BookSegment, { kind: 'para' }>, first: boolean): string {
  const text = escapeHtml(s.text).replace(/\n/g, '<br>');
  const classes = ['on-book__p'];
  if (
    first &&
    s.link === null &&
    (s.align === 'left' || s.align === 'justify') &&
    s.text.length >= DROP_CAP_MIN_CHARS
  )
    classes.push('on-book__p--first');
  // The book justifies all prose, so only a centred or right-aligned line carries its own class.
  if (s.align === 'center' || s.align === 'right') classes.push(`on-book__p--${s.align}`);
  if (s.tone !== null) classes.push(`on-book__p--${s.tone}`);
  const body =
    s.link === null
      ? text
      : `<button type="button" class="on-book__jump" data-jump="${escapeHtml(s.link)}">${text}</button>`;
  return `<p class="${classes.join(' ')}${spaceClass(s)}">${body}</p>`;
}

function speech(s: Extract<BookSegment, { kind: 'speech' }>, ctx: FlowContext): string {
  const face =
    s.portrait === null
      ? ''
      : `<img class="on-book__face" src="${escapeHtml(ctx.pictureUrl(s.portrait.file))}" alt="">`;
  const who = s.speaker === null ? '' : `<b class="on-book__who">${escapeHtml(s.speaker)}</b>`;
  const classes = ['on-book__speech'];
  if (s.portrait !== null) classes.push('on-book__speech--face');
  if (s.text.length <= SHORT_SPEECH) classes.push('on-book__speech--keep');
  return `<div class="${classes.join(' ')}${spaceClass(s)}">${face}<p>${who}${escapeHtml(s.text)}</p></div>`;
}

/** The segments as one flowing column; the first narration opens with a drop capital. */
export function flowMarkup(page: BookPage, ctx: FlowContext): string {
  const out: string[] = [];
  let first = true;
  for (const s of page.segments) {
    switch (s.kind) {
      case 'heading':
        out.push(`<h4 class="on-book__sub${spaceClass(s)}">${escapeHtml(s.text)}</h4>`);
        break;
      case 'para':
        out.push(paragraph(s, first));
        first = false;
        break;
      case 'speech':
        out.push(speech(s, ctx));
        first = false;
        break;
      case 'picture':
        out.push(figure(s.picture, ctx.pictureUrl(s.picture.file)));
        break;
      case 'icons':
        out.push(views(s.icons, ctx));
        break;
      case 'signature':
        out.push(`<p class="on-book__sign${spaceClass(s)}">${escapeHtml(s.text)}</p>`);
        break;
    }
  }
  return out.join('');
}

const ROMAN: readonly (readonly [number, string])[] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** A chapter's number the way the book prints it. */
export function roman(n: number): string {
  let rest = n;
  let out = '';
  for (const [value, digits] of ROMAN) {
    while (rest >= value) {
      out += digits;
      rest -= value;
    }
  }
  return out === '' ? String(n) : out;
}
