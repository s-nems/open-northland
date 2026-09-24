import type {
  HypertextAlign,
  HypertextBlock,
  HypertextBook,
  HypertextIconRow,
  HypertextParagraph,
  HypertextPicture,
} from '@open-northland/data';
import { type Container, Graphics, Sprite } from 'pixi.js';
import type { FontColorName } from '../../../content/font-gfx.js';
import type { MissionBrief } from '../../../game/mission-brief.js';
import { drawBevel } from '../../chrome.js';
import type { ParagraphAlign, ParagraphFace } from '../../text-run.js';
import type { PanelContext } from '../context.js';
import {
  GOAL_DONE_BULLET,
  GOAL_LIST,
  GOAL_OPEN_BULLET,
  HEADLINE_GAP,
  MISSION_BODY_PX,
  MISSION_HEADING_PX,
  PARAGRAPH_GAP,
  type PlacedLink,
  type RunPlacement,
} from './model.js';
import type { PictureCache } from './pictures.js';
import type { UserIconBox } from './user-icons.js';

/** A glyph never wraps; this width (design px) only has to clear one character. */
const GLYPH_WRAP_WIDTH = 40;
const DEFAULT_TEXT_COLOR: FontColorName = 'dark';
const LINK_COLOR: FontColorName = 'red';
/** An inactive, unmet goal prints in the window's muted colour (reading). */
const IDLE_GOAL_COLOR: FontColorName = 'dimmed';

/**
 * The page faces and the original's line pitch: a text line is
 * its font's nominal size × 3/2 tall (font12 → 18, fonthead16bld's 14 → 21) and an empty line 20.
 * Approximations: the body is Tinos at 15 px, set by eye under the 17 px that matches font12's cap and
 * x-height (11 and 8 px) but reads larger than the thin bitmap face; the bold title keeps fonthead16bld's
 * 14:12 ratio to it; a justified run spreads without the engine's per-gap cap.
 */
const PAGE_FACE: Readonly<Record<HypertextParagraph['style'], { px: number; face: ParagraphFace }>> = {
  body: { px: 15, face: { letterSpacing: 0.5, lineHeight: 18 } },
  title: { px: 18, face: { bold: true, lineHeight: 21 } },
};
const BLANK_LINE_H = 20;
/** A picture's row is this much taller than the picture, which sits at the row's bottom. */
const PICTURE_ROW_PAD = 2;
/** The gap after an inline icon: the advance of font12's `i`, the engine's word space. */
const ICON_GAP = 5;
/** Justified lines spread their gaps only while each stays within this many px. */
const MAX_JUSTIFY_GAP = 12;
/** The frame the original draws around the view's bitmap, design px.
 *  Approximation: a pressed bevel stands in for the frame's bob strips. */
const VIEW_FRAME_W = 2;

/** The view frame's width in screen px at `scale`, as the bevel draws it. */
export function viewFrameWidth(scale: number): number {
  return Math.max(1, Math.round(VIEW_FRAME_W * scale));
}

/** One placed run of tab content: where it sits and the run it owns. */
export interface PlacedRun extends PlacedLink {
  readonly place: (x: number, y: number) => void;
  readonly destroy: () => void;
}

/** A user icon's box on the page, in screen px from the viewport origin (unscrolled). */
export interface PlacedView {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly icon: UserIconBox;
}

/** Lays one tab's runs top-down into a container at the window's scale (`ctx` is re-based to it). */
export interface ContentSink {
  readonly placed: readonly PlacedRun[];
  readonly views: readonly PlacedView[];
  /** The laid-out height so far, in screen px. */
  height(): number;
  /** Queue one page block across the text column in the engine's line pitch. */
  pageBlock(b: HypertextBlock, wrapWidth: number): void;
  /** Queue a paragraph in the page faces at `x` design px from the viewport left, then `gapAfter`. */
  paragraph(p: HypertextParagraph, x: number, wrapWidth: number, gapAfter: number): void;
  /** Queue a goal's text in the list's face at `x`, then `gapAfter`. */
  listText(text: string, color: FontColorName, x: number, wrapWidth: number, gapAfter: number): void;
  /** Queue a section heading at `x`, a size up from the list text, and advance past it. */
  heading(text: string, x: number, wrapWidth: number): void;
  /** Queue a single glyph at the current cursor without advancing (the goal bullets); set like the
   *  list text so it shares its line metrics. */
  glyph(text: string, x: number, px: number): void;
  /** Move the cursor down to `y` design px when it is still above it. */
  skipTo(y: number): void;
}

/** The box a `<usericon:…>` draws, or null when the hosting tab draws nothing for it. */
export type UserIconResolver = (icon: HypertextIconRow['icons'][number]) => UserIconBox | null;

const NO_ICONS: UserIconResolver = () => null;

function placementOf(align: ParagraphAlign): RunPlacement {
  return align === 'center' || align === 'right' ? align : 'left';
}

/** Each entity's shift across a line with `slack` px left over.
 *  A line overfull by its trailing gap stays put, where the original would throw it off
 *  the column. */
function lineShifts(align: HypertextAlign | undefined, slack: number, count: number): number[] {
  const shifts = new Array<number>(count).fill(0);
  if (slack <= 0) return shifts;
  if (align === 'center') shifts.fill(Math.floor(slack / 2));
  else if (align === 'right') shifts.fill(slack);
  else if (align === 'justify' && count > 1 && slack / (count - 1) <= MAX_JUSTIFY_GAP) {
    for (let i = 0; i < count; i++) shifts[i] = Math.floor((i * slack) / (count - 1));
  }
  return shifts;
}

export function createContentSink(
  ctx: PanelContext,
  container: Container,
  pictures: PictureCache,
  icons: UserIconResolver = NO_ICONS,
): ContentSink {
  const { scale } = ctx;
  const placed: PlacedRun[] = [];
  const views: PlacedView[] = [];
  let cursor = 0;
  const run = (
    text: string,
    px: number,
    x: number,
    wrapWidth: number,
    gapAfter: number,
    color: FontColorName,
    align: ParagraphAlign,
    link: string | null,
    face?: ParagraphFace,
  ): void => {
    const made = ctx.makeParagraph(text, color, px, wrapWidth, align, face);
    container.addChild(made.container);
    const h = Math.round(made.height * scale);
    placed.push({
      x: Math.round(x * scale),
      y: cursor,
      h,
      width: made.width * scale,
      placement: placementOf(align),
      link,
      place: made.place,
      destroy: made.destroy,
    });
    cursor += h + Math.round(gapAfter * scale);
  };
  const paragraph = (p: HypertextParagraph, x: number, wrapWidth: number, gapAfter: number): void => {
    const { px, face } = PAGE_FACE[p.style];
    // A page that colours nothing still has to show which runs are links.
    const color = p.color ?? (p.link === undefined ? DEFAULT_TEXT_COLOR : LINK_COLOR);
    run(p.text, px, x, wrapWidth, gapAfter, color, p.align ?? 'left', p.link ?? null, face);
  };
  const picture = (p: HypertextPicture, wrapWidth: number): void => {
    // Only the width is fitted: a picture taller than the viewport is scrolled, as in the original.
    const fit = Math.min(1, wrapWidth / p.width) * scale;
    const w = Math.round(p.width * fit);
    const h = Math.round(p.height * fit);
    const sprite = new Sprite(pictures.ready(p.file));
    sprite.setSize(w, h);
    container.addChild(sprite);
    // A panel remount destroys the sprite with its container, not through `destroy` below.
    void pictures.load(p.file).then((texture) => {
      if (sprite.destroyed || texture === undefined || sprite.texture === texture) return;
      sprite.texture = texture;
      sprite.setSize(w, h);
    });
    const pad = Math.round(PICTURE_ROW_PAD * scale);
    placed.push({
      x: 0,
      y: cursor + pad,
      h,
      width: w,
      placement: 'center',
      link: null,
      place: (x, y) => sprite.position.set(Math.round(x), Math.round(y)),
      destroy: () => sprite.destroy(),
    });
    cursor += h + pad;
  };
  /** One framed icon box, `x` design px from the viewport's left and `y` screen px from its top; the
   *  world view paints its inside. */
  const iconBox = (box: UserIconBox, x: number, y: number): void => {
    const w = Math.round(box.w * scale);
    const h = Math.round(box.h * scale);
    const frame = new Graphics();
    // A card's fill shows even without its human; a view paints over it.
    if (box.soloFill !== undefined) frame.rect(0, 0, w, h).fill(box.soloFill);
    drawBevel(frame, { x: 0, y: 0, w, h }, viewFrameWidth(scale), 'pressed');
    container.addChild(frame);
    const left = Math.round(x * scale);
    placed.push({
      x: left,
      y,
      h,
      width: w,
      placement: 'left',
      link: null,
      place: (px, py) => frame.position.set(Math.round(px), Math.round(py)),
      destroy: () => frame.destroy(),
    });
    views.push({ x: left, y, w, h, icon: box });
  };
  /** The row's icons inline, wrapped at the column like words, each line aligned as the row says. */
  const iconRow = (row: HypertextIconRow, wrapWidth: number): void => {
    const boxes = row.icons.flatMap((icon) => icons(icon) ?? []);
    // The original skips an icon that draws nothing, which leaves the line empty.
    if (boxes.length === 0) {
      cursor += Math.round(BLANK_LINE_H * scale);
      return;
    }
    let line: { box: UserIconBox; x: number }[] = [];
    let x = 0;
    const endLine = (): void => {
      const lineH = Math.max(...line.map((l) => l.box.h));
      const shifts = lineShifts(row.align, wrapWidth - x, line.length);
      line.forEach((l, i) => {
        iconBox(l.box, l.x + (shifts[i] ?? 0), cursor + Math.round((lineH - l.box.h) * scale));
      });
      cursor += Math.round(lineH * scale);
      line = [];
      x = 0;
    };
    for (const box of boxes) {
      if (line.length > 0 && x + box.w > wrapWidth) endLine();
      line.push({ box, x });
      x += box.w + ICON_GAP;
    }
    endLine();
  };
  return {
    placed,
    views,
    height: () => cursor,
    pageBlock(b, wrapWidth) {
      switch (b.kind) {
        case 'text':
          paragraph(b, 0, wrapWidth, 0);
          break;
        case 'blank':
          cursor += Math.round(b.lines * BLANK_LINE_H * scale);
          break;
        case 'picture':
          picture(b, wrapWidth);
          break;
        case 'icons':
          iconRow(b, wrapWidth);
          break;
      }
    },
    paragraph,
    listText(text, color, x, wrapWidth, gapAfter) {
      run(text, MISSION_BODY_PX, x, wrapWidth, gapAfter, color, 'left', null);
    },
    heading(text, x, wrapWidth) {
      run(text, MISSION_HEADING_PX, x, wrapWidth, 0, DEFAULT_TEXT_COLOR, 'left', null);
    },
    glyph(text, x, px) {
      const before = cursor;
      run(text, px, x, GLYPH_WRAP_WIDTH, 0, DEFAULT_TEXT_COLOR, 'left', null);
      cursor = before;
    },
    skipTo(y) {
      cursor = Math.max(cursor, Math.round(y * scale));
    },
  };
}

/** The book's page `id`, or undefined when the book lacks it (a record lookup, so only own keys count). */
export function pageOf(book: HypertextBook | null, id: string): readonly HypertextBlock[] | undefined {
  return book !== null && Object.hasOwn(book.pages, id) ? book.pages[id] : undefined;
}

/** A plain body paragraph the window writes itself, for text that is not a decoded page. */
function bodyParagraph(text: string): HypertextParagraph {
  return { kind: 'text', style: 'body', text };
}

/** The task tab: the briefing page as authored, or, without one, the brief's headline over its fallback
 *  text, or `emptyText` without either. */
export function fillTask(
  sink: ContentSink,
  brief: MissionBrief | null,
  wrapWidth: number,
  emptyText: string,
): void {
  if (brief !== null && brief.title !== '') {
    sink.paragraph(
      { kind: 'text', style: 'title', text: brief.title, align: 'center' },
      0,
      wrapWidth,
      HEADLINE_GAP,
    );
  }
  if (brief === null || brief.blocks.length === 0) {
    sink.paragraph(bodyParagraph(emptyText), 0, wrapWidth, PARAGRAPH_GAP);
    return;
  }
  for (const b of brief.blocks) sink.pageBlock(b, wrapWidth);
}

/** The goals tab: the heading, then one `o`/`X` bullet and wrapped text per goal, as the original
 *  prints them; an idle goal has no bullet and prints dimmed. */
export function fillGoals(
  sink: ContentSink,
  brief: MissionBrief | null,
  heading: string,
  wrapWidth: number,
): void {
  sink.heading(heading, GOAL_LIST.headingX, wrapWidth - GOAL_LIST.headingX);
  sink.skipTo(GOAL_LIST.listY);
  for (const goal of brief?.goals ?? []) {
    if (goal.state !== 'idle') {
      sink.glyph(
        goal.state === 'done' ? GOAL_DONE_BULLET : GOAL_OPEN_BULLET,
        GOAL_LIST.bulletX,
        MISSION_BODY_PX,
      );
    }
    const color = goal.state === 'idle' ? IDLE_GOAL_COLOR : DEFAULT_TEXT_COLOR;
    sink.listText(goal.text, color, GOAL_LIST.textX, wrapWidth - GOAL_LIST.textX, GOAL_LIST.gap);
  }
}

/** The history tab: one page of the book, or `emptyText` without the book. */
export function fillHistory(
  sink: ContentSink,
  page: readonly HypertextBlock[] | undefined,
  wrapWidth: number,
  emptyText: string,
): void {
  if (page === undefined) {
    sink.paragraph(bodyParagraph(emptyText), 0, wrapWidth, PARAGRAPH_GAP);
    return;
  }
  for (const b of page) sink.pageBlock(b, wrapWidth);
}
