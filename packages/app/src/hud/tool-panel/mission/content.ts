import type { HypertextBook, HypertextParagraph } from '@open-northland/data';
import type { Container } from 'pixi.js';
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

/** A glyph never wraps; this width (design px) only has to clear one character. */
const GLYPH_WRAP_WIDTH = 40;

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
  /** Queue a wrapped paragraph at `x` design px from the viewport left and advance past it. */
  paragraph(
    p: HypertextParagraph,
    x: number,
    wrapWidth: number,
    gapAfter: number,
    color?: FontColorName,
  ): void;
  /** Queue a section heading at `x`, a size up from the body, and advance past it. */
  heading(text: string, x: number, wrapWidth: number): void;
  /** Queue a single glyph at the current cursor without advancing (the goal bullets); set like a
   *  paragraph so it shares the text's line metrics. */
  glyph(text: string, x: number, px: number): void;
  /** Move the cursor down to `y` design px when it is still above it. */
  skipTo(y: number): void;
}

export function createContentSink(ctx: PanelContext, container: Container): ContentSink {
  const { scale } = ctx;
  const placed: PlacedRun[] = [];
  let cursor = 0;
  const block = (
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
  return {
    placed,
    height: () => cursor,
    paragraph(p, x, wrapWidth, gapAfter, color = 'dark') {
      const px = p.style === 'title' ? MISSION_HEADLINE_PX : MISSION_BODY_PX;
      block(p.text, px, x, wrapWidth, gapAfter, color, p.align === 'center', p.link ?? null);
    },
    heading(text, x, wrapWidth) {
      block(text, MISSION_HEADING_PX, x, wrapWidth, 0, 'dark', false, null);
    },
    glyph(text, x, px) {
      const before = cursor;
      block(text, px, x, GLYPH_WRAP_WIDTH, 0, 'dark', false, null);
      cursor = before;
    },
    skipTo(y) {
      cursor = Math.max(cursor, Math.round(y * scale));
    },
  };
}

/** The book's page `id`, or undefined when the book lacks it (a record lookup, so only own keys count). */
export function pageOf(book: HypertextBook | null, id: string): readonly HypertextParagraph[] | undefined {
  return book !== null && Object.hasOwn(book.pages, id) ? book.pages[id] : undefined;
}

/** The task tab: the brief's headline over its briefing paragraphs, or `emptyText` without a briefing. */
export function fillTask(
  sink: ContentSink,
  brief: MissionBrief | null,
  wrapWidth: number,
  emptyText: string,
): void {
  if (brief !== null && brief.title !== '') {
    sink.paragraph({ style: 'title', text: brief.title, align: 'center' }, 0, wrapWidth, HEADLINE_GAP);
  }
  if (brief === null || brief.paragraphs.length === 0) {
    sink.paragraph({ style: 'body', text: emptyText }, 0, wrapWidth, PARAGRAPH_GAP);
    return;
  }
  for (const p of brief.paragraphs) sink.paragraph(p, 0, wrapWidth, PARAGRAPH_GAP);
}

/** The goals tab: the heading, then one `o`/`X` bullet and wrapped text per goal, as the original prints them. */
export function fillGoals(sink: ContentSink, brief: MissionBrief | null, heading: string): void {
  sink.heading(heading, GOAL_LIST.headingX, GOAL_LIST.wrapWidth);
  sink.skipTo(GOAL_LIST.listY);
  for (const goal of brief?.goals ?? []) {
    sink.glyph(goal.done ? GOAL_DONE_BULLET : GOAL_OPEN_BULLET, GOAL_LIST.bulletX, MISSION_BODY_PX);
    sink.paragraph({ style: 'body', text: goal.text }, GOAL_LIST.textX, GOAL_LIST.wrapWidth, GOAL_LIST.gap);
  }
}

/** The history tab: one page of the book, its links in red, or `emptyText` without the book. */
export function fillHistory(
  sink: ContentSink,
  page: readonly HypertextParagraph[] | undefined,
  wrapWidth: number,
  emptyText: string,
): void {
  if (page === undefined) {
    sink.paragraph({ style: 'body', text: emptyText }, 0, wrapWidth, PARAGRAPH_GAP);
    return;
  }
  for (const p of page) {
    sink.paragraph(p, 0, wrapWidth, PARAGRAPH_GAP, p.link === undefined ? 'dark' : 'red');
  }
}
