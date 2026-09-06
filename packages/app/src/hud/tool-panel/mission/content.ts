import type {
  HypertextBlock,
  HypertextBook,
  HypertextParagraph,
  HypertextPicture,
} from '@open-northland/data';
import { type Container, Sprite } from 'pixi.js';
import type { FontColorName } from '../../../content/font-gfx.js';
import type { MissionBrief } from '../../../game/mission-brief.js';
import type { PanelContext } from '../context.js';
import {
  GOAL_DONE_BULLET,
  GOAL_LIST,
  GOAL_OPEN_BULLET,
  HEADLINE_GAP,
  MISSION_BODY_PX,
  MISSION_HEADING_PX,
  MISSION_HEADLINE_PX,
  PARAGRAPH_GAP,
  type PlacedLink,
} from './model.js';
import type { PictureCache } from './pictures.js';

/** A glyph never wraps; this width (design px) only has to clear one character. */
const GLYPH_WRAP_WIDTH = 40;
const DEFAULT_TEXT_COLOR: FontColorName = 'dark';
const LINK_COLOR: FontColorName = 'red';

/** One placed run of tab content: where it sits and the run it owns. */
export interface PlacedRun extends PlacedLink {
  readonly place: (x: number, y: number) => void;
  readonly destroy: () => void;
}

/** Lays one tab's runs top-down into a container at the window's scale (`ctx` is re-based to it). */
export interface ContentSink {
  readonly placed: readonly PlacedRun[];
  /** The laid-out height so far, in screen px. */
  height(): number;
  /** Queue one page block across the text column and advance past it. */
  block(b: HypertextBlock, wrapWidth: number, gapAfter: number): void;
  /** Queue a wrapped paragraph at `x` design px from the viewport left and advance past it. */
  paragraph(p: HypertextParagraph, x: number, wrapWidth: number, gapAfter: number): void;
  /** Queue a section heading at `x`, a size up from the body, and advance past it. */
  heading(text: string, x: number, wrapWidth: number): void;
  /** Queue a single glyph at the current cursor without advancing (the goal bullets); set like a
   *  paragraph so it shares the text's line metrics. */
  glyph(text: string, x: number, px: number): void;
  /** Move the cursor down to `y` design px when it is still above it. */
  skipTo(y: number): void;
}

export function createContentSink(
  ctx: PanelContext,
  container: Container,
  pictures: PictureCache,
): ContentSink {
  const { scale } = ctx;
  const placed: PlacedRun[] = [];
  let cursor = 0;
  const run = (
    text: string,
    px: number,
    x: number,
    wrapWidth: number,
    gapAfter: number,
    color: FontColorName,
    centred: boolean,
    link: string | null,
  ): void => {
    const run = ctx.makeParagraph(text, color, px, wrapWidth, centred ? 'center' : 'left');
    container.addChild(run.container);
    const h = Math.round(run.height * scale);
    placed.push({
      x: Math.round(x * scale),
      y: cursor,
      h,
      width: run.width * scale,
      centred,
      link,
      place: run.place,
      destroy: run.destroy,
    });
    cursor += h + Math.round(gapAfter * scale);
  };
  const picture = (p: HypertextPicture, wrapWidth: number, gapAfter: number): void => {
    // Only the width is fitted, as in the original: a picture taller than the viewport is scrolled.
    const fit = Math.min(1, wrapWidth / p.width) * scale;
    const w = Math.round(p.width * fit);
    const h = Math.round(p.height * fit);
    const sprite = new Sprite(pictures.ready(p.file));
    sprite.setSize(w, h);
    container.addChild(sprite);
    let live = true;
    void pictures.load(p.file).then((texture) => {
      if (!live || texture === undefined || sprite.texture === texture) return;
      sprite.texture = texture;
      sprite.setSize(w, h);
    });
    placed.push({
      x: 0,
      y: cursor,
      h,
      width: w,
      centred: p.align === 'center',
      link: null,
      place: (x, y) => sprite.position.set(Math.round(x), Math.round(y)),
      destroy: () => {
        live = false;
        sprite.destroy();
      },
    });
    cursor += h + Math.round(gapAfter * scale);
  };
  const paragraph = (p: HypertextParagraph, x: number, wrapWidth: number, gapAfter: number): void => {
    const px = p.style === 'title' ? MISSION_HEADLINE_PX : MISSION_BODY_PX;
    // A page that colours nothing still has to show which runs are links.
    const color = p.color ?? (p.link === undefined ? DEFAULT_TEXT_COLOR : LINK_COLOR);
    run(p.text, px, x, wrapWidth, gapAfter, color, p.align === 'center', p.link ?? null);
  };
  return {
    placed,
    height: () => cursor,
    block(b, wrapWidth, gapAfter) {
      if (b.kind === 'picture') picture(b, wrapWidth, gapAfter);
      else paragraph(b, 0, wrapWidth, gapAfter);
    },
    paragraph,
    heading(text, x, wrapWidth) {
      run(text, MISSION_HEADING_PX, x, wrapWidth, 0, DEFAULT_TEXT_COLOR, false, null);
    },
    glyph(text, x, px) {
      const before = cursor;
      run(text, px, x, GLYPH_WRAP_WIDTH, 0, DEFAULT_TEXT_COLOR, false, null);
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

/** The task tab: the brief's headline over its briefing page, or `emptyText` without a briefing. */
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
  for (const b of brief.blocks) sink.block(b, wrapWidth, PARAGRAPH_GAP);
}

/** The goals tab: the heading, then one `o`/`X` bullet and wrapped text per goal, as the original prints them. */
export function fillGoals(sink: ContentSink, brief: MissionBrief | null, heading: string): void {
  sink.heading(heading, GOAL_LIST.headingX, GOAL_LIST.wrapWidth);
  sink.skipTo(GOAL_LIST.listY);
  for (const goal of brief?.goals ?? []) {
    sink.glyph(goal.done ? GOAL_DONE_BULLET : GOAL_OPEN_BULLET, GOAL_LIST.bulletX, MISSION_BODY_PX);
    sink.paragraph(bodyParagraph(goal.text), GOAL_LIST.textX, GOAL_LIST.wrapWidth, GOAL_LIST.gap);
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
  for (const b of page) sink.block(b, wrapWidth, PARAGRAPH_GAP);
}
