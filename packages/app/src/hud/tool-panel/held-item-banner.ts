import { type Container, Graphics } from 'pixi.js';
import { drawWindowPanel, WIN_PAD, WIN_TITLE_H } from '../chrome.js';
import type { TextRun } from '../text-run.js';
import type { PanelContext } from './context.js';

/** Banner width in design px, sized to fit the held-item hint at the HUD text size. */
const BANNER_WIDTH = 260;
/** Banner top offset + text inset (design px). */
const BANNER_OFFSET_Y = 2;
const BANNER_TEXT_INSET_Y = 3;

/** The window-chrome strip at the head of the central region showing the held item and its click/cancel hint. */
export interface HeldItemBanner {
  /** `text` is the fully formatted hint. */
  show(text: string): void;
  /** Re-place the banner text against the live canvas size; call once per frame. */
  place(): void;
  clear(): void;
}

export function createHeldItemBanner(ctx: PanelContext, container: Container): HeldItemBanner {
  const { scale } = ctx;
  const graphics = new Graphics();
  container.addChild(graphics);
  let run: TextRun | null = null;

  // The banner stands where a central window would open; the text is inset WIN_PAD inside it.
  const bannerRect = (): { x: number; y: number; w: number; h: number } => {
    const w = BANNER_WIDTH * scale;
    const at = ctx.layout.windowOrigin(ctx.screen(), w);
    return { x: at.x, y: at.y + BANNER_OFFSET_Y * scale, w, h: (WIN_TITLE_H + WIN_PAD) * scale };
  };
  let drawn = '';
  const draw = (): void => {
    const rect = bannerRect();
    const key = `${rect.x},${rect.y}`;
    if (key === drawn) return;
    drawn = key;
    graphics.clear();
    drawWindowPanel(graphics, rect, scale);
    const { width: rw, height: rh } = ctx.screen();
    run?.place(rect.x + WIN_PAD * scale, rect.y + BANNER_TEXT_INSET_Y * scale, scale, rw, rh);
  };

  return {
    show: (text): void => {
      run?.destroy();
      run = ctx.makeText(text, 'white');
      container.addChild(run.container);
      drawn = '';
      draw();
    },
    place: (): void => {
      if (run !== null) draw();
    },
    clear: (): void => {
      graphics.clear();
      drawn = '';
      run?.destroy();
      run = null;
    },
  };
}
