import type { Paper } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import type { PanelContext } from './context.js';
import { createHeldItemBanner } from './held-item-banner.js';
import type { HeldMode } from './input.js';

/**
 * The place-any paper the build menu was opened for. Held, with its banner up, until the menu's next pick
 * takes it; Esc, a right or world click, or the menu closing drop it back into the list unspent.
 */
export interface HeldPaperController extends HeldMode {
  hold(paper: Paper): void;
  /** The held paper, released to the pick that spends it; null when none is held. */
  take(): Paper | null;
  held(): Paper | null;
}

export function createHeldPaperController(ctx: PanelContext, container: Container): HeldPaperController {
  const banner = createHeldItemBanner(ctx, container);
  let paper: Paper | null = null;
  const drop = (): void => {
    paper = null;
    banner.clear();
  };
  return {
    hold: (held): void => {
      paper = held;
      banner.show(messages().hud.heldPaperHint);
    },
    take: (): Paper | null => {
      const taken = paper;
      drop();
      return taken;
    },
    held: () => paper,
    isActive: () => paper !== null,
    cancel: drop,
    handleClick: (): boolean => {
      if (paper === null) return false;
      ctx.cue('fail'); // a world click with a paper in hand calls the hold off
      drop();
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
