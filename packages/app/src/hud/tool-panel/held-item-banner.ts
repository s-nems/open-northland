import { type Container, Graphics } from 'pixi.js';
import { drawWindowPanel, WIN_PAD, WIN_TITLE_H } from '../chrome.js';
import type { TextRun } from '../text-run.js';
import type { PanelContext } from './context.js';

/** Banner width (design px) — fits a "<held> — klik: …, Esc: …" hint in font10. */
const BANNER_WIDTH = 260;
/** Banner top offset + text inset (design px). */
const BANNER_OFFSET_Y = 2;
const BANNER_TEXT_INSET_Y = 3;

/** The "what's held" banner shared by the placement and good-drop controllers — a window-chrome strip
 *  beside the tool panel showing the held item + its click/cancel hint. Only the hint text differs; the
 *  geometry, chrome and per-frame re-placement live here. */
export interface HeldItemBanner {
  /** Draw or replace the banner with `text` (the fully-formatted hint). */
  show(text: string): void;
  /** Re-place the banner text against the live canvas size — call once per frame. */
  place(): void;
  /** Clear the banner graphics + text (leaving the mode). */
  clear(): void;
}

export function createHeldItemBanner(ctx: PanelContext, container: Container): HeldItemBanner {
  const { scale } = ctx;
  const graphics = new Graphics();
  container.addChild(graphics);
  let run: TextRun | null = null;

  // The banner sits WIN_PAD right of the tool panel; the text is inset another WIN_PAD inside it.
  const textX = (): number => ctx.layout.width + 2 * WIN_PAD * scale;
  const textY = (): number => (BANNER_OFFSET_Y + BANNER_TEXT_INSET_Y) * scale;

  return {
    show: (text): void => {
      graphics.clear();
      run?.destroy();
      const rect = {
        x: ctx.layout.width + WIN_PAD * scale,
        y: BANNER_OFFSET_Y * scale,
        w: BANNER_WIDTH * scale,
        h: (WIN_TITLE_H + WIN_PAD) * scale,
      };
      drawWindowPanel(graphics, rect, scale);
      run = ctx.makeText(text, 'white');
      container.addChild(run.container);
      const { width: rw, height: rh } = ctx.screen();
      run.place(textX(), textY(), scale, rw, rh);
    },
    place: (): void => {
      if (run === null) return;
      const { width: rw, height: rh } = ctx.screen();
      run.place(textX(), textY(), scale, rw, rh);
    },
    clear: (): void => {
      graphics.clear();
      run?.destroy();
      run = null;
    },
  };
}
